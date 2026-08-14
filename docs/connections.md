# Facilio connections — G1 probe findings

Probed live on **The Builder's Club (#2944)**, 2026-08-14, via `facilio connections search / schemas / execute`
as `vibeathon-2026+tbc@facilio.com`. This file and `enums.md` are the gate the chat doc demands:
**no `executeAction` in app code for a module that is not recorded here.**

Discovery loop (rerun it whenever a slug or shape is in doubt — do not trust this file over the CLI):

```bash
facilio connections search <plain words>          # find <connection>.<action> slugs
facilio connections schemas <slug> --with-output  # payload + response contract
facilio connections execute <slug> --params '{"…"}'  # dry-run from the terminal first
```

Split the slug on the dot for `vibe.executeAction(connectionSlug, actionSlug, payload)` /
`executeAction()` in `src/shared/facilio.ts`.

## What the promotion can write today — all verified by live create calls

| Record | Action | Verified | Probe record |
| --- | --- | --- | --- |
| Client | `facilio-cmms.create-client` | ✅ (walk.mjs, ongoing) | e.g. id 30248 |
| Client contact | `facilio-cmms.create-client-contact` | ✅ (walk.mjs) | — |
| Site | `facilio-cmms.create-site` | ✅ this probe | id 2320877 |
| Building | `facilio-cmms.create-building` | ✅ this probe | id 2320896 |
| Floor | `facilio-cmms.create-floor` | ✅ this probe | id 2320960 |
| Space | `facilio-cmms.create-space` | ✅ this probe | id 2320897 |
| Work order | `facilio-cmms.create-work-order` | ✅ this probe | id 14300887 |
| Service (catalog) | `facilio-cmms.create-service` | ✅ this probe | id 230132 |
| Job plan (PPM checklist) | `facilio-cmms.create-a-job-plan` | metadata reads OK; create not yet probed | — |

Reads that exist and answered ledger items: `list-services` + `get-service-metadata` (**L10 — the
Services read action exists; ids are plain numbers**), `get-client-metadata`, `list-clients`,
`get-job-plan-task-metadata` (**L13 — Facilio holds a 45-entry skill master**, see enums.md),
`get-<module>-metadata` for every module above.

## ✅ CLIENT CONTRACT IS SOLVED — `facilio-fsm-client-contracts` (2026-08-15)

**A published connection now exists and the full flow is proven end to end.** Everything below in
"it lives in the FSM app" is the diagnosis that led here; keep it for the reasoning, but the
blocker is gone. Nothing in the promotion is un-writable any more.

Connection **`facilio-fsm-client-contracts`** — CUSTOM, published by our own org (2944), base
`https://app.facilio.com`, auth `service_token`. **22 actions**, full CRUD over the FSM app:

| Verb | Action | Path |
| --- | --- | --- |
| GET/POST/PATCH | `list-clients` / `get-client` / `create-client` / `update-client` | `/fsm/api/v3/modules/client[/…]` |
| GET/POST/PATCH | `…-client-contact` | `/fsm/api/v3/modules/clientcontact[/…]` (all lowercase) |
| GET/POST/PATCH | `…-client-contract` | `/fsm/api/v3/modules/clientContract[/…]` (camelCase) |
| GET/POST/PATCH | `…-site` | `/fsm/api/v3/modules/site[/…]` |
| GET/POST/PATCH | `…-service` | `/fsm/api/v3/modules/service[/…]` |
| GET | `get-module-meta` / `list-module-fields` | `/fsm/api/module/meta`, `/fsm/api/v2/modules/fields/fields` (any `moduleName`) |
| POST | `create-scope-of-work-service` **(added by us, DRAFT)** | `/fsm/api/v3/modules/scopeOfWorkServices` |

**Why v3 works here when our own bridge failed:** the extra request headers. This connection sends
**`x-org-id: 2944`** and **`x-device-type: Web`** (plus `x-current-site: -1`, `x-version: revive`,
`x-org-group: v2`). With those, the managed service token is accepted by the FSM v3 API. Without
them (the `frontline-fsm-bridge` attempts) v3 answers "you do not have access to this application".
That header set is the whole trick — carry it on any new FSM action.

List reads take a **view name**: `/fsm/api/v3/modules/<module>/view/{{viewName}}` (e.g. `all`).

### Proven live: the sample contract flow

Contract **9778** — "G1-PROBE Client Contract (delete me)" — created entirely through connections
and verified by read-back:

- linked to **client 30252** (Al Manzil Restaurant 537080, created earlier by our own `create-client`),
- covering **site 2320877** (the G1 probe site),
- carrying **service line 22755** → G1-PROBE Service (230132) @ 100, SINGLE schedule,
  FLAT_RATE_PER_BILLING_CYCLE.

Create/write rules learned the hard way:

- Request body is `{"data": {…record…}, "moduleName": "<module>"}`; the action wraps it, so callers
  pass just `data`.
- **`sites` is mandatory** — a create without it fails "Contractual sites cannot be empty".
- **`services` cannot be set inline on the contract.** It is a MULTI-LOOKUP (displayType 13) to
  module **`scopeOfWorkServices`**; passing `{"service": {...}}` objects fails with "Invalid ID in
  lookup object for multi lookup insert/update", on both create and PATCH. **Correct order:
  create the contract first, then create each `scopeOfWorkServices` record with
  `clientContract: {"id": <contractId>}`.** That is why `create-scope-of-work-service` exists.
- The line's `code` is **server-generated** (`CC-SOW1`); a supplied code is ignored.
- Dates are **epoch milliseconds**.
- Actions added via `add-new-action-to-connection` are **DRAFT** — invisible to
  `facilio connections execute`, which 404s with "Unknown action_slug". Run them through
  `connection-studio.execute-a-connection-action` until someone publishes the connection from the
  platform UI. **`create-scope-of-work-service` needs publishing before app code can call it.**

## Client contract — it lives in the FSM app (updated 2026-08-14, evening probe)

The first probe's conclusion "contract cannot be written" was half-right. Corrections after the
screenshot showed Client Contract live in the org UI:

- **Facilio's quote module is irrelevant to us** — Frontline's proposal IS the quote layer. The
  promotion's Facilio writes are: client, client contact, portfolio, **client contract**, work orders.
- **Client Contract lives in the FSM app** (linkName `fsm`, "Field Service Management" in
  `facilio-platform.list-applications`), module API name **`clientContract` — camelCase**. The
  earlier all-lowercase probes were testing the wrong casing AND the wrong app.
- **The published `facilio-cmms` connection is maintenance-app-scoped** (every path starts
  `/maintenance/api/v5/...`), and no `facilio-fsm` connection exists in the catalog. That is the
  whole reason "not accessible in this app".

### The bridge that now exists: `frontline-fsm-bridge`

A CUSTOM connection we own (created via `connection-studio.create-a-new-http-connection`):

- base_url **`https://us.facilioapis.com`** — the org's DEVELOPER app-domain. The V5 API refuses
  `app.facilio.com` with "V5 API cannot be accessed from this domain".
- auth **`{"mode":"service_token","authConfig":{"resource":"facilio","header":"X-Service-Token"}}`**
  — custom connections CAN borrow the managed Facilio service token (verified: the bridge lists
  real clients through `/maintenance/api/v5/client`). Only resource `facilio` exists; `fsm` and
  `facilio-fsm` return UNAUTHORIZED.
- headers per action: `Accept: application/json`, `X-Version: revive`, `X-Org-Group: v2`,
  `X-Device-Type: connections`.
- ⚠ **Editing `auth_methods` invalidates the linked account** (everything turns UNAUTHORIZED);
  revert to the single service_token method or re-link to recover.
- ⚠ The v2 API (`/…/api/v2/…`) rejects the service token entirely — v5 only.

### The one remaining blocker — mapped precisely (late-evening probes, with Yameen's devtools URLs)

The FSM UI reads client contracts via **v3**: `GET /fsm/api/v3/modules/clientContract/{id}`
(a sample record, id 9777, exists — created by hand in the UI). Probing every layer through the
bridge gave a complete map:

| API | Auth verdict | clientContract verdict |
| --- | --- | --- |
| v2 (`/fsm/api/v2/…`) | rejects service token: "no access to this application" | unreachable |
| v3 (`/fsm/api/v3/modules/…`) | rejects service token the same way | unreachable |
| v5 (`/fsm/api/v5/…`) | token works (`/fsm/api/v5/client` returns rows) | **module not registered** — both `clientContract` and `clientcontract` → MODULE_NOT_FOUND |

Crucial nuance: the service token **acts as the TB super-user** (`sysCreatedBy:
vibeathon-2026+tbc@facilio.com` on every probe record) and that user opens Client Contract fine in
the browser — yet v2/v3 still refuse. So **the app claim is baked into the token, not the user**;
adding users to the FSM app will not help. The fixes are credential- or platform-side:

1. **An FSM-scoped API key** (Facilio developer space / API-key settings, created for the FSM app)
   → the bridge already carries an `X-API-Key` auth slot; v3 then gives full CRUD exactly as the UI.
2. **Facilio platform team registers `clientContract` into the v5 connections surface** — the
   official fix; worth raising during the vibeathon (Demo Day Aug 18).

Once either lands: verify `GET /fsm/api/v3/modules/clientContract/9777` (or v5 list), add
`create-client-contract` (v3 create mirrors the UI: `POST /fsm/api/v3/modules/clientContract`),
and capture the contract enums into enums.md. Demo fallback if neither lands: pre-create the
contract in the UI (like 9777) and deep-link it from the promotion panel —
`https://app.facilio.com/fsm/client/client-contract-/all/{id}/overview?tabName=clientcontractsummary`.

## What does NOT exist — the contract gap

- **There is no contract action on `facilio-cmms`.** Four search angles (create contract / client
  contract / agreements / contract line items) return nothing contract-shaped.
- **`quote` and `invoice` modules are DISABLED on org #2944** — `get-quote-metadata` and
  `get-invoice-metadata` both return `MODULE_NOT_ENABLED` ("contact your administrator").
  `create-quote` / `create-invoice` exist as actions but will fail until an admin enables the modules.
- **`clientcontract` / `servicecontract` are real module names but gated** (probed 2026-08-14 via
  `get-custom-module-metadata`): fabricated names return plain "does not exist", while
  `clientcontract`, `servicecontract` and `contracts` return "does not exist **or is not accessible
  in this app**" — the module exists in Facilio's registry but is not enabled/accessible through
  this connection's app scope on org #2944.
- **The system connection cannot be extended by us**: `connection-studio.add-new-action-to-connection`
  on `facilio-cmms` returns 403 ("Only ADMIN or PUBLISHER in the publishing org may edit it").
  The existing actions map to `POST /maintenance/api/v5/<module>` with body `{"data": {{payload}}}`,
  so once the module is enabled an official action is a one-liner for whoever owns the connection.
- Consequence for the promotion: **"client contract" cannot be written from Frontline today.**
  Options, in order of preference:
  1. Ask the org admin to enable the quote (and if it exists, contract) module, then re-probe.
  2. Register a custom action via `connection-studio.add-new-action-to-connection` (verified
     available and connected) mapping to the contract REST endpoint — only once the module is
     confirmed enabled, otherwise the upstream call 4xxes the same way.
  3. Demo cut: promote client + portfolio + work orders + job plan (PPM), and narrate the contract
     as the enablement step. Work orders + job plans ARE creatable now, so the hero moment survives.

## Payload shapes — the traps we hit

- **The wrapper key is the module name, lowercased and unpunctuated**, and it is NOT consistent in
  spelling with the action slug: `create-work-order` wants `{"workorder": {…}}` — `workOrder` fails
  with `Following fields are missing: {'workorder'}`. Others: `{"site": …}`, `{"building": …}`,
  `{"floor": …}`, `{"space": …}`, `{"client": …}`, `{"service": …}`.
- **Lookup fields are inconsistent across modules.** `create-building`/`create-space` accept a bare
  number (`"site": 2320877`), but `create-work-order` requires an object: `"siteId": {"id": 2320877}`
  (a bare integer fails JSON-schema validation with "integer found, object expected"). Check the
  action's schema, don't generalize.
- Create responses return the record under `data` with a numeric `id`, plus `success` and `message`;
  lookups come back expanded (the building response embeds the whole site). `extractRecordId` in
  `src/shared/facilio.ts` already handles this shape.
- `location`/`address` take a structured object (street/city/state/zip/country/lat/lng…), all
  sub-fields optional.
- Errors are structured: module gated → `MODULE_NOT_ENABLED`; bad payload → `facilio_api_error`
  with `status_code` 400 and the schema complaint in `detail`. Both are non-retryable — do not
  outbox-retry a 400.

## Hierarchy + roll-ups

- The full chain **site → building → floor → space** was created via connections in order, each
  child passing its parent ids. This is the promotion's write order; it must stay ancestry-first.
- **Roll-up counters are NOT exposed**: `get-site` after creating a building and a space under it
  returned no `noOf*`/count fields at all. Do not build UI that expects Facilio to report child
  counts; count in Frontline if needed.
- `qrVal` comes back as `facilio_<id>` on portfolio records.

## Deletes / cleanup

- **There are no delete actions for site/building/floor/space/client/service** — only
  `delete-work-order-task`, `delete-work-order-attachment`, `delete-work-order-actual` exist.
  Probe records are permanent; they are all named `G1-PROBE … (delete me)` and must be removed
  from the platform UI by an admin. Corollary: **the promotion must be idempotent before it runs**,
  because a wrong write cannot be programmatically undone. Keep the pre-flight screen (C26) and
  the `fl_promotion_log` dedup as hard requirements.

## Client status (C28)

- Client `moduleState` is a LOOKUP to `ticketstatus`, and **no client states are configured on this
  org** — every existing client has `moduleState: null`, and `get-client-metadata` inlines no values.
  (Site/building/space DO default to Active/In Active.)
- So "customer-tagged status" is not something Facilio provides out of the box here. Frontline must
  carry the prospect/customer distinction itself (the account record + dedup path), and only ever
  create the Facilio client at Won — which also resolves §4.2: move the `create_client` outbox
  enqueue from `lead.convert` to the Won transition.

## Promotion tail — BUILT AND VERIFIED END TO END (2026-08-15, evening)

The full chain now runs in code, live-verified on deal `92718ec6…`: Won → `queueClientSync` +
`queueContractSync` (deal.ts) → `prospect.convert-to-facilio` (portfolio, batched, parent-first,
logged in fl_prospect_convert_log) → `lead.sync-drain` → **contract 9781** linked to client 30289,
site 2321886 (+ spaces Lobby 2321943 / Kitchen 2321944), with service lines 22757/22758 at
2,375 + 4,500 monthly. Facilio services are resolved find-or-create with the id cached in
`fl_service_line.data_json.facilio_service_id`.

Hard-won API facts (all now encoded in src/shared/facilio.ts + src/modules/sync.ts/prospect.ts):

- **Two failure dialects, both HTTP 200.** CMMS v5: `{success: false, error: {message}}`.
  FSM v3: `{code: <nonzero>, message}` with NO success field. `executeAction` rejects both;
  before that, "Space Category is mandatory" and "Contract start date cannot be empty" sailed
  through as successes with no record id — one of them marked a contract task done with a null
  stamp and stranded every service line behind it.
- **Mandatory fields discovered live:** `create-space` needs `spaceCategory` (picklist in
  enums.md; we default unknown/missing to "Room"); `create-client-contract` needs `startDate`;
  `create-scope-of-work-service` needs `estimatedDuration` (seconds; we default 3600).
- **Money: fl_proposal_line's DB columns are MAJOR units** (applied_price 2.5, line_total 2375
  raw). The minor-unit integers seen at the proposal API edge are its wire format only. No
  conversion when reading raw SQL — a /100 once shipped 23.75 for a 2,375.00 rate.
- **`data_json` reads in raw SQL must alias `::text as data_raw`** — the row-mapper otherwise
  parses the bag into `data` and a read through `dataJson` silently sees `{}`; a read-modify-write
  built on that CLOBBERS the whole bag (it cost the E2E deal its won capture before the fix).
- `update-scope-of-work-service` (PATCH `/fsm/api/v3/modules/scopeOfWorkServices/{id}`) was added
  to the connection for repairs — DRAFT until the next publish; app code does not depend on it.
