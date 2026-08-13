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

export interface ServiceArea {
  id: string;
  name: string;
  region: string | null;
  country: string | null;
  active: string;
}

export interface ServiceLine {
  id: string;
  code: string;
  name: string;
  active: string;
}

export interface Coverage {
  id: string;
  areaId: string;
  serviceLineId: string;
  active: string;
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

export function slaTargets(): SlaTargets {
  return {
    firstResponseMins: Number(getSetting("sla.first_response_mins", DEFAULT_SLA.firstResponseMins)),
    qualificationMins: Number(getSetting("sla.qualification_mins", DEFAULT_SLA.qualificationMins)),
    assignmentMins: Number(getSetting("sla.assignment_mins", DEFAULT_SLA.assignmentMins)),
  };
}

// --- coverage ---------------------------------------------------------------

export function listAreas(): ServiceArea[] {
  return many<ServiceArea>(
    "select id, name, region, country, active from fl_service_area order by name limit 200"
  );
}

export function listServiceLines(): ServiceLine[] {
  return many<ServiceLine>(
    "select id, code, name, active from fl_service_line order by code limit 200"
  );
}

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

export function saveServiceLine(input: { code: string; name: string; active?: boolean }): string {
  const now = nowIso();
  const active = input.active === false ? "false" : "true";
  const existing = one<{ id: string }>("select id from fl_service_line where code = $1 limit 1", [
    input.code,
  ]);

  if (existing) {
    mutate(`update fl_service_line set name = $2, active = $3, updated_at = $4 where id = $1`, [
      existing.id,
      input.name,
      active,
      now,
    ]);
    return existing.id;
  }

  const row = one<{ id: string }>(
    `insert into fl_service_line (id, code, name, active, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, '{}', $4, $4)
     returning id`,
    [input.code, input.name, active, now]
  );
  if (!row) throw new Error("could not save service line");
  return row.id;
}

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
}

export function coverageView(): CoverageView {
  return {
    areas: listAreas(),
    serviceLines: listServiceLines(),
    coverage: listCoverage(),
    sla: slaTargets(),
  };
}

/**
 * Coverage as plain text for the analyst's input.
 *
 * Agent instructions are fixed at creation time, so scope has to travel with
 * each request — otherwise editing coverage in settings would silently fail to
 * change any verdict.
 */
export function coverageBrief(): string {
  const areas = listAreas().filter((a) => a.active === "true");
  const lines = listServiceLines().filter((l) => l.active === "true");
  const coverage = listCoverage().filter((c) => c.active === "true");

  if (!areas.length || !lines.length) {
    return "SERVICE SCOPE: not configured yet. Treat every lead as unsure and explain that coverage is unconfigured.";
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

  return parts.join("\n");
}
