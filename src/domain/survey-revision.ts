/**
 * Freezing a revision: canonical JSON plus a checksum. Pure — no db, no fetch,
 * no platform imports.
 *
 * WHY NOT A REAL HASH: the function runtime is QuickJS with no `crypto` and no
 * `Buffer`, so SHA-256 is not available. FNV-1a is not cryptographic and this
 * file does not pretend otherwise — it cannot stop someone who edits the
 * payload AND recomputes the checksum. What it does prove is that a frozen
 * payload has not drifted since it was frozen, which is the claim the audit
 * trail actually makes. Stating the weaker true thing beats implying the
 * stronger false one.
 *
 * WHY CANONICAL JSON: `JSON.stringify` preserves insertion order, so the same
 * payload assembled by two different code paths would checksum differently and
 * "the revision reproduces byte-identically" would be false for a reason that
 * has nothing to do with the data. Keys are sorted at every depth; array order
 * is meaningful and is left alone.
 */

/**
 * Deterministic JSON: object keys sorted at every depth, arrays untouched.
 * `undefined` members are dropped exactly as `JSON.stringify` drops them, so
 * a key that is absent and a key that is `undefined` checksum the same.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalise);

  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(src).sort()) {
    if (src[key] === undefined) continue;
    out[key] = canonicalise(src[key]);
  }

  return out;
}

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/**
 * FNV-1a, 32-bit, over UTF-8 bytes, as 8 lowercase hex characters.
 *
 * UTF-8 and not UTF-16 code units, deliberately: this is then the STANDARD
 * algorithm, so the published test vectors hold and anyone downstream — the
 * estimation lane, a customer's auditor, a script in another language — can
 * recompute a frozen revision's checksum and get the same answer. A private
 * variant would have been just as deterministic and independently worthless.
 * The runtime has no TextEncoder, so the encoding is inline; it is nine lines.
 *
 * `Math.imul` is the 32-bit multiply; plain `*` would lose precision above 2^53
 * and silently stop being FNV.
 */
export function fnv1a(input: string): string {
  let hash = FNV_OFFSET;

  const fold = (byte: number) => {
    hash = Math.imul(hash ^ byte, FNV_PRIME);
  };

  for (let i = 0; i < input.length; i++) {
    const cp = input.codePointAt(i) as number;
    if (cp > 0xffff) i++; // a surrogate pair is one code point but two units

    if (cp < 0x80) {
      fold(cp);
    } else if (cp < 0x800) {
      fold(0xc0 | (cp >> 6));
      fold(0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      fold(0xe0 | (cp >> 12));
      fold(0x80 | ((cp >> 6) & 0x3f));
      fold(0x80 | (cp & 0x3f));
    } else {
      fold(0xf0 | (cp >> 18));
      fold(0x80 | ((cp >> 12) & 0x3f));
      fold(0x80 | ((cp >> 6) & 0x3f));
      fold(0x80 | (cp & 0x3f));
    }
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The value written to `fl_survey_revision.checksum`. */
export function checksum(payload: unknown): string {
  return fnv1a(canonicalJson(payload));
}

/** True when a payload still matches the checksum frozen alongside it. */
export function verifyChecksum(payload: unknown, expected: string): boolean {
  return checksum(payload) === expected;
}

export type RevisionTrigger = "submit" | "rework_bounce" | "cancel";

export const REVISION_TRIGGERS: readonly RevisionTrigger[] = [
  "submit",
  "rework_bounce",
  "cancel",
];

export function isRevisionTrigger(value: unknown): value is RevisionTrigger {
  return typeof value === "string" && (REVISION_TRIGGERS as readonly string[]).includes(value);
}
