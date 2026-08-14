/**
 * The service catalogue — this app's own definition of what it sells.
 *
 * WHAT CHANGED, AND WHY (2026-08-15, Yameen's call):
 * `fl_service_line` used to be a scope list whose real job was to hold a
 * `facilio_service_id` in `data_json` — every priced thing referenced the
 * Facilio Services record and the local row was only a label for it. That link
 * is gone. This app now OWNS service definitions: a service is created, named,
 * described and retired here, and the touchpoints (rate card rows, proposal
 * lines, survey recommendations) reference it by `code`.
 *
 * ONE IDENTIFIER, AND IT IS `code`. `fl_rate_card_row.service_code` and
 * `fl_proposal_line.service_code` already point at it and there are no foreign
 * keys in this database to catch a mismatch, so `code` is the natural key and
 * it is IMMUTABLE once a service exists: `saveService` upserts by code, so
 * "editing" a code would silently mint a second service and leave every priced
 * row pointing at a name nothing answers to. The UI does not offer it; nor does
 * this module.
 *
 * `fl_service_line` cannot be ALTERed (ARCHITECTURE.md §3a — the role has no
 * DDL), so it keeps its three real columns — `code`, `name`, `active` — and the
 * catalogue's new fields ride in `data_json`. The old `facilio_service_id` key
 * is simply no longer read or written; nothing goes back to clean it out.
 */

import { many, mutate, nowIso, one } from "../shared/db";
import { upsertJsonKey } from "../shared/row-map";
import {
  normalizeCode,
  PRICING_BASES,
  resolveServiceDefaults,
  UNITS_BY_BASIS,
} from "../domain/service-catalogue";

// The basis/unit master lived in modules/proposal.ts until the catalogue
// existed. It belongs to the service now — a rate row prefills from the
// service it prices, so there can only be one master — and it is re-exported
// through here and through proposal so no caller had to move.
export { normalizeCode, PRICING_BASES, UNITS_BY_BASIS };

export interface Service {
  id: string;
  code: string;
  name: string;
  /** What this service is, in the words a proposal line can borrow. */
  description: string | null;
  /** Prefills a rate card row. Null means the row picks its own. */
  defaultPricingBasis: string | null;
  /** Must belong to `defaultPricingBasis`. Null when the basis is null. */
  defaultUom: string | null;
  /** "true"/"false" string, like every boolean column in this schema. */
  active: string;
}

/**
 * The catalogue's columns, as one SQL fragment.
 *
 * Exported because `settings.configData()` reads services inside its single
 * batched call and must return the same shape this module does — two spellings
 * of the same read is how a field starts arriving on one page and not another.
 */
export const SERVICE_COLUMNS = `
  id, code, name, active,
  (coalesce(nullif(data_json::text, ''), '{}'))::jsonb ->> 'description' as description,
  (coalesce(nullif(data_json::text, ''), '{}'))::jsonb ->> 'default_pricing_basis'
    as default_pricing_basis,
  (coalesce(nullif(data_json::text, ''), '{}'))::jsonb ->> 'default_uom' as default_uom
`;

export function listServices(): Service[] {
  return many<Service>(
    `select ${SERVICE_COLUMNS} from fl_service_line order by code limit 200`
  );
}

/**
 * Looked up case-INSENSITIVELY, and this is not defensive padding: rows
 * written before `saveService` existed stored whatever code was typed, so a
 * catalogue seeded as "gc" must still answer to the "GC" a rate card row
 * carries. Cheap on a 200-row table, and this schema has no indexes anyway
 * (the DB role cannot create one).
 */
export function serviceByCode(code: string): Service | null {
  return one<Service>(
    `select ${SERVICE_COLUMNS} from fl_service_line where upper(code) = $1 limit 1`,
    [code.trim().toUpperCase()]
  );
}

// ── Writing ──────────────────────────────────────────────────────────────────

export interface ServiceInput {
  code: string;
  name: string;
  /** `null` clears it; `undefined` leaves whatever is stored alone. */
  description?: string | null;
  defaultPricingBasis?: string | null;
  defaultUom?: string | null;
  active?: boolean;
}

/**
 * Create or update, keyed on `code`.
 *
 * A code that already exists is an UPDATE, never a duplicate: that is what
 * makes the seeder re-runnable and what keeps two admins typing "HVAC" from
 * producing two services. Fields left `undefined` keep their stored value, so a
 * save that only flips `active` cannot blank a description.
 */
export function saveService(input: ServiceInput): { id: string; code: string; created: boolean } {
  const code = normalizeCode(input.code);
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error(`service ${code} needs a name`);

  const now = nowIso();
  // `upper(code)`, not `code`: a service stored as "gc" before codes were
  // normalised must be UPDATED by a save of "GC", not shadowed by a second row
  // — which is the exact split the code key exists to prevent.
  const existing = one<{ id: string; active: string | null; dataRaw: unknown }>(
    "select id, active, data_json::text as data_raw from fl_service_line where upper(code) = $1 limit 1",
    [code]
  );

  // Unmentioned means UNCHANGED, not "true". A rename that resurrected a
  // service somebody retired on purpose would put it back in front of every
  // rate card row, and nothing would have said so.
  const active =
    input.active === undefined
      ? (existing?.active === "false" ? "false" : "true")
      : input.active === false
        ? "false"
        : "true";

  // Read-modify-write in code rather than jsonb_set in SQL: it works whatever
  // type CSV inference gave data_json, and preserves keys already riding in the
  // column — including the abandoned `facilio_service_id`, which is left where
  // it lies rather than rewritten by a save that has nothing to do with it.
  let data = typeof existing?.dataRaw === "string" ? existing.dataRaw : "{}";

  if (input.description !== undefined) {
    const text = typeof input.description === "string" ? input.description.trim() : "";
    data = upsertJsonKey(data, "description", text || null);
  }

  if (input.defaultPricingBasis !== undefined || input.defaultUom !== undefined) {
    const { basis, uom } = resolveServiceDefaults(input.defaultPricingBasis, input.defaultUom);
    data = upsertJsonKey(data, "default_pricing_basis", basis);
    data = upsertJsonKey(data, "default_uom", uom);
  }

  if (existing) {
    mutate(
      "update fl_service_line set name = $2, active = $3, data_json = $4, updated_at = $5 where id = $1",
      [existing.id, name, active, data, now]
    );
    return { id: existing.id, code, created: false };
  }

  const row = one<{ id: string }>(
    `insert into fl_service_line (id, code, name, active, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $5)
     returning id`,
    [code, name, active, data, now]
  );
  if (!row) throw new Error(`could not save service ${code}`);
  return { id: row.id, code, created: true };
}

// ── Usage ────────────────────────────────────────────────────────────────────

/**
 * How many priced rows name each service, by code.
 *
 * Retiring a service is not free: `resolveService` in modules/proposal.ts
 * refuses to price against an inactive one, so switching a service off breaks
 * every rate card row that names it. This is the count the UI warns with — the
 * alternative is an admin discovering it from a proposal that will not save.
 *
 * One call, not two: a `query()` costs ~194ms of fixed bridge overhead whatever
 * it asks for (shared/db.ts).
 */
export function serviceUsage(): Record<string, number> {
  const rows = many<{ code: string | null; uses: number | string }>(
    // `upper(service_code)` on both sides. A legacy row spelled "gc" would
    // otherwise land under its own key and the count for "GC" would come back
    // short — and this count is the whole basis on which someone decides a
    // service is safe to retire.
    `select code, sum(n) as uses from (
       select upper(service_code) as code, count(*) as n
         from fl_rate_card_row where is_active = 'true' group by upper(service_code)
       union all
       select upper(service_code) as code, count(*) as n
         from fl_proposal_line where is_active = 'true' group by upper(service_code)
     ) t
     where code is not null
     group by code
     limit 500`
  );

  const usage: Record<string, number> = {};
  for (const r of rows) {
    if (!r.code) continue;
    const n = Number(r.uses);
    usage[r.code] = Number.isFinite(n) ? n : 0;
  }
  return usage;
}

/** The catalogue and its usage counts — everything the Services page renders. */
export function catalogueView(): { services: Service[]; usage: Record<string, number> } {
  return { services: listServices(), usage: serviceUsage() };
}
