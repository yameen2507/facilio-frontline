/**
 * The lead aggregate.
 *
 * Two invariants the whole module rests on:
 *   - `create` is the ONLY writer of fl_lead. Every channel goes through it, so
 *     dedup, SLA stamping and numbering can never be bypassed.
 *   - `transition` is the ONLY path that changes status, validated against the
 *     state machine in domain/lead-state.ts.
 */

import { many, manyWithTruncation, mutate, nowIso, one } from "../shared/db";
import { appendEvent, timeline } from "../shared/events";
import { nextRef } from "../shared/ids";
import { dedupKeys } from "../domain/normalize";
import { dueDates } from "../domain/sla";
import { slaSnapshot } from "../domain/sla";
import { queuePriority, scoreBand } from "../domain/scoring";
import {
  type DispositionReason,
  LEAD_ORIGINS,
  type LeadStatus,
  isLeadOrigin,
  stampColumnFor,
  validateTransition,
  valueFieldsBlocker,
} from "../domain/lead-state";
import { assessmentSubquery, foldLatest, type Assessment } from "./assessment";
import { slaTargets } from "./settings";

/**
 * The three channels a lead can arrive through. There is deliberately no phone
 * or manual-entry channel.
 *
 * `sourceDetail` carries the refinement — "defect", "reclean", "site visit" —
 * so narrowing a channel never needs a new enum value or a migration.
 */
export const LEAD_SOURCES = [
  "widget", // public web chat, handled by the intake agent
  "tender", // scraped RFQ / tender notice
  "inapp", // raised inside the app by staff (incl. defects and re-clean due)
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface Lead {
  id: string;
  refNo: string;
  companyName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteDomain: string | null;
  source: string;
  sourceDetail: string | null;
  serviceType: string | null;
  description: string | null;
  siteAddress: string | null;
  siteCity: string | null;
  siteRegion: string | null;
  estimatedValue: number | null;
  currency: string | null;
  /** D-05: one_off | recurring | both. Null on rows that predate the field. */
  valueType: string | null;
  /** monthly | quarterly | annual — present exactly when the value recurs. */
  valueFrequency: string | null;
  /** D-10: where the enquiry CAME FROM (referral, existing client, …).
      `source` is how it ARRIVED — the two axes are deliberately separate. */
  origin: string | null;
  status: LeadStatus;
  dispositionReason: string | null;
  duplicateOfLeadId: string | null;
  nurtureUntil: string | null;
  ownerEmail: string | null;
  salesOwnerEmail: string | null;
  accountId: string | null;
  contactId: string | null;
  dealId: string | null;
  score: number | null;
  verdict: string | null;
  analysedAt: string | null;
  arrivedAt: string | null;
  firstResponseDueAt: string | null;
  reviewedAt: string | null;
  firstContactAt: string | null;
  qualificationDueAt: string | null;
  qualifiedAt: string | null;
  assignmentDueAt: string | null;
  assignedAt: string | null;
  convertedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS = `id, ref_no, company_name, contact_name, contact_email, contact_phone,
  website_domain, source, source_detail, service_type, description,
  site_address, site_city, site_region, estimated_value, currency,
  data_json::json->>'valueType' as value_type,
  data_json::json->>'valueFrequency' as value_frequency,
  data_json::json->>'origin' as origin,
  status, disposition_reason, duplicate_of_lead_id, nurture_until,
  owner_email, sales_owner_email, account_id, contact_id, deal_id,
  score, verdict, analysed_at,
  arrived_at, first_response_due_at, reviewed_at, first_contact_at,
  qualification_due_at, qualified_at, assignment_due_at, assigned_at,
  converted_at, closed_at, created_at, updated_at`;

export function getLead(id: string): Lead | null {
  return one<Lead>(`select ${COLUMNS} from fl_lead where id = $1 limit 1`, [id]);
}

function requireLead(id: string): Lead {
  const lead = getLead(id);
  if (!lead) throw new Error(`lead ${id} not found`);
  return lead;
}

// --- dedup ------------------------------------------------------------------

export interface DuplicateMatch {
  id: string;
  refNo: string;
  companyName: string | null;
  status: string;
  matchedOn: "email" | "phone" | "domain";
}

/**
 * Find an existing lead that looks like the same enquiry. Ordered by confidence:
 * an email match is stronger evidence than a shared company domain.
 *
 * Both terminal states are excluded as match targets, for different reasons:
 *   - `closed` — a company rejected months ago can enquire again and deserves a
 *     fresh lead.
 *   - `converted` — an existing customer's next job is a second enquiry, not a
 *     duplicate of the first. Auto-closing it would leave the repeat business
 *     with nowhere to go. `convert` attaches that lead to the account we already
 *     have, so this produces a new deal rather than a second account.
 */
export function findDuplicate(keys: {
  emailNorm: string | null;
  phoneNorm: string | null;
  domainNorm: string | null;
}): DuplicateMatch | null {
  const attempts: Array<{ column: string; value: string; matchedOn: DuplicateMatch["matchedOn"] }> = [];
  if (keys.emailNorm) attempts.push({ column: "email_norm", value: keys.emailNorm, matchedOn: "email" });
  if (keys.phoneNorm) attempts.push({ column: "phone_norm", value: keys.phoneNorm, matchedOn: "phone" });
  if (keys.domainNorm) attempts.push({ column: "domain_norm", value: keys.domainNorm, matchedOn: "domain" });

  for (const attempt of attempts) {
    const row = one<{ id: string; refNo: string; companyName: string | null; status: string }>(
      `select id, ref_no, company_name, status
         from fl_lead
        where ${attempt.column} = $1
          and status not in ('closed', 'converted')
        order by created_at
        limit 1`,
      [attempt.value]
    );
    if (row) return { ...row, matchedOn: attempt.matchedOn };
  }

  return null;
}

// --- create -----------------------------------------------------------------

export interface CreateLeadInput {
  source: LeadSource;
  sourceDetail?: string | null;
  companyName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  websiteDomain?: string | null;
  serviceType?: string | null;
  description?: string | null;
  siteAddress?: string | null;
  siteCity?: string | null;
  siteRegion?: string | null;
  estimatedValue?: number | null;
  currency?: string | null;
  /** D-05: one_off | recurring | both. Optional — the widget predates it. */
  valueType?: string | null;
  /** monthly | quarterly | annual. Required by the domain when recurring. */
  valueFrequency?: string | null;
  /** D-10: where it came from — one of LEAD_ORIGINS. */
  origin?: string | null;
  /**
   * The account this enquiry is already known to belong to, when whoever raised
   * it KNOWS — a repeat client, a new site for an existing one.
   *
   * Until this existed, `account_id` was written only by `convert`, which infers
   * the account from the company domain or the contact email. A repeat client
   * writing from a personal address, or a new site under a different contact,
   * matched neither and quietly got a SECOND account. Stated here, the guess is
   * not needed: `convert`'s findAccount already ranks `a.id = lead.account_id`
   * above both inferences, so a lead that carries one keeps it.
   */
  accountId?: string | null;
  facilioAssetId?: string | null;
  actor?: string | null;
  extra?: Record<string, unknown>;
}

export interface CreateLeadResult {
  leadId: string;
  refNo: string;
  status: LeadStatus;
  duplicateOf: DuplicateMatch | null;
}

/**
 * The single entry point for a new lead, whatever the channel.
 *
 * A duplicate still gets a row — linked and auto-closed — so source counts stay
 * honest. A company enquiring three times is itself a buying signal, and
 * throwing the second enquiry away would hide it.
 */
export function createLead(input: CreateLeadInput): CreateLeadResult {
  // D-05: a contradictory value trio is refused at the door — a recurring
  // value with no frequency would sit unanswerable in the pipeline forever.
  const valueBlock = valueFieldsBlocker(input);
  if (valueBlock) throw new Error(valueBlock);

  // D-10: origin is a controlled list or nothing — free text here would put
  // the channel/source mix right back.
  if (input.origin != null && input.origin !== "" && !isLeadOrigin(input.origin)) {
    throw new Error(`origin must be one of: ${LEAD_ORIGINS.join(", ")}`);
  }

  // A named account must EXIST. An id that resolves to nothing would leave the
  // lead pointing at no account while still outranking convert's domain and
  // email inference — the one case worse than not stating an account at all,
  // because it would suppress a match that would otherwise have been found.
  const accountId = input.accountId?.trim() || null;
  if (accountId) {
    const account = one<{ id: string }>("select id from fl_account where id = $1 limit 1", [
      accountId,
    ]);
    if (!account) throw new Error(`account ${accountId} not found`);
  }

  const now = nowIso();
  const keys = dedupKeys(input);
  const duplicate = findDuplicate(keys);

  const refNo = nextRef("lead");
  const due = dueDates(now, slaTargets());

  /**
   * A SHARED COMPANY DOMAIN IS NOT THE SAME ENQUIRY.
   *
   * `findDuplicate` tries email, then phone, then domain — and its own header
   * already says an email match is stronger evidence than a shared domain. It
   * used not to matter which one hit: any match closed the new lead. That was
   * wrong in the ordinary case. A facilities manager asks about one building in
   * March; procurement asks about another in August. Same domain, two real
   * enquiries — and the second one closed itself before anybody read it.
   *
   * So the weak signal now LINKS without closing: the lead opens as `new`, keeps
   * `duplicate_of_lead_id` so the record still shows where it came from, and a
   * person decides whether it is genuinely the same job. Email and phone still
   * auto-close, because those really are the same person writing twice.
   */
  const sameEnquiry = duplicate !== null && duplicate.matchedOn !== "domain";

  const status: LeadStatus = sameEnquiry ? "closed" : "new";
  const disposition: DispositionReason | null = sameEnquiry ? "duplicate" : null;

  const row = one<{ id: string }>(
    `insert into fl_lead (
        id, ref_no, company_name, contact_name, contact_email, contact_phone,
        website_domain, email_norm, phone_norm, domain_norm,
        source, source_detail, service_type, description,
        site_address, site_city, site_region, estimated_value, currency,
        status, disposition_reason, duplicate_of_lead_id,
        facilio_asset_id, account_id,
        arrived_at, first_response_due_at, qualification_due_at, assignment_due_at,
        closed_at, data_json, created_at, updated_at
     ) values (
        gen_random_uuid()::text, $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21,
        $22, $23,
        $24, $25, $26, $27,
        $28, $29, $24, $24
     ) returning id`,
    [
      refNo,
      input.companyName,
      input.contactName ?? null,
      input.contactEmail ?? null,
      input.contactPhone ?? null,
      input.websiteDomain ?? null,
      keys.emailNorm,
      keys.phoneNorm,
      keys.domainNorm,
      input.source,
      input.sourceDetail ?? null,
      input.serviceType ?? null,
      input.description ?? null,
      input.siteAddress ?? null,
      input.siteCity ?? null,
      input.siteRegion ?? null,
      input.estimatedValue ?? null,
      input.currency ?? null,
      status,
      disposition,
      duplicate?.id ?? null,
      input.facilioAssetId ?? null,
      accountId,
      now,
      due.firstResponseDueAt,
      due.qualificationDueAt,
      due.assignmentDueAt,
      // closed_at — set only when the lead actually closed.
      sameEnquiry ? now : null,
      // The D-05 fields ride data_json (the table's shape is permanent on this
      // platform); the read path surfaces them as first-class columns.
      JSON.stringify({
        ...(input.extra ?? {}),
        ...(input.valueType ? { valueType: input.valueType } : {}),
        ...(input.valueFrequency ? { valueFrequency: input.valueFrequency } : {}),
        ...(input.origin ? { origin: input.origin } : {}),
      }),
    ]
  );

  if (!row) throw new Error("could not create lead");

  appendEvent({
    entityType: "lead",
    entityId: row.id,
    kind: sameEnquiry ? "created.duplicate" : "created",
    actor: input.actor ?? null,
    body: sameEnquiry
      ? `Duplicate of ${duplicate?.refNo} (matched on ${duplicate?.matchedOn}) — closed automatically`
      : duplicate
        ? `Lead ${refNo} captured from ${input.source} — same company as ${duplicate.refNo} (${keys.domainNorm}), left open for a human to judge`
        : `Lead ${refNo} captured from ${input.source}`,
    meta: { source: input.source, refNo, duplicate },
  });

  return { leadId: row.id, refNo, status, duplicateOf: duplicate };
}

// --- read -------------------------------------------------------------------

export interface ListFilters {
  status?: string | null;
  ownerEmail?: string | null;
  source?: string | null;
  verdict?: string | null;
  scoreMin?: number | null;
  overdueOnly?: boolean;
  unclaimedOnly?: boolean;
  search?: string | null;
  limit: number;
  offset: number;
}

export interface LeadListRow extends Lead {
  band: string;
  sla: ReturnType<typeof slaSnapshot>;
  priority: number;
}

/**
 * The queue. Overdue is derived here rather than stored, because nothing runs in
 * the background to maintain it — scheduled jobs only fire in production.
 */
export function listLeads(filters: ListFilters): {
  leads: LeadListRow[];
  truncated: boolean;
  total: number;
} {
  const where: string[] = [];
  const params: unknown[] = [];

  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };

  if (filters.status) add("status = ?", filters.status);
  if (filters.ownerEmail) add("owner_email = ?", filters.ownerEmail);
  if (filters.source) add("source = ?", filters.source);
  if (filters.verdict) add("verdict = ?", filters.verdict);
  if (typeof filters.scoreMin === "number") add("coalesce(score, 0) >= ?", filters.scoreMin);
  // The unclaimed queue is work to be picked up, so terminal leads are excluded:
  // a closed duplicate also has no owner and would otherwise sit in the queue
  // forever. Plain `list` still returns them for browsing and history.
  if (filters.unclaimedOnly) {
    where.push("owner_email is null");
    where.push("status not in ('converted', 'closed')");
  }
  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    where.push(
      `(lower(coalesce(company_name,'')) like $${params.length}
        or lower(coalesce(contact_name,'')) like $${params.length}
        or lower(coalesce(ref_no,'')) like $${params.length})`
    );
  }

  const clause = where.length ? `where ${where.join(" and ")}` : "";

  const totalRow = one<{ c: unknown }>(`select count(*) as c from fl_lead ${clause}`, params);
  const total = Number(totalRow?.c ?? 0);

  // Overdue cannot be filtered in SQL without duplicating the domain rule, so it
  // is applied after mapping. Pull a wider page when filtering on it.
  const sqlLimit = filters.overdueOnly
    ? Math.min(500, filters.limit * 5 + filters.offset)
    : filters.limit;
  const sqlOffset = filters.overdueOnly ? 0 : filters.offset;

  const { rows, truncated } = manyWithTruncation<Lead>(
    `select ${COLUMNS} from fl_lead ${clause}
      order by coalesce(score, 0) desc, created_at desc
      limit ${sqlLimit} offset ${sqlOffset}`,
    params
  );

  const now = nowIso();
  let mapped: LeadListRow[] = rows.map((lead) => {
    const sla = slaSnapshot(lead, now);
    return {
      ...lead,
      band: scoreBand(lead.score ?? 0),
      sla,
      priority: queuePriority({ score: lead.score ?? 0, isOverdue: sla.isOverdue }),
    };
  });

  if (filters.overdueOnly) {
    mapped = mapped
      .filter((l) => l.sla.isOverdue)
      .slice(filters.offset, filters.offset + filters.limit);
  }

  mapped.sort((a, b) => b.priority - a.priority);

  return { leads: mapped, truncated, total };
}

export interface LeadDetail {
  lead: Lead;
  sla: ReturnType<typeof slaSnapshot>;
  band: string;
  analysis: Record<string, unknown> | null;
  timeline: ReturnType<typeof timeline>;
  assignments: Array<Record<string, unknown>>;
  duplicates: Array<{ id: string; refNo: string; createdAt: string; matchedOn: "email" | "phone" | "domain" | null }>;
  /** The newest run of each agent that reads a lead. */
  assessments: Assessment[];
}

/**
 * The whole lead view in ONE database call.
 *
 * This used to be five calls — lead, analysis, assignments, duplicates, timeline
 * — which read naturally but cost five times the only thing that actually costs
 * anything here. A `query()` call carries ~194ms of fixed bridge overhead on the
 * deployed app regardless of what it asks for (see shared/db.ts), so five
 * trivial lookups cost ~970ms while one compound lookup costs ~194ms.
 *
 * Each result set is a `row_to_json` / `json_agg` subquery aliased `_obj` / `_arr`,
 * which shared/row-map.ts unpacks back into nested camelCase. `json_agg` is given
 * an explicit ORDER BY as well as the inner `order by ... limit`: the inner one
 * picks WHICH rows, the outer one guarantees the order they arrive in.
 *
 * The top-level select has no FROM, so it always returns exactly one row — a
 * missing lead shows up as a null `lead_obj`, not as an empty result.
 */
export function leadDetail(id: string): LeadDetail {
  const row = one<{
    lead: Lead | null;
    analysis: Record<string, unknown> | null;
    assignments: Array<Record<string, unknown>>;
    duplicates: Array<{ id: string; refNo: string; createdAt: string; matchedOn: "email" | "phone" | "domain" | null }>;
    timeline: ReturnType<typeof timeline>;
    assessments: unknown;
  }>(
    `select
       (select row_to_json(x) from (
          select ${COLUMNS} from fl_lead where id = $1
        ) x) as lead_obj,

       (select row_to_json(x) from (
          select id, version, verdict, score, understanding_json, relevance_json,
                 reasons_json, recommendation_json, model_name, prompt_version, created_at
            from fl_lead_analysis
           where lead_id = $1
           order by version desc
           limit 1
        ) x) as analysis_obj,

       (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
          select id, from_user, to_user, role, reason, actor, created_at
            from fl_lead_assignment
           where lead_id = $1
           order by created_at desc
           limit 50
        ) x) as assignments_arr,

       (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
          select d.id, d.ref_no, d.created_at,
                 -- WHY it merged, recomputed from the norm keys in the same
                 -- confidence order findDuplicate matches in (email > phone >
                 -- domain). Recomputed rather than stored: the match reason
                 -- only lives in an event body string, and comparing the keys
                 -- is the same logic that made the match. Null when an edit
                 -- since the merge broke the key equality.
                 case
                   when d.email_norm is not null and d.email_norm = p.email_norm then 'email'
                   when d.phone_norm is not null and d.phone_norm = p.phone_norm then 'phone'
                   when d.domain_norm is not null and d.domain_norm = p.domain_norm then 'domain'
                 end as matched_on
            from fl_lead d
            join fl_lead p on p.id = $1
           where d.duplicate_of_lead_id = $1
           order by d.created_at desc
           limit 50
        ) x) as duplicates_arr,

       (select coalesce(json_agg(x order by x.occurred_at desc), '[]'::json) from (
          select id, kind, actor, body, meta_json, occurred_at
            from fl_event
           where entity_type = 'lead' and entity_id = $1
           order by occurred_at desc
           limit 100
        ) x) as timeline_arr,

       -- Rides along rather than costing its own ~194ms.
       ${assessmentSubquery("lead", "$1")} as assessments_arr`,
    [id]
  );

  const lead = row?.lead;
  if (!lead) throw new Error(`lead ${id} not found`);

  return {
    lead,
    sla: slaSnapshot(lead, nowIso()),
    band: scoreBand(lead.score ?? 0),
    analysis: row.analysis,
    timeline: row.timeline,
    assignments: row.assignments,
    duplicates: row.duplicates,
    // The lead-intelligence read. Beside the analyst's verdict above, never
    // instead of it — see modules/agent-brief.ts.
    assessments: foldLatest(row.assessments),
  };
}

// --- mutate -----------------------------------------------------------------

/** Fields a caller may edit directly. Status is deliberately absent. */
const EDITABLE: Record<string, string> = {
  companyName: "company_name",
  contactName: "contact_name",
  serviceType: "service_type",
  description: "description",
  siteAddress: "site_address",
  siteCity: "site_city",
  siteRegion: "site_region",
  estimatedValue: "estimated_value",
  currency: "currency",
  nurtureUntil: "nurture_until",
};

export function updateLead(
  id: string,
  fields: Record<string, unknown>,
  actor?: string | null
): Lead {
  const current = requireLead(id);

  const sets: string[] = [];
  const params: unknown[] = [id];

  /**
   * The D-05 pair lives in data_json (the table's shape is permanent), so it
   * is peeled off before the column loop. Validated MERGED with what the row
   * already holds — setting the frequency alone is fine when the type is
   * already recurring, and switching to one_off silently drops a frequency the
   * caller did not mention, the same way the template builder clears a stale
   * unit rather than publishing a contradiction.
   */
  const { valueType: vtIn, valueFrequency: vfIn, ...columnFields } = fields;
  if ("valueType" in fields || "valueFrequency" in fields) {
    const valueType = "valueType" in fields ? (vtIn as string | null) : current.valueType;
    let valueFrequency =
      "valueFrequency" in fields ? (vfIn as string | null) : current.valueFrequency;
    if ((valueType === null || valueType === "one_off") && !("valueFrequency" in fields)) {
      valueFrequency = null;
    }
    const blocker = valueFieldsBlocker({ valueType, valueFrequency });
    if (blocker) throw new Error(blocker);
    params.push(JSON.stringify({ valueType, valueFrequency }));
    sets.push(`data_json = (data_json::jsonb || $${params.length}::jsonb)::text`);
  }

  for (const key of Object.keys(columnFields)) {
    const column = EDITABLE[key];
    if (!column) throw new Error(`${key} is not editable (status changes go through transition)`);
    params.push(columnFields[key]);
    sets.push(`${column} = $${params.length}`);
  }

  if (!sets.length) throw new Error("no editable fields supplied");

  params.push(nowIso());
  sets.push(`updated_at = $${params.length}`);

  mutate(`update fl_lead set ${sets.join(", ")} where id = $1`, params);

  appendEvent({
    entityType: "lead",
    entityId: id,
    kind: "updated",
    actor: actor ?? null,
    body: `Updated ${Object.keys(fields).join(", ")}`,
    meta: { fields },
  });

  return requireLead(id);
}

export interface TransitionInput {
  leadId: string;
  toStatus: string;
  dispositionReason?: string | null;
  note?: string | null;
  actor?: string | null;
}

/** snake_case column -> camelCase field, for reflecting an UPDATE back onto a Lead. */
const camel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/**
 * The only path that changes status.
 *
 * `preloaded` lets a caller that already holds the lead skip the read, and the
 * returned lead is COMPUTED from the update rather than re-read. Both matter
 * because a `query()` call costs ~194ms of fixed overhead (see shared/db.ts) and
 * this used to spend four of them — read, update, event, read again — to change
 * one column.
 *
 * Computing the result is safe because the UPDATE is fully determined: the three
 * always-set columns are known, and the stamp uses `coalesce`, which is exactly
 * "keep the existing value if there is one".
 */
export function transitionLead(input: TransitionInput, preloaded?: Lead): Lead {
  const lead = preloaded ?? requireLead(input.leadId);

  const { from, to, reason } = validateTransition({
    from: lead.status,
    to: input.toStatus,
    reason: input.dispositionReason ?? undefined,
  });

  const now = nowIso();
  const sets = ["status = $2", "disposition_reason = $3", "updated_at = $4"];
  const params: unknown[] = [input.leadId, to, reason, now];

  const stamp = stampColumnFor(to);
  if (stamp) {
    params.push(now);
    sets.push(`${stamp} = coalesce(${stamp}, $${params.length})`);
  }

  // Leaving nurture drops the park date. `nurture_until` means "bring this lead
  // back on this day" — on a lead that has already come back it is an
  // instruction addressed to nobody, and the first report or job that reads the
  // column to wake parked leads would wake one that is already qualified.
  const leftNurture = from === "nurture" && to !== "nurture";
  if (leftNurture) sets.push("nurture_until = null");

  const changed = mutate(`update fl_lead set ${sets.join(", ")} where id = $1`, params);
  // A preloaded lead was read by the caller, possibly a moment ago; if it has
  // since been deleted, say so rather than returning a lead that no longer is.
  if (!changed) throw new Error(`lead ${input.leadId} not found`);

  appendEvent({
    entityType: "lead",
    entityId: input.leadId,
    kind: `status.${to}`,
    actor: input.actor ?? null,
    body: input.note ?? `${from} → ${to}${reason ? ` (${reason})` : ""}`,
    meta: { from, to, reason },
  });

  // Mirror the UPDATE onto the lead already in hand. The stamp is written through
  // an index view of the row because the column is chosen at runtime; `coalesce`
  // in the SQL means "only if unset", which is what the `if` reproduces.
  const next: Record<string, unknown> = {
    ...lead,
    status: to,
    dispositionReason: reason,
    updatedAt: now,
    // Mirrored, like every other write above: callers render from this object
    // rather than re-reading, so a value cleared in SQL and left standing here
    // would show the old park date until the next full load.
    ...(leftNurture ? { nurtureUntil: null } : {}),
  };

  if (stamp) {
    const key = camel(stamp);
    if (!next[key]) next[key] = now;
  }

  return next as unknown as Lead;
}

/** Take an unclaimed lead off the shared pile. */
export function claimLead(leadId: string, actor: string): Lead {
  const lead = requireLead(leadId);

  if (lead.ownerEmail && lead.ownerEmail !== actor) {
    throw new Error(`already claimed by ${lead.ownerEmail}`);
  }

  const now = nowIso();
  mutate(
    `update fl_lead set owner_email = $2, reviewed_at = coalesce(reviewed_at, $3), updated_at = $3
      where id = $1`,
    [leadId, actor, now]
  );

  mutate(
    `insert into fl_lead_assignment
       (id, lead_id, from_user, to_user, role, reason, actor, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, 'actioner', 'claimed from queue', $3, '{}', $4, $4)`,
    [leadId, lead.ownerEmail ?? null, actor, now]
  );

  appendEvent({
    entityType: "lead",
    entityId: leadId,
    kind: "claimed",
    actor,
    body: `Claimed by ${actor}`,
    meta: {},
  });

  // What the UPDATE above did, reflected onto the lead we already hold, so the
  // return costs no further read.
  const claimed = { ...lead, ownerEmail: actor, reviewedAt: lead.reviewedAt ?? now, updatedAt: now };

  // Claiming implies review has begun; new leads move on automatically. Passing
  // the lead we already hold saves the transition its own read.
  if (lead.status === "new") {
    return transitionLead(
      { leadId, toStatus: "in_review", actor, note: `Claimed by ${actor}` },
      claimed
    );
  }

  return claimed;
}

export interface AssignInput {
  leadId: string;
  toUser: string;
  role: "actioner" | "sales";
  reason?: string | null;
  actor?: string | null;
}

export function assignLead(input: AssignInput): Lead {
  const lead = requireLead(input.leadId);
  const now = nowIso();

  const column = input.role === "sales" ? "sales_owner_email" : "owner_email";
  const from = input.role === "sales" ? lead.salesOwnerEmail : lead.ownerEmail;

  const sets = [`${column} = $2`, "updated_at = $3"];
  const params: unknown[] = [input.leadId, input.toUser, now];

  if (input.role === "sales") {
    params.push(now);
    sets.push(`assigned_at = coalesce(assigned_at, $${params.length})`);
  }

  mutate(`update fl_lead set ${sets.join(", ")} where id = $1`, params);

  mutate(
    `insert into fl_lead_assignment
       (id, lead_id, from_user, to_user, role, reason, actor, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, '{}', $7, $7)`,
    [input.leadId, from ?? null, input.toUser, input.role, input.reason ?? null, input.actor ?? null, now]
  );

  appendEvent({
    entityType: "lead",
    entityId: input.leadId,
    kind: "assigned",
    actor: input.actor ?? null,
    body: `${input.role} → ${input.toUser}`,
    meta: { role: input.role, from, to: input.toUser, reason: input.reason ?? null },
  });

  // The two columns the UPDATE touched, reflected onto the lead already in hand.
  const next = { ...lead, updatedAt: now };
  if (input.role === "sales") {
    next.salesOwnerEmail = input.toUser;
    next.assignedAt = lead.assignedAt ?? now;
  } else {
    next.ownerEmail = input.toUser;
  }

  /**
   * Handing an actioner a NEW lead starts its review, exactly as claiming one
   * does (`claimLead` below has always done this).
   *
   * Without it, assignment produced a lead that was owned and still `new` — and
   * `movesFor` offers an owned new lead no forward move at all, so the Move-to
   * menu collapsed to "Close" and the only way on was to close the lead as lost.
   * That is what "stuck in New with one option" meant. The status is the fact
   * that was wrong; the menu was reporting it correctly.
   *
   * Only for the actioner role: a SALES owner is assigned to a lead that is
   * usually already qualified, and `new -> in_review` is not their move to make.
   */
  if (input.role === "actioner" && lead.status === "new") {
    return transitionLead(
      { leadId: input.leadId, toStatus: "in_review", actor: input.actor ?? null, note: `Assigned to ${input.toUser}` },
      next
    );
  }

  return next;
}

export interface ActivityInput {
  leadId: string;
  kind: "call" | "email" | "note" | "attachment" | "meeting";
  body: string;
  actor?: string | null;
  fileId?: number | null;
  meta?: Record<string, unknown>;
}

/**
 * Record something a human did. A call or email also satisfies the first-response
 * SLA, so it moves the lead to `contacted` when that has not happened yet.
 */
export function logActivity(input: ActivityInput): { lead: Lead; contacted: boolean } {
  const lead = requireLead(input.leadId);

  appendEvent({
    entityType: "lead",
    entityId: input.leadId,
    kind: `activity.${input.kind}`,
    actor: input.actor ?? null,
    body: input.body,
    meta: { ...(input.meta ?? {}), fileId: input.fileId ?? null },
  });

  if (input.fileId) {
    const now = nowIso();
    mutate(
      `insert into fl_photo
         (id, entity_type, entity_id, vibe_file_id, file_name, content_type, size_bytes, caption, data_json, created_at, updated_at)
       values (gen_random_uuid()::text, 'lead', $1, $2, null, null, null, $3, '{}', $4, $4)`,
      [input.leadId, input.fileId, input.body.slice(0, 200), now]
    );
  }

  const isContact = input.kind === "call" || input.kind === "email" || input.kind === "meeting";
  const canAdvance = lead.status === "in_review" || lead.status === "nurture";

  if (isContact && canAdvance) {
    return {
      lead: transitionLead(
        {
          leadId: input.leadId,
          toStatus: "contacted",
          actor: input.actor,
          note: `First contact logged: ${input.kind}`,
        },
        lead
      ),
      contacted: true,
    };
  }

  // Still stamp first contact even if the status does not move.
  if (isContact && !lead.firstContactAt) {
    const now = nowIso();
    mutate("update fl_lead set first_contact_at = $2, updated_at = $2 where id = $1", [
      input.leadId,
      now,
    ]);
    return { lead: { ...lead, firstContactAt: now, updatedAt: now }, contacted: false };
  }

  // Nothing on fl_lead changed — a note or an attachment only appends an event.
  return { lead, contacted: false };
}
