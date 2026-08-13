# Frontline — what we actually built

> An inventory, not a plan. `ARCHITECTURE.md` says what the app is *meant* to be; this file says
> what exists on disk and what has been proven to run, as of 14 Aug 2026. Check `git log` for the
> current state rather than trusting this file's date — an inventory goes stale the commit after it lands.
> Where the two disagree, §6 lists the disagreement rather than papering over it.

Three states, and nothing is allowed to blur between them:

| State | Means |
|---|---|
| **Built & verified** | Code exists, and something outside the code proves it — tests pass, or the function is uploaded and answered a real call |
| **Built, not verified** | Code exists and typechecks, but nothing has proven it against the platform |
| **Designed only** | Documents exist. Zero lines of code. |

---

## 1. The one-paragraph answer

We built the **Lead module** of a Facilio Vibe app — the pre-contract funnel from *enquiry arrives*
to *Account + Contact + Deal exist and are pushed into Facilio FSM* — and, since the last inventory,
the **first two slices of the survey lane**: a **form/template builder** (the `form` function, 15
handlers, live behind a working template-builder UI) and the **survey desk slice** (the `survey`
function, 7 handlers — create, schedule, transition, detail — live behind survey list/detail pages).
The backend is now **four functions**; the React console has **six feature modules**, rebuilt on
shadcn + Tailwind. The survey **walk** (on-site capture, assignment, reconciliation, submit) is
designed and seamed in the UI but has **no handlers**. Everything past the survey — quote, approval,
signing portal, work-order handoff — is still designed only, though the quote/rate-card tables are
drawn as CSVs and a tested pricing domain (515 lines) sits waiting with nothing serving it.

```
capture → AI analysis → dedup → queue → qualify → convert → outbox → Facilio FSM
└──────────────────── BUILT ────────────────────────────────────────────────┘
templates → survey create/schedule/desk → walk → reconcile → submit
└──────────── BUILT ────────────────────┘└── SEAMED, NO HANDLERS ──┘
                                    quote → approval → signature → work order
                                    └──────────── DESIGNED ONLY ───────────┘
```

---

## 2. Backend — built & verified

### 2.1 Four functions ship. Four directories are empty.

Everything that runs lives in four uploaded functions — all four confirmed **uploaded and built**
via `facilio vibe function list` on 14 Aug.

| Function | Handlers | Path |
|---|---|---|
| `lead` | **23** | `src/functions/lead/index.ts` (693 lines) |
| `form` | **15** | `src/functions/form/index.ts` (429 lines) |
| `survey` | **7** | `src/functions/survey/index.ts` (200 lines) |
| `migrate` | **4** | `src/functions/migrate/index.ts` (258 lines) |

The remaining four directories under `src/functions/` — `core`, `portal`, `quote`, `sync` — contain
a `.gitkeep` and nothing else. The old caveats stand: the intake handlers §7 assigns to a public
`portal` function live inside `lead` (§6.1), and the outbox handlers sit there too.

**⚠ The survey backend is uploaded but uncommitted.** `src/functions/survey/index.ts`,
`src/modules/survey.ts` and `src/modules/snapshot.ts` exist only in the working tree — the platform
is running code that `git log` does not show. Same for the survey frontend wiring. Commit it.

**`lead` — all 23 handlers, as registered in the file:**

| Group | Handlers |
|---|---|
| Capture | `create` |
| Read | `list`, `get`, `update`, `reference` |
| Workflow | `transition`, `claim`, `assign`, `log-activity` |
| AI | `analyse-input`, `analyse` |
| Conversion | `convert` |
| Accounts | `account-list`, `account-get` |
| Settings | `settings-get`, `settings-put` |
| Outbox | `sync-drain`, `sync-status`, `sync-retry` |
| Web-chat intake | `intake-start`, `intake-turn`, `intake-transcript`, `intake-submit` |

**`form` — 15 handlers**, built to the frozen contract in Survey Backend Plan v1 §7.1 (plus one
addition, `template-import`, which saves a whole template tree in one round trip — the builder saves
through it exclusively):

| Group | Handlers |
|---|---|
| Templates | `template-list`, `template-get`, `template-create`, `template-import`, `template-update`, `template-publish`, `template-clone`, `template-archive` |
| Sections | `section-save`, `section-delete`, `section-reorder` |
| Questions | `question-save`, `question-delete`, `question-reorder` |
| Enums | `reference` |

**`survey` — 7 handlers.** This is the **desk slice** of Backend Plan §7.2: `create`, `list`, `get`,
`schedule`, `transition`, `deal-list`, `reference`. Scheduling a draft survey fires the T2 template
snapshot (`src/modules/snapshot.ts` — two statements instead of N inserts, idempotent by
construction because there are no transactions and a half-finished snapshot must repair itself on
re-run). The walk slice — `walk`, `capture`, `assign`, `set-lead`, `node-verdict`, `reconcile`,
`reconcile-decide`, `submit`, `update`, `visit-transition` — is specced in the frontend's
`surveys-util.ts` wrapper table but **has no handlers yet**.

**`migrate` — 4 handlers:** `clean-seed`, `seed-config`, `status`, `verify`. Still deliberately
**not DDL**. Now also seeds the `survey` and `quote` number sequences (SUR/QTE) and knows the 18
survey-module tables as an import group.

### 2.2 The layers under the handlers

| Layer | Files | Lines | What it is |
|---|---|---|---|
| `src/modules/` | 10 | ~4,330 | The real work: `form` (1,063), `lead` (747), `survey` (644), `settings` (450), `analysis` (339), `intake` (303), `convert` (285), `account` (224), `sync` (214), `snapshot` (63) |
| `src/domain/` | 11 | ~1,900 | Pure logic, no IO — **this is the tested part**: `pricing` (515), `reconcile` (215), `survey-state` (192), `lead-state` (158), `survey-completeness` (158), `visit-state` (125), `normalize` (117), `sla` (111), `survey-revision` (111), `form-template` (106), `scoring` (91) |
| `src/shared/` | 7 | 865 | The kernel: `db`, `envelope`, `events`, `facilio`, `ids`, `outbox`, `row-map` |

The oddity worth knowing: **`src/domain/pricing.ts` is the largest domain file and nothing serves
it.** It landed with the rate-card tables (commit `5fe0c90`) and has its own 28-test file, but no
function exposes it — it is built & verified as logic, waiting for the quote lane.

### 2.3 Database — 38 CSVs on disk, 34 tables on the platform

`db/tables/` holds **38 CSVs**, and a CSV *is* the schema — `facilio vibe db import` infers columns
from it, because DDL is denied to the app role.

**Imported and live (verified via `facilio vibe db ls`, 14 Aug):** the original 16 lead-lane tables,
plus the 18-table survey group: `fl_form_template`, `fl_form_section`, `fl_form_question`,
`fl_survey`, `fl_survey_visit`, `fl_survey_assignee`, `fl_survey_visit_assignee`,
`fl_survey_section_instance`, `fl_survey_question_instance`, `fl_survey_section_entry`,
`fl_survey_answer`, `fl_survey_observation`, `fl_survey_recommendation`, `fl_survey_qualification`,
`fl_survey_reconciliation`, `fl_survey_revision`, `fl_prospect_node`, `fl_prospect_observation`.
The survey tables carry real rows — 3 surveys, 2 visits, snapshot copies of sections and questions —
so the desk slice has answered real calls, not just typechecked.

**Drawn but NOT imported:** `fl_quote`, `fl_quote_line`, `fl_rate_card`, `fl_rate_card_entry`.
The CSVs exist; the platform has no such tables. See §6.10.

`fl_schema_version` still **was never built** — no CSV, no reference anywhere in `src/`. See §6.4.
A leftover `_probe_types` table also sits on the platform.

### 2.4 The two agents

Unchanged: `agent-schemas/` holds `lead-intake.json` (`LeadIntake`) and `lead-analyst.json`
(`LeadAnalysis`). Both are called **from the client, never from a function** — a Vibe function
cannot wait for a model. That constraint shaped `analyse-input`/`analyse` and `intake-turn`, and it
will shape any survey-lane AI the specs promise.

### 2.5 What proves the backend works

- **`npm test` — 200 tests across 14 files, all passing** (verified 14 Aug; the last inventory said
  81/7). Twelve backend files — the five originals plus `form-template`, `pricing`, `reconcile`,
  `survey-completeness`, `survey-revision`, `survey-state`, `visit-state` — and two frontend units.
- **`npm run typecheck` now exists and passes clean** — the root `tsconfig.json` that §6.8 of the
  last inventory demanded was added, so the backend is finally typechecked. `typecheck:frontend`
  also passes.
- **`facilio vibe function list`** — `form`, `lead`, `migrate`, `survey` all report built (14 Aug).
- **`facilio vibe db ls`** — the survey tables exist *and hold working rows* written through the
  live handlers.
- **`scripts/walk.mjs`** — the end-to-end walk of the **lead lane only**: create → analyse → dedup →
  claim → qualify → convert → drain → confirm the Facilio client exists. **Nothing equivalent walks
  the survey lane** — its proof is currently "the UI wrote real rows", which is weaker.

### 2.6 Tooling that we also built

| Script | Does |
|---|---|
| `scripts/bundle.mjs` | esbuild pre-bundle — one file per function is all the platform accepts |
| `scripts/push.mjs` | uploads a function |
| `scripts/db-import.mjs` | **is the schema** — header row + one type-inference seed row per table |
| `scripts/walk.mjs` | the end-to-end proof above (lead lane only) |
| `scripts/build-frontend.mjs` | builds `dist/` |
| `scripts/gen-connection-actions.mjs` | registers handlers as Facilio connection actions — **DRAFT, unpublished, and hardcoded to `lead`**: no `form` or `survey` handler has an action |

---

## 3. Frontend — six modules, rebuilt on shadcn + Tailwind

`ARCHITECTURE.md` §11 still declares Stage 3 out of scope. It now has six feature modules.

React 19 + `react-router` 7 on **HashRouter** (unchanged reason: no rewrite rules on the static
host). Commit `a7639e3` **rebuilt the UI on shadcn and Tailwind CSS v4, dropping the DSM npm
dependency**: 19 shadcn primitives live in `frontend/src/components/ui/`, and the app-level kit in
`frontend/src/ui/` (11 components) became thin adapters over them. `@facilio/icons` survives
(`Icon.tsx`); `DSM-TOKENS.md` now documents a system the app no longer uses (§6.11). Identity moved
into the sidebar (`d48a7a4`).

The data layer grew a second dimension: `frontend/src/lib/request.ts` exposes
`requestFrom(function, handler, args)`, so each feature's api-util names its own function —
`FUNCTION = "lead"` in `vibe.ts` remains the default for the original four modules, while
`templates` calls `form` and `surveys` calls `survey`.

| Module | Surfaces | Data layer |
|---|---|---|
| **Leads** | `Inbox` (140), `LeadDetail` (368) + 7 components (now incl. `ActionDialogs`) | **LIVE** — no seam |
| **Accounts** | `AccountList` (148), `AccountDetail` (191) | **LIVE** — no seam |
| **Website chat** | `Playground` (143) + `WidgetPreview` — the intake conversation | intake **LIVE**; widget presentation config is a **SEAM** (localStorage, awaiting a `settings-widget` endpoint) |
| **Scope & SLA** | `Settings` (352) | **LIVE** — no seam |
| **Templates** | `TemplateList` (157), `TemplateBuilder` (726) + `FormRender` (328) | **LIVE** against `form` — builder saves through `template-import` |
| **Surveys** | `SurveyList` (164), `SurveyDetail` (553), `SurveyWalk` (86) + `NewSurveyDialog` (225), `SurveyChips` (85) | **desk slice LIVE** against `survey`; walk/capture/assign/reconcile/submit wrappers are **[SEAM]** — declared, uncalled, pages show real empty states |

The last inventory noted the repo had *no* seam markers anywhere. That era ended: `surveys-util.ts`
tags every not-yet-live wrapper `[SEAM]`, `SurveyWalk.tsx` renders without requesting, and the chat
widget config documents its localStorage seam in its header. The convention is being used as
designed — UI shipping ahead of the API, honestly labelled.

**Verified:** both typechecks pass clean. `dist/` is built (`app.js` 559 KB, `app.css` 75 KB) —
note `dist/` and the survey feature's wiring are **uncommitted** alongside the survey backend.

**Not built on the frontend:** the embeddable public widget (needs public app access, which is not
granted), and the survey walk UI beyond its placeholder page.

---

## 4. Designed only — zero code (and one lane in between)

**No longer in this section:** the form/template builder and the survey desk slice, which moved to
§2/§3 wholesale.

| Thing | Where it's specced | Code |
|---|---|---|
| **Survey walk slice** (on-site capture, assignment, prospect nodes, reconciliation decisions, submit) | Backend Plan §7.2 (next slice), wrapper contracts already written in `surveys-util.ts` | **tables imported, wrappers seamed, domain logic tested (`reconcile`, `survey-completeness`) — no handlers** |
| Quote | `ARCHITECTURE.md` §9 seam; rate-card CSVs drawn | pricing domain built & tested (515 lines); **no function, tables not imported** |
| Approval + customer signing portal | §9 seam (`portal` function + token pattern) | none |
| Work-order handoff | §9 seam (outbox action + `shared/facilio.ts`) | none |
| Tender ingestion | §9 seam (`lead.create` with `source='tender'`) | none |
| Email-to-lead | §9 seam (same) | none |
| Analytics + dashboards | §9 seam (read-only, derive at read time) | none |
| SLA alerting / automation | §9 seam (`*_due_at` + a scheduled job) | none — and impossible before production promotion |

The spec set grew and re-versioned: **`Survey Module Structure v1.8.md` (70 KB) supersedes v1.7**
(90 KB, still on disk), and the governing mother doc is now **v8.7, living in the oddly named
`Chat Builder's Club.md`** (58 KB) — it folds in the v8.6 amendment file, which also still sits on
disk. With the Backend Plan (39 KB) and the Terminology Audit (16 KB), that's ~280 KB of survey-lane
paper, of which two files are superseded. The audit's headline gap — the survey→deal handoff payload
is *not defined anywhere* — remains open: nothing built so far defines it either.

---

## 5. Deployment state

- App `frontline` exists at `https://frontline.vibe.facilio.com/`.
- Deployed to **preview only** — `https://preview-frontline.vibe.facilio.com/`.
- **No production promotion.** `facilio vibe deploy --prod` has not been run.
- **No public app access.** So: no widget, no scheduled jobs, no SLA alerting, no polling.
- The Facilio connection actions are **DRAFT and cover `lead` only** — the generator script
  hardcodes it, so the 22 `form`/`survey` handlers have no actions at all.
- **Four** leftover probe functions sit on the platform, all safe to delete: `tenderprobe`,
  `dbprobe`, `dmlprobe`, `secretprobe` — plus the `_probe_types` table.

Function and table state above was re-verified against the live platform on 14 Aug (`function list`,
`db ls`); the deploy/promotion claims are from the repo's own records and were not re-run.

---

## 6. Where the docs and the code disagree

Found while compiling this inventory. Each is a real drift, not a nitpick — someone building against
the docs would hit every one of them.

**The pattern has changed.** Last time, `API.md` mostly kept up while `ARCHITECTURE.md` §7 lagged.
This time **both** fell behind: the entire survey lane landed without either doc noticing.

1. **`intake-*` is not in a `portal` function.** §7 puts the intake handlers in a public `portal`
   function; they are registered inside `lead/index.ts`. §7 lists `intake-attach`, which **does not
   exist**; the code has `intake-transcript`, which is in neither doc. All four `intake-*` handlers
   are absent from `API.md`.
2. **`sync-drain` / `sync-status` / `sync-retry` are in `lead`, not a `sync` function.** Documented
   in `API.md` (§Outbox); §7's table omits all three. `src/functions/sync/` is empty.
3. **`migrate` has different handlers than specced.** §7 says `up` and `status`. The code has
   `clean-seed`, `seed-config`, `status`, `verify` — and explicitly avoids DDL, because the role
   cannot execute it.
4. **`fl_schema_version` doesn't exist.** §5 "Built now" lists it; there is no CSV and no code
   reference.
5. **`analyse-input` remains undocumented** — absent from both §7 and `API.md`.
6. **`ARCHITECTURE.md` §13 is two functions behind.** It records `lead` and `migrate` as uploaded
   with "the other five directories still empty" — `form` and `survey` are uploaded and built, and
   only four directories are empty. §2 line 34 still claims survey is "designed but NOT built"
   **"and the entire UI"** doesn't exist; six modules of UI are live.
7. **`API.md` documents neither `form` (15 handlers) nor `survey` (7 handlers).** It also still says
   "51 unit tests" where there are 200. The best handler-level contract for the new lane is
   currently the *frontend* — the wrapper tables in `templates-util.ts` and `surveys-util.ts`.
8. **§11 says the frontend is out of scope.** Six feature modules are built; four are fully live.
9. **§12 says tests cover `src/domain` only.** 14 files, 200 tests, including two frontend units.
10. **Four CSVs have no table behind them.** `fl_quote`, `fl_quote_line`, `fl_rate_card`,
    `fl_rate_card_entry` exist in `db/tables/` but were never imported — the first time the
    "CSV *is* the schema" convention has drifted from the platform. Import them when the quote lane
    starts, or a `db-import` run today would create them half-orphaned.
11. **`DSM-TOKENS.md` describes a dropped system.** The UI is shadcn + Tailwind since `a7639e3`;
    the DSM npm dependency is gone. Only `@facilio/icons` remains of the old stack.
12. **The survey lane's running code is uncommitted.** The platform serves handlers that exist in
    no commit (`survey` function, `survey`/`snapshot` modules, the survey UI wiring, `dist/`).
    Not a doc drift — a repo-hygiene hazard: a hard reset loses a deployed backend.

**Fixed since the last inventory:** the one genuine bug it recorded — `npm run typecheck` failing
for want of a root `tsconfig.json` — is resolved; both halves now typecheck clean.

---

## 7. Reading order, if you're new to this

1. `ARCHITECTURE.md` §1–§3a — scope, ownership boundary, and the platform constraints that shaped
   every decision (all verified, not assumed). Read §7/§13 with §6 above open beside it.
2. `API.md` — the handler contract **for the lead lane only**; for `form`/`survey`, read the wrapper
   tables in `frontend/src/features/{templates,surveys}/api/*-util.ts` instead.
3. `src/domain/` + `tests/` — the logic that actually matters, provable on a laptop.
4. The survey lane is live paper now: **`Survey Module Structure v1.8.md`** (not v1.7) and
   `Survey Backend Plan v1.md` §7 for the slice boundaries; `Chat Builder's Club.md` is the v8.7
   mother doc that governs both.
5. `DSM-TOKENS.md` — historical only; the working styling system is shadcn + Tailwind
   (`frontend/src/components/ui/` + `frontend/src/ui/` adapters).
