# Frontline — what we actually built

> An inventory, not a plan. `ARCHITECTURE.md` says what the app is *meant* to be; this file says
> what exists on disk and what has been proven to run, as of 13 Aug 2026. Check `git log` for the
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
to *Account + Contact + Deal exist and are pushed into Facilio FSM* — as a backend of **two
functions**, plus a **React console** on top of it with four working surfaces. Everything downstream
of the deal (survey, quote, approval, signing portal, work-order handoff) is **designed only**. The
survey lane in particular has four specification documents totalling ~155 KB and **no code at all**.

```
capture → AI analysis → dedup → queue → qualify → convert → outbox → Facilio FSM
└──────────────────── BUILT ────────────────────────────────────────────────┘
                                                    survey → quote → approval → signature → work order
                                                    └──────────── DESIGNED ONLY ──────────┘
```

---

## 2. Backend — built & verified

### 2.1 Two functions ship. Five directories are empty.

Everything that runs lives in exactly two uploaded functions.

| Function | Handlers | Path |
|---|---|---|
| `lead` | **23** | `src/functions/lead/index.ts` (684 lines) |
| `migrate` | **4** | `src/functions/migrate/index.ts` (176 lines) |

The other five directories under `src/functions/` — `core`, `portal`, `quote`, `survey`, `sync` —
contain a `.gitkeep` and nothing else. **This matters:** the handlers §7 assigns to a public `portal`
function were built inside `lead` instead (§6.1), and the outbox handlers sit there too — so "the
`portal` function" and "the `sync` function" do not exist as deployable units.

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

**`migrate` — 4 handlers:** `clean-seed`, `seed-config`, `status`, `verify`. Deliberately **not DDL** —
the app's DB role cannot create, alter, drop or index anything, so this function only manages table
*contents* (strips the CSV type-inference seed row, seeds sequences and SLA defaults, counts rows).

### 2.2 The layers under the handlers

| Layer | Files | Lines | What it is |
|---|---|---|---|
| `src/modules/` | 7 | ~2,520 | The real work: `lead` (747), `settings` (408), `analysis` (339), `intake` (303), `convert` (285), `account` (224), `sync` (214) |
| `src/domain/` | 4 | 477 | Pure logic, no IO: `lead-state`, `normalize`, `scoring`, `sla` — **this is the tested part** |
| `src/shared/` | 7 | 780 | The kernel: `db`, `envelope`, `events`, `facilio`, `ids`, `outbox`, `row-map` |

### 2.3 Database — 16 tables, imported from CSV

`db/tables/` holds **16 CSVs**, and a CSV *is* the schema — `facilio vibe db import` infers columns
from it, because DDL is denied to the app role.

`fl_account`, `fl_account_contact`, `fl_deal`, `fl_event`, `fl_intake_message`, `fl_intake_session`,
`fl_lead`, `fl_lead_analysis`, `fl_lead_assignment`, `fl_photo`, `fl_sequence`, `fl_service_area`,
`fl_service_coverage`, `fl_service_line`, `fl_setting`, `fl_sync_task`.

`fl_schema_version` is listed in `ARCHITECTURE.md` §5 but **was never built** — no CSV, no reference
anywhere in `src/`. See §6.4.

### 2.4 The two agents

`agent-schemas/` holds the two output schemas: `lead-intake.json` (`LeadIntake` — reply, complete,
plus the extracted fields) and `lead-analyst.json` (`LeadAnalysis` — understanding, relevance, score,
recommendation).

Both are called **from the client, never from a function** — a Vibe function cannot wait for a model.
That constraint shaped the API: `analyse-input` hands out the prompt, the caller makes the model call,
`analyse` stores the reply. Same split for `intake-turn`.

### 2.5 What proves the backend works

- **`npm test` — 81 tests across 7 files, all passing** (verified this session). Covers the domain
  layer (`lead-state`, `normalize`, `scoring`, `sla`, `db-map`) plus two frontend units.
- **`scripts/walk.mjs`** — an end-to-end walk against the real platform, entirely through
  `facilio vibe function run`: create lead → analyse → dedup → claim → contact → qualify → convert →
  drain → confirm the Facilio client exists. Re-runnable (fresh dedup keys each run).
- **`ARCHITECTURE.md` §13** records `lead` and `migrate` as uploaded and built, with the `fl_*` tables
  carrying working data.

### 2.6 Tooling that we also built

| Script | Does |
|---|---|
| `scripts/bundle.mjs` | esbuild pre-bundle — one file per function is all the platform accepts |
| `scripts/push.mjs` | uploads a function |
| `scripts/db-import.mjs` | **is the schema** — header row + one type-inference seed row per table |
| `scripts/walk.mjs` | the end-to-end proof above |
| `scripts/build-frontend.mjs` | builds `dist/` |
| `scripts/gen-connection-actions.mjs` | registers each handler as a Facilio connection action — **written as DRAFT, not yet published** |

---

## 3. Frontend — built, and wired to live handlers

`ARCHITECTURE.md` §11 declares Stage 3 out of scope. It was built anyway, and it is **not** mocked.

React 19 + `react-router` 7 on **HashRouter** (the platform serves a static folder with no rewrite
rules, so a real path 404s on reload). Every call goes through one place — `frontend/src/lib/request.ts`
— into the single `lead` function (`FUNCTION = "lead"` in `frontend/src/lib/vibe.ts`).

| Module | Surfaces | Data layer |
|---|---|---|
| **Leads** | `Inbox` (139), `LeadDetail` (352) + 6 components: `AiAssessment`, `LeadChips`, `LifecycleSteps`, `ResponseClocks`, `Timeline`, `TranscriptCard` | **LIVE** — no seam |
| **Accounts** | `AccountList` (147), `AccountDetail` (189) | **LIVE** — no seam |
| **Website chat** | `Chat` (214) — the visitor intake conversation | **LIVE** — no seam |
| **Scope & SLA** | `Settings` (288) | **LIVE** — no seam |

All four `api/*-util.ts` files state it explicitly in their headers: *the endpoints are live, there is
no seam here.* **Neither half of the repo contains mock data or a `[SEAM]` marker** (grepped across
`frontend/src` and `src`) — unusual for this codebase's own conventions, and only possible because the
backend landed first.

**Also built:** the app shell (`Layout`, `Sidebar` with data-driven nav, `TopBar`, `PageShell`),
a 13-component UI kit (`Button`, `Card`, `Chip`, `Facts`, `Icon`, `OverlayScrollbar`, `Row`,
`Skeleton`, `States`, `Tabs`, `Toast` + `text.ts`, `primitives.tsx`), light/dark theming
(`ThemeProvider`, `ThemeSwitcher`, `theme-boot.js`), and real Facilio DSM tokens
(`tokens.css`, documented in `DSM-TOKENS.md`) with Facilio's own icons via `@facilio/icons`.

**Verified:** `npm run typecheck:frontend` passes clean. `dist/` is built (`app.js` 328 KB,
`app.css` 56 KB).

**Not built on the frontend:** the embeddable public widget (needs public app access, which is not
granted), and any nested/accordion navigation — the sidebar supports it, nothing uses it.

---

## 4. Designed only — zero code

| Thing | Where it's specced | Code |
|---|---|---|
| **Survey module** | `Survey Module Structure v1.7.md` (90 KB), `Survey Backend Plan v1.md` (39 KB), `Survey Terminology Audit v1.md` (16 KB), `Claude v8.6 Amendment Survey Scope.md` (8 KB) | **none** — `src/functions/survey/` is a `.gitkeep` |
| Quote | `ARCHITECTURE.md` §9 seam (`fl_quote.deal_id`) | none |
| Approval + customer signing portal | §9 seam (`portal` function + token pattern) | none |
| Work-order handoff | §9 seam (outbox action + `shared/facilio.ts`) | none |
| Tender ingestion | §9 seam (`lead.create` with `source='tender'`) | none |
| Email-to-lead | §9 seam (same) | none |
| Analytics + dashboards | §9 seam (read-only, derive at read time) | none |
| SLA alerting / automation | §9 seam (`*_due_at` + a scheduled job) | none — and impossible before production promotion |

The survey lane is the headline here: **~155 KB of specification, 18 new tables designed, a frozen API
contract written, and not one line of code.** Its backend plan documents deviations from the structure
spec, and the terminology audit flags that the handoff payload — the thing that connects survey back to
the built half — is *not defined anywhere yet*.

---

## 5. Deployment state

- App `frontline` exists at `https://frontline.vibe.facilio.com/`.
- Deployed to **preview only** — `https://preview-frontline.vibe.facilio.com/`.
- **No production promotion.** `facilio vibe deploy --prod` has not been run.
- **No public app access.** So: no widget, no scheduled jobs, no SLA alerting, no polling — scheduled
  jobs fire only on production.
- The Facilio connection actions are registered as **DRAFT**; they go live when the connection is
  published from the platform UI.
- A leftover probe function `tenderprobe` exists and is safe to delete.

Scoped to this repo state — §13 has already been corrected once (`57daf38`) and the React frontend
landed after it, so treat live-environment claims as needing a re-check, not as gospel.

---

## 6. Where the docs and the code disagree

Found while compiling this inventory. Each is a real drift, not a nitpick — someone building against
the docs would hit every one of them.

**The pattern: `ARCHITECTURE.md` §7 fell behind; `API.md` mostly kept up.** Read §7 for intent, `API.md`
for the contract.

1. **`intake-*` is not in a `portal` function.** §7 puts the intake handlers in a public `portal`
   function. They are registered inside `lead/index.ts` (lines 635–678). Also: §7 lists
   `intake-attach`, which **does not exist**; the code has `intake-transcript`, which is in neither
   doc. And all four `intake-*` handlers are **absent from `API.md` entirely** — the one place the
   newer doc is the thinner one.
2. **`sync-drain` / `sync-status` / `sync-retry` are in `lead`, not a `sync` function.** They're
   properly documented in `API.md` (§Outbox); §7's table omits all three, mentioning `sync-drain` only
   in passing prose (§7a, line 341). `src/functions/sync/` is empty, so nothing else could host them.
3. **`migrate` has different handlers than specced.** §7 says `up` and `status`. The code has
   `clean-seed`, `seed-config`, `status`, `verify` — and explicitly avoids DDL, because the role
   cannot execute it.
4. **`fl_schema_version` doesn't exist.** §5 "Built now" lists it; there is no CSV and no code
   reference. The real count is **16 tables**, not 17.
5. **`analyse-input` is the one genuinely undocumented handler** — absent from both §7 and `API.md`,
   despite being the handler that carries the analyst prompt. (`reference` looks undocumented if you
   only read §7, but `API.md` gives it its own section.)
6. **§12 says tests cover `src/domain` only.** `npm test` now also runs
   `frontend/src/features/leads/actions.test.ts` and `filters.test.ts` — 7 files, not 5.
7. **§11 says the frontend is out of scope.** Four feature modules are built and wired live.
8. **`npm run typecheck` does not work.** There is no root `tsconfig.json`, so `tsc --noEmit` prints
   the compiler's help text instead of checking anything. It does exit `1`, so it fails loudly rather
   than passing green on an empty check — but the backend is currently **not typechecked by any
   script**. `typecheck:frontend` is fine; it has `frontend/tsconfig.json`. **Fix:** add a root
   `tsconfig.json` covering `src/`, then expect real errors on first run.

Item 8 is the only one that is a bug rather than stale prose. The rest are a choice: update
`ARCHITECTURE.md` §7 to match the code, or move the handlers to match §7 — but the second is only
worth doing if the `portal` split is still wanted for public access.

---

## 7. Reading order, if you're new to this

1. `ARCHITECTURE.md` §1–§3a — scope, ownership boundary, and the platform constraints that shaped
   every decision (all verified, not assumed).
2. `API.md` — the handler-by-handler contract, with real request/response examples.
3. `src/domain/` + `tests/` — the logic that actually matters, provable on a laptop.
4. `DSM-TOKENS.md` — before touching any UI.
5. The survey docs — **only** when that lane starts. They describe nothing that exists yet.
