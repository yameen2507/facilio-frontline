/**
 * The survey record — create, list, read, schedule, transition. The DESK slice
 * of Backend Plan §7.2; the walk (`walk`/`capture`), nodes, reconciliation and
 * submit are the next slice and deliberately absent here.
 *
 * Two design facts every function below leans on:
 *
 *  1. `fl_survey.lead_assignee_id` is the single source of truth for who leads
 *     (X1) — `fl_survey_assignee.is_lead` is reserved and never read. With no
 *     assign handler in this slice the lead is simply null, and lead-only
 *     transitions are therefore unreachable — correct, not a gap.
 *  2. The T2 snapshot (modules/snapshot.ts) runs on EVERY schedule call, not
 *     just the first: it is idempotent, and re-running it is what repairs a
 *     half-finished copy on a platform with no transactions.
 */

import {
  completenessPct,
  notVisitedPct,
  reviewGuard,
  submitGuard,
  type CompletenessSettings,
  type GuardResult,
  type SurveyCounts,
} from "../domain/survey-completeness";
import {
  incrementsRework,
  siteSelectionBlocker,
  stampColumnsFor,
  SURVEY_STATUSES,
  validateSurveyTransition,
  type SurveyStatus,
} from "../domain/survey-state";
import {
  allowedNext as visitAllowedNext,
  canTransition as visitCanTransition,
  isVisitStatus,
  requiresReason as visitRequiresReason,
  stampColumnFor as visitStampColumnFor,
  type VisitStatus,
} from "../domain/visit-state";
import { advanceDealTo } from "./deal";
import {
  reconcile,
  type ReconcileItem,
  type ReconcileNode,
  type ReconcileObservation,
  type ReconcileRequiredAnswer,
} from "../domain/reconcile";
import { checksum, type RevisionTrigger } from "../domain/survey-revision";
// The prospect portfolio owns fl_portfolio_location. The survey lane consumes it
// through these two rather than writing the table itself, so the level rules and
// the ancestry stamp have exactly one implementation (portfolio v1.1 §5).
import { ANCESTRY_SEPARATOR } from "../domain/ancestry";
import {
  createLocation as createProspectLocation,
  listSites as listProspectSites,
} from "./prospect";
import { count, many, manyWithTruncation, mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";
import { nextRef } from "../shared/ids";
import { getSetting } from "./settings";
import { snapshotTemplate } from "./snapshot";

export interface SurveyRecord {
  id: string;
  refNo: string;
  title: string | null;
  status: SurveyStatus;
  dealId: string;
  accountId: string | null;
  accountName?: string | null;
  templateId: string | null;
  templateName?: string | null;
  templateVersionNo?: number | null;
  leadUserEmail: string | null;
  /** Joined on the list read (X-05) — the lead as a person, not an address. */
  leadUserName?: string | null;
  contractIntent: string | null;
  targetCompletionDate: string | null;
  revisionNo: number | null;
  reworkCount: number | null;
  completenessPct: number | null;
  notVisitedPct: number | null;
  notes?: string | null;
  statusChangedAt: string | null;
  createdAt: string;
  /** D-33: the earliest still-planned visit, joined on the list read. */
  nextVisitAt?: string | null;
  visitCount?: number;
  assigneeCount?: number;
}

export interface VisitRecord {
  id: string;
  surveyId: string;
  visitNumber: string;
  sequenceNo: number;
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  timezone: string | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
  meetingInstructions: string | null;
  accessInstructions: string | null;
  slotSource: string | null;
  slotGrantedBy: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  noShowReason: string | null;
  cancelReason: string | null;
}

const SURVEY_COLUMNS = `id, ref_no, title, status, deal_id, account_id, template_id,
  template_version_no, lead_assignee_id, lead_user_email, contract_intent,
  target_completion_date, revision_no, rework_count, completeness_pct, not_visited_pct,
  notes, current_revision_id, status_changed_at, created_at, updated_at`;

const VISIT_COLUMNS = `id, survey_id, visit_number, sequence_no, status, scheduled_start,
  scheduled_end, timezone, site_contact_name, site_contact_phone, site_contact_email,
  meeting_instructions, access_instructions, slot_source, slot_granted_by,
  actual_start_at, actual_end_at, no_show_reason, cancel_reason, created_at`;

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface SurveyListFilters {
  status?: string | null;
  dealId?: string | null;
  accountId?: string | null;
  leadUserEmail?: string | null;
  search?: string | null;
  limit: number;
  offset: number;
}

type RawSurveyListRow = SurveyRecord & {
  visitCount: unknown;
  assigneeCount: unknown;
  totalCount: unknown;
};

export function listSurveys(filters: SurveyListFilters): {
  surveys: SurveyRecord[];
  total: number;
  truncated: boolean;
} {
  const where: string[] = ["s.is_active = 'true'"];
  const params: unknown[] = [];

  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };

  if (filters.status) {
    if (!(SURVEY_STATUSES as readonly string[]).includes(filters.status)) {
      throw new Error(`status must be one of: ${SURVEY_STATUSES.join(", ")}`);
    }
    add("s.status = ?", filters.status);
  }
  if (filters.dealId) add("s.deal_id = ?", filters.dealId);
  if (filters.accountId) add("s.account_id = ?", filters.accountId);
  if (filters.leadUserEmail) add("s.lead_user_email = ?", filters.leadUserEmail);

  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    where.push(
      `(lower(s.ref_no) like $${params.length}
        or lower(coalesce(s.title,'')) like $${params.length}
        or exists (select 1 from fl_account a
                    where a.id = s.account_id and lower(coalesce(a.name,'')) like $${params.length}))`
    );
  }

  const clause = `where ${where.join(" and ")}`;

  const { rows, truncated } = manyWithTruncation<RawSurveyListRow>(
    `select s.id, s.ref_no, s.title, s.status, s.deal_id, s.account_id, s.template_id,
            s.lead_user_email, s.contract_intent, s.target_completion_date,
            s.revision_no, s.rework_count, s.completeness_pct, s.not_visited_pct,
            s.status_changed_at, s.created_at,
            (select a.name from fl_account a where a.id = s.account_id) as account_name,
            (select t.name from fl_form_template t where t.id = s.template_id) as template_name,
            (select u.name from fl_user u
              where u.email_norm = s.lead_user_email limit 1) as lead_user_name,
            -- D-33: the next planned visit — the one date a coordinator
            -- actually scans this list for.
            (select min(v.scheduled_start) from fl_survey_visit v
              where v.survey_id = s.id and v.is_active = 'true'
                and v.status = 'planned') as next_visit_at,
            (select count(*) from fl_survey_visit v
              where v.survey_id = s.id and v.is_active = 'true') as visit_count,
            (select count(*) from fl_survey_assignee sa
              where sa.survey_id = s.id and sa.is_active = 'true') as assignee_count,
            count(*) over () as total_count
       from fl_survey s
       ${clause}
      order by s.created_at desc
      limit ${filters.limit} offset ${filters.offset}`,
    params
  );

  const surveys: SurveyRecord[] = rows.map(({ totalCount: _t, ...row }) => ({
    ...row,
    visitCount: Number(row.visitCount ?? 0),
    assigneeCount: Number(row.assigneeCount ?? 0),
  }));

  const total = rows.length
    ? Number(rows[0].totalCount ?? 0)
    : filters.offset > 0
      ? count(`select count(*) as c from fl_survey s ${clause}`, params)
      : 0;

  return { surveys, total, truncated };
}

export interface SurveyDetail {
  survey: SurveyRecord;
  visits: VisitRecord[];
  assignees: unknown[];
  nodes: unknown[];
  reconciliation: unknown[];
  qualifications: unknown[];
  /** The audit trail — every event this module has been writing since day one. */
  events: unknown[];
  /** Evidence at the desk: every photo hanging off this survey's entities. */
  photos: unknown[];
  /** id → label for captioning photos by the room they evidence. */
  entryLabels: unknown[];
  /** Frozen revisions, newest first — what a proposal may be priced from. */
  revisions: unknown[];
  /** How much of the template the T2 snapshot copied — the walk's size. */
  snapshot: { sections: number; questions: number };
  /** What T5 and T7 would say right now — so the record page can show what is
      owed instead of letting a person discover it by being refused. */
  readiness: SurveyReadiness;
}

/**
 * The whole detail surface in ONE statement — survey, visits, assignees,
 * prospect nodes, reconciliation, qualifications and the snapshot counts.
 * Seven separate reads would cost seven times ~194ms of fixed bridge overhead.
 *
 * Nodes are read by DEAL, not by survey: the prospect tree belongs to the deal
 * (D-i) and `survey_id` only records which survey created a node.
 */
export function surveyDetail(id: string): SurveyDetail {
  const row = one<{
    survey: (SurveyRecord & { accountName?: string | null; templateName?: string | null }) | null;
    visits: VisitRecord[];
    assignees: unknown[];
    nodes: unknown[];
    reconciliation: unknown[];
    qualifications: unknown[];
    events: unknown[];
    photos: unknown[];
    entryLabels: unknown[];
    revisions: unknown[];
    sectionInstanceCount: unknown;
    questionInstanceCount: unknown;
  }>(
    `select
       (select row_to_json(x) from (
          select ${SURVEY_COLUMNS},
                 (select a.name from fl_account a where a.id = s.account_id) as account_name,
                 (select t.name from fl_form_template t where t.id = s.template_id) as template_name
            from fl_survey s where s.id = $1 and s.is_active = 'true'
        ) x) as survey_obj,

       (select coalesce(json_agg(x order by x.sequence_no), '[]'::json) from (
          select ${VISIT_COLUMNS} from fl_survey_visit
           where survey_id = $1 and is_active = 'true'
        ) x) as visits_arr,

       (select coalesce(json_agg(x order by x.assigned_at), '[]'::json) from (
          select a.id, a.user_email, a.user_id, a.participation, a.discipline_ids_json,
                 a.assigned_at,
                 (select u.name from fl_user u where u.id = a.user_id limit 1) as user_name
            from fl_survey_assignee a
           where a.survey_id = $1 and a.is_active = 'true'
        ) x) as assignees_arr,

       (select coalesce(json_agg(x order by x.ancestry_path), '[]'::json) from (
          -- Aliased back to v1.1's name on purpose. row-map.ts camelCases the
          -- COLUMN name, so a bare "area" would reach the record page as
          -- node.area and miss NUMERIC_COLUMNS' coercion — the tree renders
          -- node.areaSqft and wants a number, not a string. The alias keeps the
          -- wire contract while the read moves to the v1.3 table. floor_label
          -- is gone from v1.3 with no replacement of that meaning, so the tree
          -- simply stops carrying it.
          -- (No backticks in here: this comment lives inside a JS template
          -- literal, and one would close the string.)
          select id, name, type, parent_id, ancestry_path, verdict, verdict_note,
                 area as area_sqft, room_count, restroom_count, provenance, facilio_id
            from fl_portfolio_location
           where deal_id = (select deal_id from fl_survey where id = $1)
             and is_active = 'true'
           limit 500
        ) x) as nodes_arr,

       (select coalesce(json_agg(x), '[]'::json) from (
          select id, diff_type, prospect_node_id, field_key, rfp_value, survey_value,
                 suggested_value, suggestion_basis, decision, decision_note, status
            from fl_survey_reconciliation
           where survey_id = $1 and is_active = 'true'
           limit 500
        ) x) as reconciliation_arr,

       (select coalesce(json_agg(x), '[]'::json) from (
          select id, source, text, is_printed_on_proposal, generated_automatically
            from fl_survey_qualification
           where survey_id = $1 and is_active = 'true'
           limit 200
        ) x) as qualifications_arr,

       (select coalesce(json_agg(x order by x.occurred_at desc), '[]'::json) from (
          select id, entity_type, kind, actor, body, meta_json, occurred_at
            from fl_event
           where (entity_type = 'survey' and entity_id = $1)
              or (entity_type = 'survey_visit'
                  and entity_id in (select id from fl_survey_visit where survey_id = $1))
           order by occurred_at desc
           limit 100
        ) x) as events_arr,

       (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
          select id, entity_type, entity_id, vibe_file_id, file_name, content_type,
                 size_bytes, caption, data_json, created_at
            from fl_photo
           where (entity_type = 'survey' and entity_id = $1)
              or entity_id in (select id from fl_survey_visit where survey_id = $1)
              or entity_id in (select id from fl_survey_section_entry where survey_id = $1)
              or entity_id in (select id from fl_survey_answer where survey_id = $1)
              or entity_id in (select id from fl_survey_observation where survey_id = $1)
              or entity_id in (select id from fl_portfolio_location where survey_id = $1)
           limit 500
        ) x) as photos_arr,

       (select coalesce(json_agg(x), '[]'::json) from (
          select id, entry_label from fl_survey_section_entry
           where survey_id = $1 and is_active = 'true'
        ) x) as entry_labels_arr,

       -- What a proposal can be priced from. A frozen revision is the ONLY
       -- thing the proposal lane will accept as a survey (spec §5: "a Proposal
       -- turns a frozen survey revision into priced lines"), so the record has
       -- to be able to name them or the handoff has nothing to hand over.
       (select coalesce(json_agg(x order by x.revision_no desc), '[]'::json) from (
          select id, revision_no, frozen_at, frozen_by, checksum, trigger_kind, is_current
            from fl_survey_revision
           where survey_id = $1
           limit 50
        ) x) as revisions_arr,

       (select count(*) from fl_survey_section_instance
         where survey_id = $1 and is_active = 'true') as section_instance_count,

       (select count(*) from fl_survey_question_instance
         where survey_id = $1 and is_active = 'true') as question_instance_count`,
    [id]
  );

  const survey = row?.survey;
  if (!survey) throw new Error(`survey ${id} not found`);

  return {
    survey,
    // `visit_number` is stored, but the composition rule is `{ref}/V{seq}` —
    // recompose on read so a renumbered ref never shows a stale label.
    visits: row.visits.map((v) => ({
      ...v,
      visitNumber: v.visitNumber || `${survey.refNo}/V${v.sequenceNo}`,
    })),
    assignees: row.assignees,
    nodes: row.nodes,
    reconciliation: row.reconciliation,
    qualifications: row.qualifications,
    events: row.events,
    photos: row.photos,
    entryLabels: row.entryLabels,
    revisions: row.revisions,
    snapshot: {
      sections: Number(row.sectionInstanceCount ?? 0),
      questions: Number(row.questionInstanceCount ?? 0),
    },
    // A second query rather than seven more subqueries welded onto the one
    // above: this one is answered by counts alone and the batched read is
    // already the longest statement in the module.
    readiness: surveyReadiness(id, survey.reworkCount ?? 0),
  };
}

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreateSurveyInput {
  dealId: string;
  /** An existing site on this deal. Give this OR `siteName`, never neither. */
  prospectSiteId?: string | null;
  /** Names a new site to create on this deal, for a property we have never surveyed. */
  siteName?: string | null;
  templateId?: string | null;
  title?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  timezone?: string | null;
  targetCompletionDate?: string | null;
  actor: string | null;
}

/**
 * Every site on a deal, for the create form's picker.
 *
 * Delegates to the prospect portfolio, which owns this table — the survey lane
 * is a *consumer* of the portfolio, not a second writer of it. Deal-scoped
 * because a building bid before is copied forward into this deal
 * (`prospect.copy-forward`) rather than shared across two: a survey is a
 * point-in-time record, and that building's condition in March genuinely is not
 * its condition eighteen months later (portfolio v1.1 §5.4).
 */
export function listSitesForDeal(dealId: string) {
  return listProspectSites(dealId);
}

/**
 * Resolves the survey's site, creating one when the user named a new property.
 *
 * Both paths go through the prospect module so the level rules, the ancestry
 * stamp and the two state machines have exactly one implementation. Writing the
 * insert here instead is how the earlier version came to set `verdict = 'seeded'`
 * — a value §4.1 does not define — and to omit `pursuit_decision` and
 * `convert_state`, which §5.1 marks required.
 *
 * The site is the tree's root, which is why a survey cannot be created without
 * one: with no root, `walk.ts` has nothing to parent a discovered room to and
 * every space becomes an orphan (`F-03`).
 */
function resolveSurveySite(
  input: { dealId: string; prospectSiteId?: string | null; siteName?: string | null },
  actor: string | null
): string {
  // The pure half of the rule, so it is covered by a test rather than only by
  // clicking the dialog. See domain/survey-state.ts.
  const blocker = siteSelectionBlocker(input);
  if (blocker) throw new Error(blocker);

  if (input.prospectSiteId) {
    const site = one<{ id: string }>(
      `select id from fl_portfolio_location
        where id = $1 and deal_id = $2 and type = 'site' and is_active = 'true' limit 1`,
      [input.prospectSiteId, input.dealId]
    );
    // Scoped to the deal on purpose: a site id from another pursuit would
    // otherwise attach this survey's whole tree under someone else's property.
    if (!site) {
      throw new Error(`site ${input.prospectSiteId} is not a site on this deal`);
    }
    return site.id;
  }

  // `siteSelectionBlocker` has already established that exactly one of the two
  // was given, so reaching here means a non-blank name.
  return createProspectLocation({
    dealId: input.dealId,
    type: "site",
    name: (input.siteName ?? "").trim(),
    // A property typed into the survey form came from a person, not a document.
    provenance: "manual",
    actor,
  }).location.id;
}

/**
 * v1.7 §A1.0 + §8 C32: creating a survey asks for the deal and **the site**,
 * optionally a template, optionally a first visit date. A date fires T1+T2
 * together (visit #1 + `scheduled` + the snapshot); no date lands the survey in
 * `draft`, to be scheduled later (D-l).
 *
 * The site became mandatory at C32. Before that the form asked only for a deal,
 * so `prospect_site_id` was never written by anything — which is why the walk
 * created parentless spaces and violated C3 (`F-03`), and why the surveyor
 * arrived with no address (`P-08`).
 */
export function createSurvey(input: CreateSurveyInput): { survey: SurveyRecord } {
  const deal = one<{ id: string; accountId: string | null; title: string | null }>(
    `select id, account_id, title from fl_deal where id = $1 limit 1`,
    [input.dealId]
  );
  if (!deal) throw new Error(`deal ${input.dealId} not found`);

  let template: { id: string; name: string; status: string; versionNo: number } | null = null;
  if (input.templateId) {
    template = one(
      `select id, name, status, version_no from fl_form_template
        where id = $1 and is_active = 'true' limit 1`,
      [input.templateId]
    );
    if (!template) throw new Error(`template ${input.templateId} not found`);
    if (template.status !== "published") {
      throw new Error(`only a published template can start a survey — "${template.name}" is ${template.status}`);
    }
  }

  const now = nowIso();
  const refNo = nextRef("survey");
  const title = input.title ?? template?.name ?? deal.title ?? null;

  // Before the insert: a survey with no site is the F-03 defect, so it must not
  // be creatable even for a moment. There are no transactions here (§3a), so an
  // orphan site row from a later failure is the acceptable direction — a named
  // property with no survey is inert, a survey with no property is not.
  const prospectSiteId = resolveSurveySite(input, input.actor);

  const row = one<{ id: string }>(
    `insert into fl_survey
       (id, ref_no, deal_id, account_id, title, template_id, template_version_no,
        prospect_site_id, buildings_in_scope_json, status, status_changed_at, status_changed_by,
        disciplines_required_json, is_condition_survey_complete, target_completion_date,
        revision_no, rework_count, notes,
        created_by, updated_by, is_active, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
             $10, '[]', 'draft', $7, $8,
             '[]', 'false', $9,
             1, 0, null,
             $8, $8, 'true', '{}', $7, $7)
     returning id`,
    [
      refNo,
      deal.id,
      deal.accountId,
      title,
      template?.id ?? null,
      template?.versionNo ?? null,
      now,
      input.actor,
      input.targetCompletionDate ?? null,
      prospectSiteId,
    ]
  );
  if (!row) throw new Error("survey insert returned no row");

  appendEvent({
    entityType: "survey",
    entityId: row.id,
    kind: "created",
    actor: input.actor,
    body: refNo,
    meta: { dealId: deal.id, templateId: template?.id ?? null, prospectSiteId },
  });

  // Raising a survey IS the deal entering Survey Required (deal.md stage 3).
  // Forward-only and never throwing: a deal already estimating stays put.
  advanceDealTo(deal.id, "survey_required", input.actor, `Survey ${refNo} raised`);

  if (input.scheduledStart) {
    scheduleVisit(
      row.id,
      {
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd ?? null,
        timezone: input.timezone ?? null,
      },
      input.actor
    );
  }

  const survey = one<SurveyRecord>(
    `select ${SURVEY_COLUMNS},
            (select a.name from fl_account a where a.id = s.account_id) as account_name,
            (select t.name from fl_form_template t where t.id = s.template_id) as template_name
       from fl_survey s where s.id = $1 limit 1`,
    [row.id]
  );

  return { survey: survey as SurveyRecord };
}

// ── Schedule ──────────────────────────────────────────────────────────────────

export interface ScheduleInput {
  visitId?: string | null;
  scheduledStart: string;
  scheduledEnd?: string | null;
  timezone?: string | null;
  siteContactName?: string | null;
  siteContactPhone?: string | null;
  siteContactEmail?: string | null;
  meetingInstructions?: string | null;
  accessInstructions?: string | null;
  slotSource?: string | null;
  slotGrantedBy?: string | null;
}

/**
 * Schedule AND reschedule. On a draft survey this is T2: the status moves to
 * `scheduled` and the template snapshot is copied. The event always records
 * the old and new datetimes in its meta, because "when did the walk move" is
 * the first question a no-show dispute asks.
 */
export function scheduleVisit(
  surveyId: string,
  input: ScheduleInput,
  actor: string | null
): { visit: VisitRecord; snapshot: { sections: number; questions: number } | null } {
  const survey = one<{
    id: string;
    refNo: string;
    status: SurveyStatus;
    templateId: string | null;
    templateVersionNo: number | null;
  }>(
    `select id, ref_no, status, template_id, template_version_no
       from fl_survey where id = $1 and is_active = 'true' limit 1`,
    [surveyId]
  );
  if (!survey) throw new Error(`survey ${surveyId} not found`);
  if (survey.status === "completed" || survey.status === "cancelled") {
    throw new Error(`a ${survey.status} survey cannot be scheduled`);
  }
  if (!input.scheduledStart) throw new Error("scheduledStart is required");

  const now = nowIso();
  let visit: VisitRecord | null;

  if (input.visitId) {
    const before = one<{ scheduledStart: string | null; scheduledEnd: string | null }>(
      `select scheduled_start, scheduled_end from fl_survey_visit
        where id = $1 and survey_id = $2 and is_active = 'true' limit 1`,
      [input.visitId, surveyId]
    );
    if (!before) throw new Error(`visit ${input.visitId} not found on this survey`);

    visit = one<VisitRecord>(
      `update fl_survey_visit
          set scheduled_start = $3, scheduled_end = $4,
              timezone = coalesce($5, timezone),
              site_contact_name = coalesce($6, site_contact_name),
              site_contact_phone = coalesce($7, site_contact_phone),
              site_contact_email = coalesce($8, site_contact_email),
              meeting_instructions = coalesce($9, meeting_instructions),
              access_instructions = coalesce($10, access_instructions),
              slot_source = coalesce($11, slot_source),
              slot_granted_by = coalesce($12, slot_granted_by),
              updated_by = $13, updated_at = $14
        where id = $1 and survey_id = $2 and is_active = 'true'
        returning ${VISIT_COLUMNS}`,
      [
        input.visitId,
        surveyId,
        input.scheduledStart,
        input.scheduledEnd ?? null,
        input.timezone ?? null,
        input.siteContactName ?? null,
        input.siteContactPhone ?? null,
        input.siteContactEmail ?? null,
        input.meetingInstructions ?? null,
        input.accessInstructions ?? null,
        input.slotSource ?? null,
        input.slotGrantedBy ?? null,
        actor,
        now,
      ]
    );

    appendEvent({
      entityType: "survey_visit",
      entityId: input.visitId,
      kind: "rescheduled",
      actor,
      meta: { from: before, to: { scheduledStart: input.scheduledStart, scheduledEnd: input.scheduledEnd ?? null } },
    });
  } else {
    visit = one<VisitRecord>(
      `insert into fl_survey_visit
         (id, survey_id, visit_number, sequence_no, scheduled_start, scheduled_end, timezone,
          buildings_covered_json, site_contact_name, site_contact_phone, site_contact_email,
          meeting_instructions, access_instructions, slot_source, slot_granted_by, status,
          conflict_warnings_json, created_by, updated_by, is_active, data_json, created_at, updated_at)
       select gen_random_uuid()::text, $1,
              $2 || '/V' || next.seq, next.seq, $3, $4, $5,
              '[]', $6, $7, $8, $9, $10, $11, $12, 'planned',
              '[]', $13, $13, 'true', '{}', $14, $14
         from (select coalesce(max(sequence_no), 0) + 1 as seq
                 from fl_survey_visit where survey_id = $1 and is_active = 'true') next
       returning ${VISIT_COLUMNS}`,
      [
        surveyId,
        survey.refNo,
        input.scheduledStart,
        input.scheduledEnd ?? null,
        input.timezone ?? null,
        input.siteContactName ?? null,
        input.siteContactPhone ?? null,
        input.siteContactEmail ?? null,
        input.meetingInstructions ?? null,
        input.accessInstructions ?? null,
        input.slotSource ?? "ours",
        input.slotGrantedBy ?? null,
        actor,
        now,
      ]
    );

    appendEvent({
      entityType: "survey_visit",
      entityId: visit?.id ?? surveyId,
      kind: "scheduled",
      actor,
      meta: { to: { scheduledStart: input.scheduledStart, scheduledEnd: input.scheduledEnd ?? null } },
    });
  }

  if (!visit) throw new Error("visit write returned no row");

  // T2 — only from draft, validated by the same domain machine as everything
  // else so a forbidden move can never sneak in through scheduling.
  if (survey.status === "draft") {
    validateSurveyTransition({ from: "draft", to: "scheduled", actorIsLead: false });
    mutate(
      `update fl_survey
          set status = 'scheduled', status_changed_at = $2, status_changed_by = $3,
              updated_by = $3, updated_at = $2
        where id = $1 and status = 'draft'`,
      [surveyId, now, actor]
    );
    appendEvent({
      entityType: "survey",
      entityId: surveyId,
      kind: "status_change",
      actor,
      body: "T2: draft → scheduled",
    });
  }

  // Idempotent — re-runs repair a half-finished copy rather than duplicating.
  const snapshot = survey.templateId
    ? snapshotTemplate(surveyId, survey.templateId, survey.templateVersionNo)
    : null;

  return { visit, snapshot };
}

// ── Visit transition ─────────────────────────────────────────────────────────

/**
 * F13, the rule this handler exists to keep: a `no_show` leaves the survey
 * EXACTLY where it was. A wasted trip is a real, recurring tender event and it
 * must never read as "surveyed" — only `capture` ever moves the survey
 * forward, and only a real capture does that.
 */
export function transitionVisit(input: {
  visitId: string;
  toStatus: string;
  reason?: string | null;
  actor: string | null;
}): { visit: VisitRecord } {
  const visit = one<{ id: string; surveyId: string; status: VisitStatus; visitNumber: string }>(
    `select id, survey_id, status, visit_number
       from fl_survey_visit where id = $1 and is_active = 'true' limit 1`,
    [input.visitId]
  );
  if (!visit) throw new Error(`visit ${input.visitId} not found`);

  if (!isVisitStatus(input.toStatus)) {
    throw new Error(`unknown visit status: ${input.toStatus}`);
  }
  const to = input.toStatus;
  if (!visitCanTransition(visit.status, to)) {
    throw new Error(
      `a ${visit.status} visit cannot become ${to} (allowed: ${visitAllowedNext(visit.status).join(", ") || "nothing"})`
    );
  }

  const reason = input.reason?.trim() || null;
  if (visitRequiresReason(to) && !reason) {
    throw new Error(
      to === "no_show" ? "a no-show must say why — the reason is the record" : "cancelling a visit requires a reason"
    );
  }

  const now = nowIso();
  const sets: string[] = ["status = $2", "updated_by = $3", "updated_at = $4"];
  const params: unknown[] = [input.visitId, to, input.actor, now];

  const stamp = visitStampColumnFor(to);
  if (stamp) sets.push(`${stamp} = $4`);
  if (to === "no_show") {
    params.push(reason);
    sets.push(`no_show_reason = $${params.length}`);
  }
  if (to === "cancelled") {
    params.push(reason);
    sets.push(`cancel_reason = $${params.length}`);
  }

  // `and status = $n` closes the race, same as every transition in this app.
  params.push(visit.status);
  const updated = mutate(
    `update fl_survey_visit set ${sets.join(", ")}
      where id = $1 and status = $${params.length} and is_active = 'true'`,
    params
  );
  if (!updated) throw new Error(`visit is no longer ${visit.status} — reload and try again`);

  appendEvent({
    entityType: "survey_visit",
    entityId: input.visitId,
    kind: "status_change",
    actor: input.actor,
    body: `${visit.visitNumber}: ${visit.status} → ${to}`,
    meta: reason ? { reason } : {},
  });

  const fresh = one<VisitRecord>(
    `select ${VISIT_COLUMNS} from fl_survey_visit where id = $1 limit 1`,
    [input.visitId]
  );
  return { visit: fresh as VisitRecord };
}

// ── Editing the record ───────────────────────────────────────────────────────

/**
 * The three fields a survey's own record owns: what it is called, when it is
 * wanted by, and the desk's notes on it.
 *
 * STATUS IS NOT HERE, and the omission is the point — a status that could be
 * typed into an update is a state machine with a back door, and every guard in
 * this module would be optional. Moves go through `transition`.
 *
 * Refused once the survey is terminal: a completed survey has a frozen
 * revision quoting its title, and renaming it afterwards would make the
 * proposal and the record disagree about what was surveyed.
 */
export function updateSurvey(input: {
  surveyId: string;
  title?: string | null;
  targetCompletionDate?: string | null;
  contractIntent?: string | null;
  notes?: string | null;
  actor: string | null;
}): { survey: SurveyRecord } {
  const survey = one<{ id: string; status: SurveyStatus }>(
    `select id, status from fl_survey where id = $1 and is_active = 'true' limit 1`,
    [input.surveyId]
  );
  if (!survey) throw new Error(`survey ${input.surveyId} not found`);
  if (survey.status === "completed" || survey.status === "cancelled") {
    throw new Error(`a ${survey.status} survey is a closed record and cannot be edited`);
  }

  const now = nowIso();
  const sets: string[] = ["updated_by = $2", "updated_at = $3"];
  const params: unknown[] = [input.surveyId, input.actor, now];

  // Each field is applied only when SUPPLIED, so a dialog that edits one thing
  // cannot blank the two it never showed. An explicit empty string still
  // clears — that is a person deleting a value, which is different from a
  // caller not mentioning it.
  const put = (column: string, value: string | null | undefined) => {
    if (value === undefined) return;
    params.push(value === null || value.trim() === "" ? null : value.trim());
    sets.push(`${column} = $${params.length}`);
  };

  put("title", input.title);
  put("target_completion_date", input.targetCompletionDate);
  put("contract_intent", input.contractIntent);
  put("notes", input.notes);

  if (sets.length === 2) throw new Error("nothing to update");

  mutate(
    `update fl_survey set ${sets.join(", ")} where id = $1 and is_active = 'true'`,
    params
  );

  appendEvent({
    entityType: "survey",
    entityId: input.surveyId,
    kind: "updated",
    actor: input.actor,
    body: "record edited",
  });

  const fresh = one<SurveyRecord>(
    `select ${SURVEY_COLUMNS},
            (select a.name from fl_account a where a.id = s.account_id) as account_name,
            (select t.name from fl_form_template t where t.id = s.template_id) as template_name
       from fl_survey s where s.id = $1 limit 1`,
    [input.surveyId]
  );

  return { survey: fresh as SurveyRecord };
}

// ── Qualifications ───────────────────────────────────────────────────────────

/**
 * The exclusions that print on the proposal, derived from what the survey could
 * NOT establish.
 *
 * A qualification is how the survey says "we are not pricing this, and here is
 * why" — and it is the difference between a quote that is silent about the
 * rooftop nobody could reach and one that excludes it in writing. `proposal.ts`
 * renders this list straight onto the document, which is why it is generated
 * into the FROZEN revision rather than computed at print time: what the client
 * was told has to be what the record says they were told.
 *
 * TWO SOURCES, both of them things the survey already knows:
 *   not_visited_node     a seeded node nobody reached
 *   unanswered_question  a required question left blank
 *
 * REGENERATED, NOT ACCUMULATED. Every automatic row is cleared and rebuilt, so
 * a rework bounce that fixes a gap also removes the exclusion it caused —
 * otherwise a survey would carry the ghost of every problem it ever had.
 * Hand-written qualifications are never touched: `generated_automatically`
 * exists exactly to tell the two apart.
 */
function generateQualifications(surveyId: string, actor: string | null): number {
  const now = nowIso();

  // Retired, not deleted — soft like every other removal in this module. A
  // survey that bounced for rework and came back should still be able to show
  // what it used to exclude and when that stopped being true; a hard delete
  // would make the exclusion history end at the last freeze. Rows the current
  // pass still wants are switched back on below.
  mutate(
    `update fl_survey_qualification
        set is_active = 'false', updated_at = $2
      where survey_id = $1 and generated_automatically = 'true' and is_active = 'true'`,
    [surveyId, now]
  );

  const rows = many<{ source: string; refId: string | null; text: string }>(
    `select 'not_visited_node' as source, n.id as ref_id,
            'The ' || n.name || ' was not accessible during the walk and is excluded from this proposal.' as text
       from fl_portfolio_location n
      where n.deal_id = (select deal_id from fl_survey where id = $1)
        and n.is_active = 'true' and n.provenance in ('rfp', 'crm')
        and n.verdict in ('not_visited', 'not_found')
      limit 200`,
    [surveyId]
  ).concat(
    many<{ source: string; refId: string | null; text: string }>(
      `select 'unanswered_question' as source, q.id as ref_id,
              '"' || q.label || '" was not established during the walk; anything depending on it is excluded pending a further survey.' as text
         from fl_survey_question_instance q
        where q.survey_id = $1 and q.is_active = 'true' and q.is_required = 'true'
          and not exists (
            select 1 from fl_survey_answer a
             where a.question_instance_id = q.id and a.is_active = 'true'
               and (a.is_na = 'true'
                    or coalesce(a.value_text, '') <> ''
                    or a.value_number is not null
                    or a.value_date is not null
                    or coalesce(a.value_bool, '') <> ''
                    or coalesce(a.value_json, '') not in ('', '[]', '{}', 'null')))
        limit 200`,
      [surveyId]
    )
  );

  let written = 0;
  for (const row of rows) {
    const params = [
      `qual:${surveyId}:${row.source}:${row.refId ?? "-"}`,
      surveyId,
      row.source,
      row.refId,
      row.text,
      actor,
      now,
    ];

    // Switch a previously-retired row back on rather than inserting beside it:
    // the id is derived from (survey, source, subject), so the row that
    // excluded THIS node last time is the row that should exclude it now.
    const revived = mutate(
      `update fl_survey_qualification
          set text = $5, is_active = 'true', updated_by = $6, updated_at = $7
        where id = md5($1)::uuid::text and survey_id = $2 and source = $3
          and generated_automatically = 'true'
          and source_ref_id is not distinct from $4`,
      params
    );

    written +=
      revived ||
      mutate(
        `insert into fl_survey_qualification
           (id, survey_id, source, source_ref_id, text, is_printed_on_proposal,
            generated_automatically, created_by, updated_by, is_active, data_json,
            created_at, updated_at)
         select md5($1)::uuid::text, $2, $3, $4, $5, 'true', 'true', $6, $6, 'true', '{}', $7, $7
          where not exists (
            select 1 from fl_survey_qualification where id = md5($1)::uuid::text)`,
        params
      );
  }

  return written;
}

/**
 * A qualification somebody typed. Never regenerated, never cleared by a
 * re-freeze — `generated_automatically = 'false'` is what protects it.
 */
export function addQualification(input: {
  surveyId: string;
  text: string;
  actor: string | null;
}): { qualifications: unknown[] } {
  const text = (input.text ?? "").trim();
  if (!text) throw new Error("a qualification needs its wording");

  const now = nowIso();
  const params = [`qual:${input.surveyId}:manual:${text}`, input.surveyId, text, input.actor, now];

  // Idempotent by WORDING, like every other derived-id write in this module.
  // Adding the same sentence twice is a double-click, not two exclusions, and
  // the same statement brings back one that was withdrawn and typed again.
  const revived = mutate(
    `update fl_survey_qualification
        set text = $3, is_active = 'true', updated_by = $4, updated_at = $5
      where id = md5($1)::uuid::text and survey_id = $2`,
    params
  );

  if (!revived) {
    mutate(
      `insert into fl_survey_qualification
         (id, survey_id, source, source_ref_id, text, is_printed_on_proposal,
          generated_automatically, created_by, updated_by, is_active, data_json,
          created_at, updated_at)
       select md5($1)::uuid::text, $2, 'manual', null, $3, 'true', 'false', $4, $4,
              'true', '{}', $5, $5
        where not exists (
          select 1 from fl_survey_qualification where id = md5($1)::uuid::text)`,
      params
    );
  }

  appendEvent({
    entityType: "survey",
    entityId: input.surveyId,
    kind: "qualification_added",
    actor: input.actor,
    body: text,
  });

  return { qualifications: readQualifications(input.surveyId) };
}

/** Soft, like everything else here — a removed exclusion is still history. */
export function removeQualification(input: {
  qualificationId: string;
  actor: string | null;
}): { qualifications: unknown[] } {
  const row = one<{ surveyId: string }>(
    `select survey_id from fl_survey_qualification where id = $1 limit 1`,
    [input.qualificationId]
  );
  if (!row) throw new Error(`qualification ${input.qualificationId} not found`);

  mutate(
    `update fl_survey_qualification set is_active = 'false', updated_by = $2, updated_at = $3
      where id = $1`,
    [input.qualificationId, input.actor, nowIso()]
  );

  return { qualifications: readQualifications(row.surveyId) };
}

const readQualifications = (surveyId: string): unknown[] =>
  many(
    `select id, source, source_ref_id, text, is_printed_on_proposal, generated_automatically
       from fl_survey_qualification
      where survey_id = $1 and is_active = 'true'
      limit 200`,
    [surveyId]
  );

// ── The revision freeze (T7) ─────────────────────────────────────────────────

/**
 * The handoff payload, built from what the survey actually holds — the thing
 * the estimation lane prices from, and the reason `completed` is terminal.
 *
 * THE SHAPE IS A CONTRACT, not this module's choice: `domain/pricing.ts` reads
 * it as `HandoffPayload` and `modules/proposal.ts` verifies its checksum before
 * generating a single line. The migrate fixture writes the same shape so a
 * seeded demo and a real submit are indistinguishable downstream — which is
 * exactly why this must not drift from it.
 *
 * WHAT IS THIN, AND HONESTLY SO: `observations` on the portfolio come from
 * `fl_survey_observation`, which capture writes per section entry, so a node
 * only carries one if a repeat entry created it. Nodes seeded from tender
 * documents have no observation and appear with their verdict alone. That is
 * the truth of the walk, not a gap in the query — a node nobody stood in has
 * nothing to report.
 */
/**
 * Undo `mapRow`'s camelCasing for this one payload.
 *
 * THE PAYLOAD IS A WIRE FORMAT, NOT A DB ROW. v1.8 §5 specifies it in
 * snake_case, `src/domain/pricing.ts` reads it in snake_case, and it is frozen
 * into `snapshot_json` verbatim and checksummed — so it has to leave here in
 * the shape the contract names, not the shape the row mapper happens to hand us.
 *
 * Why this is needed at all: the batched read aliases its subqueries `*_arr`,
 * and `mapDeep` camelises every key INSIDE those (row-map.ts). Renaming only
 * the top-level keys back — which is what this function used to do — produced a
 * payload that looked right at a glance and was wrong one level down:
 * `estimation_values: [{ estimationKey, ... }]`. The estimator then matched
 * `ev.estimation_key` against `undefined` and reported every single value as
 * unpriceable. It was invisible in testing because the seeded demo fixture is
 * hand-written in snake_case and never went through the mapper.
 */
const toSnakeDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(toSnakeDeep);
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = toSnakeDeep(v);
  }
  return out;
};

function handoffPayload(surveyId: string): Record<string, unknown> {
  const row = one<{
    survey: Record<string, unknown> | null;
    portfolio: unknown[];
    estimationValues: unknown[];
    qualifications: unknown[];
    recommendations: unknown[];
    visits: unknown[];
  }>(
    `select
       (select row_to_json(x) from (
          select s.ref_no as survey_number, s.revision_no, s.contract_intent,
                 s.completeness_pct, s.not_visited_pct, s.rework_count
            from fl_survey s where s.id = $1
        ) x) as survey_obj,

       (select coalesce(json_agg(x order by x.ancestry_path), '[]'::json) from (
          select n.id as node_id, n.type, n.name, n.parent_id,
                 n.ancestry_path, n.provenance, n.verdict,
                 -- The KEYS stay at v1.1's names even though the columns moved
                 -- to v1.3's: proposal.ts prints these attributes off the
                 -- literals 'area_sqft' and 'floor_count' (AREA_KEYS), and the
                 -- handoff payload is a contract between the two lanes, not a
                 -- view of the table. Only the source column changes here.
                 json_build_object(
                   'area_sqft', n.area, 'floor_count', n.no_of_floors,
                   'room_count', n.room_count, 'restroom_count', n.restroom_count
                 ) as attributes,
                 (select row_to_json(o) from (
                    select condition_score, contamination_level, buildup_note,
                           access_constraint, suggested_frequency
                      from fl_survey_observation
                     where prospect_node_id = n.id and is_active = 'true'
                     order by observed_at desc limit 1
                  ) o) as observation
            from fl_portfolio_location n
           where n.deal_id = (select deal_id from fl_survey where id = $1)
             and n.is_active = 'true'
           limit 500
        ) x) as portfolio_arr,

       -- Only questions the template MARKED as feeding estimation. An answer
       -- is evidence; an estimation_value is a quantity someone will multiply
       -- by a rate, and the difference is a decision the template author made.
       (select coalesce(json_agg(x), '[]'::json) from (
          select q.estimation_key,
                 -- The NUMBER wins when there is one, and value_type is
                 -- computed off the same test — a plain coalesce would let a
                 -- stale value_text be carried under value_type 'number', so
                 -- the payload would claim a quantity and hand over prose.
                 -- Matters from the moment a numeric answer type exists (C31).
                 -- (No backticks in here: this comment lives inside a JS
                 -- template literal, and one would close the string.)
                 case when a.value_number is not null
                      then a.value_number::text
                      else a.value_text end as value,
                 case when a.value_number is not null then 'number' else 'text' end as value_type,
                 e.prospect_node_id as scope_node_id,
                 a.id as source_answer_id
            from fl_survey_answer a
            join fl_survey_question_instance q on q.id = a.question_instance_id
            left join fl_survey_section_entry e on e.id = a.section_entry_id
           where a.survey_id = $1 and a.is_active = 'true' and q.is_active = 'true'
             and q.feeds_estimation = 'true'
             and coalesce(q.estimation_key, '') <> ''
           limit 500
        ) x) as estimation_values_arr,

       (select coalesce(json_agg(x), '[]'::json) from (
          select source, source_ref_id, text
            from fl_survey_qualification
           where survey_id = $1 and is_active = 'true'
           limit 200
        ) x) as qualifications_arr,

       -- pricing.ts turns these into draft proposal lines with sourceRole
       -- 'recommendation'. Omitting them was the reason a surveyor's
       -- "quote this separately" never reached a quote.
       (select coalesce(json_agg(x), '[]'::json) from (
          select title, description as value, recommendation_type, urgency,
                 suggested_service_id, prospect_node_id as scope_node_id
            from fl_survey_recommendation
           where survey_id = $1 and is_active = 'true'
           limit 200
        ) x) as recommendations_arr,

       (select coalesce(json_agg(x order by x.sequence_no), '[]'::json) from (
          select visit_number, scheduled_start, status, slot_source, sequence_no
            from fl_survey_visit
           where survey_id = $1 and is_active = 'true'
        ) x) as visits_arr`,
    [surveyId]
  );

  // `toSnakeDeep` on every branch, not just the top level — see its comment.
  return {
    payload_version: "1.0",
    survey: toSnakeDeep(row?.survey ?? null),
    portfolio: toSnakeDeep(row?.portfolio ?? []),
    estimation_values: toSnakeDeep(row?.estimationValues ?? []),
    qualifications: toSnakeDeep(row?.qualifications ?? []),
    recommendations: toSnakeDeep(row?.recommendations ?? []),
    visits: toSnakeDeep(row?.visits ?? []),
    excluded: { cancelled_surveys_included: false },
  };
}

/**
 * Freeze the survey as it stands and make that revision current.
 *
 * This is the half of T7 that makes `completed` mean anything: without it the
 * status changes and nothing is captured, so a later edit anywhere in the tree
 * would silently change what the client was quoted from. The checksum is what
 * `proposal.ts` re-verifies before it prices a line.
 *
 * `is_current` is cleared on the previous revision in the same call — two
 * current revisions is a proposal lane that cannot tell which one it priced.
 */
function freezeRevision(surveyId: string, trigger: RevisionTrigger, actor: string | null): string | null {
  // BEFORE the payload is built, because the payload is what carries them: a
  // qualification generated afterwards would never reach the frozen revision,
  // and `proposal.ts` prints this list as the proposal's exclusions.
  generateQualifications(surveyId, actor);

  const payload = handoffPayload(surveyId);
  const now = nowIso();
  const revisionNo =
    count(`select count(*) as c from fl_survey_revision where survey_id = $1`, [surveyId]) + 1;

  // The id is DERIVED — `md5(key)::uuid::text`, the shape every other stable id
  // in this schema uses (form.ts's snapshot copies, walk.ts's portfolio nodes),
  // which is what keeps a retried freeze idempotent instead of stacking
  // revisions. The key is composed in JS and passed as ONE text parameter:
  // building it with `||` inside the statement would put an untyped bind
  // parameter on the right of a concatenation, and Postgres cannot always
  // resolve an operator for that.
  const key = `rev:${surveyId}:${revisionNo}`;

  // NOT current yet. This runs BEFORE the status update, so until that update
  // lands there is no completed survey for this revision to be the current one
  // OF — and a freeze that succeeded next to a status change that lost its race
  // would otherwise leave the previous revision demoted and an orphan promoted
  // on a survey that never completed. The caller promotes it once the move is
  // real.
  const written = mutate(
    `insert into fl_survey_revision
       (id, survey_id, revision_no, frozen_at, frozen_by, snapshot_json, checksum,
        trigger_kind, is_current, data_json, created_at, updated_at)
     select md5($1)::uuid::text, $2, $3, $4, $5, $6, $7, $8, 'false', '{}', $4, $4
      where not exists (
        select 1 from fl_survey_revision where id = md5($1)::uuid::text)`,
    [key, surveyId, revisionNo, now, actor, JSON.stringify(payload), checksum(payload), trigger]
  );
  if (!written) return null;

  const row = one<{ id: string }>(
    `select id from fl_survey_revision where survey_id = $1 and revision_no = $2 limit 1`,
    [surveyId, revisionNo]
  );

  return row?.id ?? null;
}

/**
 * Frozen revisions, for the lane that prices them.
 *
 * BY DEAL, not just by survey, because that is the question the proposal side
 * actually asks: a proposal is raised against a deal, and what it needs to know
 * is "which frozen surveys can I price this from" — which may be several, since
 * a deal can carry more than one survey. Each row names its survey so the
 * picker can say what it is offering rather than showing bare revision numbers.
 *
 * Only surveys that COMPLETED appear. A revision frozen next to a status change
 * that lost its race is inert by design (see `freezeRevision`), and offering
 * one to be priced would undo that care.
 */
export function listRevisions(input: { surveyId?: string | null; dealId?: string | null }): {
  revisions: unknown[];
} {
  if (!input.surveyId && !input.dealId) throw new Error("pass a surveyId or a dealId");

  // The clause is built, not parameterised around a null. `($1 is null or …)`
  // is the usual trick and it costs a cast plus a doubly-referenced parameter
  // on a platform whose driver this module does not get to choose. Composing
  // the filter in JS is what `listSurveys` above already does, and it leaves
  // one statement shape per call rather than one that has to mean two things.
  const where = input.surveyId ? "r.survey_id = $1" : "s.deal_id = $1";

  return {
    revisions: many(
      `select r.id, r.survey_id, r.revision_no, r.frozen_at, r.frozen_by,
              r.checksum, r.trigger_kind, r.is_current,
              s.ref_no as survey_ref_no, s.title as survey_title,
              s.completeness_pct, s.not_visited_pct
         from fl_survey_revision r
         join fl_survey s on s.id = r.survey_id
        where s.is_active = 'true' and s.status = 'completed'
          and r.is_current = 'true'
          and ${where}
        order by r.frozen_at desc
        limit 100`,
      [input.surveyId ?? input.dealId]
    ),
  };
}

/**
 * Make a frozen revision the current one, after the status move it belongs to
 * has actually landed. Demoting the previous revision and promoting this one
 * is a single statement so there is no instant with two current revisions —
 * which a proposal lane would have no way to choose between.
 */
function promoteRevision(surveyId: string, revisionId: string): void {
  mutate(
    `update fl_survey_revision
        set is_current = case when id = $2 then 'true' else 'false' end
      where survey_id = $1`,
    [surveyId, revisionId]
  );
}

// ── Seeding the portfolio from the tender documents ──────────────────────────

export interface NodeImportInput {
  name: string;
  /** `site` | `building` | `space` — defaults to space. */
  nodeType?: string | null;
  /** The name of another node IN THE SAME BATCH. Ids are derived from names,
      so a parent can be named before or after its children. */
  parentName?: string | null;
  areaSqft?: number | null;
  floorCount?: number | null;
  roomCount?: number | null;
  restroomCount?: number | null;
  /**
   * ACCEPTED AND DISCARDED. v1.3 dropped `floor_label` and put an INTEGER
   * `floor_level` in its place, and a tender document's "Ground" is a label,
   * not a level — deriving 0 from the word would be inventing data in a column
   * that feeds convert. The field stays on the input so the schema in
   * functions/survey/index.ts keeps parsing, and the value is simply not
   * written until someone specifies the mapping.
   */
  floorLabel?: string | null;
  facilioId?: string | null;
}

/** The numeric attributes the diff compares — `COUNT_FIELDS` in reconcile.ts. */
const CLAIMED_FIELDS: readonly (keyof NodeImportInput)[] = [
  "areaSqft",
  "floorCount",
  "roomCount",
  "restroomCount",
];

/**
 * These are `field_key` VALUES in `fl_prospect_observation`, not column names in
 * the portfolio table — which is why they keep v1.1's spelling while the node
 * columns move to v1.3's. The observation table was not renamed, and its stored
 * keys are what `reconcile.ts` matches a survey observation against; respelling
 * them here would orphan every claimed row already written.
 */
const FIELD_COLUMN: Record<string, string> = {
  areaSqft: "area_sqft",
  floorCount: "floor_count",
  roomCount: "room_count",
  restroomCount: "restroom_count",
};

/**
 * Seed the portfolio with what the TENDER DOCUMENTS claimed, before anybody
 * walks it.
 *
 * THIS IS THE HANDLER THE REST OF THE MODULE HAS BEEN ASSUMING. Until it
 * existed there were no `rfp` nodes anywhere, which quietly hollowed out three
 * separate things: a verdict had nothing to be recorded against, coverage had
 * no denominator so `not_visited_pct` was always null, and the three
 * value-level reconciliation diffs could never fire because there was no
 * claimed side to compare. Seeding a tree is what turns all three on.
 *
 * IDS ARE DERIVED FROM (deal, name) so re-importing a corrected list updates
 * the tree in place instead of doubling it — the same treatment every other
 * derived id in this schema gets. A node's VERDICT is never overwritten by a
 * re-import: the documents may be re-read, but what a surveyor found on site is
 * not the document's to revise.
 *
 * EVERY NUMERIC ATTRIBUTE IS ALSO WRITTEN AS A CLAIMED OBSERVATION, because
 * that is what `reconcile.ts` compares against. A node row records that the
 * documents mentioned a room; an observation row records that they said it was
 * 900 sqft — and only the second can disagree with the surveyor.
 */
export function importNodes(input: {
  surveyId: string;
  nodes: NodeImportInput[];
  actor: string | null;
}): { nodes: number; observations: number } {
  const survey = one<{ id: string; dealId: string; status: SurveyStatus }>(
    `select id, deal_id, status from fl_survey where id = $1 and is_active = 'true' limit 1`,
    [input.surveyId]
  );
  if (!survey) throw new Error(`survey ${input.surveyId} not found`);
  if (survey.status === "completed" || survey.status === "cancelled") {
    throw new Error(`a ${survey.status} survey's portfolio is frozen and cannot be re-seeded`);
  }

  const clean = input.nodes
    .map((n) => ({ ...n, name: (n.name ?? "").trim() }))
    .filter((n) => n.name);
  if (!clean.length) throw new Error("no nodes to import");

  // Derived from the DEAL, not the survey: the tree belongs to the deal, and
  // two surveys against one deal must land on the same nodes rather than each
  // seeding a private copy of the same building.
  const keyOf = (name: string) => `node:rfp:${survey.dealId}:${name.toLowerCase()}`;

  const byName = new Map(clean.map((n) => [n.name.toLowerCase(), n]));

  const now = nowIso();
  let nodes = 0;
  let observations = 0;

  for (const node of clean) {
    const parent = (node.parentName ?? "").trim();
    // ONE parameter list, used by both statements in the same order, so the
    // update and the insert can never drift about what $7 means.
    // ONE parameter list, CONTIGUOUS, used by both statements in the same
    // order. Both must reference every $n: a prepared statement handed more
    // parameters than it names is a bind error, not a harmless extra.
    const p = [
      keyOf(node.name), // $1  own key, hashed in SQL
      survey.dealId, // $2
      input.surveyId, // $3
      node.nodeType || "space", // $4
      // $5 parent key. Cast to ::text at BOTH use sites: a top-level node sends
      // null here, and `case when $5 is null` gives the planner nothing to infer
      // a type from — "could not determine data type of parameter $5", which
      // failed every import whose first node had no parent. That is every
      // import, since a tree starts at a site.
      parent && byName.has(parent.toLowerCase()) ? keyOf(parent) : null, // $5
      node.name, // $6
      node.areaSqft ?? null, // $7
      node.floorCount ?? null, // $8
      node.roomCount ?? null, // $9
      node.restroomCount ?? null, // $10
      // `floorLabel` is deliberately absent: v1.3 has no column of that meaning
      // (see NodeImportInput). Dropped from the LIST as well as from the
      // statements, because a parameter nothing references is a bind error.
      node.facilioId ?? null, // $11
      input.actor, // $12
      now, // $13
    ];

    // Update first, and note what is NOT in the SET list: `verdict`,
    // `verdict_note` and their stamps. A re-read of the documents may correct
    // what was claimed; it may not erase what somebody found on site.
    const updated = mutate(
      `update fl_portfolio_location
          set type = $4,
              parent_id = case when $5::text is null then null else md5($5::text)::uuid::text end,
              name = $6, area = $7, no_of_floors = $8,
              room_count = $9, restroom_count = $10, facilio_id = $11,
              updated_by = $12, updated_at = $13, is_active = 'true',
              survey_id = coalesce(survey_id, $3), deal_id = $2,
              -- Filled only when empty: the deal is being (re)pointed here, and
              -- a row already homed to a client stays with that client.
              account_id = coalesce(account_id,
                (select d.account_id from fl_deal d where d.id = $2))
        where id = md5($1)::uuid::text and provenance in ('rfp', 'crm')`,
      p
    );

    if (!updated) {
      nodes += mutate(
        // Same account stamp as the update above and as `createLocation` — this
        // import writes the table directly, so it carries the rule itself.
        `insert into fl_portfolio_location
           (id, deal_id, account_id, survey_id, type, parent_id, ancestry_path, name,
            area, no_of_floors, room_count, restroom_count, facilio_id,
            provenance, verdict, created_by, updated_by, is_active, data_json,
            created_at, updated_at)
         select md5($1)::uuid::text, $2,
                (select d.account_id from fl_deal d where d.id = $2), $3, $4,
                case when $5::text is null then null else md5($5::text)::uuid::text end,
                md5($1)::uuid::text, $6, $7, $8, $9, $10, $11,
                'rfp', 'unverified', $12, $12, 'true', '{}', $13, $13
          where not exists (
            select 1 from fl_portfolio_location where id = md5($1)::uuid::text)`,
        p
      );
    } else {
      nodes += updated;
    }

    // The claimed side of every future comparison.
    for (const field of CLAIMED_FIELDS) {
      const value = node[field];
      if (value === null || value === undefined) continue;
      const obsKey = `obs:rfp:${keyOf(node.name)}:${FIELD_COLUMN[field as string]}`;
      const obsParams = [
        obsKey,
        keyOf(node.name),
        survey.dealId,
        input.surveyId,
        FIELD_COLUMN[field as string],
        Number(value),
        input.actor,
        now,
      ];

      // Its own list: this statement names four of the eight, and a prepared
      // statement handed parameters it never references is a bind error.
      const obsUpdated = mutate(
        `update fl_prospect_observation
            set value_number = $2, observed_by = $3, observed_at = $4, updated_at = $4
          where id = md5($1)::uuid::text and provenance = 'rfp'`,
        [obsKey, Number(value), input.actor, now]
      );

      if (!obsUpdated) {
        observations += mutate(
          `insert into fl_prospect_observation
             (id, prospect_node_id, deal_id, survey_id, field_key, value_number,
              provenance, observed_by, observed_at, data_json, created_at, updated_at)
           select md5($1)::uuid::text, md5($2)::uuid::text, $3, $4, $5, $6,
                  'rfp', $7, $8, '{}', $8, $8
            where not exists (
              select 1 from fl_prospect_observation where id = md5($1)::uuid::text)`,
          obsParams
        );
      } else {
        observations += obsUpdated;
      }
    }
  }

  // ANCESTRY IS DERIVED FROM THE LINKS, not composed while inserting. Every
  // node lands with its own id as its path, then each pass pushes children one
  // level down under their parent — so the paths are chains of the SAME hashed
  // ids walk.ts writes, and a seeded tree and a captured one sort as one tree
  // rather than two interleaved blocks.
  //
  // Bounded at five passes because a tender's tree is site → building → space
  // and this must terminate on a list that names itself as its own parent. The
  // `<>` clause makes each pass a no-op once the paths have settled.
  for (let depth = 0; depth < 5; depth += 1) {
    const moved = mutate(
      `update fl_portfolio_location c
          set ancestry_path = p.ancestry_path || '${ANCESTRY_SEPARATOR}' || c.id
         from fl_portfolio_location p
        where c.parent_id = p.id
          and c.deal_id = $1 and c.provenance in ('rfp', 'crm')
          and c.is_active = 'true'
          and c.ancestry_path <> p.ancestry_path || '${ANCESTRY_SEPARATOR}' || c.id`,
      [survey.dealId]
    );
    if (!moved) break;
  }

  appendEvent({
    entityType: "survey",
    entityId: input.surveyId,
    kind: "nodes_imported",
    actor: input.actor,
    body: `${clean.length} node(s) seeded from the tender documents`,
  });

  restampCompleteness(input.surveyId, now);

  return { nodes, observations };
}

// ── Node verdicts ────────────────────────────────────────────────────────────

const VERDICTS: readonly string[] = [
  "unverified",
  "verified",
  "changed",
  "not_found",
  "added_on_site",
  "not_visited",
];

/**
 * A verdict that CONTRADICTS the tender documents has to say why. "Verified"
 * agrees with what was claimed and needs no defence; the other three are the
 * survey telling the estimator that the paperwork was wrong, and an unexplained
 * contradiction is the one a client challenges.
 */
const VERDICT_NEEDS_NOTE: readonly string[] = ["changed", "not_found", "not_visited"];

/**
 * Record what the surveyor found at a node that the tender documents claimed.
 *
 * ONLY SEEDED NODES TAKE A VERDICT, and the refusal is deliberate. A node with
 * `provenance = 'survey'` was created BY capture and already carries
 * `added_on_site` — that value is a record of how the row came to exist, not an
 * opinion someone may revise. `surveyCounts` reads exactly this distinction to
 * decide what T7 is owed, so letting a verdict be typed over a capture-created
 * node would quietly move the denominator the completion guard counts against.
 */
export function setNodeVerdict(input: {
  nodeId: string;
  verdict: string;
  verdictNote?: string | null;
  visitId?: string | null;
  actor: string | null;
}): { node: unknown } {
  if (!VERDICTS.includes(input.verdict)) {
    throw new Error(`unknown verdict: ${input.verdict} (allowed: ${VERDICTS.join(", ")})`);
  }

  const node = one<{
    id: string;
    name: string;
    provenance: string;
    surveyId: string | null;
    dealId: string | null;
  }>(
    `select id, name, provenance, survey_id, deal_id
       from fl_portfolio_location where id = $1 and is_active = 'true' limit 1`,
    [input.nodeId]
  );
  if (!node) throw new Error(`node ${input.nodeId} not found`);

  if (node.provenance !== "rfp" && node.provenance !== "crm") {
    throw new Error(
      `"${node.name}" was found on site, not claimed by the tender documents — there is nothing to verify against`
    );
  }

  const note = typeof input.verdictNote === "string" ? input.verdictNote.trim() : "";
  if (VERDICT_NEEDS_NOTE.includes(input.verdict) && !note) {
    throw new Error(`a "${input.verdict}" verdict needs a note saying what was found instead`);
  }

  const now = nowIso();
  const updated = mutate(
    `update fl_portfolio_location
        set verdict = $2, verdict_note = $3, verdict_by = $4, verdict_at = $5,
            verdict_visit_id = $6, updated_by = $4, updated_at = $5
      where id = $1 and is_active = 'true'`,
    [input.nodeId, input.verdict, note || null, input.actor, now, input.visitId ?? null]
  );
  if (!updated) throw new Error(`node ${input.nodeId} could not be updated`);

  appendEvent({
    entityType: "prospect_node",
    entityId: input.nodeId,
    kind: "verdict",
    actor: input.actor,
    body: `${node.name}: ${input.verdict}`,
    meta: note ? { note } : {},
  });

  // A verdict moves `verdictedNodes`, which is half of completeness — restamp
  // for the same reason capture does, so the record page and the list agree.
  //
  // VIA THE DEAL, not `node.survey_id`. The portfolio tree hangs off the DEAL —
  // that is how `surveyCounts` reaches it, and a node seeded from tender
  // documents is claimed against the deal before any particular survey walks
  // it, so its `survey_id` may well be null. Going through the deal also
  // catches the case the column could never express: several surveys against
  // one deal share one tree, so one verdict moves all of their numbers.
  if (node.dealId) {
    for (const s of many<{ id: string }>(
      `select id from fl_survey
        where deal_id = $1 and is_active = 'true'
          and status not in ('completed', 'cancelled') limit 50`,
      [node.dealId]
    )) {
      restampCompleteness(s.id, now);
    }
  }

  const fresh = one(
    // Same aliasing as `surveyDetail`: this row goes back to the same tree the
    // record page draws, so it has to arrive shaped the same way.
    `select id, name, type, parent_id, ancestry_path, verdict, verdict_note,
            verdict_at, verdict_by, area as area_sqft, room_count, restroom_count,
            provenance, facilio_id
       from fl_portfolio_location where id = $1 limit 1`,
    [input.nodeId]
  );

  return { node: fresh };
}

// ── Reconciliation ───────────────────────────────────────────────────────────

/**
 * Run the deterministic diff and store what it found.
 *
 * The DECIDING lives in `domain/reconcile.ts`, which is pure and must stay that
 * way; this gathers its three inputs and persists its output. Two rules govern
 * the write, and both exist to protect a person's decision:
 *
 * IDS ARE DERIVED, not generated — `survey:difftype:subject:field` — so
 * re-running the diff UPDATES the row it found last time instead of stacking a
 * second copy of the same disagreement. Nobody should have to close the same
 * item twice because someone pressed the button again.
 *
 * DECIDED ROWS ARE NEVER TOUCHED. A re-run may not reopen, reword or re-suggest
 * an item a person has closed — `reconcile.ts`'s header forbids the app writing
 * a decision, and silently discarding one is the same violation wearing a
 * different hat. Rows that have gone away since the last run are left alone
 * too: an item that no longer diffs is history, not garbage.
 *
 * WHAT IT CAN ACTUALLY FIND TODAY is narrower than the six diff types, and the
 * caller is told so rather than being handed an empty list to misread. The
 * value-level types all compare tender-document claims against site
 * observations, and `fl_prospect_observation` — the claimed side — has no
 * writer in this build. Until an RFP import lands, the reachable diffs are
 * `node_not_found`, `node_added` and `unanswered_required`.
 */
export function reconcileSurvey(input: { surveyId: string; actor: string | null }): {
  items: unknown[];
  written: number;
  /** Diff types this run could not have found, and why. */
  unreachable: string[];
} {
  const source = one<{
    nodes: ReconcileNode[];
    observations: ReconcileObservation[];
    requiredAnswers: ReconcileRequiredAnswer[];
  }>(
    `select
       (select coalesce(json_agg(x order by x.node_id), '[]'::json) from (
          select id as node_id, name, provenance, verdict
            from fl_portfolio_location
           where deal_id = (select deal_id from fl_survey where id = $1)
             and is_active = 'true'
           limit 500
        ) x) as nodes_arr,

       (select coalesce(json_agg(x order by x.node_id, x.field_key), '[]'::json) from (
          select prospect_node_id as node_id, field_key,
                 coalesce(value_text, value_number::text) as value,
                 provenance, observed_by
            from fl_prospect_observation
           where survey_id = $1
           limit 1000
        ) x) as observations_arr,

       (select coalesce(json_agg(x order by x.question_instance_id), '[]'::json) from (
          select q.id as question_instance_id, q.label,
                 exists (select 1 from fl_survey_answer a
                          where a.question_instance_id = q.id and a.is_active = 'true'
                            and (coalesce(a.value_text, '') <> ''
                                 or a.value_number is not null
                                 or a.value_date is not null
                                 or coalesce(a.value_bool, '') <> ''
                                 or coalesce(a.value_json, '') not in ('', '[]', '{}', 'null')))
                   as is_answered,
                 exists (select 1 from fl_survey_answer a
                          where a.question_instance_id = q.id and a.is_active = 'true'
                            and a.is_na = 'true') as is_na
            from fl_survey_question_instance q
           where q.survey_id = $1 and q.is_active = 'true' and q.is_required = 'true'
           limit 500
        ) x) as required_answers_arr`,
    [input.surveyId]
  );

  const found = reconcile({
    nodes: source?.nodes ?? [],
    observations: source?.observations ?? [],
    requiredAnswers: source?.requiredAnswers ?? [],
  });

  // The natural key of a disagreement: which survey, what kind, about what,
  // on which field. Hashed into a uuid because every id column in this schema
  // holds one — same treatment `freezeRevision` and walk.ts's portfolio nodes
  // get, except computed here in JS since the row is built here too.
  const keyOf = (item: ReconcileItem): string =>
    [
      input.surveyId,
      item.diffType,
      item.prospectNodeId ?? item.questionInstanceId ?? "-",
      item.fieldKey ?? "-",
    ].join(":");

  const now = nowIso();
  let written = 0;

  for (const item of found) {
    const params = [
      keyOf(item),
      input.surveyId,
      item.diffType,
      item.prospectNodeId,
      item.fieldKey,
      item.questionInstanceId,
      item.rfpValue,
      item.surveyValue,
      item.suggestedValue,
      item.suggestionBasis,
      now,
    ];

    // UPDATE-THEN-INSERT, and the two `where` clauses together are what makes a
    // decided row untouchable: the update is fenced to `status = 'open'` so it
    // cannot reword a closed item, and the insert is fenced to a row that does
    // not exist so it cannot replace one. No decided-id list has to be read
    // and kept in step — the statements themselves refuse.
    const updated = mutate(
      `update fl_survey_reconciliation
          set diff_type = $3, prospect_node_id = $4, field_key = $5, question_instance_id = $6,
              rfp_value = $7, survey_value = $8, suggested_value = $9, suggestion_basis = $10,
              updated_at = $11, is_active = 'true'
        where id = md5($1)::uuid::text and survey_id = $2 and status = 'open'`,
      params
    );

    if (!updated) {
      written += mutate(
        `insert into fl_survey_reconciliation
           (id, survey_id, diff_type, prospect_node_id, field_key, question_instance_id,
            rfp_value, survey_value, suggested_value, suggestion_basis, status,
            is_active, data_json, created_at, updated_at)
         select md5($1)::uuid::text, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open',
                'true', '{}', $11, $11
          where not exists (
            select 1 from fl_survey_reconciliation where id = md5($1)::uuid::text)`,
        params
      );
    } else {
      written += updated;
    }
  }

  appendEvent({
    entityType: "survey",
    entityId: input.surveyId,
    kind: "reconciled",
    actor: input.actor,
    body: `${found.length} difference(s) found`,
  });

  const observed = (source?.observations ?? []).length;

  return {
    items: readReconciliation(input.surveyId),
    written,
    unreachable: observed
      ? []
      : ["value_conflict", "count_mismatch", "intra_survey_conflict"],
  };
}

const readReconciliation = (surveyId: string): unknown[] =>
  many(
    `select id, diff_type, prospect_node_id, field_key, question_instance_id,
            rfp_value, survey_value, suggested_value, suggestion_basis,
            decision, manual_value, decision_note, decided_by, decided_at, status
       from fl_survey_reconciliation
      where survey_id = $1 and is_active = 'true'
      limit 500`,
    [surveyId]
  );

const DECISIONS: readonly string[] = ["accept_survey", "accept_rfp", "manual", "exclude"];

/**
 * A person closes one row. THE APP NEVER DOES THIS — see `reconcile.ts`.
 *
 * `manual` is the only decision that carries a value, and it must: choosing
 * "neither of these" without saying what instead leaves the estimator with the
 * same disagreement and one more click of false progress.
 */
export function decideReconcileItem(input: {
  itemId: string;
  decision: string;
  manualValue?: string | null;
  decisionNote?: string | null;
  actor: string | null;
}): { item: unknown } {
  if (!DECISIONS.includes(input.decision)) {
    throw new Error(`unknown decision: ${input.decision} (allowed: ${DECISIONS.join(", ")})`);
  }

  const item = one<{ id: string; surveyId: string; status: string }>(
    `select id, survey_id, status from fl_survey_reconciliation
      where id = $1 and is_active = 'true' limit 1`,
    [input.itemId]
  );
  if (!item) throw new Error(`reconciliation item ${input.itemId} not found`);

  const manual = typeof input.manualValue === "string" ? input.manualValue.trim() : "";
  if (input.decision === "manual" && !manual) {
    throw new Error("a manual decision needs the value to use instead");
  }

  const now = nowIso();
  const updated = mutate(
    `update fl_survey_reconciliation
        set decision = $2, manual_value = $3, decision_note = $4,
            decided_by = $5, decided_at = $6, status = 'decided', updated_at = $6
      where id = $1 and status = 'open'`,
    [
      input.itemId,
      input.decision,
      manual || null,
      (input.decisionNote ?? "").trim() || null,
      input.actor,
      now,
    ]
  );
  if (!updated) throw new Error("that item has already been decided — reload and try again");

  appendEvent({
    entityType: "survey",
    entityId: item.surveyId,
    kind: "reconcile_decision",
    actor: input.actor,
    body: `${input.decision} on ${input.itemId}`,
    meta: manual ? { manualValue: manual } : {},
  });

  return {
    item: one(
      `select id, diff_type, prospect_node_id, field_key, question_instance_id,
              rfp_value, survey_value, suggested_value, suggestion_basis,
              decision, manual_value, decision_note, decided_by, decided_at, status
         from fl_survey_reconciliation where id = $1 limit 1`,
      [input.itemId]
    ),
  };
}

// ── Completeness, and the guards that read it ────────────────────────────────

/**
 * The seven numbers `domain/survey-completeness.ts` decides on. That file is
 * pure and does the deciding; THIS is the counting, which is the half that
 * needs a database. Keeping the split means the guard rules are unit-testable
 * without a schema, and this query is the only place that knows what "seeded"
 * or "answered" means in SQL.
 *
 * Two definitions worth stating, because both are choices:
 *
 * SEEDED is deal-scoped and provenance-scoped. A verdict is owed on the tree
 * that came OUT of the tender documents (`rfp`, `crm`) — not on a room the
 * surveyor added on site, which is evidence rather than a question. The
 * deal_id join matches `surveyDetail`, which reads the same tree.
 *
 * ANSWERED is not "a row exists". The walk writes an answer row as the
 * surveyor types and clearing a field leaves that row behind holding nothing,
 * so a row-count would report a question answered when the screen shows it
 * blank. A value in any of the typed columns, or an explicit not-applicable,
 * is what counts.
 */
export function surveyCounts(surveyId: string): SurveyCounts {
  // Written out in full rather than splicing a shared `where` fragment: the
  // three node counts differ only in their last predicate, and a template that
  // appends `and …` after an interpolated clause is one edit away from
  // silently attaching itself to the wrong scope.
  const row = one<Record<string, unknown>>(
    `select
       (select count(*) from fl_portfolio_location
         where deal_id = (select deal_id from fl_survey where id = $1)
           and is_active = 'true'
           and provenance in ('rfp', 'crm')) as seeded_nodes,

       (select count(*) from fl_portfolio_location
         where deal_id = (select deal_id from fl_survey where id = $1)
           and is_active = 'true'
           and provenance in ('rfp', 'crm')
           and verdict is not null
           and verdict <> 'unverified') as verdicted_nodes,

       (select count(*) from fl_portfolio_location
         where deal_id = (select deal_id from fl_survey where id = $1)
           and is_active = 'true'
           and provenance in ('rfp', 'crm')
           and verdict = 'not_visited') as not_visited_nodes,

       (select count(*) from fl_survey_question_instance
         where survey_id = $1 and is_active = 'true'
           and is_required = 'true') as required_questions,

       -- value_json is a TEXT column holding JSON.stringify output, so a
       -- multi-select the surveyor cleared arrives as the four characters
       -- '[]' — not null, and emphatically not an answer. Excluding the
       -- empty encodings is what stops a cleared question counting as done.
       (select count(distinct a.question_instance_id)
          from fl_survey_answer a
          join fl_survey_question_instance q on q.id = a.question_instance_id
         where a.survey_id = $1 and a.is_active = 'true'
           and q.is_active = 'true' and q.is_required = 'true'
           and (a.is_na = 'true'
                or coalesce(a.value_text, '') <> ''
                or a.value_number is not null
                or a.value_date is not null
                or coalesce(a.value_bool, '') <> ''
                or coalesce(a.value_json, '') not in ('', '[]', '{}', 'null'))
       ) as answered_required,

       -- D-22's floor: ANY question with an answer, required or not. Same
       -- emptiness predicate as answered_required above — the two must agree
       -- on what "answered" means or the gate and the progress bar drift.
       (select count(distinct a.question_instance_id)
          from fl_survey_answer a
          join fl_survey_question_instance q on q.id = a.question_instance_id
         where a.survey_id = $1 and a.is_active = 'true'
           and q.is_active = 'true'
           and (a.is_na = 'true'
                or coalesce(a.value_text, '') <> ''
                or a.value_number is not null
                or a.value_date is not null
                or coalesce(a.value_bool, '') <> ''
                or coalesce(a.value_json, '') not in ('', '[]', '{}', 'null'))
       ) as answered_questions,

       (select count(*) from fl_survey_reconciliation
         where survey_id = $1 and is_active = 'true'
           and status = 'open') as open_reconciliation_items,

       (select count(*) from fl_survey_visit
         where survey_id = $1 and is_active = 'true'
           and status in ('planned', 'in_progress')) as open_visits`,
    [surveyId]
  );

  const n = (key: string): number => Number(row?.[key] ?? 0);

  return {
    seededNodes: n("seededNodes"),
    verdictedNodes: n("verdictedNodes"),
    notVisitedNodes: n("notVisitedNodes"),
    requiredQuestions: n("requiredQuestions"),
    answeredRequired: n("answeredRequired"),
    answeredQuestions: n("answeredQuestions"),
    openReconciliationItems: n("openReconciliationItems"),
    openVisits: n("openVisits"),
  };
}

/**
 * Write the two derived percentages back onto the survey row.
 *
 * Called from everywhere that moves the numbers — capture (answers), verdicts
 * (nodes) and any transition — because these are the columns the LIST prints,
 * and a list is the one place nobody thinks to question a stale figure.
 */
export function restampCompleteness(surveyId: string, now = nowIso()): SurveyCounts {
  const counts = surveyCounts(surveyId);
  mutate(
    `update fl_survey
        set completeness_pct = $2, not_visited_pct = $3, updated_at = $4
      where id = $1 and is_active = 'true'`,
    [surveyId, completenessPct(counts), notVisitedPct(counts), now]
  );
  return counts;
}

/** The three org knobs the submit guard reads. Config, never hardcoded (D-S14). */
function completenessSettings(): CompletenessSettings {
  return {
    allowCompleteWithNotVisited: getSetting("survey.allow_complete_with_not_visited", true),
    notVisitedWarnThresholdPct: getSetting("survey.not_visited_warn_threshold_pct", 20),
    reworkWarnAfterBounces: getSetting("survey.rework_warn_after_bounces", 3),
  };
}

export interface SurveyReadiness {
  counts: SurveyCounts;
  /** Null when nothing is owed — see domain/survey-completeness.ts. */
  completenessPct: number | null;
  /** Null when nothing was seeded. NOT the same as 0. */
  notVisitedPct: number | null;
  /** T5 — what stops `in_progress -> pending_review`. */
  review: GuardResult;
  /** T7 — what stops `pending_review -> completed`. */
  submit: GuardResult;
}

/**
 * Both guards answered at once, for a caller that wants to SHOW what is
 * blocking rather than discover it by being refused. The transition handler
 * runs the same functions over the same counts, so the list a person reads
 * before clicking is the list that would stop them.
 */
export function surveyReadiness(surveyId: string, reworkCount = 0): SurveyReadiness {
  const counts = surveyCounts(surveyId);
  return {
    counts,
    completenessPct: completenessPct(counts),
    notVisitedPct: notVisitedPct(counts),
    review: reviewGuard(counts),
    submit: submitGuard(counts, reworkCount, completenessSettings()),
  };
}

// ── Transition ────────────────────────────────────────────────────────────────

export function transitionSurvey(input: {
  surveyId: string;
  toStatus: string;
  reason?: string | null;
  actor: string | null;
}): { survey: SurveyRecord; warnings: string[] } {
  const survey = one<{
    id: string;
    refNo: string;
    status: SurveyStatus;
    leadUserEmail: string | null;
    reworkCount: number | null;
    dealId: string | null;
  }>(
    `select id, ref_no, status, lead_user_email, rework_count, deal_id
       from fl_survey where id = $1 and is_active = 'true' limit 1`,
    [input.surveyId]
  );
  if (!survey) throw new Error(`survey ${input.surveyId} not found`);

  // The honest limit (X8): the actor is client-asserted. What CAN be checked
  // server-side is whether that asserted actor matches the recorded lead.
  const move = validateSurveyTransition({
    from: survey.status,
    to: input.toStatus,
    reason: input.reason,
    actorIsLead: Boolean(input.actor) && input.actor === survey.leadUserEmail,
  });

  /**
   * THE COUNT-BASED GUARDS. `survey-state.ts` is a table plus a validator and
   * cannot see rows, so T5's "no visit left open" and T7's full set live here,
   * where the counting happens. Without this the state machine would happily
   * complete a survey with unanswered required questions and undecided
   * reconciliation rows — and `completed` is terminal, so there is no second
   * chance to catch it.
   *
   * Blockers throw and name themselves. Warnings do NOT stop the move: a
   * survey with most of its site unvisited still completes (D-S11), loudly.
   * They ride out on the event so the estimator inherits them.
   */
  const counts = surveyCounts(input.surveyId);
  let warnings: string[] = [];

  if (move.to === "pending_review" || move.to === "completed") {
    const guard =
      move.to === "pending_review"
        ? reviewGuard(counts)
        : submitGuard(counts, survey.reworkCount ?? 0, completenessSettings());

    if (!guard.ok) throw new Error(`${move.code} blocked — ${guard.blockers.join("; ")}`);
    warnings = guard.warnings;
  }

  const now = nowIso();
  const sets: string[] = [];
  const params: unknown[] = [input.surveyId, move.to, now, input.actor];

  // Restamped on EVERY move, not just the guarded ones — one count, two uses.
  // These are the columns the list and the record page print, and a number
  // that only refreshes on submit is wrong for most of a survey's life.
  params.push(completenessPct(counts), notVisitedPct(counts));
  sets.push(`completeness_pct = $${params.length - 1}`, `not_visited_pct = $${params.length}`);

  const stamps = stampColumnsFor(move.to);
  if (stamps.includes("cancel_reason")) {
    params.push(move.reason);
    sets.push(`cancel_reason = $${params.length}`, "cancelled_by = $4", "cancelled_at = $3");
  }
  if (stamps.includes("submitted_by")) {
    sets.push("submitted_by = $4", "submitted_at = $3");
  }

  // THE FREEZE, and it happens BEFORE the status update on purpose. The
  // revision has to capture the survey as it was when it passed the guard; if
  // the status moved first and the freeze then failed, the survey would sit in
  // `completed` — terminal — with nothing frozen and no way back to fix it.
  //
  // Frozen first, the worst case is a revision row on a survey that never
  // completed. It is written `is_current = 'false'` and promoted only after the
  // status update lands (below), so that row changes nothing about which
  // revision the proposal lane would price — it is inert until the move is
  // real. `current_revision_id` is the column `stampColumnsFor` has been naming
  // since before there was anything to put in it.
  let frozenRevisionId: string | null = null;
  if (stamps.includes("current_revision_id")) {
    frozenRevisionId = freezeRevision(input.surveyId, "submit", input.actor);
    if (!frozenRevisionId) {
      throw new Error("could not freeze the survey revision — nothing was completed");
    }
    params.push(frozenRevisionId);
    sets.push(`current_revision_id = $${params.length}`);
  }
  if (incrementsRework(move.from, move.to)) {
    sets.push("rework_count = coalesce(rework_count, 0) + 1");
  }

  // `and status = $5` closes the race — two concurrent moves cannot both win.
  params.push(move.from);
  const updated = mutate(
    `update fl_survey
        set status = $2, status_changed_at = $3, status_changed_by = $4,
            updated_by = $4, updated_at = $3${sets.length ? ", " + sets.join(", ") : ""}
      where id = $1 and status = $${params.length} and is_active = 'true'`,
    params
  );
  if (!updated) throw new Error(`survey is no longer ${move.from} — reload and try again`);

  // The move is real, so the revision it froze becomes the current one.
  if (frozenRevisionId) promoteRevision(input.surveyId, frozenRevisionId);

  appendEvent({
    entityType: "survey",
    entityId: input.surveyId,
    kind: "status_change",
    actor: input.actor,
    body: `${move.code}: ${move.from} → ${move.to}`,
    // Warnings are recorded, not shown and forgotten. "80% of the site was
    // never visited" is the sort of thing an estimator needs to be able to
    // find AFTER the price is questioned, and the audit trail is where they
    // will look.
    meta: {
      ...(move.reason ? { reason: move.reason } : {}),
      ...(warnings.length ? { warnings } : {}),
    },
  });

  // A completed survey IS the deal reaching Survey Completed (deal.md stage 4).
  // After the status update lands, so a guard rejection can never nudge the deal.
  if (move.to === "completed" && survey.dealId) {
    advanceDealTo(survey.dealId, "survey_completed", input.actor, `Survey ${survey.refNo} completed`);
  }

  const fresh = one<SurveyRecord>(
    `select ${SURVEY_COLUMNS},
            (select a.name from fl_account a where a.id = s.account_id) as account_name,
            (select t.name from fl_form_template t where t.id = s.template_id) as template_name
       from fl_survey s where s.id = $1 limit 1`,
    [input.surveyId]
  );

  // Warnings ride back so the caller can show what it proceeded PAST — a move
  // that succeeded with reservations is not the same as a clean one.
  return { survey: fresh as SurveyRecord, warnings };
}

/**
 * P-06's one button. The surveyor taps Submit and the routing does the rest:
 * a different lead → `pending_review` (T5); the actor IS the lead → straight
 * through to `completed` (T5 then T7 in sequence, so the ledger keeps both
 * gates even though one tap crossed them, and the T7 leg still runs the full
 * submit guard and the revision freeze).
 *
 * WHO may tap it: an active assignee or the recorded lead — this is the
 * surveyor's control, not the coordinator's. That check lives here rather than
 * in the state table because it needs rows.
 */
export function submitSurvey(input: {
  surveyId: string;
  actor: string | null;
}): { survey: SurveyRecord; warnings: string[] } {
  const survey = one<{ id: string; status: SurveyStatus; leadUserEmail: string | null }>(
    `select id, status, lead_user_email from fl_survey
      where id = $1 and is_active = 'true' limit 1`,
    [input.surveyId]
  );
  if (!survey) throw new Error(`survey ${input.surveyId} not found`);

  const actor = (input.actor ?? "").trim().toLowerCase();
  if (!actor) throw new Error("submit needs the actor's email");

  const isAssignee = Boolean(
    one(
      `select 1 as x from fl_survey_assignee
        where survey_id = $1 and user_email = $2 and is_active = 'true' limit 1`,
      [input.surveyId, actor]
    )
  );
  const isLead = actor === (survey.leadUserEmail ?? "").toLowerCase();
  if (!isAssignee && !isLead) {
    throw new Error("only an assigned surveyor can submit this survey");
  }

  if (survey.status !== "in_progress" && survey.status !== "pending_review") {
    throw new Error(`a ${survey.status} survey cannot be submitted`);
  }
  if (survey.status === "pending_review" && !isLead) {
    throw new Error("already submitted — waiting on the lead's review");
  }

  // Leg one: T5, unless the survey already sits in review.
  let result =
    survey.status === "in_progress"
      ? transitionSurvey({ surveyId: input.surveyId, toStatus: "pending_review", actor: input.actor })
      : null;

  // Leg two, lead only: T7 — the freeze and the full guard set run inside.
  if (isLead) {
    const completed = transitionSurvey({
      surveyId: input.surveyId,
      toStatus: "completed",
      actor: input.actor,
    });
    result = {
      survey: completed.survey,
      warnings: [...(result?.warnings ?? []), ...completed.warnings],
    };
  }

  // Non-lead path always ran leg one (the pending_review-and-not-lead case
  // threw above), so result is set on every surviving branch.
  return result as { survey: SurveyRecord; warnings: string[] };
}

// ── Assignment ────────────────────────────────────────────────────────────────

export interface AssigneeInput {
  userEmail: string;
  participation?: string | null;
  disciplineIds?: string[];
}

export interface AssigneeRecord {
  id: string;
  userEmail: string;
  /** Resolved from fl_user at assign time (F-22) — null only on legacy rows. */
  userId: string | null;
  /** Joined at read so the UI never prints a raw email (X-05). */
  userName: string | null;
  participation: string | null;
  disciplineIds: string[] | null;
  assignedAt: string | null;
}

const readAssignees = (surveyId: string): AssigneeRecord[] =>
  many<AssigneeRecord>(
    `select a.id, a.user_email, a.user_id, a.participation, a.discipline_ids_json, a.assigned_at,
            (select u.name from fl_user u where u.id = a.user_id limit 1) as user_name
       from fl_survey_assignee a
      where a.survey_id = $1 and a.is_active = 'true'
      order by a.assigned_at
      limit 100`,
    [surveyId]
  );

/**
 * Multi-select, one idempotent multi-row insert: an email already actively
 * assigned is skipped, so re-sending the same list never duplicates anyone.
 * `is_lead` is never written here — the lead lives on `fl_survey` (X1).
 */
export function assignSurveyors(
  surveyId: string,
  assignees: AssigneeInput[],
  actor: string | null
): { assignees: AssigneeRecord[] } {
  const survey = one<{ id: string; status: SurveyStatus }>(
    `select id, status from fl_survey where id = $1 and is_active = 'true' limit 1`,
    [surveyId]
  );
  if (!survey) throw new Error(`survey ${surveyId} not found`);
  if (survey.status === "completed" || survey.status === "cancelled") {
    throw new Error(`a ${survey.status} survey cannot be assigned`);
  }

  const cleaned = assignees
    .map((a) => ({
      userEmail: a.userEmail?.trim().toLowerCase() ?? "",
      participation: a.participation === "observer" ? "observer" : "surveyor",
      disciplineIds: a.disciplineIds ?? [],
    }))
    .filter((a) => a.userEmail.includes("@"));
  if (!cleaned.length) throw new Error("assignees[] needs at least one userEmail");

  /**
   * F-22 / D-19: an assignee IS a user record, not a string that looks like
   * one. Every email must resolve against fl_user before anything is written —
   * a typo'd address used to become a phantom surveyor who never saw the visit.
   * Inactive users are refused too: deactivation is an explicit admin decision,
   * and assignment is exactly the door it exists to close.
   */
  const emailParams = cleaned.map((_, i) => `$${i + 1}`).join(", ");
  const found = many<{ id: string; emailNorm: string; name: string; status: string }>(
    `select id, email_norm, name, status from fl_user
      where email_norm in (${emailParams})
      limit ${cleaned.length}`,
    cleaned.map((a) => a.userEmail)
  );
  const byEmail = new Map(found.map((u) => [u.emailNorm, u]));
  for (const a of cleaned) {
    const user = byEmail.get(a.userEmail);
    if (!user) {
      throw new Error(
        `${a.userEmail} has no user record — add them under Settings → Users first`
      );
    }
    if (user.status !== "active") {
      throw new Error(`${user.name} (${a.userEmail}) is inactive and cannot be assigned`);
    }
  }

  const now = nowIso();
  const params: unknown[] = [surveyId, actor, now];
  const tuples = cleaned.map((a, i) => {
    params.push(a.userEmail, a.participation, JSON.stringify(a.disciplineIds));
    const base = params.length - 2;
    const cast = i === 0 ? "::text" : "";
    return `($${base}${cast}, $${base + 1}${cast}, $${base + 2}${cast})`;
  });

  // `user_id` is re-resolved inside the INSERT rather than passed as a
  // parameter: the id sits one subquery away, and this keeps the tuple list
  // (and its $-numbering) untouched.
  mutate(
    `insert into fl_survey_assignee
       (id, survey_id, user_email, user_id, participation, discipline_ids_json, is_lead,
        assigned_by, assigned_at, is_active, data_json, created_at, updated_at)
     select gen_random_uuid()::text, $1, v.user_email,
            (select u.id from fl_user u where u.email_norm = v.user_email limit 1),
            v.participation, v.discipline_ids, 'false',
            $2, $3, 'true', '{}', $3, $3
       from (values ${tuples.join(", ")}) as v(user_email, participation, discipline_ids)
      where not exists (select 1 from fl_survey_assignee a
                         where a.survey_id = $1 and a.user_email = v.user_email
                           and a.is_active = 'true')`,
    params
  );

  appendEvent({
    entityType: "survey",
    entityId: surveyId,
    kind: "assigned",
    actor,
    // Names, since they are in hand — the timeline is read by people (X-05).
    body: cleaned.map((a) => byEmail.get(a.userEmail)?.name ?? a.userEmail).join(", "),
  });

  return { assignees: readAssignees(surveyId) };
}

/**
 * T3. `fl_survey.lead_assignee_id` is the single source of truth (X1): one
 * single-statement update, so two people clicking at once cannot produce two
 * leads — the second write simply wins, visibly, and the handover is logged.
 */
export function setLead(
  surveyId: string,
  assigneeId: string,
  reason: string | null,
  actor: string | null
): { survey: SurveyRecord } {
  const survey = one<{ id: string; status: SurveyStatus; leadUserEmail: string | null }>(
    `select id, status, lead_user_email from fl_survey where id = $1 and is_active = 'true' limit 1`,
    [surveyId]
  );
  if (!survey) throw new Error(`survey ${surveyId} not found`);

  const assignee = one<{ id: string; userEmail: string }>(
    `select id, user_email from fl_survey_assignee
      where id = $1 and survey_id = $2 and is_active = 'true' limit 1`,
    [assigneeId, surveyId]
  );
  if (!assignee) throw new Error(`assignee ${assigneeId} not found on this survey`);

  const now = nowIso();
  mutate(
    `update fl_survey
        set lead_assignee_id = $2, lead_user_email = $3, updated_by = $4, updated_at = $5
      where id = $1 and is_active = 'true'`,
    [surveyId, assignee.id, assignee.userEmail, actor, now]
  );

  appendEvent({
    entityType: "survey",
    entityId: surveyId,
    kind: "lead_handover",
    actor,
    body: `${survey.leadUserEmail ?? "nobody"} → ${assignee.userEmail}`,
    meta: reason ? { reason } : {},
  });

  // T3 — setting the first lead is what moves scheduled → assigned.
  if (survey.status === "scheduled") {
    validateSurveyTransition({ from: "scheduled", to: "assigned", actorIsLead: false });
    mutate(
      `update fl_survey
          set status = 'assigned', status_changed_at = $2, status_changed_by = $3,
              updated_by = $3, updated_at = $2
        where id = $1 and status = 'scheduled'`,
      [surveyId, now, actor]
    );
    appendEvent({
      entityType: "survey",
      entityId: surveyId,
      kind: "status_change",
      actor,
      body: "T3: scheduled → assigned",
    });
  }

  const fresh = one<SurveyRecord>(
    `select ${SURVEY_COLUMNS},
            (select a.name from fl_account a where a.id = s.account_id) as account_name,
            (select t.name from fl_form_template t where t.id = s.template_id) as template_name
       from fl_survey s where s.id = $1 limit 1`,
    [surveyId]
  );
  return { survey: fresh as SurveyRecord };
}

// ── The person picker ─────────────────────────────────────────────────────────

export interface UserOption {
  id: string;
  name: string;
  email: string;
  roleName: string | null;
  team: string | null;
  region: string | null;
  /** Planned visits in the next 7 days on surveys this user is assigned to. */
  weekVisits: number;
}

/**
 * D-19: a coordinator thinks in people and availability, so the picker shows
 * both — who exists (fl_user, active only) and how loaded they are (planned
 * visits over the coming week). The load is a correlated count rather than a
 * join because fl_survey_visit_assignee is never written yet: today a person's
 * visits are the planned visits of the surveys they are assigned to.
 *
 * Reading fl_user here does not widen the access function — functions share
 * one schema, and this is the survey module's own input boundary, the same
 * standing as listDeals reading fl_deal.
 */
export function listUserOptions(now = nowIso()): { users: UserOption[] } {
  const horizon = new Date(new Date(now).getTime() + 7 * 24 * 3600 * 1000).toISOString();
  const rows = many<UserOption & { weekVisits: unknown }>(
    `select u.id, u.name, u.email, u.team, u.region,
            (select r.name from fl_role r where r.id = u.role_id limit 1) as role_name,
            (select count(*)
               from fl_survey_visit v
              where v.is_active = 'true' and v.status = 'planned'
                and v.scheduled_start >= $1 and v.scheduled_start < $2
                and exists (select 1 from fl_survey_assignee sa
                             where sa.survey_id = v.survey_id
                               and sa.user_email = u.email_norm
                               and sa.is_active = 'true')) as week_visits
       from fl_user u
      where u.status = 'active'
      order by u.name
      limit 500`,
    [now, horizon]
  );
  // count(*) arrives as a string on this platform — coerce once, here.
  return { users: rows.map((u) => ({ ...u, weekVisits: Number(u.weekVisits ?? 0) })) };
}

// ── The deal picker ───────────────────────────────────────────────────────────

export interface DealOption {
  id: string;
  refNo: string;
  title: string | null;
  stage: string;
  accountName: string | null;
  estimatedValue: number | null;
  currency: string | null;
  surveyCount: number;
}

/**
 * Read-only helper for the create dialog: a survey is raised AGAINST a deal,
 * so the picker needs the deals. Reading `fl_deal` here does not widen the
 * lead function — functions share one schema, and this is the survey module's
 * own input boundary.
 */
export function listDeals(): { deals: DealOption[] } {
  const rows = manyWithTruncation<DealOption & { surveyCount: unknown }>(
    `select d.id, d.ref_no, d.title, d.stage, d.estimated_value, d.currency,
            (select a.name from fl_account a where a.id = d.account_id) as account_name,
            (select count(*) from fl_survey s
              where s.deal_id = d.id and s.is_active = 'true') as survey_count
       from fl_deal d
      order by d.created_at desc
      limit 100`
  ).rows;

  return { deals: rows.map((d) => ({ ...d, surveyCount: Number(d.surveyCount ?? 0) })) };
}
