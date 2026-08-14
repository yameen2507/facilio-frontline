<!--
  FRONTLINE SURVEY MODULE — BACKEND BUILD PLAN v1
  Author: Claude (with Mohamed Yameen) · 13 Aug 2026
  Governed by: Survey Module Structure v1.7.md (what gets built) · ARCHITECTURE.md §3a/§5/§9/§11 (how this
    platform lets us build it) · Claude v8.6 Amendment Survey Scope.md (soft-services scope).
  VERSIONING RULE (inherited from v1.7): every revision is a NEW FILE. This one is immutable once reviewed.

  WHAT THIS FILE IS: the translation layer. v1.7 specifies a Postgres schema with foreign keys, sequences,
  partial unique indexes and 20 tables. This platform has none of those. This file states exactly what gets
  imported, what deviates from v1.7 and why, and freezes the function API the frontend will be built against.

  WHAT THIS FILE IS NOT: it does not re-open any decision in v1.7 §10. Where a decision is still open, the
  table shape is a SUPERSET that satisfies either answer — see §3.
-->

# Frontline Survey Module — Backend Build Plan v1

*Stage 2 of the three-stage build order. Exit gate: every handler in §7 returns real data via
`facilio vibe function run`. No frontend work starts until that gate passes.*

---

## 1. THE ONE-WAY DOOR, AND WHY THIS DOCUMENT IS SHAPED AROUND IT

Everything in this plan is rewritable code **except one thing**: the CSV column list.

The app's DB role cannot `CREATE`, `ALTER`, `DROP` or `INDEX` (probed, ARCHITECTURE.md §3a). Tables come into
existence only through `facilio vibe db import`, which infers columns from a CSV header plus one seed row — and
**re-importing an existing table returns 500**. A forgotten column is not a migration; it is a new table and a
data move.

Three consequences that govern the rest of this document:

1. **§3 (the CSV definitions) is the deliverable that must be right.** §7 (the API) is the deliverable that
   must be *agreed*, because two people build against it — but it can be changed on a Tuesday.
2. **Import every table now, build handlers for fewer.** An imported table nobody writes to costs nothing at
   runtime. A table we need in week two and cannot create costs a day. `fl_survey_qualification` and
   `fl_survey_recommendation` are v1.7's own nominated scope cuts (§1) — cut the *handlers* if the window
   tightens, not the import.
3. **Be generous with queryable columns.** Anything we might filter, sort or join on is a real column.
   Everything else goes in `data_json`, which every table carries for exactly this reason.

> **This plan does not run `facilio vibe db import`.** Writing the definitions into `scripts/db-import.mjs` is
> planning. Running the import is the one-way door, and it happens only after §3 is signed off.

**What is NOT gated on Sudharsan's 16 open decisions (v1.7 §10):** the import. Each open decision that touches
storage is satisfied by a superset column set — D-p keeps `section_entry_id`, `scope_node_id` *and*
`creates_portfolio_node`; D-k keeps `value_number` + `unit`; D-b keeps `participation`; D-d keeps
`is_visit_lead`; D-j drops the table and puts `discipline_ids` in `data_json`; D-n keeps `user_email` as text
and never as a foreign key. **The import can proceed before the decisions land.** The decisions change which
*handlers* get built, and that is a code change.

---

## 2. DEVIATIONS FROM v1.7 — the honest list

Every one of these is forced by the platform, not preferred. They are stated here rather than absorbed
silently, because Mithun and Sudharsan will read v1.7 and code that quietly disagrees with the spec is the
exact failure mode the three-stage build order exists to prevent.

| # | v1.7 says | This plan does | Why |
|---|---|---|---|
| **X1** | `survey_assignee` is the truth; `survey.lead_assignee_id` is a "denormalised mirror". Enforce one lead with `CREATE UNIQUE INDEX … WHERE is_lead = true` (L11) | **Inverted. `fl_survey.lead_assignee_id` is the single source of truth; `isLead` is derived at read time.** `is_lead` exists as a column but is **reserved and must never be read as truth** | **L11 is closed: no indexes of any kind, ever.** There are also no transactions. A single-statement `UPDATE fl_survey SET lead_assignee_id = $1` is the only atomic write this platform offers, so the flag has to live on the row that can be updated atomically. Two people clicking at once cannot produce two leads |
| **X2** | `survey_number` = `SUR-00042` (5 digits) | **`SUR-0042`** (4 digits) | `nextRef()` in `shared/ids.ts` pads to 4 and already issues `LEAD-0001` / `DEAL-0001`. Matching the house format beats matching the spec's example. Say the word if you want 5 and it is a one-line change **before** any survey exists |
| **X3** | `survey_status_log` and `survey_lead_handover_log` are tables | **`fl_event` rows**, `entity_type = 'survey' \| 'survey_visit' \| 'form_template'`, `kind = 'status_change' \| 'lead_handover' \| …` | ARCHITECTURE.md §5: `fl_event` is **the one** append-only log for the whole app. Two more log tables would fork the audit trail and break the existing timeline reader |
| **X4** | `survey_attachment` with a `kind` column (`photo`/`document`/`audio_note`/…) | **`fl_photo` rows.** `kind` and the geo triple live in `data_json`; filtering by kind is client-side | `fl_photo` already exists with a permanent shape and has no `kind` column. Acceptable at P1 volume, and `nameplate_photo` is dead anyway (v8.6 S3). **This is a deliberate call, not a discovery** |
| **X5** | `survey_module_settings` is an org singleton table; `survey_template_category` is a lookup table | **`fl_setting` keys** (`survey.condition_scale_direction`, `survey.geotag_capture`, …). Category is plain text on the template, seeded `General` | Two tables avoided, and settings already have a working read path (`modules/settings.ts`) |
| **X6** | `survey_discipline` table | **Cut** (v1.7's own D-j recommendation). `discipline_ids` is a free-text array in the assignee's `data_json` | Its sole justification was the T3 coverage guard, which v1.6 removed |
| **X7** | T4 (`assigned → in_progress`) is **workflow-driven** | Fires **inside the `capture` handler** as a deterministic side effect of the first capture | There is no workflow engine, and scheduled jobs exist only on production at a 15-minute floor. It is still deterministic and still not AI — but it is code in the write path, not an engine. Doctrine holds; the mechanism differs |
| **X8** | Permission keys "enforced server-side in the function layer, **never only in the UI**" (§B5) | **Registered and enforced in the UI only.** The actor is client-asserted | Functions receive no caller identity — the run body is `{orgId, args, env, system}`. ARCHITECTURE.md §10 already states this limitation for leads; the survey module inherits it. **Sudharsan should see this line explicitly: the audit trail is honest about *what* changed and trusting about *who*** |
| **X9** | `survey_revision.checksum` | FNV-1a over canonical JSON, in `domain/survey-revision.ts`, unit-tested | No crypto module is available in the function runtime. A non-cryptographic checksum still proves "this payload was not edited after freezing", which is the claim being made |
| **X10** | Foreign keys, `UNIQUE`, `ENUM`, `BOOLEAN`, `TIMESTAMPTZ` | Every FK is a `text` uuid validated in `modules/`. Enums are `text` validated in `domain/`. **Booleans are the strings `'true'`/`'false'`. Timestamps are ISO 8601 UTC strings** (they sort correctly) | CSV inference gives `numeric` for anything that parses as a number and `text` for everything else. Nothing more |

**The convention X10 forces, stated once because a forgotten instance is silent:**
`where is_active = 'true'` — **not** `where is_active`. A missed clause returns soft-deleted rows and nothing
errors.

---

## 3. THE TABLES — 18 new, 3 reused, 3 cut

`fl_` prefix, `snake_case`. Every table also carries the four common columns (`id`, `data_json`, `created_at`,
`updated_at`) — omitted below. Written into `scripts/db-import.mjs` in this order.

**Seed-value rule (type inference, and it bites):** a column meant to hold text must have a seed value that
**cannot parse as a number**. Facilio ids (`facilio_id`, `user_id`, `suggested_service_id`, `space_category`),
which are numeric strings in the wild, must be seeded `"none"` or they become `numeric` permanently and every
id read back is corrupted.

### 3.1 The form builder — the platform piece (function `form`)

Deliberately not named `survey_*`. v1.7 §B1 is explicit that this is a generic builder that the survey module
merely consumes, so leads, mobilization and QA forms can reuse it.

| Table | Columns |
|---|---|
| **`fl_form_template`** | `name` · `description` · `category` · `status` (`draft\|published\|archived`) · `version_no` · `parent_template_id` · `published_by` · `published_at` · `archived_by` · `archived_at` · `created_by` · `updated_by` · `is_active` |
| **`fl_form_section`** | `template_id` · `name` · `description` · `sequence_no` · `level_binding` (`per_survey\|per_building\|per_space`) · `applicability_service_ids_json` · `is_repeatable` · `repeat_label` · `min_repeats` · `max_repeats` · `creates_portfolio_node` · `node_type_created` (`space\|building`) · `created_by` · `updated_by` · `is_active` |
| **`fl_form_question`** | `section_id` · **`template_id`** · `label` · `help_text` · `field_type` · `options_json` · `allow_multiple` · `sequence_no` · `is_required` · `feeds_estimation` · `estimation_key` · **`unit`** · `created_by` · `updated_by` · `is_active` |

- `template_id` is denormalised onto the question so a template's whole question set is one query with no join.
- `field_type` is `text`, validated in `domain/` — so **D-k (adding `number`) is a code change, not a
  migration**. `unit` is imported now precisely so that stays true.
- `level_binding`, `creates_portfolio_node` and `node_type_created` all exist so **D-p can go either way**
  after the import.

### 3.2 The survey — the run-time record (function `survey`)

| Table | Columns |
|---|---|
| **`fl_survey`** | `ref_no` · `deal_id` · `account_id` · `title` · `template_id` · `template_version_no` · `prospect_site_id` · `buildings_in_scope_json` · `status` · `status_changed_at` · `status_changed_by` · **`lead_assignee_id`** · `lead_user_email` · `disciplines_required_json` · `contract_intent` · `is_condition_survey_complete` · `target_completion_date` · `revision_no` · `parent_survey_id` · `superseded_by_survey_id` · `rework_count` · `completeness_pct` · `not_visited_pct` · `cancel_reason` · `cancelled_by` · `cancelled_at` · `submitted_by` · `submitted_at` · `current_revision_id` · `notes` · `created_by` · `updated_by` · `is_active` |
| **`fl_survey_visit`** | `survey_id` · `visit_number` · `sequence_no` · `scheduled_start` · `scheduled_end` · `timezone` · `buildings_covered_json` · `site_contact_id` · `site_contact_name` · `site_contact_phone` · `site_contact_email` · `meeting_instructions` · `access_instructions` · `notes` · `slot_source` · `slot_granted_by` · `status` · `actual_start_at` · `actual_end_at` · `conflict_warnings_json` · `conflict_acknowledged_by` · `conflict_acknowledged_at` · `cancel_reason` · `no_show_reason` · `created_by` · `updated_by` · `is_active` |
| **`fl_survey_assignee`** | `survey_id` · `user_email` · `user_id` · `discipline_ids_json` · `is_lead` *(reserved — see X1)* · `participation` · `assigned_by` · `assigned_at` · `notified_at` · `removed_by` · `removed_at` · `removal_reason` · `is_active` |
| **`fl_survey_visit_assignee`** | `visit_id` · `survey_id` · `user_email` · `user_id` · `discipline_ids_json` · `is_visit_lead` · `attendance` · `assigned_by` · `assigned_at` · `removed_by` · `removed_at` · `is_active` |

`lead_user_email` is denormalised so "my surveys" filters without a join. This is an identity mirror, not a
counter — ARCHITECTURE.md §9 rule 5 forbids denormalised **counts**, and `fl_lead` already mirrors
`score`/`verdict` on the same reasoning.

### 3.3 The snapshot and the walk — the hot path

| Table | Columns |
|---|---|
| **`fl_survey_section_instance`** | `survey_id` · **`source_section_id`** · `source_template_id` · `source_template_version_no` · `name` · `description` · `sequence_no` · `level_binding` · `applicability_service_ids_json` · `is_repeatable` · `repeat_label` · `min_repeats` · `max_repeats` · `creates_portfolio_node` · `node_type_created` · `added_ad_hoc` · `is_active` |
| **`fl_survey_question_instance`** | `survey_id` · `section_instance_id` · **`source_question_id`** · `source_section_id` · `source_template_version_no` · `label` · `help_text` · `field_type` · `options_json` · `allow_multiple` · `sequence_no` · `is_required` · `feeds_estimation` · `estimation_key` · `unit` · `added_ad_hoc` · `is_active` |
| **`fl_survey_section_entry`** | `survey_id` · `section_instance_id` · `entry_no` · `entry_label` · `prospect_node_id` · `visit_id` · `created_by` · `is_active` |
| **`fl_survey_answer`** | `survey_id` · `question_instance_id` · **`section_entry_id`** · `scope_node_id` · `value_text` · `value_number` · `value_bool` · `value_json` · `value_date` · `is_na` · `na_reason` · `answered_by` · `answered_at` · `visit_id` · `ai_confidence` · `ai_source` · `superseded_by_answer_id` · `geo_lat` · `geo_lng` · `geo_accuracy_m` · `is_active` |
| **`fl_survey_observation`** | `survey_id` · `visit_id` · `prospect_node_id` · **`section_entry_id`** · `condition_score` · `contamination_level` · `buildup_note` · `access_constraint` · `safety_note` · `suggested_frequency` · `observed_by` · `observed_at` · `geo_lat` · `geo_lng` · `geo_accuracy_m` · `superseded_by_observation_id` · `is_active` |

**`source_section_id` and `source_question_id` are the two columns that must not be missed.** They do two jobs:

1. They are how the snapshot runs as **two statements instead of N inserts** (§6). Without
   `source_section_id` on the section instance, the question copy has nothing to join the freshly-created
   section instances to, and a 60-question template becomes 60 round trips against a 10s statement timeout.
2. They are the idempotency key. There are no transactions, so a half-finished snapshot **will** happen; the
   re-run is `insert … select … where not exists (… source_question_id = …)`.

`fl_survey_observation.section_entry_id` is the D-p superset: it lets a condition score be captured against a
repeat entry *before* — or without — a `space` node existing.

### 3.4 The prospect portfolio

| Table | Columns |
|---|---|
| **`fl_prospect_node`** | `deal_id` · `survey_id` · `node_type` (`site\|building\|space`) · `parent_node_id` · `ancestry_path` · `name` · `code` · `facilio_id` · `facilio_module` · `space_category` · `floor_label` · `area_sqft` · `floor_count` · `room_count` · `restroom_count` · `provenance` · `source_document_id` · `verdict` · `verdict_note` · `verdict_by` · `verdict_at` · `verdict_visit_id` · `created_by` · `updated_by` · `is_active` |
| **`fl_prospect_observation`** | `prospect_node_id` · `deal_id` · `survey_id` · `field_key` · `value_text` · `value_number` · `value_json` · `provenance` · `observed_by` · `observed_at` · `visit_id` · `is_accepted` · `accepted_by` · `accepted_at` · `superseded_by_observation_id` · `reconciliation_decision` · `geo_lat` · `geo_lng` · `geo_accuracy_m` |

The node belongs to the **deal** (D-i) — `survey_id` records which survey created it, and is never the owner.
`fl_prospect_observation` is append-only and has no `is_active`: nothing is ever updated in place, and
"current" means the latest row with `is_accepted = 'true'`.

### 3.5 Review, submit, handoff

| Table | Columns |
|---|---|
| **`fl_survey_recommendation`** | `survey_id` · `prospect_node_id` · `visit_id` · `title` · `description` · `recommendation_type` · `urgency` · `suggested_service_id` · `status` · `created_by` · `updated_by` · `is_active` |
| **`fl_survey_qualification`** | `survey_id` · `source` · `source_ref_id` · `text` · `is_printed_on_proposal` · `generated_automatically` · `created_by` · `updated_by` · `is_active` |
| **`fl_survey_reconciliation`** | `survey_id` · `diff_type` · `prospect_node_id` · `field_key` · `question_instance_id` · `rfp_value` · `survey_value` · `suggested_value` · `suggestion_basis` · `decision` · `manual_value` · `decided_by` · `decided_at` · `decision_note` · `clarification_id` · `status` · `is_active` |
| **`fl_survey_revision`** | `survey_id` · `revision_no` · `frozen_at` · `frozen_by` · `snapshot_json` · `checksum` · `trigger` · `is_current` |

`fl_survey_revision` has no `is_active` **by design, not by omission** — the same reasoning as
`fl_prospect_observation`. A frozen revision is append-only and can never be deactivated; superseding it is a
new row with `is_current = 'true'` and the old one flipped to `'false'`. A soft-delete flag on an audit record
is a way to erase an audit record.

### 3.6 Reused, and cut

| v1.7 entity | Becomes | |
|---|---|---|
| `survey_status_log` | `fl_event` rows | X3 |
| `survey_lead_handover_log` | `fl_event` rows, `kind = 'lead_handover'` | X3 |
| `survey_attachment` | `fl_photo` rows | X4 |
| `survey_module_settings` | `fl_setting` keys | X5 |
| `survey_template_category` | text on the template, seeded `General` | X5 |
| `survey_discipline` | **cut** — `discipline_ids` in `data_json` | X6 |

---

## 4. THE SHARED-FILE CHANGES — coordinate, do not do these solo

`shared/` and `domain/` are the *"agreed once, then frozen"* column of ARCHITECTURE.md §11's ownership table.
The survey module needs two changes there, and both are silent-failure risks if skipped.

**4.1 `shared/row-map.ts` — `NUMERIC_COLUMNS`.** CSV inference makes every number `numeric`, and `numeric`
arrives over the wire as a **JavaScript string**. A `condition_score >= 3` filter then compares strings and
`"10" < "9"`. These columns must be registered in one edit, agreed with whoever owns `shared/`:

```
sequence_no · entry_no · version_no · template_version_no · source_template_version_no · revision_no
rework_count · completeness_pct · not_visited_pct · condition_score · value_number · ai_confidence
area_sqft · floor_count · room_count · restroom_count · min_repeats · max_repeats
geo_lat · geo_lng · geo_accuracy_m
```

**Deliberately NOT in that list:** `user_id`, `facilio_id`, `suggested_service_id`, `space_category`,
`source_document_id`. They are Facilio ids that happen to look numeric and must stay strings — coercion is by
column *name* for exactly this reason.

**4.2 `shared/ids.ts` — one sequence.** `migrate.seed-config` gains `{ name: "survey", prefix: "SUR" }`.
**L12 is closed by this** — `nextRef()` is a single `UPDATE … RETURNING`, therefore atomic, therefore two
phones cannot collide. No app-level `count + 1` anywhere.

**There is deliberately no `visit` sequence.** v1.7 §A1.2 wants `SUR-0042/V2`, and the visit already carries
`sequence_no` — so `visit_number` is composed as `{survey.ref_no}/V{sequence_no}`, which is derivable, unique
within its survey, and one fewer row in the shared seed. `survey_module_settings.visit_number_prefix` (§B2) is
therefore unused and is not seeded.

**4.3 `functions/migrate/index.ts`** — the 18 new table names get added to `TABLES` so `clean-seed` and
`status` cover them.

---

## 5. `domain/survey-state.ts` — built and proven before any handler

House rule, ARCHITECTURE.md §11 step 5 and §12: state machines are pure, unit-tested on a laptop with no
platform and no network, **before** a handler uses them. `npm test` passing on `domain/` is the gate before
pushing any function. v1.7 hands us exactly this material.

| File | Holds | Tests |
|---|---|---|
| `domain/survey-state.ts` | The 7 states; T1–T10 with their guards; the **explicitly forbidden** transitions (`completed → anything`, `cancelled → anything`, `pending_review → completed` by a non-lead, `draft → in_progress`); which transitions require a reason; which stamp which column | Every allowed transition; every forbidden one throws; reason-required cases; lead-only cases |
| `domain/visit-state.ts` | `planned \| in_progress \| done \| no_show \| cancelled`; **`no_show` does not cascade the survey forward** (F13) | The no-show path specifically — this is the one that makes the metrics honest |
| `domain/survey-completeness.ts` | `completeness_pct`, `not_visited_pct`, and the T7 submit guard as a pure function over counts | The 80%-not-visited case still completes but warns (F12) |
| `domain/survey-revision.ts` | Canonical JSON + FNV-1a checksum (X9) | Same payload → same checksum; a reordered key → same checksum; a changed value → different |
| `domain/reconcile.ts` | The deterministic diff producing `fl_survey_reconciliation` rows, including `intra_survey_conflict` (F11) | Two assignees, one field, different values → one conflict row |

**The app suggests, the person decides.** `domain/reconcile.ts` produces `suggested_value` and a
plain-language `suggestion_basis`, and never writes a `decision`. That is D-S2 and it is load-bearing.

---

## 6. THE THREE PERFORMANCE DESIGNS

Every `query()` call costs **~194ms of fixed bridge overhead** regardless of what it does (measured on the
deployed app — a handler running 18 trivial `count(*)`s takes 4.59s, one running none takes 1.10s). Handler
round-trip overhead on top is ~1.1s. The only lever is fewer calls. Three places where that is not an
optimisation but the design:

**6.1 The snapshot is two statements.** T2 (`draft → scheduled`) copies the template. Not a loop:

```sql
-- 1: sections
insert into fl_survey_section_instance (id, survey_id, source_section_id, …)
select gen_random_uuid()::text, $1, s.id, …
  from fl_form_section s
 where s.template_id = $2 and s.is_active = 'true'
   and not exists (select 1 from fl_survey_section_instance i
                    where i.survey_id = $1 and i.source_section_id = s.id);

-- 2: questions, joined back through source_section_id
insert into fl_survey_question_instance (id, survey_id, section_instance_id, source_question_id, …)
select gen_random_uuid()::text, $1, i.id, q.id, …
  from fl_form_question q
  join fl_survey_section_instance i on i.source_section_id = q.section_id and i.survey_id = $1
 where q.template_id = $2 and q.is_active = 'true'
   and not exists (select 1 from fl_survey_question_instance x
                    where x.survey_id = $1 and x.source_question_id = q.id);
```

Two calls, ~390ms, any size of template, and re-runnable after a partial failure. **This is why
`source_section_id` and `source_question_id` are non-negotiable columns.**

**6.2 `capture` takes arrays, not one value.** A repeatable-section walk is ~40 rooms × ~5 questions. One
answer per request is ~1.1s each — the surveyor abandons the tool on the second floor, which v1.7 §A0 names as
the existential adoption risk. So `survey capture` accepts `entries[]`, `answers[]`, `observations[]` and
`verdicts[]` in one payload and writes each group as **one multi-row insert**
(`insert into … values ($1,$2,…),($9,$10,…),…`). A room with five answers, two photos and a condition score is
**one round trip**. This is a contract shape, which is why it is decided here and not during UI work.

**6.3 `walk` is one batched read.** The surveyor's screen needs the survey, its section instances, its question
instances, its entries, its answers, its observations and the current node — seven result sets, seven calls,
1.4s of pure overhead. Instead: one statement with `json_agg` / `row_to_json` subqueries aliased `_arr` /
`_obj`, which `row-map.ts` already unpacks into nested camelCase. One call, ~194ms. `survey get` (the desk
view) follows the same pattern.

---

## 7. THE API CONTRACT — frozen before any frontend work

Two functions. ARCHITECTURE.md §9 rule 4: *new module = new function; never widen an existing function for a
different module* — builds are per-function, and that is what keeps two people out of each other's files.
Neither folder exists yet beyond a `.gitkeep`.

Every handler: `{ ok: true, data }` or `{ ok: false, error }`. Every handler accepts the `payload` JSON-string
envelope **and** flat scalar fields (a connection action can only send flat). Parameter types may only be
`string` or `number`, so booleans travel as `"true"`/`"false"` and arrays travel inside `payload`.
`actorEmail` is on every mutation and is client-asserted (X8).

### 7.1 Function `form` — the builder

| Handler | Key parameters | Returns |
|---|---|---|
| `template-list` | `search`, `status`, `limit`, `offset` | Templates with derived `sectionCount`, `questionCount`, `usageCount` |
| `template-get` | `templateId` | Template + `sections[]` + nested `questions[]` — **one batched query** |
| `template-create` | `name`, `description`, `category` | New `draft`, `version_no = 1`, auto-creates a "General" section |
| `template-update` | `templateId`, `name`, `description`, `category` | Blocked once `published` — clone instead |
| `template-publish` | `templateId` | Guards: ≥1 active section, ≥1 active question, every `options` question has ≥2 options |
| `template-clone` | `templateId` | New `draft`, `parent_template_id` set, `version_no + 1`. The published row is never edited |
| `template-archive` | `templateId` | Removed from the picker; in-flight surveys unaffected (they hold snapshots) |
| `section-save` | `templateId`, `sectionId?`, `name`, `description`, `levelBinding`, `isRepeatable`, `repeatLabel`, `minRepeats`, `maxRepeats`, `createsPortfolioNode`, `nodeTypeCreated`, `applicabilityServiceIds[]` | Create or update in one handler |
| `section-delete` | `sectionId` | Soft-delete + cascade-deactivate its questions |
| `section-reorder` | `templateId`, `orderedIds[]` | **One `UPDATE … CASE` statement.** Never an array in a JSON blob — that loses a concurrent edit silently |
| `question-save` | `sectionId`, `questionId?`, `label`, `helpText`, `fieldType`, `options[]`, `allowMultiple`, `isRequired`, `feedsEstimation`, `estimationKey`, `unit` | Create or update |
| `question-delete` | `questionId` | Soft-delete |
| `question-reorder` | `sectionId`, `orderedIds[]` | As `section-reorder` |
| `reference` | — | Field types, level bindings, node types — so no caller hardcodes an enum |

Preview (§B1.5 #8) needs no handler: it is `template-get` rendered by the same component as the capture screen.

### 7.2 Function `survey` — the record, the walk, the handoff

**Desk — BD and lead**

| Handler | Key parameters | Notes |
|---|---|---|
| `create` | `dealId`, `scheduledStart?`, `scheduledEnd?`, `timezone?`, `templateId?`, `actorEmail` | v1.7 §A1.0: asks three things. `deal_id` is the only mandatory input. A date creates visit #1 and fires T1+T2 together; no date lands in `draft` (D-l) |
| `list` | `status`, `dealId`, `accountId`, `leadUserEmail`, `search`, `limit`, `offset` | One hardcoded default list — views are a platform item (§B4), not built here |
| `get` | `surveyId` | Survey + visits + assignees + counts + reconciliation summary — **one batched query** |
| `update` | `surveyId`, `title`, `targetCompletionDate`, `contractIntent`, `buildingsInScope[]`, `notes` | Status is rejected here — use `transition` |
| `schedule` | `surveyId`, `visitId?`, `scheduledStart`, `scheduledEnd`, `timezone`, `buildingsCovered[]`, `slotSource`, `slotGrantedBy`, contact + instruction fields | Schedule **and** reschedule. Always re-runs conflict-warn and always records old/new datetimes in the event's `meta_json` |
| `visit-transition` | `visitId`, `toStatus`, `reason` | `no_show` and `cancelled` require a reason. `no_show` does **not** advance the survey |
| `assign` | `surveyId`, `assignees[]` (`userEmail`, `participation`, `disciplineIds[]`) | Multi-select, one multi-row insert. Assignees optional |
| `set-lead` | `surveyId`, `assigneeId`, `reason` | Single-statement update of `fl_survey.lead_assignee_id` (X1) + a `lead_handover` event. Fires T3 |
| `remove-assignee` | `assigneeId`, `reason` | Soft-remove. **Captures stay attributed.** Cannot remove the lead without naming a replacement |
| `transition` | `surveyId`, `toStatus`, `reason`, `actorEmail` | T5–T8 through `domain/survey-state.ts`. Guards enforced here, not in the UI |
| `revise` | `surveyId`, `actorEmail` | T9 — a new linked survey, `revision_no + 1`, tree inherited. **`completed` is never reopened** |
| `section-instance-add` | `surveyId`, `name`, `isRepeatable`, `repeatLabel`, `levelBinding`, `createsPortfolioNode` | **Lead only, pre-`pending_review`.** Writes `added_ad_hoc = 'true'` |
| `question-instance-add` | `surveyId`, `sectionInstanceId`, `label`, `fieldType`, `options[]`, `isRequired`, `estimationKey` | Same. **These two are not optional extras:** D-S3 sanctions `template_id = null` start-from-scratch, and without them a template-less survey has an empty walk and no way to fill it. v1.7 §B6's last row gives the Lead exactly this `C U`. They live in `survey`, not `form`, because they write survey-scoped snapshot rows and must never touch a template |
| `node-import` | `surveyId`, `dealId`, `nodes[]` (`nodeType`, `parentRef`, `name`, `areaSqft`, `roomCount`, …), `provenance`, `sourceDocumentId` | **Seeds the prospect tree from the RFP's building list** — one multi-row insert, resolving `parentRef` to `parent_node_id` and writing `ancestry_path`. See §7.3 for why this is the handler that makes reconciliation real |

**Walk — the surveyor, the hot path**

| Handler | Key parameters | Notes |
|---|---|---|
| `walk` | `surveyId`, `visitId?` | **One batched read** (§6.3): sections, questions, entries, answers, observations, nodes |
| `capture` | `surveyId`, `visitId`, `entries[]`, `answers[]`, `observations[]`, `verdicts[]`, `actorEmail` | **The batch write** (§6.2). On the first capture it moves the **visit** `planned → in_progress` and stamps `actual_start_at`, *then* cascades the survey to `in_progress` — T4's guard is "first capture against a visit in `in_progress`", so the visit must move first or the guard can never be satisfied (X7). Returns the refreshed walk state so the client needs no second trip |
| `node-save` | `dealId`, `surveyId`, `nodeType`, `parentNodeId`, `name`, `areaSqft`, `floorCount`, `roomCount`, `restroomCount`, `floorLabel` | Inline node creation on the walk. Writes `ancestry_path` — **unit-test every create path** (§3.1 of v1.7) |
| `node-verdict` | `nodeId`, `verdict`, `verdictNote`, `visitId` | Note **mandatory** for `not_found`, `not_visited`, `changed` |
| `attach` | `surveyId`, `entityType`, `entityId`, `vibeFileId`, `fileName`, `contentType`, `sizeBytes`, `caption`, `kind`, `capturedAt`, `geo*` | Writes `fl_photo`. **Both** `captured_at` (device) and `uploaded_at` (server) — device clocks lie (F14) |

**Review and handoff — the lead, then Yameen**

| Handler | Key parameters | Notes |
|---|---|---|
| `reconcile` | `surveyId` | Generates items via `domain/reconcile.ts` and returns them. Deterministic; suggests only |
| `reconcile-decide` | `itemId`, `decision`, `manualValue`, `decisionNote`, `actorEmail` | **Lead only.** Every row decided by a person |
| `qualification-save` / `-delete` | `surveyId`, `qualificationId?`, `source`, `text`, `isPrintedOnProposal` | Auto-drafted at reconciliation, human-edited, human-approved |
| `recommendation-save` | `surveyId`, `prospectNodeId`, `title`, `description`, `recommendationType`, `urgency`, `suggestedServiceId`, `status` | |
| `submit` | `surveyId`, `actorEmail` | **T7.** Full guard set; freezes the revision with a checksum; notifies the deal owner. **Never advances the deal stage** (D-S15) |
| `handoff` | `surveyId` | The frozen payload, read-only: prospect tree + per-space condition + answers keyed by `estimation_key` + qualifications + `not_visited_pct`. **Cancelled surveys are excluded explicitly** (F8). **Yameen's lane starts here** |
| `reference` | — | Every enum: statuses, visit statuses, verdicts, diff types, contamination levels, frequencies |

### 7.3 What reconciliation can actually diff in P1 — read this before believing §A1.6

Reconciliation compares **what the RFP claimed** against **what the surveyor found**. That only works if
something put the RFP's claim in the database first. There is no RFP-parsing module in P1 and none is planned
here, so the honest position is:

- **`node-import` is in** (§7.2). The BD imports the tender's building/space list as an array — typed, not
  parsed — with `provenance = 'rfp'` and `source_document_id`. It is one multi-row insert and reuses
  `capture`'s batch shape, so it is close to free.
- **Automated extraction from an RFP document is out of P1.** A human transcribes or pastes the list. If
  nobody does, reconciliation still runs — it just has nothing on the RFP side.

**Which `diff_type` values are reachable in P1, stated plainly so nobody claims coverage we lack:**

| Reachable | Needs `node-import` to have run | Unreachable in P1 |
|---|---|---|
| `intra_survey_conflict` (F11) · `unanswered_required` | `node_not_found` · `node_added` · `count_mismatch` · `value_conflict` | `scope_vs_physical` — needs a priced scope document, which is Yameen's lane |

**And the consequence for T7:** its guard "every **seeded** node has a verdict" is *vacuously true* on a survey
where nothing was ever seeded. That is correct behaviour, not a hole — but `not_visited_pct` is then computed
over an empty set and must be published as `null`, not `0`. A zero would tell the estimator the whole site was
walked. `domain/survey-completeness.ts` owns that distinction and is unit-tested on it.

---

## 8. BUILD ORDER AND THE EXIT GATE

| # | Step | Depends on |
|---|---|---|
| 1 | **Sign off §3.** Write the 18 definitions into `scripts/db-import.mjs` | — |
| 2 | `node scripts/db-import.mjs` → `migrate.clean-seed` → `migrate.status` proves 18 tables exist | 1 — **the one-way door** |
| 3 | `shared/row-map.ts` `NUMERIC_COLUMNS` + the two sequences (§4). Agreed with the `shared/` owner | 2 |
| 4 | `domain/` — the five files in §5, with vitest green. **No handler before this** | — *(can run parallel to 1–3)* |
| 5 | Function `form`: template + section + question CRUD, reorder, publish | 2, 3 |
| 6 | Function `survey`: `create` / `list` / `get` / `schedule` / `assign` / `set-lead` | 3, 4 |
| 7 | **The snapshot** (§6.1) at T2 | 5, 6 |
| 8 | `walk` + `capture` — the batched pair (§6.2, §6.3) | 7 |
| 9 | Nodes, `node-import`, verdicts, observations, attachments, ad-hoc section/question instances | 8 |
| 10 | `reconcile` + `reconcile-decide` + qualifications | 9 |
| 11 | `submit` → freeze → `handoff` | 10 |

**Exit gate — the CLI walk, no UI:** create a template → add a repeatable "Room" section with three questions →
publish → create a survey on a real deal with a date → assign one person as lead → snapshot present →
`node-import` two buildings from the RFP list → capture three rooms in **one** `capture` call → verdict a node
→ reconcile → decide every item → submit → `handoff` returns a checksummed payload carrying
`estimation_key`-tagged values. Every step via `facilio vibe function run`. **Frontend work starts only after
this passes.**

> Note the wording: **tagged**, not **typed**. With four field types, square footage arrives as `value_text`.
> The gate becomes "typed" only if **D-k** lands — which is precisely the silent-corruption-into-pricing
> argument v1.7 §B1.3 makes. Do not write the stronger claim into a status update before the decision.

**Ownership** (split so two people never edit the same file):

| Owner | Owns |
|---|---|
| One | Function `form` + `modules/form.ts` + `modules/snapshot.ts` |
| The other | Function `survey` + `modules/survey.ts`, `modules/walk.ts`, `modules/reconcile.ts` |
| Agreed once, then frozen | `shared/`, `domain/`, `migrate`, and **`functions/survey/index.ts`'s handler signatures — written as stubs on day one, then only bodies change** |

---

## 9. LEDGER

**Closed by this plan:**
- **L11** (partial unique index for one-lead) — **closed: no indexes of any kind exist.** Resolved by design
  inversion X1, not by a DB feature.
- **L12** (a real sequence for `survey_number`) — **closed:** `fl_sequence` + `nextRef()` is a single
  `UPDATE … RETURNING`, therefore atomic. Format is `SUR-0042` (X2).

**Still open, and none of them blocks the import:**
- **L9** — mandatory enum/category list for the conversion screen. *Conversion is a separate spec anyway.*
- **L10** — Facilio Services read path and id shape. **Mitigation already in the schema:**
  `applicability_service_ids_json` and `suggested_service_id` ship nullable and are backfilled after G1.
- **L13** — does Facilio hold a trade/skill master on users? *Moot in P1 — `survey_discipline` is cut (X6).*
- **L14** — user module readiness: is the platform user list readable for the assignee picker? **This one has
  teeth.** `user_email` is text and never a foreign key, so the schema does not care — but the assignee picker
  has nothing to show until this is answered. Check the **grant**, not the record.

**Needs Sudharsan's call before §3 is signed off — the two that touch stored shape:**
- **D-e** (condition scale direction). It is a `fl_setting` value, so it is not a schema risk — but it feeds
  pricing, and two teams reading the same number opposite ways is real money. Decide it before capture ships.
- **D-p** (repeatable sections replace `level_binding`). The schema is a superset either way, so the import is
  safe — but the answer decides whether step 9's node work is a day of build or nearly free.

**Flagged for a decision that is not in v1.7 §10:** **X8** — permission keys cannot be enforced server-side on
this platform. v1.7 §B5 asserts they will be. Sudharsan should see that line before it reaches a customer.

---

## 10. WHAT THIS PLAN DOES NOT COVER

Not the prospect→Facilio **conversion** mechanics (C2/C3/C26 — separate spec) · not **estimation or pricing**
(Yameen's lane; this module ends at `handoff`) · not **automated RFP document extraction** (§7.3 — the tender's
building list is imported as typed data by a human, never parsed) · not the **clarifications** module
(deal-level) · not **offline** capture (the known two-day trap) · not **views, saved views or search**
(platform item C19 — one hardcoded list per surface here) · not the **user module** (read-only consumption,
D-n) · not any **frontend**.
