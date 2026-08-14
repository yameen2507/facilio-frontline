<!--
  CLAUDE.md — VIBETHON MOTHER DOC v8.7  ★ PRIMARY GOVERNING FILE ★
  Canonical name: claude/CLAUDE.md (Vibethon project)
  Author: Claude (with Sudharsan) · 13 Aug 2026 (event day 1)
  SUPERSEDES claude/vibethon-mother-doc-v7.md and the v8.6 amendment file (now folded).
  FROZEN SNAPSHOT of the previous state: claude/CLAUDE-v8.5-snapshot-13Aug2026.md — cite, never edit.
  CHANGELOG (newest first)
  v8.7 — 13 Aug 2026: THE CODE WAS READ, AND THE DOC WAS WRONG. Yameen's repo inventory
       (WHATWEBUILT.md, commit 28e3ad9) was compared three-way against this file and against
       survey-module-structure-v1.7. Audit: claude/frontline-alignment-audit-v1.md.
       (1) v8.6's survey-scope amendment FOLDED IN (S1–S7 applied to §1, §3, §8) — assets out,
           prospect portfolio, site→building→space, C15 out of the event build, C13 intake-only.
       (2) §2 BUILD STATE REWRITTEN. Sudharsan's ruling: **Yameen's document is the latest with
           respect to what has been built.** The v37 cit-crm feature list (quote engine, proposal
           builder, LOA, contract types, condition scoring, survey scheduling) is NOT in the
           frontline repo. §9.2's M-gates re-cut accordingly.
       (3) §3a PLATFORM CONSTRAINTS added — no DDL, agents client-side only, no public app access,
           jobs need production, shared preview/prod DB. These shaped Yameen's build and were
           nowhere in this file.
       (4) C2 REWRITTEN. The promised `UNIQUE (conversion_log.…)` index cannot be created (no DDL).
           Idempotency is now a function-level pattern with a stated residual risk.
       (5) TERMINOLOGY LOCKED (§0a glossary, binding on every lane): Won→Facilio is "PROMOTION",
           not "conversion"; `convert` means lead→deal only; prospect (not staged) portfolio;
           `fl_` prefix on every table; Lead is a record not a stage; Survey is an object not a stage.
       (6) C28 added (lead→customer status resolution — Sudharsan) and C29 (notify = event + in-app).
       (7) C23 HELD AS WRITTEN on Sudharsan's ruling — services must be Facilio Services wherever
           used. Flagged to Yameen against the built fl_service_* tables. L10 still blocks it.
       (8) Ledger: L11 and L12 ANSWERED (both NO). L15–L18 added.
       (9) §14 added — the handover brief for Yameen and Mithun.
  v8.6 — 13 Aug 2026: survey-lane scope amendment (assets/floors cut to soft services; prospect
       portfolio rename; generic section+question form builder; repeatable sections; appointment
       semantics on visits; assignees optional / one lead mandatory). Was a standalone amendment
       file; folded into v8.7. See claude/CLAUDE-v8.6-amendment-survey-scope.md for the original.
  v8.5 — 13 Aug 2026: L8 CLOSED. Survey lifecycle locked — 7 states + Pending Review→In Progress
       rework loop (reason mandatory); Survey↔Visit split; assignees + one lead; Completed is
       terminal; deal advance on completion is MANUAL. Spec frozen as survey-module-flow-v3.md.
  v8.4 — 13 Aug 2026: D-S1..S11 locked (survey-module-flow-v2.md). Reconciliation = person decides
       every diff. Template vs instance split. Conflict-warn only. Geotag on capture, no tracking.
       L2 resolved (real public RFP fixtures found).
  v8.3 — 13 Aug 2026: DOCTRINE added to §6 — humans act, workflows automate, AI assists.
       C18–C27 registered. P4 estimation→quote parked to Yameen.
  v8.2 — 13 Aug 2026: G4 DECIDED — surveyed portfolio staged in the app DB until Won.
  v8.1 — 13 Aug 2026: Berkeley Anand call triaged (G6 closed). C13–C17 registered.
  v8   — 13 Aug 2026: REGISTRATION CHANGED to FRONTLINE (FM CRM, lead-to-contract). D1–D3 locked.
  v7 and earlier — claude/vibethon-mother-doc-v7.md + funnel lineage v4–v6 + stage1 extraction.
       Frozen evidence archive: cite, don't edit.
  VERSIONING RULE: this file is LIVING — update in place, dated changelog line per change.
  A change to §1–§3 requires a frozen snapshot copy first (claude/CLAUDE-v8.x-snapshot-<date>.md).
-->

# CLAUDE.md — Frontline: FM CRM, Lead-to-Contract · Vibethon Mother Doc v8.7

> **Event is live:** Thu 13 Aug 10:00 → Fri 14 Aug 17:00 IST. Team: Sudharsan, Yameen, Mithun. Platform: Facilio Vibe (mandatory).
> **Build of record: the `frontline` repo** (commit `28e3ad9`), deployed to **preview only** at `preview-frontline.vibe.facilio.com`. Demo org **#984**; Imperial org **1860** is a read-only production reference — resolve any org confusion before cloning metadata.
> **Read §2 before you plan anything.** It changed materially at v8.7.

## §0. HOW EVERY CHAT IN THIS PROJECT MUST RUN

1. **Start of every chat:** `project_read` this file. Locate the current milestone (§9.2), the open gates (§12), the build state (§2) and the platform constraints (§3a). Do not re-litigate locked decisions (D1–D3) unless Sudharsan explicitly reopens them — snapshot first.
2. **Skills are not optional.** Apply the map in §10. `sudharsan-replica` sets voice and decision style throughout. New evidence (transcripts, exports, repo inventories) goes through `discovery-impact-triage` before it changes scope.
3. **Devil's advocate is a standing duty.** Every proposed feature must survive §11 before entering the register (§8). The event rules' own words: *a small idea that removes real pain beats an ambitious one that removes none.*
4. **End of every chat:** write durable outputs to the project (`claude/` namespace, versioned filenames); decisions get a changelog line here. Nothing important lives only in a chat.
5. **Sequence discipline:** if a chat's request contradicts this file, surface the contradiction before proceeding — exactly as the v7→v8 pivot and the v8.7 build-state correction were surfaced.
6. **Documents describe; code decides.** v8.7 exists because this file claimed a feature set the repo does not contain. When a doc and the code disagree, the code wins and the doc gets fixed the same day.
7. **Confidentiality:** CBRE, CIT and Imperial materials are commercially sensitive. Use their requirements freely inside the build; **never name them** in demo, pitch, or anything judge-facing ("a global IFM provider's AI requirements", "a specialized-services SOW from a live prospect", "a US commercial-cleaning provider's live proposal process").

## §0a. GLOSSARY — the canonical word for each thing *(new at v8.7 · BINDING ON EVERY LANE AND EVERY DOC)*

Three documents were using different words for the same objects and, worse, the same word for two different operations. This table is now the vocabulary. Any doc, screen label, table or handler that disagrees with it is wrong and gets fixed.

| Concept | **Canonical** | Never say | Why it matters |
| --- | --- | --- | --- |
| The app | **Frontline** | Tamam / Rawnaq / Halo | The slug, repo and URL are committed. §13.6's parked naming decision is **closed**. |
| Pre-deal enquiry record | **Lead** — a *record*, with its own lifecycle, that converts into Account + Contact + Deal | "the Lead stage" | A lead is not a deal stage. The deal's first stage is **Opportunity**. |
| First deal stage | **Opportunity** | Lead | See above. |
| Lead → Account+Contact+Deal | **convert** (`lead.convert`) | conversion, promotion | One operation, one word. |
| **Won → Facilio write** | **PROMOTION** — `fl_promotion_log`, "the promotion writes", "promotion pre-flight screen" | conversion, `conversion_log` | ⚠ The most dangerous collision in the project. Two totally different writes were sharing the word "convert". This file's own metaphor is already *"Won is the promotion gate"*. |
| Pre-Won building tree | **prospect portfolio** — `fl_prospect_node`, `fl_prospect_observation` | staged portfolio, `staged_node` | Renamed at v8.6; "staged" is purged. |
| Our site-assessment object | **Site Survey** in the UI; `fl_survey` in the DB | "Survey" alone, in judge-facing UI | Facilio has its own Surveys (feedback questionnaires — a known G1 trap). A judge will see both products. |
| Site assessment lifecycle owner | **Survey lead** — the only role that can submit | reviewer, approver | Accountability line: BD owns the deal, lead owns the survey. |
| Where we sell | **service area** (`fl_service_area`) | site | Geography, not a property. |
| A physical property in a deal | **site** (`fl_prospect_node` where `node_type='site'`) | service area, location | |
| The sync mechanism | **sync queue** — `fl_sync_task`, `sync-drain`/`-status`/`-retry` | outbox | Three names existed for one thing; the table and handlers are the expensive names, so prose yields. |
| Assigned-person row | **`_assignee`** (`fl_survey_assignee`) | `_assignment` | `fl_lead_assignment` is grandfathered — renaming costs a CSV re-import. Documented exception. |
| AI verdict on a lead | **analysis** (`fl_lead_analysis`, handler `analyse`) | assessment, evaluation | Frontend `AiAssessment` → **`AiAnalysis`** (free rename). |
| The word "module" | **product area** (Survey module). Code layer = **service layer** (`src/modules/`). Facilio's = **Facilio module** | "module" for all three | Three meanings was one too many. |
| Table prefix | **`fl_` on every table, no exceptions** | bare table names | One unprefixed table in a shared schema is a permanent wart. |
| Spelling | `analyse*` handlers are **frozen** (API contract). Everything new: **US spelling** | mixed, undocumented | |
| Doc citations | **Always file + section** — "CLAUDE.md §3", "v1.8 §A1.8" | bare "§3" | Three files have clashing §-numbers (this file, `ARCHITECTURE.md`, the survey spec). |

## §1. THE DECISION (locked 13 Aug 2026)

**Entry: Frontline — everything that happens before the work order.** The commercial front-end for FM service providers: enquiry → qualification → survey → quote/proposal → approval → customer acceptance → agreement → live Facilio contract/work orders. Today this journey runs on Excel, generic CRMs, PandaDoc/DocuSign, email and WhatsApp — every step a handover, every handover a loss.

- **D1 — Registration changed.** The submitted entry is the CRM. My Page is dead as an entry (preserved, §13).
- **D2 — MVP depth: quote-to-contract.** The intended cut line: **scenarios 1–6 + 9** — enquiry captured → client created → survey → survey becomes a priced quote → internal approval → customer signs → accepted quote becomes work orders/contract in Facilio. **⚠ v8.7: this cut line is now larger than the build state. See §2 and §9.2 — the demo depth must be re-cut against what exists, not against what this line promises.**
- **D3 — E-signature v1: built-in click-to-accept.** The Imperial YAI proposal defines the evidence bar its PandaDoc signature actually produces: signer name + email, sent/viewed/signed timestamps, IP address, location, email-verification stamp, document reference number, certificate page. Our acceptance record must match **that** — no signing-API dependency, and no "legally binding everywhere" overclaim; say "audited digital acceptance." **⚠ Blocked, not open — see §3a and G3: there is no public unauthenticated page on this platform.**

**Why this owns the gap (the honest architecture):** Facilio holds the operationally hard two-thirds — work orders, scheduling, mobile, checklists, photos, sign-off, asset history (SOW 4.6–4.18). The commercial layer before it — lead, survey, quote, contract — **is the gap**. CIT was preparing to *pay Salesforce* to fill it; Salesforce would be buying a CRM and building field service inside it — we are the mirror image with the hard part already built. Imperial runs the same journey today on walkthrough-notes + PandaDoc. Provider-cluster pipeline (~$4M: C&W, Arcus, Wates, Knight FM, 14 Forty…) says FMSPs are the persona. And CIT already runs Facilio in its wider FM business — this is a competitive event in an adjacent division of an existing account.

**The pitch line — corrected at v8.6/v8.7.** The old sentence was *"the surveyor's walk becomes the asset register, and the asset register becomes the price."* **Assets are out of scope.** The line is now:

> **"The surveyor's walk becomes the priced scope."**

This is still strong, and unlike the old line it matches the reference proposal exactly [M]. **Nobody says the asset-register version to a judge.**

**Primary persona:** the commercial/BD manager at an FM or specialized-services provider — owns pipeline, quote turnaround, win rate. Secondary: the surveyor whose walk becomes the priced scope; the ops lead who today re-keys every won deal.

**Two acquisition motions, one pipeline (Anand call, 13 Aug — stated):** (a) *direct enquiry* — restaurant emails, web form, walk-in (CIT SOW, Imperial); (b) *tender* — an Owner Association's tenderer (mediator) publishes an RFP across 60–70 portals, controls site-visit slots for ~10 competing FMSPs, fields deadline-bound clarifications, and receives the proposal into their ERP. Frontline must speak both. **v8.6 note:** with assets out, the tender motion survives as **intake only** (source tag, tenderer contact, submission deadline, clarifications) — a tender's per-building asset schedules have nothing to land on.

**The demo number must be money:** the Salesforce project CIT was pricing; PandaDoc/CRM licence displacement; quote rework economics (PostHog: 1,243 quotes created, 582 revised — **47% rework**); "customer said yes → technician has the job" as a click, not an afternoon of retyping. Gate G2 picks one crisp number.

## §2. BUILD STATE & TEAM LANES  ★ REWRITTEN AT v8.7 — READ IT ★

> **Ruling (Sudharsan, 13 Aug): Yameen's `WHATWEBUILT.md` is the latest word on what has been built.**
> Everything this section said before v8.7 — a v37 app on `preview-cit-crm` with a quote engine, AI proposal builder, contract types, Letter of Award, proposal PDF export, condition 1–5 scoring, survey scheduling and a pipeline board — **is not in the build of record.** The old text is preserved verbatim in `claude/CLAUDE-v8.5-snapshot-13Aug2026.md`. Do not plan from it.

### 2.1 What actually exists — `frontline` @ `28e3ad9` [M]

**Backend — two functions, both uploaded and exercised against the platform:**

| Function | Handlers | Contains |
| --- | --- | --- |
| `lead` | **23** | capture (`create`) · read (`list`, `get`, `update`, `reference`) · workflow (`transition`, `claim`, `assign`, `log-activity`) · AI (`analyse-input`, `analyse`) · conversion (`convert`) · accounts (`account-list`, `account-get`) · settings (`settings-get`, `settings-put`) · sync queue (`sync-drain`, `sync-status`, `sync-retry`) · web-chat intake (`intake-start`, `intake-turn`, `intake-transcript`, `intake-submit`) |
| `migrate` | 4 | `clean-seed`, `seed-config`, `status`, `verify`. **Deliberately not DDL** — see §3a. |

`src/functions/` also holds **five empty directories** — `core`, `portal`, `quote`, `survey`, `sync`. The names are reserved; **no code**. The intake and sync-queue handlers that were meant to live in `portal` and `sync` are inside `lead`.

**Layers:** `src/modules/` (7 files, ~2,520 lines — the service layer) · `src/domain/` (4 files, 477 lines of pure logic — `lead-state`, `normalize`, `scoring`, `sla`; **this is the tested part**) · `src/shared/` (7 files — `db`, `envelope`, `events`, `facilio`, `ids`, `outbox`, `row-map`).

**Database — 16 tables**, each one a CSV (see §3a): `fl_account`, `fl_account_contact`, `fl_deal`, `fl_event`, `fl_intake_message`, `fl_intake_session`, `fl_lead`, `fl_lead_analysis`, `fl_lead_assignment`, `fl_photo`, `fl_sequence`, `fl_service_area`, `fl_service_coverage`, `fl_service_line`, `fl_setting`, `fl_sync_task`.

**Two agents:** `lead-intake` (conversational capture) and `lead-analyst` (understanding / relevance / score / recommendation). **Both called from the client, never from a function** — see §3a.

**Frontend — React 19 + HashRouter, four surfaces, all wired to live handlers, no mocks and no `[SEAM]` markers anywhere:** Leads (`Inbox`, `LeadDetail` + 6 components) · Accounts (`AccountList`, `AccountDetail`) · Website chat (visitor intake) · Scope & SLA (`Settings`). Plus the app shell, a 13-component UI kit, light/dark theming, and **real Facilio DSM tokens** with `@facilio/icons`.

**Proof it works:** 81 tests passing across 7 files; `scripts/walk.mjs` runs create → analyse → dedup → claim → contact → qualify → convert → drain → confirm the Facilio client exists, entirely through the real platform.

### 2.2 What does NOT exist — and what that costs us

**Zero lines of code:** survey · quote · approval · customer signing portal · work-order handoff · tender ingestion · email-to-lead · analytics/dashboards · SLA alerting. Also **no Deal screen** — `fl_deal` exists as a table with no UI.

**Three consequences that change the plan, not just the paperwork:**

1. **The survey handoff has no consumer.** Sudharsan's lane was scoped to end "at a defined handoff payload" because Yameen's estimation lane would pick it up from a built quote engine. There is no quote engine. **Yameen's P4 is greenfield, not an extension.**
2. **M2 as written ("survey→quote flow end-to-end") is not reachable** in the remaining window if the survey module and the quote module both start from zero. §9.2 re-cuts the gates.
3. **The survey module's primary entry point does not exist.** The spec makes "Deal → Survey tab → New survey" primary; there is no Deal detail page. Either one gets built, or the survey list becomes primary (see v1.8 §A1.0).

**Also gone with the v37 text:** the "condition 1–5 scoring built" claim (it is greenfield), the "survey scheduling with conflict warning built" claim (greenfield), and **C9's framing** — "protect the v36 fix" becomes "build it correctly the first time".

### 2.3 Known blockers [M]

- **No production promotion.** `facilio vibe deploy --prod` has not been run → **no scheduled jobs, no SLA alerting, no polling.**
- **No public app access** → no embeddable widget, no unauthenticated page. **This closes G3 as blocked, not open.**
- **Facilio connection actions are registered as DRAFT** — they go live only when the connection is published from the platform UI.
- **Outbound/inbound email:** not present in `frontline` at all. Combined with jobs-need-production, **"notify" in P1 can only mean an `fl_event` row plus an in-app indicator** (C29).
- `npm run typecheck` does not work — no root `tsconfig.json`, so **the backend is currently typechecked by nothing.** One-line fix; do it before the survey function is written, not after.
- A leftover probe function `tenderprobe` exists and is safe to delete.

### 2.4 Lanes

- **Yameen + Mithun** — CRM core: **the Deal surface**, pipeline, quote/proposal flow, email decision (G7), polish. **P4 (estimation → quote from the survey handoff) is Yameen's** — and it is now understood to be greenfield.
- **Sudharsan** — **(a) the survey side** (§3) and **(b) the platform approach**: Layer-0 architecture, the Facilio write boundary, **`fl_promotion_log`** (§4.2 — assigned here at v8.7 because it was orphaned between three documents), §6 checks, and the milestone gates (§9.2).

## §3. SUDHARSAN'S LANE — THE SURVEY SIDE

**Source of truth for this lane is `claude/survey-module-structure-v1.8.md`.** `survey-module-flow-v3.md` remains valid as the *decision record* (D-S1..S15) but is superseded on structure, hierarchy, assignment and table design. `survey-module-structure-v1.7.md` is superseded by v1.8 and immutable.

**The claim, corrected:** the survey is where the product earns the "FM-native" claim — **the surveyor's walk becomes the priced scope.** Imperial's YAI proposal is the target artifact: a walkthrough produced its specifications ("level of buildup observed during the walkthrough", sq-ft, room counts, 3 service days) and its pricing (one-time deep clean $5,040 + monthly recurring $1,260). The Imperial Site Walkthrough tool (org 1860, read-only) is the production reference for capture UX.

**Scope — soft services only (v8.6 S1–S7):**

- **Hierarchy is three levels: site → building → space.** `floor` and `asset` are **out**. Floors are a `floor_count` number plus an optional `floor_label` on the space — evidence: the production walkthrough reference stores floors as a number, never as a hierarchy level [M].
- **One capture line per SPACE**, not per asset. Condition (1–5) and contamination attach to spaces.
- **No capture-time AI in P1.** Nameplate-photo → asset-type recognition went out with the asset level. The AI assist surface is a nullable `ai_confidence` + `ai_source` pair on captured values, and nothing more.
- **Mobile-first capture** — the surveyor taps **"+ Add another Room"** on a repeatable section, names the entry, answers three questions, moves on. Each entry can create the `space` node, so **the prospect portfolio is built as a by-product of the walk** rather than on a separate tree-building screen.
- **The walk feeds the price** — per-space condition + answers tagged with a stable `estimation_key`, handed over as a frozen payload.
- **C15 (building profile — BMS/IoT, subcontracted assets, critical assets FCU/chillers/lifts) is OUT of the event build.** Every field in it is hard FM. Register-only, post-event.

**The write moment — and the flag Yameen must see (§4.2).** Surveyed portfolio lives in the app DB as the **prospect portfolio** — shape-compatible with Facilio's hierarchy, every node carrying `provenance`, `verdict` and a nullable `facilio_id` (repeat clients link real Facilio records — read, never copy). **Facilio's portfolio is written only at Won + contract signed**, via the idempotent, ancestry-stamped **promotion**; lost deals never touch Facilio and their surveyed tree is retained as commercial intelligence. The demo stages a Won deal so judges still watch the buildings appear in Facilio live.

> Rule of thumb: *Facilio's portfolio holds buildings you are paid to maintain; the prospect portfolio holds buildings you hope to be paid to maintain; **Won is the promotion gate**.*

**Non-negotiable engineering for any Facilio write — the crown jewels, restated for the real platform:**

1. **Ancestry rule:** stamp the full lineage chain on every portfolio record. A record missing a level **saves but silently disappears** from the tree, site-scoped WOs and dashboards. The deepest record is now a **space**, and the rule and its unit tests apply to site→building→space. **Enforce it in the prospect tree (`ancestry_path`) before the promotion ever runs.** Unit-test every create path.
2. **No transaction across connection calls:** log every create in **`fl_promotion_log`** as it happens; on failure walk it in reverse and **deactivate, never hard-delete**; never call it atomic.
3. **Idempotency — rewritten at v8.7, because the old instruction was unbuildable.** The previous text promised `UNIQUE (conversion_log.source_type, source_id, target_kind)` and called it *"the only thing between a retry and duplicate records in a production CMMS."* **The app's DB role cannot create an index** (§3a). So: `fl_promotion_log` carries a deterministic `dedup_key` (`source_type:source_id:target_kind`), and **every promotion write goes through one serialised handler that reads the key before it writes.** State the residual risk honestly — this is a *check*, not a *constraint*, and two concurrent promotion runs on the same deal could still double-write. Mitigation: a single promotion run per deal, guarded on a run row, plus reconciliation against `facilio_id` before each create.
4. **No async on the critical write path:** async function runs die on restart. Synchronous with progress polling, or a resume path reading `fl_promotion_log`.
5. **Agents interpret, functions calculate:** pricing, tax, totals, location logic, sequences, status transitions have exactly one correct answer — never ask a model.

## §3a. PLATFORM CONSTRAINTS — the physics of this build *(new at v8.7 · BINDING)*

These shaped every decision in Yameen's repo and were nowhere in this file. **Every spec must be written against them.** Any requirement that violates one is not a requirement, it is a wish.

| # | Constraint | What it forbids | What to do instead |
| --- | --- | --- | --- |
| **P1** | **No DDL.** The app's DB role cannot create, alter, drop or **index** anything. A CSV *is* the schema — `facilio vibe db import` infers columns from a header row plus one type-inference seed row. | `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `CREATE SEQUENCE`, unique constraints, partial indexes, foreign-key constraints | Design every column before the first import; there is no migration path. Enforce uniqueness and referential integrity **in the function layer**, and say so. |
| **P2** | **No indexes → full scans** on every table. | Assuming a lookup is cheap | Fine at demo scale. State it as a known week-one limit rather than discovering it. |
| **P3** | **No real sequences.** | `count + 1` (two phones collide) *and* `CREATE SEQUENCE` | The built pattern: an **`fl_sequence`** table seeded by `migrate.seed-config`, incremented with a single `UPDATE fl_sequence SET … RETURNING` — row-locked and safe. |
| **P4** | **Preview and production share one database.** | Any non-backward-compatible schema change | The N-1 rule: additive only, always. |
| **P5** | **A function cannot wait for a model.** Agents are callable **only from the client**. | Server-side AI calls; AI inside any workflow or state machine | The built two-call split: `analyse-input` hands out the prompt → the client calls the model → `analyse` stores the reply with its inputs and confidence. Reuse it; it also satisfies §6 #6 and #7. |
| **P6** | **Static hosting, no rewrite rules** → HashRouter; a real path 404s on reload. | Clean deep links | Hash URLs. Fine for authenticated users. |
| **P7** | **No public app access.** Vibe apps are SSO-gated and public access is not granted. | The embeddable widget, any unauthenticated page, C1's acceptance link as a Vibe page | **G3 is blocked, not open.** C1 needs an off-Vibe host (facilio.run / a Facilio portal / a signed-token page) or it is out of the event. |
| **P8** | **Jobs fire only on production**, and production has not been promoted. | SLA alerting, scheduled chasing, any polling job, notification jobs | In-app + `fl_event` (C29). Promote deliberately (G8) before scheduling anything. |
| **P9** | **Connections are registered as DRAFT** until published from the platform UI. | Assuming `executeAction` works today | Publish deliberately; keep the G1 pass as the gate before any `executeAction`. |
| **P10** | **The backend is typechecked by nothing** (no root `tsconfig.json`). | Trusting green CI | Add the root `tsconfig.json` covering `src/` **before** the survey function is written, and expect real errors on the first run. |

## §4. SCOPE BOUNDARY — WHERE FRONTLINE ENDS AND FACILIO BEGINS

Judges score **gap awareness**. The boundary is the answer: *the commercial pipeline is ours; the building and the work belong to Facilio.*

- **Frontline owns:** enquiry → qualification → survey → quote/proposal → approval → acceptance → agreement → **the promotion writes**.
- **Facilio natively owns (do not rebuild, not even a toy):** work orders, scheduling/dispatch, mobile technician app, checklists, proof of service, invoicing, payments, QR asset history, PPM/recurring execution. The nav's "Delivery — Soon" items stay "Soon."
- **The handoff is the demo's hero moment:** accepted quote → work orders/contract exist in Facilio → Facilio generates the recurring programme. Stop there; pointing at native Facilio *is* the platform pitch.
- **DLP (defect liability period) stays across the boundary** *(Anand, stated)*: new-building defects raised against the developer are field observations → the recommendations/WO loop on the Facilio side. Record the concept; build nothing.
- **Read from Facilio, never copy:** store only Facilio record ids (clients, sites, spaces, services, tax codes…) — a mirrored name goes stale and fragments the source of truth.
- Six ideation ideas died by collision with existing capability (Atom intake, photo validator, Luca, Copilot/Willow briefing, CAFM sync, QR page). Assume anything new needs a roadmap check before commitment.

### §4.1 Two words, two operations — do not mix them *(v8.7)*

| Operation | Word | What it does | When |
| --- | --- | --- | --- |
| Lead → Account + Contact + Deal | **`convert`** | Creates the commercial records in the app | At qualification |
| Prospect portfolio → Facilio | **promotion** (`fl_promotion_log`) | Creates site/building/space in the CMMS | **Won + contract signed only** |

### §4.2 ⚠ FLAG FOR YAMEEN — the customer is created at Won, not at convert *(Sudharsan, 13 Aug)*

`lead.convert` today creates the commercial records **and pushes a client into Facilio FSM** — `walk.mjs` ends by confirming the Facilio client exists [M]. Sudharsan's position, recorded verbatim in intent:

> *"Whatever we have decided, the lead gets converted to customer only when a deal is won. The same person can come as a lead again, but the status should already be a customer-tagged status."*

**So there are two rules here, and both need Yameen's eyes before he builds further:**

1. **A lead becomes a *customer* only at Won.** Before that it is a prospect/account record inside Frontline. Whether a Facilio *client* record may exist earlier — and under what status — **is not settled**; the exact status vocabulary is unknown and must be checked against Facilio's own client statuses in the G1 pass. **Do not assume the current `convert` behaviour is correct, and do not silently keep it.**
2. **A repeat lead from an existing customer must be recognised as one.** The same person or company can arrive again as a new enquiry; the system must surface them **already customer-tagged**, not create a second account. This is **C28**, and it extends the existing dedup work rather than being new machinery.

## §5. EVIDENCE BASE & MARKET-REQUIREMENT SOURCES

| Source | Status | Use |
| --- | --- | --- |
| **Yameen's `WHATWEBUILT.md`** (repo inventory, `28e3ad9`) | **Read 13 Aug — now the build state of record (§2)** | Ground truth for what exists. Superseded the v37 feature list. |
| **`claude/frontline-alignment-audit-v1.md`** | Written 13 Aug | The three-way diff that produced v8.7. Read it before touching either spec. |
| CIT Salesforce SOW (project file) | Read 13 Aug | Requirement spec, demo-scenario template (SOW §8), hard-money evidence. Coverage matrix §7. |
| CIT CRM build log (`CITCRMConversation.md`) | Read 13 Aug | **Historical.** Describes the v37 cit-crm app, which is not the build of record. Cite for decisions and blockers, never for build state. |
| Vibeathon session record | Read 13 Aug | Research base, Frontline spec, architecture, traps, open questions (§12). |
| **Imperial** — YAI/Williston Park proposal + Site Walkthrough tool (org 1860) | Read 13 Aug | The real artifact to beat: walkthrough → specs → optional services → one-time + recurring pricing → acceptance + PandaDoc certificate. Sets D3's evidence bar and the proposal-PDF anatomy (§7.2). |
| CBRE UK GWS 14-requirements sheet | Read 13 Aug | AI-behaviour checks (§6). Build-phase reference, never demo-named. |
| **Berkeley Anand call notes** (OA/tender motion) | Triaged 13 Aug (G6 closed) — all claims STATED, single call | Tender motion; OA→tenderer→FMSP structure; contract-type economics; mobilization/DLP. → C13–C17. Numbers ($500 threshold, 60–70 portals, ~10 bidders) are illustrative, never hardcoded or pitch-quoted as measured. |
| AI-corner call analysis CSV, Issues.csv, PostHog/Postgres | On file / connected | Pain quotes ("estimation done in external Excel"), quote-rework 47%, adoption-risk signals (SVH reverted to Micromain — UX is existential, not cosmetic). |
| **NOT YET IN THE PROJECT** — `ARCHITECTURE.md`, `API.md`, `Survey Backend Plan v1.md`, `Survey Terminology Audit v1.md` | **Gap** | The first two hold the real field names and handler contract; the last two are survey-lane documents written outside this project that already record deviations from the spec. **Get them in before v1.8 is treated as final.** |
| Funnel lineage v4–v6 + stage1 extraction + mother doc v7 | Frozen archive | Cite, don't edit. |

## §6. AI-BEHAVIOUR CHECKS (CBRE-derived — mandatory for every AI feature)

> **DOCTRINE (Sudharsan, 13 Aug — binding on every lane, every module, every doc): humans act, workflows automate, AI assists.** Every action in Frontline has a human owner and a working manual path. Anything deterministic (status transitions, pricing, routing, notifications, escalations) is a workflow/function — never a model call. AI enters only where genuine interpretation is needed (unstructured text, photos, extraction), always as an optional layer ON TOP of the human path, always §6-checked. If any spec — including from Yameen or Mithun — frames an action as AI-only or AI-first, stop, step back, and re-derive it from this doctrine before building. No document or conversation in this project may carry a contrary notion.
>
> **v8.7 addition — the doctrine now has a platform guarantee behind it (§3a P5):** a Vibe function *cannot* call a model. AI is structurally incapable of sitting inside a state machine here. That is worth saying to a judge.

- **#6 Confidence on everything** — every AI decision records a confidence score.
- **#3 Threshold → human** — below-threshold routes to a human; thresholds configurable per decision class.
- **#7 Explainable audit** — inputs → reasoning → decision → confidence, viewable and exportable. *Show this screen in the demo* — it converts a trust risk into a Domain Excellence point (2026's theme is trust: >40% of agentic projects heading to cancellation). **The built `analyse-input` → `analyse` split already stores exactly this.**
- **#2 Graceful fallback** — never block creation on a missing field; create on best-available, flag for enrichment.
- **#10 Duplicate detection at creation** — probable duplicate account/deal surfaced, logged, human-decided. Extend to **C28** (repeat lead from an existing customer).
- **#13 Per-account AI-vs-human orchestration** — settings for what AI may do (draft-only vs draft-and-nudge).
- **#15 Unstructured sources first-class** — email/RFQ/Excel ingestion handled realistically; nulls, duplicates and odd statuses shown, never masked.
- **#1 Integration hygiene** — every Facilio write authenticated, idempotent (§3.3 as rewritten), retried, audit-logged (**`fl_promotion_log` + `fl_event`**).
- **#5 Adaptive chase** — quote follow-ups on absolute time-to-expiry, not fixed percentages. *(Needs jobs → needs production, P8.)*
- **C8 rule:** AI drafts, humans send. No autonomous outbound commercial documents.
- N/A (voice/intake-specific, on record): #4, #8, #9, #11, #12, #14.

## §7. REQUIREMENT COVERAGE

### 7.1 CIT SOW §4.x → Frontline *(dispositions corrected at v8.7 against the real build)*

| SOW area | Disposition |
| --- | --- |
| 4.1 CRM management | **Partial** — leads, accounts, deal *table*, sync queue built. **No Deal UI, no pipeline board** |
| 4.2 Site survey | **Sudharsan's lane** (§3) — **greenfield, zero code.** `src/functions/survey/` is empty |
| 4.3 Service catalogue & pricing | **Not built.** `fl_service_line`/`_area`/`_coverage` exist as app-local scope tables — **see C23 and §14** |
| 4.4 Quotation (incl. e-acceptance) | **Not built.** And the acceptance link is **blocked** by P7, not merely open |
| 4.5 Agreement/contract | **Not built** |
| 4.6–4.16 WO/scheduling/mobile/PoS/invoice/QR/recurring | **Facilio native — handoff, don't build** (§4) |
| 4.17 Recommendations → additional work | **Not built.** Folded into survey answers for P1 (v1.8) |
| 4.18 Portal | Post-event. Blocked by P7 |
| 4.19 Dashboards | **Not built** |
| 4.20 Audit trail | **Partial — `fl_event` + `shared/events.ts` exist.** This is the audit spine; every module writes to it (C18) |
| 4.21 Role-based access | **Not built as a module.** And `lead.*` permission keys are not registered — C24 gap on Yameen's side (L18) |
| SOW §8 demo scenario | **Re-cut required.** See §9.2 |

### 7.2 Imperial YAI proposal → proposal-PDF anatomy (the market's actual format)

Cover letter (personal, from a named manager) · capability sections (QA/comms, onboarding — reusable boilerplate) · **specifications derived from the walkthrough** (sizes, areas, condition observations, client preparation, schedule) · **optional services** (upsell menu → optional-excluded-from-total lines) · pricing table with **one-time + recurring lines** · acceptance page (dual signature, date authorized vs expected start) · billing information · **certificate of signature** (the D3 bar). Frontline's proposal export should be able to stand next to this document without embarrassment.

## §8. BUILD REQUIREMENTS REGISTER (live — C-numbers, never deleted)

- **C1 — Click-to-accept with certificate parity** *(D3 + Imperial)*: review link, accept/reject+reason, name, email-verification, sent/viewed/signed timestamps, IP, doc ref; revision loop on reject. **⚠ Blocked by P7 — needs an off-Vibe host or it leaves the event.**
- **C2 — Idempotent Facilio promotion** *(§3.3, REWRITTEN v8.7)*: `fl_promotion_log` with a deterministic `dedup_key`; **read-before-write inside one serialised handler**, because no unique index can be created (P1); reverse-walk deactivation on failure; never hard-delete; residual concurrency risk stated, not hidden.
- **C3 — Ancestry stamping on every portfolio write** *(§3.1)*: site→building→space; enforced in `ancestry_path` on the prospect tree; unit-tested per create path.
- **C4 — No async on critical writes** *(§3.4)*.
- **C5 — Append-only lifecycle audit** *(SOW 4.20)*: **one spine, `fl_event`.** Per-module status-log tables are forbidden — that is how you get five audit trails and no audit.
- **C6 — Role-based access incl. unmanaged→Home-only** *(now a build item, not a regression guard)*.
- **C7 — Tenant/org scoping on every query and action** *(judging, Eng #3)*.
- **C8 — AI drafts, humans send** *(§6)*.
- **C9 — Survey capture works without a Facilio site** *(reframed v8.7: build it right the first time; the "v36 fix" it referred to is not in this codebase)*.
- **C10 — Optional quote lines shown but excluded from totals** *(now unbuilt; matches Imperial's optional-services pattern)*.
- **C11 — Rate-card pricing adjusted by condition score** *(survey → price integrity; depends on D-e, the scale direction)*.
- **C12 — Recurring line support on quotes/contracts** *(Imperial one-time + monthly pattern; SOW 4.16 handoff)*.
- **C13 — Tender-motion intake** *(Anand, stated · IN EVENT BUILD — **INTAKE ONLY** per v8.6 S7)*: tender/portal source tag, tenderer as a party, **submission deadline** on the deal; clarifications chased against absolute time-to-deadline (§6 #5). No portal integration — email/manual capture is the honest v1. The tender's asset schedules have nothing to land on now.
- **C14 — Semi-comp liability threshold** *(Anand, stated · IN EVENT BUILD)*: semi-comprehensive carries a configurable **threshold amount** (not only a %); threshold prints on quote/agreement; semi-comp is the demo's default contract type. $500 is one call's example, never hardcoded.
- **C15 — Survey building profile** *(Anand, stated · **REGISTER-ONLY, POST-EVENT** per v8.6 S6 — was IN EVENT BUILD)*: new/old, year built, floors, BMS/IoT, subcontracted assets, emergency-team-stay, critical assets (FCU/chillers/lifts). Every field is hard FM.
- **C16 — Deal party roles** *(Anand, stated · REGISTER-ONLY)*: OA/client, tenderer/consultant, developer, tenant as distinct contact roles. v1 workaround: tenderer as a tagged contact.
- **C17 — Mobilization stage** *(Anand, stated · REGISTER-ONLY, post-event)*: LOA precedes PO; between Accept and contract start sits a mobilization checklist. Violates the cut line — do not build during the event.
- **C18 — Record history & logs, platform-wide** *(MUST-HAVE)*: field-level history on every record; activity log; email log; automation log; record-ID/numbering management. **Mechanisms already exist: `fl_event` + `fl_sequence`. Extend them; do not fork them.**
- **C19 — Search, platform-wide** *(MUST-HAVE)*: global search (semantic + keyword), per-module search, list-view filters and saved views. **Built once across leads, accounts, deals, quotes, contracts and surveys — never per module.** Each module ships one hardcoded default list in P1 and registers its filterable fields.
- **C20 — WCAG colour/contrast + accessibility** *(MUST-HAVE)*: `design:accessibility-review` runs at every M-gate. **The DSM token set and 13-component kit already exist — reuse, don't invent.**
- **C21 — Persona-first interfaces** *(STANDING DUTY)*: every module/screen reviewed per persona at each M-gate and in every spec.
- **C22 — Survey-optional deal path**: simple customers quoted directly from a call. **v8.7 clarification: this is legal because Survey is an *object attached to a deal*, not a deal *stage*.** No jump-override hack needed.
- **C23 — Services from Facilio's Services module ONLY** *(Sudharsan, 13 Aug · **HELD AS WRITTEN**, reaffirmed 13 Aug)*: every service referenced anywhere — survey expectations, rate card, quote lines, contract lines — is a **Facilio Services record id**, never an app-local service definition. **⚠ The built `fl_service_line` / `fl_service_area` / `fl_service_coverage` are app-local. Flagged to Yameen (§14) to look into. Blocked on L10 (the Facilio Services read action + id shape) — resolve it in the G1 pass; until then ship the referencing columns nullable rather than inventing a local catalogue.**
- **C24 — Users/roles/permissions module** *(extends C6)*: users, roles, per-module permissions; **every module registers its permission set**; Admin manages Setup including AI-agent prompts. Layer-0. **Gap: the built `lead` function registers none (L18).**
- **C25 — Provenance + enrichment history**: every record carries provenance (`rfp` / `survey` / `crm` / `facilio_link` / `manual`); when survey data updates an RFP-seeded value the prior value stays in history and provenance updates — **no silent overwrites, ever.**
- **C26 — Promotion pre-flight screen** *(renamed from "Won-conversion resolution screen", v8.7)*: before the promotion writes, a screen lists every prospect node with missing/unmapped mandatory fields (category, type, enums) for the user to resolve. **Enrichment happens at the gate, not after.**
- **C27 — Deal copilot Q&A** *(NICE-TO-HAVE, after core)*: ask questions over a deal's RFQ/docs + prospect portfolio. Run the §4 collision check vs product Copilot first; deal-scoped only.
- **C28 — Lead → customer status resolution** *(Sudharsan, 13 Aug · NEW at v8.7 · see §4.2)*: a lead becomes a **customer only at Won**; a repeat enquiry from an existing customer must surface **already customer-tagged**, not create a second account. Extends the existing dedup path (§6 #10). The exact Facilio client-status vocabulary is unverified — check in the G1 pass.
- **C29 — "Notify" means event + in-app in P1** *(NEW at v8.7)*: email is absent from the build and jobs need production (P8). Every notification in every spec — assignee notified, deal owner notified on survey completion, chase reminders — is an **`fl_event` row plus an in-app indicator** until G7 resolves email. **No spec may assume an email will arrive.**
- *(C30+ append as evidence arrives, with source tags)*

## §9. JUDGING GATES

### 9.1 Two rubrics, one behaviour

The event rules name three criteria — **FM solution** (real Monday problem), **platform leverage** (Vibe's blocks used, not worked around), **design & product quality**. The judges' PDF details four 25% categories — Domain Excellence, Engineering Excellence, User Experience, Product Readiness. Treat the PDF's 20 sub-criteria as the checklist; the three rules-criteria as the summary story.

- **Domain:** edge cases (duplicate leads, repeat customers arriving as leads, mid-approval revisions, rejected acceptances, unmapped sites); gap awareness (§4); data realism (email/Excel-first world); grounded ROI (G2).
- **Engineering:** real records with nulls/duplicates/long strings — failures **shown**; bulk queries, limits, joins in SQL, no queries in loops; secrets server-side; loading/empty/error states everywhere; idempotent writes; **and — a genuine strength — the platform constraints in §3a named out loud, with the design that respects them.** A team that can say "we cannot create an index, so here is how we made retries safe anyway" scores better than one that claims a constraint it never hit.
- **UX:** purpose obvious in seconds; core flow in few steps; one visual system; every click reacts; copy says what will happen. (SVH reverted to Micromain over a slow interface — UX is churn-risk, not polish.)
- **Readiness:** scope discipline (§2.4 lanes + §4 boundary are the defence); end-to-end, nothing mocked, no dead ends — **the repo currently contains no mocks and no seam markers anywhere; protect that**; deployed to production (P8 — the deliberate Publish has not happened); a new user starts unaided.

**Vibe-block scorecard — §9.1 says all seven must earn their place. Honest state at v8.7:**

| Block | State | Owner of the gap |
| --- | --- | --- |
| DB | ✅ 16 tables, real data | — |
| Functions | ✅ 2 uploaded, 27 handlers | — |
| Agents | ✅ 2, client-side per P5 | — |
| Connections | ⚠ **registered DRAFT, not published** | Yameen (publish + G1) |
| Files | ⚠ `fl_photo` exists; no capture UI | **Survey lane — walk photos** |
| Jobs | ❌ needs production (P8) | Yameen (G8) |
| Websocket | ❌ unused | **Survey lane — two surveyors on one building, live** |

**3.5 of 7.** The survey lane is the natural owner of **files** and **websocket** — that is a judging-driven reason the lane earns its place, not only a scope argument.

### 9.2 Milestone protocol *(re-cut at v8.7 — the old M2 assumed a quote engine that does not exist)*

- **M1 — Survey lane scope frozen** (v1.8 published; D-a..D-p answered) **+ the build-state truth recorded** (§2). *Done at v8.7.*
- **M2 — Survey end-to-end, standing alone**: create → schedule → assign → walk (repeatable sections, photos) → reconcile → submit → **a frozen handoff payload that can be opened and read**. This is the new M2: it does not depend on a quote engine, and it is demoable by itself.
- **M2b — Handoff consumed** *(Yameen)*: the payload renders as draft quote lines. Only after M2.
- **M3 — Promotion works** (C2, C3, C4, C26 proven on a staged Won deal, with the retry shown).
- **M4 — AI features pass §6** — and P5 is stated as the reason no AI sits in a state machine.
- **M5 — Full rehearsal including one shown failure** (a bad email lead, a rejected acceptance, an unmapped site, or a promotion retry).

At each gate score all four judging categories honestly out of 5 in-chat; anything ≤3 becomes the next work item before new features. `eval-verdict` owns final scoring.

## §10. SKILL MAP

| Phase / trigger | Skill |
| --- | --- |
| Always — voice, decision style, bias control | `sudharsan-replica` |
| New evidence (transcripts, exports, repo inventories) | `discovery-impact-triage` |
| Spec work on any layer | `socratic-prd-coach` → `product-management:write-spec` / `product-doc-builder` |
| Scope fights, idea pressure-testing | `product-management:product-brainstorming` + §11 |
| Building | `facilio-vibe:facilio-vibe` → `vibe-basics`, `vibe-db`, `vibe-functions`, `vibe-connections`, `vibe-ai-agents`, `vibe-jobs`, `vibe-websocket`, `vibe-files`; `vibe-connectedapp` only at the very end (**irreversible toggle**) |
| Agent-shaped AI features | `facilio-agent-builder` (build) → `eval-verdict` (score) — never self-declared |
| Charts/dashboards | `dataviz` before the first line of chart code |
| UX passes at M-gates | `design:design-critique`, `design:ux-copy`, `design:accessibility-review` |
| Milestone/judge scoring | `eval-verdict` + §9 checklist |

## §11. DEVIL'S-ADVOCATE STANDING QUESTIONS (answer before judges ask)

1. **"Why not Salesforce/HubSpot + integration?"** CIT's SOW is the answer: 21 functional areas, partners, custom dev, licences — to make a CRM understand FM. Frontline is FM-native (sites, spaces, condition, rate cards, recurring frequencies) and lands the deal in the delivery platform with zero re-keying.
2. **"ServiceTrade already has a kitchen-exhaust vertical."** True — and it covers most of CIT's 21 areas natively. Our wedge: the customer's *delivery* already runs (or can run) on Facilio; Frontline makes the CMMS the system of record from first enquiry, plus likely ServiceTrade gaps (Mada, Arabic, region). Position against it; don't pretend it isn't there.
3. **"TYTEN says no new interfaces — why build one?"** Because the surveyor and the BD manager have *no* interface today, not a bad one — their tools are a clipboard and Excel. The web-chat intake honours the same principle: enquiries keep arriving the way they already arrive.
4. **"Is click-to-accept legally enough?"** Match the PandaDoc certificate's evidence set (C1) and call it audited digital acceptance. *And be honest that P7 currently blocks the page itself.*
5. **"Where's the money?"** Displaced CRM + doc-tool spend, the Salesforce project CIT budgeted, 47% quote rework, and the retyping gap between "yes" and "job scheduled." G2 picks the one number to say out loud.
6. **"Isn't a CRM too big for two days?"** A CRM is. **And v8.7 proves we are willing to say so out loud**: the build state was corrected downward the moment the code was read. The cut line is the survey lane end-to-end (M2) plus the promotion, with the "Soon" tabs defended proudly.
7. **"You cut assets — isn't that the FM part?"** Soft services is a real market with a real artifact (the reference proposal). Cutting the hard-FM asset spine on day one, with the evidence for it written down (the production walkthrough tool stores floors as a number [M]), is scope discipline, not retreat. C15 and the asset level are register-only, not forgotten.
8. **Bias check (per project instructions):** at every M-gate — are we building this because the market pulled it, or because we pivoted and need to be right? Cite evidence lines, not enthusiasm. The strongest self-critique on record: *the real gap is features that exist and nobody uses* — Frontline must be the thing that fills Facilio in, not another module that sits empty.

## §12. GATES & OPEN QUESTIONS (before the relevant build hour)

- **G1 — Connections truth. STILL OPEN, AND NOW BLOCKING FOUR LEDGER ITEMS.** On org #984, before app code in the survey lane: can building/space be created via connections (load-bearing for inline creation)? resourceType/spaceType discriminators? do create actions maintain roll-up counters? does the photo action accept a capture timestamp? **does the Facilio Services read action exist and what is the id shape (L10 → C23)? does Facilio hold a trade/skill master (L13)? is the platform user list readable and can permission keys be registered per module (L14)? what are Facilio's client statuses (C28)?** Also: contract service-line enum values (a mismatch fails silently and PPM never generates). Write `/docs/connections.md` + `/docs/enums.md`; **no `executeAction` until they exist.** *(Trap: `surveyTemplate`/`surveyResponse` are feedback questionnaires, not site assessments — see §0a.)*
- **G2 — Money number** chosen and rehearsed (§1).
- **G3 — Public acceptance page. ⛔ BLOCKED, not open** *(upgraded at v8.7)*: P7 — no public app access is granted. Decide the off-Vibe mechanism (facilio.run / Facilio portal / signed-token page) or take C1 out of the event.
- **G4 — Write moment** — ✅ CLOSED for the portfolio (prospect-until-Won, §3). **⚠ REOPENED narrowly for the customer record** — see §4.2 and C28.
- **G5 — Demo script** drafted from the re-cut M-gates (§9.2), including one shown-failure beat and the live Facilio promotion.
- **G6 — Berkeley Anand doc** — ✅ CLOSED 13 Aug. Residual unknowns (is Berkeley a Facilio account? real tender-vs-enquiry mix? typical semi-comp threshold range?) resolve post-event before any pitch claim quotes them.
- **G7 — Email go-live**: Resend + verified domain, or demo with the manual-paste fallback declared honestly. **Until then C29 governs every notification.**
- **G8 — Production publish** done deliberately before jobs are scheduled; org identity (#984 vs 1860) resolved before any metadata cloning.
- **G9 — Rehearse §11** answers; verify the registration copy reflects the CRM entry.
- **G10 — ⚠ NEW: the four missing documents** (`ARCHITECTURE.md`, `API.md`, `Survey Backend Plan v1.md`, `Survey Terminology Audit v1.md`) into the project. The terminology audit in particular was written outside this project and may contradict §0a on specific field names. **v1.8 is not final until it has been reconciled against them.**
- **G11 — ⚠ NEW: root `tsconfig.json`** added so the backend is typechecked at all (P10), before the survey function is written.

### Ledger

**Answered at v8.7:**
**L11** — partial unique index for the one-lead rule → **NO** (P1). Function-level guard; residual race stated.
**L12** — real DB sequence for numbering → **NO** (P1). Use `fl_sequence` + `UPDATE … RETURNING` (P3).

**Open:**
**L9** — enum/category mandatory-field list for the promotion pre-flight screen. *G1.*
**L10** — Facilio Services read action + id shape. **Blocks C23.** *G1.*
**L13** — does Facilio hold a trade/skill master on users? If yes, link, never copy. *G1.*
**L14** — user-module readiness: is the platform user list readable, can permission keys be registered per module? *G1.*
**L15** — does `jsonb` survive `facilio vibe db import`'s CSV type inference, or does everything land as `text`? ~12 survey columns depend on it. *Before the first survey CSV.*
**L16** — the notification mechanism, presumed `fl_event` + in-app (C29). *Confirm.*
**L17** — can `fl_photo` carry the survey attachment columns (`kind`, device `captured_at` vs server `uploaded_at`, geo) **without an ALTER** (P1)? If not, survey attachments need their own table after all.
**L18** — do `lead.*` permission keys exist? C24 says every module registers its set.

## §13. PRESERVED ITEMS (do not lose)

1. **FM OS — My Page** (v7 entry, full dossier in `claude/vibethon-mother-doc-v7.md`): dead as entry per D1; its usage evidence (13%/92%, 4.3-min sessions) and R1/R6/R7 requirements are inherited into §6/§8.
2. **Coverage Intelligence / Zero-Dollar WO** → future product candidate (v7 §4.1).
3. **Duplicate Guard** → backlog; its at-creation pattern reused in §6 #10 and now in **C28**.
4. **Provider Cockpit** → adjacent evidence for §1; CSM verification step still open, feeds §11.
5. **Record-skills layer, email triage, CIT account routing** → unchanged from v7 §4.
6. **Shelved pieces:** survey-approval public form (blocked by P7), procurement portal, delivery-half tabs. **The app naming decision is CLOSED — the app is Frontline (§0a).**
7. **The v37 `cit-crm` feature list** — quote engine, AI proposal builder, contract types, LOA, proposal PDF export, pipeline board, 360 account page, AI fit + deal health, survey scheduling, condition scoring, currency config. Not in the build of record, but a **design reference** for anyone building those surfaces now. Full text: `claude/CLAUDE-v8.5-snapshot-13Aug2026.md` §2.
8. **Hard-FM return path:** the asset hierarchy level, C15's building profile, `survey_discipline` and its coverage guard, and the tender asset schedules all become valid again the day hard FM comes back. Their reasoning is preserved in `claude/survey-module-structure-v1.7.md`.

## §14. HANDOVER — WHAT YAMEEN AND MITHUN NEED TO KNOW *(new at v8.7)*

Nine lines. Everything else is detail.

1. **Read `claude/survey-module-structure-v1.8.md`, not CLAUDE.md §3, for the survey lane.** And read §0a — the glossary is binding.
2. **The survey lane is soft services only.** No assets, no floors as a hierarchy level, no building profile. **Site → building → space.**
3. **The module boundary is unchanged:** the survey ends at submit with a **frozen handoff payload** — prospect tree, per-space condition, answers tagged with `estimation_key`, qualifications, `not_visited_pct`. Estimation and pricing remain entirely Yameen's. **The payload is now specified, in v1.8 — it previously existed nowhere.**
4. **⚠ "Convert" and "promotion" are two different operations** (§4.1). `convert` = lead→deal. **Promotion** = prospect portfolio → Facilio, at Won only. If you are about to write `conversion_log`, write **`fl_promotion_log`** instead.
5. **⚠ A lead becomes a customer at Won, not at convert** (§4.2, C28). `lead.convert` currently pushes a Facilio client at qualification. Sudharsan's rule: customer status is a Won outcome, and a repeat lead from an existing customer must surface **already customer-tagged**. Check Facilio's own client statuses in the G1 pass before changing anything — but do not assume today's behaviour is right.
6. **⚠ Services must be Facilio Services, wherever they are used** (C23 — reaffirmed, not amended). `fl_service_line` / `fl_service_area` / `fl_service_coverage` are app-local. **Please look into it.** L10 (the Services read action + id shape) is unresolved, so the honest move is nullable reference columns until G1 answers it — not a local catalogue that hardens.
7. **You cannot ALTER a table or create an index** (§3a P1–P3). Design columns before the first CSV. Uniqueness lives in the function layer. Numbering uses `fl_sequence` + `UPDATE … RETURNING`.
8. **"Notify" means `fl_event` + in-app** until G7 (C29). No spec may assume an email arrives.
9. **Two things to do before writing new code:** add the root `tsconfig.json` (G11 — the backend is typechecked by nothing), and **build the Deal detail surface** — the survey module's primary entry point depends on it (§2.2).
