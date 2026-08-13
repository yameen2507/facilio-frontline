/**
 * End-to-end verification of the Lead module against the real platform.
 *
 * Backend only — no UI, no browser. Every step is a `facilio vibe function run`,
 * which is the whole point: the API has to be provable from the terminal before
 * any frontend exists.
 *
 * Re-runnable: each run uses a unique company/email/phone so it never collides
 * with a previous run's dedup keys.
 *
 *   node scripts/walk.mjs             # full walk, canned analysis (free)
 *   node scripts/walk.mjs --agent     # also call the real agent via the CLI
 *   node scripts/walk.mjs --no-sync   # skip the Facilio write
 */

import { execFileSync } from "node:child_process";

const WITH_AGENT = process.argv.includes("--agent");
const SKIP_SYNC = process.argv.includes("--no-sync");

const run = Date.now().toString().slice(-6);
const ACTIONER = "sudharsan@frontline.ae";
const SALES = "mithun@frontline.ae";

let passed = 0;
let failed = 0;
const failures = [];

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** Invoke a handler and return its `data`, throwing on `ok:false`. */
function call(handler, payload) {
  const args = JSON.stringify(payload === undefined ? {} : { payload: JSON.stringify(payload) });

  let out;
  try {
    out = execFileSync("facilio", ["vibe", "function", "run", "lead", handler, "--args", args], {
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    throw new Error(`CLI failed: ${`${e.stdout ?? ""}${e.stderr ?? ""}`.trim().slice(-300)}`);
  }

  const start = out.indexOf("{");
  if (start === -1) throw new Error(`no JSON in output: ${out.slice(-200)}`);

  const parsed = JSON.parse(out.slice(start));
  if (!parsed.ok) throw new Error(parsed.error ?? "handler returned ok:false");
  return parsed.data;
}

/** Ask the agent through the CLI — a function cannot, it would time out (§8a). */
function askAgent(input) {
  const out = execFileSync("facilio", ["vibe", "agent", "run", "lead-analyst", "--input", input], {
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 10 * 1024 * 1024,
  });
  const start = out.indexOf("{");
  const parsed = JSON.parse(out.slice(start));
  return parsed?.response?.content;
}

function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ${c.ok("✓")} ${label}${detail ? ` ${c.dim(detail)}` : ""}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ${c.bad("✗")} ${label}${detail ? ` ${c.dim(detail)}` : ""}`);
  }
}

function step(n, title) {
  console.log(`\n${c.b(`${n}. ${title}`)}`);
}

// A deterministic analyst reply, so the walk asserts the storage path without
// spending a model call. `--agent` swaps in the real thing.
const CANNED_REPLY = JSON.stringify({
  understanding: {
    wants: "TR19-certified deep clean of four extraction hoods",
    services: ["Kitchen extract cleaning"],
    facilityType: "Restaurant",
    location: "Deira, Dubai",
    urgency: "immediate",
    estimatedValue: 12000,
    missingInfo: ["Kitchen downtime window", "Hood dimensions"],
    risks: ["Heavy grease load may need a second visit"],
  },
  relevance: {
    verdict: "relevant",
    reasons: ["Kitchen extract cleaning is listed for Dubai (KEC)", "Deira is within Dubai"],
    matchedServices: ["KEC"],
    unmatchedServices: [],
  },
  score: {
    value: 88,
    fitReasons: ["Exact service match", "Insurance-driven deadline"],
    redFlags: ["No access hours confirmed"],
  },
  recommendation: { nextAction: "Call to book a survey", rationale: "In scope and urgent" },
});

console.log(c.b(`\nLead module walk — run ${run}\n${"=".repeat(40)}`));

try {
  // -------------------------------------------------------------------------
  step(1, "Reference data");
  const ref = call("reference");
  check("three channels only", ref.sources.length === 3, ref.sources.join("/"));
  check("no phone/manual channel", !ref.sources.includes("manual"));
  check("seven statuses", ref.statuses.length === 7);

  // -------------------------------------------------------------------------
  step(2, "Settings — service coverage");
  const settings = call("settings-put", {
    areas: [
      { name: "Dubai", region: "Dubai", country: "AE" },
      { name: "Abu Dhabi", region: "Abu Dhabi", country: "AE" },
    ],
    serviceLines: [
      { code: "KEC", name: "Kitchen extract cleaning (TR19 grease)" },
      { code: "HVAC", name: "HVAC maintenance" },
    ],
    coverage: [
      { area: "Dubai", serviceLine: "KEC" },
      { area: "Dubai", serviceLine: "HVAC" },
      { area: "Abu Dhabi", serviceLine: "KEC" },
    ],
    sla: { firstResponseMins: 60, qualificationMins: 1440, assignmentMins: 2880 },
  });
  check("coverage stored", settings.settings.coverage.length >= 3);
  check("SLA targets stored", settings.settings.sla.firstResponseMins === 60);

  // -------------------------------------------------------------------------
  step(3, "Capture from the web chat channel");
  const created = call("create", {
    source: "widget",
    sourceDetail: "website chat",
    companyName: `Al Manzil Restaurant ${run}`,
    contactName: "Ahmed Khalil",
    contactEmail: `ahmed${run}@almanzil${run}.ae`,
    contactPhone: `+971 50 ${run.slice(0, 3)} ${run.slice(3)}`,
    websiteDomain: `https://www.almanzil${run}.ae`,
    serviceType: "Kitchen hood cleaning",
    description:
      "Busy grill kitchen in Deira, Dubai. Four extraction hoods, never deep cleaned in 14 months. Insurance wants a TR19 certificate before month end.",
    siteAddress: "Al Rigga Road, Deira",
    siteCity: "Dubai",
    siteRegion: "Dubai",
    estimatedValue: 12000,
    currency: "AED",
    actorEmail: ACTIONER,
  });
  const leadId = created.leadId;
  check("lead created", Boolean(leadId), created.refNo);
  check("status is new", created.status === "new");
  check("not flagged duplicate", created.duplicateOf === null);

  // -------------------------------------------------------------------------
  step(4, "Dedup — same enquiry, phone written differently");
  const dup = call("create", {
    source: "inapp",
    companyName: `Al Manzil Rest ${run}`,
    contactName: "Ahmed",
    contactPhone: `0${run.slice(0, 2)}${run.slice(2)}`.slice(0, 10),
    contactEmail: `ahmed${run}@almanzil${run}.ae`,
    description: "Enquired again",
    actorEmail: ACTIONER,
  });
  check("duplicate detected", dup.duplicateOf !== null, dup.duplicateOf?.matchedOn);
  check("duplicate auto-closed", dup.status === "closed");
  check("linked to the original", dup.duplicateOf?.id === leadId);

  // -------------------------------------------------------------------------
  step(5, "Queue — unclaimed leads");
  const queue = call("list", { unclaimedOnly: true, limit: 50 });
  check("new lead is in the queue", queue.leads.some((l) => l.id === leadId));
  check(
    "closed duplicate is not",
    !queue.leads.some((l) => l.id === dup.leadId)
  );

  // -------------------------------------------------------------------------
  step(6, "Analysis");
  const replyJson = WITH_AGENT ? askAgent(buildInput()) : CANNED_REPLY;
  const analysis = call("analyse", { leadId, replyJson });
  check("verdict relevant", analysis.verdict === "relevant");
  check("score in range", analysis.score > 0 && analysis.score <= 100, `score ${analysis.score}`);
  check("band derived", ["hot", "warm", "cool", "cold"].includes(analysis.band), analysis.band);
  check("version 1", analysis.version === 1);
  check("source recorded", ["agent", "supplied"].includes(analysis.source), analysis.source);

  // -------------------------------------------------------------------------
  step(7, "Claim");
  const claimed = call("claim", { leadId, actorEmail: ACTIONER });
  check("moved to in_review", claimed.status === "in_review");
  check("owner set", claimed.ownerEmail === ACTIONER);
  check("reviewed_at stamped", Boolean(claimed.reviewedAt));

  // -------------------------------------------------------------------------
  step(8, "Log a call — should satisfy first response");
  const logged = call("log-activity", {
    leadId,
    kind: "call",
    body: "Called Ahmed. Confirmed four hoods over grills. Booking a survey.",
    actorEmail: ACTIONER,
  });
  check("auto-advanced to contacted", logged.lead.status === "contacted");
  check("first_contact_at stamped", Boolean(logged.lead.firstContactAt));

  // -------------------------------------------------------------------------
  step(9, "Illegal transitions are refused");
  let rejected = false;
  try {
    call("transition", { leadId, toStatus: "converted", actorEmail: ACTIONER });
  } catch (e) {
    rejected = /cannot go from/.test(e.message);
  }
  check("contacted → converted blocked", rejected);

  let reasonRequired = false;
  try {
    call("transition", { leadId, toStatus: "closed", actorEmail: ACTIONER });
  } catch (e) {
    reasonRequired = /disposition reason/.test(e.message);
  }
  check("closing without a reason blocked", reasonRequired);

  // -------------------------------------------------------------------------
  step(10, "Qualify");
  const qualified = call("transition", {
    leadId,
    toStatus: "qualified",
    note: "Four hoods, Deira, insurance-driven.",
    actorEmail: ACTIONER,
  });
  check("status qualified", qualified.status === "qualified");
  check("qualified_at stamped", Boolean(qualified.qualifiedAt));

  // -------------------------------------------------------------------------
  step(11, "Convert → Account + Contact + Deal");
  const converted = call("convert", {
    leadId,
    actorEmail: ACTIONER,
    salesOwnerEmail: SALES,
  });
  check("account created", Boolean(converted.accountId));
  check("contact created", Boolean(converted.contactId));
  check("deal created", Boolean(converted.dealId), converted.dealRefNo);
  check("facilio writes queued", converted.queued.length === 2, `${converted.queued.length} tasks`);

  step(12, "Convert is idempotent");
  const again = call("convert", { leadId, actorEmail: ACTIONER });
  check("same account reused", again.accountId === converted.accountId);
  check("same deal reused", again.dealId === converted.dealId);
  check("no duplicate tasks queued", again.queued.length === 0);

  // -------------------------------------------------------------------------
  step(13, "Detail view");
  const detail = call("get", { leadId });
  check("status converted", detail.lead.status === "converted");
  check("score denormalised onto the lead", detail.lead.score === analysis.score);
  check("analysis attached", detail.analysis !== null);
  check("timeline populated", detail.timeline.length >= 8, `${detail.timeline.length} entries`);
  check("assignment history", detail.assignments.length >= 1);
  check("duplicate linked", detail.duplicates.some((d) => d.id === dup.leadId));
  check("not overdue", detail.sla.isOverdue === false);

  // -------------------------------------------------------------------------
  if (SKIP_SYNC) {
    step(14, "Facilio sync — skipped (--no-sync)");
  } else {
    step(14, "Facilio sync");
    const drained = call("sync-drain", { batchSize: 5 });
    check("tasks claimed", drained.claimed > 0, `${drained.claimed} claimed`);

    // Facilio CMMS calls intermittently exceed the sandbox's ~10s fetch timeout,
    // so first-attempt success is NOT a valid assertion. What must hold is that
    // the drain handled every task gracefully — delivered, queued for retry, or
    // deferred on a dependency — and never dropped one or crashed. Eventual
    // delivery is the outbox's job and is proven by the retry path.
    const graceful = drained.results.every((r) =>
      ["done", "retry", "deferred"].includes(r.outcome)
    );
    check("every task handled gracefully", graceful);
    check("nothing dead-lettered on the first pass", drained.failed === 0);

    const client = drained.results.find((r) => r.action === "create_client");
    if (client?.outcome === "done") {
      check("client synced to Facilio", true, `facilio id ${client.detail}`);
    } else {
      console.log(
        `     ${c.dim(`client not synced this pass (${client?.outcome}) — will retry with backoff`)}`
      );
    }
    for (const r of drained.results) {
      console.log(`     ${c.dim(`${r.action}: ${r.outcome}${r.detail ? ` — ${String(r.detail).slice(0, 90)}` : ""}`)}`);
    }

    const status = call("sync-status");
    console.log(`     ${c.dim(`outbox: ${JSON.stringify(status.counts)}`)}`);
  }

  function buildInput() {
    return [
      "SERVICE SCOPE — we only serve these service/area combinations:",
      "- Dubai, Dubai: Kitchen extract cleaning (TR19 grease) (KEC); HVAC maintenance (HVAC)",
      "- Abu Dhabi, Abu Dhabi: Kitchen extract cleaning (TR19 grease) (KEC)",
      "Anything outside these areas is outside_region. Anything not listed is not_relevant.",
      "",
      "LEAD:",
      `Company: Al Manzil Restaurant ${run}`,
      "Service asked for: Kitchen hood cleaning",
      "City: Dubai",
      "Enquiry: Four extraction hoods, 14 months uncleaned, insurance wants TR19 before month end.",
      "",
      "Reply as JSON matching your output schema.",
    ].join("\n");
  }
} catch (e) {
  failed++;
  failures.push(`FATAL: ${e.message}`);
  console.log(`\n  ${c.bad("✗ FATAL")} ${e.message}`);
}

console.log(`\n${"=".repeat(40)}`);
console.log(
  failed === 0
    ? c.ok(`${c.b("ALL PASSED")} — ${passed} checks`)
    : c.bad(`${passed} passed, ${failed} FAILED`)
);
if (failures.length) failures.forEach((f) => console.log(`  ${c.bad("·")} ${f}`));
process.exitCode = failed === 0 ? 0 : 1;
