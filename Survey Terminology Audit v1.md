<!--
  SURVEY LANE — TERMINOLOGY AUDIT v1
  Author: Claude (with Yameen) · 13 Aug 2026
  Audited: "Claude v8.6 Amendment Survey Scope.md" + "Survey Module Structure v1.7.md"
  Against: this repo as it actually stands — db/tables/*.csv, src/, frontend/src/, ARCHITECTURE.md, API.md.
  Excluded: llm.md (Facilio platform vendor docs, stale per ARCHITECTURE.md §3) and node_modules.
  Every line reference below is to the file named in its heading. Nothing was changed by this pass.
-->

# Survey lane — terminology audit v1

**Bottom line: nothing in the code needs renaming, because the survey lane has no code yet.**
`src/functions/survey/` is an empty `.gitkeep`, there is no `fl_survey*` table in `db/tables/`, and
`frontend/src/layout/sidebar/nav-config.ts` registers no survey route. So this is not a rename pass —
it is a **list of names to settle before the first `facilio vibe db import`**, which matters because
ARCHITECTURE.md §3a rule 2 says a table's shape is permanent: no `ALTER`, no re-import, no drop.

The amendment and v1.7 **agree with each other** on every substantive point (§5 below). The mismatches
are (a) spec-vs-house-convention naming, (b) spec types that the Vibe app DB cannot express, and
(c) stale terms left inside v1.7 by its own v1.3/v1.4/v1.5 renames.

---

## 1. The one gap that matters most: the handoff payload is not defined anywhere

v1.7 is declared the source of truth for the survey lane, and it references **"the §5 handoff payload"**
twice — line 508 (`survey_revision.snapshot_json` — *"the whole §5 handoff payload"*) and line 1061
(§11 boundary guard — *"module ends at the §5 handoff payload"*).

**There is no §5 in v1.7.** The v1.2 restructure renumbered everything to A0–A5 / B0–B6, and old §5
became **A2 (Assignment)**. So both references resolve to the wrong section, and **no section of v1.7
specifies the payload at all.**

The only enumeration of its contents anywhere is the amendment, §5 point 2: prospect tree · per-space
condition · answers tagged with `estimation_key` · qualifications · `not_visited_pct`.

That is the exact artifact the estimation lane consumes. It is currently a cross-reference to nothing.
**Fix: give it a real section (`A6. THE HANDOFF PAYLOAD`) and repoint lines 508 and 1061 at it.**

---

## 2. Spec names vs this repo's live convention

| # | v1.7 says | This repo does | Consequence |
|---|---|---|---|
| **N1** | 20+ tables with no prefix: `survey`, `survey_visit`, `prospect_portfolio_node`, `form_section`… (line 248) | Every live table is `fl_*` — `fl_lead`, `fl_deal`, `fl_account`, `fl_event`, `fl_photo`, `fl_sequence`, 16 in all | ARCHITECTURE.md §9 already writes the seam as **`fl_survey.deal_id → fl_deal`**. Pick one before import; `fl_` is the shipped convention and the seam doc already assumes it |
| **N2** | *"Every table carries `id BIGSERIAL`"* (line 122) | Identity is `gen_random_uuid()` stored as **text** — ARCHITECTURE.md §3a rule 8: *"No serial columns"* | `BIGSERIAL` is not obtainable. Wording must change or someone will try |
| **N3** | Omitted-everywhere block is `id`, `org_id`, `created_by/at`, `updated_by/at`, `is_active` (lines 122–126) | Every CSV header starts `id,data_json,created_at,updated_at,…` — **`data_json` appears nowhere in v1.7** | ARCHITECTURE.md §3a rule 3 calls `data_json` **"mandatory, not a convenience"** — it is the only way to add a field later without a new table. A survey table imported without it is frozen forever |
| **N4** | `org_id` *"non-negotiable on every query and every action"* (line 123) | No live table has `org_id`; tenancy is at the **schema** level (`vibe_df9b21f7…` → `schema_2944_vibe_…`) | **Already satisfied differently, not missing.** Do not add the column — it would be dead weight that cannot be dropped |
| **N5** | `survey_attachment` (line 504) — `vibe_file_id`, `kind`, `caption`, `geo_*`, `captured_at` + `uploaded_at` | `fl_photo` already exists doing this job: `entity_type,entity_id,vibe_file_id,file_name,content_type,size_bytes,caption` | Same job, two names. `fl_photo` has no `kind`, no `geo_*`, no `captured_at`/`uploaded_at` and **cannot gain them** — but it has `data_json`, so they can ride there. Decide by what you filter or sort on |
| **N6** | `survey_status_log` (line 509) — `entity_type`, `entity_id`, `from_status`, `to_status`, `reason`, `actor_user_id`, `occurred_at`, `context_json` | `fl_event` already exists: `entity_type,entity_id,kind,actor,body,meta_json,occurred_at` | Near-identical. `context_json` = `meta_json`, `actor_user_id` = `actor`. `from_status`/`to_status`/`reason` are not typed columns there — `data_json`/`meta_json` or a new `fl_survey_status_log` |
| **N7** | `survey_module_settings` — an org singleton with ~20 typed columns (§B2) | `fl_setting` is **key/value**: `key,value_json` | The house pattern is key/value. A wide singleton is a second settings mechanism in one app |
| **N8** | Person fields are FKs into a user module: `user_id`, `created_by`, `verdict_by`, `submitted_by`, `actor_user_id` | Live tables use **email strings** — `owner_email`, `sales_owner_email`, `fl_event.actor` | ARCHITECTURE.md §3 constraint 4 / §10: functions get **no caller identity**; actor is client-asserted. L14 (is the platform user list readable?) is still open, so the FK has no confirmed target |
| **N9** | D-S15 — notify the deal owner, BD moves the stage manually | `fl_deal.stage` = `open → surveying → quoted → won \| lost` | Consistent in principle, but **neither doc names which stage the BD moves to.** It cannot be `quoted` — completion hands off to estimation and the quote comes after (§11). The notify payload has to name a value in `fl_deal.stage`'s own vocabulary; which one is an open question for the deal lane |
| **N10** | Assets removed from the lane entirely (S1–S3) | `fl_lead` carries a live column **`facilio_asset_id`** | Harmless — it is a Facilio link on a *lead*, not a survey asset — and it cannot be renamed. Worth one line in the doc so nobody reads it as a surviving asset level |
| **N11** | Hierarchy is **site → building → space**; floors are `floor_count` + `floor_label` (S4, lines 413–418, 438) | ARCHITECTURE.md line 51 lists *"Sites / buildings / floors / spaces"* as Facilio FSM's concern | Not wrong — Facilio's own hierarchy does have floors — but sitting one line above `Assets, work orders` it reads as contradicting S4 exactly where the Won conversion gets built. Add the distinction |

---

## 3. Separate from terminology: three spec mechanisms the Vibe app DB cannot provide

Not naming issues, but they are stated as binding in v1.7 and they are unavailable. All three are
verified in ARCHITECTURE.md §3/§3a, probed against org #2944 — not assumed.

**T1 — The type vocabulary does not exist.** v1.7 uses `timestamptz` (lines 358–359), `jsonb`
(11 fields: lines 331, 335, 361, 371, 577, 590, 754, 787, 880, 881, 888), `enum`, `int`, `bool`, `FK`.
CSV import infers **`numeric` for numbers and `text` for everything else** — no booleans, no timestamps,
no jsonb, no enums, no FKs, no `NOT NULL`, no defaults (§3a rule 5–6). So: every `jsonb` is text-JSON,
every timestamp is an **ISO 8601 UTC string** (sorts correctly, verified), every enum is app-level, and
`numeric`/`bigint`/`count(*)` come back as **JavaScript strings** — coerced in one place, `shared/db.ts`.

**T2 — L11 is answerable today, and the answer is no.** v1.7 line 578 says to enforce the one-lead rule
with `CREATE UNIQUE INDEX ON survey_assignee (survey_id) WHERE is_lead = true AND is_active`.
ARCHITECTURE.md §3a: **`CREATE INDEX` → *must be owner of table***, and no indexes of any kind are
possible. There are also no transactions (§3 constraint 2). The house mechanism for exactly this problem
is the single-statement, atomic **`INSERT … SELECT … WHERE NOT EXISTS`** (§3a rule 5) — which is what the
lead-dedup keys already use. **L11 closes: no partial unique index; use the single-statement pattern.**

**T3 — L12 is answerable today too.** v1.7 line 324 / §B2 line 876 require `survey_number` from a
*"DB sequence, never `count+1`"*. Correct instinct — but no DDL means no sequence either (§3a rule 8:
*"No serial columns"*). The shipped mechanism is **`fl_sequence` + atomic `UPDATE … RETURNING`**, already
built and seeded (`db/tables/fl_sequence.csv`: `name,current_value`). **L12 closes: `SUR-00042` comes
from `fl_sequence`, not a Postgres sequence.** The spec's intent survives; the named mechanism doesn't.

Two of the four new ledger items therefore do not need the G1 pass. L13 (trade/skill master on users)
and L14 (user module readability) remain genuinely open.

---

## 4. Stale terminology inside v1.7 itself

Each of these is v1.7 disagreeing with v1.7 — a term its own later revision replaced. Line numbers are
for a fix pass.

| # | Line | Stale term | Should be |
|---|---|---|---|
| **I1** | 248, 996 | **`survey_template_question`** — in the canonical 20-table list *and* the §B6 CRUD matrix | Renamed **`form_question`** at v1.3 (line 779) |
| **I2** | 246–252 | The table list omits **`form_section`**, **`survey_section_instance`**, **`survey_section_entry`**, **`survey_template_category`** | The list is internally consistent at 20 but predates the v1.3 rename and the v1.7 additions. Real count is **22–24** depending on D-j (`survey_discipline` cut) and whether the category lookup counts. State it conditionally |
| **I3** | 996–997 | §B6 (setup) CRUD matrix has no row for **`form_section`** or **`survey_section_instance`** | Add both. `survey_question_instance` is already there (line 997), so that is the precedent to follow |
| **I3b** | 646–660 | §A4 (product) CRUD matrix has **no row for `survey_section_entry`** — the one table the surveyor writes to on every walk (line 818 tags it *runtime*; line 828 says a mis-added room is deactivated) | It belongs in A4 beside `survey_answer`, not in B6. As it stands, *"who can soft-delete a mis-added room"* is unanswered in either matrix |
| **I4** | 535 | T2's guard: *"≥1 visit with a **`survey_date`**"* | `survey_date` was replaced by **`scheduled_start`/`scheduled_end`** at v1.4 (line 358). The guard should read `scheduled_end > scheduled_start`, matching §A1.2b line 383 |
| **I5** | 534 | T1's side effect: *"**staged** site resolved if available"* | **`prospect`** — `staged_node` → `prospect_portfolio_node` at v1.5 (line 410). The field is `prospect_site_id` |
| **I6** | 504 | `survey_attachment.kind` still offers **`nameplate_photo`** | Nameplate capture went out with the asset level (v1.5 line 60, amendment **S3**). Drop the value |
| **I7** | 756 | `repeat_label` examples include **`Floor`** — and with `creates_portfolio_node = true` each entry becomes a **`space`** node | This quietly reintroduces the level cut at v1.5: a repeat labelled "Floor" creates a space called "Floor 2". Either drop `Floor` from the examples or say explicitly that a floor-labelled repeat is a space, not a level |
| **I8** | 1006–1007 | §9 **F2**'s fix column still prescribes *"`group_label` as a plain string, **not** a section entity"* and single-level follow-ups; **F3** puts `applicability_*` *"on the question"* | Both were overruled at v1.3 — sections are a real entity (line 717), applicability moved **up to the section** (line 754). F2/F3's fixes are now the opposite of what got decided. Mark them superseded rather than leaving prescriptions that contradict §B1 |
| **I9** | 1045, 1051 | **D-g** and **D-m** are the same decision (conditional follow-ups in P1) with **opposite recommendations** — D-g says *"Yes, single level"*, D-m says *"Now: No"* | D-m supersedes D-g but D-g still reads Yes. Strike D-g's recommendation. Also §10's rows run a,b,…,i, **p**, k, l, m, n, o, j — out of order |
| **I10** | 356 vs 877 | `visit_number` is exemplified as **`SUR-00042/V2`**, but §B2 defines `visit_number_prefix` default **`VIS-`** | Two schemes for one field. Pick the composite or the prefix |
| **I11** | 335, 577, 590 | `disciplines_required` / `discipline_ids` are `jsonb (multi FK)` into `survey_discipline` | §B3 + D-j recommend **cutting that table**. If it goes, these become free-text chips — the type changes, not just the table |
| **I12** | 279 vs 630, 633, 981 | Persona codes collide: **U4** is *Surveyor/assignee* (630), *Tenderer* (633 as `U4-ext`, 981 as plain `U4`); the surveyor is **U3** in A0 (279) | One code, three referents. Renumber once |
| **I13** | 439 | *"L1 resolved"* | This doc's ledger carries **L9–L14** only. L1 is untraceable from here |
| **I14** | 872–978 | §B2–§B5 are `###` headings nested under `## B1`, while B0/B1/B6 are `##`; §9–§12 keep flat old numbering after the A/B restructure | Cosmetic, but it makes B2–B5 read as sub-parts of the template module |

---

## 5. Amendment ↔ v1.7: do they agree?

**Yes, on everything substantive.** Verified line by line:

- **S1–S7** all match v1.7 (assets out, spaces carry condition/contamination, nameplate AI gone,
  site → building → space with `floor_count`/`floor_label`, ancestry rule still binding to space depth,
  C15 out, C13 intake-only).
- **Four field types** (`short_text`, `long_text`, `options`, `attachment`) — amendment §2 = v1.7 line 786. ✓
- **D-S13** — assignees optional, exactly one lead mandatory = T3's whole guard (line 536). ✓
- **§3 count** — "Sixteen, D-a..D-p" = 16 rows in §10. ✓
- **C19 / views** as a platform item = §B4. ✓
- **L11–L14** = v1.7 §12. ✓

Two exceptions, both small:

- **D-o has been actioned rather than answered** — it asked *"who fixes the mother-doc items?"* and the
  answer was *"log a CLAUDE.md v8.6 line."* That line **is** the amendment. What remains outstanding on
  D-o is approval, not a decision (the amendment's own header: *"NOT YET FOLDED IN… until Sudharsan
  approves"*), so it should read differently from the fifteen that are still genuinely open choices.
- **v1.7's header still points up at the stale doc.** Line 5: *"Governed by: claude/CLAUDE.md (mother doc
  v8.5)"* — the exact file the amendment supersedes. Re-point it at v8.6 when the amendment folds in,
  or the source-of-truth chain is circular.

**One practical problem with §6 (how to fold this in): there is no CLAUDE.md in this repo.** `find` turns
up only the amendment itself. Both docs also sit at the repo root under different names than they claim —
`Survey Module Structure v1.7.md` vs the canonical `claude/survey-module-structure-v1.7.md`, and
`Claude v8.6 Amendment Survey Scope.md` vs `claude/CLAUDE-v8.6-amendment-survey-scope.md`. The mother doc
lives in Sudharsan's project, not here, so §6's snapshot-and-apply steps cannot be executed from this repo,
and §5's *"read v1.7, not CLAUDE.md §3"* points at a file this repo does not hold.

---

## 6. Fix list, in the order I would do it

1. **Give the handoff payload a real section** and repoint lines 508 and 1061 (§1 above). It is the
   estimation lane's contract and it currently resolves to Assignment.
2. **Settle the table prefix** — `fl_survey*` or bare — and **add `data_json` to every table in the spec**.
   Both are irreversible after the first import (N1, N3).
3. **Rewrite the conventions block at lines 122–126**: `gen_random_uuid()` text id, ISO-8601 UTC strings,
   text-JSON, no `org_id`, no FKs, no enums (N2, N4, T1).
4. **Close L11 and L12 in the ledger** with the verified answers — single-statement `INSERT … WHERE NOT
   EXISTS` for the one-lead rule, `fl_sequence` for `survey_number` (T2, T3).
5. **Resolve the four collisions with tables that already exist**: `survey_attachment`/`fl_photo`,
   `survey_status_log`/`fl_event`, `survey_module_settings`/`fl_setting`, person-FK/email-actor (N5–N8).
6. **Sweep I1–I11** — a search-and-replace pass, ~20 minutes, with I4, I6 and I7 the ones that would
   otherwise get built as written.
7. **Renumber personas (I12)** and strike D-g's recommendation (I9) before anyone quotes either.
8. Cosmetics: I13, I14.

Items 1–5 are decisions. 6–8 are edits.
