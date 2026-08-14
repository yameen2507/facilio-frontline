/**
 * The form template lifecycle and its publish guard. Pure — no db, no fetch,
 * no platform imports.
 *
 * A template has three states and the moves between them are few enough to be
 * three small validators rather than a transition table:
 *
 *   draft ──publish──▶ published ──archive──▶ archived
 *     │                                          ▲
 *     └────────────────archive───────────────────┘
 *
 * There is deliberately no move OUT of `published` other than `archived`, and
 * none out of `archived` at all: a published template's content is what
 * in-flight surveys snapshot from, so changing it would silently change what
 * `version_no` means. The only way to evolve a published template is `clone` —
 * a NEW draft row with `version_no + 1` — which is an insert, not a
 * transition, so it does not appear here.
 *
 * The publish guard is duplicated in the frontend (`publishBlockers` in
 * features/templates/types/template.ts) so the builder can show blockers
 * before the round trip. THIS copy is the one that decides — keep the two in
 * step by hand, and when they disagree, this one is right.
 */

export type TemplateStatus = "draft" | "published" | "archived";

export const TEMPLATE_STATUSES: readonly TemplateStatus[] = ["draft", "published", "archived"];

/**
 * Five types. `number` closed decision D-k per CLAUDE.md §8 C31: without it,
 * "approximate total square footage" — the most load-bearing value the walk
 * captures — reached the estimator as free text ("~4,500 sq ft", "about 4.5k")
 * and priced as nothing.
 */
export type FieldType = "short_text" | "long_text" | "number" | "options" | "attachment";

export const FIELD_TYPES: readonly FieldType[] = [
  "short_text",
  "long_text",
  "number",
  "options",
  "attachment",
];

/**
 * The unit list is fixed and short on purpose (§8 C31). A free-text unit
 * reintroduces the exact ambiguity `number` exists to remove — "sqft" and "sq
 * ft" and "SF" would all price differently.
 */
export type Unit = "sqft" | "sqm" | "each" | "linear_m" | "hours";

export const UNITS: readonly Unit[] = ["sqft", "sqm", "each", "linear_m", "hours"];

export function isUnit(value: unknown): value is Unit {
  return typeof value === "string" && (UNITS as readonly string[]).includes(value);
}

/**
 * Only these two types may carry an `estimationKey` (§8 C31). A key on free
 * text is what made `total_sqft` unpriceable while looking wired up — the
 * estimator read the key, found prose, and fell through to `unpriced`.
 */
export const ESTIMABLE_TYPES: readonly FieldType[] = ["number", "options"];

export function isEstimable(fieldType: string): boolean {
  return (ESTIMABLE_TYPES as readonly string[]).includes(fieldType);
}

/**
 * F-02, as ruled 14 Aug: the estimation key is DERIVED, not typed. A number
 * question is question text + number + unit, and the key that lets a rate
 * card find the answer is generated from those — which removes naming drift
 * (`total_sqft` vs `sqft_total` vs `TotalSqFt`) without a managed registry
 * (the superseded D-23). Deterministic: the same question text and unit always
 * derive the same key, so re-saving a template never silently re-keys it.
 *
 * The unit is part of the key when present — "total area" in sqft and "total
 * area" in sqm are different priceable facts and must never collide.
 */
export function deriveEstimationKey(label: string, unit?: string | null): string {
  const slug = label
    .toLowerCase()
    // Words that carry no pricing meaning, dropped so keys stay short and two
    // phrasings of one question ("what is the total area", "total area?")
    // land on the same key.
    .replace(/\b(what|is|the|are|of|a|an|in|for|to|how|many|much|please|their|there)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .split("_")
    .slice(0, 5)
    .join("_");

  const u = (unit ?? "").trim().toLowerCase();
  if (!slug) return u ? `question_${u}` : "question";
  return u && !slug.includes(u) ? `${slug}_${u}` : slug;
}

export type LevelBinding = "per_survey" | "per_building" | "per_space";

export const LEVEL_BINDINGS: readonly LevelBinding[] = ["per_survey", "per_building", "per_space"];

/** What a repeatable section may create in the prospect portfolio (D-p superset). */
export const NODE_TYPES = ["space", "building"] as const;

export function isTemplateStatus(value: unknown): value is TemplateStatus {
  return typeof value === "string" && (TEMPLATE_STATUSES as readonly string[]).includes(value);
}

/**
 * Why this template's content cannot be edited, or null when it can. Applies
 * to the template's own fields AND to its sections and questions — they are
 * the content `version_no` names.
 */
export function editBlocker(status: TemplateStatus): string | null {
  if (status === "published") {
    return "a published template is never edited — clone it to make a new draft version";
  }
  if (status === "archived") return "an archived template cannot be edited";
  return null;
}

/** Why this template cannot be published, ignoring content — see publishBlockers. */
export function publishStatusBlocker(status: TemplateStatus): string | null {
  if (status === "published") return "already published";
  if (status === "archived") return "an archived template cannot be published — clone it instead";
  return null;
}

/** Why this template cannot be archived, or null. Draft and published both can. */
export function archiveBlocker(status: TemplateStatus): string | null {
  return status === "archived" ? "already archived" : null;
}

/** The shape the guard needs — callers pass only ACTIVE sections and questions. */
export interface PublishQuestion {
  fieldType: string;
  options: unknown[] | null;
  /** Required on `number`, meaningless elsewhere. */
  unit?: string | null;
  /** Allowed only on an estimable type — see `ESTIMABLE_TYPES`. */
  estimationKey?: string | null;
}

export interface PublishSection {
  questions: PublishQuestion[];
}

/**
 * A template is publishable only when all of these hold: at least one section,
 * at least one question somewhere, every `options` question offers a real
 * choice, every `number` question names its unit, and no estimation key sits on
 * a type that cannot carry one. Returns every blocker at once — a builder that
 * reveals them one save at a time is a worse builder.
 *
 * The last two are publish blockers rather than save errors on purpose. A draft
 * written before `number` existed can hold an estimation key on `short_text`
 * (the `F-02` shape); throwing on save would strand it with no way forward,
 * whereas a blocker names the problem and still lets the author fix it.
 */
export function publishBlockers(sections: PublishSection[]): string[] {
  const blockers: string[] = [];

  if (!sections.length) blockers.push("Add at least one section");
  else if (!sections.some((s) => s.questions.length)) blockers.push("Add at least one question");

  const questions = sections.flatMap((s) => s.questions);

  const thinOptions = questions.filter(
    (q) => q.fieldType === "options" && (q.options?.length ?? 0) < 2
  );
  if (thinOptions.length) {
    blockers.push(`${thinOptions.length} options question(s) need at least two choices`);
  }

  const unitless = questions.filter((q) => q.fieldType === "number" && !isUnit(q.unit));
  if (unitless.length) {
    blockers.push(`${unitless.length} number question(s) need a unit`);
  }

  const misplacedKeys = questions.filter(
    (q) => (q.estimationKey ?? "").trim() !== "" && !isEstimable(q.fieldType)
  );
  if (misplacedKeys.length) {
    blockers.push(
      `${misplacedKeys.length} question(s) carry an estimation key on a type that cannot be priced — move it to Number or Options`
    );
  }

  return blockers;
}
