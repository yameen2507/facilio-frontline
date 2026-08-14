<!--
  CLAUDE.md AMENDMENT — v8.6 · SURVEY LANE SCOPE
  Canonical name: claude/CLAUDE-v8.6-amendment-survey-scope.md (Vibethon project)
  Author: Claude (with Sudharsan) · 13 Aug 2026, event day 1
  STATUS: AMENDMENT, NOT YET FOLDED IN. claude/CLAUDE.md is still at v8.5 and is STALE on the points below.
  Read this file ALONGSIDE CLAUDE.md until Sudharsan approves folding it in.
  WHY A SEPARATE FILE: CLAUDE.md's own versioning rule (header) requires a frozen snapshot before any change
  to §1-§3. This is a §3 change. Rather than edit the team's governing file unilaterally mid-event, the
  supersessions are stated here for approval first.
-->

# CLAUDE.md v8.6 — Survey Lane Scope Amendment

**Short answer to "can I use the current CLAUDE.md?": No, not for handing to Yameen or Mithun as-is.**
It is accurate on everything except the survey lane, where seven things decided on 13 Aug now contradict it.
The dangerous one is that **§3 still promises assets**, and Yameen's estimation lane reads §3.

Source of truth for the survey lane is now **`claude/survey-module-structure-v1.7.md`**.
`claude/survey-module-flow-v3.md` remains valid for the decision record (D-S1..S15) but is superseded on
structure, hierarchy and assignment.

---

## 1. SUPERSESSIONS — what in v8.5 is no longer true

| # | CLAUDE.md v8.5 says | Now | Why |
|---|---|---|---|
| **S1** | §3 headline: *"the surveyor's walk becomes the asset register, and the asset register becomes the price."* | **"The surveyor's walk becomes the priced scope."** | Assets removed. **This sentence is in the pitch — it must be rewritten before anyone says it to a judge.** |
| **S2** | §3: *"one line per physical asset with photos, condition (1–5), contamination"* | **One line per SPACE.** Condition and contamination attach to spaces | Soft-services scope cut, 13 Aug |
| **S3** | §3: *"AI touches only at capture (nameplate photo → asset type…)"* | **Nameplate AI removed** with the asset level. Remaining AI assist: none in P1 | Nothing to identify |
| **S4** | §3 / §8: *"staged portfolio"*, hierarchy *"site → building → floor → space → asset"* | **"Prospect portfolio"**, hierarchy **site → building → space**. Floors are a `floor_count` number + optional `floor_label`, not a level | Renamed and cut, 13 Aug. Evidence: the production walkthrough reference stores floors as a number, never as a hierarchy level [M] |
| **S5** | §3.1 ancestry rule: *"asset = space + identifiedLocation + buildingSpace + currentSpaceId"* | **Still binding, but the deepest record is now a SPACE.** The rule and its unit tests apply to site→building→space | No asset writes at Won |
| **S6** | §8 **C15** — survey building profile (new/old, BMS/IoT, subcontracted assets, critical assets: FCU/chillers/lifts) — tagged **IN EVENT BUILD** | **OUT of the event build. Hard FM. → register-only, post-event** | Every field in C15 is a hard-FM field |
| **S7** | §8 **C13** — tender-motion intake — tagged **IN EVENT BUILD** | **Survives as INTAKE ONLY** (tender source tag, tenderer contact, submission deadline, clarifications). The tender's per-building asset schedules now have nothing to land on | Assets removed |

**Also worth a line, not a supersession:** §8 **C19** (search / list views) is confirmed as a **platform item
built once across leads, accounts, deals, quotes, contracts and surveys** — not per module. The survey module
ships one hardcoded default list per surface in P1 and registers its filterable fields for the platform layer.

---

## 2. SURVEY-LANE DECISIONS THAT MOVED SINCE v3 (D-S1..S15 remain the record; these amend three of them)

| v3 decision | Amendment |
|---|---|
| **D-S3** — template = questions + level binding | The builder is now a **generic platform form builder**: template → **sections** (real entity, add/rename/delete/reorder) → questions, **four field types only** (`short_text`, `long_text`, `options`, `attachment`). Sections carry `level_binding` and service applicability, not questions. **Sections can be marked repeatable** (the snagging pattern) — "+ Add another Room" |
| **D-S12** — survey ↔ visit split | Unchanged in principle. Visit scheduling moves to **appointment semantics**: `scheduled_start` / `scheduled_end` timestamps replace date + start/end time |
| **D-S13** — assignees (plural) + exactly one lead | **Assignees are OPTIONAL. Exactly one LEAD is mandatory** — that is the whole T3 guard. Discipline coverage is a warning, not a guard, which removes the only justification for a `survey_discipline` table in P1 |

**Unchanged and not to be re-litigated:** D-S1 (staged/prospect until Won), D-S2 (person decides every diff),
D-S4 (conflict-warn only), D-S5 (7-state lifecycle), D-S11 (survey-optional path), D-S14 (Completed is
terminal; rework loop with mandatory reason), D-S15 (**manual** deal advance — notify only).

---

## 3. OPEN DECISIONS AWAITING SUDHARSAN (full text in structure v1.7 §10)

Sixteen, D-a..D-p. The four that change what gets built:

- **D-p** — do repeatable sections **replace `level_binding`**, with each entry creating a `space` node? If yes, **the separate portfolio tree-building screen disappears from P1.** Largest scope cut available.
- **D-e** — condition scale direction: is 1 worst or best? **Feeds pricing.** Cleaning reads 5 as filthy, FM reads 5 as excellent.
- **D-k** — add `number` (+ `unit`) as a fifth field type, so square footage does not reach Yameen's estimator as a string.
- **D-n** — build the user module (C24) in P1, or read the platform user list into the assignee picker? *(Recommendation: read.)*

---

## 4. LEDGER ADDITIONS (v3 carried L9, L10 — still open)

| # | Item | Resolve at |
|---|---|---|
| **L11** | Does the Vibe app DB support a **partial unique index** (`WHERE is_lead = true`)? If not, the one-lead constraint needs a trigger or a serialised function | G1, before the assignee table |
| **L12** | Confirm a real **DB sequence** for `survey_number` — not an app-level `count + 1` (two phones will collide) | G1 |
| **L13** | Does Facilio already hold a **trade / skill master on users**? If yes, link rather than build (read, never copy, §4) | G1 |
| **L14** | **User module (C24) readiness** — is the platform user list readable for the assignee picker, and can permission keys be registered per module? | G1 |

---

## 5. WHAT TO TELL YAMEEN AND MITHUN

Three sentences, so nobody builds against the stale file:

1. **The survey lane is soft services only.** No assets, no floors as a level, no building profile. Site →
   building → space.
2. **The module boundary is unchanged**: survey ends at submit with a frozen handoff payload — prospect tree,
   per-space condition, answers tagged with `estimation_key`, qualifications, and `not_visited_pct`.
   Estimation and pricing remain entirely Yameen's.
3. **Read `survey-module-structure-v1.7.md`, not CLAUDE.md §3**, for anything in the survey lane until this
   amendment is folded in.

---

## 6. HOW TO FOLD THIS IN (when Sudharsan says go)

1. Snapshot the current file → `claude/CLAUDE-v8.5-snapshot-13Aug2026.md` (required by CLAUDE.md's own header
   rule before any §1–§3 change; the snapshot is immutable).
2. Apply S1–S7 to §3 and §8 in `claude/CLAUDE.md`, re-tag C13 and C15, add L11–L14.
3. Point §3 at `claude/survey-module-structure-v1.7.md` as the survey lane's source of truth.
4. Add the v8.6 changelog line to the header.
5. Delete this amendment file — it exists only to avoid editing the team's governing doc without approval.
