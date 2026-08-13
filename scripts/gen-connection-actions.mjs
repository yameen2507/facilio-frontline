/**
 * Registers every Lead handler as an action on the app's Facilio connection, so
 * the module has a proper typed API instead of a `payload`-string envelope.
 *
 * A connection action's request template is derived by mapping each input-schema
 * property straight into the request body at the top level, so the schemas here
 * must be FLAT — scalars only, no nested objects or arrays. That is also why
 * every handler declares its scalars explicitly (see src/functions/lead/index.ts);
 * the platform drops undeclared args.
 *
 * Actions are written as DRAFT. They go live when the connection is published
 * from the Facilio platform UI.
 *
 *   node scripts/gen-connection-actions.mjs [--dry-run] [slug ...]
 */

import { execFileSync } from "node:child_process";

const DRY = process.argv.includes("--dry-run");
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });

const obj = (properties, required) => ({
  type: "object",
  ...(required?.length ? { required } : {}),
  properties,
});

/** Every handler returns the same envelope. */
const out = (dataProps) =>
  obj({
    ok: { type: "boolean", description: "False when the call was rejected" },
    error: str("Human-readable reason when ok is false"),
    data: dataProps ? obj(dataProps) : { type: "object" },
  });

const LEAD_ID = str("Lead id (uuid)");
const ACCOUNT_ID = str("Account id (uuid)");
const ACTOR = str("Email of the user performing this action");

const ACCOUNT_SUMMARY = {
  id: str("Account id"),
  name: str("Company name"),
  email: str("Primary email"),
  phone: str("Primary phone"),
  websiteDomain: str("Company domain"),
  facilioClientId: str("Facilio client id once synced"),
  syncStatus: str("pending | synced"),
};

const LEAD_SUMMARY = {
  id: str("Lead id"),
  refNo: str("Reference number, e.g. LEAD-0001"),
  companyName: str("Company name"),
  status: str("new | in_review | contacted | qualified | nurture | converted | closed"),
  dispositionReason: str("Set only when closed"),
  ownerEmail: str("Actioner who owns it"),
  score: num("Latest AI score, 0-100"),
  verdict: str("Latest AI verdict"),
};

const actions = [
  {
    slug: "create-lead",
    name: "Create Lead",
    handler: "create",
    type: "write",
    description:
      "Capture a new lead from any channel — web chat, a scraped tender, or raised in-app. Detects duplicates on email, phone and company domain; a duplicate is recorded, linked and auto-closed rather than discarded. Stamps SLA due dates on arrival.",
    input: obj(
      {
        source: str("Channel: widget (web chat), tender (scraped), or inapp"),
        companyName: str("Company name"),
        sourceDetail: str("Refinement, e.g. website chat, ADGPG, defect, reclean"),
        contactName: str("Contact person"),
        contactEmail: str("Contact email"),
        contactPhone: str("Contact phone, any format"),
        websiteDomain: str("Company website or domain"),
        serviceType: str("Service requested"),
        description: str("What the enquiry says"),
        siteAddress: str("Site street address"),
        siteCity: str("Site city"),
        siteRegion: str("Site region or emirate"),
        estimatedValue: num("Rough opportunity value"),
        currency: str("Currency code, e.g. AED"),
        facilioAssetId: str("Originating Facilio asset id, for defect-sourced leads"),
        actorEmail: ACTOR,
      },
      ["source", "companyName"]
    ),
    output: out({
      leadId: str("New lead id"),
      refNo: str("Reference number"),
      status: str("new, or closed when it was a duplicate"),
      duplicateOf: obj({
        id: str("The original lead's id"),
        refNo: str("The original's reference number"),
        matchedOn: str("email, phone or domain"),
      }),
    }),
  },
  {
    slug: "list-leads",
    name: "List Leads",
    handler: "list",
    type: "read",
    description:
      "List or queue leads. Overdue is computed at read time from the SLA stamps, and results are ordered with overdue leads above high scores. Check `truncated` — result sets are capped.",
    input: obj({
      status: str("Filter by status"),
      ownerEmail: str("Filter by actioner"),
      source: str("Filter by channel"),
      verdict: str("Filter by AI verdict"),
      scoreMin: num("Minimum score"),
      overdueOnly: str("true to return only breached SLAs"),
      unclaimedOnly: str("true to return only unclaimed, non-terminal leads"),
      search: str("Substring match on company, contact or reference number"),
      limit: num("Page size, default 50, max 200"),
      offset: num("Page offset"),
    }),
    output: out({
      leads: { type: "array", description: "Matching leads with sla, band and priority" },
      total: num("Total matching before paging"),
      truncated: { type: "boolean", description: "True when the row cap was hit" },
    }),
  },
  {
    slug: "get-lead",
    name: "Get Lead",
    handler: "get",
    type: "read",
    description:
      "One lead with its latest AI analysis, full activity timeline, assignment history, linked duplicates and a live SLA snapshot.",
    input: obj({ leadId: LEAD_ID }, ["leadId"]),
    output: out({
      lead: obj(LEAD_SUMMARY),
      sla: obj({
        isOverdue: { type: "boolean", description: "Any clock breached" },
        breached: { type: "array", description: "Stages that are late" },
        nextDue: obj({ stage: str("Next stage due"), dueAt: str("ISO timestamp") }),
      }),
      band: str("hot, warm, cool or cold"),
      analysis: { type: "object", description: "Latest analysis version, or null" },
      timeline: { type: "array", description: "Newest-first activity log" },
      assignments: { type: "array", description: "Ownership history" },
      duplicates: { type: "array", description: "Leads linked to this one as duplicates" },
    }),
  },
  {
    slug: "update-lead",
    name: "Update Lead",
    handler: "update",
    type: "write",
    description:
      "Edit descriptive fields on a lead. Status cannot be changed here — use Transition Lead, which validates the state machine and writes the timeline.",
    input: obj(
      {
        leadId: LEAD_ID,
        companyName: str("Company name"),
        contactName: str("Contact person"),
        serviceType: str("Service requested"),
        description: str("Enquiry text"),
        siteAddress: str("Site street address"),
        siteCity: str("Site city"),
        siteRegion: str("Site region or emirate"),
        estimatedValue: num("Rough opportunity value"),
        currency: str("Currency code"),
        nurtureUntil: str("ISO date to bring a nurtured lead back"),
        actorEmail: ACTOR,
      },
      ["leadId"]
    ),
    output: out(LEAD_SUMMARY),
  },
  {
    slug: "transition-lead",
    name: "Transition Lead",
    handler: "transition",
    type: "write",
    description:
      "Change a lead's status. The only path that does, and it validates the move: new→in_review|closed, in_review→contacted|qualified|nurture|closed, contacted→qualified|nurture|closed, qualified→converted|closed, nurture→in_review|contacted|closed. Closing requires a disposition reason.",
    input: obj(
      {
        leadId: LEAD_ID,
        toStatus: str("new, in_review, contacted, qualified, nurture, converted or closed"),
        dispositionReason: str(
          "Required when closing: spam, duplicate, outside_region, wrong_service, not_interested, no_budget, no_response, lost_to_competitor or test"
        ),
        note: str("Free-text note recorded on the timeline"),
        actorEmail: ACTOR,
      },
      ["leadId", "toStatus"]
    ),
    output: out(LEAD_SUMMARY),
  },
  {
    slug: "claim-lead",
    name: "Claim Lead",
    handler: "claim",
    type: "write",
    description:
      "Take an unclaimed lead off the shared queue. Sets the actioner, stamps the review time, and moves a new lead to in_review. Fails if someone else already owns it.",
    input: obj({ leadId: LEAD_ID, actorEmail: ACTOR }, ["leadId", "actorEmail"]),
    output: out(LEAD_SUMMARY),
  },
  {
    slug: "assign-lead",
    name: "Assign Lead",
    handler: "assign",
    type: "write",
    description:
      "Assign or reassign a lead's actioner or sales owner. Every change is recorded in the assignment history, so ownership has a trail rather than just a current value.",
    input: obj(
      {
        leadId: LEAD_ID,
        toUser: str("Email of the person to assign to"),
        role: str("actioner or sales"),
        reason: str("Why it is being assigned"),
        actorEmail: ACTOR,
      },
      ["leadId", "toUser", "role"]
    ),
    output: out(LEAD_SUMMARY),
  },
  {
    slug: "log-lead-activity",
    name: "Log Lead Activity",
    handler: "log-activity",
    type: "write",
    description:
      "Record a call, email, note, meeting or attachment on a lead's timeline. A call, email or meeting satisfies the first-response SLA and advances the lead to contacted.",
    input: obj(
      {
        leadId: LEAD_ID,
        kind: str("call, email, note, attachment or meeting"),
        body: str("What happened"),
        fileId: num("Vibe file store id, for an attachment"),
        actorEmail: ACTOR,
      },
      ["leadId", "kind", "body"]
    ),
    output: out({
      lead: obj(LEAD_SUMMARY),
      contacted: { type: "boolean", description: "True if this advanced the lead to contacted" },
    }),
  },
  {
    slug: "analyse-lead",
    name: "Analyse Lead",
    handler: "analyse",
    type: "write",
    description:
      "Store a lead-analyst verdict as a new version and snapshot the score onto the lead. Pass replyJson: the model call must happen in the caller, because a function cannot wait for an LLM. Never changes status — a human decides.",
    input: obj(
      {
        leadId: LEAD_ID,
        replyJson: str("The agent's reply, as returned in response.content"),
        agent: str("Override the analyst agent link name"),
      },
      ["leadId"]
    ),
    output: out({
      version: num("Analysis version number"),
      verdict: str("relevant, not_relevant or outside_region"),
      score: num("0-100"),
      band: str("hot, warm, cool or cold"),
      reasons: { type: "array", description: "Why the analyst decided this" },
      source: str("agent or supplied"),
    }),
  },
  {
    slug: "convert-lead",
    name: "Convert Lead",
    handler: "convert",
    type: "write",
    description:
      "Turn a qualified lead into an Account, Contact and Deal, and queue the Facilio client and contact writes. Idempotent — re-running reuses the existing records and queues nothing new.",
    input: obj(
      {
        leadId: LEAD_ID,
        dealTitle: str("Title for the deal"),
        estimatedValue: num("Deal value, defaults to the lead's"),
        salesOwnerEmail: str("Sales owner to hand the deal to"),
        actorEmail: ACTOR,
      },
      ["leadId"]
    ),
    output: out({
      accountId: str("Account id"),
      accountCreated: {
        type: "boolean",
        description: "False when the lead joined a company we already had an account for",
      },
      contactId: str("Contact id"),
      dealId: str("Deal id"),
      dealRefNo: str("Deal reference, e.g. DEAL-0001"),
      queued: { type: "array", description: "Idempotency keys of the queued Facilio writes" },
    }),
  },
  {
    slug: "list-accounts",
    name: "List Accounts",
    handler: "account-list",
    type: "read",
    description:
      "List the companies behind converted leads, each with how many leads resolved to it and how many deals came out of them.",
    input: obj({
      search: str("Substring match on name, email or website domain"),
      syncStatus: str("Filter by Facilio sync state: pending or synced"),
      limit: num("Page size, default 50, max 200"),
      offset: num("Page offset"),
    }),
    output: out({
      accounts: { type: "array", description: "Newest first" },
      total: num("Matching accounts, ignoring the page"),
      truncated: { type: "boolean", description: "True when the platform capped the rows" },
    }),
  },
  {
    slug: "get-account",
    name: "Get Account",
    handler: "account-get",
    type: "read",
    description:
      "One account with its contacts, its deals, and every lead that resolved to this company — repeat enquiries included.",
    input: obj({ accountId: ACCOUNT_ID }, ["accountId"]),
    output: out({
      account: obj(ACCOUNT_SUMMARY),
      contacts: { type: "array", description: "Primary contact first" },
      deals: { type: "array", description: "Newest first" },
      leads: { type: "array", description: "Every lead that resolved to this account" },
    }),
  },
  {
    slug: "drain-lead-sync",
    name: "Drain Lead Sync",
    handler: "sync-drain",
    type: "write",
    description:
      "Process queued Facilio writes. An outcome of 'retry' is normal rather than an error — Facilio calls intermittently exceed the sandbox fetch timeout, and the task is requeued with backoff. 'deferred' means it is waiting on a dependency and consumed no attempt.",
    input: obj({ batchSize: num("Tasks per pass, 1-25, default 5") }),
    output: out({
      claimed: num("Tasks picked up"),
      succeeded: num("Delivered to Facilio"),
      deferred: num("Waiting on a dependency"),
      failed: num("Attempts exhausted"),
      results: { type: "array", description: "Per-task outcome and detail" },
    }),
  },
  {
    slug: "lead-sync-status",
    name: "Lead Sync Status",
    handler: "sync-status",
    type: "read",
    description: "Outbox counts by status plus the most recent failures, for monitoring the Facilio integration.",
    input: obj({}),
    output: out({
      counts: obj({
        pending: num("Waiting"),
        in_progress: num("Being processed"),
        done: num("Delivered"),
        failed: num("Attempts exhausted"),
      }),
      failures: { type: "array", description: "Recent failed tasks with their errors" },
    }),
  },
  {
    slug: "retry-lead-sync",
    name: "Retry Lead Sync",
    handler: "sync-retry",
    type: "write",
    description: "Requeue a failed sync task for another attempt. Fails if the task is not in the failed state.",
    input: obj({ taskId: str("Sync task id") }, ["taskId"]),
    output: out({ ok: { type: "boolean", description: "True when requeued" } }),
  },
  {
    slug: "get-lead-settings",
    name: "Get Lead Settings",
    handler: "settings-get",
    type: "read",
    description:
      "Service areas, service lines, the coverage matrix and SLA targets. This is the data the analyst judges relevance against.",
    input: obj({}),
    output: out({
      areas: { type: "array", description: "Service areas" },
      serviceLines: { type: "array", description: "Services offered" },
      coverage: { type: "array", description: "Which services are offered in which areas" },
      sla: obj({
        firstResponseMins: num("Minutes to first response"),
        qualificationMins: num("Minutes to qualification"),
        assignmentMins: num("Minutes to sales assignment"),
      }),
    }),
  },
  {
    slug: "set-lead-sla",
    name: "Set Lead SLA",
    handler: "settings-put",
    type: "write",
    description:
      "Update the SLA targets and the analyst agent name. Editing service areas and coverage requires nested lists, which a connection action cannot express — use the function directly for those.",
    input: obj({
      firstResponseMins: num("Minutes from arrival to first response"),
      qualificationMins: num("Minutes from arrival to qualification"),
      assignmentMins: num("Minutes from arrival to sales assignment"),
      analystAgent: str("Flow-AI link name of the analyst agent"),
    }),
    output: out({
      applied: { type: "object", description: "Counts of what changed" },
      settings: { type: "object", description: "The settings after the update" },
    }),
  },
  {
    slug: "lead-reference",
    name: "Lead Reference Data",
    handler: "reference",
    type: "read",
    description:
      "Every allowed enum value — statuses, disposition reasons, channels, activity kinds and assignment roles — so callers never hardcode them.",
    input: obj({}),
    output: out({
      statuses: { type: "array", description: "Lead statuses" },
      dispositionReasons: { type: "array", description: "Reasons a lead can close" },
      sources: { type: "array", description: "Channels a lead can arrive through" },
      activityKinds: { type: "array", description: "Timeline activity types" },
      assignmentRoles: { type: "array", description: "Assignment roles" },
    }),
  },
];

// --- run --------------------------------------------------------------------

const wanted = only.length ? actions.filter((a) => only.includes(a.slug)) : actions;

const cli = (args) => execFileSync("facilio", args, { stdio: "pipe", encoding: "utf8" });
const lastLine = (e) =>
  `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").filter(Boolean).pop() ?? String(e);

let created = 0;
let updated = 0;
let failed = 0;

for (const a of wanted) {
  // `--function` and `--handler` MUST travel together on update: they are what
  // rebuilds the derived request template. Updating without them drops
  // `method: "POST"` from the template and the action silently stops working.
  const common = [
    "--function",
    "lead",
    "--handler",
    a.handler,
    "--description",
    a.description,
    "--input-schema",
    JSON.stringify(a.input),
    "--output-schema",
    JSON.stringify(a.output),
    "--active",
    "true",
  ];

  if (DRY) {
    console.log(
      `· ${a.slug.padEnd(20)} ${a.handler.padEnd(14)} ${Object.keys(a.input.properties).length} inputs`
    );
    continue;
  }

  try {
    cli([
      "vibe",
      "connection",
      "actions",
      "create",
      a.name,
      "--slug",
      a.slug,
      "--type",
      a.type,
      ...common,
    ]);
    console.log(`✓ created ${a.slug}`);
    created++;
  } catch (e) {
    // `create` fails when the action already exists — fall back to updating it.
    try {
      cli(["vibe", "connection", "actions", "update", a.slug, ...common]);
      console.log(`✓ updated ${a.slug}`);
      updated++;
    } catch (e2) {
      console.error(`✗ ${a.slug}: ${lastLine(e2)}`);
      failed++;
    }
  }
}

if (!DRY) {
  console.log(`\n${created} created, ${updated} updated, ${failed} failed`);
  console.log("Actions are DRAFT — publish the connection from the Facilio platform UI to go live.");
}
if (failed) process.exitCode = 1;
