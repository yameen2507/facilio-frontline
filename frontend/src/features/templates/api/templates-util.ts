/**
 * The form-builder data layer. The `form` platform function is LIVE — built
 * 2026-08-13 to the frozen contract (Survey Backend Plan v1 §7.1) these
 * wrappers were written against, plus one addition: `template-import`.
 *
 * | handler            | args                                          | returns                     |
 * | ------------------ | --------------------------------------------- | --------------------------- |
 * | `template-list`    | search, status, limit, offset                 | `{ templates[], total }`    |
 * | `template-get`     | templateId                                    | template + nested sections  |
 * | `template-create`  | name, description, category                   | new `draft`, version 1      |
 * | `template-import`  | name, publish, payload:{sections[]}           | whole tree, ONE round trip  |
 * | `template-update`  | templateId, name, description, category       | blocked once published      |
 * | `template-publish` | templateId                                    | `{ template }`              |
 * | `template-clone`   | templateId                                    | new draft, version + 1      |
 * | `template-archive` | templateId                                    | `{ template }`              |
 * | `section-save`     | templateId, sectionId?, payload:{...}         | `{ section }`               |
 * | `section-delete`   | sectionId                                     | soft-delete + cascade       |
 * | `section-reorder`  | templateId, payload:{orderedIds[]}            | one UPDATE … CASE           |
 * | `question-save`    | sectionId, questionId?, payload:{...}         | `{ question }`              |
 * | `question-delete`  | questionId                                    | soft-delete                 |
 * | `question-reorder` | sectionId, payload:{orderedIds[]}             | as section-reorder          |
 * | `reference`        | —                                             | field types, level bindings |
 *
 * The builder saves through `template-import`, never through the per-row
 * calls: it drafts locally and hands the whole tree over at once, because a
 * handler round trip costs ~1.1s of fixed overhead and a 30-question template
 * saved row-by-row is the adoption-risk math of Backend Plan §6.2 at the desk.
 * The per-row calls exist for the edit-an-existing-draft surface to come.
 *
 * Reorder is ALWAYS a `sequence_no` rewrite, never an array in a JSON blob — an
 * array reorder loses a concurrent edit silently.
 *
 * There is no `template-preview` handler and there should not be: preview is
 * `template-get` rendered by the same components as the capture screen. A
 * preview drawn by different code is evidence of nothing.
 */

import { requestFrom, type Result } from "../../../lib/request";
import type { Section, Template, TemplateDetailResponse, TemplateListResponse } from "../types/template";

/** Its own platform function, separate from `survey` — builds are per-function. */
const FN = "form";

export const LIST_LIMIT = 100;

const call = <T>(handler: string, args: Record<string, unknown> = {}): Promise<Result<T>> =>
  requestFrom<T>(FN, handler, args);

const payload = (body: Record<string, unknown>) => ({ payload: JSON.stringify(body) });

// ── Template ─────────────────────────────────────────────────────────────────

/** `form.template-list` — with derived section/question/usage counts. */
export const listTemplates = (search: string, status: string) =>
  call<TemplateListResponse>("template-list", {
    limit: LIST_LIMIT,
    ...(status && status !== "all" ? { status } : {}),
    ...(search ? { search } : {}),
  });

/** `form.template-get` — template + sections + nested questions, ONE batched query. */
export const getTemplate = (templateId: string) =>
  call<TemplateDetailResponse>("template-get", { templateId });

/** `form.template-create` — auto-creates a "General" section so no question is an orphan. */
export const createTemplate = (name: string, description: string, category: string) =>
  call<{ template: Template }>("template-create", { name, description, category });

/** What `template-import` carries per question — camelCase mirror of the handler. */
export interface ImportQuestionBody {
  label: string;
  helpText?: string;
  fieldType: string;
  options?: string[];
  allowMultiple?: boolean;
  isRequired?: boolean;
  feedsEstimation?: boolean;
  estimationKey?: string;
  unit?: string;
}

export interface ImportSectionBody {
  name: string;
  description?: string;
  levelBinding?: string;
  isRepeatable?: boolean;
  repeatLabel?: string;
  minRepeats?: number;
  maxRepeats?: number;
  createsPortfolioNode?: boolean;
  nodeTypeCreated?: string;
  questions: ImportQuestionBody[];
}

/**
 * `form.template-import` — the whole builder tree in ONE round trip, optionally
 * publishing. With `templateId` it REPLACES that draft's content in place;
 * without, it creates. A failed publish guard does not throw: the tree is
 * saved as a draft and the blockers come back in `publishBlockers`.
 */
export const importTemplate = (
  body: {
    templateId?: string;
    name: string;
    description?: string;
    category?: string;
    publish: boolean;
    sections: ImportSectionBody[];
  },
  actorEmail: string
) =>
  call<{ template: Template; published: boolean; publishBlockers: string[] }>("template-import", {
    ...(actorEmail ? { actorEmail } : {}),
    ...payload(body),
  });

/** `form.template-update` — rejected once published; clone instead. */
export const updateTemplate = (templateId: string, fields: Record<string, string>) =>
  call<{ template: Template }>("template-update", { templateId, ...fields });

/** `form.template-publish` — guards mirror `publishBlockers` in types/template.ts. */
export const publishTemplate = (templateId: string) =>
  call<{ template: Template }>("template-publish", { templateId });

/** `form.template-clone` — the published row is never edited in place. */
export const cloneTemplate = (templateId: string) =>
  call<{ template: Template }>("template-clone", { templateId });

/** `form.template-archive` — in-flight surveys are unaffected; they hold snapshots. */
export const archiveTemplate = (templateId: string) =>
  call<{ template: Template }>("template-archive", { templateId });

// ── Sections and questions ───────────────────────────────────────────────────

/** `form.section-save` — create or update in one handler. */
export const saveSection = (templateId: string, body: Record<string, unknown>, sectionId?: string) =>
  call<{ section: Section }>("section-save", {
    templateId,
    ...(sectionId ? { sectionId } : {}),
    ...payload(body),
  });

/** `form.section-delete` — soft-delete, cascading to its questions. */
export const deleteSection = (sectionId: string) => call<unknown>("section-delete", { sectionId });

/** `form.section-reorder` — one `UPDATE … CASE`, never a JSON array. */
export const reorderSections = (templateId: string, orderedIds: string[]) =>
  call<unknown>("section-reorder", { templateId, ...payload({ orderedIds }) });

/** `form.question-save` — create or update. */
export const saveQuestion = (sectionId: string, body: Record<string, unknown>, questionId?: string) =>
  call<unknown>("question-save", {
    sectionId,
    ...(questionId ? { questionId } : {}),
    ...payload(body),
  });

/** `form.question-delete` — soft-delete. */
export const deleteQuestion = (questionId: string) => call<unknown>("question-delete", { questionId });

/** `form.question-reorder` — as `section-reorder`. */
export const reorderQuestions = (sectionId: string, orderedIds: string[]) =>
  call<unknown>("question-reorder", { sectionId, ...payload({ orderedIds }) });

/** `form.reference` — enums from the server, so no caller hardcodes one. */
export const getReference = () => call<Record<string, string[]>>("reference");
