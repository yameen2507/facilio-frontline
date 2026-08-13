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
  incrementsRework,
  stampColumnsFor,
  SURVEY_STATUSES,
  validateSurveyTransition,
  type SurveyStatus,
} from "../domain/survey-state";
import { count, manyWithTruncation, mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";
import { nextRef } from "../shared/ids";
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
  contractIntent: string | null;
  targetCompletionDate: string | null;
  revisionNo: number | null;
  reworkCount: number | null;
  completenessPct: number | null;
  notVisitedPct: number | null;
  notes?: string | null;
  statusChangedAt: string | null;
  createdAt: string;
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
  notes, status_changed_at, created_at, updated_at`;

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
  /** How much of the template the T2 snapshot copied — the walk's size. */
  snapshot: { sections: number; questions: number };
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
          select id, user_email, participation, discipline_ids_json, assigned_at
            from fl_survey_assignee
           where survey_id = $1 and is_active = 'true'
        ) x) as assignees_arr,

       (select coalesce(json_agg(x order by x.ancestry_path), '[]'::json) from (
          select id, name, node_type, parent_node_id, ancestry_path, verdict, verdict_note,
                 area_sqft, room_count, restroom_count, floor_label, provenance, facilio_id
            from fl_prospect_node
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
    snapshot: {
      sections: Number(row.sectionInstanceCount ?? 0),
      questions: Number(row.questionInstanceCount ?? 0),
    },
  };
}

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreateSurveyInput {
  dealId: string;
  templateId?: string | null;
  title?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  timezone?: string | null;
  targetCompletionDate?: string | null;
  actor: string | null;
}

/**
 * v1.7 §A1.0: creating a survey asks three things — the deal, optionally a
 * template, optionally a first visit date. Only the deal is mandatory. A date
 * fires T1+T2 together (visit #1 + `scheduled` + the snapshot); no date lands
 * the survey in `draft`, to be scheduled later (D-l).
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

  const row = one<{ id: string }>(
    `insert into fl_survey
       (id, ref_no, deal_id, account_id, title, template_id, template_version_no,
        buildings_in_scope_json, status, status_changed_at, status_changed_by,
        disciplines_required_json, is_condition_survey_complete, target_completion_date,
        revision_no, rework_count, notes,
        created_by, updated_by, is_active, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
             '[]', 'draft', $7, $8,
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
    ]
  );
  if (!row) throw new Error("survey insert returned no row");

  appendEvent({
    entityType: "survey",
    entityId: row.id,
    kind: "created",
    actor: input.actor,
    body: refNo,
    meta: { dealId: deal.id, templateId: template?.id ?? null },
  });

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

// ── Transition ────────────────────────────────────────────────────────────────

export function transitionSurvey(input: {
  surveyId: string;
  toStatus: string;
  reason?: string | null;
  actor: string | null;
}): { survey: SurveyRecord } {
  const survey = one<{ id: string; refNo: string; status: SurveyStatus; leadUserEmail: string | null }>(
    `select id, ref_no, status, lead_user_email
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

  const now = nowIso();
  const sets: string[] = [];
  const params: unknown[] = [input.surveyId, move.to, now, input.actor];

  const stamps = stampColumnsFor(move.to);
  if (stamps.includes("cancel_reason")) {
    params.push(move.reason);
    sets.push(`cancel_reason = $${params.length}`, "cancelled_by = $4", "cancelled_at = $3");
  }
  if (stamps.includes("submitted_by")) {
    sets.push("submitted_by = $4", "submitted_at = $3");
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

  appendEvent({
    entityType: "survey",
    entityId: input.surveyId,
    kind: "status_change",
    actor: input.actor,
    body: `${move.code}: ${move.from} → ${move.to}`,
    meta: move.reason ? { reason: move.reason } : {},
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
