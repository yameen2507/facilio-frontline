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
