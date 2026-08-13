/**
 * The form-builder data layer.
 *
 * ⚠ EVERY FUNCTION HERE IS A [SEAM]. The `form` platform function does not exist
 * yet. Written against the frozen contract (Survey Backend Plan v1 §7.1) so no
 * page changes when the handlers land, and shipped complete but UNCALLED — see
 * the note in `surveys/api/surveys-util.ts` for why a seam page makes no request.
 *
 * | handler            | args                                          | returns                     |
 * | ------------------ | --------------------------------------------- | --------------------------- |
 * | `template-list`    | search, status, limit, offset                 | `{ templates[], total }`    |
 * | `template-get`     | templateId                                    | template + nested sections  |
 * | `template-create`  | name, description, category                   | new `draft`, version 1      |
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

/** [SEAM] `form.template-list` — with derived section/question/usage counts. */
export const listTemplates = (search: string, status: string) =>
  call<TemplateListResponse>("template-list", {
    limit: LIST_LIMIT,
    ...(status && status !== "all" ? { status } : {}),
    ...(search ? { search } : {}),
  });

/** [SEAM] `form.template-get` — template + sections + nested questions, ONE batched query. */
export const getTemplate = (templateId: string) =>
  call<TemplateDetailResponse>("template-get", { templateId });

/** [SEAM] `form.template-create` — auto-creates a "General" section so no question is an orphan. */
export const createTemplate = (name: string, description: string, category: string) =>
  call<{ template: Template }>("template-create", { name, description, category });

/** [SEAM] `form.template-update` — rejected once published; clone instead. */
export const updateTemplate = (templateId: string, fields: Record<string, string>) =>
  call<{ template: Template }>("template-update", { templateId, ...fields });

/** [SEAM] `form.template-publish` — guards mirror `publishBlockers` in types/template.ts. */
export const publishTemplate = (templateId: string) =>
  call<{ template: Template }>("template-publish", { templateId });

/** [SEAM] `form.template-clone` — the published row is never edited in place. */
export const cloneTemplate = (templateId: string) =>
  call<{ template: Template }>("template-clone", { templateId });

/** [SEAM] `form.template-archive` — in-flight surveys are unaffected; they hold snapshots. */
export const archiveTemplate = (templateId: string) =>
  call<{ template: Template }>("template-archive", { templateId });

// ── Sections and questions ───────────────────────────────────────────────────

/** [SEAM] `form.section-save` — create or update in one handler. */
export const saveSection = (templateId: string, body: Record<string, unknown>, sectionId?: string) =>
  call<{ section: Section }>("section-save", {
    templateId,
    ...(sectionId ? { sectionId } : {}),
    ...payload(body),
  });

/** [SEAM] `form.section-delete` — soft-delete, cascading to its questions. */
export const deleteSection = (sectionId: string) => call<unknown>("section-delete", { sectionId });

/** [SEAM] `form.section-reorder` — one `UPDATE … CASE`, never a JSON array. */
export const reorderSections = (templateId: string, orderedIds: string[]) =>
  call<unknown>("section-reorder", { templateId, ...payload({ orderedIds }) });

/** [SEAM] `form.question-save` — create or update. */
export const saveQuestion = (sectionId: string, body: Record<string, unknown>, questionId?: string) =>
  call<unknown>("question-save", {
    sectionId,
    ...(questionId ? { questionId } : {}),
    ...payload(body),
  });

/** [SEAM] `form.question-delete` — soft-delete. */
export const deleteQuestion = (questionId: string) => call<unknown>("question-delete", { questionId });

/** [SEAM] `form.question-reorder` — as `section-reorder`. */
export const reorderQuestions = (sectionId: string, orderedIds: string[]) =>
  call<unknown>("question-reorder", { sectionId, ...payload({ orderedIds }) });

/** [SEAM] `form.reference` — enums from the server, so no caller hardcodes one. */
export const getReference = () => call<Record<string, string[]>>("reference");
