/**
 * Reading an agent's reply into the lines a panel shows.
 *
 * Split out of AssessmentPanel.tsx for the same reason `shared/row-map.ts` was
 * split out of `shared/db.ts`: the panel imports shadcn components through the
 * `@/` alias, which the test runner cannot resolve, so anything importing it is
 * untestable here. This file imports nothing.
 *
 * FIVE OF THE SIX AGENTS RETURN FLAT STRINGS. `lead-intelligence` does not —
 * twelve of its seventeen fields are objects or arrays of objects (`serviceFit`
 * is a list of classifications, `urgency` is a level with its basis, `redFlags`
 * is a list of flag/reason/severity). Running `String()` over those printed
 * "[object Object]" on a real lead, which is how this was found. Everything
 * goes through one reader now rather than being rendered where it is found.
 */

/** Values that mean "checked, nothing to report" — folded, never dropped. */
export const CLEAR =
  /^(none|n\/?a|not applicable|no tender - n\/a|consistent|nothing|no issues|not specified|unknown|insufficient data|no survey supplied)\b/i;

/**
 * Fields that are plumbing rather than findings. The `*Provided` flags say
 * which blocks the brief carried, which is worth showing — but as one line at
 * the bottom, not as five findings.
 */
export const SOURCE_FLAGS = /Provided$/;

/** `preSendReadinessReason` -> `Pre send readiness reason`. */
export const humanise = (key: string): string => {
  const spaced = key.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
};

/**
 * Any field value, as the lines to show for it.
 *
 * An empty array or object comes back as "None" rather than nothing, so a check
 * the agent RAN and found clean stays distinguishable from one it skipped —
 * that distinction is the whole point of the panel's fold.
 */
export function toLines(value: unknown): string[] {
  if (value === null || value === undefined) return [];

  if (typeof value === "string") {
    // Semicolon-separated is the flat agents' house format for a list.
    return value
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean);
  }

  if (typeof value === "number" || typeof value === "boolean") return [String(value)];

  if (Array.isArray(value)) {
    if (!value.length) return ["None"];
    return value
      .map((item) => (typeof item === "object" && item ? pairs(item) : String(item)))
      .filter(Boolean);
  }

  if (typeof value === "object") {
    const line = pairs(value);
    return line ? [line] : ["None"];
  }

  return [];
}

/** One object as `Label: value · Label: value`, dropping anything empty. */
export function pairs(obj: object): string {
  return Object.entries(obj)
    .map(([k, v]) => {
      const inner = Array.isArray(v) ? v.filter(Boolean).join(", ") : v == null ? "" : String(v);
      return inner.trim() ? `${humanise(k)}: ${inner.trim()}` : "";
    })
    .filter(Boolean)
    .join(" · ");
}

/** Strictly later, and false whenever either side cannot be read as a date. */
export function isAfter(
  later: string | null | undefined,
  earlier: string | null | undefined
): boolean {
  if (!later || !earlier) return false;
  const a = Date.parse(later);
  const b = Date.parse(earlier);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}
