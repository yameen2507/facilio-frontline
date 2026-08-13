/**
 * The T2 snapshot — the template copied into the survey, Backend Plan §6.1.
 *
 * TWO statements, not N inserts: a 60-question template as row-by-row inserts
 * is 60 round trips at ~194ms each against a 10s statement timeout. The
 * section copy stamps `source_section_id`, and the question copy joins back
 * through it to find the freshly created instances — that column is what
 * makes the second statement possible at all.
 *
 * IDEMPOTENT BY CONSTRUCTION. There are no transactions, so a half-finished
 * snapshot (sections in, questions timed out) WILL happen eventually; the
 * `where not exists (… source_… = …)` clauses make the re-run repair it
 * instead of duplicating it. Callers may — and do — invoke this on every
 * schedule, not just the first.
 */

import { mutate, nowIso } from "../shared/db";

export function snapshotTemplate(
  surveyId: string,
  templateId: string,
  templateVersionNo: number | null
): { sections: number; questions: number } {
  const now = nowIso();

  const sections = mutate(
    `insert into fl_survey_section_instance
       (id, survey_id, source_section_id, source_template_id, source_template_version_no,
        name, description, sequence_no, level_binding, applicability_service_ids_json,
        is_repeatable, repeat_label, min_repeats, max_repeats, creates_portfolio_node,
        node_type_created, added_ad_hoc, is_active, data_json, created_at, updated_at)
     select gen_random_uuid()::text, $1, s.id, $2, $3,
            s.name, s.description, s.sequence_no, s.level_binding, s.applicability_service_ids_json,
            s.is_repeatable, s.repeat_label, s.min_repeats, s.max_repeats, s.creates_portfolio_node,
            s.node_type_created, 'false', 'true', '{}', $4, $4
       from fl_form_section s
      where s.template_id = $2 and s.is_active = 'true'
        and not exists (select 1 from fl_survey_section_instance i
                         where i.survey_id = $1 and i.source_section_id = s.id)`,
    [surveyId, templateId, templateVersionNo, now]
  );

  const questions = mutate(
    `insert into fl_survey_question_instance
       (id, survey_id, section_instance_id, source_question_id, source_section_id,
        source_template_version_no, label, help_text, field_type, options_json,
        allow_multiple, sequence_no, is_required, feeds_estimation, estimation_key, unit,
        added_ad_hoc, is_active, data_json, created_at, updated_at)
     select gen_random_uuid()::text, $1, i.id, q.id, q.section_id,
            $3, q.label, q.help_text, q.field_type, q.options_json,
            q.allow_multiple, q.sequence_no, q.is_required, q.feeds_estimation, q.estimation_key, q.unit,
            'false', 'true', '{}', $4, $4
       from fl_form_question q
       join fl_survey_section_instance i
         on i.source_section_id = q.section_id and i.survey_id = $1
      where q.template_id = $2 and q.is_active = 'true'
        and not exists (select 1 from fl_survey_question_instance x
                         where x.survey_id = $1 and x.source_question_id = q.id)`,
    [surveyId, templateId, templateVersionNo, now]
  );

  return { sections, questions };
}
