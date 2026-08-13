/**
 * The form builder's API — function `form`, its own platform function because
 * builds are per-function and the survey module merely consumes what this one
 * produces (ARCHITECTURE.md §9 rule 4). Thin adapters only — read the input,
 * call a module, return `{ ok, data?, error? }`. All logic lives in
 * src/modules/form.ts and src/domain/form-template.ts.
 *
 * The handler set is the frozen contract of Survey Backend Plan v1 §7.1 — the
 * frontend's templates-util.ts was written against it before this file existed,
 * so a name or shape change here breaks a page that has never called it.
 *
 * There is deliberately no `template-preview` handler: preview is
 * `template-get` rendered by the same components as the capture screen. A
 * preview drawn by different code is evidence of nothing.
 */

import StudioFunctions from "@facilio/studio-functions";
import {
  FIELD_TYPES,
  LEVEL_BINDINGS,
  NODE_TYPES,
  TEMPLATE_STATUSES,
} from "../../domain/form-template";
import {
  handle,
  limit as readLimit,
  offset as readOffset,
  optArray,
  optBool,
  optNum,
  optStr,
  parsePayload,
  str,
} from "../../shared/envelope";
import {
  archiveTemplate,
  cloneTemplate,
  createTemplate,
  deleteQuestion,
  deleteSection,
  listTemplates,
  publishTemplate,
  reorderQuestions,
  reorderSections,
  saveQuestion,
  saveSection,
  templateDetail,
  updateTemplate,
  type QuestionInput,
  type SectionInput,
} from "../../modules/form";

const S = (description: string) => ({ description, type: "string" as const });
const N = (description: string) => ({ description, type: "number" as const });

/** Every handler accepts the envelope as an alternative to flat fields. */
const ENV = { payload: S("Optional: the whole input as a JSON object string") };

const TEMPLATE_ID = S("Template id (uuid)");
const SECTION_ID = S("Section id (uuid)");
const QUESTION_ID = S("Question id (uuid)");
const ACTOR = S("Email of the user performing this action");

const server = new StudioFunctions({ name: "form" });

/** Ordered ids for a reorder — arrays only travel inside the payload envelope. */
function orderedIds(p: Record<string, unknown>): string[] {
  const ids = optArray(p, "orderedIds");
  if (!ids) throw new Error("orderedIds is required (inside payload)");
  return ids.map((id) => String(id));
}

// --- templates ----------------------------------------------------------------

server.addHandler({
  name: "template-list",
  description:
    "List form templates with derived section, question and usage counts. Usage counts surveys that ran on the template.",
  parameters: {
    ...ENV,
    search: S("Substring match on name, description or category"),
    status: S(`Filter by status: ${TEMPLATE_STATUSES.join(", ")}`),
    limit: N("Page size, default 50, max 200"),
    offset: N("Page offset"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return listTemplates({
        search: optStr(p, "search"),
        status: optStr(p, "status"),
        limit: readLimit(p),
        offset: readOffset(p),
      });
    }),
});

server.addHandler({
  name: "template-get",
  description:
    "One template with its sections and nested questions — one batched query. Also the preview: the walk renders exactly this.",
  parameters: { ...ENV, templateId: TEMPLATE_ID },
  execute: async (args) => handle(() => templateDetail(str(parsePayload(args), "templateId"))),
});

server.addHandler({
  name: "template-create",
  description: "New draft template, version 1, with a starter 'General' section",
  parameters: {
    ...ENV,
    name: S("Template name — required"),
    description: S("What the template is for"),
    category: S("Free-text grouping, defaults to General"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return createTemplate({
        name: str(p, "name"),
        description: optStr(p, "description"),
        category: optStr(p, "category"),
        actor: optStr(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "template-update",
  description: "Edit name, description or category. Blocked once published — clone instead.",
  parameters: {
    ...ENV,
    templateId: TEMPLATE_ID,
    name: S("Template name"),
    description: S("What the template is for"),
    category: S("Free-text grouping"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const fields: { name?: string; description?: string | null; category?: string | null } = {};
      const name = optStr(p, "name");
      if (name) fields.name = name;
      // `in` rather than optStr so the payload envelope can CLEAR a field with
      // "" — a connection action's blank flat fields are dropped upstream.
      if ("description" in p) fields.description = optStr(p, "description");
      if ("category" in p) fields.category = optStr(p, "category");
      return updateTemplate(str(p, "templateId"), fields, optStr(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "template-publish",
  description:
    "Draft → published. Guards: at least one section, at least one question, every options question offers two or more choices.",
  parameters: { ...ENV, templateId: TEMPLATE_ID, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return publishTemplate(str(p, "templateId"), optStr(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "template-clone",
  description:
    "Copy a template into a new draft with version + 1 and parent_template_id set. The published row is never edited in place.",
  parameters: { ...ENV, templateId: TEMPLATE_ID, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return cloneTemplate(str(p, "templateId"), optStr(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "template-archive",
  description: "Remove a template from the picker. In-flight surveys are unaffected — they hold snapshots.",
  parameters: { ...ENV, templateId: TEMPLATE_ID, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return archiveTemplate(str(p, "templateId"), optStr(p, "actorEmail"));
    }),
});

// --- sections -------------------------------------------------------------------

/** The section fields shared by create and update, read once. */
function sectionInput(p: Record<string, unknown>): SectionInput {
  const input: SectionInput = {};
  const name = optStr(p, "name");
  if (name) input.name = name;
  if ("description" in p) input.description = optStr(p, "description");
  const levelBinding = optStr(p, "levelBinding");
  if (levelBinding) input.levelBinding = levelBinding;
  const isRepeatable = optBool(p, "isRepeatable");
  if (isRepeatable !== null) input.isRepeatable = isRepeatable;
  if ("repeatLabel" in p) input.repeatLabel = optStr(p, "repeatLabel");
  if ("minRepeats" in p) input.minRepeats = optNum(p, "minRepeats");
  if ("maxRepeats" in p) input.maxRepeats = optNum(p, "maxRepeats");
  const createsNode = optBool(p, "createsPortfolioNode");
  if (createsNode !== null) input.createsPortfolioNode = createsNode;
  const nodeType = optStr(p, "nodeTypeCreated");
  if (nodeType) input.nodeTypeCreated = nodeType;
  const serviceIds = optArray(p, "applicabilityServiceIds");
  if (serviceIds) input.applicabilityServiceIds = serviceIds.map((id) => String(id));
  return input;
}

server.addHandler({
  name: "section-save",
  description:
    "Create a section (no sectionId) or update one (with sectionId) on a draft template. Repeatable sections drive the '+ Add another' walk pattern.",
  parameters: {
    ...ENV,
    templateId: TEMPLATE_ID,
    sectionId: S("Section id — omit to create"),
    name: S("Section name — required on create"),
    description: S("What the section covers"),
    levelBinding: S(`Where it applies: ${LEVEL_BINDINGS.join(", ")}`),
    isRepeatable: S("true when the walk may add entries, e.g. one per room"),
    repeatLabel: S("The noun for one entry, e.g. Room"),
    minRepeats: N("Minimum entries, when repeatable"),
    maxRepeats: N("Maximum entries, when repeatable"),
    createsPortfolioNode: S("true when each entry also creates a prospect node"),
    nodeTypeCreated: S(`Node type created per entry: ${NODE_TYPES.join(", ")}`),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return saveSection(
        str(p, "templateId"),
        optStr(p, "sectionId"),
        sectionInput(p),
        optStr(p, "actorEmail")
      );
    }),
});

server.addHandler({
  name: "section-delete",
  description: "Soft-delete a section, cascading to its questions",
  parameters: { ...ENV, sectionId: SECTION_ID, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return deleteSection(str(p, "sectionId"), optStr(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "section-reorder",
  description:
    "Rewrite section order in one UPDATE … CASE. Pass orderedIds inside payload — never an array in a JSON blob column.",
  parameters: { ...ENV, templateId: TEMPLATE_ID },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return reorderSections(str(p, "templateId"), orderedIds(p));
    }),
});

// --- questions ------------------------------------------------------------------

/** The question fields shared by create and update, read once. */
function questionInput(p: Record<string, unknown>): QuestionInput {
  const input: QuestionInput = {};
  const label = optStr(p, "label");
  if (label) input.label = label;
  if ("helpText" in p) input.helpText = optStr(p, "helpText");
  const fieldType = optStr(p, "fieldType");
  if (fieldType) input.fieldType = fieldType;
  const options = optArray(p, "options");
  if (options) input.options = options.map((o) => String(o));
  const allowMultiple = optBool(p, "allowMultiple");
  if (allowMultiple !== null) input.allowMultiple = allowMultiple;
  const isRequired = optBool(p, "isRequired");
  if (isRequired !== null) input.isRequired = isRequired;
  const feedsEstimation = optBool(p, "feedsEstimation");
  if (feedsEstimation !== null) input.feedsEstimation = feedsEstimation;
  if ("estimationKey" in p) input.estimationKey = optStr(p, "estimationKey");
  if ("unit" in p) input.unit = optStr(p, "unit");
  return input;
}

server.addHandler({
  name: "question-save",
  description:
    "Create a question (no questionId) or update one (with questionId) in a section of a draft template. Options travel inside payload.",
  parameters: {
    ...ENV,
    sectionId: SECTION_ID,
    questionId: S("Question id — omit to create"),
    label: S("The question as the surveyor reads it — required on create"),
    helpText: S("Guidance shown under the label"),
    fieldType: S(`One of: ${FIELD_TYPES.join(", ")}`),
    allowMultiple: S("true for multiselect options or multiple attachments"),
    isRequired: S("true when the walk cannot submit without an answer"),
    feedsEstimation: S("true when the answer feeds pricing"),
    estimationKey: S("Stable key the estimator reads, e.g. total_sqft"),
    unit: S("Unit hint, e.g. sqft — reserved for the number type (D-k)"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return saveQuestion(
        str(p, "sectionId"),
        optStr(p, "questionId"),
        questionInput(p),
        optStr(p, "actorEmail")
      );
    }),
});

server.addHandler({
  name: "question-delete",
  description: "Soft-delete a question",
  parameters: { ...ENV, questionId: QUESTION_ID, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return deleteQuestion(str(p, "questionId"), optStr(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "question-reorder",
  description: "Rewrite question order within a section in one UPDATE … CASE. Pass orderedIds inside payload.",
  parameters: { ...ENV, sectionId: SECTION_ID },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return reorderQuestions(str(p, "sectionId"), orderedIds(p));
    }),
});

// --- reference ------------------------------------------------------------------

server.addHandler({
  name: "reference",
  description: "Allowed enum values, so callers never hardcode them",
  parameters: {},
  execute: async () =>
    handle(() => ({
      fieldTypes: FIELD_TYPES,
      levelBindings: LEVEL_BINDINGS,
      nodeTypes: NODE_TYPES,
      templateStatuses: TEMPLATE_STATUSES,
    })),
});

server.execute();
