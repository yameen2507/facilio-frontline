/**
 * Form template types.
 *
 * Deliberately NOT named `survey_*`: this is a generic section-and-question form
 * builder that the survey module merely consumes, so mobilization checklists,
 * vendor onboarding and QA forms can reuse it rather than each growing their own.
 *
 * Booleans are STRINGS here too — `"true"` / `"false"` — because the app database
 * has no boolean column. `if (s.isRepeatable)` is true for `"false"`.
 */

/**
 * Five types. Mirrors `src/domain/form-template.ts` — that copy decides, this
 * one exists so the builder can show blockers before the round trip. Keep them
 * in step by hand.
 */
export type FieldType = "short_text" | "long_text" | "number" | "options" | "attachment";

export const FIELD_TYPES: FieldType[] = [
  "short_text",
  "long_text",
  "number",
  "options",
  "attachment",
];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  number: "Number",
  options: "Options",
  attachment: "Attachment",
};

/** Fixed list, so `sqft` and `sq ft` can never both exist (§8 C31). */
export type Unit = "sqft" | "sqm" | "each" | "linear_m" | "hours";

export const UNITS: Unit[] = ["sqft", "sqm", "each", "linear_m", "hours"];

export const UNIT_LABEL: Record<Unit, string> = {
  sqft: "sq ft",
  sqm: "sq m",
  each: "each",
  linear_m: "linear m",
  hours: "hours",
};

/**
 * Only these two can carry an estimation key. A key on free text is what made
 * `total_sqft` look wired up while pricing as nothing.
 */
export const ESTIMABLE_TYPES: FieldType[] = ["number", "options"];

export const isEstimable = (fieldType: FieldType) => ESTIMABLE_TYPES.includes(fieldType);

export type TemplateStatus = "draft" | "published" | "archived";

export type LevelBinding = "per_survey" | "per_building" | "per_space";

export type Question = {
  id: string;
  sectionId: string;
  label: string;
  helpText?: string | null;
  fieldType: FieldType;
  options?: string[] | null;
  /** On `options` this means multiselect; on `attachment`, multiple files. */
  allowMultiple?: string | null;
  sequenceNo: number;
  isRequired?: string | null;
  /** The stable key the estimator reads, so pricing never depends on wording. */
  estimationKey?: string | null;
  feedsEstimation?: string | null;
  unit?: string | null;
};

export type Section = {
  id: string;
  templateId: string;
  name: string;
  description?: string | null;
  sequenceNo: number;
  levelBinding?: LevelBinding | null;
  /** The snagging pattern: "+ Add another Room" on the walk. */
  isRepeatable?: string | null;
  repeatLabel?: string | null;
  minRepeats?: number | null;
  maxRepeats?: number | null;
  /** When on, each repeat also creates a space in the prospect portfolio. */
  createsPortfolioNode?: string | null;
  questions: Question[];
};

export type Template = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  status: TemplateStatus;
  versionNo: number;
  parentTemplateId?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Derived, never stored — a count column would go stale. */
  sectionCount?: number;
  questionCount?: number;
  usageCount?: number;
};

export type TemplateListResponse = {
  templates: Template[];
  total: number;
  truncated?: boolean;
};

export type TemplateDetailResponse = {
  template: Template;
  sections: Section[];
};

/** A template is publishable only when all three hold. */
export function publishBlockers(sections: Section[]): string[] {
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

  const unitless = questions.filter(
    (q) => q.fieldType === "number" && !UNITS.includes((q.unit ?? "") as Unit)
  );
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
