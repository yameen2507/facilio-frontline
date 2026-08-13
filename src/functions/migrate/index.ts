/**
 * Schema housekeeping. Deliberately NOT DDL — the app's DB role cannot create,
 * alter, drop or index anything (ARCHITECTURE.md §3a). Tables are created by
 * `node scripts/db-import.mjs`; this function only manages their contents:
 *
 *  - clean-seed  removes the type-inference seed row each imported table carries
 *  - seed-config seeds sequences and default SLA settings
 *  - status      row counts, so a migration can be verified without a UI
 */

import StudioFunctions from "@facilio/studio-functions";
import { count, many, mutate, nowIso, one } from "../../shared/db";

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
