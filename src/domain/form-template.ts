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

/** Four types. That is the whole set in P1 — `number` awaits decision D-k. */
export type FieldType = "short_text" | "long_text" | "options" | "attachment";

export const FIELD_TYPES: readonly FieldType[] = [
  "short_text",
  "long_text",
  "options",
  "attachment",
];

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
}

export interface PublishSection {
  questions: PublishQuestion[];
}

/**
 * A template is publishable only when all three hold: at least one section,
 * at least one question somewhere, and every `options` question offers a real
 * choice. Returns every blocker at once — a builder that reveals them one
 * save at a time is a worse builder.
 */
export function publishBlockers(sections: PublishSection[]): string[] {
  const blockers: string[] = [];

  if (!sections.length) blockers.push("Add at least one section");
  else if (!sections.some((s) => s.questions.length)) blockers.push("Add at least one question");

  const thinOptions = sections
    .flatMap((s) => s.questions)
    .filter((q) => q.fieldType === "options" && (q.options?.length ?? 0) < 2);

  if (thinOptions.length) {
    blockers.push(`${thinOptions.length} options question(s) need at least two choices`);
  }

  return blockers;
}
