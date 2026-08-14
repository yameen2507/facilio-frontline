/**
 * Service coverage and SLA configuration.
 *
 * The analyst cannot judge relevance from prompt text alone — "is this in our
 * region, is this one of our services" needs data to compare against. That data
 * lives here and is rendered into the agent's input on every run, so changing
 * coverage changes the verdicts without touching the agent.
 */

import { many, mutate, nowIso, one } from "../shared/db";
import { DEFAULT_SLA, type SlaTargets } from "../domain/sla";
import { listServices, SERVICE_COLUMNS, type Service } from "./service";

export interface ServiceArea {
  id: string;
  name: string;
  region: string | null;
  country: string | null;
  active: string;
}

/**
 * The catalogue itself moved to `modules/service.ts` (2026-08-15) — this file
 * only reads it, for coverage and the analyst's scope brief. The alias stays
 * because "service line" is what coverage calls its half of the pairing.
 */
export type ServiceLine = Service;

export interface Coverage {
  id: string;
  areaId: string;
  serviceLineId: string;
  active: string;
}

// --- batched config read ----------------------------------------------------

/**
 * Every configuration value the app reads, fetched in ONE database call.
 *
 * Why this exists: a `query()` call costs ~194ms of fixed bridge overhead on the
 * deployed app whatever it asks for (see shared/db.ts). `coverageView()` used to
 * cost twelve of them — three coverage lists, three SLA settings, two prompt
 * settings, and then `coverageBrief()` re-reading the same three lists and two
 * settings all over again — about 2.3s of pure overhead to render one page.
 *
 * So the reads happen once, here, and everything downstream takes the result as
 * an argument. The functions still work with no argument (they fall back to
 * fetching what they need), because `slaTargets()` is called from `createLead`
 * where the rest of this is not wanted.
 */
export interface ConfigData {
  areas: ServiceArea[];
  serviceLines: ServiceLine[];
  coverage: Coverage[];
  /** Raw setting values by key, already JSON-parsed. Absent key = never set. */
  settings: Record<string, unknown>;
}

const SLA_KEYS = {
  firstResponseMins: "sla.first_response_mins",
  qualificationMins: "sla.qualification_mins",
  assignmentMins: "sla.assignment_mins",
} as const;

/**
 * The analyst's two identifiers, declared here rather than imported from
 * modules/analysis to keep the dependency one-way — analysis imports settings.
 * They are included in the batched read so `settings-get` and `analyse-input`
 * cost one call rather than one plus two.
 */
const ANALYST_KEYS = ["lead.analyst_agent", "lead.analyst_agent_link"] as const;

export function configData(): ConfigData {
  const row = one<{
    areas: ServiceArea[];
    serviceLines: ServiceLine[];
    coverage: Coverage[];
    settingRows: Array<{ key: string; value: unknown }>;
  }>(
    `select
       (select coalesce(json_agg(x order by x.name), '[]'::json) from (
          select id, name, region, country, active
            from fl_service_area order by name limit 200
        ) x) as areas_arr,

       (select coalesce(json_agg(x order by x.code), '[]'::json) from (
          select ${SERVICE_COLUMNS}
            from fl_service_line order by code limit 200
        ) x) as service_lines_arr,

       (select coalesce(json_agg(x), '[]'::json) from (
          select id, area_id, service_line_id, active
            from fl_service_coverage limit 2000
        ) x) as coverage_arr,

       (select coalesce(json_agg(x), '[]'::json) from (
          select key, value_json from fl_setting
           where key in ($1, $2, $3, $4, $5, $6, $7) limit 7
        ) x) as setting_rows_arr`,
    [
      SLA_KEYS.firstResponseMins,
      SLA_KEYS.qualificationMins,
      SLA_KEYS.assignmentMins,
      SCOPE_NOTES_SETTING,
      ANALYST_TASK_SETTING,
      ANALYST_KEYS[0],
      ANALYST_KEYS[1],
    ]
  );

  const settings: Record<string, unknown> = {};
  for (const r of row?.settingRows ?? []) settings[r.key] = r.value;

  return {
    areas: row?.areas ?? [],
    serviceLines: row?.serviceLines ?? [],
    coverage: row?.coverage ?? [],
    settings,
  };
}

// --- raw settings -----------------------------------------------------------

export function getSetting<T>(key: string, fallback: T): T {
  const row = one<{ value: T }>("select value_json from fl_setting where key = $1 limit 1", [key]);
  return row && row.value !== null && row.value !== undefined ? row.value : fallback;
}

export function setSetting(key: string, value: unknown): void {
  const now = nowIso();
  const json = JSON.stringify(value ?? null);

  const updated = mutate(
    "update fl_setting set value_json = $2, updated_at = $3 where key = $1",
    [key, json, now]
  );

  if (updated === 0) {
    mutate(
      `insert into fl_setting (id, key, value_json, data_json, created_at, updated_at)
       select gen_random_uuid()::text, $1, $2, '{}', $3, $3
        where not exists (select 1 from fl_setting where key = $1)`,
      [key, json, now]
    );
  }
}

/**
 * A setting that must be text. A key written before it had a shape — the seed
 * row holds `{}` — would otherwise hand a caller an object where it expects a
 * string, and that only surfaces as a broken prompt.
 */
function stringSetting(key: string, fallback: string): string {
  const v = getSetting<unknown>(key, fallback);
  return typeof v === "string" ? v : fallback;
}

// --- editable prompt --------------------------------------------------------

/**
 * The parts of the analyst's prompt an operator can change from the UI.
 *
 * An agent's own `--instructions`, provider, model and output schema are fixed
 * by `facilio vibe agent create/update` and there is no browser path to them —
 * the SDK only exposes `executeAgent`. So the only text editable at runtime is
 * what THIS app sends as the agent's input, which is these two settings.
 *
 * `scopeNotes` is APPENDED to the generated coverage brief rather than
 * replacing it: coverage data stays the source of truth for relevance, and the
 * note carries the nuance a matrix cannot ("no high-rise façade work").
 */
export const SCOPE_NOTES_SETTING = "agent.scope_notes";
export const ANALYST_TASK_SETTING = "agent.analyst_task";

export const DEFAULT_ANALYST_TASK =
  "Assess this lead against the service scope above. Reply as JSON matching your output schema.";

export interface PromptConfig {
  scopeNotes: string;
  analystTask: string;
}

export function promptConfig(data?: ConfigData): PromptConfig {
  // With prefetched config this is free; without it, it is the two reads it
  // always was. Callers on a hot path should pass `configData()`.
  const text = (key: string, fallback: string): string => {
    if (!data) return stringSetting(key, fallback);
    const v = data.settings[key];
    return typeof v === "string" ? v : fallback;
  };

  return {
    scopeNotes: text(SCOPE_NOTES_SETTING, ""),
    analystTask: text(ANALYST_TASK_SETTING, DEFAULT_ANALYST_TASK),
  };
}

/** True once either prompt setting has been edited away from the shipped default. */
export function promptEdited(cfg: PromptConfig = promptConfig()): boolean {
  return cfg.analystTask.trim() !== DEFAULT_ANALYST_TASK || cfg.scopeNotes.trim() !== "";
}

/**
 * All three targets in one call rather than three `getSetting`s.
 *
 * Every lead `create` reads these to stamp its due dates, and a `query()` call
 * costs ~194ms of fixed overhead whatever it asks for (see shared/db.ts), so
 * three one-row lookups cost ~580ms where one three-row lookup costs ~194ms.
 */
export function slaTargets(data?: ConfigData): SlaTargets {
  // One call for all three, rather than the three `getSetting`s this used to do.
  // Every lead `create` reads these to stamp its due dates.
  const settings =
    data?.settings ??
    Object.fromEntries(
      many<{ key: string; value: unknown }>(
        "select key, value_json from fl_setting where key in ($1, $2, $3) limit 3",
        [SLA_KEYS.firstResponseMins, SLA_KEYS.qualificationMins, SLA_KEYS.assignmentMins]
      ).map((r) => [r.key, r.value])
    );

  // A key absent from fl_setting, or present but holding null, falls back to the
  // shipped default — the same contract getSetting had.
  const read = (key: string, fallback: number): number => {
    const raw = settings[key];
    if (raw === undefined || raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    firstResponseMins: read(SLA_KEYS.firstResponseMins, DEFAULT_SLA.firstResponseMins),
    qualificationMins: read(SLA_KEYS.qualificationMins, DEFAULT_SLA.qualificationMins),
    assignmentMins: read(SLA_KEYS.assignmentMins, DEFAULT_SLA.assignmentMins),
  };
}

// --- coverage ---------------------------------------------------------------

export function listAreas(): ServiceArea[] {
  return many<ServiceArea>(
    "select id, name, region, country, active from fl_service_area order by name limit 200"
  );
}

/** The catalogue, as coverage sees it. The writer is `modules/service.ts`. */
export const listServiceLines = listServices;

export function listCoverage(): Coverage[] {
  return many<Coverage>(
    "select id, area_id, service_line_id, active from fl_service_coverage limit 2000"
  );
}

/** Upsert by natural key — `name` for areas, `code` for service lines. */
export function saveArea(input: {
  name: string;
  region?: string | null;
  country?: string | null;
  active?: boolean;
}): string {
  const now = nowIso();
  const active = input.active === false ? "false" : "true";
  const existing = one<{ id: string }>("select id from fl_service_area where name = $1 limit 1", [
    input.name,
  ]);

  if (existing) {
    mutate(
      `update fl_service_area set region = $2, country = $3, active = $4, updated_at = $5 where id = $1`,
      [existing.id, input.region ?? null, input.country ?? null, active, now]
    );
    return existing.id;
  }

  const row = one<{ id: string }>(
    `insert into fl_service_area (id, name, region, country, active, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, '{}', $5, $5)
     returning id`,
    [input.name, input.region ?? null, input.country ?? null, active, now]
  );
  if (!row) throw new Error("could not save service area");
  return row.id;
}

// `saveServiceLine` is gone (2026-08-15): a service is written by
// `saveService` in modules/service.ts, which owns the catalogue's fields and
// the code's shape. Coverage still writes its own pairing below.

export function saveCoverage(areaId: string, serviceLineId: string, active = true): void {
  const now = nowIso();
  const flag = active ? "true" : "false";
  const existing = one<{ id: string }>(
    "select id from fl_service_coverage where area_id = $1 and service_line_id = $2 limit 1",
    [areaId, serviceLineId]
  );

  if (existing) {
    mutate("update fl_service_coverage set active = $2, updated_at = $3 where id = $1", [
      existing.id,
      flag,
      now,
    ]);
    return;
  }

  mutate(
    `insert into fl_service_coverage (id, area_id, service_line_id, active, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, '{}', $4, $4)`,
    [areaId, serviceLineId, flag, now]
  );
}

export interface CoverageView {
  areas: ServiceArea[];
  serviceLines: ServiceLine[];
  coverage: Coverage[];
  sla: SlaTargets;
  prompt: PromptConfig;
  /** The composed scope brief exactly as the analyst receives it. */
  brief: string;
}

/** One database call for the whole settings page. See `configData`. */
export function coverageView(data: ConfigData = configData()): CoverageView {
  return {
    areas: data.areas,
    serviceLines: data.serviceLines,
    coverage: data.coverage,
    sla: slaTargets(data),
    prompt: promptConfig(data),
    brief: coverageBrief(data),
  };
}

/**
 * Coverage as plain text for the analyst's input.
 *
 * Agent instructions are fixed at creation time, so scope has to travel with
 * each request — otherwise editing coverage in settings would silently fail to
 * change any verdict.
 */
export function coverageBrief(data: ConfigData = configData()): string {
  const areas = data.areas.filter((a) => a.active === "true");
  const lines = data.serviceLines.filter((l) => l.active === "true");
  const coverage = data.coverage.filter((c) => c.active === "true");
  const notes = promptConfig(data).scopeNotes.trim();

  // The operator's note is appended in both branches: it is the only place a
  // caveat can live when coverage itself has not been configured yet.
  const withNotes = (body: string[]): string =>
    (notes ? [...body, "", "ALSO TRUE OF OUR SCOPE:", notes] : body).join("\n");

  if (!areas.length || !lines.length) {
    return withNotes([
      "SERVICE SCOPE: not configured yet. Treat every lead as unsure and explain that coverage is unconfigured.",
    ]);
  }

  const lineById = new Map(lines.map((l) => [l.id, l]));
  const parts: string[] = ["SERVICE SCOPE — we only serve these service/area combinations:"];

  for (const area of areas) {
    const served = coverage
      .filter((c) => c.areaId === area.id)
      .map((c) => lineById.get(c.serviceLineId))
      .filter((l): l is ServiceLine => Boolean(l))
      .map((l) => `${l.name} (${l.code})`);

    parts.push(
      served.length
        ? `- ${area.name}${area.region ? `, ${area.region}` : ""}: ${served.join("; ")}`
        : `- ${area.name}: no services enabled`
    );
  }

  parts.push(
    "Anything outside these areas is outside_region. Anything not in the listed services is not_relevant."
  );

  return withNotes(parts);
}
