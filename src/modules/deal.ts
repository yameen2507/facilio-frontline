/**
 * The deal aggregate — the sales lifecycle a qualified lead converts into.
 *
 * Two invariants, mirroring the lead module:
 *   - convert.ts is the ONLY creator of fl_deal rows. A deal without a lead
 *     behind it has no account, no dedup history and no timeline root.
 *   - `transitionDeal` is the ONLY path that changes stage, validated against
 *     the state machine in domain/deal-state.ts. Won/lost leave via
 *     `reopenDeal` alone.
 *
 * Everything deal.md tracks per stage that has no column rides in `data_json`
 * under a named section (discovery, negotiation, decision, won, lost) — the
 * fl_deal shape is frozen (ARCHITECTURE.md §3a), and per-stage capture is
 * exactly the kind of field set that grows after the fact.
 */

import { many, mutate, nowIso, one } from "../shared/db";
import { appendEvent, timeline } from "../shared/events";
import { queueClientSync } from "./account";
import { assessmentSubquery, foldLatest, type Assessment } from "./assessment";
import { queueContractSync } from "./sync";
import {
  ACTIVE_STAGES,
  allowedNext,
  canTransition,
  type DealStage,
  isTerminal,
  type LostReason,
  STAGE_LABEL,
  validateReopen,
  validateTransition,
} from "../domain/deal-state";

export interface Deal {
  id: string;
  refNo: string;
  leadId: string | null;
  accountId: string | null;
  contactId: string | null;
  title: string | null;
  stage: DealStage;
  estimatedValue: number | null;
  currency: string | null;
  /** D-05, carried from the lead at convert: one_off | recurring | both. */
  valueType: string | null;
  /** monthly | quarterly | annual — present exactly when the value recurs. */
  valueFrequency: string | null;
  salesOwnerEmail: string | null;
  source: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS = `id, ref_no, lead_id, account_id, contact_id, title, stage,
  estimated_value, currency, sales_owner_email, source,
  data_json::json->>'valueType' as value_type,
  data_json::json->>'valueFrequency' as value_frequency,
  won_at, lost_at, lost_reason, data_json, created_at, updated_at`;

/**
 * Rows written before this module existed carry the legacy stage 'open'
 * (convert.ts's original placeholder). Normalised at every read so the state
 * machine never sees it; migrate `deal-stages` rewrites the stored rows.
 */
const normalizeStage = (stage: unknown): DealStage =>
  stage === "open" ? "opportunity" : (stage as DealStage);

const mapDeal = <T extends { stage: unknown }>(deal: T): T & { stage: DealStage } => ({
  ...deal,
  stage: normalizeStage(deal.stage),
});

export function getDeal(id: string): Deal | null {
  const row = one<Deal>(`select ${COLUMNS} from fl_deal where id = $1 limit 1`, [id]);
  return row ? mapDeal(row) : null;
}

function requireDeal(id: string): Deal {
  const deal = getDeal(id);
  if (!deal) throw new Error(`deal ${id} not found`);
  return deal;
}

// --- read -------------------------------------------------------------------

export interface DealListFilters {
  stage?: string | null;
  salesOwnerEmail?: string | null;
  accountId?: string | null;
  openOnly?: boolean;
  search?: string | null;
  limit: number;
  offset: number;
}

export interface DealListRow extends Deal {
  accountName: string | null;
  leadRefNo: string | null;
}

export function listDeals(filters: DealListFilters): {
  deals: DealListRow[];
  total: number;
} {
  const where: string[] = [];
  const params: unknown[] = [];

  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };

  if (filters.stage) {
    // 'opportunity' must also find pre-module rows still stored as 'open'.
    if (filters.stage === "opportunity") {
      where.push("d.stage in ('opportunity', 'open')");
    } else {
      add("d.stage = ?", filters.stage);
    }
  }
  if (filters.salesOwnerEmail) add("d.sales_owner_email = ?", filters.salesOwnerEmail);
  if (filters.accountId) add("d.account_id = ?", filters.accountId);
  if (filters.openOnly) where.push("d.stage not in ('won', 'lost')");
  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    where.push(
      `(lower(coalesce(d.title,'')) like $${params.length}
        or lower(coalesce(d.ref_no,'')) like $${params.length}
        or lower(coalesce(a.name,'')) like $${params.length})`
    );
  }

  const clause = where.length ? `where ${where.join(" and ")}` : "";
  const joins = `from fl_deal d
    left join fl_account a on a.id = d.account_id
    left join fl_lead l on l.id = d.lead_id`;

  const totalRow = one<{ c: unknown }>(`select count(*) as c ${joins} ${clause}`, params);

  const rows = many<DealListRow>(
    `select d.id, d.ref_no, d.lead_id, d.account_id, d.contact_id, d.title, d.stage,
            d.estimated_value, d.currency, d.sales_owner_email, d.source,
            d.data_json::json->>'valueType' as value_type,
            d.data_json::json->>'valueFrequency' as value_frequency,
            d.won_at, d.lost_at, d.lost_reason, d.data_json, d.created_at, d.updated_at,
            a.name as account_name, l.ref_no as lead_ref_no
       ${joins} ${clause}
      order by d.updated_at desc
      limit ${filters.limit} offset ${filters.offset}`,
    params
  );

  return { deals: rows.map(mapDeal), total: Number(totalRow?.c ?? 0) };
}

/** Counts and value by stage — the pipeline header, one query. */
export function pipelineSummary(): Array<{
  stage: DealStage;
  label: string;
  count: number;
  estimatedValue: number;
}> {
  const rows = many<{ stage: string; c: unknown; value: unknown }>(
    `select stage, count(*) as c, coalesce(sum(estimated_value), 0) as value
       from fl_deal group by stage`
  );

  const byStage = new Map<DealStage, { count: number; estimatedValue: number }>();
  for (const row of rows) {
    const stage = normalizeStage(row.stage);
    const at = byStage.get(stage) ?? { count: 0, estimatedValue: 0 };
    at.count += Number(row.c ?? 0);
    at.estimatedValue += Number(row.value ?? 0);
    byStage.set(stage, at);
  }

  return [...byStage.entries()].map(([stage, v]) => ({
    stage,
    label: STAGE_LABEL[stage],
    ...v,
  }));
}

export interface DealDetail {
  deal: Deal;
  allowedNext: readonly DealStage[];
  account: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
  lead: Record<string, unknown> | null;
  surveys: Array<Record<string, unknown>>;
  proposals: Array<Record<string, unknown>>;
  timeline: ReturnType<typeof timeline>;
  /** The newest run of each agent that reads a deal. */
  assessments: Assessment[];
}

/**
 * The whole deal view in ONE database call — same shape and same reason as
 * leadDetail: every `query()` costs ~194ms of fixed bridge overhead, so the
 * seven reads this view needs are batched into row_to_json/json_agg subqueries.
 */
export function dealDetail(id: string): DealDetail {
  const row = one<{
    deal: Deal | null;
    account: Record<string, unknown> | null;
    contact: Record<string, unknown> | null;
    lead: Record<string, unknown> | null;
    surveys: Array<Record<string, unknown>>;
    proposals: Array<Record<string, unknown>>;
    timeline: ReturnType<typeof timeline>;
    assessments: unknown;
  }>(
    `select
       (select row_to_json(x) from (
          select ${COLUMNS} from fl_deal where id = $1
        ) x) as deal_obj,

       (select row_to_json(x) from (
          select a.id, a.name, a.email, a.phone, a.website_domain,
                 a.facilio_client_id, a.sync_status
            from fl_account a join fl_deal d on d.account_id = a.id
           where d.id = $1
        ) x) as account_obj,

       (select row_to_json(x) from (
          select c.id, c.name, c.email, c.phone, c.is_primary
            from fl_account_contact c join fl_deal d on d.contact_id = c.id
           where d.id = $1
        ) x) as contact_obj,

       (select row_to_json(x) from (
          select l.id, l.ref_no, l.company_name, l.contact_name, l.contact_email,
                 l.contact_phone, l.source, l.source_detail, l.service_type,
                 l.description, l.site_address, l.site_city, l.site_region,
                 l.score, l.verdict
            from fl_lead l join fl_deal d on d.lead_id = l.id
           where d.id = $1
        ) x) as lead_obj,

       (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
          select id, ref_no, title, status, target_completion_date,
                 completeness_pct, revision_no, created_at
            from fl_survey
           where deal_id = $1
           order by created_at desc
           limit 50
        ) x) as surveys_arr,

       (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
          select id, ref_no, title, status, revision_no, parent_proposal_id,
                 total_one_time, total_recurring_monthly, currency, valid_until,
                 sent_at, decision, created_at
            from fl_proposal
           where deal_id = $1
           order by created_at desc
           limit 50
        ) x) as proposals_arr,

       (select coalesce(json_agg(x order by x.occurred_at desc), '[]'::json) from (
          select id, kind, actor, body, meta_json, occurred_at
            from fl_event
           where entity_type = 'deal' and entity_id = $1
           order by occurred_at desc
           limit 100
        ) x) as timeline_arr,

       -- Rides along rather than costing its own ~194ms.
       ${assessmentSubquery("deal", "$1")} as assessments_arr`,
    [id]
  );

  const deal = row?.deal;
  if (!deal) throw new Error(`deal ${id} not found`);

  const mapped = mapDeal(deal);
  return {
    deal: mapped,
    allowedNext: allowedNext(mapped.stage),
    account: row.account,
    contact: row.contact,
    lead: row.lead,
    surveys: row.surveys,
    proposals: row.proposals,
    timeline: row.timeline,
    // Advisory only — no assessment has moved this deal's stage.
    assessments: foldLatest(row.assessments),
  };
}

// --- mutate -----------------------------------------------------------------

/** Fields a caller may edit directly. Stage is deliberately absent. */
const EDITABLE: Record<string, string> = {
  title: "title",
  estimatedValue: "estimated_value",
  currency: "currency",
  salesOwnerEmail: "sales_owner_email",
};

export function updateDeal(
  id: string,
  fields: Record<string, unknown>,
  actor?: string | null
): Deal {
  requireDeal(id);

  const sets: string[] = [];
  const params: unknown[] = [id];

  for (const key of Object.keys(fields)) {
    const column = EDITABLE[key];
    if (!column) throw new Error(`${key} is not editable (stage changes go through transition)`);
    params.push(fields[key]);
    sets.push(`${column} = $${params.length}`);
  }

  if (!sets.length) throw new Error("no editable fields supplied");

  params.push(nowIso());
  sets.push(`updated_at = $${params.length}`);

  mutate(`update fl_deal set ${sets.join(", ")} where id = $1`, params);

  appendEvent({
    entityType: "deal",
    entityId: id,
    kind: "updated",
    actor: actor ?? null,
    body: `Updated ${Object.keys(fields).join(", ")}`,
    meta: { fields },
  });

  return requireDeal(id);
}

/**
 * The per-stage capture sections deal.md tracks that have no column. Each is
 * stored WHOLE under data_json.<section> — the same ride-whole convention as
 * fl_role's permission matrix — so the field set can grow without a migration.
 */
export const CAPTURE_SECTIONS = [
  "discovery", // requirements, sites, frequency, decision makers, budget…
  "negotiation", // objections, competitor intel, scope/commercial changes
  "decision", // expected date, decision maker, outstanding questions
  "won", // final value, contract dates, signed document, handover notes
  "lost", // the full lost-analysis field set (post-hoc enrichment)
] as const;
export type CaptureSection = (typeof CAPTURE_SECTIONS)[number];

/**
 * Merge (not replace) a capture section, so two edits to different fields of
 * the discovery sheet never clobber each other. Values explicitly set to null
 * clear a field.
 */
export function captureDeal(input: {
  dealId: string;
  section: CaptureSection;
  values: Record<string, unknown>;
  actor?: string | null;
}): Deal {
  const deal = requireDeal(input.dealId);

  if (!Object.keys(input.values).length) throw new Error("nothing to capture");

  const data = { ...(deal.data ?? {}) };
  const section = {
    ...((data[input.section] as Record<string, unknown>) ?? {}),
    ...input.values,
  };
  for (const key of Object.keys(section)) {
    if (section[key] === null) delete section[key];
  }
  data[input.section] = section;

  const now = nowIso();
  mutate("update fl_deal set data_json = $2, updated_at = $3 where id = $1", [
    input.dealId,
    JSON.stringify(data),
    now,
  ]);

  appendEvent({
    entityType: "deal",
    entityId: input.dealId,
    kind: `capture.${input.section}`,
    actor: input.actor ?? null,
    body: `Captured ${input.section}: ${Object.keys(input.values).join(", ")}`,
    meta: { section: input.section, fields: Object.keys(input.values) },
  });

  return { ...deal, data, updatedAt: now };
}

export interface DealTransitionInput {
  dealId: string;
  toStage: string;
  /** Required when losing. */
  lostReason?: string | null;
  /**
   * Extra capture carried WITH the stage change — the lost-analysis sheet on a
   * loss, the final commercials on a win. Stored under data_json.lost / .won.
   */
  capture?: Record<string, unknown> | null;
  note?: string | null;
  actor?: string | null;
}

/**
 * The only path that changes stage. Won stamps won_at; lost stamps lost_at,
 * lost_reason and the analysis sheet; both record the stage they closed FROM so
 * `reopenDeal` can put the conversation back where it stopped.
 */
export function transitionDeal(input: DealTransitionInput): Deal {
  const deal = requireDeal(input.dealId);

  const { from, to, lostReason } = validateTransition({
    from: deal.stage,
    to: input.toStage,
    lostReason: input.lostReason ?? undefined,
  });

  const now = nowIso();
  const data = { ...(deal.data ?? {}) };

  const sets = ["stage = $2", "updated_at = $3"];
  const params: unknown[] = [input.dealId, to, now];

  if (to === "won" || to === "lost") {
    data.closedFromStage = from;
    const section = { ...((data[to] as Record<string, unknown>) ?? {}), ...(input.capture ?? {}) };
    if (to === "lost") section.lostStage = from;
    data[to] = section;

    params.push(now);
    sets.push(`${to}_at = $${params.length}`);
    if (to === "lost") {
      params.push(lostReason);
      sets.push(`lost_reason = $${params.length}`);
    }
  } else if (input.capture && Object.keys(input.capture).length) {
    throw new Error("capture only travels with won/lost — use capture for working stages");
  }

  params.push(JSON.stringify(data));
  sets.push(`data_json = $${params.length}`);

  const changed = mutate(`update fl_deal set ${sets.join(", ")} where id = $1`, params);
  if (!changed) throw new Error(`deal ${input.dealId} not found`);

  appendEvent({
    entityType: "deal",
    entityId: input.dealId,
    kind: `stage.${to}`,
    actor: input.actor ?? null,
    body: input.note ?? `${STAGE_LABEL[from]} → ${STAGE_LABEL[to]}${lostReason ? ` (${lostReason})` : ""}`,
    meta: { from, to, lostReason },
  });

  // A won deal is Operations' cue to onboard (deal.md 9A). Its own event keeps
  // the handover queue a timeline query instead of a new table.
  if (to === "won") {
    appendEvent({
      entityType: "deal",
      entityId: input.dealId,
      kind: "handover.pending",
      actor: input.actor ?? null,
      body: "Won — ready for operations handover",
      meta: { from },
    });

    /**
     * F-08: the Facilio client is created when the deal is WON — the moment
     * the company becomes a client in fact — not at convert, which minted
     * clients for pursuits that then died. Try/caught like every stage hook:
     * a queueing hiccup must never fail the win itself, and the queue is
     * re-runnable from the account or a later drain anyway.
     */
    if (deal.accountId) {
      try {
        const { queued } = queueClientSync(deal.accountId, input.actor ?? null);
        if (queued.length) {
          appendEvent({
            entityType: "account",
            entityId: deal.accountId,
            kind: "sync.queued",
            actor: input.actor ?? null,
            body: `Client sync queued on winning ${deal.refNo}`,
            meta: { queued, dealId: input.dealId },
          });
        }
      } catch (e) {
        appendEvent({
          entityType: "deal",
          entityId: input.dealId,
          kind: "sync.queue_failed",
          actor: input.actor ?? null,
          body: `Client sync could not be queued: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      // The contract rides the same outbox, from the accepted proposal. Its
      // tasks defer in the drain until the client and a site exist in Facilio,
      // so queueing order here carries no ordering burden.
      try {
        const { queued, reason } = queueContractSync(input.dealId);
        if (queued.length) {
          appendEvent({
            entityType: "deal",
            entityId: input.dealId,
            kind: "sync.queued",
            actor: input.actor ?? null,
            body: `Contract sync queued on winning ${deal.refNo} (${queued.length} task(s))`,
            meta: { queued },
          });
        } else if (reason) {
          appendEvent({
            entityType: "deal",
            entityId: input.dealId,
            kind: "sync.queued",
            actor: input.actor ?? null,
            body: `Contract not queued: ${reason}`,
            meta: { reason },
          });
        }
      } catch (e) {
        appendEvent({
          entityType: "deal",
          entityId: input.dealId,
          kind: "sync.queue_failed",
          actor: input.actor ?? null,
          body: `Contract sync could not be queued: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  return {
    ...deal,
    stage: to,
    data,
    updatedAt: now,
    wonAt: to === "won" ? now : deal.wonAt,
    lostAt: to === "lost" ? now : deal.lostAt,
    lostReason: to === "lost" ? (lostReason as LostReason) : deal.lostReason,
  };
}

/**
 * The deliberate door out of won/lost (deal.md: terminal unless an authorized
 * user reopens). Authorisation is client-asserted like every actor here — the
 * runtime passes no caller identity — so the gate is the UI's `can()`; this
 * records WHO for the audit trail. The lost analysis is kept, appended to
 * data_json.lostHistory, because losing twice is exactly the pattern the
 * analytics want to see.
 */
export function reopenDeal(input: { dealId: string; actor: string; note?: string | null }): Deal {
  const deal = requireDeal(input.dealId);
  const data = { ...(deal.data ?? {}) };

  const backTo = validateReopen(deal.stage, data.closedFromStage);
  const wasLost = deal.stage === "lost";

  if (wasLost && data.lost) {
    data.lostHistory = [...((data.lostHistory as unknown[]) ?? []), { ...(data.lost as object), lostAt: deal.lostAt }];
    delete data.lost;
  }
  delete data.closedFromStage;

  const now = nowIso();
  mutate(
    `update fl_deal set stage = $2, won_at = null, lost_at = null, lost_reason = null,
            data_json = $3, updated_at = $4
      where id = $1`,
    [input.dealId, backTo, JSON.stringify(data), now]
  );

  appendEvent({
    entityType: "deal",
    entityId: input.dealId,
    kind: "reopened",
    actor: input.actor,
    body: input.note ?? `Reopened from ${deal.stage} back to ${STAGE_LABEL[backTo]}`,
    meta: { from: deal.stage, to: backTo },
  });

  return {
    ...deal,
    stage: backTo,
    wonAt: null,
    lostAt: null,
    lostReason: null,
    data,
    updatedAt: now,
  };
}

/**
 * Forward-only auto-advance for touchpoints (a survey raised, a proposal sent).
 * A no-op — never an error — when the deal is already there, already past it,
 * terminal, or the move is otherwise illegal: a hook must never block the
 * operation that fired it.
 */
export function advanceDealTo(
  dealId: string,
  stage: DealStage,
  actor?: string | null,
  note?: string | null
): boolean {
  try {
    const deal = getDeal(dealId);
    if (!deal) return false;
    // Strictly forward: a revised proposal re-sent from decision_pending must not
    // drag the deal back to proposal_submitted just because that move is legal.
    const forward = ACTIVE_STAGES.indexOf(stage) > ACTIVE_STAGES.indexOf(deal.stage);
    if (isTerminal(stage) || !forward || !canTransition(deal.stage, stage)) return false;

    transitionDeal({ dealId, toStage: stage, actor: actor ?? null, note: note ?? null });
    return true;
  } catch {
    // The survey or proposal write already landed; a failed ride-along stage
    // nudge is a stale pipeline column, not a reason to report that write failed.
    return false;
  }
}
