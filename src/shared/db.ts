/**
 * The single database boundary. Nothing in `modules/` may talk to StudioDatabase
 * directly, because two platform quirks have to be neutralised in exactly one
 * place (see ARCHITECTURE.md §3a):
 *
 *  1. `numeric`, `bigint` and `count(*)` come back as JavaScript STRINGS, while
 *     `int` comes back as a number. Silent and inconsistent — a subtotal built
 *     from raw rows concatenates instead of adding.
 *  2. Columns are snake_case; the API contract is camelCase.
 *
 * Also parses each row's `data_json` overflow column into `data`, since that is
 * where any field we do not filter on lives.
 */

import { StudioDatabase } from "@facilio/studio-functions";

/**
 * Columns created as `numeric` by the CSV import (scripts/db-import.mjs).
 * Coercion is by column NAME rather than by sniffing values: a text column that
 * happens to hold "42" — a Facilio id, say — must stay a string.
 */
const NUMERIC_COLUMNS = new Set([
  "estimated_value",
  "score",
  "current_value",
  "attempts",
  "version",
  "turn_count",
  "turn_index",
  "size_bytes",
  "vibe_file_id",
]);

const snakeToCamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Bare column name from an aliased select, e.g. `l.score` -> `score`. */
const bare = (col: string): string => {
  const dot = col.lastIndexOf(".");
  return dot === -1 ? col : col.slice(dot + 1);
};

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

export type Row = Record<string, unknown>;

function mapRow(row: Row): Row {
  const out: Row = {};

  for (const key of Object.keys(row)) {
    const col = bare(key);
    const value = row[key];

    if (col === "data_json") {
      out.data = parseJson(value, {});
      continue;
    }

    // Any *_json column is stored as text; hand back parsed structure.
    if (col.endsWith("_json")) {
      out[snakeToCamel(col.slice(0, -5))] = parseJson(value, null);
      continue;
    }

    if (NUMERIC_COLUMNS.has(col) && typeof value === "string" && value !== "") {
      const n = Number(value);
      out[snakeToCamel(col)] = Number.isNaN(n) ? value : n;
      continue;
    }

    out[snakeToCamel(col)] = value;
  }

  return out;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
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
