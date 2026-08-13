/**
 * Wire-format correction for rows coming back from StudioDatabase.
 *
 * Split out of shared/db.ts so it can be unit-tested: `@facilio/studio-functions`
 * is provided by the platform build and cannot be installed locally, so anything
 * importing it is untestable here. This file imports nothing.
 *
 * Two platform quirks are neutralised (see ARCHITECTURE.md §3a):
 *
 *  1. `numeric`, `bigint` and `count(*)` come back as JavaScript STRINGS, while
 *     `int` comes back as a number. Silent and inconsistent — a subtotal built
 *     from raw rows concatenates instead of adding.
 *  2. Columns are snake_case; the API contract is camelCase.
 */

export type Row = Record<string, unknown>;

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

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Applies the same two corrections as `mapRow` to structure that arrived INSIDE
 * a json column rather than as columns of its own.
 *
 * Why this exists: every `query()` call costs ~194ms of fixed bridge overhead
 * regardless of what the query does (measured on the deployed app — a handler
 * running 18 `count(*)`s takes 4.6s, one running none takes 1.1s). So a read
 * that wants five result sets asks for them as five `row_to_json` / `json_agg`
 * subqueries in ONE statement, turning 5 x 194ms into 1 x 194ms. But that also
 * means `mapRow` sees one column instead of forty: without this it would hand
 * back snake_case keys and never look inside the blob.
 *
 * Aliased `_obj` (single row) and `_arr` (array of rows) so batching is explicit
 * at the call site, and so the existing `_json` columns keep today's handling.
 */
function mapDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mapDeep);
  if (value === null || value === undefined || typeof value !== "object") return value;

  const out: Row = {};

  for (const key of Object.keys(value as Row)) {
    const raw = (value as Row)[key];

    if (key === "data_json") {
      out.data = parseJson(raw, {});
      continue;
    }

    if (key.endsWith("_json")) {
      out[snakeToCamel(key.slice(0, -5))] = parseJson(raw, null);
      continue;
    }

    // A `numeric` inside row_to_json usually arrives already a JSON number, but
    // the flat wire format hands it back as a string — accept either, because
    // scoreBand and the UI's `score >= 75` thresholds depend on it being one.
    if (NUMERIC_COLUMNS.has(key) && typeof raw === "string" && raw !== "") {
      const n = Number(raw);
      out[snakeToCamel(key)] = Number.isNaN(n) ? raw : n;
      continue;
    }

    out[snakeToCamel(key)] = mapDeep(raw);
  }

  return out;
}

export function mapRow(row: Row): Row {
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

    // A batched sub-result: one nested row, or null when the subquery matched
    // nothing. See mapDeep for why reads are batched this way.
    if (col.endsWith("_obj")) {
      out[snakeToCamel(col.slice(0, -4))] = mapDeep(parseJson(value, null));
      continue;
    }

    // A batched sub-result: an array of nested rows, `[]` when empty.
    if (col.endsWith("_arr")) {
      out[snakeToCamel(col.slice(0, -4))] = mapDeep(parseJson(value, []));
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
