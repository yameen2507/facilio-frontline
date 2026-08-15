# Frontline — Architecture

> Facilio Vibe app owning everything **before** the contract or work order.
> Built by **Sudharsan** and **Mithun**. This file is the contract — if code and this file disagree, fix one of them deliberately.
>
> **Last reconciled with the code: 15 Aug 2026.**

**Three documents, three jobs. Do not merge them.**

| File | Answers |
|---|---|
| **`ARCHITECTURE.md`** (this) | What the app *is meant to be* — boundaries, invariants, platform limits, seams |
| **`WHAT-WE-BUILT.md`** | What exists on disk and what has been proven to run |
| **`API.md`** | The per-handler request/response contract |

So this file names functions and handler *groups* with the rule attached to each; it does not list every handler's fields. Adding a third inventory here is how all three go stale.

---

## 1. Scope

**In scope now: the whole pre-contract funnel, backend and console.**

```
capture → AI analysis → dedup → queue → qualify → convert
                                          │
                       Account + Contact + Deal
                                          │
                    survey → walk → frozen revision
                                          │
                    proposal → approve → send → accepted
                                          │
                        deal Won → Facilio FSM client + contact
```

The lead lane, the survey lane and the proposal lane are all built and walked end to end (`docs/e2e-findings-2026-08-15.md`). Alongside them sit three supporting modules the funnel needs: the **prospect portfolio** (the site/space tree a survey discovers, promoted to Facilio on Won), the **service catalogue + rate cards** (§2), and **access** (users, roles, the permission matrix).

### Channels — three, and only three

**There is no phone channel.** A lead arrives one of exactly three ways:

| Channel | `source` | How it arrives |
|---|---|---|
| **Web chat** | `widget` | Public conversational page; the intake agent extracts the requirement |
| **Scraping** | `tender` | Tender/RFQ notices. Abu Dhabi ADGPG works from the sandbox; Saudi needs a relay |
| **In-app, manually** | `inapp` | A person creates it inside the app — including a technician's defect or a re-clean coming due |

`sourceDetail` carries the refinement (`defect`, `reclean`, `site visit`), so narrowing a channel never needs a new enum value. And since enum-likes are `text` validated in `domain/` (§3a), even a genuinely new channel is a code change rather than a migration — which matters, because table shapes are permanent.

Not channels: **email-to-lead** (feasible — `gmail.list-messages` exists — but it adds an OAuth dependency and production-only polling) and **inbound webhook/API** (impossible; nothing can POST into a Vibe app).

**Backend AND console.** The original build was backend-only, and that stage is finished: nine platform functions answer real calls. On top of them sits a React console — nine feature modules on shadcn + Tailwind, mounted on `HashRouter` because the static host has no rewrite rules (§12). The console is not a mock; the modules listed in §7 call the live handlers. Where a surface ships ahead of its handler it is marked `[SEAM]` in the feature's api-util and renders a real empty state — never fake data.

**Designed but NOT built yet:** approval routing beyond auto-approve, the customer signing portal, work-order handoff, tender ingestion, email-to-lead, analytics, the automation engine — and the promotion tail below.

**The promotion tail is the live gap, not a future one.** Winning a deal today enqueues the Facilio client and its contact, and nothing else. `prospect.convert-to-facilio` exists only as a preflight, so surveyed sites and spaces never reach FSM; and because the contract task defers until a site is promoted, `create_client_contract` and `create_contract_service_line` are deployed and dispatchable but **nothing enqueues them**. Order is fixed: **convert run → contract → service lines.** See §10.

The rest are not future guesswork — §9 defines the exact seam each one plugs into, so none of them requires reworking what is built now. **Do not build them. Do not stub them. Just do not block them.**

---

## 2. Ownership boundary

The Vibe app is the system of engagement. Facilio FSM is the system of record for operational reality. We write outward to Facilio and store the returned id on our own row; Facilio is never our primary store.

| Concern | System of record |
|---|---|
| Lead, analysis, dedup, queue, SLA, qualification | **Vibe app** |
| Deal (the opportunity) | **Vibe app** |
| Survey, its visits, answers, observations and frozen revisions | **Vibe app** |
| Proposal, its lines, templates and rate cards | **Vibe app** |
| **Service catalogue** — services, their pricing basis and unit | **Vibe app** *(reversed 15 Aug 2026 — see below)* |
| Service areas + coverage | **Vibe app** |
| Prospect portfolio — the site/space tree before it is promoted | **Vibe app** |
| Users, roles, permission matrix | **Vibe app** |
| Account as a client record | **Facilio FSM** — `create-client` |
| Contact | **Facilio FSM** — `create-client-contact` |
| Sites / buildings / floors / spaces | **Facilio FSM on Won** — promoted from the prospect tree *(run not built — §10)* |
| Client contract + its service lines | **Facilio FSM on Won** — dispatch built, nothing enqueues it yet *(§10)* |
| Assets, work orders | Facilio FSM *(later)* |

### The service catalogue is ours now. This overturns a standing ruling.

**Until 15 Aug 2026 a "service line" was a label for a Facilio Services record id, and that id was what every rate-card row and proposal line referenced.** As of 15 Aug the app owns its own service definitions — a service is this app's record of something it sells, with its own code, pricing basis and unit (`src/domain/service-catalogue.ts`, `fl_service_line`, edited under Settings → Services). **The code is the key**: `fl_rate_card_row.service_code` and `fl_proposal_line.service_code` name a service by code, and this database has no foreign keys to notice when one stops matching, so codes are normalised where they are minted.

**This reverses C23**, which had ruled the Facilio Services id the source of truth. The reversal is recorded here because this file is the contract — but note the consequence the E2E run found: with no mapping from a local service code to a Facilio Services id, `create_contract_service_line` has no `facilioServiceId` to send. **The mapping C23 always wanted is now a prerequisite for contract lines**, not an alternative to the local catalogue.

---

## 3. Platform constraints (verified, not assumed)

Established against org **The Builder's Club (#2944)** with CLI `0.10.5`.

**`llm.md` is stale on the secrets model.** It documents `secret("SCHEMA")` / `secret("DB_USER")`. The authoritative guide (`facilio vibe function instructions`) says that was removed — use `process.env.*` and `process.system.*`. Trust the CLI guide.

| # | Constraint | Consequence for us |
|---|---|---|
| 1 | Handler params may only be `number` or `string` | All input travels as a JSON string in `payload` |
| 2 | No transactions across queries; `db.query()` is synchronous | Every write is one statement, or idempotent and resumable |
| 3 | `fetch` serialised, ~10s each; ~10s statement timeout | Batch work goes through the outbox, never inline |
| 4 | **Functions receive no caller identity** | Permissions are not enforceable server-side (§10) |
| 5 | No `crypto`, `Buffer`, Node built-ins, timers (QuickJS) | Tokens from Postgres or the browser, never `Math.random()` |
| 6 | **The app DB role cannot create, alter, drop or index anything** | Tables come from `facilio vibe db import` only — see §3a |
| 7 | Preview and production **share one Postgres schema** | Migrations additive-only, forever |
| 8 | Scheduled jobs fire **only on production**, min 15 min | No SLA alerting or polling until promoted |
| 9 | One file uploaded per function | Pre-bundle with esbuild, `@facilio/studio-functions` external |
| 10 | `@facilio/studio-functions` **not installable locally** (404 on `repo.facilio.in`) | Resolves only in the platform build; needs a local `.d.ts` shim |

## 3a. The database, as actually verified

Schema `vibe_df9b21f7a4a14901b15edabb254ca5a8` (resolves internally to `schema_2944_vibe_…`). Connect with:

```js
new StudioDatabase({
  userName: process.env.DB_USER,      // NOT DB_USERNAME
  password: process.env.DB_PASSWORD,
  schema:   process.env.SCHEMA,       // bare name; omit it and current_schema() is null
})
```

**The published docs' names are right; only the accessor differs.** `llm.md` and `facilio.com/developers/docs/vibe/llms.txt` (the same document) list `SCHEMA` and `DB_USER` and read them via `secret("KEY")`. The names are exactly correct. The accessor is not: probed inside a real function, `@facilio/studio-functions` exports only

```
StudioDatabase · VibeEvents · VibeFiles · default
```

`typeof secret === "undefined"`, so `secret("SCHEMA")` throws. The same values are present on `process.env` — `SCHEMA`, `DB_USER`, and `DB_PASSWORD` (the last undocumented). So we use the documented keys through the accessor that exists. Omitting `schema` leaves no search_path and every unqualified query fails.

**`VibeFiles` is exported** — undocumented, and it contradicts `llm.md` §11d's claim that the file store is reachable only from the browser. Worth revisiting when photos need pushing to Facilio; not needed for the Lead module.

### Permitted vs denied — probed, not assumed

| Works | Denied |
|---|---|
| `SELECT` / `INSERT` / `UPDATE` / `DELETE` | `CREATE TABLE` — *permission denied for schema* |
| `UPDATE … RETURNING` | `ALTER TABLE … ADD COLUMN` — *must be owner of table* |
| `INSERT … SELECT … WHERE NOT EXISTS` | `CREATE INDEX` — *must be owner of table* |
| `gen_random_uuid()`, `md5()`, `random()` | Re-importing an existing table — **500s** (`llm.md` claims it replaces the shape; it does not) |
| Parameterised `$1` placeholders | |

### What follows, and it is not negotiable

1. **Tables are created only by `facilio vibe db import`** — one CSV per table: header row plus one seed row for type inference, then delete the seed row through a handler.
2. **A table's shape is permanent.** No `ALTER`, no re-import, no drop. Adding a column later means creating a *new table* and migrating data.
3. **Therefore every table carries a `data_json text` column from day one.** Typed columns are only those we filter, sort or join on; everything else lives in `data_json`. This is the sole mechanism for evolving a record without a new table, so **it is mandatory, not a convenience**.
4. **No indexes are possible.** Every query is a sequential scan. Fine at MVP volume; keep `LIMIT` on every read and do not pretend otherwise in review.
5. **No `UNIQUE`, no FK, no `NOT NULL`, no defaults.** Referential integrity is application-level. Uniqueness (dedup keys, idempotency keys) is enforced with a single-statement `INSERT … SELECT … WHERE NOT EXISTS`, which is atomic and verified.
6. **Type inference is coarse:** numbers → `numeric`, everything else → `text`. No booleans, no timestamps. Booleans are `'true'`/`'false'` text; timestamps are **ISO 8601 UTC strings**, which compare and sort correctly (verified: `created_at > $1` works).
7. **`numeric`, `bigint` and `count(*)` all return JavaScript strings.** `"1234.50"`, `"42"`, `"2"`. `shared/db.ts` coerces at the boundary, in one place, before any row reaches `modules/`. `int` returns a number — so the inconsistency is real and silent.
8. **No serial columns.** Identity is `gen_random_uuid()` (verified working) stored as text. Human-facing refs (`LEAD-0001`) come from `fl_sequence` via the atomic `UPDATE … RETURNING`.

**Reachability, tested from inside a real function:** Abu Dhabi ADGPG works (`POST .../AlMaqtaa/Tender/List` → JSON). Saudi Etimad is **blocked** — F5/Shape JS bot challenge returns HTML, so it needs hyperbrowser or a paid aggregator. Relevant only when tender ingestion is built.

**Public access:** an auth-gated app 302s to `id.facilio.com`, which sends `X-Frame-Options: SAMEORIGIN` — so **a widget cannot be iframed until the app is set to public**, a platform UI setting, not a CLI flag. Platform cookies also carry no `SameSite`, which likely blocks them in a cross-site iframe. Fallback: open the intake page in a **tab** (first-party cookies, no framing) — the channel works either way.

**The embed exists and the host side is settled; the public-access grant is not.** `#/embed` is answered above the router so the widget renders without the sign-in gate (`frontend/src/app/App.tsx`), and a separate demo app frames it. A host page **cannot** call the SDK cross-origin — CORS closes that path — so an iframe is the only embedding shape, which is why the widget is a page rather than a script. Whether that frame renders for an anonymous visitor still depends on the app being set public, and **that grant has not been confirmed in this repo's records** — treat it as ungranted until someone checks the platform UI.

---

## 4. Layers

One hard rule: **`src/domain` imports nothing from `src/shared`.** No db, no fetch, no platform. That is what makes it testable on a laptop, and it is where the money maths and state machines live.

```
browser ──► vibe.executeFunction(fn, handler, { payload })
                  │
        ┌─────────▼─────────────┐
        │ functions/  (adapter) │  parse envelope → call module → publish event
        ├───────────────────────┤
        │ modules/    (use case)│  orchestration
        ├───────────────────────┤
        │ domain/     (pure)    │  states, scoring, money — NO IO, unit-tested
        ├───────────────────────┤
        │ shared/     (kernel)  │  db, envelope, ids, events, outbox, facilio
        └───────────────────────┘
                  │                        │
        app Postgres (truth)      fl_sync_task outbox ──► facilio-cmms
```

Facilio is **never** written to inline on the request path. With serialised ~10s fetches and no transactions, an inline multi-write handler times out half-done and unrecoverable. Everything external goes through the outbox.

### Repo layout

```
frontline/
├── ARCHITECTURE.md          ← this file (the rules)
├── WHAT-WE-BUILT.md         the inventory · API.md  the handler contract
├── vibe.json
├── db/tables/               ONE CSV PER TABLE — this is the schema (§3a.1)
├── docs/                    connections.md · enums.md · e2e findings
├── agent-schemas/           each agent's output schema + instructions, as pushed
├── scripts/
│   ├── bundle.mjs           esbuild src/functions/*/index.ts → build/functions/<name>.js
│   ├── push.mjs             facilio vibe function create-or-update + build
│   ├── push-agents.mjs      agent create/update from agent-schemas/
│   ├── db-import.mjs        header row + one seed row per table
│   ├── build-frontend.mjs   → dist/
│   └── walk.mjs             the end-to-end lead-lane proof
├── src/                     ← the backend
│   ├── domain/              PURE — no platform imports (21 files)
│   │   ├── lead-state.ts · deal-state.ts · survey-state.ts · visit-state.ts
│   │   ├── proposal-state.ts · prospect-state.ts · observation-state.ts
│   │   ├── scoring.ts · sla.ts · pricing.ts · proposal-pricing.ts
│   │   ├── service-catalogue.ts · form-template.ts · survey-completeness.ts
│   │   └── reconcile.ts · ancestry.ts · normalize.ts · agent-reply.ts …
│   ├── shared/              db · envelope · ids · events · outbox · facilio · errors
│   ├── modules/             lead · analysis · convert · deal · survey · snapshot
│   │                        proposal · prospect · form · service · settings
│   │                        assessment · agent-brief · intake · access · sync · walk
│   └── functions/           one directory per platform function — see §7
├── frontend/src/            ← the console
│   ├── app/                 App.tsx (routes) · auth · access · counts · shell
│   ├── layout/              sidebar, nav config, mobile tab bar
│   ├── components/ui/       shadcn primitives
│   ├── ui/                  the app kit — thin adapters over the primitives
│   ├── lib/                 vibe.ts · request.ts (requestFrom(fn, handler, args))
│   └── features/            one folder per module: api/ components/ pages/ types/
├── demo-site/               a host page that iframes #/embed
└── tests/                   vitest over src/domain (21 files), plus units under frontend/
```

Each feature folder owns its own `api/*-util.ts`, and that util names the function it calls — `requestFrom("survey", …)`, `requestFrom("form", …)`. `FUNCTION = "lead"` in `vibe.ts` is only the default. **A page never calls a handler directly**; the util is the one place a seam can be declared.

---

## 5. Data model

`fl_` prefix, `snake_case`. **Created by `facilio vibe db import` from a CSV per table** (§3a) — not by DDL, which is denied.

**Every table has exactly this shape:**

```
id           text     -- gen_random_uuid()
<queryable>  numeric | text   -- ONLY columns we filter, sort or join on
data_json    text     -- everything else, as JSON
created_at   text     -- ISO 8601 UTC
updated_at   text     -- ISO 8601 UTC
```

Two rules follow from the shape being permanent (§3a.2):

- **Be generous with queryable columns up front.** Adding one later means a new table. When unsure whether a field will be filtered on, make it a column.
- **Everything not filtered goes in `data_json`.** That is how a record gains fields without a migration.

Enum-likes are plain `text`, validated in `domain/` — never Postgres `ENUM`. New states and sources are code changes.

### Built now

| Table | Holds |
|---|---|
| `fl_schema_version` | migration ledger |
| `fl_setting` | key + value_json — SLA targets, currency, defaults |
| `fl_sequence` | ref numbers (`LEAD-0001`, `DEAL-0001`) |
| `fl_event` | **one** append-only log: entity_type, entity_id, kind, actor, meta_json, at |
| `fl_sync_task` | outbox: action, payload_json, **idempotency_key UNIQUE**, depends_on_id, status, attempts, next_attempt_at, last_error, facilio_id |
| `fl_photo` | entity_type, entity_id, **vibe_file_id**, file_name, content_type, size |
| `fl_lead` | see below |
| `fl_lead_analysis` | versioned AI verdict — lead_id, version, verdict, score, understanding_json, reasons_json, model_name, created_at |
| `fl_lead_assignment` | ownership history — lead_id, from_user, to_user, role, reason, at |
| `fl_deal` | lead_id, account_id, contact_id, ref_no, title, stage, estimated_value, currency, sales_owner, source |
| `fl_account` | lead_id *(the lead that first created it)*, name, email, phone, website_domain, address_json, **facilio_client_id**, sync_status |
| `fl_account_contact` | account_id, name, email, phone, is_primary, **facilio_contact_id**, sync_status |
| `fl_service_area` | name, emirate/region, country, active |
| `fl_service_line` | code, name, active |
| `fl_service_coverage` | area_id, service_line_id, active |
| `fl_intake_session` | **session_token UNIQUE**, source_url, ip_hash, user_agent, turn_count, status, lead_id |
| `fl_intake_message` | session_id, role (`visitor`\|`agent`), content, at |

### `fl_lead`

```
ref_no, company_name, contact_name, contact_email, contact_phone, website_domain,
source (widget|manual|tender|defect|reclean), source_detail,
service_type, description, estimated_value, currency,
status, disposition_reason, duplicate_of_lead_id, nurture_until,
owner_email,                      -- the actioner
account_id, deal_id, facilio_asset_id,
arrived_at, first_response_due_at, reviewed_at, first_contact_at,
qualification_due_at, qualified_at, assignment_due_at, assigned_at
```

Normalised dedup keys (`email_norm`, `phone_norm`, `domain_norm`) are stored alongside and indexed.

---

## 6. Lead states

**Status and reason are separate fields.** `spam`, `duplicate`, `outside_region`, `wrong_service` are *reasons a lead closed*, not states. Flattening them means you cannot count "how many closed" without unioning five values.

### `status` — lifecycle

| State | Meaning | Starts SLA clock |
|---|---|---|
| `new` | captured + analysed, unclaimed | `first_response_due_at` |
| `in_review` | claimed by an actioner | `qualification_due_at` |
| `contacted` | first contact logged | — |
| `qualified` | real, in scope, worth pursuing | `assignment_due_at` |
| `nurture` | real but not now; `nurture_until` returns it to the queue | — |
| `converted` | Account + Contact + Deal created — **terminal, success** | — |
| `closed` | not proceeding — **terminal**, requires a reason | — |

**Neither terminal state is a dedup target.** A repeat enquiry from a converted customer is their next job, not a duplicate of their last one, so it comes in as a real lead; `convert` then finds the company's existing account and opens a second deal on it. Accounts are per company, deals are per lead.

### `disposition_reason` — only when `closed`

`spam` · `duplicate` · `outside_region` · `wrong_service` · `not_interested` · `no_budget` · `no_response` · `lost_to_competitor` · `test`

### Transitions — `domain/lead-state.ts`

```
new        → in_review | closed
in_review  → contacted | qualified | nurture | closed
contacted  → qualified | nurture | closed
qualified  → converted | closed
nurture    → in_review | contacted | closed
converted  → (terminal)
closed     → (terminal; reopening creates a new lead linked to the old)
```

`new → closed` lets obvious spam die unclaimed.

### `fl_deal.stage`

`open → surveying → quoted → won | lost`. Minimal on purpose — it maps onto the funnel that comes later rather than inventing a sales pipeline now.

---

## 7. The API contract

**Frozen. The UI is built against this and nothing else.**

- Every handler takes `payload` (a JSON string) plus, where useful, a scalar `id` or `token`. Nothing else — the platform allows only `number` and `string`.
- Every handler returns `{ ok, data?, error? }`. Never a bare array, never a bare string.
- `snake_case` in Postgres, `camelCase` in JSON. Convert in `shared/db.ts` **only**.
- Money: integer minor units in JS, `numeric(14,2)` in Postgres. Never a float.
- **No inventing field names.** Not in §5 ⇒ does not exist. Add it there first.
- **No inventing Facilio action slugs.** Discover with `facilio connections search`, verify with `facilio connections schemas`. An invented slug fails at runtime, not at build.

### `migrate`

| Handler | Does |
|---|---|
| `up` | idempotent DDL + indexes + seed settings and service lines |
| `status` | applied schema version |

### `lead`

| Handler | Does |
|---|---|
| `create` | **the only writer of `fl_lead`.** Normalises, dedups, stamps SLA dates, enqueues analysis |
| `list` | queue and list views — filters: status, owner, overdue, score band, source |
| `get` | lead + latest analysis + timeline + assignment history |
| `update` | editable fields only; never status |
| `transition` | the **only** way status changes; validated by `domain/lead-state.ts` |
| `claim` | actioner takes an unclaimed lead → `in_review` |
| `assign` | assign/reassign actioner or sales owner; writes `fl_lead_assignment` |
| `log-activity` | call, email, note, attachment → `fl_event` |
| `analyse` | run `lead-analyst`, store a new `fl_lead_analysis` version |
| `convert` | qualified → Account + Contact + Deal; resolves the company's existing account before creating one; enqueues Facilio client + contact writes |
| `account-list` | companies with their lead and deal counts |
| `account-get` | account + contacts + deals + every lead that resolved to it. Read-only: editing needs an `update_client` outbox action first |
| `settings-get` / `settings-put` | service areas, service lines, coverage, SLA targets |

### `portal` (public, added with the widget)

Every handler requires `share_token` / `session_token` and returns a redacted projection: `intake-start`, `intake-turn`, `intake-attach`, `intake-submit`.

### Mechanisms forced by "no transactions"

- **Sequences** — one statement: `UPDATE fl_sequence SET current_value = current_value + 1 WHERE name = $1 RETURNING current_value`
- **Outbox claim** — one statement with `FOR UPDATE SKIP LOCKED`, never SELECT-then-UPDATE
- **Multi-row inserts** — a single multi-row `INSERT`; it is the only atomicity primitive available
- **Idempotency** — deterministic keys (`lead:{id}:create_client`) on a UNIQUE index, so retries cannot double-write
- **Reads** — always `LIMIT`, always check `truncated`
- **Realtime** — one `events.publish()` per mutation, after the write, never in a loop

---

## 7a. VERIFIED: Facilio calls intermittently exceed the fetch timeout

`facilio-cmms.create-client` succeeded in about a second on one pass and **aborted at ~10s on another** — same action, same payload. `create-client-contact` aborted twice then succeeded on the third attempt. Observed Facilio ids: 30248, 30249.

This is not a bug to fix; it is the condition the outbox exists for. What it means in practice:

- **Never assert first-attempt success.** A drain result of `retry` is correct behaviour, not a failure. `scripts/walk.mjs` asserts that every task was handled gracefully (`done` / `retry` / `deferred`) and that nothing dead-lettered, rather than that the write landed immediately.
- **The dependency deferral works as designed** — with the client not yet synced, `create_client_contact` came back `deferred — client not synced to Facilio yet`, consumed no attempt, and succeeded once the client existed. No orchestrator needed.
- **Retry delivers.** Both writes landed within a few minutes without intervention.
- Until the app is promoted to production there is no scheduled drain, so someone (or the browser) has to call `sync-drain` again. That is the only manual part.

**Known gap:** `create-client-contact` returns no id that `extractRecordId` can find, so `fl_account_contact.facilio_contact_id` stays null even though `sync_status` is `synced`. Harmless now — nothing consumes the contact id — but it must be resolved before anything references a Facilio contact.

---

## 8b. An agent has TWO names. They are not interchangeable.

| Identifier | Example | Used by |
|---|---|---|
| **Logical name** | `intake`, `lead-analyst` | `vibe.executeAgent` in the browser — the server resolves by `(app, name)` from the request host |
| **Link name** | `intake_df9b21f7…` | the `facilio-ai-studio` connection actions, server-side |

Passing the link name to the browser SDK returns **`404 — agent 'intake_df9b…' not found`**. `analysis.ts` keeps them in separate settings (`lead.analyst_agent` for the logical name, `lead.analyst_agent_link` for the link name) so the two call paths cannot be crossed again.

**Also verified about agents:**

- **Output schemas have a complexity ceiling.** A 15-property schema with one nested object was rejected by the provider with `Schema is too complex` (400), which then surfaced as repeated 504s. **Nine flat properties works.** Push rich detail into a summary string field rather than adding more properties.
- **`agent delete` leaves the flow-ai record behind.** Recreating an agent under the same name fails with a duplicate-key error on the link name, so agent names are effectively single-use. `lead-intake` had to become `intake`.

---

## 8a. VERIFIED: a function cannot wait for an LLM

Tested on `lead.analyse` against the real agent: **the call aborts at ~13s** with `This operation was aborted`. The sandbox's ~10s per-fetch timeout is shorter than LLM latency, and `run-agent-chat` blocks until the reply is complete. There is no streaming and no polling variant.

Standalone, the same agent works well — `facilio vibe agent run lead-analyst` returned `relevant`, score 88, with reasons citing the scope block. So the agent and schema are fine; the *transport* is the problem.

**Therefore the model call happens outside the function, and the verdict is posted in:**

```
browser: vibe.executeAgent('lead-analyst', input)   ← model call lives here
   ↓
lead.analyse { leadId, replyJson }                  ← function only parses + stores
```

`analyse` accepts `replyJson` (string or object) for exactly this reason, and that path is verified end to end — version 1 stored, score denormalised onto the lead, `analysed` event on the timeline.

Consequences to respect:
- **Never** add a handler that waits on a model. The same limit applies to any slow third-party API.
- The browser (or CLI) owns the agent call; `buildAnalystInput` is exported so the caller can construct the same prompt the server would have.
- A scheduled job cannot analyse leads either — same timeout — so batch analysis needs the same client-driven shape.

**What "agent configuration in the UI" can and cannot mean.** An agent's provider, model, output schema and its own `--instructions` are set by `facilio vibe agent create/update` and the browser SDK exposes only `executeAgent` — there is no runtime path to any of them. So the Settings screen edits the one thing this app controls: the text it *sends*. Two settings hold it — `agent.scope_notes`, appended to the generated coverage brief, and `agent.analyst_task`, the closing instruction in `buildAnalystInput`. Coverage data stays the source of truth for relevance; the note only carries nuance a matrix cannot express. Anything the UI cannot change is shown read-only rather than as an input that silently does nothing, and each stored verdict records whether the prompt was edited (`prompt_version`).

---

## 8. The two agents

Do not merge them. **Extraction and judgment are different jobs.**

| | `intake` | `lead-analyst` |
|---|---|---|
| Job | extraction — what did they say? | judgment — is this ours, how good? |
| Shape | conversational, multi-turn, **stateless** | classifier, one call, structured |
| Runs | live per visitor turn, **public** | once per lead, **every channel** |
| Cost exposure | public → hard rate limits | bounded |

Judgment runs once per lead on one path regardless of channel: a manually entered lead has no conversation but still needs relevance and a score. And because relevance depends on `fl_service_coverage`, two agents holding opinions about scope would drift.

**`intake` must be stateless.** Stateful threads scope to *the signed-in user*, and in a public app every anonymous visitor shares one identity — so stateful would leak one visitor's conversation into another's. Pass the transcript yourself, keyed by `session_token`.

**`lead-analyst` output** — three requested features are one model call:

```json
{ "understanding":  { "wants", "services": [], "facilityType", "location",
                      "urgency", "estimatedValue", "missingInfo": [], "risks": [] },
  "relevance":      { "verdict": "relevant|not_relevant|outside_region",
                      "reasons": [], "matchedServices": [], "unmatchedServices": [] },
  "score":          { "value": 0, "fitReasons": [], "redFlags": [] },
  "recommendation": { "nextAction", "rationale" } }
```

**The AI verdict never writes `fl_lead.status`.** It lands on `fl_lead_analysis`; a human decides. That separation is what makes **override rate** measurable — the metric that tells you whether the analyst can eventually auto-close low scores.

**Guardrails:** the intake agent never quotes a price or commits to a date (pricing needs a survey). Treat all agent output as untrusted before it drives a write. Cap turns per session, sessions per IP hash per hour, and message length — a public LLM endpoint is a spend-attack surface.

**SLA without a scheduler:** stamp `*_due_at` on arrival from `fl_setting` targets, then compute *overdue* **at read time** in `list`. The whole overdue/priority queue works on day one; only alerting needs production.

---

## 9. Provisions — how unbuilt modules connect

These exist so nothing built now has to be reworked later. **Honour them; do not build against them.**

| Later module | Seam it uses | What must stay true |
|---|---|---|
| **Survey** | `fl_survey.deal_id → fl_deal` | Deal is the parent of operational work. Nothing hangs surveys off a lead |
| **Quote** | `fl_quote.deal_id → fl_deal` | Same |
| **Signing portal** | the `portal` function + token pattern | Public handlers are token-gated and return redacted projections. Never add an untokenised public handler |
| **Work-order handoff** | `fl_sync_task.action` + `shared/facilio.ts` | New external write = new action value + handler. Never a new outbox table, never an inline Facilio call |
| **Tender ingestion** | `lead.create` with `source='tender'` | `create` is the **only** writer of `fl_lead`. A new channel is an adapter producing a normalised draft, nothing more |
| **Email-to-lead** | same as above, `source='email'` | Same. `gmail.list-messages` exists; it needs an OAuth link and production polling |
| **Defect loop / re-clean** | same, `source='defect'` / `'reclean'` | Same |
| **Analytics + dashboard** | read-only over `fl_lead`, `fl_event`, `fl_deal` | **Never denormalise counters.** Derive at read time so analytics needs no writes and no migration |
| **SLA alerting** | the `*_due_at` columns + a scheduled job | Columns exist now; the job is added post-promotion. No schema change |
| **Automation engine** | outbox + `*_due_at` | Same substrate. Automation is scheduling over existing state, not a new state store |
| **Permissions** | `role` in settings + the two-app split | See §10 |
| **Contract** | `fl_deal` + a handoff marker | Facilio has no contract API — it stays a human step |

**Rules that keep the provisions valid:**

1. **Additive-only migrations.** Preview and production share one schema; old code must keep working.
2. **One writer per aggregate.** `lead.create` and `lead.transition` are the only paths that create leads and change status. Every channel and every automation goes through them.
3. **Enum-likes are `text`, validated in `domain/`.** New values are code, not migrations.
4. **New module = new function.** Never widen an existing function for a different module — builds are per-function and that is what keeps two people out of each other's files.
5. **No denormalised counts.** Derive.

---

## 10. Known limitations — state these, do not imply otherwise

- **Permissions are not enforceable server-side.** Functions get no caller identity, so an RBAC matrix across Admin / Sales Manager / Sales Rep / Lead Actioner / Surveyor prevents accidents via the UI, not a determined user. Real enforcement needs the two-app split or Facilio-side auth.
- **Actor identity is client-asserted** — the browser passes it from `getCurrentUser()`. The audit trail is honest about *what* changed, and trusting about *who*.
- **No SLA alerts, no polling, no automation until the app is promoted to production.**
- **The widget needs public app access**, set in the platform UI. Until then, intake is testable only as a first-party page.
- **Contracts cannot be created via any Facilio action** — a human does it in FSM.
- **Photos cannot attach to a Facilio asset** — no such action exists. They live in the app file store.

---

## 11. Build order

**Stage 1 — understand.** Both builders read §2, §5, §6 and agree the vocabulary. No code. Ends when both can name what each table holds.

**Stage 2 — backend.**

1. Scaffold `scripts/bundle.mjs` + `push.mjs`; `.d.ts` shim for `@facilio/studio-functions`
2. `facilio vibe db create` *(pending — one platform write)*
3. **Probe function** — settles env var names, DDL permission, transaction support, numeric typing, `gen_random_uuid()`
4. `shared/` kernel + `migrate` → verify with `facilio vibe db tables` / `describe`
5. `domain/` states + scoring + SLA maths, unit-tested locally **before** any handler uses them
6. `lead` create / dedup / list / get / transition / claim / assign / log-activity
7. Settings (service areas, lines, coverage, SLA targets)
8. `lead-analyst` agent + `analyse`
9. `convert` → Account + Contact + Deal, enqueue Facilio writes
10. `sync` drain for the client/contact actions

**Exit gate:** every handler in §7 returns real data via `facilio vibe function run`, and a full CLI walk passes — create lead → analyse → dedup → claim → contact → qualify → convert → drain → confirm the Facilio client exists.

**Stage 3 — frontend. OUT OF SCOPE for this build.** When it is picked up, it goes against the frozen §7 contract with nothing mocked, in this order: shell + auth → lead list/queue → lead detail (intelligence card + timeline) → qualification actions → conversion → settings → intake widget last (needs public app access). Recorded here so the contract is designed for it, not so anyone starts it.

### Ownership

Split by **function**, so two people never edit the same file.

| Owner | Owns |
|---|---|
| One | `lead` handlers: create, dedup, list, get, queue, claim, assign |
| The other | `analysis` + `lead-analyst` agent, `convert` + `deal`, settings |
| Shared — agreed once, then frozen | `migrate`, `shared/`, `domain/` |

**Gate before pushing any function:** `npm test` passes on `domain/`.

---

## 12. Local development

- **`npm test`** — vitest over `src/domain` only. Runs on a laptop, no platform, no network. State machines, scoring, SLA date maths. This is where the logic that matters gets proven.
- **There is no local Postgres.** The app DB is remote, so handler tests hit the real schema; use a `_probe_` prefix for throwaway tables.
- **Backend integration loop, no UI needed:** `node scripts/bundle.mjs && node scripts/push.mjs lead && facilio vibe function run lead create --args '{"payload":"…"}'`
- **esbuild:** `bundle: true`, `format: 'esm'`, `external: ['@facilio/studio-functions']`, `target: 'es2020'`, **no minify** initially so platform build errors stay readable. `server.execute()` must remain the last top-level statement and nothing may do IO at module scope.

---

## 13. Platform state

Already created: app **`frontline`** (`https://frontline.vibe.facilio.com/`), function `tenderprobe` (a reachability probe, safe to delete).

Database provisioned, with the `fl_*` tables imported and carrying working data. Functions `lead` and `migrate` are uploaded and built; the other five directories under `src/functions/` are still empty, so nothing else ships.

Deployed to **preview only** — `https://preview-frontline.vibe.facilio.com/`. `facilio vibe deploy` publishes there by default; production is the separate `--prod` flag.

Not yet done: any production promotion (`facilio vibe deploy --prod`), public access.
