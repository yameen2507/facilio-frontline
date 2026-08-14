# Frontline — CRUD Audit v1

**Date:** 14 Aug 2026 · **Scope:** Lead → Account → Survey → Survey Template
**Method:** three-way cross-check — live handler names in `src/functions/*/index.ts`, wrapper
functions in `frontend/src/features/*/api/*-util.ts`, and actual call sites in the pages.
A wrapper that exists but nothing calls is *not* automatically a gap; a handler that does not
exist is *not* automatically an oversight. Every row below carries one of three verdicts:

- **GAP** — real, needed, nobody has said otherwise
- **BY DESIGN** — a doc rule or code comment forbids it; cited
- **SEAM** — backend handler not built yet; already tracked

---

## 0. The one-paragraph answer

There is **one clean, unblocked GAP**: a lead cannot be edited after capture, even though
`lead.update` is live and accepts ten fields. Everything else divides into work the design
already forbids (account/contact CRUD lives in Facilio, survey mutation is named actions not
field edits, delete is always soft) and work the backend has not shipped yet (the survey
review slice, and assignee removal). The template module is the most complete of the four.

---

## 1. LEAD

Handlers live (23): `create · list · get · update · transition · claim · assign · log-activity ·
analyse-input · analyse · convert · account-list · account-get · sync-* · reference · intake-*
· settings-*`.

| Operation | Handler | UI | Verdict |
| --- | --- | --- | --- |
| Create | `create` | `NewLeadDialog` | ✅ complete |
| Read (list) | `list` | `Inbox` | ✅ complete |
| Read (one) | `get` | `LeadDetail` | ✅ complete |
| **Update — descriptive fields** | `update` — **10 editable, 1 wired, 9 unwired** | only `nurtureUntil` | **GAP** |
| **Update — contact email / phone** | **not in `EDITABLE_KEYS`** | — | **GAP (backend + UI)** |
| Transition / close | `transition` | `CloseDialog` | ✅ complete |
| Claim | `claim` | `LeadDetail` | ✅ complete |
| Assign | `assign` | `AssignDialog` | ✅ complete |
| Log a call | `log-activity` | `LogCallDialog` | ✅ complete |
| Convert | `convert` | `LeadDetail` | ✅ complete |
| **Delete** | none | none | **BY DESIGN** — closing with a `disposition_reason` is the delete; a lead row is the source count |
| **Merge duplicates** | none — `create` links + auto-closes | none | **GAP (small)** — see §1.3 |

### 1.1 GAP — no edit-lead surface

`src/functions/lead/index.ts:340` declares `EDITABLE_KEYS`:

```
companyName · contactName · serviceType · description ·
siteAddress · siteCity · siteRegion · estimatedValue · currency · nurtureUntil
```

**Ten fields editable, one wired, nine unwired.**
`frontend/src/features/leads/pages/LeadDetail.tsx:348` is the only caller, and it passes
`nurtureUntil` alone. The other **nine have no UI at all**. Four dialogs are
mounted on lead detail (`ActionDialogs.tsx:329`): log-call, nurture, assign, close. There is
no fifth.

**Why it matters now.** Two of the three channels are machine-captured. A widget or tender
lead arrives with whatever the scraper or the chat agent parsed — a wrong company name, a
missing service type, an estimated value of nothing. Today a salesperson looking at that lead
can claim it, call it, assign it, close it, or convert it. They cannot correct it. The wrong
value then flows through `convert` into `fl_account` and `fl_deal`, and from there outward to
Facilio, where it becomes someone else's problem.

**Cost:** one `EditLeadDialog` in `leads/components/ActionDialogs.tsx`, one entry in
`PendingLeadAction`, one submit handler in `LeadDetail`. No backend work. The handler already
returns the refreshed `detail`, so the page re-renders without a second round trip.

### 1.2 GAP — the three dedup keys are write-once, and fixing that is not a one-liner

`NewLeadFields` (`leads/api/leads-util.ts:46`) accepts `contactEmail`, `contactPhone` and
`websiteDomain` on create. `EDITABLE_KEYS` accepts none of them. **A typo'd contact email can
never be corrected**, and these three are the least cosmetic fields on the record — they are
exactly the **dedup keys**. `src/modules/lead.ts:131` matches new enquiries on `email_norm`,
`phone_norm` and `domain_norm`, so a bad value silently breaks duplicate detection for every
future enquiry from that company. `contactEmail` is also what `convert` pushes to Facilio as
`create-client-contact` (`src/modules/convert.ts:147`).

**⚠ The obvious fix is wrong.** Adding three strings to `EDITABLE_KEYS` would corrupt dedup
rather than repair it. `updateLead` (`src/modules/lead.ts:483`) builds its `SET` clause from
`EDITABLE[key]` — **one raw column per key, nothing else**. The `*_norm` columns are written in
exactly one place, the insert at line 201. Add `contactEmail` naively and you get a lead whose
`email` reads correctly and whose `email_norm` still holds the typo *forever* — dedup keeps
matching the old value, and now the record lies about itself as well.

**Cost:** the three strings in `EDITABLE_KEYS` **and** in the handler's declared `parameters`
(both, or the platform drops them — header comment at `src/functions/lead/index.ts:1`), plus a
re-normalise step in `updateLead` that recomputes `email_norm` / `phone_norm` / `domain_norm`
whenever their source field is in `fields`. Reuse the same normaliser `createLead` calls; do not
write a second one. Redeploy the `lead` function.

Worth deciding at the same time: re-running `findDuplicate` after a key changes. A lead
corrected into being a duplicate of an existing one currently stays open and unlinked. That is
arguably fine — a person edited it deliberately — but it should be a decision, not an accident.

### 1.3 GAP (small) — a duplicate is linked but never merged

`src/modules/lead.ts:183` — a duplicate still gets a row, linked via `duplicate_of_lead_id`
and auto-closed, "so source counts stay honest." That is the right call. But there is no
operation that says *"this was not a duplicate, reopen it"* or *"fold this one's contact
details into the original."* `transition` can reopen it; nothing can merge it.

Low urgency — flag it, don't build it yet.

---

## 2. ACCOUNT

Handlers live (2): `account-list`, `account-get`. Both read.

| Operation | Handler | UI | Verdict |
| --- | --- | --- | --- |
| Create | none | none | **BY DESIGN** |
| Read | `account-list` / `account-get` | `AccountList` / `AccountDetail` | ✅ complete |
| Update | none | none | **BY DESIGN** |
| Delete | none | none | **BY DESIGN** |
| Contact CRUD | none | none | **BY DESIGN** |
| Deal CRUD | none | none | **BY DESIGN** (created by `convert`) |

**This is not a gap, and it would be a mistake to close it.** `ARCHITECTURE.md` §2 — Ownership
boundary — assigns the systems of record:

| Concern | System of record |
| --- | --- |
| Lead, analysis, dedup, queue, SLA, qualification | **Vibe app** |
| Deal (the opportunity) | **Vibe app** |
| **Account as a client record** | **Facilio FSM** — `create-client` |
| **Contact** | **Facilio FSM** — `create-client-contact` |

`fl_account` is a **shadow** of the Facilio client, not the master. The `facilioClientId`
column on `Account` (`accounts/types/account.ts`) and the outbox that fills it are the tell —
the type's own comment says it is "null until the outbox has written the client to Facilio."
The only writer is `src/modules/convert.ts:95`, and that is correct: an account comes into
existence because a lead converted, never because someone typed one in.

An "Add account" button here would create a Vibe-side row with no Facilio client behind it —
a second master. If an account name is wrong, it is fixed in Facilio and flows back.

**One thing worth adding, and it is not CRUD:** `AccountDetail` should say *where* to edit.
Right now the page is read-only with no explanation, which reads as unfinished rather than as
a deliberate boundary. A single line — "Client details are maintained in Facilio FSM" — with a
link out on `facilioClientId` turns a missing feature into a stated one.

---

## 3. SURVEY

Handlers live (15): `create · list · get · schedule · transition · visit-transition · assign ·
set-lead · walk · capture · attach · deal-list · reference · settings-get · settings-put`.

Handlers the frontend has wrappers for but that **do not exist yet**: `update`, `node-verdict`,
`reconcile`, `reconcile-decide`, `submit`. The api-util already marks all five `[SEAM]`
(`surveys/api/surveys-util.ts:1`).

| Operation | Handler | UI | Verdict |
| --- | --- | --- | --- |
| Create | `create` | `NewSurveyDialog` | ✅ complete |
| Read (list / one / walk) | `list` `get` `walk` | `SurveyList` `SurveyDetail` `SurveyWalk` | ✅ complete |
| Schedule / reschedule | `schedule` | `SurveyDetail` | ✅ complete |
| Assign surveyors | `assign` | `SurveyDetail` | ✅ complete |
| Set the lead | `set-lead` | `SurveyDetail` | ✅ complete |
| Capture | `capture` | `SurveyWalk` | ✅ complete |
| Cancel | `transition` | `SurveyDetail` cancel dialog | ✅ complete |
| Visit no-show / cancel | `visit-transition` | `SurveyDetail` | ✅ complete |
| **Update — title, target date, notes** | **absent** | — | **SEAM** |
| **Remove / swap an assignee** | **absent** | — | **GAP** |
| Node verdict | absent | — | **SEAM** |
| Reconcile + decide | absent | — | **SEAM** |
| Submit (T7) | absent | — | **SEAM** |
| **Delete** | none | none | **BY DESIGN** — Cancel is the delete |
| Attach one photo | `attach` (live) | unused | **BY DESIGN** — see §3.3 |

### 3.1 GAP — an assignee can be added but never removed

`Survey Module Structure v1.8.md` §A1.2b names four assignment actions. Two of them cannot be
performed:

| Action | v1.8 says | Reality |
| --- | --- | --- |
| Assign | ✅ | `survey.assign` |
| Change the lead | ✅ | `survey.set-lead` |
| **Reassign (swap)** | "Outgoing person soft-removed; **their captures stay attributed**" | **no handler** |
| **Remove an assignee** | "Cannot remove the last assignee, or the lead without naming a replacement" | **no handler** |

`survey.assign`'s own description (`src/functions/survey/index.ts:283`) is explicit: *"multi-select,
one idempotent multi-row insert."* **Insert only.** There is no way to express "this person is
off the survey," which means a surveyor who leaves the company, or one assigned by mistake,
stays on the record permanently — and §A4's CRUD matrix grants BD and Lead a `D` on
`fl_survey_assignee` that no code implements.

**Checked before calling it a gap rather than a seam.** §10 BUILD ORDER step 6 is
*"`fl_survey_assignee` + `fl_survey_visit_assignee` — the serialised one-lead handler"* — the
assignee slice, and removal belongs inside it; no later step picks it up. §9 LEDGER's eight open
items do not mention it, and §8's open decisions do not either. So unlike `update` / `reconcile`
/ `submit` — which the api-util itself marks `[SEAM]` and routes to the review slice — **removal
is not scheduled anywhere.** It fell out between a design that names it twice and a build that
implemented the insert half.

Worth raising with Sudharsan and Mithun before the review slice starts, since it is a small
addition to a slice they have already been in.

**Cost:** one handler (`assign-remove` or a `participation: "removed"` path through `assign`),
its two guards from §A1.2b, one `fl_event` row, and a ⋯ menu on the Team tab.

### 3.2 SEAM, not gap — no edit-survey form

`survey.update` (title, `targetCompletionDate`, notes) has a wrapper and no handler. Do not
mistake this for the lead gap in §1.1: §A1.2b is titled **"Survey actions — named operations,
not field edits,"** and every mutation there carries its own permission, guard and event row.
The correct surface is a small three-field form, not a general property editor — and it should
ship with the review slice, alongside `node-verdict` / `reconcile` / `submit`, which is where
the api-util already says it belongs.

### 3.3 BY DESIGN — `attachPhoto` unused

`survey.attach` is live and nothing calls it. That is correct: `capture` already carries a
`photos[]` array, and `SurveyWalk` batches a whole room — entries, answers, observations and
photos — into one round trip (`surveys-util.ts:172`, "One room, one round trip"). `attach`
exists for a single photo outside a batch; the walk has no such moment yet.

### 3.4 BY DESIGN — no delete

`Survey Module Structure v1.8.md` §A4, rule 1: **"No hard deletes anywhere.** `D` = `is_active
= false` + an `fl_event` row." Rule 3: **"`completed` beats every role"** — a `U` evaporates the
moment the survey completes. Cancel-with-a-reason (T8) is the delete, and it is wired.

---

## 4. SURVEY TEMPLATE

Handlers live (15) — the fullest CRUD surface in the app.

| Operation | Handler | UI | Verdict |
| --- | --- | --- | --- |
| Create | `template-create` | **unused** | **BY DESIGN** — see §4.1 |
| Create (real path) | `template-import` | `TemplateBuilder` | ✅ complete |
| Read | `template-list` / `template-get` | `TemplateList` / `TemplateBuilder` | ✅ complete |
| Update — metadata | `template-update` | **unused** | **BY DESIGN** — carried by `import` |
| Update — content | `template-import` (replaces in place) | `TemplateBuilder` | ✅ complete |
| Publish | `template-publish` | `TemplateList` | ✅ complete |
| Clone | `template-clone` | `TemplateList`, `TemplateBuilder` | ✅ complete |
| Archive | `template-archive` | `TemplateList` ⋯ menu | ✅ complete |
| Delete | none | none | **BY DESIGN** — "Archive IS this model's delete" (`TemplateList.tsx:107`) |
| Section save / delete / reorder | live ×3 | **unused** | **BY DESIGN** — see §4.2 |
| Question save / delete / reorder | live ×3 | **unused** | **BY DESIGN** — see §4.2 |
| `reference` (field types, bindings) | live | **unused** | **GAP (small)** — see §4.3 |

### 4.1 & 4.2 BY DESIGN — the builder drafts locally, saves once

Nine live handlers go uncalled, and all nine are correct. `templates/api/templates-util.ts:1`
states the reasoning: *"The builder saves through `template-import`, never through the per-row
calls: it drafts locally and hands the whole tree over at once, because a handler round trip
costs ~1.1s of fixed overhead and a 30-question template saved row-by-row is the adoption-risk
math of Backend Plan §6.2 at the desk."*

`template-import` carries `name`, `description`, `category` and the full `sections[]` tree, and
with a `templateId` it replaces a draft in place — so it subsumes `template-create` and
`template-update` both. The per-row calls are reserved for *"the edit-an-existing-draft surface
to come."* Leave them.

Editing a published template is Clone-to-draft by design (§A1.9, §B1.6). Not a gap.

### 4.3 GAP (small) — `form.reference` is never read, and the enum is duplicated

`form.reference` exists so *"callers never hardcode"* the enums, and serves `fieldTypes`,
`levelBindings`, `nodeTypes`, `templateStatuses` (`src/functions/form/index.ts:419`).
`getReference()` wraps it. **Nothing calls it** — and `templates/types/template.ts:15` holds a
second, hand-written copy:

```ts
export const FIELD_TYPES: FieldType[] = ["short_text", "long_text", "options", "attachment"];
```

Two lists of the same four values, in two repos-worth of code, with no link between them. The
drift is not hypothetical: decision **D-k** (same file, line 24) is still open and would add
`number` + `unit` — *"a code change, not a migration."* Whoever makes that change server-side
will not know to make it here, and the builder will quietly offer four types against a backend
that validates five.

Note this is not a pure "just fetch it": the frontend needs the TS union and `FIELD_TYPE_LABEL`
regardless, so the fix is to make the local list the *rendering* layer and validate it against
`reference` on load — or, cheaper, a comment on each list naming the other.

---

## 5. What to build, in order

| # | Item | Module | Where | Backend? |
| --- | --- | --- | --- | --- |
| 1 | **Edit-lead dialog** — the 9 unwired of 10 editable fields | Lead | `ActionDialogs.tsx` + `LeadDetail` | no |
| 2 | **The 3 dedup keys editable — with `*_norm` recomputed** | Lead | `functions/lead/index.ts:340` + params + `modules/lead.ts:483` | yes |
| 3 | **Remove / swap an assignee** | Survey | new handler + Team tab ⋯ menu | yes |
| 4 | "Maintained in Facilio FSM" line + link out | Account | `AccountDetail` | no |
| 5 | Reconcile `FIELD_TYPES` against `form.reference` | Template | `types/template.ts` + `TemplateBuilder` | no |
| 6 | Merge / un-duplicate a lead | Lead | later | yes |

Items 1, 4 and 5 are an afternoon and touch no backend. **Item 2 is bigger than it looks** —
§1.2 — and shipping the three strings without the re-normalise makes dedup worse than leaving
it alone; do it whole or not at all. Item 3 needs a decision from whoever owns the survey
backend, because the design names the action twice and no build step is left to carry it.

Everything else on the survey side — `update`, `node-verdict`, `reconcile`, `reconcile-decide`,
`submit` — is the **review slice**, already scoped, already seamed, and correctly not built yet.

---

## 6. Market scan — secondary

Asked whether the market implies modules we have not considered. Mostly it does not, and the
places it does are already named as cuts.

Standard modules in FM/field-service suites that pair a CRM front end with a survey-to-quote
flow (CentraHub, Simpro, Fieldpoint, TabsFM): **Client management · Quotation management ·
Contract management · Purchase ordering · Property/asset management · Survey & feedback**.

Against that list:

| Market module | Frontline |
| --- | --- |
| Client management | **Facilio FSM owns it** — ARCHITECTURE §2, deliberate |
| Survey / inspection | Built (desk + walk); review slice pending |
| **Quotation / estimation** | `fl_quote`, `fl_quote_line`, `fl_rate_card` exist on disk; **no function, no UI**. This is the estimation lane — §5 of v1.8 freezes the handoff payload as the only interface. Known, scoped, next |
| Contract management | Facilio FSM — **manual, no API exists** (ARCHITECTURE §2). Genuinely out of reach, not deferred |
| Property / sites / assets | Facilio FSM *(later)*; `fl_prospect_node` is the pre-contract stand-in |
| Purchase ordering | Post-contract. Not this app's funnel |
| **Saved views, column config, global search** | **Explicitly not this module's job** — §B4 (C19): one hardcoded list per surface, no persistence, "throws away cleanly." A survey-shaped view engine guarantees a differently-shaped deal one next week |
| **User management** (invite / deactivate / roles) | **Explicitly out** — §A1.2b, D-n: P1 reads the platform user list into the assignee picker and registers permission keys, nothing more. Layer-0 work |

**Nothing the market suggests is missing that the design has not already ruled on.** The two
real absences — quoting and the review slice — are both scoped and sequenced. The CRUD gaps in
§5 are smaller than any of them and cheaper than all of them.

Sources: [SoftwareTestingHelp](https://www.softwaretestinghelp.com/best-facility-management-software-services/) ·
[CentraHub CRM](https://www.centrahubcrm.com/facilities-management-crm-software) ·
[TabsFM modules](https://www.tabsfm.com/CAFM/modules/) ·
[Fieldpoint](https://fieldpoint.net/facility-management-software/) ·
[GetApp — FM with quotes](https://www.getapp.com/operations-management-software/facility-management/f/quote-management/)
