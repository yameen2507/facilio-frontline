# E2E test — Lead → Deal → Survey → Proposal → Won → FSM (2026-08-15)

Full pipeline driven live against org #2944 by `facilio vibe function run` calls, ending in real
Facilio FSM records. Test entities: **LEAD-0028** (E2E Gulf Coast Hospitality) → deal
`92718ec6…` → **SUR-0021** → **PRP-0009** → Won → **FSM client 30289** + primary contact.

## What works, verified step by step

1. **Lead** — create → claim → log-activity (call advances to `contacted`) → transition
   `qualified`. SLA/dedup stamped on create.
2. **Convert** — account + contact + deal in one idempotent call, and `queued: []` proves F-08:
   no Facilio write fires at convert any more.
3. **Survey** — create with a NEW site by name (C32) → assign (multi-row) → set-lead (fires
   T3 `scheduled → assigned`) → walk capture of two rooms with answers (T4 advanced visit and
   survey to `in_progress`; `room_sqft` answers carried `estimation_key`) → visit done → submit
   (T5 guard correctly blocked submit while the visit was open) → **frozen revision with a real
   handoff payload** (checksum, trigger `submit`). The captured rooms became prospect portfolio
   nodes under the site — convert-preflight sees the full tree in correct parent-first order.
4. **Proposal** — create from the frozen revision (rate card auto-resolved, currency stamped) →
   line-generate joined `room_sqft` to the rate card: **2 priced lines** (Lobby 1800 × 250,
   Kitchen 950 × 250, monthly = 687,500 minor total). When the key had no card row, both values
   surfaced in `unpriced` rather than being dropped — honest. → submit-for-approval
   (auto-approved, no rule matched) → send → respond `accepted`.
5. **Won** — transition with capture (finalValue 687,500 = the proposal total, contract start,
   signed note) → `queueClientSync` enqueued client + contact → drain → **FSM client 30289**.
6. **Field fidelity in FSM — perfect for what is wired.** Client: name, primaryContactName/
   Email/Phone, address street/city/state all exactly as entered on the lead. Contact
   11038324967: name/email/phone correct, `isPrimaryContact: true`, linked to client 30289.

## Issues found

### 1 (critical, root-caused, fixed during the test): the fixes were never deployed
The platform's `deal` function predated the F-08 hook — winning the deal enqueued **nothing**,
with no error anywhere (the hook simply didn't exist in the deployed build). This is the known
trap: local `build/functions/*.js` says nothing about platform state. I bundled from current src
and pushed **all** functions (`deal`, `lead`, `survey`, `proposal`, `prospect`, `form`,
`migrate`, `access`), reopened the deal, re-won it — the queue populated and drained correctly.
Idempotency held: the repeat win minted no duplicate anything.

### 2 (critical gap): Won only promotes client + contact — the rest of the promotion is unwired
After a win, FSM holds the client and contact and **nothing else**:
- **Sites/portfolio**: `prospect.convert-to-facilio` (the RUN) is still not built — only the
  preflight exists. The E2E site + 2 rooms sit ready with `facilio_id: null`.
- **Client contract**: the outbox dispatch (`create_client_contract`,
  `create_contract_service_line`) is deployed and live in the `lead` bundle, but **no code
  enqueues those tasks**. The Won hook stops at `queueClientSync`.
- **Work orders**: no code path at all.
Ordering note: the contract task (by design) defers until a site is promoted, so the convert run
is the prerequisite for the whole tail: **convert run → contract → service lines**.

### 3 (data gap, blocks contract lines): no service-id path from proposal to contract (C23)
The generated proposal lines carry `serviceCode: null` (the rate card row was created without a
service code, which `card-row-save` allows for one-offs). The contract service-line task requires
`facilioServiceId`. Today there is **no data path** proposal line → Facilio Services id — rate
card rows need their `serviceCode` populated AND a mapping from the local service catalogue to
Facilio Services ids (the fl_service* → Facilio id link C23 always wanted).

### 4 (probably by design, worth confirming): the lead's site address never becomes a site
`siteAddress/City/Region` from the lead ride onto the account → client address in FSM (good),
but no prospect site is created from them; the site had to be named at survey creation (C32).
If sales expects the enquiry address to appear as a promotable site, this is a gap.

### 5 (minor)
- `survey get` projects `siteId`/`siteName` as null even when the survey has a site
  (`site-list` finds it fine) — a display seam for any UI reading the detail.
- Complex handler inputs (arrays/objects) are silently dropped unless passed via the `payload`
  JSON-string envelope — declared platform behaviour, but the assign call failing with
  "assignees[] needs at least one userEmail" after assignees WERE passed cost real time.
- `childCount: "0"` (string) leaks the numeric-string quirk through `survey site-list`.
- The deal transition response doesn't surface `queued`, so a caller can't tell the win queued
  the client sync (the event lands on the ACCOUNT timeline instead).
- line-generate warns the payload has no `condition_scale_direction` (D-e unsettled) — expected.

## Leftover test data
Frontline: LEAD-0028, account/contact/deal, SUR-0021 (+revision), PRP-0009 (+2 lines), rate card
row `room_sqft` on card `57456e29…`. Facilio: client 30289 + contact 11038324967 (E2E-labeled),
plus yesterday's G1-PROBE records. No delete APIs exist for the Facilio ones — admin UI cleanup.
