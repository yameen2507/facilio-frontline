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

/** Four types. That is the whole set in P1. */
export type FieldType = "short_text" | "long_text" | "options" | "attachment";

export const FIELD_TYPES: FieldType[] = ["short_text", "long_text", "options", "attachment"];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  options: "Options",
  attachment: "Attachment",
};

/**
 * ⚠ `number` is deliberately absent (decision D-k, still open). With only
 * `short_text`, "approximate total square footage" — the single most
 * load-bearing captured value — reaches the estimator as free text: "~4,500 sq
 * ft", "4500sqft", "about 4.5k". Adding `number` + `unit` is a code change, not
 * a migration: the column is already imported and `field_type` is validated in
 * `domain/`, not by the database.
 */
export const NUMBER_TYPE_IS_PENDING_DECISION = true;

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

  const thinOptions = sections
    .flatMap((s) => s.questions)
    .filter((q) => q.fieldType === "options" && (q.options?.length ?? 0) < 2);

  if (thinOptions.length) {
    blockers.push(`${thinOptions.length} options question(s) need at least two choices`);
  }

  return blockers;
}
