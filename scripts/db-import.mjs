/**
 * Creates the Lead-module tables in the app's Postgres schema.
 *
 * WHY THIS FILE EXISTS AS IT DOES — read before editing:
 *
 * The app's DB role cannot CREATE, ALTER, DROP or INDEX anything (verified —
 * see ARCHITECTURE.md §3a). The only way a table comes into existence is
 * `facilio vibe db import`, which infers columns from a CSV. So this file is
 * the schema: each table is a header row plus ONE seed row whose values exist
 * purely to drive type inference.
 *
 * Inference is coarse: a value that parses as a number becomes `numeric`,
 * everything else becomes `text`. There are no booleans, timestamps, keys,
 * constraints or indexes. That means:
 *
 *   - Columns meant to be text MUST have a seed value that cannot parse as a
 *     number. Phones carry a leading '+', ids are UUIDs, dates are ISO strings.
 *   - A table's shape is PERMANENT. Re-importing an existing table returns 500
 *     and ALTER is denied, so a forgotten column means building a new table and
 *     migrating data. Be generous now; that is why `data_json` exists on every
 *     table for anything we do not filter on.
 *
 * After import, `migrate.clean-seed` deletes every row with SEED_ID.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const SEED_ID = "00000000-0000-0000-0000-000000000000";
const NOW = "2000-01-01T00:00:00Z"; // fixed so re-running writes identical CSVs
const OUT = join(process.cwd(), "db", "tables");

/** Columns every table carries. `data_json` is the escape hatch for new fields. */
const common = {
  id: SEED_ID,
  data_json: "{}",
  created_at: NOW,
  updated_at: NOW,
};

/** name -> { column: seedValue }. Seed values are type hints, nothing more. */
const tables = {
  // ---- platform / cross-cutting -------------------------------------------
  fl_setting: {
    ...common,
    key: "seed.key",
    value_json: "{}",
  },

  fl_sequence: {
    ...common,
    name: "seed",
    current_value: 0,
  },

  // One append-only log for the whole app: audit trail, chase log, view tracking.
  fl_event: {
    ...common,
    entity_type: "lead",
    entity_id: SEED_ID,
    kind: "seed",
    actor: "seed@example.com",
    body: "seed row",
    meta_json: "{}",
    occurred_at: NOW,
  },

  // The outbox. Every Facilio write goes through here, never inline.
  fl_sync_task: {
    ...common,
    aggregate_type: "lead",
    aggregate_id: SEED_ID,
    action: "seed",
    payload_json: "{}",
    idempotency_key: "seed:key",
    depends_on_id: SEED_ID,
    status: "done",
    attempts: 0,
    next_attempt_at: NOW,
    last_error: "none",
    facilio_id: "none",
  },

  fl_photo: {
    ...common,
    entity_type: "lead",
    entity_id: SEED_ID,
    vibe_file_id: 0,
    file_name: "seed.png",
    content_type: "image/png",
    size_bytes: 0,
    caption: "seed",
  },

  // ---- settings the analyst reads -----------------------------------------
  fl_service_area: {
    ...common,
    name: "Seed Area",
    region: "Seed Region",
    country: "AE",
    active: "false",
  },

  fl_service_line: {
    ...common,
    code: "SEED",
    name: "Seed Service",
    active: "false",
  },

  fl_service_coverage: {
    ...common,
    area_id: SEED_ID,
    service_line_id: SEED_ID,
    active: "false",
  },

  // ---- the lead itself ----------------------------------------------------
  // Widest table on purpose: anything we filter, sort or group by has to be a
  // real column, because there is no way to add one later.
  fl_lead: {
    ...common,
    ref_no: "LEAD-0000",
    company_name: "Seed Company",
    contact_name: "Seed Contact",
    contact_email: "seed@example.com",
    contact_phone: "+971500000000",
    website_domain: "example.com",
    // normalised dedup keys — matched on, so they are columns
    email_norm: "seed@example.com",
    phone_norm: "+971500000000",
    domain_norm: "example.com",
    source: "manual",
    source_detail: "seed",
    service_type: "seed",
    description: "Seed row - safe to delete",
    site_address: "Seed address",
    site_city: "Seed City",
    site_region: "Seed Region",
    estimated_value: 0,
    currency: "AED",
    status: "closed",
    disposition_reason: "test",
    duplicate_of_lead_id: SEED_ID,
    nurture_until: NOW,
    owner_email: "seed@example.com",
    sales_owner_email: "seed@example.com",
    account_id: SEED_ID,
    contact_id: SEED_ID,
    deal_id: SEED_ID,
    facilio_asset_id: "none",
    // latest analysis snapshot, denormalised so the queue can filter and sort
    // without a join (no indexes, no joins worth paying for at read time)
    score: 0,
    verdict: "not_relevant",
    analysed_at: NOW,
    // SLA stamps — due dates written on arrival, overdue derived at read time
    arrived_at: NOW,
    first_response_due_at: NOW,
    reviewed_at: NOW,
    first_contact_at: NOW,
    qualification_due_at: NOW,
    qualified_at: NOW,
    assignment_due_at: NOW,
    assigned_at: NOW,
    converted_at: NOW,
    closed_at: NOW,
  },

  // Versioned so the analyst can be re-run without losing what it said before.
  fl_lead_analysis: {
    ...common,
    lead_id: SEED_ID,
    version: 0,
    verdict: "not_relevant",
    score: 0,
    understanding_json: "{}",
    relevance_json: "{}",
    reasons_json: "[]",
    recommendation_json: "{}",
    model_name: "seed-model",
    prompt_version: "v0",
  },

  fl_lead_assignment: {
    ...common,
    lead_id: SEED_ID,
    from_user: "seed@example.com",
    to_user: "seed@example.com",
    role: "actioner",
    reason: "seed",
    actor: "seed@example.com",
  },

  // ---- conversion targets -------------------------------------------------
  fl_account: {
    ...common,
    lead_id: SEED_ID,
    name: "Seed Account",
    email: "seed@example.com",
    phone: "+971500000000",
    website_domain: "example.com",
    address_json: "{}",
    facilio_client_id: "none",
    sync_status: "pending",
  },

  fl_account_contact: {
    ...common,
    account_id: SEED_ID,
    lead_id: SEED_ID,
    name: "Seed Contact",
    email: "seed@example.com",
    phone: "+971500000000",
    is_primary: "true",
    facilio_contact_id: "none",
    sync_status: "pending",
  },

  fl_deal: {
    ...common,
    ref_no: "DEAL-0000",
    lead_id: SEED_ID,
    account_id: SEED_ID,
    contact_id: SEED_ID,
    title: "Seed Deal",
    stage: "lost",
    estimated_value: 0,
    currency: "AED",
    sales_owner_email: "seed@example.com",
    source: "manual",
    won_at: NOW,
    lost_at: NOW,
    lost_reason: "seed",
  },

  // ---- intake widget channel ---------------------------------------------
  fl_intake_session: {
    ...common,
    session_token: "seed-token",
    source_url: "https://example.com",
    ip_hash: "seedhash",
    user_agent: "seed-agent",
    turn_count: 0,
    status: "abandoned",
    lead_id: SEED_ID,
    extracted_json: "{}",
    last_seen_at: NOW,
  },

  fl_intake_message: {
    ...common,
    session_id: SEED_ID,
    role: "agent",
    content: "seed message",
    turn_index: 0,
  },

  // ==========================================================================
  // ACCESS LANE — 2 tables. roles&response spec §5–§9.
  //
  // The permission matrix deliberately has NO table: it rides in
  // fl_role.data_json.permissions ({ module: [action, ...] }), because it is
  // read whole, written whole, and enforcement is client-side (the functions
  // runtime carries no caller identity). `org_id` is provisioned now for the
  // coming Organization module — the run body already carries orgId, and a
  // column can never be added later.
  // ==========================================================================

  fl_user: {
    ...common,
    org_id: "org-0", // text on purpose: ids that look numeric are strings here
    name: "Seed User",
    email: "seed@example.com",
    email_norm: "seed@example.com", // lowercased lookup key — bootstrap matches on it
    role_id: SEED_ID,
    team: "Seed Team",
    region: "Seed Region",
    department: "Seed Dept",
    manager_email: "seed@example.com",
    status: "inactive", // live values: active | inactive
    job_title: "Seed Title",
    phone: "+971500000000",
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
  },

  fl_role: {
    ...common,
    org_id: "org-0",
    code: "ROLE-000", // seeded ROLE-001…009 per spec §5; fl_sequence 'role' mints ROLE-010+
    name: "Seed Role",
    description: "Seed row - safe to delete",
    active: "false",
    is_system: "false", // System Admin immutability is data, not a name-string check
    sort_order: 0,
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
  },

  // ==========================================================================
  // SURVEY LANE — 18 tables. Survey Backend Plan v1 §3.
  //
  // Three seed rules apply to everything below, and a violation of any of them
  // is silent:
  //
  //  1. A column meant to hold text needs a seed that CANNOT parse as a number.
  //     Facilio ids (`facilio_id`, `user_id`, `suggested_service_id`,
  //     `space_category`, `source_document_id`) and the reconciliation value
  //     columns are numeric strings in the wild — seeded "none" / "seed value"
  //     so they stay `text`. Miss one and every id read back is corrupted.
  //  2. Every `is_active` seeds 'false' and every status/verdict seeds an inert
  //     terminal value. The snapshot copy (§6.1) selects `is_active = 'true'`,
  //     so a live seed row would be copied into a real survey's snapshot and
  //     nothing would error. Same reasoning as fl_lead's `status: "closed"`.
  //  3. Booleans are the strings 'true'/'false'; timestamps are ISO 8601 UTC.
  //     Never write '' into a numeric column — pass null.
  // ==========================================================================

  // ---- the form builder (function `form`) ---------------------------------
  // Deliberately not named survey_*: v1.7 §B1 is a generic builder that the
  // survey module merely consumes, so leads/mobilization/QA can reuse it.

  fl_form_template: {
    ...common,
    name: "Seed Template",
    description: "Seed row - safe to delete",
    category: "General",
    status: "archived",
    version_no: 0,
    parent_template_id: SEED_ID,
    published_by: "seed@example.com",
    published_at: NOW,
    archived_by: "seed@example.com",
    archived_at: NOW,
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  fl_form_section: {
    ...common,
    template_id: SEED_ID,
    name: "Seed Section",
    description: "Seed row - safe to delete",
    sequence_no: 0,
    level_binding: "per_survey",
    applicability_service_ids_json: "[]",
    is_repeatable: "false",
    repeat_label: "Room",
    min_repeats: 0,
    max_repeats: 0,
    creates_portfolio_node: "false",
    node_type_created: "space",
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  // `template_id` is denormalised onto the question so a template's whole
  // question set is one query with no join. `unit` is imported now so that
  // D-k (adding a `number` field type) stays a code change, not a migration.
  fl_form_question: {
    ...common,
    section_id: SEED_ID,
    template_id: SEED_ID,
    label: "Seed question?",
    help_text: "Seed row - safe to delete",
    field_type: "short_text",
    options_json: "[]",
    allow_multiple: "false",
    sequence_no: 0,
    is_required: "false",
    feeds_estimation: "false",
    estimation_key: "seed_key",
    unit: "sqft",
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  // ---- the survey, the run-time record (function `survey`) ----------------

  // `lead_assignee_id` is the SINGLE SOURCE OF TRUTH for who leads (X1).
  // fl_survey_assignee.is_lead is reserved and must never be read as truth:
  // there are no indexes and no transactions, so a single-statement
  // `UPDATE fl_survey SET lead_assignee_id = $1` is the only atomic write that
  // can guarantee two people clicking at once cannot produce two leads.
  // `lead_user_email` is an identity mirror so "my surveys" filters without a
  // join — a mirror, not a count (ARCHITECTURE.md §9 rule 5 forbids counts).
  fl_survey: {
    ...common,
    ref_no: "SUR-0000",
    deal_id: SEED_ID,
    account_id: SEED_ID,
    title: "Seed Survey",
    template_id: SEED_ID,
    template_version_no: 0,
    prospect_site_id: SEED_ID,
    buildings_in_scope_json: "[]",
    status: "cancelled",
    status_changed_at: NOW,
    status_changed_by: "seed@example.com",
    lead_assignee_id: SEED_ID,
    lead_user_email: "seed@example.com",
    disciplines_required_json: "[]",
    contract_intent: "non_comprehensive",
    is_condition_survey_complete: "false",
    target_completion_date: NOW,
    revision_no: 0,
    parent_survey_id: SEED_ID,
    superseded_by_survey_id: SEED_ID,
    rework_count: 0,
    completeness_pct: 0,
    not_visited_pct: 0,
    cancel_reason: "seed",
    cancelled_by: "seed@example.com",
    cancelled_at: NOW,
    submitted_by: "seed@example.com",
    submitted_at: NOW,
    current_revision_id: SEED_ID,
    notes: "Seed row - safe to delete",
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  // `visit_number` is composed as {survey.ref_no}/V{sequence_no} — derivable,
  // unique within its survey, and one fewer row in the shared sequence seed.
  fl_survey_visit: {
    ...common,
    survey_id: SEED_ID,
    visit_number: "SUR-0000/V1",
    sequence_no: 0,
    scheduled_start: NOW,
    scheduled_end: NOW,
    timezone: "Asia/Dubai",
    buildings_covered_json: "[]",
    site_contact_id: SEED_ID,
    site_contact_name: "Seed Contact",
    site_contact_phone: "+971500000000",
    site_contact_email: "seed@example.com",
    meeting_instructions: "Seed row - safe to delete",
    access_instructions: "Seed row - safe to delete",
    notes: "Seed row - safe to delete",
    slot_source: "ours",
    slot_granted_by: "seed",
    status: "cancelled",
    actual_start_at: NOW,
    actual_end_at: NOW,
    conflict_warnings_json: "[]",
    conflict_acknowledged_by: "seed@example.com",
    conflict_acknowledged_at: NOW,
    cancel_reason: "seed",
    no_show_reason: "seed",
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  // `user_id` is a Facilio id and numeric in the wild — seeded "none" so the
  // column stays text. L14 (is the platform user list readable?) is still open;
  // `user_email` is the working key and is never a foreign key (D-n).
  fl_survey_assignee: {
    ...common,
    survey_id: SEED_ID,
    user_email: "seed@example.com",
    user_id: "none",
    discipline_ids_json: "[]",
    is_lead: "false", // RESERVED — see fl_survey.lead_assignee_id (X1)
    participation: "observer",
    assigned_by: "seed@example.com",
    assigned_at: NOW,
    notified_at: NOW,
    removed_by: "seed@example.com",
    removed_at: NOW,
    removal_reason: "seed",
    is_active: "false",
  },

  fl_survey_visit_assignee: {
    ...common,
    visit_id: SEED_ID,
    survey_id: SEED_ID,
    user_email: "seed@example.com",
    user_id: "none",
    discipline_ids_json: "[]",
    is_visit_lead: "false",
    attendance: "absent",
    assigned_by: "seed@example.com",
    assigned_at: NOW,
    removed_by: "seed@example.com",
    removed_at: NOW,
    is_active: "false",
  },

  // ---- the snapshot and the walk — the hot path ---------------------------
  //
  // `source_section_id` and `source_question_id` are the two columns that must
  // not be missed. They do two jobs: they let the snapshot run as TWO
  // statements instead of N inserts (the question copy joins back through
  // source_section_id), and they are the idempotency key — there are no
  // transactions, so a half-finished snapshot will happen and the re-run is
  // `insert ... select ... where not exists (... source_question_id = ...)`.

  fl_survey_section_instance: {
    ...common,
    survey_id: SEED_ID,
    source_section_id: SEED_ID,
    source_template_id: SEED_ID,
    source_template_version_no: 0,
    name: "Seed Section",
    description: "Seed row - safe to delete",
    sequence_no: 0,
    level_binding: "per_survey",
    applicability_service_ids_json: "[]",
    is_repeatable: "false",
    repeat_label: "Room",
    min_repeats: 0,
    max_repeats: 0,
    creates_portfolio_node: "false",
    node_type_created: "space",
    added_ad_hoc: "false",
    is_active: "false",
  },

  fl_survey_question_instance: {
    ...common,
    survey_id: SEED_ID,
    section_instance_id: SEED_ID,
    source_question_id: SEED_ID,
    source_section_id: SEED_ID,
    source_template_version_no: 0,
    label: "Seed question?",
    help_text: "Seed row - safe to delete",
    field_type: "short_text",
    options_json: "[]",
    allow_multiple: "false",
    sequence_no: 0,
    is_required: "false",
    feeds_estimation: "false",
    estimation_key: "seed_key",
    unit: "sqft",
    added_ad_hoc: "false",
    is_active: "false",
  },

  // One row per repeat of a repeatable section — the snagging pattern.
  // "+ Add another Room". With D-p answered yes, an entry on a section with
  // creates_portfolio_node = 'true' also creates the space node it points at.
  fl_survey_section_entry: {
    ...common,
    survey_id: SEED_ID,
    section_instance_id: SEED_ID,
    entry_no: 0,
    entry_label: "Room 0",
    prospect_node_id: SEED_ID,
    visit_id: SEED_ID,
    created_by: "seed@example.com",
    is_active: "false",
  },

  // READ-TIME TRAP, and the column names are frozen after import so decide now:
  // shared/row-map.ts strips the `_json` suffix, so `value_json` comes back as
  // the key `value` — which reads like "the answer's value" when it is only the
  // multiselect variant, sitting beside value_text / value_number / value_bool /
  // value_date. The column name stays `value_json` to match the spec; every
  // projection that selects it must alias it (`value_json as value_multi_json`
  // -> `valueMulti`) so no caller mistakes it for the answer itself.
  // Same applies to fl_prospect_observation below.
  fl_survey_answer: {
    ...common,
    survey_id: SEED_ID,
    question_instance_id: SEED_ID,
    section_entry_id: SEED_ID,
    scope_node_id: SEED_ID,
    value_text: "seed value",
    value_number: 0,
    value_bool: "false",
    value_json: "[]",
    value_date: NOW,
    is_na: "false",
    na_reason: "seed",
    answered_by: "seed@example.com",
    answered_at: NOW,
    visit_id: SEED_ID,
    ai_confidence: 0,
    ai_source: "none",
    superseded_by_answer_id: SEED_ID,
    geo_lat: 0,
    geo_lng: 0,
    geo_accuracy_m: 0,
    is_active: "false",
  },

  // `section_entry_id` is the D-p superset: a condition score can be captured
  // against a repeat entry before — or without — a `space` node existing.
  fl_survey_observation: {
    ...common,
    survey_id: SEED_ID,
    visit_id: SEED_ID,
    prospect_node_id: SEED_ID,
    section_entry_id: SEED_ID,
    condition_score: 0,
    contamination_level: "none",
    buildup_note: "Seed row - safe to delete",
    access_constraint: "seed",
    safety_note: "seed",
    suggested_frequency: "one_time",
    observed_by: "seed@example.com",
    observed_at: NOW,
    geo_lat: 0,
    geo_lng: 0,
    geo_accuracy_m: 0,
    superseded_by_observation_id: SEED_ID,
    is_active: "false",
  },

  // ---- the prospect portfolio ---------------------------------------------
  //
  // The node belongs to the DEAL (D-i) — `survey_id` records which survey
  // created it and is never the owner. Nodes survive revisions and lost deals.

  fl_prospect_node: {
    ...common,
    deal_id: SEED_ID,
    survey_id: SEED_ID,
    node_type: "space",
    parent_node_id: SEED_ID,
    ancestry_path: "/seed",
    name: "Seed Node",
    code: "SEED",
    facilio_id: "none",
    facilio_module: "none",
    space_category: "none",
    floor_label: "Ground",
    area_sqft: 0,
    floor_count: 0,
    room_count: 0,
    restroom_count: 0,
    provenance: "manual",
    source_document_id: "none",
    verdict: "not_visited",
    verdict_note: "seed",
    verdict_by: "seed@example.com",
    verdict_at: NOW,
    verdict_visit_id: SEED_ID,
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  // Append-only, and it has NO `is_active` by design: nothing is ever updated
  // in place and "current" means the latest row with is_accepted = 'true'.
  fl_prospect_observation: {
    ...common,
    prospect_node_id: SEED_ID,
    deal_id: SEED_ID,
    survey_id: SEED_ID,
    field_key: "area_sqft",
    value_text: "seed value",
    value_number: 0,
    value_json: "{}",
    provenance: "manual",
    observed_by: "seed@example.com",
    observed_at: NOW,
    visit_id: SEED_ID,
    is_accepted: "false",
    accepted_by: "seed@example.com",
    accepted_at: NOW,
    superseded_by_observation_id: SEED_ID,
    reconciliation_decision: "manual_override",
    geo_lat: 0,
    geo_lng: 0,
    geo_accuracy_m: 0,
  },

  // ---- the prospect portfolio, as its own product area ---------------------
  //
  // `Prospect Portfolio Module v1.1.md` §5.1. This SUPERSEDES fl_prospect_node:
  // §0a purged "node" from the vocabulary, `node_type` becomes `type`, and v1.1
  // adds the address block, the bid/no-bid decision, the convert state machine
  // and `previous_pursuit_id`. The old table is left in place because nothing is
  // ever hard-deleted; `migrate.copy-prospect-locations` walks its rows forward.
  //
  // ⚠ EVERY COLUMN IS HERE ON PURPOSE. §12 F-6: there is no ALTER, so a
  // forgotten column means a new table and a data migration. The spec's own
  // instruction is "cut screens, never columns" — so screens are cut below and
  // this list is complete even where no screen reads it yet.
  //
  // Two ledger items answered from the shipped repo rather than by a throwaway
  // import (v1.1 §14 step 1):
  //   L15 — `tags` is `tags_json`, TEXT holding a JSON string. Inference makes
  //         everything non-numeric text anyway, and the repo already stores
  //         every structured value this way (`options_json`, `value_json`,
  //         `buildings_in_scope_json`). Nothing here depends on real jsonb.
  //   L17 — `fl_prospect_attachment` does NOT ship. fl_photo already carries
  //         `kind`, `captured_at` and the geo triple inside `data_json`, which
  //         is precisely §5.3's stated condition for the table not existing.
  //         `entity_type` takes 'prospect_location'.
  fl_prospect_location: {
    ...common,
    deal_id: SEED_ID,
    // Kept although §5.1 omits it: the walk needs to know which survey created
    // a location, and F-6 says be generous now rather than migrate later.
    survey_id: SEED_ID,
    type: "space",
    parent_id: SEED_ID,
    ancestry_path: "/seed",
    name: "Seed Location",
    code: "SEED",
    client_level_label: "facility",
    tags_json: "[]",
    // ADDRESS — the v1.0 miss. First thing an RFP contains.
    address_line: "1 Seed Street",
    city: "Seedville",
    region: "Seed Region",
    country: "AE",
    postcode: "P-00000",
    latitude: 0,
    longitude: 0,
    // SIZE AND SHAPE
    area_sqft: 0,
    floor_count: 0,
    room_count: 0,
    restroom_count: 0,
    floor_label: "Ground",
    ceiling_height_band: "standard_8_10ft",
    space_category: "none",
    // DECISION AND ORIGIN
    pursuit_decision: "undecided",
    pursuit_decision_note: "seed",
    provenance: "manual",
    source_attachment_id: SEED_ID,
    verdict: "unverified",
    verdict_note: "seed",
    verdict_by: "seed@example.com",
    verdict_at: NOW,
    verdict_visit_id: SEED_ID,
    // FACILIO AND REPEAT PURSUITS
    facilio_id: "none",
    facilio_module: "none",
    previous_pursuit_id: SEED_ID,
    convert_state: "not_converted",
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  // §5.5. Nobody writes this from a handler except the convert run itself, and
  // §9's override is explicit: not even Admin may write it. An audit trail an
  // admin can edit is not an audit trail.
  fl_prospect_convert_log: {
    ...common,
    location_id: SEED_ID,
    deal_id: SEED_ID,
    target_module: "site",
    target_parent_facilio_id: "none",
    // `location:{id}:{target_module}` — read before every write. A CHECK, not a
    // constraint: §3a P1 forbids the unique index that would make it one, and
    // §5.5 says to state that residual risk rather than claim idempotency.
    dedup_key: "location:seed:site",
    status: "pending",
    facilio_id_created: "none",
    error_text: "none",
    run_id: SEED_ID,
    attempted_by: "seed@example.com",
    attempted_at: NOW,
    is_active: "false",
  },

  // ---- the v1.3 portfolio table -------------------------------------------
  //
  // WHY THIS IS A NEW TABLE AND NOT AN ALTERED ONE.
  //
  // `fl_prospect_location` above was imported on 14 Aug carrying v1.1's column
  // names. Spec v1.3 §9 assumed the fallback would be "add the renamed columns
  // alongside and abandon the old ones in place" — that needs ALTER, which this
  // role does not have (§3a P1), and re-import returns 500 (verified against a
  // throwaway table, 15 Aug). So the v1.1 table is FROZEN. The only route to the
  // §3 shape is a new name plus a copy-forward, exactly the move that carried
  // fl_prospect_node into fl_prospect_location a day earlier.
  //
  // The name changes with the model, as it did then: this is the Prospect
  // PORTFOLIO module, and `node` and then `location` were both superseded
  // vocabulary. `fl_prospect_location` is left in place, never hard-deleted.
  //
  // ⚠ THIS SHAPE IS PERMANENT. §3 is the complete and final column list and
  // §13 point 9 is the standing instruction: cut screens, not columns. Every
  // column v1.3 names is here even where no screen reads it yet.
  //
  // Type inference is the whole risk (see the header). Anything meant to be
  // text carries a seed value that cannot parse as a number — `zip` is
  // "P-00000" and not "00000" precisely because a numeric zip column would
  // reject "SW1A 1AA" forever, and `location_phone` keeps its leading '+'.
  fl_portfolio_location: {
    ...common,
    // Written null until the Organization module lands — handlers receive no
    // org context — but the column cannot be added later, so it ships now.
    org_id: SEED_ID,

    // --- §3.1 identity, ownership, lineage ---------------------------------
    // Three nullable owners, at least one always set (§4). Enforced in the
    // function layer; no CHECK constraint is creatable.
    lead_id: SEED_ID,
    account_id: SEED_ID,
    deal_id: SEED_ID,
    survey_id: SEED_ID,
    // ★ §4.3, approved 14 Aug. Same value on every row that is the same
    // physical building across pursuits. This is what lets the global list show
    // one building instead of one row per bid, without walking the chain.
    building_key: "seed-building-key",
    previous_pursuit_id: SEED_ID,
    // §2.3 — the platform's own five words, so convert is a copy.
    type: "site",
    parent_id: SEED_ID,
    // §2.3 rule 4 — materialised ancestry, the shape BaseSpace actually uses.
    // Kept ALONGSIDE parent_id/ancestry_path, not instead of them.
    site_id: SEED_ID,
    building_id: SEED_ID,
    floor_id: SEED_ID,
    space_id_1: SEED_ID,
    space_id_2: SEED_ID,
    space_id_3: SEED_ID,
    space_id_4: SEED_ID,
    space_id_5: SEED_ID,
    ancestry_path: "/seed",
    name: "Seed Location",
    description: "Seed description",
    // Theirs, not ours — a tender response is scored against their numbering.
    code: "SEED",
    // Facilio's own human-readable number, back-filled at convert.
    local_id: 0,
    client_level_label: "facility",
    // L15 answered: CSV inference has no jsonb, so this is text holding JSON,
    // exactly as every other structured value in this repo is stored.
    tags: "[]",

    // --- §3.2 address, as a Location record --------------------------------
    // Facilio does not put the address on the site: Site/Building/Space all
    // carry LOCATION_ID pointing at a separate Location. Convert writes that
    // record first and holds its id here so a second convert never mints a
    // second Location.
    location_name: "Seed Location Record",
    street: "1 Seed Street",
    city: "Seedville",
    state: "Seed State",
    zip: "P-00000",
    country: "AE",
    lat: 25.2048,
    lng: 55.2708,
    // Spaces, not just a leading '+': "+971000000000" parses as a number and
    // would freeze this column numeric, losing every real-world phone format.
    location_phone: "+971 4 000 0000",
    facilio_location_id: "none",

    // --- §3.3 size and shape -----------------------------------------------
    // Area is the single most load-bearing number in soft-services pricing.
    area: 0,
    // Gross and net are frequently the RFP's number and the surveyor's number.
    // Two columns is how that argument gets settled instead of relitigated.
    gross_floor_area: 0,
    no_of_buildings: 0,
    no_of_floors: 0,
    no_of_independent_spaces: 0,
    no_of_sub_spaces: 0,
    // ★ replaces floor_label. An integer: -1 basement, 0 ground, 1 first.
    // The floor's NAME ("Mezzanine") goes in `name` like any other level.
    floor_level: 0,
    max_occupancy: 0,
    // When the building is open decides when the crew can work, which decides
    // the rate.
    operation_hours_start: 8,
    operation_hours_end: 18,
    space_category_id: "none",
    site_type: "none",
    classification: "none",
    // Ours, not Facilio's — restrooms are priced and scored separately in
    // every cleaning contract.
    room_count: 0,
    restroom_count: 0,
    // An enum, never a free number: it changes the crew and the equipment, so
    // it changes the price.
    ceiling_height_band: "standard_8_10ft",

    // --- §3.5 decision, origin, verdict, convert ---------------------------
    pursuit_decision: "undecided",
    pursuit_decision_note: "seed",
    provenance: "manual",
    source_attachment_id: SEED_ID,
    verdict: "unverified",
    verdict_note: "seed",
    verdict_by: "seed@example.com",
    verdict_at: NOW,
    verdict_visit_id: SEED_ID,
    facilio_id: "none",
    facilio_module: "none",
    convert_state: "not_converted",

    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  // ---- review, submit, handoff --------------------------------------------

  fl_survey_recommendation: {
    ...common,
    survey_id: SEED_ID,
    prospect_node_id: SEED_ID,
    visit_id: SEED_ID,
    title: "Seed Recommendation",
    description: "Seed row - safe to delete",
    recommendation_type: "remedial",
    urgency: "low",
    suggested_service_id: "none",
    status: "rejected",
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  fl_survey_qualification: {
    ...common,
    survey_id: SEED_ID,
    source: "assumption",
    source_ref_id: SEED_ID,
    text: "Seed row - safe to delete",
    is_printed_on_proposal: "false",
    generated_automatically: "false",
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  // The four value columns hold whatever the field held — square footage,
  // room counts — so they MUST be seeded non-numeric or a sqft diff of "4500"
  // comes back coerced and the estimator reads a number we never stored.
  fl_survey_reconciliation: {
    ...common,
    survey_id: SEED_ID,
    diff_type: "value_conflict",
    prospect_node_id: SEED_ID,
    field_key: "area_sqft",
    question_instance_id: SEED_ID,
    rfp_value: "seed value",
    survey_value: "seed value",
    suggested_value: "seed value",
    suggestion_basis: "seed basis",
    decision: "manual_override",
    manual_value: "seed value",
    decided_by: "seed@example.com",
    decided_at: NOW,
    decision_note: "seed",
    clarification_id: SEED_ID,
    status: "decided",
    is_active: "false",
  },

  // No `is_active`, for the same reason as fl_prospect_observation: a frozen
  // revision is append-only and can never be deactivated. Superseding it is a
  // new row with is_current = 'true' and the old one flipped to 'false'.
  // A soft-delete flag on an audit record is a way to erase an audit record.
  //
  // DEVIATION from Backend Plan §3.5, stated rather than silent: the column is
  // `trigger_kind`, not `trigger`. TRIGGER is a SQL keyword; it is non-reserved
  // in Postgres and would work unquoted today, but the shape is permanent and
  // a keyword column name is not worth the one-way door.
  fl_survey_revision: {
    ...common,
    survey_id: SEED_ID,
    revision_no: 0,
    frozen_at: NOW,
    frozen_by: "seed@example.com",
    snapshot_json: "{}",
    checksum: "seedchecksum",
    trigger_kind: "cancel",
    is_current: "false",
  },

  // ==========================================================================
  // PROPOSAL LANE — 5 tables. C10 (optional lines excluded from totals),
  // C11 (condition-adjusted rates), C12 (one-time + recurring), C14 (semi-comp
  // liability threshold). Consumes the survey lane's frozen §5 payload.
  //
  // TERMINOLOGY: the word "quote" does not appear in this lane. These tables
  // replace the never-imported fl_quote / fl_quote_line / fl_rate_card_entry
  // drafts; the platform never had them, so this is a redraw, not a migration.
  //
  // The survey lane's three seed rules apply unchanged. `service_code` is the
  // one that matters: it is a code from this app's own catalogue
  // (fl_service_line.code, written by src/modules/service.ts) and it is what
  // every priced row stores. `client_account_id` is a foreign id seeded "none"
  // so type inference keeps it text — the usual trap.
  //
  // `facilio_service_id` is ORPHANED as of 2026-08-15. It held a Facilio
  // Services record id back when a service was a link rather than a record we
  // own; nothing reads or writes it now. It stays in the header because these
  // tables cannot be ALTERed, and re-importing to drop a column would mean
  // rebuilding the table and migrating every priced row.
  //
  // MONEY: every amount column is numeric(14,2) holding MAJOR units. JS holds
  // integer MINOR units end to end (ARCHITECTURE.md §7) and converts at the db
  // boundary in src/modules/proposal.ts — never inside src/domain, which stays
  // pure and integer-only.
  // ==========================================================================

  fl_rate_card: {
    ...common,
    name: "Seed Rate Card",
    description: "Seed row - safe to delete",
    currency: "AED",
    // Resolution inputs (spec §1.2 step 2). Both nullable in life — null means
    // "applies to all" — and most specific wins: region+client, then client,
    // then region, then neither. `priority` breaks a tie.
    region: "none",
    client_account_id: "none",
    priority: 0,
    status: "archived",
    effective_from: NOW,
    effective_to: NOW,
    // The direction this card's condition multipliers were authored in. D-e is
    // unsettled and both conventions live in this product; stamping the card's
    // assumption is what makes a later flip detectable instead of a mispriced
    // contract (src/domain/pricing.ts).
    condition_scale_direction: "1_is_worst",
    version_no: 0,
    parent_rate_card_id: SEED_ID,
    published_by: "seed@example.com",
    published_at: NOW,
    archived_by: "seed@example.com",
    archived_at: NOW,
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  fl_rate_card_row: {
    ...common,
    rate_card_id: SEED_ID,
    facilio_service_id: "none",
    service_code: "SEED",
    description: "Seed row - safe to delete",
    // Joins §5 payload `estimation_values` to a price. The KEY is the contract
    // between the lanes (§5 rule 2), so it lives on the rate row, not on any
    // question wording. This is also the ONLY automatic survey->line path in
    // P1: the spec's Service x Basis x Unit lookup needs a Service, and
    // deriving one from a survey answer is deferred to the P2 AI layer (§7).
    estimation_key: "seed_key",
    // Unit | Hour | Visit. `uom` depends on it (roles&response §4.3): unit ->
    // sq_ft / sq_m / washroom / room / person / site, hour -> hour,
    // visit -> per_visit. Both are enum-likes: text here, validated in domain/.
    pricing_basis: "unit",
    uom: "unit",
    // ONE price per row (spec §3). Cost rate, minimum sell rate and the
    // criteria engine are all cut. `min_charge` survives the cut because the
    // built priceLine() floors on it — see proposal-pricing.ts for the order:
    // the floor applies AFTER the pricing mode, so a discount cannot price a
    // job below the cost of mobilising a crew.
    price: 0,
    min_charge: 0,
    condition_multipliers_json: "{}",
    default_frequency: "one_time",
    sequence_no: 0,
    notes: "seed",
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  fl_proposal: {
    ...common,
    ref_no: "PRP-0000",
    deal_id: SEED_ID,
    account_id: SEED_ID,
    // Both nullable in life: C22 says a simple customer is priced straight
    // from a call, with no survey at all.
    survey_id: SEED_ID,
    survey_revision_id: SEED_ID,
    rate_card_id: SEED_ID,
    // Which card won and why. Spec §3 requires the resolution to be VISIBLE on
    // the proposal — an unexplained price is an unauditable one.
    rate_card_resolved_reason: "seed",
    title: "Seed Proposal",
    status: "superseded",
    currency: "AED",
    contract_type: "non_comprehensive",
    liability_threshold_amount: 0,
    // Stamped at pricing time from the org setting, so a proposal is auditable
    // even if D-e's answer later changes the org default.
    condition_scale_direction: "1_is_worst",
    // Commercial shape (spec §1.1 TERMS).
    payment_terms: "seed",
    expected_programme: "seed",
    one_time_subtotal: 0,
    recurring_monthly_subtotal: 0,
    optional_one_time_total: 0,
    optional_recurring_monthly_total: 0,
    // DELIBERATELY PRESENT AND UNWIRED. Tax is out of this build (spec §11) —
    // a named fast-follow, not an oversight. The columns are drawn now because
    // under no-DDL they cannot be added later. Do not wire them without a
    // decision; an unasked-for VAT line on a proposal is a commercial error.
    tax_pct: 0,
    tax_one_time: 0,
    tax_recurring_monthly: 0,
    total_one_time: 0,
    total_recurring_monthly: 0,
    valid_until: NOW,
    // The document (spec §6). `document_json` is the template SNAPSHOT taken at
    // first render — an admin editing a template on Friday must not change a
    // proposal already with a client. Same problem and same solution as the
    // survey question snapshot (src/modules/snapshot.ts).
    template_id: SEED_ID,
    document_json: "{}",
    // Approval (spec §4). Keys off deviation from card price, not margin —
    // with cost cut from the rate card, margin is not visible anywhere.
    deviation_pct: 0,
    approved_by: "seed@example.com",
    approved_at: NOW,
    // Freeze on send (spec §5). `frozen_json` + `checksum` reuse
    // src/domain/survey-revision.ts's canonicalJson + fnv1a verbatim.
    sent_by: "seed@example.com",
    sent_at: NOW,
    frozen_json: "{}",
    checksum: "seedchecksum",
    // Revision: a new row with a parent link, exactly the survey re-walk
    // pattern (v1.8 T9). Lines belong to the revision, so revising COPIES them
    // — which is what makes "their copy never changes" structurally true
    // instead of a rule people have to remember.
    revision_no: 0,
    parent_proposal_id: SEED_ID,
    superseded_by_proposal_id: SEED_ID,
    decision: "seed",
    decision_reason: "seed",
    decided_at: NOW,
    accepted_at: NOW,
    rejected_at: NOW,
    reject_reason: "seed",
    withdrawn_at: NOW,
    withdraw_reason: "seed",
    notes: "Seed row - safe to delete",
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  fl_proposal_line: {
    ...common,
    proposal_id: SEED_ID,
    sequence_no: 0,
    description: "Seed line - safe to delete",
    facilio_service_id: "none",
    service_code: "SEED",
    scope_node_id: SEED_ID,
    estimation_key: "seed_key",
    // survey_entry | recommendation | manual | external_schedule.
    source: "survey_entry",
    source_ref_id: "none",
    source_answer_id: "none",
    source_observation_id: "none",
    qty: 0,
    pricing_basis: "unit",
    uom: "unit",
    frequency: "one_time",
    // THE DERIVATION IS THE POINT (spec §2.2). Exactly one price column is
    // authoritative at each stage, and `unit_rate` from the old draft is gone
    // so nothing can read a stale third number:
    //   card_price    - copied from the rate row at creation, NEVER looked up
    //                   again. This is what makes a sent proposal immune to a
    //                   later rate change.
    //   applied_price - card_price after the pricing mode.
    //   line_total    - applied_price x qty x condition_multiplier.
    rate_card_id: SEED_ID,
    rate_card_row_id: SEED_ID,
    card_price: 0,
    // standard | discount | markup | custom. Discount and markup are ONE field
    // with a sign — two mechanisms would mean two rounding bugs. `delta_reason`
    // is mandatory for discount, markup and custom; free text in P1, and a
    // seeded list later, because structured reasons are what make the P2 AI
    // markup suggestions worth having.
    pricing_mode: "standard",
    delta_type: "pct",
    delta_value: 0,
    delta_reason: "seed",
    applied_price: 0,
    line_total: 0,
    condition_score: 0,
    condition_multiplier: 0,
    per_occurrence_amount: 0,
    monthly_equivalent_amount: 0,
    one_time_amount: 0,
    is_optional: "false",
    notes: "seed",
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },

  // The only genuinely new table in this lane. A template is an ORDERED LIST OF
  // SECTIONS, not an uploaded file. `sections_json` holds
  // [{ type: "system" | "text", key, title, body }] — system sections render
  // from proposal data (pricing table, optional services, exclusions), text
  // sections are authored with {{tokens}} merged BY A FUNCTION, never a model.
  fl_proposal_template: {
    ...common,
    name: "Seed Template",
    description: "Seed row - safe to delete",
    status: "archived",
    version_no: 0,
    sections_json: "[]",
    is_default: "false",
    published_by: "seed@example.com",
    published_at: NOW,
    archived_by: "seed@example.com",
    archived_at: NOW,
    created_by: "seed@example.com",
    updated_by: "seed@example.com",
    is_active: "false",
  },
};

// --- CSV writing ------------------------------------------------------------

const csvCell = (v) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

const toCsv = (cols) => {
  const names = Object.keys(cols);
  const values = names.map((n) => csvCell(cols[n]));
  return `${names.join(",")}\n${values.join(",")}\n`;
};

// --- run --------------------------------------------------------------------

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const dryRun = process.argv.includes("--dry-run");
const wanted = only.length ? only : Object.keys(tables);

mkdirSync(OUT, { recursive: true });

let created = 0;
let failed = 0;

for (const name of wanted) {
  const cols = tables[name];
  if (!cols) {
    console.error(`✗ ${name}: no such table defined`);
    failed++;
    continue;
  }

  const file = join(OUT, `${name}.csv`);
  writeFileSync(file, toCsv(cols));

  if (dryRun) {
    console.log(`· ${name} → ${Object.keys(cols).length} columns (dry run)`);
    continue;
  }

  try {
    execFileSync("facilio", ["vibe", "db", "import", "--file", file, "--table", name], {
      stdio: "pipe",
      encoding: "utf8",
    });
    console.log(`✓ ${name} (${Object.keys(cols).length} columns)`);
    created++;
  } catch (e) {
    const msg = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").pop();
    console.error(`✗ ${name}: ${msg}`);
    failed++;
  }
}

console.log(`\n${created} created, ${failed} failed, ${wanted.length} total`);
if (failed) process.exitCode = 1;
