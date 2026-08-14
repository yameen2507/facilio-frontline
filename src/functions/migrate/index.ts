/**
 * Schema housekeeping. Deliberately NOT DDL — the app's DB role cannot create,
 * alter, drop or index anything (ARCHITECTURE.md §3a). Tables are created by
 * `node scripts/db-import.mjs`; this function only manages their contents:
 *
 *  - clean-seed  removes the type-inference seed row each imported table carries
 *  - seed-config seeds sequences and default SLA settings
 *  - status      row counts, so a migration can be verified without a UI
 *  - seed-proposal-demo  one rate card + one frozen survey revision, so the
 *                        proposal lane is not blocked behind `survey.submit`
 *  - seed-proposal-template  the one template P1 ships (Proposal Spec §6)
 */

import StudioFunctions from "@facilio/studio-functions";
import { count, many, mutate, nowIso, one } from "../../shared/db";
import { checksum, verifyChecksum } from "../../domain/survey-revision";
import { DEFAULT_TEMPLATE } from "../../domain/proposal-document";

const SEED_ID = "00000000-0000-0000-0000-000000000000";

const TABLES = [
  "fl_setting",
  "fl_sequence",
  "fl_event",
  "fl_sync_task",
  "fl_photo",
  "fl_service_area",
  "fl_service_line",
  "fl_service_coverage",
  "fl_lead",
  "fl_lead_analysis",
  "fl_lead_assignment",
  "fl_account",
  "fl_account_contact",
  "fl_deal",
  "fl_intake_session",
  "fl_intake_message",

  // --- survey module (Backend Plan v1 §3) — 18 tables, imported together ----
  "fl_form_template",
  "fl_form_section",
  "fl_form_question",
  "fl_survey",
  "fl_survey_visit",
  "fl_survey_assignee",
  "fl_survey_visit_assignee",
  "fl_survey_section_instance",
  "fl_survey_question_instance",
  "fl_survey_section_entry",
  "fl_survey_answer",
  "fl_survey_observation",
  "fl_prospect_node",
  "fl_prospect_location",
  "fl_prospect_convert_log",
  "fl_prospect_observation",
  "fl_survey_recommendation",
  "fl_survey_qualification",
  "fl_survey_reconciliation",
  "fl_survey_revision",

  // --- access module (roles&response spec §5–§9) — 2 tables ------------------
  "fl_user",
  "fl_role",

  // --- proposal module (Proposal Spec v1 §2) — 5 tables ---------------------
  // The never-imported fl_quote / fl_quote_line / fl_rate_card_entry drafts
  // were redrawn under these names before the first import, so there is no
  // migration behind them — only a rename on paper.
  "fl_rate_card",
  "fl_rate_card_row",
  "fl_proposal",
  "fl_proposal_line",
  "fl_proposal_template",
];

/**
 * Ref-number counters. Values are the last number issued.
 *
 * There is deliberately NO `visit` sequence: a visit number is composed as
 * `{survey.ref_no}/V{sequence_no}`, which is derivable, unique within its
 * survey, and one fewer row to keep in step.
 */
const SEQUENCES = [
  { name: "lead", prefix: "LEAD" },
  { name: "deal", prefix: "DEAL" },
  { name: "survey", prefix: "SUR" },
  // PRP-00042 v2 — the revision number is not part of the ref, because a
  // revision is a new row sharing its parent's ref_no (Proposal Spec §2).
  { name: "proposal", prefix: "PRP" },
  // Seeded at 0; access.seed bumps it to 9 after inserting the spec's fixed
  // ROLE-001…ROLE-009 codes, so user-created roles start at ROLE-010.
  { name: "role", prefix: "ROLE" },
];

/**
 * SLA targets in minutes, from lead arrival. Overdue is derived at read time by
 * comparing these stamps against now — there is no scheduler until the app is
 * promoted to production, and none is needed to SHOW overdue.
 */
const DEFAULT_SETTINGS: Record<string, unknown> = {
  "sla.first_response_mins": 60,
  "sla.qualification_mins": 1440,
  "sla.assignment_mins": 2880,
  "lead.default_currency": "AED",
  "lead.assignment_mode": "claim",
  "lead.auto_analyse": true,

  // --- survey module settings ----------------------------------------------
  // The survey spec asks for a wide `survey_module_settings` singleton table.
  // The house pattern is key/value, so these are keys — same information, one
  // settings mechanism instead of two. Seeded here because a capture handler
  // reading an ABSENT key gets null and silently falls back, which is a worse
  // failure than a missing row: nothing errors and the wrong number ships.
  //
  // ⚠ `condition_scale_direction` IS NOT YET DECIDED (D-e) AND IT FEEDS PRICING.
  // `1_is_worst` means 5 = excellent, the FM convention. The cleaning-buildup
  // convention is the exact opposite, and both live in this product. Two teams
  // reading this number in opposite directions is real money on a semi-comp
  // contract. This default is a placeholder awaiting Sudharsan's call — confirm
  // it before capture ships, and render the WORD beside every score, never the
  // bare number.
  "survey.condition_scale_direction": "1_is_worst",
  "survey.condition_scale_labels": {
    "1": "Critical",
    "2": "Poor",
    "3": "Fair",
    "4": "Good",
    "5": "Excellent",
  },
  "survey.contamination_levels": [
    "none",
    "light_dust_film",
    "moderate_residue",
    "heavy_debris",
    "hazardous",
  ],
  "survey.suggested_frequencies": [
    "one_time",
    "daily",
    "weekly",
    "fortnightly",
    "monthly",
    "quarterly",
    "annual",
  ],
  // Capture only — never live tracking. No background location, no tracking table.
  "survey.geotag_capture": "best_effort",
  "survey.geotag_accuracy_warn_m": 100,
  // A condition at or below this needs a photo before the row can be saved.
  "survey.require_photo_below_condition": 2,
  // Warn, never block, above this share of seeded nodes left unvisited.
  "survey.not_visited_warn_threshold_pct": 20,
  "survey.allow_complete_with_not_visited": true,
  // Banner, not a block — an unbounded rework loop should at least be visible.
  "survey.rework_warn_after_bounces": 3,
  // Device clock vs server clock on geotagged photos; drift corrupts the
  // evidence chain the qualification defence rests on.
  "survey.clock_drift_warn_minutes": 60,
  // Notify only. The BD moves the deal stage by hand — no auto-advance, ever.
  "survey.notify_deal_owner_on_complete": true,

  // --- proposal module settings ---------------------------------------------
  // ONE threshold, ONE setting (Proposal Spec §4, §10 call 4). A discount
  // within this needs nobody; beyond it, or any custom line, goes to an
  // approver. Approval keys off deviation from CARD PRICE and not off margin —
  // the rate card carries one price and no cost, so margin is not visible
  // anywhere in this product. That is a stated consequence of the 14 Aug
  // rate-card cut, not an oversight.
  "proposal.discount_approval_pct": 10,
};

const server = new StudioFunctions({ name: "migrate" });

server.addHandler({
  name: "clean-seed",
  description: "Delete the type-inference seed row from every imported table",
  parameters: {},
  execute: async () => {
    const removed: Record<string, number> = {};
    const errors: Record<string, string> = {};

    for (const table of TABLES) {
      try {
        removed[table] = mutate(`delete from ${table} where id = $1`, [SEED_ID]);
      } catch (e) {
        errors[table] = String((e as Error).message || e);
      }
    }

    return {
      ok: Object.keys(errors).length === 0,
      data: { removed, errors },
    };
  },
});

server.addHandler({
  name: "seed-config",
  description: "Insert ref-number sequences and default settings if absent",
  parameters: {},
  execute: async () => {
    const now = nowIso();
    const created = { sequences: 0, settings: 0 };

    // `INSERT ... SELECT ... WHERE NOT EXISTS` is one statement, so it is atomic.
    // There is no UNIQUE constraint available to lean on (§3a).
    for (const seq of SEQUENCES) {
      created.sequences += mutate(
        `insert into fl_sequence (id, name, current_value, data_json, created_at, updated_at)
         select gen_random_uuid()::text, $1, 0, $2, $3, $3
         where not exists (select 1 from fl_sequence where name = $1)`,
        [seq.name, JSON.stringify({ prefix: seq.prefix }), now]
      );
    }

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      created.settings += mutate(
        `insert into fl_setting (id, key, value_json, data_json, created_at, updated_at)
         select gen_random_uuid()::text, $1, $2, '{}', $3, $3
         where not exists (select 1 from fl_setting where key = $1)`,
        [key, JSON.stringify(DEFAULT_SETTINGS[key]), now]
      );
    }

    return { ok: true, data: created };
  },
});

/**
 * The proposal lane's unblocker (Proposal Spec v1 §9).
 *
 * `survey.submit` does not exist yet, so no frozen revision exists to price
 * from. Rather than block the proposal lane behind the walk, this hand-writes
 * ONE frozen payload and seeds it as a row. It doubles as the demo fixture if
 * the walk lands late.
 *
 * The payload shape is `Survey Module Structure v1.8.md` §5 — the binding
 * contract between the two lanes — and `src/domain/pricing.ts`'s HandoffPayload
 * was written to accept exactly it. When `survey.submit` ships it must produce
 * this same shape; if the two ever disagree, §5 is right and this is wrong.
 *
 * `suggested_service_id` is deliberately null: C23 wants a Facilio Services id
 * and L10 is unresolved. Substituting an app-local id to make it non-null is
 * the exact mistake C23 exists to prevent.
 */
const HANDOFF_FIXTURE = {
  payload_version: "1.0",
  survey: {
    survey_number: "SUR-DEMO",
    revision_no: 1,
    contract_intent: "semi_comprehensive",
    completeness_pct: 94,
    // Published, not hidden — the estimator prices with eyes open (§5 rule 4).
    not_visited_pct: 8,
    rework_count: 0,
  },
  portfolio: [
    {
      node_id: 9001,
      node_type: "site",
      name: "Al Bayt Grill — Marina",
      parent_node_id: null,
      ancestry_path: "9001",
      provenance: "survey",
      verdict: "verified",
      attributes: { area_sqft: 4800, floor_count: 2, restroom_count: 6 },
    },
    {
      node_id: 9002,
      node_type: "building",
      name: "Main restaurant",
      parent_node_id: 9001,
      ancestry_path: "9001/9002",
      provenance: "survey",
      verdict: "verified",
      attributes: { area_sqft: 3200, floor_count: 1 },
    },
    {
      node_id: 9003,
      node_type: "building",
      name: "Back of house",
      parent_node_id: 9001,
      ancestry_path: "9001/9003",
      provenance: "survey",
      verdict: "added_on_site",
      attributes: { area_sqft: 1600, floor_count: 1 },
    },
    {
      node_id: 9037,
      node_type: "space",
      name: "Main kitchen",
      parent_node_id: 9003,
      ancestry_path: "9001/9003/9037",
      provenance: "survey",
      verdict: "verified",
      attributes: { area_sqft: 900 },
      observation: {
        condition_score: 2,
        condition_label: "Poor",
        // A score never travels without its direction (pricing.ts rule 1).
        condition_scale_direction: "1_is_worst",
        contamination_level: "heavy_grease",
        buildup_note: "Heavy grease film on skirting and extract hood surrounds",
        access_constraint: "overnight crew only",
        suggested_frequency: "one_time",
      },
    },
    {
      node_id: 9038,
      node_type: "space",
      name: "Dining floor",
      parent_node_id: 9002,
      ancestry_path: "9001/9002/9038",
      provenance: "survey",
      verdict: "verified",
      attributes: { area_sqft: 2400 },
      observation: {
        condition_score: 4,
        condition_label: "Good",
        condition_scale_direction: "1_is_worst",
        suggested_frequency: "weekly",
      },
    },
    {
      node_id: 9044,
      node_type: "space",
      name: "Rooftop plant area",
      parent_node_id: 9003,
      ancestry_path: "9001/9003/9044",
      provenance: "rfp",
      verdict: "not_visited",
      attributes: {},
    },
  ],
  estimation_values: [
    { estimation_key: "total_sqft", value: 4800, value_type: "number", scope_node_id: 9038 },
    { estimation_key: "restroom_count", value: 6, value_type: "number", scope_node_id: 9002 },
    { estimation_key: "kitchen_deep_clean_sqft", value: 900, value_type: "number", scope_node_id: 9037 },
    { estimation_key: "extract_hood_count", value: 3, value_type: "number", scope_node_id: 9037 },
    { estimation_key: "window_panes", value: 42, value_type: "number", scope_node_id: 9002 },
    // Deliberately unpriceable: a quantity that reads as prose must never
    // silently become money. This one proves the `unpriced` path on screen.
    { estimation_key: "external_facade_area", value: "approx 2,000 sq ft", value_type: "text", scope_node_id: 9001 },
  ],
  answers: [
    {
      label: "Anything the client should quote separately?",
      value: "Grease trap servicing looks overdue",
      answer_role: "recommendation",
      recommendation_type: "additional_service",
      urgency: "high",
      suggested_service_id: null,
      scope_node_id: 9037,
    },
    {
      label: "Floor type",
      value: "quarry tile",
      answer_role: "finding",
      scope_node_id: 9037,
    },
  ],
  // The exclusions that print on the proposal (§5 rule 4).
  qualifications: [
    {
      source: "not_visited_node",
      source_ref_id: 9044,
      text: "The rooftop plant area was not accessible during the walk and is excluded from this proposal.",
    },
    {
      source: "unanswered_question",
      source_ref_id: null,
      text: "External facade area was not measured; facade cleaning is excluded pending a survey.",
    },
  ],
  visits: [
    {
      visit_number: "SUR-DEMO/V1",
      scheduled_start: "2026-08-13T06:00:00Z",
      status: "completed",
      slot_source: "client_granted",
    },
  ],
  excluded: { cancelled_surveys_included: false },
};

/** Keys here must match `HANDOFF_FIXTURE.estimation_values`, minus the two that
 *  are meant to fail. Prices are MAJOR units — the column is numeric(14,2). */
const DEMO_RATE_ROWS = [
  {
    estimation_key: "total_sqft",
    description: "General cleaning",
    service_code: "GC",
    pricing_basis: "unit",
    uom: "sq_ft",
    price: 0.1,
    min_charge: 150,
    default_frequency: "monthly",
    condition_multipliers: { "1": 1.5, "2": 1.25, "3": 1, "4": 0.9, "5": 0.85 },
  },
  {
    estimation_key: "restroom_count",
    description: "Restroom deep clean",
    service_code: "RDC",
    pricing_basis: "unit",
    uom: "washroom",
    price: 120,
    min_charge: 0,
    default_frequency: "weekly",
    condition_multipliers: {},
  },
  {
    estimation_key: "kitchen_deep_clean_sqft",
    description: "Kitchen deep clean",
    service_code: "KDC",
    pricing_basis: "unit",
    uom: "sq_ft",
    price: 1.4,
    min_charge: 800,
    default_frequency: "one_time",
    condition_multipliers: { "1": 1.6, "2": 1.35, "3": 1, "4": 0.95, "5": 0.9 },
  },
  {
    estimation_key: "extract_hood_count",
    description: "Extract hood and duct clean",
    service_code: "KEC",
    pricing_basis: "visit",
    uom: "per_visit",
    price: 450,
    min_charge: 0,
    default_frequency: "quarterly",
    condition_multipliers: { "1": 1.4, "2": 1.2, "3": 1, "4": 1, "5": 1 },
  },
  // NOTE: `window_panes` is deliberately absent from the card, so the demo can
  // show a real gap being surfaced rather than silently skipped.
];

server.addHandler({
  name: "seed-proposal-demo",
  description:
    "Seed one active rate card and one frozen survey revision so the proposal lane can be " +
    "built and demoed without waiting for survey.submit. Idempotent.",
  parameters: {
    surveyId: { description: "Survey to hang the frozen revision on", type: "string" as const },
  },
  execute: async (args) => {
    const now = nowIso();
    const surveyId = String((args as Record<string, unknown>).surveyId ?? "").trim();
    if (!surveyId) return { ok: false, error: "surveyId is required" };

    const survey = one<{ id: string; status: string }>(
      `select id, status from fl_survey where id = $1 limit 1`,
      [surveyId]
    );
    if (!survey) return { ok: false, error: `survey ${surveyId} not found` };

    const created = { rateCard: 0, rateCardRows: 0, revision: 0, serviceLines: 0 };

    // C23: a rate card row names a service by CODE, and that code must be a
    // real `fl_service_line` row — `saveCardRow` now refuses otherwise. The
    // demo priced four services that existed nowhere, so the card it seeds
    // could not have been re-saved through the UI it ships with. KEC is
    // deliberately absent from this list: the catalogue already carries it,
    // and the demo should reference what is there rather than duplicate it.
    for (const line of [
      { code: "GC", name: "General cleaning" },
      { code: "RDC", name: "Restroom deep clean" },
      { code: "KDC", name: "Kitchen deep clean" },
    ]) {
      created.serviceLines += mutate(
        `insert into fl_service_line (id, code, name, active, data_json, created_at, updated_at)
         select gen_random_uuid()::text, $1, $2, 'true', '{}', $3, $3
          where not exists (select 1 from fl_service_line where code = $1)`,
        [line.code, line.name, now]
      );
    }
    const CARD_NAME = "UAE Soft Services 2026";

    mutate(
      `insert into fl_rate_card
         (id, name, description, currency, region, client_account_id, priority, status,
          effective_from, effective_to, condition_scale_direction, version_no,
          created_by, updated_by, is_active, data_json, created_at, updated_at)
       select gen_random_uuid()::text, $1, 'Seeded demo card', 'AED', null, null, 10, 'active',
              '2026-01-01T00:00:00Z', null, '1_is_worst', 1,
              'seed', 'seed', 'true', '{}', $2, $2
        where not exists (select 1 from fl_rate_card where name = $1 and is_active = 'true')`,
      [CARD_NAME, now]
    );

    const card = one<{ id: string }>(
      `select id from fl_rate_card where name = $1 and is_active = 'true' limit 1`,
      [CARD_NAME]
    );
    if (!card) return { ok: false, error: "rate card insert did not take" };
    created.rateCard = 1;

    let seq = 0;
    for (const row of DEMO_RATE_ROWS) {
      seq += 1;
      created.rateCardRows += mutate(
        `insert into fl_rate_card_row
           (id, rate_card_id, facilio_service_id, service_code, description, estimation_key,
            pricing_basis, uom, price, min_charge, condition_multipliers_json,
            default_frequency, sequence_no, created_by, updated_by, is_active,
            data_json, created_at, updated_at)
         select gen_random_uuid()::text, $1, null, $2, $3, $4,
                $5, $6, $7, $8, $9,
                $10, $11, 'seed', 'seed', 'true',
                '{}', $12, $12
          where not exists (
            select 1 from fl_rate_card_row
             where rate_card_id = $1 and estimation_key = $4 and is_active = 'true')`,
        [
          card.id,
          row.service_code,
          row.description,
          row.estimation_key,
          row.pricing_basis,
          row.uom,
          row.price,
          row.min_charge,
          JSON.stringify(row.condition_multipliers),
          row.default_frequency,
          seq,
          now,
        ]
      );
    }

    // The checksum is computed the same way survey-revision.ts computes it, so
    // a real submit and this fixture are indistinguishable downstream.
    const payload = { ...HANDOFF_FIXTURE, survey: { ...HANDOFF_FIXTURE.survey, id: surveyId } };

    created.revision = mutate(
      `insert into fl_survey_revision
         (id, survey_id, revision_no, frozen_at, frozen_by, snapshot_json, checksum,
          trigger_kind, is_current, data_json, created_at, updated_at)
       select gen_random_uuid()::text, $1, 1, $2, 'seed', $3, $4, 'submit', 'true', '{}', $2, $2
        where not exists (select 1 from fl_survey_revision where survey_id = $1)`,
      [surveyId, now, JSON.stringify(payload), checksum(payload)]
    );

    const revision = one<{ id: string }>(
      `select id from fl_survey_revision where survey_id = $1 order by revision_no desc limit 1`,
      [surveyId]
    );

    return {
      ok: true,
      data: { ...created, rateCardId: card.id, surveyRevisionId: revision?.id ?? null },
    };
  },
});

/**
 * The one template P1 ships (Proposal Spec §6).
 *
 * The section list comes from `domain/proposal-document.ts` rather than being
 * re-typed here, because that same constant is what `render` falls back to when
 * no template row exists. Two copies of the seeded prose is two documents that
 * drift, and "the proposal reproduces byte-identically" would then be a claim
 * about whichever one happened to be loaded.
 *
 * "Add a template from this screen" is real, and it is a later sentence.
 */
server.addHandler({
  name: "seed-proposal-template",
  description: "Insert the default proposal template if it is not already there. Idempotent.",
  parameters: {},
  execute: async () => {
    const now = nowIso();

    const created = mutate(
      `insert into fl_proposal_template
         (id, name, description, status, version_no, sections_json, is_default,
          published_by, published_at, created_by, updated_by, is_active,
          data_json, created_at, updated_at)
       select gen_random_uuid()::text, $1, $2, 'published', 1, $3, 'true',
              'seed', $4, 'seed', 'seed', 'true',
              '{}', $4, $4
        where not exists (
          select 1 from fl_proposal_template where name = $1 and is_active = 'true')`,
      [
        DEFAULT_TEMPLATE.name,
        "Seeded default — an estimator edits the text sections, the system sections render themselves",
        JSON.stringify(DEFAULT_TEMPLATE.sections),
        now,
      ]
    );

    const template = one<{ id: string; isDefault: string }>(
      `select id, is_default from fl_proposal_template
        where name = $1 and is_active = 'true' limit 1`,
      [DEFAULT_TEMPLATE.name]
    );

    return {
      ok: Boolean(template),
      data: {
        created,
        templateId: template?.id ?? null,
        sections: DEFAULT_TEMPLATE.sections.length,
      },
    };
  },
});

/**
 * Does a sent proposal still match the checksum it was frozen at?
 *
 * `frozen_json` is deliberately absent from every read path in the proposal
 * module — it is the whole payload, and shipping it on every `get` would cost
 * the user a page load to serve an audit nobody is running. But a frozen
 * payload with NO reader anywhere is an audit claim that has never once been
 * checked, so this is the reader. Not on the request path, and not a UI.
 *
 * A mismatch does not prove tampering — FNV-1a is not cryptographic and
 * survey-revision.ts says so plainly. It proves DRIFT, which is the claim the
 * audit trail actually makes.
 */
server.addHandler({
  name: "verify-frozen",
  description: "Re-checksum a sent proposal's frozen payload and report whether it still matches",
  parameters: {
    proposalId: { description: "Proposal id (uuid)", type: "string" as const },
  },
  execute: async (args) => {
    const proposalId = String((args as Record<string, unknown>).proposalId ?? "").trim();
    if (!proposalId) return { ok: false, error: "proposalId is required" };

    const row = one<{
      refNo: string;
      revisionNo: number;
      status: string;
      checksum: string | null;
      frozen: unknown;
      frozenLength: number;
    }>(
      `select ref_no, revision_no, status, checksum, frozen_json,
              length(coalesce(frozen_json, '')) as frozen_length
         from fl_proposal where id = $1 limit 1`,
      [proposalId]
    );
    if (!row) return { ok: false, error: `proposal ${proposalId} not found` };

    const frozen = row.frozen as Record<string, unknown> | null;
    const lines = Array.isArray(frozen?.lines) ? (frozen?.lines as unknown[]).length : 0;

    return {
      ok: true,
      data: {
        refNo: row.refNo,
        revisionNo: row.revisionNo,
        status: row.status,
        storedChecksum: row.checksum,
        computedChecksum: frozen ? checksum(frozen) : null,
        matches: Boolean(row.checksum) && Boolean(frozen) && verifyChecksum(frozen, String(row.checksum)),
        frozenBytes: row.frozenLength,
        frozenLines: lines,
        sentAt: (frozen?.sentAt as string) ?? null,
        documentSections: Array.isArray((frozen?.document as Record<string, unknown>)?.sections)
          ? ((frozen?.document as Record<string, unknown>).sections as unknown[]).length
          : 0,
      },
    };
  },
});

/**
 * Is every frozen handoff payload readable by the estimator?
 *
 * The payload is a wire format specified in snake_case (v1.8 §5) and read in
 * snake_case by `src/domain/pricing.ts`. For a while `handoffPayload()` emitted
 * camelCase inner keys, because the batched read's `*_arr` columns go through
 * `mapDeep`, which camelises everything one level down, and only the top-level
 * keys were renamed back. A revision frozen in that window looks perfectly
 * healthy — it re-checksums intact, because the checksum is over whatever was
 * stored — and then prices as ZERO LINES, every value reported unpriced.
 *
 * That is the nastiest failure shape available: valid, verifiable, and silently
 * worthless. This handler is the check that finds it, and it stays because the
 * class of bug outlives the instance — any future change to the payload
 * builder can reintroduce it.
 */
/**
 * Walks `fl_prospect_node` rows forward into `fl_prospect_location`.
 *
 * `fl_prospect_node` is superseded: §0a purged "node" from the vocabulary and
 * portfolio v1.1 §5.1 renamed the table, `node_type` → `type` and
 * `parent_node_id` → `parent_id`, while adding the address block, the bid/no-bid
 * decision, the convert state machine and `previous_pursuit_id`. There is no
 * ALTER on this platform (§3a P1), so a rename is a new table plus this copy.
 *
 * IDEMPOTENT, and by the same trick the rest of the repo uses: the destination id
 * IS the source id, so a re-run inserts nothing. That matters because there are
 * no transactions — a half-finished copy is expected, and re-running finishes it.
 *
 * The old table is left in place. Nothing is ever hard-deleted, and keeping it
 * means this is reversible for as long as anyone might want to check.
 */
server.addHandler({
  name: "copy-prospect-locations",
  description:
    "Copy fl_prospect_node rows into fl_prospect_location (the v1.1 rename). Idempotent — the destination keeps the source id, so re-running is a no-op. The old table is left untouched.",
  parameters: {},
  execute: async () => {
    const copied = mutate(
      `insert into fl_prospect_location
         (id, deal_id, survey_id, type, parent_id, ancestry_path, name, code,
          area_sqft, floor_count, room_count, restroom_count, floor_label,
          space_category, pursuit_decision, provenance, verdict, verdict_note,
          verdict_by, verdict_at, verdict_visit_id, facilio_id, facilio_module,
          convert_state, tags_json, created_by, updated_by, is_active,
          data_json, created_at, updated_at)
       select n.id, n.deal_id, n.survey_id, n.node_type, n.parent_id,
              n.ancestry_path, n.name, n.code,
              n.area_sqft, n.floor_count, n.room_count, n.restroom_count, n.floor_label,
              n.space_category,
              -- Every carried-over row starts undecided: the bid/no-bid call did
              -- not exist before v1.1, so inventing one would be a fabrication.
              'undecided', n.provenance, n.verdict, n.verdict_note,
              n.verdict_by, n.verdict_at, n.verdict_visit_id, n.facilio_id, n.facilio_module,
              -- An existing Facilio id means the building is already there, which
              -- is exactly what already_linked records — and it stops the convert
              -- from creating a second copy of a live record (§7.3).
              case when coalesce(n.facilio_id, '') not in ('', 'none')
                   then 'already_linked' else 'not_converted' end,
              '[]', n.created_by, n.updated_by, n.is_active,
              coalesce(n.data_json, '{}'), n.created_at, n.updated_at
         from fl_prospect_node n
        where not exists (
                select 1 from fl_prospect_location l where l.id = n.id)`
    );

    const source = count(`select count(*) as c from fl_prospect_node`);
    const dest = count(`select count(*) as c from fl_prospect_location`);

    // Orphans are reported, never repaired here: a space whose parent is missing
    // is a C3 violation that predates this copy, and quietly re-parenting it
    // would hide the very thing someone needs to see.
    const orphans = many<{ id: string; name: string }>(
      `select l.id, l.name from fl_prospect_location l
        where l.parent_id is not null
          and not exists (select 1 from fl_prospect_location p where p.id = l.parent_id)
        limit 50`
    );

    return {
      ok: true,
      data: {
        copied,
        sourceRows: source,
        destinationRows: dest,
        orphansFound: orphans.length,
        orphans,
        note:
          orphans.length > 0
            ? "These rows have a parent_id pointing at nothing — a pre-existing C3 violation. Reported, not repaired."
            : "Every copied row's lineage resolves.",
      },
    };
  },
});

server.addHandler({
  name: "verify-handoff",
  description:
    "Check every frozen survey revision for camelCase inner keys, which the estimator cannot read. " +
    "Read-only.",
  parameters: {},
  execute: async () => {
    const rows = many<{ id: string; surveyId: string; revisionNo: number; frozenBy: string | null; frozenAt: string | null; snapshot: unknown }>(
      `select id, survey_id, revision_no, frozen_by, frozen_at, snapshot_json
         from fl_survey_revision
        limit 500`
    );

    const report = rows.map((r) => {
      const payload = (r.snapshot ?? {}) as Record<string, unknown>;
      const values = Array.isArray(payload.estimation_values) ? payload.estimation_values : [];
      const first = (values[0] ?? {}) as Record<string, unknown>;
      const keys = Object.keys(first);

      // The presence of the snake key is the only thing that matters; a camel
      // one alongside it would still price, so test for what pricing.ts READS.
      const readable = keys.length === 0 || Object.prototype.hasOwnProperty.call(first, "estimation_key");
      const camel = keys.filter((k) => /[A-Z]/.test(k));

      return {
        id: r.id,
        surveyId: r.surveyId,
        revisionNo: r.revisionNo,
        frozenBy: r.frozenBy,
        frozenAt: r.frozenAt,
        estimationValues: values.length,
        readable,
        camelKeys: camel,
        verdict: values.length === 0
          ? "no estimation values — nothing to price either way"
          : readable
            ? "readable"
            : "UNREADABLE — would price as zero lines. Re-freeze this survey.",
      };
    });

    const broken = report.filter((r) => !r.readable && r.estimationValues > 0);
    return {
      ok: broken.length === 0,
      data: { revisions: report.length, broken: broken.length, report },
      error: broken.length ? `${broken.length} frozen revision(s) cannot be priced` : undefined,
    };
  },
});

server.addHandler({
  name: "status",
  description: "Row counts per table, plus sequences and settings",
  parameters: {},
  execute: async () => {
    const counts: Record<string, number | string> = {};

    for (const table of TABLES) {
      try {
        counts[table] = count(`select count(*) as c from ${table}`);
      } catch (e) {
        counts[table] = `ERROR: ${String((e as Error).message || e).slice(0, 80)}`;
      }
    }

    return {
      ok: true,
      data: {
        schema: process.env.SCHEMA,
        counts,
        sequences: many("select name, current_value from fl_sequence order by name limit 50"),
        settings: many("select key, value_json from fl_setting order by key limit 100"),
      },
    };
  },
});

server.addHandler({
  name: "verify",
  description: "Prove read/write/coercion work end to end without leaving data behind",
  parameters: {},
  execute: async () => {
    const now = nowIso();
    const checks: Record<string, unknown> = {};

    // Write, read back with coercion, then remove.
    const probeKey = `__verify.${now}`;
    checks.inserted = mutate(
      `insert into fl_setting (id, key, value_json, data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3, $4, $4)`,
      [probeKey, JSON.stringify({ n: 7 }), JSON.stringify({ extra: "overflow works" }), now]
    );

    const row = one<{ key: string; value: unknown; data: Record<string, unknown> }>(
      "select key, value_json, data_json from fl_setting where key = $1 limit 1",
      [probeKey]
    );
    checks.readBack = row;
    checks.jsonParsed = typeof row?.value === "object";
    checks.overflowParsed = row?.data?.extra === "overflow works";

    // Numeric coercion: estimated_value is `numeric`, which arrives as a string.
    const lead = one<{ estimatedValue: unknown }>(
      "select 1234.50::numeric(14,2) as estimated_value"
    );
    checks.numericType = typeof lead?.estimatedValue;
    checks.numericValue = lead?.estimatedValue;

    checks.cleaned = mutate("delete from fl_setting where key = $1", [probeKey]);

    return { ok: true, data: checks };
  },
});

server.execute();
