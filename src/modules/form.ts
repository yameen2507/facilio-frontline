/**
 * The form builder — templates, their sections, their questions.
 *
 * Deliberately not named `survey_*` anywhere: v1.7 §B1 is a generic builder the
 * survey module merely consumes, so mobilization checklists, vendor onboarding
 * and QA forms can reuse it rather than each growing their own.
 *
 * Two invariants every write here protects:
 *
 *  1. A published template's content is FROZEN. Surveys snapshot from it and
 *     `version_no` names exactly that content, so sections and questions are
 *     as immutable as the template row once status leaves `draft`. Evolution
 *     is `clone` — a new draft with `version_no + 1` — never an edit.
 *  2. Reorder is a `sequence_no` rewrite in ONE statement, never an ordered
 *     array in a JSON blob — an array reorder loses a concurrent edit silently.
 *
 * Booleans are the strings 'true'/'false' (the schema has no boolean type), so
 * every filter says `is_active = 'true'` — a bare `is_active` clause would
 * return soft-deleted rows and nothing would error.
 */

import {
  archiveBlocker,
  deriveEstimationKey,
  editBlocker,
  FIELD_TYPES,
  isEstimable,
  isTemplateStatus,
  LEVEL_BINDINGS,
  NODE_TYPES,
  publishBlockers,
  publishStatusBlocker,
  TEMPLATE_STATUSES,
  UNITS,
  type FieldType,
  type LevelBinding,
  type TemplateStatus,
} from "../domain/form-template";
import { count, many, manyWithTruncation, mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";

export interface FormQuestion {
  id: string;
  sectionId: string;
  templateId: string;
  label: string;
  helpText: string | null;
  fieldType: FieldType;
  options: string[] | null;
  /** On `options` this means multiselect; on `attachment`, multiple files. */
  allowMultiple: string | null;
  sequenceNo: number;
  isRequired: string | null;
  feedsEstimation: string | null;
  /** The stable key the estimator reads, so pricing never depends on wording. */
  estimationKey: string | null;
  unit: string | null;
  createdAt: string;
}

export interface FormSection {
  id: string;
  templateId: string;
  name: string;
  description: string | null;
  sequenceNo: number;
  levelBinding: LevelBinding | null;
  applicabilityServiceIds: string[] | null;
  isRepeatable: string | null;
  repeatLabel: string | null;
  minRepeats: number | null;
  maxRepeats: number | null;
  createsPortfolioNode: string | null;
  nodeTypeCreated: string | null;
  createdAt: string;
  questions: FormQuestion[];
}

export interface FormTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  status: TemplateStatus;
  versionNo: number;
  parentTemplateId: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  archivedBy: string | null;
  archivedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Derived at read time, never stored — a count column would go stale. */
  sectionCount?: number;
  questionCount?: number;
  usageCount?: number;
}

const TEMPLATE_COLUMNS = `id, name, description, category, status, version_no,
  parent_template_id, published_by, published_at, archived_by, archived_at,
  created_by, created_at, updated_at`;

const SECTION_COLUMNS = `id, template_id, name, description, sequence_no, level_binding,
  applicability_service_ids_json, is_repeatable, repeat_label, min_repeats, max_repeats,
  creates_portfolio_node, node_type_created, created_at`;

const QUESTION_COLUMNS = `id, section_id, template_id, label, help_text, field_type,
  options_json, allow_multiple, sequence_no, is_required, feeds_estimation,
  estimation_key, unit, created_at`;

const inSet = (value: string, allowed: readonly string[], field: string): string => {
  if (!allowed.includes(value)) throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  return value;
};

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface TemplateListFilters {
  search?: string | null;
  status?: string | null;
  limit: number;
  offset: number;
}

/** Counts arrive as strings on the wire and are not in row-map's numeric list. */
type RawTemplateListRow = Omit<FormTemplate, "sectionCount" | "questionCount" | "usageCount"> & {
  sectionCount: unknown;
  questionCount: unknown;
  usageCount: unknown;
  totalCount: unknown;
};

/**
 * A page of templates with the counts a picker needs: how big each template is
 * and how many surveys ran on it. Per-row counts are scalar subqueries and the
 * unpaged total rides along as `count(*) over ()`, so the whole read is one
 * query rather than one per row plus a separate count.
 */
export function listTemplates(filters: TemplateListFilters): {
  templates: FormTemplate[];
  total: number;
  truncated: boolean;
} {
  const where: string[] = ["t.is_active = 'true'"];
  const params: unknown[] = [];

  if (filters.status) {
    if (!isTemplateStatus(filters.status)) {
      throw new Error(`status must be one of: ${TEMPLATE_STATUSES.join(", ")}`);
    }
    params.push(filters.status);
    where.push(`t.status = $${params.length}`);
  }

  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    where.push(
      `(lower(t.name) like $${params.length}
        or lower(coalesce(t.description,'')) like $${params.length}
        or lower(coalesce(t.category,'')) like $${params.length})`
    );
  }

  const clause = `where ${where.join(" and ")}`;

  const { rows, truncated } = manyWithTruncation<RawTemplateListRow>(
    `select t.id, t.name, t.description, t.category, t.status, t.version_no,
            t.parent_template_id, t.published_by, t.published_at, t.created_at, t.updated_at,
            (select count(*) from fl_form_section s
              where s.template_id = t.id and s.is_active = 'true') as section_count,
            (select count(*) from fl_form_question q
              where q.template_id = t.id and q.is_active = 'true') as question_count,
            (select count(*) from fl_survey v
              where v.template_id = t.id and v.is_active = 'true') as usage_count,
            count(*) over () as total_count
       from fl_form_template t
       ${clause}
      order by t.updated_at desc
      limit ${filters.limit} offset ${filters.offset}`,
    params
  );

  const templates: FormTemplate[] = rows.map(({ totalCount: _total, ...row }) => ({
    ...row,
    sectionCount: Number(row.sectionCount ?? 0),
    questionCount: Number(row.questionCount ?? 0),
    usageCount: Number(row.usageCount ?? 0),
  }));

  // The window total rides on every row; past the end it disappears, and that
  // is the only case worth a second query — a pager saying "0 results" on
  // page 3 would be a lie.
  const total = rows.length
    ? Number(rows[0].totalCount ?? 0)
    : filters.offset > 0
      ? count(`select count(*) as c from fl_form_template t ${clause}`, params)
      : 0;

  return { templates, total, truncated };
}

export interface TemplateDetail {
  template: FormTemplate;
  sections: FormSection[];
}

/**
 * Template, sections and nested questions in ONE statement — this is also what
 * the builder's preview renders, which is why there is no `template-preview`
 * handler. Three separate reads would cost three times ~194ms of fixed bridge
 * overhead (see shared/db.ts); batched as `_obj` / `_arr` subqueries they cost
 * one, and row-map.ts unpacks them back into nested camelCase.
 */
export function templateDetail(id: string): TemplateDetail {
  const row = one<{ template: FormTemplate | null; sections: FormSection[] }>(
    `select
       (select row_to_json(x) from (
          select ${TEMPLATE_COLUMNS} from fl_form_template
           where id = $1 and is_active = 'true'
        ) x) as template_obj,

       (select coalesce(json_agg(x order by x.sequence_no, x.created_at), '[]'::json) from (
          select ${SECTION_COLUMNS},
                 (select coalesce(json_agg(q order by q.sequence_no, q.created_at), '[]'::json) from (
                    select ${QUESTION_COLUMNS} from fl_form_question
                     where section_id = s.id and is_active = 'true'
                  ) q) as questions
            from fl_form_section s
           where s.template_id = $1 and s.is_active = 'true'
        ) x) as sections_arr`,
    [id]
  );

  const template = row?.template;
  if (!template) throw new Error(`template ${id} not found`);

  return { template, sections: row.sections };
}

// ── Template writes ───────────────────────────────────────────────────────────

/** The row every content write starts from. Throws when missing or frozen. */
function editableTemplate(templateId: string): FormTemplate {
  const template = one<FormTemplate>(
    `select ${TEMPLATE_COLUMNS} from fl_form_template
      where id = $1 and is_active = 'true' limit 1`,
    [templateId]
  );
  if (!template) throw new Error(`template ${templateId} not found`);

  const blocked = editBlocker(template.status);
  if (blocked) throw new Error(blocked);

  return template;
}

export function createTemplate(input: {
  name: string;
  description: string | null;
  category: string | null;
  actor: string | null;
}): { template: FormTemplate } {
  const now = nowIso();
  const category = input.category ?? "General";

  const row = one<{ id: string }>(
    `insert into fl_form_template
       (id, name, description, category, status, version_no, parent_template_id,
        created_by, updated_by, is_active, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, 'draft', 1, null, $4, $4, 'true', '{}', $5, $5)
     returning id`,
    [input.name, input.description, category, input.actor, now]
  );
  if (!row) throw new Error("template insert returned no row");

  // Every question needs a section to live in, so a new template starts with
  // one — the builder renames it rather than starting from a hole.
  mutate(
    `insert into fl_form_section
       (id, template_id, name, description, sequence_no, level_binding,
        applicability_service_ids_json, is_repeatable, repeat_label, min_repeats, max_repeats,
        creates_portfolio_node, node_type_created, created_by, updated_by, is_active,
        data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, 'General', null, 1, 'per_survey',
             '[]', 'false', null, null, null, 'false', 'space', $2, $2, 'true', '{}', $3, $3)`,
    [row.id, input.actor, now]
  );

  appendEvent({
    entityType: "form_template",
    entityId: row.id,
    kind: "created",
    actor: input.actor,
    body: input.name,
  });

  return {
    template: {
      id: row.id,
      name: input.name,
      description: input.description,
      category,
      status: "draft",
      versionNo: 1,
      parentTemplateId: null,
      publishedBy: null,
      publishedAt: null,
      archivedBy: null,
      archivedAt: null,
      createdBy: input.actor,
      createdAt: now,
      updatedAt: now,
      sectionCount: 1,
      questionCount: 0,
      usageCount: 0,
    },
  };
}

export function updateTemplate(
  templateId: string,
  fields: { name?: string; description?: string | null; category?: string | null },
  actor: string | null
): { template: FormTemplate } {
  const current = editableTemplate(templateId);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };

  if (fields.name !== undefined) set("name", fields.name);
  if (fields.description !== undefined) set("description", fields.description);
  if (fields.category !== undefined) set("category", fields.category);

  if (!sets.length) {
    throw new Error("no editable fields supplied (one of: name, description, category)");
  }

  const now = nowIso();
  set("updated_by", actor);
  set("updated_at", now);
  params.push(templateId);

  mutate(`update fl_form_template set ${sets.join(", ")} where id = $${params.length}`, params);

  return {
    template: {
      ...current,
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.description !== undefined ? { description: fields.description } : {}),
      ...(fields.category !== undefined ? { category: fields.category } : {}),
      updatedAt: now,
    },
  };
}

export function publishTemplate(templateId: string, actor: string | null): { template: FormTemplate } {
  const { template, sections } = templateDetail(templateId);

  const statusBlock = publishStatusBlocker(template.status);
  if (statusBlock) throw new Error(statusBlock);

  const blockers = publishBlockers(sections);
  if (blockers.length) throw new Error(`not publishable: ${blockers.join("; ")}`);

  const now = nowIso();

  // `and status = 'draft'` closes the race: two concurrent publishes cannot
  // both pass — the loser matches no row and hears about it instead of
  // silently double-logging the event.
  const updated = mutate(
    `update fl_form_template
        set status = 'published', published_by = $2, published_at = $3,
            updated_by = $2, updated_at = $3
      where id = $1 and status = 'draft' and is_active = 'true'`,
    [templateId, actor, now]
  );
  if (!updated) throw new Error("template is no longer a draft — reload and try again");

  /**
   * F-10: one published version per lineage. Publishing vN retires the version
   * it was cloned from (its parent) and any sibling published off the same
   * parent — two Published versions of one template meant the survey-create
   * picker offered both and nobody could say which was current. AFTER the
   * publish lands, so a failed publish never archives the working version.
   */
  if (template.parentTemplateId) {
    const retired = mutate(
      `update fl_form_template
          set status = 'archived', archived_by = $2, archived_at = $3,
              updated_by = $2, updated_at = $3
        where is_active = 'true' and status = 'published' and id <> $1
          and (id = $4 or parent_template_id = $4)`,
      [templateId, actor, now, template.parentTemplateId]
    );
    if (retired) {
      appendEvent({
        entityType: "form_template",
        entityId: templateId,
        kind: "superseded_prior",
        actor,
        body: `v${template.versionNo} published — ${retired} earlier published version(s) archived`,
      });
    }
  }

  appendEvent({
    entityType: "form_template",
    entityId: templateId,
    kind: "published",
    actor,
    body: `${template.name} v${template.versionNo}`,
  });

  return {
    template: { ...template, status: "published", publishedBy: actor, publishedAt: now, updatedAt: now },
  };
}

/**
 * A new draft with `version_no + 1` and the whole section/question tree copied.
 * The published row is never edited in place — this is the only way forward.
 *
 * There are no transactions, and the question copy must attach to the NEW
 * section rows. Deriving every new id as `md5(newTemplateId || oldId)` lets
 * each copy run as ONE set-based statement — the same join-free trick as the
 * survey snapshot (plan §6.1), with the old→new mapping computed instead of
 * stored, since fl_form_section has no source column.
 */
export function cloneTemplate(templateId: string, actor: string | null): { template: FormTemplate } {
  const { template, sections } = templateDetail(templateId);
  const now = nowIso();

  const row = one<{ id: string }>(
    `insert into fl_form_template
       (id, name, description, category, status, version_no, parent_template_id,
        created_by, updated_by, is_active, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, 'draft', $4, $5, $6, $6, 'true', '{}', $7, $7)
     returning id`,
    [
      template.name,
      template.description,
      template.category,
      template.versionNo + 1,
      templateId,
      actor,
      now,
    ]
  );
  if (!row) throw new Error("clone insert returned no row");

  mutate(
    `insert into fl_form_section
       (id, template_id, name, description, sequence_no, level_binding,
        applicability_service_ids_json, is_repeatable, repeat_label, min_repeats, max_repeats,
        creates_portfolio_node, node_type_created, created_by, updated_by, is_active,
        data_json, created_at, updated_at)
     select md5($1 || id)::uuid::text, $1, name, description, sequence_no, level_binding,
            applicability_service_ids_json, is_repeatable, repeat_label, min_repeats, max_repeats,
            creates_portfolio_node, node_type_created, $2, $2, 'true',
            data_json, $3, $3
       from fl_form_section
      where template_id = $4 and is_active = 'true'`,
    [row.id, actor, now, templateId]
  );

  mutate(
    `insert into fl_form_question
       (id, section_id, template_id, label, help_text, field_type, options_json,
        allow_multiple, sequence_no, is_required, feeds_estimation, estimation_key, unit,
        created_by, updated_by, is_active, data_json, created_at, updated_at)
     select md5($1 || id)::uuid::text, md5($1 || section_id)::uuid::text, $1, label, help_text,
            field_type, options_json, allow_multiple, sequence_no, is_required,
            feeds_estimation, estimation_key, unit, $2, $2, 'true', data_json, $3, $3
       from fl_form_question
      where template_id = $4 and is_active = 'true'`,
    [row.id, actor, now, templateId]
  );

  appendEvent({
    entityType: "form_template",
    entityId: row.id,
    kind: "cloned",
    actor,
    body: `from ${template.name} v${template.versionNo}`,
    meta: { parentTemplateId: templateId },
  });

  return {
    template: {
      ...template,
      id: row.id,
      status: "draft",
      versionNo: template.versionNo + 1,
      parentTemplateId: templateId,
      publishedBy: null,
      publishedAt: null,
      archivedBy: null,
      archivedAt: null,
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
      sectionCount: sections.length,
      questionCount: sections.reduce((n, s) => n + s.questions.length, 0),
      usageCount: 0,
    },
  };
}

export interface ImportQuestion {
  label: string;
  helpText?: string | null;
  fieldType: string;
  options?: string[];
  allowMultiple?: boolean;
  isRequired?: boolean;
  feedsEstimation?: boolean;
  estimationKey?: string | null;
  unit?: string | null;
}

export interface ImportSection {
  name: string;
  description?: string | null;
  levelBinding?: string;
  isRepeatable?: boolean;
  repeatLabel?: string | null;
  minRepeats?: number | null;
  maxRepeats?: number | null;
  createsPortfolioNode?: boolean;
  nodeTypeCreated?: string;
  applicabilityServiceIds?: string[];
  questions: ImportQuestion[];
}

/**
 * The builder's save: the whole template tree in THREE statements, however big
 * it is. The builder drafts locally and hands over everything at once — saving
 * a 5-section, 30-question template as per-row handler calls would be ~37
 * round trips at ~1.1s each, which is the §6.2 adoption-risk math all over
 * again, just at the desk instead of on the walk.
 *
 * Section ids are derived as `md5(templateId || 's<index>')` so the question
 * insert can compute its own `section_id` — same trick as `cloneTemplate`,
 * which is what lets each copy be one set-based statement with no id
 * round-tripping. There is no auto-'General' section on this path: the caller
 * supplies the full section list, unlike `template-create`'s empty start.
 *
 * `publish: true` runs the same guard as `template-publish` but never throws
 * on it — the tree is already saved by then, and "saved as draft, here is why
 * it did not publish" is the honest answer, not a rollback that cannot exist.
 */
export function importTemplate(input: {
  /** When set, REPLACES this draft's content in place instead of creating. */
  templateId?: string | null;
  name: string;
  description: string | null;
  category: string | null;
  publish: boolean;
  sections: ImportSection[];
  actor: string | null;
}): { template: FormTemplate; published: boolean; publishBlockers: string[] } {
  // The WHOLE tree validates before the first insert — there are no
  // transactions, so a validation error after a write would strand a
  // half-saved draft the user never asked for.
  for (const s of input.sections) {
    if (!s.name?.trim()) throw new Error("every section needs a name");
    if (s.levelBinding !== undefined) inSet(s.levelBinding, LEVEL_BINDINGS, "levelBinding");
    if (s.nodeTypeCreated !== undefined) inSet(s.nodeTypeCreated, NODE_TYPES, "nodeTypeCreated");
    for (const q of s.questions) {
      if (!q.label?.trim()) throw new Error(`every question needs a label (section "${s.name}")`);
      inSet(q.fieldType, FIELD_TYPES, "fieldType");
      if (q.options !== undefined && q.options.some((o) => typeof o !== "string")) {
        throw new Error("options must be an array of strings");
      }
      // The VALUE is validated whenever one is given; its PRESENCE on a
      // `number` is a publish blocker, not a save error. A draft mid-authoring
      // legitimately has a number question whose unit is not chosen yet.
      if (q.unit !== undefined && q.unit !== null && q.unit !== "") {
        inSet(q.unit, UNITS, "unit");
      }
    }
  }

  const now = nowIso();
  const category = input.category ?? "General";

  let templateId: string;
  let versionNo = 1;

  if (input.templateId) {
    // Replace: only a draft is rewritable (published content is what
    // `version_no` names — editableTemplate throws the clone-instead message).
    const current = editableTemplate(input.templateId);
    templateId = current.id;
    versionNo = current.versionNo;

    mutate(
      `update fl_form_template
          set name = $2, description = $3, category = $4, updated_by = $5, updated_at = $6
        where id = $1`,
      [templateId, input.name, input.description, category, input.actor, now]
    );

    // The old tree steps aside, the new one lands whole. Deactivated rows keep
    // the history; the section-id salt below keeps their ids from colliding
    // with the fresh copies.
    mutate(
      `update fl_form_section set is_active = 'false', updated_by = $2, updated_at = $3
        where template_id = $1 and is_active = 'true'`,
      [templateId, input.actor, now]
    );
    mutate(
      `update fl_form_question set is_active = 'false', updated_by = $2, updated_at = $3
        where template_id = $1 and is_active = 'true'`,
      [templateId, input.actor, now]
    );
  } else {
    const row = one<{ id: string }>(
      `insert into fl_form_template
         (id, name, description, category, status, version_no, parent_template_id,
          created_by, updated_by, is_active, data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3, 'draft', 1, null, $4, $4, 'true', '{}', $5, $5)
       returning id`,
      [input.name, input.description, category, input.actor, now]
    );
    if (!row) throw new Error("template insert returned no row");
    templateId = row.id;
  }

  if (input.sections.length) {
    // $3 (now) salts the md5-derived section ids: a draft saved twice reuses
    // the same s0/s1 keys, and unsalted ids would collide with the previous
    // save's now-inactive rows — the not-exists guard would then silently skip
    // the new content.
    const sp: unknown[] = [templateId, input.actor, now];
    const sectionRows = input.sections.map((s, i) => {
      sp.push(`s${i}`);
      const key = `$${sp.length}`;
      const vals: string[] = [];
      const add = (v: unknown) => {
        sp.push(v);
        vals.push(`$${sp.length}`);
      };
      add(s.name.trim());
      add(s.description ?? null);
      add(s.levelBinding ?? "per_survey");
      add(JSON.stringify(s.applicabilityServiceIds ?? []));
      add(String(s.isRepeatable ?? false));
      add(s.repeatLabel ?? null);
      add(s.minRepeats ?? null);
      add(s.maxRepeats ?? null);
      add(String(s.createsPortfolioNode ?? false));
      add(s.nodeTypeCreated ?? "space");
      return `(md5($1 || $3 || ${key})::uuid::text, $1, ${vals[0]}, ${vals[1]}, ${i + 1}, ${vals[2]},
               ${vals[3]}, ${vals[4]}, ${vals[5]}, ${vals[6]}, ${vals[7]}, ${vals[8]}, ${vals[9]},
               $2, $2, 'true', '{}', $3, $3)`;
    });

    mutate(
      `insert into fl_form_section
         (id, template_id, name, description, sequence_no, level_binding,
          applicability_service_ids_json, is_repeatable, repeat_label, min_repeats, max_repeats,
          creates_portfolio_node, node_type_created, created_by, updated_by, is_active,
          data_json, created_at, updated_at)
       values ${sectionRows.join(", ")}`,
      sp
    );
  }

  const qp: unknown[] = [templateId, input.actor, now];
  const questionRows: string[] = [];
  input.sections.forEach((s, i) => {
    s.questions.forEach((q, qi) => {
      qp.push(`s${i}`);
      const key = `$${qp.length}`;
      const vals: string[] = [];
      const add = (v: unknown) => {
        qp.push(v);
        vals.push(`$${qp.length}`);
      };
      // F-02: the key is derived (or the Advanced override kept) — see
      // normalizeEstimation. Import is the builder's save path, so this is
      // where the rule bites.
      const est = normalizeEstimation(q);
      add(q.label.trim());
      add(q.helpText ?? null);
      add(q.fieldType);
      add(JSON.stringify(q.options ?? []));
      add(String(q.allowMultiple ?? false));
      add(String(q.isRequired ?? false));
      add(String(est.feedsEstimation));
      add(est.estimationKey);
      add(q.unit ?? null);
      questionRows.push(
        `(gen_random_uuid()::text, md5($1 || $3 || ${key})::uuid::text, $1, ${vals[0]}, ${vals[1]},
          ${vals[2]}, ${vals[3]}, ${vals[4]}, ${qi + 1}, ${vals[5]}, ${vals[6]}, ${vals[7]},
          ${vals[8]}, $2, $2, 'true', '{}', $3, $3)`
      );
    });
  });

  if (questionRows.length) {
    mutate(
      `insert into fl_form_question
         (id, section_id, template_id, label, help_text, field_type, options_json,
          allow_multiple, sequence_no, is_required, feeds_estimation, estimation_key, unit,
          created_by, updated_by, is_active, data_json, created_at, updated_at)
       values ${questionRows.join(", ")}`,
      qp
    );
  }

  appendEvent({
    entityType: "form_template",
    entityId: templateId,
    kind: input.templateId ? "updated" : "created",
    actor: input.actor,
    body: input.name,
  });

  const blockers = publishBlockers(
    input.sections.map((s) => ({
      questions: s.questions.map((q) => ({
        fieldType: q.fieldType,
        options: q.options ?? [],
        unit: q.unit ?? null,
        estimationKey: q.estimationKey ?? null,
      })),
    }))
  );

  let published = false;
  if (input.publish && !blockers.length) {
    mutate(
      `update fl_form_template
          set status = 'published', published_by = $2, published_at = $3,
              updated_by = $2, updated_at = $3
        where id = $1 and status = 'draft' and is_active = 'true'`,
      [templateId, input.actor, now]
    );
    // F-10, same rule as publishTemplate: one published version per lineage.
    // The parent is read by subselect because this path may be re-saving an
    // existing draft whose row carries it.
    mutate(
      `update fl_form_template
          set status = 'archived', archived_by = $2, archived_at = $3,
              updated_by = $2, updated_at = $3
        where is_active = 'true' and status = 'published' and id <> $1
          and (select parent_template_id from fl_form_template where id = $1) is not null
          and (id = (select parent_template_id from fl_form_template where id = $1)
               or parent_template_id = (select parent_template_id from fl_form_template where id = $1))`,
      [templateId, input.actor, now]
    );
    appendEvent({
      entityType: "form_template",
      entityId: templateId,
      kind: "published",
      actor: input.actor,
      body: `${input.name} v${versionNo}`,
    });
    published = true;
  }

  return {
    template: {
      id: templateId,
      name: input.name,
      description: input.description,
      category,
      status: published ? "published" : "draft",
      versionNo,
      parentTemplateId: null,
      publishedBy: published ? input.actor : null,
      publishedAt: published ? now : null,
      archivedBy: null,
      archivedAt: null,
      createdBy: input.actor,
      createdAt: now,
      updatedAt: now,
      sectionCount: input.sections.length,
      questionCount: input.sections.reduce((n, s) => n + s.questions.length, 0),
      usageCount: 0,
    },
    published,
    publishBlockers: input.publish ? blockers : [],
  };
}

/** Removed from the picker; in-flight surveys are unaffected — they hold snapshots. */
export function archiveTemplate(templateId: string, actor: string | null): { template: FormTemplate } {
  const template = one<FormTemplate>(
    `select ${TEMPLATE_COLUMNS} from fl_form_template
      where id = $1 and is_active = 'true' limit 1`,
    [templateId]
  );
  if (!template) throw new Error(`template ${templateId} not found`);

  const blocked = archiveBlocker(template.status);
  if (blocked) throw new Error(blocked);

  const now = nowIso();
  mutate(
    `update fl_form_template
        set status = 'archived', archived_by = $2, archived_at = $3,
            updated_by = $2, updated_at = $3
      where id = $1 and status != 'archived' and is_active = 'true'`,
    [templateId, actor, now]
  );

  appendEvent({
    entityType: "form_template",
    entityId: templateId,
    kind: "archived",
    actor,
    body: template.name,
  });

  return {
    template: { ...template, status: "archived", archivedBy: actor, archivedAt: now, updatedAt: now },
  };
}

// ── Sections ──────────────────────────────────────────────────────────────────

export interface SectionInput {
  name?: string;
  description?: string | null;
  levelBinding?: string;
  isRepeatable?: boolean;
  repeatLabel?: string | null;
  minRepeats?: number | null;
  maxRepeats?: number | null;
  createsPortfolioNode?: boolean;
  nodeTypeCreated?: string;
  applicabilityServiceIds?: string[];
}

type SectionRow = Omit<FormSection, "questions">;

export function saveSection(
  templateId: string,
  sectionId: string | null,
  input: SectionInput,
  actor: string | null
): { section: FormSection } {
  editableTemplate(templateId);

  if (input.levelBinding !== undefined) inSet(input.levelBinding, LEVEL_BINDINGS, "levelBinding");
  if (input.nodeTypeCreated !== undefined) inSet(input.nodeTypeCreated, NODE_TYPES, "nodeTypeCreated");

  const now = nowIso();

  if (!sectionId) {
    if (!input.name) throw new Error("name is required");

    // sequence_no comes from a scalar subselect in the same statement. Two
    // simultaneous creates can tie — there is no unique constraint to stop
    // them — and reads break the tie on created_at, so a tie only means two
    // sections that can be dragged apart, never an error.
    const row = one<SectionRow>(
      `insert into fl_form_section
         (id, template_id, name, description, sequence_no, level_binding,
          applicability_service_ids_json, is_repeatable, repeat_label, min_repeats, max_repeats,
          creates_portfolio_node, node_type_created, created_by, updated_by, is_active,
          data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3,
               (select coalesce(max(sequence_no), 0) + 1 from fl_form_section
                 where template_id = $1 and is_active = 'true'),
               $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, 'true', '{}', $13, $13)
       returning ${SECTION_COLUMNS}`,
      [
        templateId,
        input.name,
        input.description ?? null,
        input.levelBinding ?? "per_survey",
        JSON.stringify(input.applicabilityServiceIds ?? []),
        String(input.isRepeatable ?? false),
        input.repeatLabel ?? null,
        input.minRepeats ?? null,
        input.maxRepeats ?? null,
        String(input.createsPortfolioNode ?? false),
        input.nodeTypeCreated ?? "space",
        actor,
        now,
      ]
    );
    if (!row) throw new Error("section insert returned no row");

    return { section: { ...row, questions: [] } };
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };

  if (input.name !== undefined) {
    if (!input.name) throw new Error("name cannot be blank");
    set("name", input.name);
  }
  if (input.description !== undefined) set("description", input.description);
  if (input.levelBinding !== undefined) set("level_binding", input.levelBinding);
  if (input.isRepeatable !== undefined) set("is_repeatable", String(input.isRepeatable));
  if (input.repeatLabel !== undefined) set("repeat_label", input.repeatLabel);
  if (input.minRepeats !== undefined) set("min_repeats", input.minRepeats);
  if (input.maxRepeats !== undefined) set("max_repeats", input.maxRepeats);
  if (input.createsPortfolioNode !== undefined) {
    set("creates_portfolio_node", String(input.createsPortfolioNode));
  }
  if (input.nodeTypeCreated !== undefined) set("node_type_created", input.nodeTypeCreated);
  if (input.applicabilityServiceIds !== undefined) {
    set("applicability_service_ids_json", JSON.stringify(input.applicabilityServiceIds));
  }

  if (!sets.length) throw new Error("no section fields supplied");

  set("updated_by", actor);
  set("updated_at", now);

  params.push(sectionId);
  const idAt = params.length;
  params.push(templateId);

  const row = one<SectionRow>(
    `update fl_form_section set ${sets.join(", ")}
      where id = $${idAt} and template_id = $${params.length} and is_active = 'true'
      returning ${SECTION_COLUMNS}`,
    params
  );
  if (!row) throw new Error(`section ${sectionId} not found on template ${templateId}`);

  const questions = many<FormQuestion>(
    `select ${QUESTION_COLUMNS} from fl_form_question
      where section_id = $1 and is_active = 'true'
      order by sequence_no, created_at
      limit 500`,
    [sectionId]
  );

  return { section: { ...row, questions } };
}

/** The section and its template's status, for guards that start from a section. */
function sectionContext(sectionId: string): { templateId: string; status: TemplateStatus } {
  const ctx = one<{ templateId: string; status: TemplateStatus }>(
    `select s.template_id, t.status
       from fl_form_section s
       join fl_form_template t on t.id = s.template_id
      where s.id = $1 and s.is_active = 'true' and t.is_active = 'true'
      limit 1`,
    [sectionId]
  );
  if (!ctx) throw new Error(`section ${sectionId} not found`);

  const blocked = editBlocker(ctx.status);
  if (blocked) throw new Error(blocked);

  return ctx;
}

export function deleteSection(sectionId: string, actor: string | null): {
  sectionId: string;
  questionsDeactivated: number;
} {
  sectionContext(sectionId);

  const now = nowIso();

  // Section first: the moment it flips, the whole group leaves every read, so
  // a failure between the two statements never shows half a section. The
  // question sweep is re-runnable — it only touches rows still active.
  mutate(
    `update fl_form_section set is_active = 'false', updated_by = $2, updated_at = $3 where id = $1`,
    [sectionId, actor, now]
  );
  const questionsDeactivated = mutate(
    `update fl_form_question set is_active = 'false', updated_by = $2, updated_at = $3
      where section_id = $1 and is_active = 'true'`,
    [sectionId, actor, now]
  );

  return { sectionId, questionsDeactivated };
}

/**
 * One `UPDATE … CASE` statement, so two people reordering at once end with one
 * list or the other — never a silent merge of both. This is the contract's
 * reason reorder is a `sequence_no` rewrite and not an array in a JSON blob.
 */
function reorderRows(
  table: string,
  scopeColumn: string,
  scopeId: string,
  orderedIds: string[]
): number {
  if (!orderedIds.length) throw new Error("orderedIds is empty");
  if (orderedIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("orderedIds must be non-empty id strings");
  }

  const params: unknown[] = [scopeId, nowIso()];
  const cases = orderedIds.map((id) => {
    params.push(id);
    return `when $${params.length} then ${params.length - 2}`;
  });

  return mutate(
    `update ${table}
        set sequence_no = case id ${cases.join(" ")} end, updated_at = $2
      where ${scopeColumn} = $1 and is_active = 'true'
        and id in (${orderedIds.map((_, i) => `$${i + 3}`).join(", ")})`,
    params
  );
}

export function reorderSections(templateId: string, orderedIds: string[]): { updated: number } {
  editableTemplate(templateId);
  return { updated: reorderRows("fl_form_section", "template_id", templateId, orderedIds) };
}

/**
 * F-02, as ruled: the estimation key is DERIVED from the question text and
 * unit, never invented by the author — a typed key box was "some random shit"
 * and the naming drift it caused is why priced-looking questions fell through
 * to unpriced. A number question always prices (that is what the type is FOR);
 * an options question prices only when opted in. A key typed under the
 * Advanced toggle survives as the override; a blank one derives.
 */
function normalizeEstimation(q: {
  label?: string;
  fieldType?: string;
  feedsEstimation?: boolean;
  estimationKey?: string | null;
  unit?: string | null;
}): { feedsEstimation: boolean; estimationKey: string | null } {
  if (!isEstimable(q.fieldType ?? "")) return { feedsEstimation: false, estimationKey: null };
  const wants =
    q.fieldType === "number" || Boolean(q.feedsEstimation) || Boolean(q.estimationKey?.trim());
  if (!wants) return { feedsEstimation: false, estimationKey: null };
  return {
    feedsEstimation: true,
    estimationKey: q.estimationKey?.trim() || deriveEstimationKey(q.label ?? "", q.unit),
  };
}

// ── Questions ─────────────────────────────────────────────────────────────────

export interface QuestionInput {
  label?: string;
  helpText?: string | null;
  fieldType?: string;
  options?: string[];
  allowMultiple?: boolean;
  isRequired?: boolean;
  feedsEstimation?: boolean;
  estimationKey?: string | null;
  unit?: string | null;
}

export function saveQuestion(
  sectionId: string,
  questionId: string | null,
  input: QuestionInput,
  actor: string | null
): { question: FormQuestion } {
  const ctx = sectionContext(sectionId);

  if (input.fieldType !== undefined) inSet(input.fieldType, FIELD_TYPES, "fieldType");
  if (input.options !== undefined && input.options.some((o) => typeof o !== "string")) {
    throw new Error("options must be an array of strings");
  }

  const now = nowIso();

  if (!questionId) {
    if (!input.label) throw new Error("label is required");
    if (!input.fieldType) {
      throw new Error(`fieldType is required (one of: ${FIELD_TYPES.join(", ")})`);
    }

    const est = normalizeEstimation(input);

    const row = one<FormQuestion>(
      `insert into fl_form_question
         (id, section_id, template_id, label, help_text, field_type, options_json,
          allow_multiple, sequence_no, is_required, feeds_estimation, estimation_key, unit,
          created_by, updated_by, is_active, data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7,
               (select coalesce(max(sequence_no), 0) + 1 from fl_form_question
                 where section_id = $1 and is_active = 'true'),
               $8, $9, $10, $11, $12, $12, 'true', '{}', $13, $13)
       returning ${QUESTION_COLUMNS}`,
      [
        sectionId,
        ctx.templateId,
        input.label,
        input.helpText ?? null,
        input.fieldType,
        JSON.stringify(input.options ?? []),
        String(input.allowMultiple ?? false),
        String(input.isRequired ?? false),
        String(est.feedsEstimation),
        est.estimationKey,
        input.unit ?? null,
        actor,
        now,
      ]
    );
    if (!row) throw new Error("question insert returned no row");

    return { question: row };
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };

  if (input.label !== undefined) {
    if (!input.label) throw new Error("label cannot be blank");
    set("label", input.label);
  }
  if (input.helpText !== undefined) set("help_text", input.helpText);
  if (input.fieldType !== undefined) set("field_type", input.fieldType);
  if (input.options !== undefined) set("options_json", JSON.stringify(input.options));
  if (input.allowMultiple !== undefined) set("allow_multiple", String(input.allowMultiple));
  if (input.isRequired !== undefined) set("is_required", String(input.isRequired));
  if (input.feedsEstimation !== undefined) set("feeds_estimation", String(input.feedsEstimation));
  if (input.estimationKey !== undefined) set("estimation_key", input.estimationKey);
  if (input.unit !== undefined) set("unit", input.unit);

  if (!sets.length) throw new Error("no question fields supplied");

  set("updated_by", actor);
  set("updated_at", now);

  params.push(questionId);
  const idAt = params.length;
  params.push(sectionId);

  const row = one<FormQuestion>(
    `update fl_form_question set ${sets.join(", ")}
      where id = $${idAt} and section_id = $${params.length} and is_active = 'true'
      returning ${QUESTION_COLUMNS}`,
    params
  );
  if (!row) throw new Error(`question ${questionId} not found in section ${sectionId}`);

  return { question: row };
}

export function deleteQuestion(questionId: string, actor: string | null): { questionId: string } {
  const ctx = one<{ status: TemplateStatus }>(
    `select t.status
       from fl_form_question q
       join fl_form_template t on t.id = q.template_id
      where q.id = $1 and q.is_active = 'true' and t.is_active = 'true'
      limit 1`,
    [questionId]
  );
  if (!ctx) throw new Error(`question ${questionId} not found`);

  const blocked = editBlocker(ctx.status);
  if (blocked) throw new Error(blocked);

  mutate(
    `update fl_form_question set is_active = 'false', updated_by = $2, updated_at = $3 where id = $1`,
    [questionId, actor, nowIso()]
  );

  return { questionId };
}

export function reorderQuestions(sectionId: string, orderedIds: string[]): { updated: number } {
  sectionContext(sectionId);
  return { updated: reorderRows("fl_form_question", "section_id", sectionId, orderedIds) };
}
