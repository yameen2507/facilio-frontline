/**
 * The walk — the surveyor's hot path. Backend Plan §6.2/§6.3 made concrete:
 *
 *  - `walkState` is ONE batched read: survey, visit, section instances with
 *    nested question instances, entries, answers, observations, photos.
 *  - `captureBatch` writes a whole room in a handful of set-based statements —
 *    entries, auto-created space nodes, answers, observations and photo rows —
 *    then runs the T4 cascade (visit `planned → in_progress` FIRST, then the
 *    survey `assigned → in_progress`, X7) and returns the refreshed walk state
 *    so the client needs no second trip.
 *
 * IDEMPOTENCY: every row carries a CLIENT-SUPPLIED id, and every bulk insert is
 * `insert … select … from (values …) where not exists (id)`. There are no
 * transactions, so a payload that half-lands WILL happen — the client retries
 * the same payload with the same ids and the re-run completes it, never
 * duplicating what already landed.
 *
 * ANSWERS ARE APPEND-ONLY. Re-answering writes a new row; reads take the
 * latest per (question, entry) by `answered_at`. The `superseded_by_answer_id`
 * chain from the plan is deferred until review needs to render history.
 *
 * PHOTOS land in `fl_photo` (X4): `kind`, the geo triple, the device's
 * `captured_at` AND the server's `uploaded_at` ride in `data_json` — device
 * clocks lie (F14), and the pair is what makes the evidence chain honest.
 */

import { getSetting } from "./settings";
import { many, mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";

/** QuickJS has no crypto module; ids that only need uniqueness use this. */
export function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface CaptureEntry {
  id?: string;
  sectionInstanceId: string;
  entryLabel: string;
  entryNo?: number | null;
}

export interface CaptureAnswer {
  id?: string;
  questionInstanceId: string;
  sectionEntryId?: string | null;
  valueText?: string | null;
  valueNumber?: number | null;
  valueBool?: boolean | null;
  valueJson?: unknown;
  valueDate?: string | null;
  isNa?: boolean;
  naReason?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  geoAccuracyM?: number | null;
}

export interface CaptureObservation {
  id?: string;
  sectionEntryId?: string | null;
  prospectNodeId?: string | null;
  conditionScore?: number | null;
  contaminationLevel?: string | null;
  buildupNote?: string | null;
  accessConstraint?: string | null;
  safetyNote?: string | null;
  suggestedFrequency?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  geoAccuracyM?: number | null;
}

export interface CapturePhoto {
  id?: string;
  /** What the photo evidences: survey, survey_visit, section_entry, answer, observation, prospect_node. */
  entityType: string;
  entityId: string;
  vibeFileId: number;
  fileName?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  caption?: string | null;
  kind?: string | null;
  capturedAt?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  geoAccuracyM?: number | null;
}

const PHOTO_ENTITY_TYPES = [
  "survey",
  "survey_visit",
  "section_entry",
  "answer",
  "observation",
  "prospect_node",
];

// ── The batched read ─────────────────────────────────────────────────────────

const SECTION_INSTANCE_COLUMNS = `id, source_section_id, name, description, sequence_no,
  level_binding, is_repeatable, repeat_label, min_repeats, max_repeats,
  creates_portfolio_node, node_type_created, added_ad_hoc`;

const QUESTION_INSTANCE_COLUMNS = `id, section_instance_id, source_question_id, label, help_text,
  field_type, options_json, allow_multiple, sequence_no, is_required, feeds_estimation,
  estimation_key, unit, added_ad_hoc`;

const ENTRY_COLUMNS = `id, section_instance_id, entry_no, entry_label, prospect_node_id, visit_id, created_by`;

const ANSWER_COLUMNS = `id, question_instance_id, section_entry_id, value_text, value_number,
  value_bool, value_json, value_date, is_na, na_reason, answered_by, answered_at, visit_id`;

const OBSERVATION_COLUMNS = `id, section_entry_id, prospect_node_id, condition_score,
  contamination_level, buildup_note, access_constraint, safety_note, suggested_frequency,
  observed_by, observed_at, visit_id`;

export function walkState(surveyId: string, visitId?: string | null): Record<string, unknown> {
  const row = one<Record<string, unknown>>(
    `select
       (select row_to_json(x) from (
          select id, ref_no, title, status, deal_id, template_id, template_version_no,
                 lead_user_email, lead_assignee_id
            from fl_survey where id = $1 and is_active = 'true'
        ) x) as survey_obj,

       (select row_to_json(x) from (
          select id, visit_number, sequence_no, status, scheduled_start, scheduled_end, timezone
            from fl_survey_visit
           where survey_id = $1 and is_active = 'true'
             and ($2::text is null or id = $2)
           order by case status when 'in_progress' then 0 when 'planned' then 1 else 2 end,
                    sequence_no
           limit 1
        ) x) as visit_obj,

       (select coalesce(json_agg(x order by x.sequence_no), '[]'::json) from (
          select ${SECTION_INSTANCE_COLUMNS},
                 (select coalesce(json_agg(q order by q.sequence_no), '[]'::json) from (
                    select ${QUESTION_INSTANCE_COLUMNS} from fl_survey_question_instance
                     where section_instance_id = s.id and is_active = 'true'
                  ) q) as questions
            from fl_survey_section_instance s
           where s.survey_id = $1 and s.is_active = 'true'
        ) x) as sections_arr,

       (select coalesce(json_agg(x order by x.entry_no), '[]'::json) from (
          select ${ENTRY_COLUMNS} from fl_survey_section_entry
           where survey_id = $1 and is_active = 'true'
        ) x) as entries_arr,

       (select coalesce(json_agg(x order by x.answered_at), '[]'::json) from (
          select ${ANSWER_COLUMNS} from fl_survey_answer
           where survey_id = $1 and is_active = 'true'
           limit 2000
        ) x) as answers_arr,

       (select coalesce(json_agg(x order by x.observed_at), '[]'::json) from (
          select ${OBSERVATION_COLUMNS} from fl_survey_observation
           where survey_id = $1 and is_active = 'true'
           limit 1000
        ) x) as observations_arr,

       (select coalesce(json_agg(x order by x.created_at), '[]'::json) from (
          select id, entity_type, entity_id, vibe_file_id, file_name, content_type,
                 size_bytes, caption, data_json, created_at
            from fl_photo
           where (entity_type = 'survey' and entity_id = $1)
              or entity_id in (select id from fl_survey_visit where survey_id = $1)
              or entity_id in (select id from fl_survey_section_entry where survey_id = $1)
              or entity_id in (select id from fl_survey_answer where survey_id = $1)
              or entity_id in (select id from fl_survey_observation where survey_id = $1)
              or entity_id in (select id from fl_prospect_node where survey_id = $1)
           limit 1000
        ) x) as photos_arr`,
    [surveyId, visitId ?? null]
  );

  if (!row?.survey) throw new Error(`survey ${surveyId} not found`);

  return {
    survey: row.survey,
    visit: row.visit ?? null,
    sections: row.sections,
    entries: row.entries,
    answers: row.answers,
    observations: row.observations,
    photos: row.photos,
  };
}

// ── Bulk-insert plumbing ─────────────────────────────────────────────────────

/**
 * One idempotent multi-row insert. The first VALUES row carries explicit casts
 * — Postgres resolves each column's type from it, and an all-null column with
 * no cast is an error, not a guess.
 */
function bulkInsert(
  table: string,
  columns: string[],
  casts: string[],
  rows: unknown[][]
): number {
  if (!rows.length) return 0;

  const params: unknown[] = [];
  const tuples = rows.map((row, rowIndex) => {
    const slots = row.map((value, i) => {
      params.push(value);
      return `$${params.length}${rowIndex === 0 ? `::${casts[i]}` : ""}`;
    });
    return `(${slots.join(", ")})`;
  });

  const colList = columns.join(", ");
  return mutate(
    `insert into ${table} (${colList})
     select * from (values ${tuples.join(", ")}) as v(${colList})
      where not exists (select 1 from ${table} t where t.id = v.id)`,
    params
  );
}

// ── The batch write ──────────────────────────────────────────────────────────

export interface CaptureInput {
  surveyId: string;
  visitId: string;
  entries: CaptureEntry[];
  answers: CaptureAnswer[];
  observations: CaptureObservation[];
  photos: CapturePhoto[];
  actor: string | null;
}

export function captureBatch(input: CaptureInput): Record<string, unknown> {
  const now = nowIso();

  // One read establishes everything the validation needs: survey and visit
  // status, which instances exist, which entries exist, and which entries the
  // existing answers belong to.
  const ctx = one<{
    survey: { id: string; status: string; dealId: string } | null;
    visit: { id: string; status: string } | null;
    sectionIds: { id: string; createsPortfolioNode: string; nodeTypeCreated: string | null }[];
    questionIds: { id: string }[];
    entryRows: { id: string; sectionInstanceId: string; entryNo: number | null }[];
    answerRows: { id: string; sectionEntryId: string | null }[];
  }>(
    `select
       (select row_to_json(x) from (
          select id, status, deal_id from fl_survey where id = $1 and is_active = 'true'
        ) x) as survey_obj,
       (select row_to_json(x) from (
          select id, status from fl_survey_visit
           where id = $2 and survey_id = $1 and is_active = 'true'
        ) x) as visit_obj,
       (select coalesce(json_agg(x), '[]'::json) from (
          select id, creates_portfolio_node, node_type_created
            from fl_survey_section_instance where survey_id = $1 and is_active = 'true'
        ) x) as section_ids_arr,
       (select coalesce(json_agg(x), '[]'::json) from (
          select id from fl_survey_question_instance where survey_id = $1 and is_active = 'true'
        ) x) as question_ids_arr,
       (select coalesce(json_agg(x), '[]'::json) from (
          select id, section_instance_id, entry_no
            from fl_survey_section_entry where survey_id = $1 and is_active = 'true'
        ) x) as entry_rows_arr,
       (select coalesce(json_agg(x), '[]'::json) from (
          select id, section_entry_id from fl_survey_answer
           where survey_id = $1 and is_active = 'true' limit 2000
        ) x) as answer_rows_arr`,
    [input.surveyId, input.visitId]
  );

  const survey = ctx?.survey;
  if (!survey) throw new Error(`survey ${input.surveyId} not found`);
  if (survey.status !== "assigned" && survey.status !== "in_progress") {
    throw new Error(
      `capture is only possible on an assigned or in-progress survey — this one is ${survey.status}` +
        (survey.status === "scheduled" ? ". Assign the team and set a lead first" : "")
    );
  }

  const visit = ctx.visit;
  if (!visit) throw new Error(`visit ${input.visitId} not found on this survey`);
  if (visit.status !== "planned" && visit.status !== "in_progress") {
    throw new Error(`visit is ${visit.status} — captures need a planned or in-progress visit`);
  }

  // ── Normalise ids and validate every reference BEFORE the first write ─────
  const sectionById = new Map(ctx.sectionIds.map((s) => [s.id, s]));
  const questionIds = new Set(ctx.questionIds.map((q) => q.id));
  const knownEntryIds = new Set(ctx.entryRows.map((e) => e.id));

  const entries = input.entries.map((e) => ({ ...e, id: e.id ?? fallbackUuid() }));
  const answers = input.answers.map((a) => ({ ...a, id: a.id ?? fallbackUuid() }));
  const observations = input.observations.map((o) => ({ ...o, id: o.id ?? fallbackUuid() }));
  const photos = input.photos.map((p) => ({ ...p, id: p.id ?? fallbackUuid() }));

  const payloadEntryIds = new Set(entries.map((e) => e.id as string));

  for (const e of entries) {
    if (!sectionById.has(e.sectionInstanceId)) {
      throw new Error(`entry "${e.entryLabel}" names a section instance not on this survey`);
    }
    if (!e.entryLabel?.trim()) throw new Error("every entry needs a label");
  }
  for (const a of answers) {
    if (!questionIds.has(a.questionInstanceId)) {
      throw new Error("an answer names a question instance not on this survey");
    }
    if (a.sectionEntryId && !knownEntryIds.has(a.sectionEntryId) && !payloadEntryIds.has(a.sectionEntryId)) {
      throw new Error("an answer names a section entry that neither exists nor is in this payload");
    }
  }
  for (const o of observations) {
    if (o.sectionEntryId && !knownEntryIds.has(o.sectionEntryId) && !payloadEntryIds.has(o.sectionEntryId)) {
      throw new Error("an observation names a section entry that neither exists nor is in this payload");
    }
    if (o.conditionScore != null && (o.conditionScore < 1 || o.conditionScore > 5)) {
      throw new Error("conditionScore is a 1–5 scale");
    }
  }
  for (const p of photos) {
    if (!PHOTO_ENTITY_TYPES.includes(p.entityType)) {
      throw new Error(`photo entityType must be one of: ${PHOTO_ENTITY_TYPES.join(", ")}`);
    }
    if (!p.entityId) throw new Error("every photo names the entity it evidences");
    if (!Number.isFinite(Number(p.vibeFileId))) throw new Error("photo vibeFileId must be a number");
  }

  // ── The photo-below-condition rule, enforced where the write happens ──────
  const threshold = Number(getSetting("survey.require_photo_below_condition", 2));
  const answerEntryByAnswerId = new Map<string, string | null>([
    ...ctx.answerRows.map((a) => [a.id, a.sectionEntryId] as const),
    ...answers.map((a) => [a.id as string, a.sectionEntryId ?? null] as const),
  ]);
  const photoTouchesEntry = (entryId: string) =>
    photos.some(
      (p) =>
        p.entityId === entryId ||
        (p.entityType === "answer" && answerEntryByAnswerId.get(p.entityId) === entryId)
    );

  const needing = observations.filter(
    (o) =>
      o.conditionScore != null &&
      o.conditionScore <= threshold &&
      o.sectionEntryId &&
      !photos.some((p) => p.entityId === o.id) &&
      !photoTouchesEntry(o.sectionEntryId)
  );
  if (needing.length) {
    // A photo attached on an earlier save also satisfies the rule.
    const entryIds = needing.map((o) => o.sectionEntryId as string);
    const already = new Set(
      many<{ entityId: string }>(
        `select entity_id from fl_photo
          where entity_id in (${entryIds.map((_, i) => `$${i + 1}`).join(", ")})
          limit 100`,
        entryIds
      ).map((r) => r.entityId)
    );
    const still = needing.filter((o) => !already.has(o.sectionEntryId as string));
    if (still.length) {
      const labels = still.map((o) => {
        const entry =
          entries.find((e) => e.id === o.sectionEntryId) ??
          ({ entryLabel: "an entry" } as CaptureEntry);
        return `"${entry.entryLabel}" (scored ${o.conditionScore})`;
      });
      throw new Error(
        `a condition of ${threshold} or below needs a photo before it can be saved: ${labels.join(", ")}`
      );
    }
  }

  // ── Writes, most-referenced first ──────────────────────────────────────────
  let written = { entries: 0, nodes: 0, answers: 0, observations: 0, photos: 0 };

  if (entries.length) {
    // entry_no continues each section's own count.
    const maxNoBySection = new Map<string, number>();
    for (const e of ctx.entryRows) {
      const cur = maxNoBySection.get(e.sectionInstanceId) ?? 0;
      maxNoBySection.set(e.sectionInstanceId, Math.max(cur, Number(e.entryNo ?? 0)));
    }

    written.entries = bulkInsert(
      "fl_survey_section_entry",
      ["id", "survey_id", "section_instance_id", "entry_no", "entry_label", "visit_id",
        "created_by", "is_active", "data_json", "created_at", "updated_at"],
      ["text", "text", "text", "numeric", "text", "text", "text", "text", "text", "text", "text"],
      entries.map((e) => {
        const next = (maxNoBySection.get(e.sectionInstanceId) ?? 0) + 1;
        maxNoBySection.set(e.sectionInstanceId, next);
        return [e.id, input.surveyId, e.sectionInstanceId, e.entryNo ?? next, e.entryLabel.trim(),
          input.visitId, input.actor, "true", "{}", now, now];
      })
    );

    // The portfolio built as a by-product (D-p): a repeat entry on a section
    // that creates nodes gets a space node, id derived so the re-run is a no-op.
    const nodeEntryIds = entries
      .filter((e) => sectionById.get(e.sectionInstanceId)?.createsPortfolioNode === "true")
      .map((e) => e.id as string);

    if (nodeEntryIds.length) {
      const marks = nodeEntryIds.map((_, i) => `$${i + 4}`).join(", ");
      written.nodes = mutate(
        `insert into fl_prospect_node
           (id, deal_id, survey_id, node_type, parent_node_id, ancestry_path, name,
            provenance, verdict, created_by, updated_by, is_active, data_json, created_at, updated_at)
         select md5('node:' || e.id)::uuid::text, $1, $2, coalesce(i.node_type_created, 'space'),
                null, md5('node:' || e.id)::uuid::text, e.entry_label,
                'survey', 'added_on_site', $3, $3, 'true', '{}', e.created_at, e.created_at
           from fl_survey_section_entry e
           join fl_survey_section_instance i on i.id = e.section_instance_id
          where e.survey_id = $2 and e.id in (${marks})
            and not exists (select 1 from fl_prospect_node n
                             where n.id = md5('node:' || e.id)::uuid::text)`,
        [survey.dealId, input.surveyId, input.actor, ...nodeEntryIds]
      );

      mutate(
        `update fl_survey_section_entry e
            set prospect_node_id = md5('node:' || e.id)::uuid::text
           from fl_survey_section_instance i
          where i.id = e.section_instance_id
            and e.survey_id = $1 and e.id in (${nodeEntryIds.map((_, i) => `$${i + 2}`).join(", ")})
            and i.creates_portfolio_node = 'true' and e.prospect_node_id is null`,
        [input.surveyId, ...nodeEntryIds]
      );
    }
  }

  if (answers.length) {
    written.answers = bulkInsert(
      "fl_survey_answer",
      ["id", "survey_id", "question_instance_id", "section_entry_id", "value_text", "value_number",
        "value_bool", "value_json", "value_date", "is_na", "na_reason", "answered_by", "answered_at",
        "visit_id", "geo_lat", "geo_lng", "geo_accuracy_m", "is_active", "data_json",
        "created_at", "updated_at"],
      ["text", "text", "text", "text", "text", "numeric", "text", "text", "text", "text", "text",
        "text", "text", "text", "numeric", "numeric", "numeric", "text", "text", "text", "text"],
      answers.map((a) => [
        a.id, input.surveyId, a.questionInstanceId, a.sectionEntryId ?? null,
        a.valueText ?? null, a.valueNumber ?? null,
        a.valueBool === undefined || a.valueBool === null ? null : String(a.valueBool),
        a.valueJson === undefined || a.valueJson === null ? null : JSON.stringify(a.valueJson),
        a.valueDate ?? null, String(a.isNa ?? false), a.naReason ?? null,
        input.actor, now, input.visitId,
        a.geoLat ?? null, a.geoLng ?? null, a.geoAccuracyM ?? null,
        "true", "{}", now, now,
      ])
    );
  }

  if (observations.length) {
    written.observations = bulkInsert(
      "fl_survey_observation",
      ["id", "survey_id", "visit_id", "section_entry_id", "prospect_node_id", "condition_score",
        "contamination_level", "buildup_note", "access_constraint", "safety_note",
        "suggested_frequency", "observed_by", "observed_at", "geo_lat", "geo_lng", "geo_accuracy_m",
        "is_active", "data_json", "created_at", "updated_at"],
      ["text", "text", "text", "text", "text", "numeric", "text", "text", "text", "text",
        "text", "text", "text", "numeric", "numeric", "numeric", "text", "text", "text", "text"],
      observations.map((o) => [
        o.id, input.surveyId, input.visitId, o.sectionEntryId ?? null, o.prospectNodeId ?? null,
        o.conditionScore ?? null, o.contaminationLevel ?? null, o.buildupNote ?? null,
        o.accessConstraint ?? null, o.safetyNote ?? null, o.suggestedFrequency ?? null,
        input.actor, now, o.geoLat ?? null, o.geoLng ?? null, o.geoAccuracyM ?? null,
        "true", "{}", now, now,
      ])
    );
  }

  if (photos.length) {
    written.photos = insertPhotos(photos, input.surveyId, input.actor, now);
  }

  // ── T4, X7: the visit moves FIRST, then the survey cascades ───────────────
  if (visit.status === "planned") {
    mutate(
      `update fl_survey_visit
          set status = 'in_progress', actual_start_at = $2, updated_by = $3, updated_at = $2
        where id = $1 and status = 'planned'`,
      [input.visitId, now, input.actor]
    );
  }
  if (survey.status === "assigned") {
    mutate(
      `update fl_survey
          set status = 'in_progress', status_changed_at = $2, status_changed_by = $3,
              updated_by = $3, updated_at = $2
        where id = $1 and status = 'assigned'`,
      [input.surveyId, now, input.actor]
    );
    appendEvent({
      entityType: "survey",
      entityId: input.surveyId,
      kind: "status_change",
      actor: input.actor,
      body: "T4: assigned → in_progress (first capture)",
    });
  }

  appendEvent({
    entityType: "survey",
    entityId: input.surveyId,
    kind: "capture",
    actor: input.actor,
    meta: { visitId: input.visitId, ...written },
  });

  return { written, ...walkState(input.surveyId, input.visitId) };
}

// ── Photos ───────────────────────────────────────────────────────────────────

function insertPhotos(
  photos: (CapturePhoto & { id: string })[],
  surveyId: string,
  actor: string | null,
  now: string
): number {
  return bulkInsert(
    "fl_photo",
    ["id", "entity_type", "entity_id", "vibe_file_id", "file_name", "content_type",
      "size_bytes", "caption", "data_json", "created_at", "updated_at"],
    ["text", "text", "text", "numeric", "text", "text", "numeric", "text", "text", "text", "text"],
    photos.map((p) => [
      p.id, p.entityType, p.entityId, Number(p.vibeFileId),
      p.fileName ?? null, p.contentType ?? null, p.sizeBytes ?? null, p.caption ?? null,
      JSON.stringify({
        surveyId,
        kind: p.kind ?? "photo",
        capturedAt: p.capturedAt ?? null, // the device's clock…
        uploadedAt: now, //                 …and the server's (F14)
        uploadedBy: actor,
        geoLat: p.geoLat ?? null,
        geoLng: p.geoLng ?? null,
        geoAccuracyM: p.geoAccuracyM ?? null,
      }),
      now, now,
    ])
  );
}

/** One photo outside a capture batch — the detail page attaching evidence later. */
export function attachPhoto(
  surveyId: string,
  photo: CapturePhoto,
  actor: string | null
): { photo: Record<string, unknown> } {
  if (!PHOTO_ENTITY_TYPES.includes(photo.entityType)) {
    throw new Error(`entityType must be one of: ${PHOTO_ENTITY_TYPES.join(", ")}`);
  }
  if (!Number.isFinite(Number(photo.vibeFileId))) throw new Error("vibeFileId must be a number");

  const exists = one<{ id: string }>(
    `select id from fl_survey where id = $1 and is_active = 'true' limit 1`,
    [surveyId]
  );
  if (!exists) throw new Error(`survey ${surveyId} not found`);

  const now = nowIso();
  const id = photo.id ?? fallbackUuid();
  insertPhotos([{ ...photo, id }], surveyId, actor, now);

  appendEvent({
    entityType: photo.entityType,
    entityId: photo.entityId,
    kind: "photo",
    actor,
    body: photo.caption ?? photo.fileName ?? null,
    meta: { surveyId, vibeFileId: photo.vibeFileId },
  });

  const row = one<Record<string, unknown>>(
    `select id, entity_type, entity_id, vibe_file_id, file_name, content_type, size_bytes,
            caption, data_json, created_at
       from fl_photo where id = $1 limit 1`,
    [id]
  );
  return { photo: row ?? { id } };
}
