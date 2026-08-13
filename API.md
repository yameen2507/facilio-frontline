# Frontline — Lead module API

App `frontline` · function `lead` · 16 handlers. Every handler takes `payload` (a JSON **string**) and returns `{ ok, data? , error? }`.

---

## Can I test this in Postman locally?

**Postman: yes. Localhost: no.**

There is no local runtime. Functions are compiled to WASM and executed on the platform — nothing runs on your machine, so there is no `localhost:3000` to point Postman at. What Postman *can* do is hit the deployed app's HTTP endpoint.

### The HTTP contract

```http
POST https://frontline.vibe.facilio.com/api/runtime/functions/lead/handlers/{handler}/run
Content-Type: application/json
Accept: application/json
Cookie: <your browser session cookie>

{ "payload": "{\"leadId\":\"...\"}" }
```

The body **is** the `args` object — so `payload` sits at the top level, and its value is a JSON string (the platform only allows `string` and `number` handler parameters).

**Auth is browser-cookie based.** The SDK sends `credentials: "include"`; there is no API key or bearer token for this endpoint. To use Postman you must:

1. Open `https://frontline.vibe.facilio.com` in a browser and sign in through `id.facilio.com`
2. Copy the session cookie from devtools
3. Send it as a `Cookie` header in Postman

Caveats worth knowing before you invest time in this: the app is currently **auth-gated** (an unauthenticated request 302-redirects to the identity service), nothing has been deployed to the app yet, and **I have not verified this path** — it is read from the SDK source, not tested. The cookie will also expire.

### What is proven and needs no cookie

```bash
facilio vibe function run lead <handler> --args '{"payload":"{...}"}'
```

That is the supported backend path and every example below has been run through it. Plus:

```bash
node scripts/walk.mjs      # 41 checks, the whole flow end to end
npm test                   # 51 unit tests, pure logic, no platform at all
```

### Other runtime endpoints (same host, same cookie)

| Purpose | Endpoint |
|---|---|
| Current user | `GET /api/runtime/getCurrentUser` |
| Run a function handler | `POST /api/runtime/functions/{name}/handlers/{handler}/run` |
| Same, async | `POST /api/runtime/functions/{name}/handlers/{handler}/runAsync` |
| Run an agent | `POST /api/runtime/agents/{name}/run` |
| Run a connection action | `POST /api/runtime/connections/{connectionSlug}/actions/{actionSlug}/execute` |
| Files | `/api/runtime/files` |

---

## Flat fields — no envelope needed

Every handler now accepts **either** shape. Flat fields win over the same key inside `payload`:

```bash
# flat — recommended, no escaping
facilio vibe function run lead create --args '{"source":"widget","companyName":"Al Manzil","estimatedValue":12000}'

# envelope — still supported
facilio vibe function run lead create --args '{"payload":"{\"source\":\"widget\",\"companyName\":\"Al Manzil\"}"}'
```

Same for HTTP:

```http
POST /api/runtime/functions/lead/handlers/create/run
{ "source": "widget", "companyName": "Al Manzil", "estimatedValue": 12000 }
```

**A field only arrives if the handler declares it.** The platform filters `args` down to the declared `parameters` and silently drops anything else, which is why every scalar is declared in `src/functions/lead/index.ts`. Parameter types may only be `string` or `number`, so booleans travel as `"true"` / `"false"` and genuinely nested input (service areas, coverage lists) still needs the envelope.

---

## The connection API (registered, awaiting publish)

The app is also a Facilio **connection** — slug `frontline`, id 876, base URL `https://frontline.vibe.facilio.com/api/runtime/functions`. All 16 handlers are registered as typed actions:

| Action | Handler | Type |
|---|---|---|
| `frontline.create-lead` | create | WRITE |
| `frontline.list-leads` | list | READ |
| `frontline.get-lead` | get | READ |
| `frontline.update-lead` | update | WRITE |
| `frontline.transition-lead` | transition | WRITE |
| `frontline.claim-lead` | claim | WRITE |
| `frontline.assign-lead` | assign | WRITE |
| `frontline.log-lead-activity` | log-activity | WRITE |
| `frontline.analyse-lead` | analyse | WRITE |
| `frontline.convert-lead` | convert | WRITE |
| `frontline.drain-lead-sync` | sync-drain | WRITE |
| `frontline.lead-sync-status` | sync-status | READ |
| `frontline.retry-lead-sync` | sync-retry | WRITE |
| `frontline.get-lead-settings` | settings-get | READ |
| `frontline.set-lead-sla` | settings-put | WRITE |
| `frontline.lead-reference` | reference | READ |

Once live they are callable like any other Facilio action, with real schemas and no envelope:

```bash
facilio connections execute frontline.create-lead \
  --params '{"source":"widget","companyName":"Al Manzil","contactEmail":"ahmed@almanzil.ae"}'
```

Regenerate or amend them with `node scripts/gen-connection-actions.mjs`.

### Status: NOT yet executable

Calling one returns `ok` with `{"value": null}` and **never reaches the handler** — no lead is created. The request templates are correct (`method: POST`, right path, all fields mapped) and the connection account is ACTIVE, but every action still shows `ACTIVE —`.

**The remaining step is manual: publish the connection from the Facilio platform UI.** `llm.md` §11b says actions are written as draft and go live on publish; this is what unpublished looks like. It cannot be done from the CLI.

Until then, use the function endpoint or the CLI — both already accept the same flat shape, so nothing about the call shape changes after publishing.

### Gotcha worth knowing

**`actions update` without `--function` and `--handler` corrupts the request template.** Updating just `--active true` dropped `method: "POST"`, leaving an action that silently does nothing. Those two flags are what rebuild the template, so always pass them together on an update — `scripts/gen-connection-actions.mjs` does.

---

## Enum values

Fetch them at runtime with `reference` rather than hardcoding.

| | Values |
|---|---|
| `source` | `widget` · `tender` · `inapp` |
| `status` | `new` · `in_review` · `contacted` · `qualified` · `nurture` · `converted` · `closed` |
| `dispositionReason` | `spam` · `duplicate` · `outside_region` · `wrong_service` · `not_interested` · `no_budget` · `no_response` · `lost_to_competitor` · `test` |
| activity `kind` | `call` · `email` · `note` · `attachment` · `meeting` |
| assignment `role` | `actioner` · `sales` |
| `verdict` | `relevant` · `not_relevant` · `outside_region` |
| score `band` | `hot` ≥75 · `warm` ≥50 · `cool` ≥25 · `cold` <25 |

---

## Settings

### `settings-get`
No payload. Returns areas, service lines, coverage and SLA targets.

### `settings-put`
Upserts by natural key (area `name`, service line `code`), so it is safe to re-run.

```json
{
  "analystAgent": "lead-analyst_df9b21f7a4a14901b15edabb254ca5a8",
  "areas": [
    { "name": "Dubai", "region": "Dubai", "country": "AE" },
    { "name": "Abu Dhabi", "region": "Abu Dhabi", "country": "AE" }
  ],
  "serviceLines": [
    { "code": "KEC", "name": "Kitchen extract cleaning (TR19 grease)" },
    { "code": "HVAC", "name": "HVAC maintenance" }
  ],
  "coverage": [
    { "area": "Dubai", "serviceLine": "KEC" },
    { "area": "Abu Dhabi", "serviceLine": "KEC" }
  ],
  "sla": { "firstResponseMins": 60, "qualificationMins": 1440, "assignmentMins": 2880 }
}
```

Coverage references areas and service lines by human name/code — callers never handle ids. **Set these before using `analyse`**: the analyst judges relevance against this data, not against its prompt.

---

## Capture

### `create`
The **only** writer of `fl_lead`. Normalises dedup keys, detects duplicates, stamps SLA due dates, allocates the ref number.

```json
{
  "source": "widget",
  "sourceDetail": "website chat",
  "companyName": "Al Manzil Restaurant",
  "contactName": "Ahmed Khalil",
  "contactEmail": "ahmed@almanzil.ae",
  "contactPhone": "+971 50 123 4567",
  "websiteDomain": "https://www.almanzil.ae",
  "serviceType": "Kitchen hood cleaning",
  "description": "Four extraction hoods, 14 months uncleaned. Insurance wants TR19 before month end.",
  "siteAddress": "Al Rigga Road, Deira",
  "siteCity": "Dubai",
  "siteRegion": "Dubai",
  "estimatedValue": 12000,
  "currency": "AED",
  "actorEmail": "ops@frontline.ae"
}
```

Only `source` and `companyName` are required.

```json
{ "ok": true,
  "data": { "leadId": "19d99d0d-…", "refNo": "LEAD-0001", "status": "new", "duplicateOf": null } }
```

**A duplicate still gets a row** — it comes back `status: "closed"` with `duplicateOf` populated, linked to the original and never entering the queue. Matching is on normalised email, phone (last 9 digits, so `0501234567` == `+971 50 123 4567`) and company domain (free email hosts excluded).

---

## Read

### `list`
The queue. **Overdue is computed at read time**, not stored.

```json
{ "status": "new", "ownerEmail": null, "source": "widget", "verdict": "relevant",
  "scoreMin": 50, "overdueOnly": false, "unclaimedOnly": true,
  "search": "manzil", "limit": 50, "offset": 0 }
```

All filters optional. `limit` defaults to 50, caps at 200. `unclaimedOnly` excludes terminal leads — a queue only holds actionable work.

Each row carries the lead plus `band`, `priority` (overdue outranks score) and:

```json
{ "sla": { "isOverdue": false, "breached": [],
           "nextDue": { "stage": "first_response", "dueAt": "…", "minutesRemaining": 42 } } }
```

Returns `{ leads, total, truncated }`. **Check `truncated`** — the platform caps result sets.

### `get`
`{ "leadId": "…" }` → `{ lead, sla, band, analysis, timeline, assignments, duplicates }`.

### `update`
Descriptive fields only. **Status is rejected here** — it goes through `transition`.

```json
{ "leadId": "…", "actorEmail": "…",
  "fields": { "estimatedValue": 15000, "siteCity": "Dubai", "description": "…" } }
```

Editable: `companyName`, `contactName`, `serviceType`, `description`, `siteAddress`, `siteCity`, `siteRegion`, `estimatedValue`, `currency`, `nurtureUntil`.

---

## Workflow

### `transition`
The **only** path that changes status.

```json
{ "leadId": "…", "toStatus": "qualified", "note": "Four hoods, Deira.", "actorEmail": "…" }
```

Closing requires a reason:

```json
{ "leadId": "…", "toStatus": "closed", "dispositionReason": "outside_region", "actorEmail": "…" }
```

Legal moves:

```
new       → in_review | closed
in_review → contacted | qualified | nurture | closed
contacted → qualified | nurture | closed
qualified → converted | closed
nurture   → in_review | contacted | closed
converted, closed → terminal
```

Anything else returns `ok:false` with the allowed set, e.g. `cannot go from new to converted (allowed: in_review, closed)`.

### `claim`
`{ "leadId": "…", "actorEmail": "sudharsan@frontline.ae" }` — takes an unclaimed lead, sets the owner, and moves `new → in_review`. Errors if someone else already owns it.

### `assign`
```json
{ "leadId": "…", "toUser": "mithun@frontline.ae", "role": "sales",
  "reason": "qualified, handing to sales", "actorEmail": "…" }
```
Writes a row to `fl_lead_assignment` every time, so ownership has history.

### `log-activity`
```json
{ "leadId": "…", "kind": "call", "body": "Called Ahmed. Confirmed four hoods.",
  "actorEmail": "…", "fileId": 4821 }
```
A `call`, `email` or `meeting` satisfies the first-response SLA and **auto-advances `in_review` → `contacted`**. Returns `{ lead, contacted }`.

---

## AI

### `analyse`

**The model call cannot happen inside the function** — it aborts at ~13s against the sandbox's ~10s fetch timeout. So the caller makes the agent call and posts the reply in:

```js
// browser
const res = await vibe.executeAgent('lead-analyst', input);
await vibe.executeFunction('lead', 'analyse',
  { payload: JSON.stringify({ leadId, replyJson: res.response.content }) });
```

```bash
# CLI
facilio vibe agent run lead-analyst --input "$(cat input.txt)"
# then pass response.content as replyJson
```

```json
{ "leadId": "…", "replyJson": "{\"relevance\":{\"verdict\":\"relevant\"},\"score\":{\"value\":88}}" }
```

`replyJson` accepts a JSON string or an object, and tolerates code fences or surrounding prose. Returns:

```json
{ "ok": true,
  "data": { "leadId": "…", "version": 1, "verdict": "relevant", "score": 88,
            "band": "hot", "reasons": ["…"], "source": "supplied" } }
```

Stored as a new version each run, and snapshotted onto the lead as `score`/`verdict` so the queue can sort without a join. **It never writes `status`** — a human decides, which is what keeps the override rate measurable.

Omitting `replyJson` attempts the server-side call and will almost certainly time out.

---

## Conversion

### `convert`
```json
{ "leadId": "…", "actorEmail": "…", "salesOwnerEmail": "mithun@frontline.ae",
  "dealTitle": "Al Manzil — kitchen extract", "estimatedValue": 12000 }
```

Requires status `qualified`. Creates `fl_account` + `fl_account_contact` + `fl_deal`, links them onto the lead, moves it to `converted`, and **queues** the Facilio writes.

```json
{ "ok": true,
  "data": { "leadId": "…", "accountId": "…", "contactId": "…",
            "dealId": "…", "dealRefNo": "DEAL-0001",
            "queued": ["account:…:create_client", "contact:…:create_client_contact"] } }
```

**Idempotent** — re-running reuses the existing ids and queues nothing new.

---

## Outbox

### `sync-drain`
`{ "batchSize": 5 }` (1–25) — claims a batch with `FOR UPDATE SKIP LOCKED` and calls Facilio.

```json
{ "ok": true,
  "data": { "claimed": 2, "succeeded": 1, "deferred": 1, "failed": 0,
            "results": [{ "action": "create_client", "outcome": "done", "detail": "30248" }] } }
```

Outcomes: `done` · `retry` (queued again with backoff) · `deferred` (waiting on a dependency, no attempt consumed) · `failed` (5 attempts exhausted).

**`retry` is normal, not an error.** Facilio CMMS calls intermittently exceed the ~10s fetch timeout — `create-client` has both succeeded in ~1s and aborted at ~10s with the same payload. Retry delivers; call the drain again. There is no scheduled drain until the app is promoted to production.

### `sync-status`
No payload. `{ counts: { pending, in_progress, done, failed }, failures: [...] }`.

### `sync-retry`
`{ "taskId": "…" }` — requeues a `failed` task. Errors if the task is not failed.

---

## `reference`

No payload. Returns every enum above, so UI code never hardcodes them.

---

## Errors

Always `{ "ok": false, "error": "<message>" }` with a message meant for a human:

| Message | Cause |
|---|---|
| `companyName is required` | Missing required field |
| `source must be one of: widget, tender, inapp` | Bad enum |
| `cannot go from new to converted (allowed: in_review, closed)` | Illegal transition |
| `closing a lead requires a disposition reason (one of: …)` | Close without a reason |
| `only a qualified lead can be converted (this one is contacted)` | Convert too early |
| `already claimed by someone@example.com` | Claim contention |
| `status is not editable (status changes go through transition)` | `update` tried to set status |
| `payload is not valid JSON: …` | Malformed `payload` string |
