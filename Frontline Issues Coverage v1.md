# Frontline Issues Coverage v1

Cross-reference of **Frontline Issues and Decisions v1.xlsx** (103 issues, 14 Aug 2026)
against **this repository** as it stands today (working tree, branch `main`, HEAD `c1dafdc`).

## How to read this

The audit was run against the *deployed preview app* (`preview-frontline.vibe.facilio.com`),
not against this repo. So coverage here means "the code that would fix it exists", not
"verified in the running app". Five buckets:

| Bucket | Meaning |
| --- | --- |
| ✅ **Covered** | Code exists and matches the Decision (or Suggested fix where no decision). |
| 🟡 **Partial** | Half the fix landed — schema without surface, surface without schema, or built to the superseded spec. |
| ❌ **Not covered** | Nothing in the repo addresses it. |
| 🔍 **Not verifiable** | Runtime/visual defect. Needs the running app, not a file read. |
| ⏸ **Correctly absent** | Deliberately out of scope by the 14 Aug ruling. Building it would be scope creep. |

**Where Decision contradicts Suggested fix, Decision wins.** The eight reversed items
(D-02, D-05, D-10, D-15, F-02, F-03, D-22, P-06) are judged against the Decision column.

---

## Headline

| Bucket | Count |
| --- | --- |
| ✅ Covered | 13 |
| 🟡 Partial | 34 |
| ❌ Not covered | 35 |
| 🔍 Not verifiable from code | 15 |
| ⏸ Correctly absent | 6 |
| **Total** | **103** |

Read that as: **47 of 103 have been at least started**, 35 have not been touched, 15 cannot be
judged without the running app, and 6 are correctly out of scope. The
partial column is the honest headline — most of the work that landed since 14 Aug landed as
schema and domain logic, and stopped short of the form or the list that a user actually sees.

**The three that blocked the thesis:**

- **F-01 — a survey cannot be submitted → ✅ FIXED.** `Send for review` (T5) and
  `Complete survey` (T7) now exist on `SurveyDetail.tsx:192-207`, wired to
  `transitionSurvey` with the count guards and the revision freeze.
- **F-02 — no numeric answer type → 🟡 HALF.** `number` type and a fixed unit list shipped
  (`src/domain/form-template.ts:35,52`). The ruling's *auto-generated key behind an
  Advanced toggle* did not — the estimation key is still a free-text box the author types.
- **F-03 — spaces with no site → ✅ FIXED.** Site is required on create
  (`siteSelectionBlocker`, `src/domain/survey-state.ts:209`), building stays optional, and
  `fl_prospect_node` carries `parent_node_id` + `ancestry_path`.

**The four scheduled "Now — before demo"** (read off the Schedule column, not inferred):
**F-01 ✅, P-05 ✅, D-04 🟡, D-19 ❌.**
**D-19 is the one still exactly as the audit found it** — and it was the one raised to P0.

*One naming trap:* `F-01` appears in both sheets with different meanings. On the Issues sheet
(the work list, per the README) it is *"a survey cannot be submitted"*; on the Decisions sheet
it is *"notes and voice capture during the walk"*. This file grades the Issues-sheet meaning
under F-01, and the notes ruling under **F-21**, where the workbook itself puts it.

**What shipped that the audit did not know about:** the Deals module (F-14), the Portfolio /
prospect tree with RFP paste and Convert-to-Facilio (F-16, D-38, P-09), Proposals + rate
cards, the Users/Roles/Permissions settings surface, and the whole UI rebuilt on
Tailwind + shadcn (which quietly settles N-04 and X-01).

---

## P0 — 13 items

| ID | Bucket | Title | Evidence / note |
| --- | --- | --- | --- |
| D-04 | 🟡 | Service, City, Region free text | Coverage catalogue exists (`fl_service_line`, `fl_service_area`, `fl_service_coverage`, `settings/pages/ServiceCoverage.tsx`) but the lead form does not consume it — still three plain `<Input>`s (`NewLeadDialog.tsx:329,364,373`). **Scheduled before demo.** |
| D-05 | ❌ | "Rough value" destroys recurring vs one-off | Label is still `Rough value` (`NewLeadDialog.tsx:382`). No One-off/Recurring/Both toggle, no frequency picker. `fl_lead` has `estimated_value` + `currency` only — no `value_type`, no `frequency`. FINALISED and untouched. |
| D-13 | ✅ | Survey create form has no site | `Property *` required (`NewSurveyDialog.tsx:257`), enforced server-side by `siteSelectionBlocker` (`survey-state.ts:209`). Existing-site picker plus inline create. |
| D-14 | 🟡 | No assignee, no access details on the create form | Access data model landed on `fl_survey_visit` (`site_contact_id/name/phone/email`, `access_instructions`, `meeting_instructions`) — but it is captured in **Schedule visit**, not on the create form, and **assignee is still a separate action**. |
| D-19 | ❌ | Assign is a free-text email box | `AssignDialog` still takes a raw string and validates `address.includes("@")` (`SurveyDetail.tsx:1935,1951`). No person picker, no load, no region, no trade, no conflict-warn — even though `fl_user` and the Users settings page now exist. **P0, scheduled before demo, unstarted.** |
| D-21 | ✅ | Answer types cannot express a measurement | `number` field type + closed unit list `sqft/sqm/each/linear_m/hours` (`form-template.ts:35,52`); `UnitPicker` in the builder; unit is a publish blocker. |
| D-25 | ❌ | Filter tabs are three incompatible axes | Leads tabs are still Open / Unclaimed / Overdue / Won / Closed — state, ownership and SLA under one control (`features/leads/filters.ts:13`, `Inbox.tsx:119-123`). FINALISED and untouched. |
| F-01 | ✅ | A survey cannot be submitted | `Send for review` / `Send back` / `Complete survey` (`SurveyDetail.tsx:192-207`) → `transitionSurvey` (`survey.ts:2051`) → `reviewGuard`/`submitGuard` + revision freeze. |
| F-02 | 🟡 | No numeric type; every answer carries an estimation key | Number + unit ✅. **Ruling not met:** the key is still a free-text input (`TemplateBuilder.tsx:1267,1280`), not auto-generated and not hidden behind an Advanced toggle. `ESTIMABLE_TYPES` at least stops a key riding on free text. |
| F-03 | ✅ | Spaces created with no parent site or building | Site is an invariant at creation; `src/domain/ancestry.ts` + `ancestry_path` make the orphan case unreachable. Building optional, as ruled. |
| P-01 | ⏸ | No Survey Coordinator role | Ruled a **working session, not a code task** — nothing should be built until it happens. Roles/Users/Permissions surfaces exist to receive the outcome (`settings/pages/Roles.tsx`, `Users.tsx`, `Permissions.tsx`). |
| P-05 | ✅ | H6 Surveyor → Survey lead broken | T5/T6 with `requiresLead` and a mandatory rework reason (`survey-state.ts:98,107`), send-back button in the UI. |
| P-06 | 🟡 | H7 Survey lead → Estimator has no artifact | The frozen payload exists (`fl_survey_revision`, checksum, freeze-before-status). **Ruling not met:** it is two buttons, not one. There is no single `Submit` that routes on whether the surveyor *is* the lead — and `requiresLead` actually forbids a non-lead surveyor from submitting, which is the opposite of "Surveyor taps Submit". Built to locked v8.5, not to the 14 Aug simplification. |

---

## P1 — 57 items

### Lead form (D-01 → D-10)

| ID | Bucket | Title | Evidence / note |
| --- | --- | --- | --- |
| D-01 | ❌ | Five groups, none shown | `NewLeadDialog.tsx` is one flat scrolling column — no fieldsets, no legends, no group headings. |
| D-02 | ❌ | "Contact" is a system word | Label is still `Contact` (`NewLeadDialog.tsx:280`). His ruled label `Lead contact name` and the surviving "Their role" picker are both absent. FINALISED. |
| D-03 | 🟡 | One contact field is structurally wrong for FM | Multi-contact exists at the account (`fl_account_contact`, Contacts rail on `AccountDetail.tsx:195`) and site contact at the visit — but intake still captures exactly one. |
| D-06 | ❌ | No "needed by" date | No column on `fl_lead`, no field on the form. |
| D-07 | ❌ | No incumbent, no reason for change | No column, no field. |
| D-08 | 🟡 | Intake assumes one site | The portfolio module models many (`fl_prospect_location`, `PortfolioTree.tsx`) — but only from a **deal**, so the lead is still single-site (`site_address`, `site_city`, `site_region`). |
| D-09 | ❌ | Only Company is required | Only Company carries `*`. `email_norm`/`phone_norm`/`domain_norm` are the dedup keys and all three stay optional. |
| D-10 | ❌ | Channel captured, source is not | `fl_lead` has `source` + `source_detail` — one axis, not two. The ruled Channel/Source split is not built. FINALISED. |

### Survey form and templates (D-15 → D-23)

| ID | Bucket | Title | Evidence / note |
| --- | --- | --- | --- |
| D-15 | 🟡 | Template defaults to "Start from scratch" | Published-only listing ✅ (`NewSurveyDialog.tsx:325-335`), but `Start from scratch` is still the **first and default** option — the ruling said it should not be primary. |
| D-16 | 🟡 | Title is free text and optional | Still optional, but now auto-defaults to the template or deal title (`NewSurveyDialog.tsx:347`), so `sasasa` takes effort. No format or length rule. |
| D-22 | 🟡 | Required defaults to off | Per-question Required toggle ✅ (`TemplateBuilder.tsx:1243`). **Second half missing:** the gate is "every *required* question answered" (`survey-completeness.ts:115`) — a template with zero required questions still submits with nothing answered, which is the exact hole the ruling closed. |
| D-23 | ⏸ | Estimation key is free text, no registry, no uniqueness | **Superseded** — the F-02 ruling replaced the managed key registry with auto-generation, so the Settings admin surface should *not* be built. The remaining gap is booked once, under **F-02 🟡**. |

### Lists (D-26 → D-36)

| ID | Bucket | Title | Evidence / note |
| --- | --- | --- | --- |
| D-26 | ❌ | "Unclaimed" and "Overdue" are internal words | Tab labels unchanged (`Inbox.tsx:120-121`). |
| D-27 | ❌ | The count is the entire UI | Tabs still carry a bare number and nothing else. |
| D-28 | ❌ | No saved views, no group-by, no timeline filter | None on any list page. |
| D-29 | 🟡 | Leads list has four columns, values buried | Columns are now **labelled** — Company / Status / Score / Response (`Inbox.tsx:44-47`) — which fixes the unlabelled part. Still four columns; no value, service or city. |
| D-30 | ❌ | Score shown with no reason | Reasons live in `fl_lead_analysis.reasons_json` and render only on the detail pane. Nothing in the list. |
| D-32 | 🟡 | Accounts list leads with internal plumbing | Now Company / Leads / Deals / In Facilio / Created (`AccountList.tsx:50-54`) — better, but `In Facilio` is still sync plumbing above the columns a salesperson wants. |
| D-33 | 🟡 | Survey list shows the least useful date | Now Survey / Status / Progress / Visits / Target / Created (`SurveyList.tsx:114-119`). Visit **count** is there; the next visit **date** still is not. |
| D-35 | ❌ | One searchable lookup component everywhere | No combobox, no `cmdk`, no `Command` anywhere in `frontend/src`. Every reference field is a plain `Select`. FINALISED. |
| D-36 | ❌ | Global search across modules | Does not exist. |

### Account and survey domain (D-37 → D-39)

| ID | Bucket | Title | Evidence / note |
| --- | --- | --- | --- |
| D-37 | 🟡 | Multiple contacts; site contact at site level | Both models exist (`fl_account_contact`, `fl_survey_visit.site_contact_*`). No add/edit-contact UI found on the account page. |
| D-38 | 🟡 | Related Sites tab, multi-site add, sheet import | Delivered as the **Portfolio** module — `PasteFromRfpDialog.tsx`, `PortfolioTree.tsx`, `importNodes` (`survey.ts:1380`). Hangs off the deal, not off Lead/Account as specced. |
| D-39 | 🟡 | Site edit screen: map spaces to a building after the walk | `LocationDetail.tsx` + `parent_id`/`ancestry_path` make it representable; a dedicated re-parenting screen was not confirmed. |

### Functional (F-04 → F-22)

| ID | Bucket | Title | Evidence / note |
| --- | --- | --- | --- |
| F-04 | ✅ | `claim` is not idempotent | `claimLead` now throws `already claimed by …` (`lead.ts:599`) and stamps `reviewed_at` only once. |
| F-05 | 🔍 | Audit rows carry the wrong description | Event bodies are written per call site; needs the running app to confirm which rows read wrong. |
| F-06 | ❌ | A 2/100 lead is Qualified with Convert live | `convert.ts:82` guards only on `status === 'qualified'`. No score or verdict guard anywhere on the convert path. |
| F-07 | 🟡 | Duplicates auto-closed, no human decides | Still auto-closed — but the hand-raise path now **tells** the user and links both records (`NewLeadDialog.tsx:180-215`). A human is informed, still not asked. |
| F-08 | 🟡 | Facilio clients created at convert, not at Won | Client/contact creation still fires at convert (`convert.ts:229`, idempotent via `dedup_key`). A `won` event now exists as the Ops cue (`deal.ts:446`) — the hook is there, the move is not made. |
| F-09 | 🟡 | A Facilio write failed silently | `fl_sync_task` carries `attempts`, `last_error`, `next_attempt_at`; whether the failure surfaces to a user is not visible from code. |
| F-10 | ❌ | Two versions Published at once | `publishTemplate` (`form.ts:359`) never archives the prior published version of the same lineage. Reproducible from code. |
| F-11 | ✅ | A published template's questions cannot be read | Frozen templates open **as** their preview (`TemplateBuilder.tsx:244,493`) using the same render components as capture. |
| F-12 | ❌ | Assign accepts any free-text email | Same code as D-19. Directory exists; the box ignores it. |
| F-13 | 🟡 | Permissions matrix defined but not enforced | `can(module, action)` now gates the **Leads** module and Settings (`app/access.tsx`, `leads/actions.ts:143`, `Inbox.tsx:67`, `LeadDetail.tsx:388`). Surveys, Accounts, Deals, Proposals, Templates are ungated. Server-side enforcement is impossible on this runtime and is documented as such (`access.ts:11-17`). |
| F-14 | ✅ | There is no Deal screen | Full module: `features/deals/` with `DealList`, `DealDetail`, `StagePath`, `src/modules/deal.ts` (544 lines), `src/domain/deal-state.ts`, `tests/deal-state.test.ts`. |
| F-16 | ✅ | Reconciliation has no possible input path | RFP paste → `importNodes` → `reconcileSurvey` (`survey.ts:1687`) → `decideReconcileItem` with a decision dialog. |
| F-20 | 🔍 | All three Facilio Service Links read "not linked" | `ServiceLinks.tsx:133` renders both states correctly; whether they are linked is org data, not code. |
| F-21 | 🟡 | Site and space level notes with author and timestamp | Notes exist scattered — `fl_survey.notes`, `fl_survey_visit.notes`, `buildup_note`/`safety_note` on observations, `fl_event` for authored entries. No single "add a note anywhere, at site level" surface. |
| F-22 | 🟡 | Assignee must resolve to a real user record everywhere | `fl_survey_assignee` and `fl_survey_visit_assignee` both carry `user_id` **and** `user_email`, and `fl_user` is real — but the assign path writes only the email, so `user_id` stays null. Half-wired. |

### Non-functional (N-01 → N-03)

| ID | Bucket | Title | Evidence / note |
| --- | --- | --- | --- |
| N-01 | 🔍 | Photo thumbnails fail on client-side navigation | Runtime. `PhotoGallery.tsx` exists; needs the app. |
| N-02 | 🔍 | Unsaved walk changes discarded silently | Runtime. The walk has save affordances; whether navigation blocks is untested here. |
| N-03 | 🔍 | Preview only — production not promoted | Deployment state, not code. |

### Persona (P-02 → P-11)

| ID | Bucket | Title | Evidence / note |
| --- | --- | --- | --- |
| P-02 | ⏸ | "Lead Actioner" is a verb, not a job | Blocked on the P-11 working session by ruling. The word is still live in the UI (`Timeline.tsx:206`, `ActionDialogs.tsx:264`) — see X-06. |
| P-03 | ⏸ | "Management" has View and Export only | Same. Roles are editable in `settings/pages/Roles.tsx` once the personas are agreed. |
| P-04 | ⏸ | Sales Manager / Sales Executive split along no real line | Same. |
| P-07 | ❌ | H3 BDR → BD manager lands nowhere | `fl_lead_assignment` records the move; no manager-facing destination. |
| P-08 | 🟡 | H5 Coordinator → Surveyor transfers a template and a date only | Now also site contact, access instructions and meeting instructions on the visit — a real improvement. Assignee context (load, region, trade) still absent. |
| P-09 | 🟡 | H10 BD → Ops fires at the wrong moment, no pre-flight | A pre-flight now exists: `ConvertToFacilio.tsx` + `fl_prospect_convert_log` with `dedup_key`, `status`, `error_text`. The *moment* is still convert-time, not Won (see F-08). |
| P-11 | ⏸ | Define personas per module, then derive permissions | The scheduled working session. Not a build item. |

### UX (X-01 → X-08)

| ID | Bucket | Title | Evidence / note |
| --- | --- | --- | --- |
| X-01 | ✅ | Survey rows are not clickable | The shared `DataTable` gives every row `role="button"` and `cursor-pointer` (`ui/DataTable.tsx:100-102`). |
| X-02 | ❌ | No Draft or Cancelled filter | Filters are All / Scheduled / Assigned / In progress / Pending review / Completed / Overdue (`SurveyList.tsx:71-105`). Draft and Cancelled still reachable only via All. |
| X-03 | ✅ | PROGRESS and TARGET are "—" on every row | Progress is real: `completeness_pct` is computed by `survey-completeness.ts` and restamped on **every** transition (`survey.ts:2108-2112`). Target is settable through the Edit dialog (`SurveyDetail.tsx:2237,2251`). Narrower residual finding: it is edit-only, never asked for at creation, so a survey is born with a blank Target. |
| X-04 | ❌ | The "Won" tab lists leads whose status is converted | `filterLeads` still maps the `won` tab to `status === "converted"` (`filters.ts:37`) under the label `Won`. |
| X-05 | ❌ | Users render as raw email addresses | e.g. `SurveyDetail.tsx:1022` prints `a.userEmail` directly. `fl_user.name` exists and is unused for display. |
| X-06 | ❌ | Ownership shows the role name "Actioner" | `Timeline.tsx:206`, `ActionDialogs.tsx:264`. |
| X-07 | ❌ | AI panel shows a score with no confidence, model or prompt version | `fl_lead_analysis` stores `model_name` and `prompt_version`; `AiAssessment.tsx` renders neither. |
| X-08 | ❌ | UI says "AI assessment", glossary says "analysis" | Still "AI assessment" (`LeadDetail.tsx:693`). |

---

## P2 — 30 items

| ID | Bucket | Title | Evidence / note |
| --- | --- | --- | --- |
| D-11 | 🟡 | "How it came in" defaults to Raised internally, Detail free text | Options are now explained with hints (`NewLeadDialog.tsx:54-55`) and Detail has a context-sensitive placeholder. Still a default and still free text. |
| D-12 | ✅ | Nothing tells the handler what happens after Create lead | The dialog now says it: response clocks start on save, duplicates are closed and linked (`NewLeadDialog.tsx:222-225`). |
| D-17 | 🟡 | Contract intent on the record but not the form | Shown on the detail (`SurveyDetail.tsx:778`), still absent from the create dialog. |
| D-18 | 🟡 | Visit end auto-fills +2h, no duration, no sanity check | Sanity check landed — "The end has to come after the start" — and the +2h is now stated in help text. Duration still not shown. |
| D-20 | 🟡 | No way to remove an assignee or move the lead role | `set-lead` exists (`surveys-util.ts:220`) and `fl_survey_assignee` has `removed_by`/`removal_reason`; a remove control on the page was not found. |
| D-24 | ❌ | No per-question guidance, example or photo requirement | `help_text` exists on `fl_form_question` but the builder explicitly does not edit it (`TemplateBuilder.tsx:359-360`). |
| D-31 | ❌ | "RESPONSE" mixes a countdown and a verdict | Header unchanged (`Inbox.tsx:47`). |
| D-34 | ❌ | Templates are a card grid; this object wants a table | Still `grid-cols-1 … xl:grid-cols-4` (`TemplateList.tsx:55`). |
| F-15 | 🔍 | Publish-checklist counter off by one in the zero state | Checklist logic exists; the off-by-one needs the running app. |
| F-17 | 🟡 | Survey status and the visit calendar are decoupled | `transitionVisit` (`survey.ts:730`) plus `reviewGuard`'s "no visit left open" blocker (`survey-completeness.ts:87`) couple them at the review gate. Not coupled continuously. |
| F-18 | ❌ | Accounts can only be born from a lead | `account.ts` still creates only through `convert.ts`. No standalone create. |
| F-19 | ❌ | The account page is read-only | No edit control on `AccountDetail.tsx`. |
| N-04 | ✅ | One layout breakpoint in the entire stylesheet | The Tailwind/shadcn rebuild uses `sm:`/`md:`/`lg:`/`xl:` and `max-md:`/`max-lg:` throughout, plus a phone tab bar and a `MobileList` variant. |
| N-05 | 🟡 | 256 permission checkboxes at 16×16 px | `Permissions.tsx` was rebuilt on shadcn controls with a `SettingsNav` split by page; the density question needs the running app. |
| N-06 | 🟡 | No URL state for filters, tabs or list views | Landed on `SurveyList`, `ProposalList`, `PortfolioTree`, `ConvertToFacilio`. **Not** on the leads Inbox, Accounts or Templates — `Inbox.tsx:72` is still `useState`. |
| N-07 | 🔍 | Offline capture is unproven | Unchanged status. A service worker is registered; untested. |
| N-08 | ❌ | No export anywhere, though Export permissions exist | No CSV/export path found in `frontend/src`. |
| N-09 | 🔍 | Developer probes shipped in the dataset | Live-data issue. `db/tables/*.csv` in this repo are schema definitions with one seed row each. |
| N-10 | 🔍 | Demo-rigging copy shipped in production | Needs the deployed app. |
| N-11 | 🔍 | Web-widget console shows a live failure and an unbuilt endpoint | `features/chat/` exists; the failure is runtime. |
| P-10 | 🟡 | H2 Handler → BDR is a bare claim with no context transfer | `fl_lead_assignment` now carries `reason` and `role`, and `claimLead` writes one — thin context, but no longer bare. |
| X-09 | 🟡 | Activity log leaks internal transition codes | Codes T2–T9 are still first-class (`survey-state.ts:59`) and ride the events, but `Timeline.tsx` maps kinds to human labels. Mixed. |
| X-10 | 🟡 | Two activity components that behave differently | Still two — `leads/components/Timeline.tsx` and the survey detail's own activity pane. |
| X-11 | 🔍 | Two unlabelled "In progress" badges in the walk header | Visual, needs the app. |
| X-12 | 🔍 | "Add another room" vs "Add another Room" | Casing comes from `repeat_label` data plus button copy — needs the app to confirm. |
| X-13 | 🔍 | "All saved" and a live "Save progress" button coexist | Needs the app. |
| X-14 | ❌ | No length cap or truncation on survey titles | No `maxLength` on the title input (`NewSurveyDialog.tsx:342-348`). |
| X-15 | ❌ | Location renders "Al Rigga Road, Deira, Dubai, Dubai" | No de-duplication in the address formatter. |
| X-16 | ❌ | "not in Facilio yet" styled red though it is the correct pre-Won state | `ServiceLinks.tsx:135` and the account chip still use the alarm tone for a normal state. |
| X-17 | 🟡 | "Raise a survey" throws you out of the account | Still navigates away — `/surveys?new=<dealId>` (`AccountDetail.tsx:347`) — but it now carries the deal through, so the destination is pre-filled rather than blank. |

---

## P3 — 3 items

| ID | Bucket | Title | Evidence / note |
| --- | --- | --- | --- |
| N-12 | 🔍 | Colour contrast unverified | Unchanged. Still `oklch()` tokens; no measurement. |
| N-13 | 🔍 | Theme reset dark → light on hard reload | Commits `5253dcd`/`ad63cb8` touched theme persistence and browser-chrome colour; needs a reload test to confirm. |
| X-18 | ❌ | Decorative random gradients are the loudest signal on the templates grid | Still generated per template (`TemplateList.tsx:62-79`). |

---

## What to do next, in order

1. **D-19 / F-12 / X-05 / F-22 — the assignee chain.** One change closes four issues and a
   P0 that was scheduled before the demo. `fl_user` is real, `user_id` columns already exist
   on both assignee tables; the only missing piece is the picker. Cheapest high-value work
   on the list.
2. **D-05 — Estimated value.** FINALISED, reversed after push-back, and completely untouched.
   One rename, one toggle, one conditional frequency picker, two columns.
3. **D-04 — controlled Service / City / Region.** The catalogue is already in Settings; the
   form just needs to read it. Scheduled before demo.
4. **P-06 — one Submit button.** Today's two buttons contradict the ruling, and
   `requiresLead` actively blocks the surveyor the ruling says should tap Submit.
5. **D-25 / D-26 / X-04 — the leads tab strip.** Three P1s and one P0 in one control.
6. **D-35 — the searchable lookup.** FINALISED as "one component, everywhere", and there is
   no combobox in the codebase at all; every new reference field added meanwhile is another
   site to retrofit.
7. **F-10 — publish should archive the prior version.** A four-line fix in
   `form.ts:359`, and it is a data-correctness bug, not a UX one.
8. **P-11 — book the persona session.** Five items (P-01 through P-04, P-11) are frozen
   behind it, and X-06 keeps shipping "Actioner" to users until it happens.

## What this check could not answer

Fifteen issues are runtime, visual or data state and need the deployed app, not a file read:
**F-05, F-15, N-01, N-02, N-03, N-07, N-09, N-10, N-11, N-12, N-13, X-11, X-12, X-13** — plus
**F-20**, which is org data. If a demo build is up, that list is one 20-minute pass and it
would move a chunk of the ❌ column one way or the other.
