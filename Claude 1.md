<!--
  CLAUDE.md — VIBETHON MOTHER DOC v8.7.3  ★ PRIMARY GOVERNING FILE ★
  Canonical name: claude/CLAUDE.md (Vibethon project)
  Author: Claude (with Sudharsan) · 13 Aug 2026 (event day 1)
  SUPERSEDES claude/vibethon-mother-doc-v7.md and the v8.6 amendment file (now folded).
  FROZEN SNAPSHOT of the previous state: claude/CLAUDE-v8.5-snapshot-13Aug2026.md — cite, never edit.
  CHANGELOG (newest first)
  v8.7.3 — 14 Aug 2026: FOUR STANDING REQUIREMENTS REGISTERED (Sudharsan, 14 Aug, on review of the
       Prospect Portfolio spec). All land in §8; one ledger item added to §12; §1–§3 untouched, so no
       snapshot required. The v8.7.3 amendment file is now folded and deleted.
       C35 — every field, in every module, carries help text saying WHY it exists. Trigger, on record:
            he read a spec and could not tell what six fields were for. If the author has to explain a
            field in a chat message, the field is under-specified.
       C36 — every module spec defines LIFECYCLE + PERSONAS + operations + special actions. His stated
            reason: "I will build the permission set for each of these modules based on this."
            survey-module-structure-v1.8.md is the template — the standard existed, it was never mandated.
       C37 — AI portfolio ingest from documents AND SITE PLANS. Checked first: it was not in this file.
            CRITICAL AI NEED, explicitly NOT P1. Constrained by §3a P5 (a function cannot call a model).
       C38 — the promotion's full output mapping: account → Facilio CLIENT + CLIENT CONTACT, portfolio →
            site/building/space, accepted quote → CONTRACT. Agrees with C28; applied, it fixes F-08.
       Also logged: claude/prospect-portfolio-module-spec-v1.md (v1 · 14 Aug) and its v1.1 successor —
            the prospect portfolio is now its OWN product area, not survey §A1.3. See §3 and §14.
       L22 added (Facilio Client Contact create via connections — blocks C38 output #1).
  v8.7.2 — 14 Aug 2026: STANDING RULE ADDED (Sudharsan, verbatim intent: "Use Facilio command skill
       always whenever you are building and running"). §0.2a is new and BINDING: before building,
       running, deploying or debugging anything on a Facilio surface, load the matching Facilio skill
       FIRST and follow it — never work from memory of the CLI, the SDK or the API. §10's skill map
       re-cut to name the trigger for each Facilio skill rather than listing them as a menu.
       No change to §1–§3, so no snapshot required.
       Also logged: the QA + domain review of the four built modules — claude/frontline-qa-verdict-14Aug2026-v1.md
       (bug pass) and claude/frontline-domain-review-14Aug2026-v2.md (personas, handovers, forms,
       lists; 95 IDed issues). Live triage board: https://frontline-triage.facilio.run
  v8.7.1 — 14 Aug 2026: C30 registered — the Account Delivery Intelligence agent (Sudharsan's insight:
       quote the next deal knowing how the last contract actually ran). REGISTER-ONLY, post-event.
       §13.2 cross-referenced. No other change; §1–§3 untouched, so no snapshot required.
       NOTE: a further queue of edits (Proposal terminology sweep, payment terms, work-order-originated
       proposals, the corrected Imperial anatomy, the settled rate-card model) is HELD in
       claude/q3-evidence-and-queued-edits-v1.md §3 and is NOT applied — Sudharsan folds it in only when
       the Proposal Model Spec is final.
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

# CLAUDE.md — Frontline: FM CRM, Lead-to-Contract · Vibethon Mother Doc v8.7.3

> **Event is live:** Thu 13 Aug 10:00 → **Sat 15 Aug 12:00 IST (extended)**. Team: Sudharsan, Yameen, Mithun. Platform: Facilio Vibe (mandatory).
> **Build of record: the `frontline` repo**, deployed to **preview only** at `preview-frontline.vibe.facilio.com`. Demo org **#984**; Imperial org **1860** is a read-only production reference — resolve any org confusion before cloning metadata.
> **Read §2 before you plan anything.** It changed materially at v8.7.
> **Current QA/design state: 95 IDed issues, 12 P0** — see `claude/frontline-domain-review-14Aug2026-v2.md` and the live board at **https://frontline-triage.facilio.run**.

## §0. HOW EVERY CHAT IN THIS PROJECT MUST RUN

1. **Start of every chat:** `project_read` this file. Locate the current milestone (§9.2), the open gates (§12), the build state (§2) and the platform constraints (§3a). Do not re-litigate locked decisions (D1–D3) unless Sudharsan explicitly reopens them — snapshot first.
2. **Skills are not optional.** Apply the map in §10. `sudharsan-replica` sets voice and decision style throughout. New evidence (transcripts, exports, repo inventories) goes through `discovery-impact-triage` before it changes scope.

### 2a. ⚠ THE FACILIO SKILLS ARE MANDATORY BEFORE ANY BUILD OR RUN *(new at v8.7.2 · BINDING · Sudharsan, 14 Aug 2026)*

> **Standing rule, in his words: *"Use Facilio command skill always whenever you are building and running."***

**Before you build, run, deploy, configure or debug anything on a Facilio surface, load the matching Facilio skill FIRST and follow it. Never work from memory of the CLI, the SDK, the API or the platform's behaviour.**

This is not a preference and it is not a suggestion in a table. It is the same shape as the `facilio-clear-channel-sessions` rule (replica §3 rule 24): **the skill owns the procedure; this rule owns only the policy that it must be loaded.** Reconstructing a `facilio vibe` command from memory is how you get a wrong flag, a destructive `--prod`, a non-backward-compatible import against a shared database, or an hour lost to a syntax the skill documents on line one.

**Trigger it on the action, not on the word "skill".** If the next thing you are about to do is any of these, the skill loads first:

| You are about to… | Load first |
| --- | --- |
| Anything at all on Vibe — start here if unsure | `facilio-vibe:facilio-vibe` |
| Install the CLI, log in, scaffold, `vibe.json`, deploy, publish, push to GitHub, run in Cowork | `vibe-basics` |
| Check or switch which Facilio org/account you're building into | `vibe-accounts` |
| Create a table, import a CSV, inspect schema, **any** ALTER/DROP/re-import | `vibe-db` ⚠ preview and prod share one DB |
| Write, build or run a server function; `server.addHandler`; secrets; SQL from the app | `vibe-functions` (run `facilio vibe function instructions` first) |
| Read or write Facilio CMMS data, or call any connected app | `vibe-connections` |
| Add an LLM agent, structured output, attachments | `vibe-ai-agents` |
| Schedule anything recurring | `vibe-jobs` ⚠ needs production |
| Real-time / push / live updates | `vibe-websocket` |
| File upload / attachments at runtime | `vibe-files` |
| Expose the app as a connection, or run it inside Facilio | `vibe-connection` / `vibe-connectedapp` ⚠ irreversible toggle |
| Deploy or edit anything on `*.facilio.run` | `mcp__Facilio_Run__platform_docs` **before the first line of code**, and `facilio-comment-layer` when it needs review/annotation |
| Write or fix a Facilio Script (workflow, stateflow, formula, button, scheduler) | `facilio-script` — the grammar is **not** JavaScript |
| Build or harden a Connection Studio integration | `facilio-connection-builder` |
| Change any custom-agent prompt | `facilio-agent-builder`, then **`facilio-clear-channel-sessions`**, then `eval-verdict` |

**Two corollaries, both learned the hard way:**
- **Read the platform contract before designing against it, not after debugging it.** §3a exists because the constraints that shaped Yameen's entire build were nowhere in this file until v8.7. The same applies per-surface: `platform_docs` and the relevant skill are the physics, and a requirement that violates one is not a requirement, it is a wish.
- **Confirm the action registered** (replica §3 rule 19). A deploy response is not proof; read the artifact back.

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
| Pre-Won building tree | **prospect portfolio** — `fl_prospect_location`, `fl_prospect_observation` | staged portfolio, `staged_node`, `fl_prospect_node` | Renamed at v8.6 ("staged" purged); **`node` purged at v8.7.3 — it is engineering jargon no FM person uses.** One row is a *location*, its level is `type`. |
| A prospect portfolio row's level | **`type`** — `site` \| `building` \| `space` | `node_type` | Same three words Facilio uses, so nobody learns a second vocabulary. |
| Our site-assessment object | **Site Survey** in the UI; `fl_survey` in the DB | "Survey" alone, in judge-facing UI | Facilio has its own Surveys (feedback questionnaires — a known G1 trap). A judge will see both products. |
| Site assessment lifecycle owner | **Survey lead** — the only role that can submit | reviewer, approver | Accountability line: BD owns the deal, lead owns the survey. |
| Where we sell | **service area** (`fl_service_area`) | site | Geography, not a property. |
| A physical property in a deal | **site** (`fl_prospect_location` where `type='site'`) | service area, location | |
| The sync mechanism | **sync queue** — `fl_sync_task`, `sync-drain`/`-status`/`-retry` | outbox | Three names existed for one thing; the table and handlers are the expensive names, so prose yields. |
| Assigned-person row | **`_assignee`** (`fl_survey_assignee`) | `_assignment` | `fl_lead_assignment` is grandfathered — renaming costs a CSV re-import. Documented exception. |
| AI verdict on a lead | **analysis** (`fl_lead_analysis`, handler `analyse`) | assessment, evaluation | Frontend `AiAssessment` → **`AiAnalysis`**. ⚠ Still unfixed in the live UI — issue `X-08`. |
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

> **⚠ 14 Aug caveat (issues `F-02` / `D-21`):** this line is **not true of the current build** — the template builder has no numeric answer type, so `total_sqft` is captured as free text and the walk cannot produce a price. Until that is fixed, say what is true: *"the walk builds the prospect portfolio and the condition record, and every answer is tagged with the estimation key, so the price is one step away."*

**Primary persona:** the commercial/BD manager at an FM or specialized-services provider — owns pipeline, quote turnaround, win rate. Secondary: the surveyor whose walk becomes the priced scope; the ops lead who today re-keys every won deal.
*(v2 review expands this to nine personas and ten handovers — see `claude/frontline-domain-review-14Aug2026-v2.md`. Notably: there is no **Survey Coordinator** role in the build although the diary is a real job in every FM firm of size — issue `P-01`.)*

**Two acquisition motions, one pipeline (Anand call, 13 Aug — stated):** (a) *direct enquiry* — restaurant emails, web form, walk-in (CIT SOW, Imperial); (b) *tender* — an Owner Association's tenderer (mediator) publishes an RFP across 60–70 portals, controls site-visit slots for ~10 competing FMSPs, fields deadline-bound clarifications, and receives the proposal into their ERP. Frontline must speak both. **v8.6 note:** with assets out, the tender motion survives as **intake only** (source tag, tenderer contact, submission deadline, clarifications) — a tender's per-building asset schedules have nothing to land on.

> **⚠ v8.7.3 evidence caveat — read before pitch-quoting any of this paragraph.** An 88-call sweep of the recorded corpus found **no corroboration** for the Anand-derived tender claims: the string "Anand" resolves once, to a Facilio seller on the Mapletree demo, and there are **zero occurrences** anywhere of "Owner Association", "mobilisation", "defect liability period", "comprehensive/semi-comprehensive", "escort" or "site walk slot". §5 already labels this source *single call, stated* — this is confirmation that it is unrecorded and unverifiable, not a contradiction. **Use the recorded, named, dated evidence instead** (Sadikali Kottilil's RFP→supervisor→proposal chain, Martha Gaviria's five-person RFP team, Sean Smith's *"it's just in their head"*, Tony Graf's tender addendum mechanics). Full detail: `claude/prospect-portfolio-module-spec-v1.1.md` §2.6 C-1.

**The demo number must be money:** the Salesforce project CIT was pricing; PandaDoc/CRM licence displacement; quote rework economics (PostHog: 1,243 quotes created, 582 revised — **47% rework**); "customer said yes → technician has the job" as a click, not an afternoon of retyping. Gate G2 picks one crisp number.

## §2. BUILD STATE & TEAM LANES  ★ REWRITTEN AT v8.7 — READ IT ★

> **Ruling (Sudharsan, 13 Aug): Yameen's `WHATWEBUILT.md` is the latest word on what has been built.**
> Everything this section said before v8.7 — a v37 app on `preview-cit-crm` with a quote engine, AI proposal builder, contract types, Letter of Award, proposal PDF export, condition 1–5 scoring, survey scheduling and a pipeline board — **is not in the build of record.** The old text is preserved verbatim in `claude/CLAUDE-v8.5-snapshot-13Aug2026.md`. Do not plan from it.

> **⚠ 14 Aug — the build has moved past this section.** The live preview now contains a Survey module (list, detail, visits, team, portfolio, photos, reconciliation, activity, walk), a Templates module (builder, versioning, publish checklist), a Settings module (coverage, response targets, Facilio service links, survey capture rules, **users / roles / an 8-role × ~30-action permissions matrix**), and a `survey` + `access` function pair. §2.1's inventory is therefore **stale in the "what exists" direction**. What has *not* changed: there is still **no Deal screen**, still no quote engine, still no promotion, and still no production publish. Ground any new plan in the live app plus `claude/frontline-domain-review-14Aug2026-v2.md`, not in §2.1.

### 2.1 What actually exists — `frontline` @ `28e3ad9` [M] *(as of 13 Aug — see the note above)*

**Backend — two functions, both uploaded and exercised against the platform:**

| Function | Handlers | Contains |
| --- | --- | --- |
| `lead` | **23** | capture (`create`) · read (`list`, `get`, `update`, `reference`) · workflow (`transition`, `claim`, `assign`, `log-activity`) · AI (`analyse-input`, `analyse`) · conversion (`convert`) · accounts (`account-list`, `account-get`) · settings (`settings-get`, `settings-put`) · sync queue (`sync-drain`, `sync-status`, `sync-retry`) · web-chat intake (`intake-start`, `intake-turn`, `intake-transcript`, `intake-submit`) |
| `migrate` | 4 | `clean-seed`, `seed-config`, `status`, `verify`. **Deliberately not DDL** — see §3a. |

`src/functions/` also holds **five empty directories** — `core`, `portal`, `quote`, `survey`, `sync`. *(`survey` is no longer empty as of 14 Aug.)*

**Layers:** `src/modules/` (7 files, ~2,520 lines — the service layer) · `src/domain/` (4 files, 477 lines of pure logic — `lead-state`, `normalize`, `scoring`, `sla`; **this is the tested part**) · `src/shared/` (7 files — `db`, `envelope`, `events`, `facilio`, `ids`, `outbox`, `row-map`).

**Database — 16 tables**, each one a CSV (see §3a): `fl_account`, `fl_account_contact`, `fl_deal`, `fl_event`, `fl_intake_message`, `fl_intake_session`, `fl_lead`, `fl_lead_analysis`, `fl_lead_assignment`, `fl_photo`, `fl_sequence`, `fl_service_area`, `fl_service_coverage`, `fl_service_line`, `fl_setting`, `fl_sync_task`.

**Two agents:** `lead-intake` (conversational capture) and `lead-analyst` (understanding / relevance / score / recommendation). **Both called from the client, never from a function** — see §3a.

**Frontend — React 19 + HashRouter, four surfaces, all wired to live handlers, no mocks and no `[SEAM]` markers anywhere:** Leads (`Inbox`, `LeadDetail` + 6 components) · Accounts (`AccountList`, `AccountDetail`) · Website chat (visitor intake) · Scope & SLA (`Settings`). Plus the app shell, a 13-component UI kit, light/dark theming, and **real Facilio DSM tokens** with `@facilio/icons`.

**Proof it works:** 81 tests passing across 7 files; `scripts/walk.mjs` runs create → analyse → dedup → claim → contact → qualify → convert → drain → confirm the Facilio client exists, entirely through the real platform.

### 2.2 What does NOT exist — and what that costs us

**Zero lines of code (13 Aug):** survey · quote · approval · customer signing portal · work-order handoff · tender ingestion · email-to-lead · analytics/dashboards · SLA alerting. Also **no Deal screen** — `fl_deal` exists as a table with no UI.

**Still true on 14 Aug:** **no Deal screen** (issue `F-14`), no quote engine, no promotion (issue `P-09`), no tender ingestion (so Reconciliation has no input path — issue `F-16`), no email, no production publish.

**Three consequences that change the plan, not just the paperwork:**

1. **The survey handoff has no consumer.** There is no quote engine. **Yameen's P4 is greenfield, not an extension.**
2. **M2 as written is not reachable** if the survey module and the quote module both start from zero. §9.2 re-cuts the gates. **⚠ 14 Aug: M2 is still not met, for a different reason — the survey module exists but *cannot be submitted* (issue `F-01`), so no handoff payload can ever be produced.**
3. **The survey module's primary entry point does not exist.** The spec makes "Deal → Survey tab → New survey" primary; there is no Deal detail page. **14 Aug: the survey list became primary, and the survey create form asks for a Deal but never a *site* — which is the root cause of the orphan-space defect (`D-13` → `F-03`).**

### 2.3 Known blockers [M]

- **No production promotion.** `facilio vibe deploy --prod` has not been run → **no scheduled jobs, no SLA alerting, no polling.** *(Still true 14 Aug — issue `N-03`.)*
- **No public app access** → no embeddable widget, no unauthenticated page. **This closes G3 as blocked, not open.**
- **Facilio connection actions are registered as DRAFT** — they go live only when the connection is published from the platform UI.
- **Outbound/inbound email:** not present in `frontline` at all. Combined with jobs-need-production, **"notify" in P1 can only mean an `fl_event` row plus an in-app indicator** (C29).
- `npm run typecheck` does not work — no root `tsconfig.json`, so **the backend is currently typechecked by nothing.** One-line fix; do it before the survey function is written, not after.
- A leftover probe function `tenderprobe` exists and is safe to delete. *(14 Aug: probe **data** also shipped into the demo dataset — Contact Probe A/B/C, Blocked Probe, CLI Import Probe, Flat Args Test Co, zmytech. Issue `N-09`.)*

### 2.4 Lanes

- **Yameen + Mithun** — CRM core: **the Deal surface**, pipeline, quote/proposal flow, email decision (G7), polish. **P4 (estimation → quote from the survey handoff) is Yameen's** — and it is now understood to be greenfield.
- **Sudharsan** — **(a) the survey side** (§3), **(b) the prospect portfolio** (§3b, its own product area as of v8.7.3) and **(c) the platform approach**: Layer-0 architecture, the Facilio write boundary, **`fl_promotion_log`** (§4.2), §6 checks, and the milestone gates (§9.2).

## §3. SUDHARSAN'S LANE — THE SURVEY SIDE

**Source of truth for this lane is `claude/survey-module-structure-v1.8.md`.** `survey-module-flow-v3.md` remains valid as the *decision record* (D-S1..S15) but is superseded on structure, hierarchy, assignment and table design. `survey-module-structure-v1.7.md` is superseded by v1.8 and immutable.

> **⚠ v8.7.3 — v1.8 §A1.3 is SUPERSEDED.** The prospect portfolio left the survey module and became its own product area. See **§3b** and `claude/prospect-portfolio-module-spec-v1.1.md`. Everything else in v1.8 stands.

**The claim, corrected:** the survey is where the product earns the "FM-native" claim — **the surveyor's walk becomes the priced scope.** Imperial's YAI proposal is the target artifact: a walkthrough produced its specifications ("level of buildup observed during the walkthrough", sq-ft, room counts, 3 service days) and its pricing (one-time deep clean $5,040 + monthly recurring $1,260). The Imperial Site Walkthrough tool (org 1860, read-only) is the production reference for capture UX.

> **⚠ The $5,040 + $1,260 shape is also the evidence for issue `D-05`:** the lead form's single *Rough value* field cannot express one-off vs recurring, so the most important commercial fact in soft-services FM is destroyed at the first field of intake.

**Scope — soft services only (v8.6 S1–S7):**

- **Hierarchy is three levels: site → building → space.** `floor` and `asset` are **out**. Floors are a `floor_count` number plus an optional `floor_label` on the space — evidence: the production walkthrough reference stores floors as a number, never as a hierarchy level [M].
- **One capture line per SPACE**, not per asset. Condition (1–5) and contamination attach to spaces.
- **No capture-time AI in P1.** The AI assist surface is a nullable `ai_confidence` + `ai_source` pair on captured values, and nothing more.
- **Mobile-first capture** — the surveyor taps **"+ Add another Room"** on a repeatable section, names the entry, answers three questions, moves on. Each entry can create the `space` location, so **the prospect portfolio is built as a by-product of the walk** — *but it is no longer the only way it gets built; see §3b.*
- **The walk feeds the price** — per-space condition + answers tagged with a stable `estimation_key`, handed over as a frozen payload.
- **C15 (building profile — BMS/IoT, subcontracted assets, critical assets FCU/chillers/lifts) is OUT of the event build.** Register-only, post-event.

**Non-negotiable engineering for any Facilio write — the crown jewels, restated for the real platform:**

1. **Ancestry rule:** stamp the full lineage chain on every portfolio record. A record missing a level **saves but silently disappears** from the tree, site-scoped WOs and dashboards. The deepest record is now a **space**, and the rule and its unit tests apply to site→building→space. **Enforce it in the prospect tree (`ancestry_path`) before the promotion ever runs.** Unit-test every create path. **⚠ 14 Aug: violated in live data — issue `F-03`. Two orphan `space` records with no parent, because the survey create form never asks for a site (`D-13`).**
2. **No transaction across connection calls:** log every create in **`fl_promotion_log`** as it happens; on failure walk it in reverse and **deactivate, never hard-delete**; never call it atomic.
3. **Idempotency — rewritten at v8.7.** `fl_promotion_log` carries a deterministic `dedup_key` (`source_type:source_id:target_kind`), and **every promotion write goes through one serialised handler that reads the key before it writes.** State the residual risk honestly — this is a *check*, not a *constraint*. **⚠ The same class of bug is already live on `lead.claim` — issue `F-04`, three claim rows from one action.**
4. **No async on the critical write path:** async function runs die on restart. Synchronous with progress polling, or a resume path reading `fl_promotion_log`.
5. **Agents interpret, functions calculate:** pricing, tax, totals, location logic, sequences, status transitions have exactly one correct answer — never ask a model. **⚠ Issue `D-04`: the lead form asks for Service, City and Region as free text while Settings holds the controlled catalogue the analyst scores against — so a model is currently doing a dropdown's job. The doctrine violation is in the form, not the agent.**

## §3b. SUDHARSAN'S LANE — THE PROSPECT PORTFOLIO *(new at v8.7.3 · its own product area)*

**Source of truth: `claude/prospect-portfolio-module-spec-v1.1.md`.** v1 (14 Aug) is immutable and holds the evidence sweep; v1.1 is the buildable spec. **`survey-module-structure-v1.8.md` §A1.3 is superseded by it.**

**Sudharsan's ruling, 14 Aug, verbatim intent:** *"We'll have a separate portfolio module which will not touch the maintenance portfolio module of site/building in the Facilio app… Once the deal is won, the user should have an option to convert it into a portfolio site or portfolio building or a space, whichever, to Facilio. That's a separate action."*

**Five things every lane needs to know:**

1. **It is its own product area, not a survey section.** The reason is structural: a prospect portfolio can be built from an RFP, from a blueprint, or from a phone call **with no survey ever happening** — *"if we get the dimensions of the store, then like a blueprint or something like that, then we can kind of just price it out from home"* [S — Sean Smith, 13 Aug 2026]. With no walk there are no repeatable-section entries, so nothing builds the tree.
2. **One table, `fl_prospect_location`**, with `type` = `site` | `building` | `space`. **`node` is purged from the vocabulary (§0a)** — no FM person says it.
3. **Repeat buildings copy forward** via `previous_pursuit_id`, a self-reference to the same building's row on an earlier deal. **No clone feature, no lost/inactive state on the portfolio** — the *deal* carries the outcome, not the building. A survey is a point-in-time record; copying forward is truer than sharing one row across two visits.
4. **The promotion only ever CREATES.** No Facilio id = new = promote. A location that already carries a `facilio_id` is skipped — and if the survey disagrees with the live record (`verdict = changed`), **it raises a discrepancy flag and writes nothing.** A bid-stage estimate must never overwrite a maintained, contracted record.
5. **The AI ingest layer is C37 — critical, and explicitly not P1.**

## §3a. PLATFORM CONSTRAINTS — the physics of this build *(new at v8.7 · BINDING)*

These shaped every decision in Yameen's repo and were nowhere in this file. **Every spec must be written against them.** Any requirement that violates one is not a requirement, it is a wish. **Per §0.2a, read these *and the relevant skill* before designing, not after debugging.**

| # | Constraint | What it forbids | What to do instead |
| --- | --- | --- | --- |
| **P1** | **No DDL.** The app's DB role cannot create, alter, drop or **index** anything. A CSV *is* the schema. | `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `CREATE SEQUENCE`, unique constraints, FK constraints | Design every column before the first import; there is no migration path. Enforce uniqueness and referential integrity **in the function layer**, and say so. |
| **P2** | **No indexes → full scans** on every table. | Assuming a lookup is cheap | Fine at demo scale. State it as a known week-one limit. |
| **P3** | **No real sequences.** | `count + 1` (two phones collide) *and* `CREATE SEQUENCE` | The built pattern: an **`fl_sequence`** table seeded by `migrate.seed-config`, incremented with a single `UPDATE fl_sequence SET … RETURNING`. |
| **P4** | **Preview and production share one database.** | Any non-backward-compatible schema change | The N-1 rule: additive only, always. **Load `vibe-db` before any import.** |
| **P5** | **A function cannot wait for a model.** Agents are callable **only from the client**. | Server-side AI calls; AI inside any workflow or state machine | The built two-call split: `analyse-input` → client calls the model → `analyse` stores the reply with its inputs and confidence. |
| **P6** | **Static hosting, no rewrite rules** → HashRouter; a real path 404s on reload. | Clean deep links | Hash URLs. Fine for authenticated users. |
| **P7** | **No public app access.** Vibe apps are SSO-gated. | The embeddable widget, any unauthenticated page, C1's acceptance link as a Vibe page | **G3 is blocked, not open.** C1 needs an off-Vibe host or it is out of the event. |
| **P8** | **Jobs fire only on production**, and production has not been promoted. | SLA alerting, scheduled chasing, any polling job | In-app + `fl_event` (C29). Promote deliberately (G8). **Load `vibe-jobs` first.** |
| **P9** | **Connections are registered as DRAFT** until published from the platform UI. | Assuming `executeAction` works today | Publish deliberately; keep the G1 pass as the gate. |
| **P10** | **The backend is typechecked by nothing** (no root `tsconfig.json`). | Trusting green CI | Add the root `tsconfig.json` covering `src/`. |
| **P11** | **`facilio.run` has a flat namespace and no permission model** *(added v8.7.2)*. Any employee can deploy over or delete any site, and `/api/db` is site-namespaced but readable by that site's pages. | Treating an email allowlist on a facilio.run page as access control | Say plainly that it is a scoping convention, not a security boundary. Nothing sensitive goes in a facilio.run KV store. |

## §4. SCOPE BOUNDARY — WHERE FRONTLINE ENDS AND FACILIO BEGINS

Judges score **gap awareness**. The boundary is the answer: *the commercial pipeline is ours; the building and the work belong to Facilio.*

- **Frontline owns:** enquiry → qualification → survey → quote/proposal → approval → acceptance → agreement → **the promotion writes**.
- **Facilio natively owns (do not rebuild, not even a toy):** work orders, scheduling/dispatch, mobile technician app, checklists, proof of service, invoicing, payments, QR asset history, PPM/recurring execution. The nav's "Delivery — Soon" items stay "Soon."
- **The handoff is the demo's hero moment:** accepted quote → work orders/contract exist in Facilio → Facilio generates the recurring programme. Stop there; pointing at native Facilio *is* the platform pitch.
- **DLP (defect liability period) stays across the boundary** *(Anand, stated — see §1's v8.7.3 evidence caveat)*. Record the concept; build nothing.
- **Read from Facilio, never copy:** store only Facilio record ids — a mirrored name goes stale and fragments the source of truth.
- Six ideation ideas died by collision with existing capability. Assume anything new needs a roadmap check before commitment.

### §4.1 Two words, two operations — do not mix them *(v8.7)*

| Operation | Word | What it does | When |
| --- | --- | --- | --- |
| Lead → Account + Contact + Deal | **`convert`** | Creates the commercial records in the app | At qualification |
| Prospect portfolio → Facilio | **promotion** (`fl_promotion_log`) | Creates site/building/space in the CMMS | **Won + contract signed only** |

> **Note on the UI label (v8.7.3):** the *button* reads **"Convert to Facilio"**, because that is the user's word and Sudharsan's. The *code* stays qualified — `prospect.convert-to-facilio`, and the ledger table remains `fl_promotion_log`. `lead.convert` is untouched. Both meanings survive; the namespace does not collide.

### §4.2 ⚠ FLAG FOR YAMEEN — the customer is created at Won, not at convert *(Sudharsan, 13 Aug)*

`lead.convert` today creates the commercial records **and pushes a client into Facilio FSM**. Sudharsan's position, recorded verbatim in intent:

> *"Whatever we have decided, the lead gets converted to customer only when a deal is won. The same person can come as a lead again, but the status should already be a customer-tagged status."*

1. **A lead becomes a *customer* only at Won.** Whether a Facilio *client* record may exist earlier — and under what status — **is not settled**; check against Facilio's own client statuses in the G1 pass.
2. **A repeat lead from an existing customer must be recognised as one.** This is **C28**.

> **⚠ 14 Aug — this is now a live violation, not a flag.** Five Facilio clients (30248–30252) exist for accounts that are not Won, and "Customer since" is set at convert. Issue **`F-08`**. And the UI badges the four rule-breaking accounts green while badging the one compliant account red (`X-16`).
>
> **v8.7.3: C38 is the fix.** The promotion — not `convert` — creates the Facilio **client and client contact**. Applied, it resolves `F-08` by construction.

## §5. EVIDENCE BASE & MARKET-REQUIREMENT SOURCES

| Source | Status | Use |
| --- | --- | --- |
| **Yameen's `WHATWEBUILT.md`** (repo inventory, `28e3ad9`) | **Read 13 Aug — build state of record (§2)** | Ground truth for what existed on 13 Aug. **Superseded in the "what exists" direction by the live app on 14 Aug.** |
| **`claude/prospect-portfolio-module-spec-v1.md` + `-v1.1.md`** | Written 14 Aug | **v1 holds the 88-call evidence sweep** (named speakers, dated, with four corrections to this file's own claims — §2.6). v1.1 is the buildable spec. |
| **`claude/frontline-qa-verdict-14Aug2026-v1.md`** | Written 14 Aug | First-pass QA of Lead / Account / Survey / Templates. Verified defects only. |
| **`claude/frontline-domain-review-14Aug2026-v2.md`** | Written 14 Aug | **Second pass — the domain read.** Nine personas, ten handovers, form-by-form redesign, list-view model, 95 IDed issues. Live board: https://frontline-triage.facilio.run |
| **`claude/frontline-alignment-audit-v1.md`** | Written 13 Aug | The three-way diff that produced v8.7. |
| CIT Salesforce SOW (project file) | Read 13 Aug | Requirement spec, demo-scenario template (SOW §8), hard-money evidence. Coverage matrix §7. |
| CIT CRM build log (`CITCRMConversation.md`) | Read 13 Aug | **Historical.** Describes the v37 cit-crm app. Cite for decisions and blockers, never for build state. |
| Vibeathon session record | Read 13 Aug | Research base, Frontline spec, architecture, traps, open questions (§12). |
| **Imperial** — YAI/Williston Park proposal + Site Walkthrough tool (org 1860) | Read 13 Aug; **tool source re-read line-by-line 14 Aug** | The real artifact to beat. Sets D3's evidence bar, the proposal-PDF anatomy (§7.2), **the one-off + recurring evidence behind `D-05`**, and the measured capture fields (`gen_sqft`, `gen_floors`, `gen_rooms`, `gen_restrooms`, `gen_ceiling`). |
| **Clari recorded-call corpus — 88 calls swept 14 Aug** | **New at v8.7.3** | Named, dated customer evidence for the prospect portfolio and the RFP→survey→proposal chain. **Also the source of the §1 caveat on the Anand claims.** Indexed in the v1 spec §2. |
| CBRE UK GWS 14-requirements sheet | Read 13 Aug | AI-behaviour checks (§6). Build-phase reference, never demo-named. |
| **Berkeley Anand call notes** (OA/tender motion) | Triaged 13 Aug (G6 closed) — all claims STATED, single call. **⚠ Uncorroborated in the recorded corpus — §1 caveat** | Tender motion; OA→tenderer→FMSP structure; contract-type economics. → C13–C17. **Never pitch-quoted as measured.** |
| AI-corner call analysis CSV, Issues.csv, PostHog/Postgres | On file / connected | Pain quotes, quote-rework 47%, adoption-risk signals (SVH reverted to Micromain — UX is existential, not cosmetic). |
| **NOT YET IN THE PROJECT** — `ARCHITECTURE.md`, `API.md`, `Survey Backend Plan v1.md`, `Survey Terminology Audit v1.md` | **Gap** | **Get them in before v1.8 is treated as final.** (G10) |
| Funnel lineage v4–v6 + stage1 extraction + mother doc v7 | Frozen archive | Cite, don't edit. |

## §6. AI-BEHAVIOUR CHECKS (CBRE-derived — mandatory for every AI feature)

> **DOCTRINE (Sudharsan, 13 Aug — binding on every lane, every module, every doc): humans act, workflows automate, AI assists.** Every action in Frontline has a human owner and a working manual path. Anything deterministic (status transitions, pricing, routing, notifications, escalations) is a workflow/function — never a model call. AI enters only where genuine interpretation is needed, always as an optional layer ON TOP of the human path, always §6-checked. If any spec frames an action as AI-only or AI-first, stop, step back, and re-derive it from this doctrine before building.
>
> **v8.7 addition — the doctrine now has a platform guarantee behind it (§3a P5):** a Vibe function *cannot* call a model. AI is structurally incapable of sitting inside a state machine here. That is worth saying to a judge.
>
> **v8.7.2 addition — the doctrine is broken at the FORM, not the agent.** Issue `D-04`: Service, City and Region are free text on the lead form while Settings holds the controlled catalogue the analyst scores against. A dropdown's job is being done by a model. Structure the input and the doctrine holds itself.

- **#6 Confidence on everything** — every AI decision records a confidence score. **⚠ Not shown in the UI — issue `X-07`.**
- **#3 Threshold → human** — below-threshold routes to a human; thresholds configurable per decision class. **⚠ No threshold exists — a 2/100 "not relevant" lead is Qualified with Convert live and unguarded. Issue `F-06`.**
- **#7 Explainable audit** — inputs → reasoning → decision → confidence, viewable and exportable. *Show this screen in the demo.* **⚠ The reasons panel is genuinely good; confidence, model and prompt version are missing — `X-07`.**
- **#2 Graceful fallback** — never block creation on a missing field; create on best-available, flag for enrichment.
- **#10 Duplicate detection at creation** — probable duplicate surfaced, logged, **human-decided**. **⚠ The app auto-closes duplicates with no human decision — issue `F-07`. 8 of 13 closed leads.**
- **#13 Per-account AI-vs-human orchestration** — settings for what AI may do.
- **#15 Unstructured sources first-class** — nulls, duplicates and odd statuses shown, never masked.
- **#1 Integration hygiene** — every Facilio write authenticated, idempotent, retried, audit-logged. **⚠ A failed write shows "not in Facilio yet" with no error, reason or retry — `F-09`. The sync queue has no UI.**
- **#5 Adaptive chase** — quote follow-ups on absolute time-to-expiry. *(Needs jobs → needs production, P8.)*
- **C8 rule:** AI drafts, humans send. No autonomous outbound commercial documents.
- N/A (voice/intake-specific, on record): #4, #8, #9, #11, #12, #14.

## §7. REQUIREMENT COVERAGE

### 7.1 CIT SOW §4.x → Frontline *(dispositions corrected at v8.7; 14 Aug status in brackets)*

| SOW area | Disposition |
| --- | --- |
| 4.1 CRM management | **Partial** — leads, accounts, deal *table*, sync queue built. **No Deal UI, no pipeline board** [still true — `F-14`] |
| 4.2 Site survey | **Sudharsan's lane** (§3) — [**built 14 Aug**, but cannot be submitted — `F-01`] |
| 4.3 Service catalogue & pricing | **Not built.** `fl_service_line`/`_area`/`_coverage` are app-local — **see C23** [Settings now exposes Facilio Service Links; all three read "not linked" — `F-20`] |
| 4.4 Quotation (incl. e-acceptance) | **Not built.** Acceptance link **blocked** by P7 |
| 4.5 Agreement/contract | **Not built** |
| 4.6–4.16 WO/scheduling/mobile/PoS/invoice/QR/recurring | **Facilio native — handoff, don't build** (§4) |
| 4.17 Recommendations → additional work | **Not built.** Folded into survey answers for P1 |
| 4.18 Portal | Post-event. Blocked by P7 |
| 4.19 Dashboards | **Not built** |
| 4.20 Audit trail | **Partial — `fl_event` + `shared/events.ts`.** The audit spine (C18) [live, but writing duplicate and mislabelled rows — `F-04`, `F-05`] |
| 4.21 Role-based access | **Not built as a module** [**built 14 Aug** — 8 roles × ~30 actions — but **not enforced**: one user in the directory, session user absent, full access — `F-13`] |
| SOW §8 demo scenario | **Re-cut required.** See §9.2 |

### 7.2 Imperial YAI proposal → proposal-PDF anatomy (the market's actual format)

Cover letter (personal, from a named manager) · capability sections (reusable boilerplate) · **specifications derived from the walkthrough** (sizes, areas, condition observations, client preparation, schedule) · **optional services** (upsell menu → optional-excluded-from-total lines) · pricing table with **one-time + recurring lines** · acceptance page (dual signature, date authorized vs expected start) · billing information · **certificate of signature** (the D3 bar).

> **Two `D-` issues fall straight out of this anatomy:** the one-time + recurring pricing lines are the evidence for **`D-05`** (single Rough value), and the dual-signature + separate billing block are the evidence for **`D-03`** (one Contact field where FM needs four parties).

## §8. BUILD REQUIREMENTS REGISTER (live — C-numbers, never deleted)

- **C1 — Click-to-accept with certificate parity** *(D3 + Imperial)*. **⚠ Blocked by P7.**
- **C2 — Idempotent Facilio promotion** *(§3.3)*: `fl_promotion_log` + deterministic `dedup_key`; read-before-write in one serialised handler; reverse-walk deactivation; residual concurrency risk stated.
- **C3 — Ancestry stamping on every portfolio write** *(§3.1)*: site→building→space; enforced in `ancestry_path`; unit-tested. **⚠ Violated live — `F-03`.**
- **C4 — No async on critical writes** *(§3.4)*.
- **C5 — Append-only lifecycle audit** *(SOW 4.20)*: **one spine, `fl_event`.** **⚠ Two different renderers exist — `X-10`; and the spine is mislabelling — `F-05`.**
- **C6 — Role-based access incl. unmanaged→Home-only**.
- **C7 — Tenant/org scoping on every query and action**.
- **C8 — AI drafts, humans send** *(§6)*.
- **C9 — Survey capture works without a Facilio site**.
- **C10 — Optional quote lines shown but excluded from totals**.
- **C11 — Rate-card pricing adjusted by condition score** *(depends on D-e, now a Settings toggle — good)*.
- **C12 — Recurring line support on quotes/contracts** *(Imperial pattern)*. **⚠ Blocked upstream by `D-05` — intake cannot express recurring at all.**
- **C13 — Tender-motion intake** *(IN EVENT BUILD — **INTAKE ONLY**)*. **⚠ Reconciliation's empty state promises tender diffs with no input path — `F-16`.**
- **C14 — Semi-comp liability threshold** *(IN EVENT BUILD)*. **⚠ Uncorroborated source — §1 caveat. Never pitch-quoted.**
- **C15 — Survey building profile** *(**REGISTER-ONLY, POST-EVENT**)*.
- **C16 — Deal party roles** *(REGISTER-ONLY)*. **⚠ Its absence is felt now — `D-02`, `D-03`.**
- **C17 — Mobilization stage** *(REGISTER-ONLY, post-event)*.
- **C18 — Record history & logs, platform-wide** *(MUST-HAVE)*. **⚠ No activity/history on the account — `F-19`.**
- **C19 — Search, platform-wide** *(MUST-HAVE)*: global search, per-module search, list-view filters and **saved views**. **⚠ This is the parent of `D-25`–`D-28`: no filter bar, no saved views, no group-by, no timeline filter, no URL state (`N-06`), no export (`N-08`).**
- **C20 — WCAG colour/contrast + accessibility** *(MUST-HAVE)*: `design:accessibility-review` at every M-gate. **⚠ 16px touch targets — `N-05`; contrast unverified (oklch) — `N-12`.**
- **C21 — Persona-first interfaces** *(STANDING DUTY)*. **⚠ The v2 review is the first real pass at this — nine personas, and one (Survey Coordinator) is missing entirely: `P-01`.**
- **C22 — Survey-optional deal path**.
- **C23 — Services from Facilio's Services module ONLY** *(**HELD AS WRITTEN**)*. **⚠ All three Service Links read "not linked" — `F-20`. L10 still open.**
- **C24 — Users/roles/permissions module** *(extends C6)*. **⚠ Built and unenforced — `F-13`. No Deals section in the matrix.**
- **C25 — Provenance + enrichment history**: no silent overwrites, ever.
- **C26 — Promotion pre-flight screen**: before the promotion writes, list every prospect location with missing/unmapped mandatory fields. **Enrichment happens at the gate, not after.** **⚠ Not found anywhere — `P-09`.**
- **C27 — Deal copilot Q&A** *(NICE-TO-HAVE, after core)*.
- **C28 — Lead → customer status resolution** *(see §4.2)*. **⚠ Violated live — `F-08`. C38 is the fix.**
- **C29 — "Notify" means event + in-app in P1**.
- **C30 — Account Delivery Intelligence agent** *(Sudharsan, 14 Aug · **REGISTER-ONLY, POST-EVENT** · AI-agent candidate)*: when a new deal or renewal opens for an existing account, surface **how the previous contracts actually ran** — so the next proposal is priced with delivery truth, not optimism.
  - **The defensible claim is lineage:** because the promotion makes a *proposal line* the ancestor of a *work order* (C2/C3), we can compute **priced-versus-delivered per line, per site, per service.** Pitch the mechanism, never the category — Salesforce + Field Service, ServiceTrade, ServiceTitan, BuildOps and Simpro all hold commercial and delivery data on one platform.
  - **Signals worth computing:** reactive-vs-planned against what was priced · WO volume vs contracted · **zero-dollar work orders** (§13.2) · SLA breach rate · repeat visits / first-time-fix · asset failure concentration · credit notes · invoice vs contract value · variation volume *(a positive signal)* · rejected proof-of-service.
  - **Doctrine split (§6):** **every metric is a function.** The agent's job is the **narrative brief at quote time** — interpretation over computed facts, with a recommendation a human accepts or ignores. **Never a model computing a number, never an opaque health score.**
  - **Four objections on record, strongest first.** (1) **Cold start** — lineage exists only for contracts sold through Frontline. (2) **A health score is a judgment dressed as a metric.** (3) **Read-path unknown** — are Facilio invoices, credit notes and WO history readable via connections? Same family as L10. (4) **Attribution** — mispriced, old building, or weak ops?
  - **Why it still earns its place:** it is the answer to §11's standing worry that *"the real gap is features that exist and nobody uses."* One pitch line: *"because the proposal line becomes the work order, the next proposal knows how the last one actually went."*
- **C31 — Numeric + unit answer type on survey templates** *(NEW at v8.7.2 · **P0**, issue `F-02`/`D-21`)*: the template builder offers Short text, Long text, Options, Attachment — and an `estimation_key` field whose own placeholder is `total_sqft`. **A measurement cannot be captured.** Add a Number type with a unit from a fixed list (sqft / sqm / each / linear m / hours), and allow estimation keys only on Number and Options. **Until this ships, §1's pitch line is not true of the build.**
- **C32 — Site is required at survey creation** *(NEW at v8.7.2 · **P0**, issue `D-13`)*: the survey create form asks for a Deal and never a property, which is the root cause of the orphan-space defect (`F-03`) and of the surveyor receiving no address (`P-08`). Site required, chosen from the account's known sites or created inline; buildings optional; spaces discovered on the walk.
- **C33 — Site access capture** *(NEW at v8.7.2 · **P1**, issue `D-14`)*: access window, site contact + mobile, permit / escort / keys / parking / induction. **The single biggest cause of a wasted FM site visit has no field anywhere in the product.**
- **C34 — One-off vs recurring at intake** *(NEW at v8.7.2 · **P1**, issue `D-05`)*: Type (One-off / Recurring / Both) + one-off value + recurring value & frequency. Pipeline value = one-off + (recurring × contract months). Evidence: §7.2's reference proposal. **Lost at field one, unrecoverable downstream.**
- **C35 — Field-level help text, every field, every module** *(NEW at v8.7.3 · **MUST-HAVE** · standing · Sudharsan, 14 Aug)*: **every field in every module carries a short subtext under its label saying why the field exists and what the user does with it** — not a restatement of the label, the *reason*.
  - **Trigger, on record:** Sudharsan read a module spec and could not tell what six of its fields were for. **If the author has to explain a field in a chat message, the field is under-specified.** The explanation belongs in the product, not in the conversation about the product.
  - **The test** is §9.1's Readiness criterion — *"a new user starts unaided"* — applied at field level rather than screen level.
  - **Applies to specs as well as screens.** Every field table in every module spec carries a "why this exists" column. Documentation standard and UI standard are the same sentence written once.
  - **Worked example:** `verdict_note` is not "a note about the verdict". It is *"Why wasn't it found or visited? This prints on the proposal as a qualification — a blank here is a scope gap you cannot defend in negotiation."*
  - **Cheapest available lever on the UX and Readiness scores**, both currently ≤3 (§9.1). Related: C20, C21, `design:ux-copy`.
- **C36 — Every module spec defines lifecycle, personas, operations and special actions** *(NEW at v8.7.3 · **MUST-HAVE** · standing · Sudharsan, 14 Aug)*: no module spec is complete without all four. His stated reason: *"I will build the permission set for each of these modules based on this."*
  1. **Lifecycle** — every state, every transition, actor and guard per transition, and the transitions that are **forbidden**. Forbidden transitions are the ones that become production bugs; name them and unit-test them.
  2. **Personas** — who touches this product area, on which surface, to do what (C21).
  3. **Operations** — the CRUD matrix per persona, including what locks and at which state (C6, C24).
  4. **Special actions** — named operations that are *not* field edits (assign, submit, convert, exclude, cancel), each with its own permission key, guard and audit row. **These are what the permission matrix is actually made of, and they are invisible in a CRUD table.**
  - **The template already exists and was never mandated:** `survey-module-structure-v1.8.md` §A0 (persona→surface), §A1.8 (executable transitions incl. forbidden), §A1.2b (named actions with guards), §A4 (CRUD matrix), §B3 (permission-key payload). **Any new module spec that does less than v1.8 did is incomplete.**
  - **Every key is enforced server-side in the function layer, never only in the UI.** Live symptom of skipping this: `F-13`.
- **C37 — AI portfolio ingest, from documents and from site plans** *(NEW at v8.7.3 · **CRITICAL AI NEED** · explicitly **NOT P1** · Sudharsan, 14 Aug)*: an AI layer that reads what the client actually sends — Excel, PDF, a tender appendix, a scope of work, **and a site plan / floor plan / drawing** — and proposes the prospect portfolio hierarchy from it, flagging every reconciliation conflict rather than resolving it silently.
  1. **Ingest the real formats.** Evidence for the spread: *"they send attachments, they send spreadsheets, they send PDFs, documents, they send footprints of the sites, they send a scope of work… square footages"* [S — Martha Gaviria, 13 Aug 2026].
  2. **Propose a hierarchy**, not a flat extraction — site → building → space, attributes at the right level.
  3. **Confidence per extracted value**, never per document.
  4. **A gap list** — what the document does *not* answer becomes clarifications to the tenderer or checklist items for the walk.
  5. **Reconciliation, not resolution.** Where two sources disagree, **the AI must not pick.** Every extracted value lands as an observation with `is_accepted = false`; acceptance is a human act.
  6. **Everything unambiguous flows through cleanly**, so a human only ever touches the conflicts.
  - **Constraints, not considerations:** §3a **P5** — a function cannot call a model, so this must use the client-side two-call split exactly as `lead.analyse` does · **C8** AI drafts, humans confirm, per value · **§6 #2** the manual and paste paths must work with AI switched off entirely · **§6 #6/#7** confidence recorded, reasoning auditable.
  - **Why "critical" despite not being P1:** it is the only thing that removes actual headcount — *"our proposals email, which is the RFP team, and we are like, consists of **five people**"* [S — Martha Gaviria]. And customers hold portfolios in templates a vendor cannot read unaided: *"the template might be a bit difficult for us to kind of interpret until Kamil says that, no, this is how you read it"* [S — Deepak Simon, 21 May 2026].
  - **Proven upgrade path:** Facilio already digitises floor plans, pins assets on them and creates records from the plan [S — jake@facilio.com, 6 May 2026]. A site plan can eventually be the substrate the portfolio is built *on*, not a document beside it.
- **C38 — The promotion's full output mapping** *(NEW at v8.7.3 · extends C2, C26, C28 · Sudharsan, 14 Aug)*: the promotion is not only a portfolio write. Four outputs, and they are **ordered**, because each depends on the one above it.

  | # | Output | Target | Status |
  | --- | --- | --- | --- |
  | 1 | Account → **Facilio Client**, contacts → **Facilio Client Contacts** | Facilio Client module | **This is C28's resolution.** Applied, it fixes `F-08` |
  | 2 | Prospect portfolio → **site / building / space** | Facilio Portfolio | Target level is a **per-location human choice**, not a fixed mapping |
  | 3 | Accepted quote → **Contract** | Facilio Contract | **⚠ Yameen's lane, and blocked — there is no quote engine (§2.2). Sequence honestly** |
  | 4 | Contract → work orders / PPM | Facilio native | **We do not build this** (§4) |

  **Ordering is a hard dependency and belongs in the C26 pre-flight:** client before site, site before building, building before space. A pre-flight that does not enforce the order produces exactly the C3 failure — *a record saves and then silently disappears from the tree.* Ledger: **L22**.
- *(C39+ append as evidence arrives, with source tags)*

## §9. JUDGING GATES

### 9.1 Two rubrics, one behaviour

The event rules name three criteria — **FM solution**, **platform leverage**, **design & product quality**. The judges' PDF details four 25% categories — Domain Excellence, Engineering Excellence, User Experience, Product Readiness. Treat the PDF's 20 sub-criteria as the checklist; the three rules-criteria as the summary story.

- **Domain:** edge cases; gap awareness (§4); data realism; grounded ROI (G2).
- **Engineering:** real records with nulls/duplicates/long strings — failures **shown**; bulk queries, no queries in loops; secrets server-side; loading/empty/error states; idempotent writes; **and — a genuine strength — the platform constraints in §3a named out loud, with the design that respects them.** A team that can say *"we cannot create an index, so here is how we made retries safe anyway"* scores better than one that claims a constraint it never hit.
- **UX:** purpose obvious in seconds; core flow in few steps; one visual system; every click reacts; copy says what will happen. (SVH reverted to Micromain over a slow interface — UX is churn-risk, not polish.) **C35 is now the cheapest lever here.**
- **Readiness:** scope discipline; end-to-end, nothing mocked, **no dead ends**; deployed to production (P8); a new user starts unaided.

**Vibe-block scorecard — all seven must earn their place:**

| Block | State | Owner of the gap |
| --- | --- | --- |
| DB | ✅ real data | — |
| Functions | ✅ `lead`, `migrate`, `survey`, `access` | — |
| Agents | ✅ 2, client-side per P5 | — |
| Connections | ⚠ **DRAFT, not published**; Service Links all "not linked" | Yameen (publish + G1) |
| Files | ✅ **photo capture live** — `capture="environment"`, multiple | — |
| Jobs | ❌ needs production (P8) | Yameen (G8) |
| Websocket | ❌ unused | **Survey lane — two surveyors on one building, live** |

**5 of 7.** Websocket remains the survey lane's to claim.

**Honest scoring, 14 Aug (§9.2 says anything ≤3 becomes the next work item):** Domain **3** · Engineering **2** · UX **3** · Readiness **2**. **Every category is ≤3.** Full reasoning in `claude/frontline-domain-review-14Aug2026-v2.md`.

### 9.2 Milestone protocol *(re-cut at v8.7)*

- **M1 — Survey lane scope frozen** (v1.8 published) **+ the build-state truth recorded** (§2). *Done at v8.7.*
- **M2 — Survey end-to-end, standing alone**: create → schedule → assign → walk → reconcile → submit → **a frozen handoff payload that can be opened and read**. **⚠ NOT MET at 14 Aug — `F-01`, the submit control does not exist. Cheapest close: a read-only Handoff tab on a completed survey rendering the §14-line-3 payload. That closes M2 *without* the quote engine.**
- **M2b — Handoff consumed** *(Yameen)*: the payload renders as draft quote lines. Only after M2.
- **M3 — Promotion works** (C2, C3, C4, C26, **C38** proven on a staged Won deal, with the retry shown).
- **M4 — AI features pass §6** — and P5 is stated as the reason no AI sits in a state machine.
- **M5 — Full rehearsal including one shown failure** (a bad email lead, a rejected acceptance, an unmapped site, or a promotion retry).

At each gate score all four judging categories honestly out of 5 in-chat; anything ≤3 becomes the next work item before new features. `eval-verdict` owns final scoring.

## §10. SKILL MAP *(re-cut at v8.7.2 — triggers, not a menu)*

**§0.2a is the governing rule: the Facilio skills load BEFORE the action, always.** This table names the trigger for each.

| Phase / trigger | Skill |
| --- | --- |
| Always — voice, decision style, bias control | `sudharsan-replica` |
| New evidence (transcripts, exports, repo inventories) | `discovery-impact-triage` |
| Spec work on any layer | `socratic-prd-coach` → `product-management:write-spec` / `product-doc-builder` |
| Scope fights, idea pressure-testing | `product-management:product-brainstorming` + §11 |
| **⚠ ANY build / run / deploy / debug on Vibe — start here** | **`facilio-vibe:facilio-vibe`**, then route: `vibe-basics` (setup, deploy, publish) · `vibe-accounts` (which org) · `vibe-db` (⚠ shared preview/prod DB) · `vibe-functions` (run `facilio vibe function instructions` first) · `vibe-connections` (CMMS data) · `vibe-ai-agents` · `vibe-jobs` (⚠ needs prod) · `vibe-websocket` · `vibe-files` · `vibe-connection` / `vibe-connectedapp` (⚠ irreversible) |
| **⚠ ANY deploy or edit on `*.facilio.run`** | `mcp__Facilio_Run__platform_docs` **first**; `facilio-comment-layer` when the artifact needs review/annotation |
| **⚠ ANY Facilio Script** (workflow, stateflow, approval, formula field, custom button, scheduler) | `facilio-script` — the grammar is **not** JavaScript; guessing from JS produces parse errors |
| **⚠ ANY Connection Studio integration** | `facilio-connection-builder` |
| Agent-shaped AI features | `facilio-agent-builder` (build) → **`facilio-clear-channel-sessions`** (mandatory after every prompt change, all contacts) → `eval-verdict` (score) — never self-declared |
| Charts/dashboards | `dataviz` before the first line of chart code |
| UX passes at M-gates | `design:design-critique`, `design:ux-copy`, `design:accessibility-review` |
| Milestone/judge scoring | `eval-verdict` + §9 checklist |

## §11. DEVIL'S-ADVOCATE STANDING QUESTIONS (answer before judges ask)

1. **"Why not Salesforce/HubSpot + integration?"** CIT's SOW is the answer: 21 functional areas, partners, custom dev, licences — to make a CRM understand FM. Frontline is FM-native and lands the deal in the delivery platform with zero re-keying. **And now with a customer's own words behind it:** *"we don't have a dedicated module in HubSpot or anything like that for them to fill out something"* [S — Sean Smith, 13 Aug 2026].
2. **"ServiceTrade already has a kitchen-exhaust vertical."** True — and it covers most of CIT's 21 areas natively. Our wedge: the customer's *delivery* already runs on Facilio; Frontline makes the CMMS the system of record from first enquiry. Position against it; don't pretend it isn't there.
3. **"TYTEN says no new interfaces — why build one?"** Because the surveyor and the BD manager have *no* interface today, not a bad one — their tools are a clipboard and Excel. **Measured:** asked what a surveyor records on a walk, the answer was *"So usually it's just in their head."*
4. **"Is click-to-accept legally enough?"** Match the PandaDoc certificate's evidence set (C1) and call it audited digital acceptance. *And be honest that P7 currently blocks the page itself.*
5. **"Where's the money?"** Displaced CRM + doc-tool spend, the Salesforce project CIT budgeted, 47% quote rework, and the retyping gap between "yes" and "job scheduled." G2 picks the one number.
6. **"Isn't a CRM too big for two days?"** A CRM is. **And v8.7 proves we are willing to say so out loud.** The cut line is the survey lane end-to-end (M2) plus the promotion, with the "Soon" tabs defended proudly.
7. **"You cut assets — isn't that the FM part?"** Soft services is a real market with a real artifact. Cutting the hard-FM asset spine on day one, with the evidence written down, is scope discipline, not retreat.
8. **Bias check (per project instructions):** at every M-gate — are we building this because the market pulled it, or because we pivoted and need to be right? Cite evidence lines, not enthusiasm. The strongest self-critique on record: *the real gap is features that exist and nobody uses* — Frontline must be the thing that fills Facilio in, not another module that sits empty.
9. **⚠ "your own review says the pitch line isn't true yet."** It is the strongest question a judge could ask and we should ask it first. The honest answer: *the walk builds the prospect portfolio and the condition record today; the estimation key is on every answer; the numeric field is the one thing between that and a price, and we know it (C31).* Saying it before they find it converts a hole into evidence of engineering honesty.
10. **⚠ NEW at v8.7.3 — "did a customer ever ask for a prospect portfolio?"** Answer it honestly and first: **the mechanism is heavily evidenced; the object is our inference.** In 88 recorded calls the pre-contract portfolio is voiced once — *"if we're going and looking at sites that aren't quote clients yet"* [S — Ryan Sklar, 29 Apr 2026]. Everything else called a "site survey" in the corpus is post-contract. What *is* measured: the RFP→supervisor→proposal chain done manually in Excel, a five-person RFP team hand-reading attachment bundles, survey findings living in the surveyor's head, and Facilio's real portfolio having exactly one lifecycle lever (`inactive`) with no state for "not ours yet". **Lead with the mechanism, never the object.**

## §12. GATES & OPEN QUESTIONS (before the relevant build hour)

- **G1 — Connections truth. STILL OPEN, AND BLOCKING FIVE LEDGER ITEMS.** On org #984, before app code in the survey/portfolio lanes: can building/space be created via connections? resourceType/spaceType discriminators? do create actions maintain roll-up counters? does the photo action accept a capture timestamp? **does the Facilio Services read action exist and what is the id shape (L10 → C23 → `F-20`)? does Facilio hold a trade/skill master (L13)? is the platform user list readable and can permission keys be registered per module (L14 → `F-13`)? what are Facilio's client statuses (C28 → `F-08`)? can a Client Contact be created via connections (L22 → C38)?** Also: contract service-line enum values. Write `/docs/connections.md` + `/docs/enums.md`; **no `executeAction` until they exist.** *(Trap: `surveyTemplate`/`surveyResponse` are feedback questionnaires, not site assessments — see §0a.)*
- **G2 — Money number** chosen and rehearsed (§1).
- **G3 — Public acceptance page. ⛔ BLOCKED, not open**: P7. Decide the off-Vibe mechanism or take C1 out of the event.
- **G4 — Write moment** — ✅ CLOSED for the portfolio. **⚠ REOPENED narrowly for the customer record** — §4.2, C28, C38, and now `F-08`.
- **G5 — Demo script** drafted from the re-cut M-gates (§9.2), including one shown-failure beat and the live Facilio promotion. **Demo on Al Bayt Grill, never Al Manzil** — Al Manzil's five prospect-stage Facilio clients are the visible violation of our own Won rule.
- **G6 — Berkeley Anand doc** — ✅ CLOSED 13 Aug. **⚠ Re-flagged at v8.7.3: closed does not mean corroborated. See the §1 caveat.**
- **G7 — Email go-live**: Resend + verified domain, or demo with the manual-paste fallback declared honestly. Until then C29 governs every notification.
- **G8 — Production publish** done deliberately before jobs are scheduled; org identity (#984 vs 1860) resolved before any metadata cloning. **Load `vibe-basics` + `vibe-jobs` first (§0.2a).**
- **G9 — Rehearse §11** answers; verify the registration copy reflects the CRM entry.
- **G10 — the four missing documents** (`ARCHITECTURE.md`, `API.md`, `Survey Backend Plan v1.md`, `Survey Terminology Audit v1.md`) into the project. **v1.8 is not final until reconciled against them.**
- **G11 — root `tsconfig.json`** added so the backend is typechecked at all (P10).
- **G12 — triage the 95 issues before writing new features.** `https://frontline-triage.facilio.run` — assign, schedule, decide. §9.2's rule (anything ≤3 becomes the next work item) applies to all four categories, and all four are ≤3. Start with `F-01`, `C31`/`F-02`, `C32`/`D-13`.

### Ledger

**Answered at v8.7:**
**L11** — partial unique index for the one-lead rule → **NO** (P1). Function-level guard; residual race stated.
**L12** — real DB sequence for numbering → **NO** (P1). Use `fl_sequence` + `UPDATE … RETURNING` (P3).

**Open:**
**L9** — enum/category mandatory-field list for the promotion pre-flight screen. *G1.*
**L10** — Facilio Services read action + id shape. **Blocks C23; live symptom `F-20`.** *G1.*
**L13** — does Facilio hold a trade/skill master on users? If yes, link, never copy. *G1.* *(Needed for `D-19`'s surveyor picker.)*
**L14** — user-module readiness: is the platform user list readable, can permission keys be registered per module? *G1.* *(Live symptom: `F-13`.)*
**L15** — does `jsonb` survive `facilio vibe db import`'s CSV type inference, or does everything land as `text`? **Load `vibe-db` before testing this (§0.2a).**
**L16** — the notification mechanism, presumed `fl_event` + in-app (C29). *Confirm.*
**L17** — can `fl_photo` carry the survey/portfolio attachment columns (`kind`, device `captured_at` vs server `uploaded_at`, geo) **without an ALTER** (P1)? *(Live symptom: photos surface as `image.jpg` with no capture metadata. **Also blocks the blueprint/site-plan attachment model — v1.1 §5.3.**)*
**L18** — do `lead.*` permission keys exist? C24 says every module registers its set.
**L19** — **does a submit / send-for-review handler exist on the `survey` function?** If yes, `F-01` is a missing button and a ~20-minute fix. If no, it is a state-machine change plus a completeness gate. **The single highest-value unknown in the project right now.**
**L20 — ⚠ NEW at v8.7.3:** does the Facilio portfolio API accept a **space parented directly to a site** (an "independent space" — lawn, car park, parking)? Facilio's own demos say yes; **verify against the API, not the demo.** *G1.*
**L21 — ⚠ NEW at v8.7.3:** can the app's role **deactivate** a Facilio site/building/space, for C2's reverse-walk rollback? **If not, rollback is a manual cleanup and we must say so out loud.** *G1.*
**L22 — ⚠ NEW at v8.7.3:** does Facilio's **Client Contact** module accept a create via connections, and what are its mandatory fields? **Blocks C38 output #1, which is the fix for `F-08`.** *G1 — add to the same pass, not a separate discovery.*

## §13. PRESERVED ITEMS (do not lose)

1. **FM OS — My Page** (v7 entry): dead as entry per D1; its usage evidence (13%/92%, 4.3-min sessions) and R1/R6/R7 requirements are inherited into §6/§8.
2. **Coverage Intelligence / Zero-Dollar WO** → future product candidate. **Same family as C30** — design them together.
3. **Duplicate Guard** → backlog; its at-creation pattern reused in §6 #10 and C28.
4. **Provider Cockpit** → adjacent evidence for §1; CSM verification step still open.
5. **Record-skills layer, email triage, CIT account routing** → unchanged from v7 §4.
6. **Shelved pieces:** survey-approval public form (blocked by P7), procurement portal, delivery-half tabs. **The app naming decision is CLOSED — the app is Frontline (§0a).**
7. **The v37 `cit-crm` feature list** — quote engine, AI proposal builder, contract types, LOA, proposal PDF export, pipeline board, 360 account page, AI fit + deal health, survey scheduling, condition scoring, currency config. Not in the build of record, but a **design reference**. Full text: `claude/CLAUDE-v8.5-snapshot-13Aug2026.md` §2.
8. **Hard-FM return path:** the asset hierarchy level, C15's building profile, `survey_discipline` and its coverage guard, and the tender asset schedules all become valid again the day hard FM comes back. Reasoning preserved in `claude/survey-module-structure-v1.7.md`.
9. **⚠ NEW at v8.7.3 — the prospect-portfolio evidence sweep.** 88 recorded calls, named speakers and dates, indexed in `claude/prospect-portfolio-module-spec-v1.md` §2. It contains the four corrections to this file's own claims (§2.6) and the customer quotes now used in §11 answers 1, 3 and 10. **Cite it; do not re-run the sweep.**

## §14. HANDOVER — WHAT YAMEEN AND MITHUN NEED TO KNOW *(new at v8.7; extended at v8.7.2 and v8.7.3)*

1. **Read `claude/survey-module-structure-v1.8.md`, not CLAUDE.md §3, for the survey lane.** And read §0a — the glossary is binding.
2. **The survey lane is soft services only.** No assets, no floors as a hierarchy level, no building profile. **Site → building → space.**
3. **The module boundary is unchanged:** the survey ends at submit with a **frozen handoff payload** — prospect tree, per-space condition, answers tagged with `estimation_key`, qualifications, `not_visited_pct`. Estimation and pricing remain entirely Yameen's.
4. **⚠ "Convert" and "promotion" are two different operations** (§4.1). If you are about to write `conversion_log`, write **`fl_promotion_log`** instead. The *button* may read "Convert to Facilio"; the *handler* is `prospect.convert-to-facilio`.
5. **⚠ A lead becomes a customer at Won, not at convert** (§4.2, C28). **Now a live violation — `F-08`. C38 is the fix.**
6. **⚠ Services must be Facilio Services, wherever they are used** (C23). L10 unresolved → ship nullable reference columns, not a local catalogue.
7. **You cannot ALTER a table or create an index** (§3a P1–P3). Design columns before the first CSV. **Load `vibe-db` before any import (§0.2a).**
8. **"Notify" means `fl_event` + in-app** until G7 (C29). No spec may assume an email arrives.
9. **Two things to do before writing new code:** add the root `tsconfig.json` (G11), and **build the Deal detail surface** — still missing, still the survey module's intended entry point, still the BD manager's only possible home (`F-14`, `P-07`).
10. **⚠ Before you build anything, load the Facilio skill for it (§0.2a).** Not after it breaks.
11. **⚠ The three P0s and where they actually live.** `F-01` submit control missing. `F-02`/`C31` no numeric answer type. `F-03`/`C32` orphan spaces — **and the cause is the survey *create form*, which never asks for a site.** Two of the three are form changes, not architecture. Answer **L19** first; it decides whether `F-01` is twenty minutes or a day.
12. **⚠ NEW at v8.7.3 — the prospect portfolio is its own product area now** (§3b, `prospect-portfolio-module-spec-v1.1.md`). **`fl_prospect_node` is renamed `fl_prospect_location`, and `node_type` is now just `type`.** Nothing writes to Facilio's portfolio except `prospect.convert-to-facilio`, and it only ever **creates** — never updates an existing record.
13. **⚠ NEW at v8.7.3 — C35 and C36 apply to every spec you write from now on.** Every field carries a "why it exists" line; every module defines lifecycle, personas, operations and special actions, **because the permission set is built from it.** v1.8 is the template for C36; nothing currently passes C35.
