/**
 * The single database boundary. Nothing in `modules/` may talk to StudioDatabase
 * directly — the wire-format corrections in shared/row-map.ts have to be applied
 * in exactly one place (see ARCHITECTURE.md §3a).
 *
 * PERFORMANCE NOTE — read before adding a query.
 *
 * Every `query()` call costs ~194ms of fixed overhead on the deployed app,
 * whatever the query does. Measured against `frontline`: a handler running no
 * queries takes 1.10s, one running 18 trivial `count(*)`s takes 4.59s — a clean
 * straight line at 194ms per call, with query complexity making no difference.
 * That is bridge/connection cost, not execution time, and the DB role cannot
 * create indexes anyway (see functions/migrate).
 *
 * So the only lever is FEWER CALLS. A read wanting several result sets should ask
 * for them as `row_to_json` / `json_agg` subqueries in one statement, aliased
 * `_obj` / `_arr` — row-map.ts unpacks those back into nested camelCase. Adding
 * a query to a hot handler costs the user a fifth of a second.
 */

import { StudioDatabase } from "@facilio/studio-functions";
import { mapRow, type Row } from "./row-map";

export type { Row } from "./row-map";

let cached: StudioDatabase | null = null;

/**
 * Env names are `SCHEMA` / `DB_USER` / `DB_PASSWORD` — verified by probe.
 * The CLI authoring guide's `DB_USERNAME` is wrong; llm.md's names are right.
 * `schema` MUST be passed: without it there is no search_path and every
 * unqualified query fails with "no schema has been selected".
 */
export function db(): StudioDatabase {
  if (cached) return cached;

  const userName = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const schema = process.env.SCHEMA;

  if (!userName || !password || !schema) {
    throw new Error(
      `database credentials missing (DB_USER=${!!userName}, DB_PASSWORD=${!!password}, SCHEMA=${!!schema})`
    );
  }

  cached = new StudioDatabase({ userName, password, schema });
  return cached;
}

/** Rows mapped to camelCase with numerics coerced. Always pass a LIMIT in `sql`. */
export function many<T = Row>(sql: string, params?: unknown[]): T[] {
  const res = db().query(sql, params);
  return (res.rows || []).map((r) => mapRow(r as Row)) as T[];
}

/** First row, or null. */
export function one<T = Row>(sql: string, params?: unknown[]): T | null {
  const rows = many<T>(sql, params);
  return rows.length ? rows[0] : null;
}

/** INSERT/UPDATE/DELETE. Returns affected row count. */
export function mutate(sql: string, params?: unknown[]): number {
  const res = db().query(sql, params);
  return res.rowCount ?? 0;
}

/** `select count(*) as c ...` — the result is a string on the wire. */
export function count(sql: string, params?: unknown[]): number {
  const res = db().query(sql, params);
  const raw = (res.rows?.[0] as Row | undefined)?.c;
  return raw === undefined || raw === null ? 0 : Number(raw);
}

/**
 * True when the row cap was hit, so callers can say "showing first N" rather
 * than silently presenting a partial set as complete.
 */
export function manyWithTruncation<T = Row>(
  sql: string,
  params?: unknown[]
): { rows: T[]; truncated: boolean } {
  const res = db().query(sql, params);
  return {
    rows: (res.rows || []).map((r) => mapRow(r as Row)) as T[],
    truncated: Boolean(res.truncated),
  };
}

/** ISO 8601 UTC — the only timestamp format in this schema. Sorts correctly as text. */
export function nowIso(): string {
  return new Date().toISOString();
}
