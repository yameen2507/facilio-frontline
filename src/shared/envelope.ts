/**
 * Handler input/output plumbing.
 *
 * The platform only allows `number` and `string` handler parameters, so every
 * non-trivial input arrives as a JSON string in `payload`. Validation is
 * hand-rolled rather than schema-library-driven: bundle weight matters in
 * QuickJS, and the shapes here are small.
 */

export type Payload = Record<string, unknown>;

export interface Ok<T> {
  ok: true;
  data: T;
}

export interface Err {
  ok: false;
  error: string;
}

export const ok = <T>(data: T): Ok<T> => ({ ok: true, data });
export const fail = (error: string): Err => ({ ok: false, error });

/**
 * Wrap a handler body so a thrown Error becomes `{ ok:false, error }` rather
 * than an opaque platform failure. Every handler returns the same envelope.
 */
export async function handle<T>(body: () => Promise<T> | T): Promise<Ok<T> | Err> {
  try {
    return ok(await body());
  } catch (e) {
    return fail(String((e as Error)?.message ?? e));
  }
}

/**
 * Read a handler's input, accepting BOTH shapes:
 *
 *   1. `{ payload: "{\"companyName\":\"…\"}" }`  — the CLI / SDK envelope
 *   2. `{ companyName: "…", source: "widget" }`  — flat fields
 *
 * Both are needed. The platform only allows `string`/`number` handler
 * parameters, which forces the JSON-string envelope for nested input. But a
 * Facilio **connection action** derives its request template by mapping each
 * input-schema property straight into the body at the top level
 * (`{"body":{"source":"{{source}}"}}`), so an action can only ever send flat
 * fields. Supporting both means one handler serves the CLI, the browser SDK and
 * the published connection action with no duplication.
 *
 * Flat fields win over the same key inside `payload`.
 */
export function parsePayload(args: Record<string, unknown>): Payload {
  const fromEnvelope = parseEnvelope(args?.payload);
  const flat = flatFields(args);
  return { ...fromEnvelope, ...flat };
}

function parseEnvelope(raw: unknown): Payload {
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw === "object") return raw as Payload; // tolerate a pre-parsed object
  if (typeof raw !== "string") throw new Error("payload must be a JSON string");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload must be a JSON object");
    }
    return parsed as Payload;
  } catch (e) {
    throw new Error(`payload is not valid JSON: ${String((e as Error).message)}`);
  }
}

/**
 * Top-level args other than `payload`, skipping blanks.
 *
 * A connection action templates every declared property, so an omitted optional
 * field arrives as the literal unresolved `{{name}}` or as an empty string —
 * both must be treated as absent rather than as a value.
 */
function flatFields(args: Record<string, unknown>): Payload {
  const out: Payload = {};
  if (!args || typeof args !== "object") return out;

  for (const key of Object.keys(args)) {
    if (key === "payload") continue;

    const value = args[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "" || /^\{\{.*\}\}$/.test(trimmed)) continue; // unresolved template
      out[key] = trimmed;
      continue;
    }
    out[key] = value;
  }

  return out;
}

// --- field readers ----------------------------------------------------------

export function str(p: Payload, key: string): string {
  const v = p[key];
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${key} is required`);
  return v.trim();
}

export function optStr(p: Payload, key: string): string | null {
  const v = p[key];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export function optNum(p: Payload, key: string): number | null {
  const v = p[key];
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  return n;
}

export function optBool(p: Payload, key: string): boolean | null {
  const v = p[key];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`${key} must be a boolean`);
}

export function oneOf<T extends string>(p: Payload, key: string, allowed: readonly T[]): T {
  const v = str(p, key);
  if (!(allowed as readonly string[]).includes(v)) {
    throw new Error(`${key} must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}

/** Arrays arrive inside the JSON payload, so they need checking too. */
export function optArray(p: Payload, key: string): unknown[] | null {
  const v = p[key];
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw new Error(`${key} must be an array`);
  return v;
}

/** Clamp a caller-supplied page size so a read can never ask for everything. */
export function limit(p: Payload, fallback = 50, max = 200): number {
  const n = optNum(p, "limit");
  if (n === null) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

export function offset(p: Payload): number {
  const n = optNum(p, "offset");
  if (n === null) return 0;
  return Math.max(0, Math.floor(n));
}
