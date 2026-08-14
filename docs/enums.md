# Facilio enum + picklist values — G1 probe findings

Captured live from `get-<module>-metadata` / `get-job-plan-task-metadata` on org **The Builder's
Club (#2944)**, 2026-08-14. Enums are org-configurable — re-pull before shipping against a
different org. A value not in these lists **fails silently downstream** (the PPM warning in the
chat doc), so map through this file, never free-type.

## Site (`create-site`, wrapper `{"site": …}`)

- Required: `name`.
- `siteType` (ENUM): `Common` · `Hospital` · `Residential` · `Office` · `Commercial` · `Compound` ·
  `University` · `Retail` · `Residential & Commercial` · `Municipality` · `Mall` · `Accommodation` · `Land`
- `moduleState` (LOOKUP → ticketstatus): `active` / `inactive` (labels "Active" / "In Active").
  Defaults to `active` on create.

## Building (`create-building`, wrapper `{"building": …}`)

- Required: `name`, `site` (bare numeric id accepted).
- `moduleState`: lookup present, no values inlined in metadata — created records default active.

## Space (`create-space`, wrapper `{"space": …}`)

- Required: `name`, `site`. Optional parents: `building`, `floor`, `parentSpace`.
- `spaceCategory` (LOOKUP → spacecategory): `Common Area` · `Utility` · `Office` · `Hallway` ·
  `Elevator` · `Tenant Unit` · `Desk` · `Lockers` · `Parking Stall` · `Room`
- `moduleState`: `active` / `inactive`.
- There is no `spaceType`/`resourceType` discriminator field on this org — the module itself
  (site vs building vs floor vs space) IS the discriminator. Map `fl_prospect_node.node_type`
  to the target action, not to a field value.

## Client (`create-client`, wrapper `{"client": …}`)

- Required: `name`, `primaryContactEmail`.
- `moduleState` (LOOKUP → ticketstatus): **no states configured on this org; existing clients carry
  `moduleState: null`.** There is no client-status vocabulary to map to (C28) — see connections.md.

## Work order (`create-work-order`, wrapper `{"workorder": …}`)

- Required: `subject`, `siteId` — and `siteId` must be an object: `{"id": <n>}`.
- `moduleState` values (the state flow): `Submitted` · `Assigned` · `Work in Progress` ·
  `Incomplete` · `preopen` · `Requested` · `Rejected` · `Processing` · `Scheduled` · `Yet to Start` ·
  `In Progress` · `On Hold` · `Resolved` · `Closed` · `Cancelled` · `Skipped` · `Re-Opened`
- New records land in `Submitted`; `sourceType` comes back `Web Work Order`; `scheduledStart`
  defaults to now.

## Service (`create-service`, wrapper `{"service": …}`) — the C23 catalog

- Required: `name`.
- `paymentType` (SYSTEM_ENUM): `Fixed` · `Duration Based`
- `status` (ENUM): `Active` · `Inactive`
- Money: `buyingPrice` / `sellingPrice` are MULTI_CURRENCY_FIELD — a bare number is accepted on
  create. Other fields: `description`, `duration` (NUMBER).
- Ids are plain numbers (probe created id 230132) — `fl_*` service-reference columns can stay
  numeric-as-text (L10 answered).
- The catalog on #2944 was EMPTY before the probe: seeding it is part of demo prep, not runtime.

## Job plan tasks (`get-job-plan-task-metadata`) — the PPM side

- `inputType`: `NONE` · `READING` · `TEXT` · `NUMBER` · `RADIO` · `BOOLEAN`
- `taskCriticality`: `STATUTORY` · `MANDATORY` · `OPTIMAL` · `DISCRETIONARY`
- `taskFrequency`: `DO_NOT_REPEAT` · `DAILY` · `WEEKLY` · `MONTHLY` · `QUARTERLY` · `HALF_YEARLY` ·
  `ANNUALLY` · `CUSTOM` · `HOURLY`
- `skillSet` — **the trade/skill master exists (L13), 45 entries**: Not-specified · Appointed Person ·
  Authorising Engineer · Authorising Engineer (Fire) · Authorising Engineer (Lifts) ·
  Authorised Person (HV) · Authorised Person (LV) · Authorised Person (Lifts) · Authorised Person ·
  Building Trade · Controls Engineer · Competent Person (Fire) · Competent Person (HV) ·
  Competent Person (LV) · Competent Person (Lifts) · Contractor · Competent Person · Duty Holder ·
  Designated Person · Designated Persons (Lifts) · Electrical · Facilities Coordinator ·
  Facilities Manager · Facilities Operative · Fire Officer · Fire Safety Manager · Gas Safe ·
  Infection Control Officer · Locksmith · Lift Steward · Mechanical · M&E · Management · Manager ·
  Multi-skilled · Operator · Plant Attendant · Painter · Prison Officer · Plumber · Pool Attendant ·
  Refrigeration Engineer · Specialist · Technician · User

## Client contract (`clientContract`, FSM v3) — captured 2026-08-15

Via `facilio-fsm-client-contracts.list-module-fields {"moduleName": "clientContract"}`. **These are
integer codes, not strings** — send the number, read the `…Enum` string back.

- `type` (the contract's own type): **1=Planned · 2=One Time · 3=On-Demand**
- `status`: **1=Unpublished · 2=Published · 3=Pending Revision · 4=Revised · 5=Cancelled · 6=Expired**
  — a created contract lands in `1` (UNPUBLISHED); publishing is a separate step.
- `source`: **1=FSM · 2=Maintenance**
- `publishMode`: **1=Adhoc · 2=Schedule for Later · 3=Immediate**
- `invoicingMode`: **1=Contract Level · 2=Service Level**
- `clientContractType`: **1=Comprehensive · 2=Non-Comprehensive · 3=Threshold**
- `thresholdType`: **1=Instance · 2=Itemized**
- `remarksEnum`: 1=Others · 2=Expired Lease · 3=Out of Business · 4=Duplicate Contract · 5=Suspended Services
- Required on create: `name`, `client: {id}`, **`sites: [{id}]`** (empty → "Contractual sites cannot
  be empty"), `startDate`/`endDate` as epoch ms. `generatePPM` is a boolean.
- Lookups: `client`→client, `sites`→site (multi), `services`→**scopeOfWorkServices** (multi),
  `group`→serviceContract, `clientBillingCycle`→serviceContractClientBillingCycle,
  `clientCreditNoteRule`→serviceContractClientCreditNote.

## Contract service line (`scopeOfWorkServices`) — the PPM-critical enums

This is the module the chat doc warned about: **a wrong value here fails silently and PPM never
generates.** Captured 2026-08-15; contract 9778's line 22755 uses the ✅-marked values.

- `type`: **1=Vendor Contract · 2=Client Contract** ✅ use `2`
- `assignmentType`: **1=Vendor · 2=Internal**
- `scheduleType`: **1=Single · 2=Multiple**
- `scope`: **1=All Sites · 2=Selected Sites**
- `servicingEntity`: **1=basespace · 2=asset**
- `durationType`: **1=Estimated Man Hours Per Appointment · 2=Estimated Service Duration**
- `invoiceBasedOn`: **1=Flat Rate Per Billing Cycle · 2=Flat Rate Per Service · 3=Rate Per Hour · 4=Rate Per Unit**
- `creditNoteBasedOn`: **1=Rate Per Billing Cycle · 2=Rate Per Service · 3=Rate Per Hour · 4=Rate Per Unit**
- `unitType`: 1=Each · 2=Kg · 3=Hour · 4=Litres · 5=Lumpsum · 6=Number · 7=Drum · 8=Packet · 9=Roll ·
  10=Box · 11=Metre · 12=Set · 13=US Gallon · 14=Imperial Gallon · 15=Square Metre · 16=Square Feet
  (`-1` when not unit-based)
- Set `clientContract: {"id": <contractId>}` and `service: {"id": <serviceId>}`; `code` is
  server-generated (`CC-SOW1`) — do not bother sending one.

## Not capturable yet

- **Quote / invoice line-item enums** — both modules return `MODULE_NOT_ENABLED` on #2944; re-run
  `get-quote-metadata` / `get-invoice-metadata` after an admin enables them.
- **Contract service-line enums** — no contract action exists at all (see connections.md); this is
  the enum the chat doc warned "fails silently and PPM never generates", and it remains unverified
  because the surface to probe is missing.
