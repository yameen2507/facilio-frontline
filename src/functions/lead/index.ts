/**
 * The Lead module's API. Thin adapters only — read the input, call a module,
 * return `{ ok, data?, error? }`. All logic lives in src/modules and src/domain.
 *
 * WHY EVERY PARAMETER IS DECLARED EXPLICITLY:
 *
 * The platform filters incoming `args` down to the declared `parameters` — an
 * undeclared field is silently dropped. And a Facilio connection action derives
 * its request template by mapping each input-schema property straight into the
 * body at the top level, so a published action can only ever send flat fields.
 *
 * Declaring every scalar therefore serves three callers from one handler:
 *   - CLI / SDK  →  { payload: "{...}" }
 *   - connection action  →  { companyName: "...", source: "widget" }
 *   - either, mixed — flat fields win (see shared/envelope.ts)
 *
 * Parameter types may only be "string" or "number" (a platform limit), which is
 * why booleans travel as "true"/"false" and nested input keeps the envelope.
 */

import StudioFunctions from "@facilio/studio-functions";
import {
  handle,
  limit as readLimit,
  offset as readOffset,
  oneOf,
  optArray,
  optBool,
  optNum,
  optStr,
  parsePayload,
  str,
} from "../../shared/envelope";
import {
  assignLead,
  claimLead,
  createLead,
  getLead,
  type LeadDetail,
  leadDetail,
  listLeads,
  LEAD_SOURCES,
  logActivity,
  transitionLead,
  updateLead,
} from "../../modules/lead";
import {
  analyseLead,
  analystAgentName,
  analystIdentity,
  ANALYST_AGENT_SETTING,
  ANALYST_LINK_SETTING,
  buildAnalystInput,
} from "../../modules/analysis";
import { recordTurn, startSession, submitSession, transcript } from "../../modules/intake";
import { accountDetail, listAccounts } from "../../modules/account";
import { convertLead } from "../../modules/convert";
import { drain, retry, syncStatus } from "../../modules/sync";
import {
  ANALYST_TASK_SETTING,
  configData,
  coverageView,
  DEFAULT_ANALYST_TASK,
  saveArea,
  saveCoverage,
  saveServiceLine,
  SCOPE_NOTES_SETTING,
  setSetting,
} from "../../modules/settings";
import { LEAD_STATUSES, DISPOSITION_REASONS } from "../../domain/lead-state";

const S = (description: string) => ({ description, type: "string" as const });
const N = (description: string) => ({ description, type: "number" as const });

/** Every handler accepts the envelope as an alternative to flat fields. */
const ENV = { payload: S("Optional: the whole input as a JSON object string") };

const LEAD_ID = S("Lead id (uuid)");
const ACTOR = S("Email of the user performing this action");

const server = new StudioFunctions({ name: "lead" });

/**
 * A mutation's response with the whole refreshed lead view attached.
 *
 * The browser used to follow every mutation with a separate `get`, and a round
 * trip costs ~1.1s of fixed platform overhead before any work happens (see
 * shared/db.ts). Attaching the view costs ONE extra batched query here — about
 * 194ms — and saves the client that entire second trip.
 *
 * The mutation's own result stays spread at the top level, so existing callers
 * (connection actions, the CLI, anything reading `.status` or `.ownerEmail`) see
 * exactly what they saw before; `detail` is purely additive.
 */
const withDetail = <T extends object>(result: T, leadId: string): T & { detail: LeadDetail } => ({
  ...result,
  detail: leadDetail(leadId),
});

// --- settings ---------------------------------------------------------------

server.addHandler({
  name: "settings-get",
  description:
    "Service areas, service lines, coverage matrix, SLA targets, the editable analyst prompt and the analyst agent's identity",
  parameters: {},
  // `agent` is assembled here rather than in coverageView() because the settings
  // module must not import analysis — analysis already imports settings.
  //
  // The config is fetched ONCE and handed to both: coverageView() would otherwise
  // read it again, and each read is ~194ms of fixed overhead (see shared/db.ts).
  execute: async () =>
    handle(() => {
      const data = configData();
      return { ...coverageView(data), agent: analystIdentity(data) };
    }),
});

server.addHandler({
  name: "settings-put",
  description:
    "Upsert service areas, service lines, coverage and SLA targets. Nested lists require the payload envelope.",
  parameters: {
    ...ENV,
    analystAgent: S("Logical name of the analyst agent, e.g. lead-analyst"),
    analystAgentLink: S("Flow-AI link name of the analyst agent, e.g. lead-analyst_<appuuid>"),
    scopeNotes: S("Extra scope wording appended to the generated service brief"),
    analystTask: S("The closing instruction the analyst is given for every lead"),
    firstResponseMins: N("SLA: minutes from arrival to first response"),
    qualificationMins: N("SLA: minutes from arrival to qualification"),
    assignmentMins: N("SLA: minutes from arrival to sales assignment"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const created = { areas: 0, serviceLines: 0, coverage: 0, sla: 0, prompt: 0 };

      const areaIdsByName = new Map<string, string>();
      for (const raw of optArray(p, "areas") ?? []) {
        const a = raw as Record<string, unknown>;
        if (typeof a.name !== "string" || !a.name.trim()) throw new Error("each area needs a name");
        const id = saveArea({
          name: a.name.trim(),
          region: typeof a.region === "string" ? a.region : null,
          country: typeof a.country === "string" ? a.country : null,
          active: a.active !== false,
        });
        areaIdsByName.set(a.name.trim(), id);
        created.areas++;
      }

      const lineIdsByCode = new Map<string, string>();
      for (const raw of optArray(p, "serviceLines") ?? []) {
        const l = raw as Record<string, unknown>;
        if (typeof l.code !== "string" || !l.code.trim())
          throw new Error("each service line needs a code");
        const id = saveServiceLine({
          code: l.code.trim(),
          name: typeof l.name === "string" && l.name.trim() ? l.name.trim() : l.code.trim(),
          active: l.active !== false,
        });
        lineIdsByCode.set(l.code.trim(), id);
        created.serviceLines++;
      }

      // Coverage is expressed by human names so a caller never handles ids. One
      // batched read for both name lists — coverageView() would also compose the
      // scope brief, which re-reads every coverage row for nothing.
      const known = configData();
      const areaId = (name: string) =>
        areaIdsByName.get(name) ?? known.areas.find((a) => a.name === name)?.id;
      const lineId = (code: string) =>
        lineIdsByCode.get(code) ?? known.serviceLines.find((l) => l.code === code)?.id;

      for (const raw of optArray(p, "coverage") ?? []) {
        const c = raw as Record<string, unknown>;
        const aId = typeof c.area === "string" ? areaId(c.area) : undefined;
        const lId = typeof c.serviceLine === "string" ? lineId(c.serviceLine) : undefined;
        if (!aId) throw new Error(`unknown area in coverage: ${String(c.area)}`);
        if (!lId) throw new Error(`unknown service line in coverage: ${String(c.serviceLine)}`);
        saveCoverage(aId, lId, c.active !== false);
        created.coverage++;
      }

      // An agent has two identifiers and they are not interchangeable: the
      // logical name is what the browser resolves, the app-suffixed link name is
      // what the server-side ai-studio actions address. Both are config, not
      // code, so a re-created agent is a settings change and not a rebuild.
      const analystAgent = optStr(p, "analystAgent");
      if (analystAgent) setSetting(ANALYST_AGENT_SETTING, analystAgent);

      const analystAgentLink = optStr(p, "analystAgentLink");
      if (analystAgentLink) setSetting(ANALYST_LINK_SETTING, analystAgentLink);

      // Prompt text uses `in` rather than optStr so that "" CLEARS a note
      // instead of being read as "leave it alone". Only the payload envelope can
      // express that — a connection action's blank fields are dropped upstream.
      if ("scopeNotes" in p) {
        setSetting(SCOPE_NOTES_SETTING, String(p.scopeNotes ?? "").trim());
        created.prompt++;
      }

      if ("analystTask" in p) {
        const task = String(p.analystTask ?? "").trim();
        // A blank task would send the analyst a lead with no instruction at all,
        // so an empty value restores the shipped wording rather than erasing it.
        setSetting(ANALYST_TASK_SETTING, task || DEFAULT_ANALYST_TASK);
        created.prompt++;
      }

      // SLA targets accept either the nested `sla` object or flat minutes.
      const sla = (p.sla as Record<string, unknown> | undefined) ?? {};
      const slaKeys: Record<string, string> = {
        firstResponseMins: "sla.first_response_mins",
        qualificationMins: "sla.qualification_mins",
        assignmentMins: "sla.assignment_mins",
      };
      for (const key of Object.keys(slaKeys)) {
        const value = sla[key] ?? p[key];
        if (value === undefined) continue;
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} must be a positive number`);
        setSetting(slaKeys[key], Math.round(n));
        created.sla++;
      }

      // Re-read once, after the writes, and share it between both views.
      const fresh = configData();
      return {
        applied: created,
        settings: { ...coverageView(fresh), agent: analystIdentity(fresh) },
      };
    }),
});

// --- capture ----------------------------------------------------------------

server.addHandler({
  name: "create",
  description:
    "Capture a new lead from any channel. The only writer of leads — normalises dedup keys, detects duplicates, stamps SLA due dates.",
  parameters: {
    ...ENV,
    source: S("Channel: widget (web chat), tender (scraped), or inapp"),
    sourceDetail: S("Refinement, e.g. website chat, ADGPG, defect, reclean"),
    companyName: S("Company name — required"),
    contactName: S("Contact person"),
    contactEmail: S("Contact email"),
    contactPhone: S("Contact phone, any format"),
    websiteDomain: S("Company website or domain"),
    serviceType: S("Service requested"),
    description: S("What the enquiry says"),
    siteAddress: S("Site street address"),
    siteCity: S("Site city"),
    siteRegion: S("Site region or emirate"),
    estimatedValue: N("Rough opportunity value"),
    currency: S("Currency code, e.g. AED"),
    facilioAssetId: S("Originating Facilio asset id, for defect-sourced leads"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return createLead({
        source: oneOf(p, "source", LEAD_SOURCES),
        sourceDetail: optStr(p, "sourceDetail"),
        companyName: str(p, "companyName"),
        contactName: optStr(p, "contactName"),
        contactEmail: optStr(p, "contactEmail"),
        contactPhone: optStr(p, "contactPhone"),
        websiteDomain: optStr(p, "websiteDomain"),
        serviceType: optStr(p, "serviceType"),
        description: optStr(p, "description"),
        siteAddress: optStr(p, "siteAddress"),
        siteCity: optStr(p, "siteCity"),
        siteRegion: optStr(p, "siteRegion"),
        estimatedValue: optNum(p, "estimatedValue"),
        currency: optStr(p, "currency"),
        facilioAssetId: optStr(p, "facilioAssetId"),
        actor: optStr(p, "actorEmail"),
        extra: (p.extra as Record<string, unknown>) ?? {},
      });
    }),
});

// --- read -------------------------------------------------------------------

server.addHandler({
  name: "list",
  description:
    "List or queue leads. Overdue is computed at read time; results are ordered with overdue above score.",
  parameters: {
    ...ENV,
    status: S("Filter by status"),
    ownerEmail: S("Filter by actioner"),
    source: S("Filter by channel"),
    verdict: S("Filter by AI verdict"),
    scoreMin: N("Minimum score"),
    overdueOnly: S("true to return only breached SLAs"),
    unclaimedOnly: S("true to return only unclaimed, non-terminal leads"),
    search: S("Substring match on company, contact or ref number"),
    limit: N("Page size, default 50, max 200"),
    offset: N("Page offset"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return listLeads({
        status: optStr(p, "status"),
        ownerEmail: optStr(p, "ownerEmail"),
        source: optStr(p, "source"),
        verdict: optStr(p, "verdict"),
        scoreMin: optNum(p, "scoreMin"),
        overdueOnly: optBool(p, "overdueOnly") ?? false,
        unclaimedOnly: optBool(p, "unclaimedOnly") ?? false,
        search: optStr(p, "search"),
        limit: readLimit(p),
        offset: readOffset(p),
      });
    }),
});

server.addHandler({
  name: "get",
  description: "One lead with its latest analysis, timeline, assignment history and duplicates",
  parameters: { ...ENV, leadId: LEAD_ID },
  execute: async (args) => handle(() => leadDetail(str(parsePayload(args), "leadId"))),
});

/** Fields `update` will accept as flat scalars as well as inside `fields`. */
const EDITABLE_KEYS = [
  "companyName",
  "contactName",
  "serviceType",
  "description",
  "siteAddress",
  "siteCity",
  "siteRegion",
  "estimatedValue",
  "currency",
  "nurtureUntil",
] as const;

server.addHandler({
  name: "update",
  description: "Edit descriptive fields. Status is rejected here — use transition.",
  parameters: {
    ...ENV,
    leadId: LEAD_ID,
    actorEmail: ACTOR,
    companyName: S("Company name"),
    contactName: S("Contact person"),
    serviceType: S("Service requested"),
    description: S("Enquiry text"),
    siteAddress: S("Site street address"),
    siteCity: S("Site city"),
    siteRegion: S("Site region or emirate"),
    estimatedValue: N("Rough opportunity value"),
    currency: S("Currency code"),
    nurtureUntil: S("ISO date to bring a nurtured lead back"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);

      // Accept either a nested `fields` object or the editable keys flat.
      const nested = p.fields as Record<string, unknown> | undefined;
      const fields: Record<string, unknown> = nested && typeof nested === "object" ? { ...nested } : {};
      for (const key of EDITABLE_KEYS) {
        if (p[key] !== undefined) fields[key] = p[key];
      }

      if (!Object.keys(fields).length) {
        throw new Error(`no editable fields supplied (one of: ${EDITABLE_KEYS.join(", ")})`);
      }

      const leadId = str(p, "leadId");
      return withDetail(updateLead(leadId, fields, optStr(p, "actorEmail")), leadId);
    }),
});

// --- workflow ---------------------------------------------------------------

server.addHandler({
  name: "transition",
  description: `Change a lead's status — the only path that does. Closing requires a disposition reason.`,
  parameters: {
    ...ENV,
    leadId: LEAD_ID,
    toStatus: S(`Target status: ${LEAD_STATUSES.join(", ")}`),
    dispositionReason: S(`Required when closing: ${DISPOSITION_REASONS.join(", ")}`),
    note: S("Free-text note for the timeline"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const leadId = str(p, "leadId");
      return withDetail(
        transitionLead({
          leadId,
          toStatus: oneOf(p, "toStatus", LEAD_STATUSES),
          dispositionReason: optStr(p, "dispositionReason"),
          note: optStr(p, "note"),
          actor: optStr(p, "actorEmail"),
        }),
        leadId
      );
    }),
});

server.addHandler({
  name: "claim",
  description: "Take an unclaimed lead off the queue; moves a new lead to in_review",
  parameters: { ...ENV, leadId: LEAD_ID, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const leadId = str(p, "leadId");
      return withDetail(claimLead(leadId, str(p, "actorEmail")), leadId);
    }),
});

server.addHandler({
  name: "assign",
  description: "Assign or reassign the actioner or the sales owner, recording history",
  parameters: {
    ...ENV,
    leadId: LEAD_ID,
    toUser: S("Email of the person to assign to"),
    role: S("actioner or sales"),
    reason: S("Why it is being assigned"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const leadId = str(p, "leadId");
      return withDetail(
        assignLead({
          leadId,
          toUser: str(p, "toUser"),
          role: oneOf(p, "role", ["actioner", "sales"] as const),
          reason: optStr(p, "reason"),
          actor: optStr(p, "actorEmail"),
        }),
        leadId
      );
    }),
});

server.addHandler({
  name: "log-activity",
  description:
    "Record a call, email, note, meeting or attachment. A call, email or meeting satisfies first response and advances the lead to contacted.",
  parameters: {
    ...ENV,
    leadId: LEAD_ID,
    kind: S("call, email, note, attachment or meeting"),
    body: S("What happened"),
    fileId: N("Vibe file store id, for an attachment"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const leadId = str(p, "leadId");
      return withDetail(
        logActivity({
          leadId,
          kind: oneOf(p, "kind", ["call", "email", "note", "attachment", "meeting"] as const),
          body: str(p, "body"),
          actor: optStr(p, "actorEmail"),
          fileId: optNum(p, "fileId"),
        }),
        leadId
      );
    }),
});

// --- AI ---------------------------------------------------------------------

server.addHandler({
  name: "analyse-input",
  description:
    "The exact prompt to send the analyst for this lead, plus the agent's link name. The caller makes the model call — a function cannot wait for one — so this keeps the scope brief and agent config in one place instead of duplicated in the client.",
  parameters: { ...ENV, leadId: LEAD_ID },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const leadId = str(p, "leadId");
      const lead = getLead(leadId);
      if (!lead) throw new Error(`lead ${leadId} not found`);

      // One config read shared by the agent name and the prompt it goes with.
      const data = configData();
      return { leadId, agent: analystAgentName(data), input: buildAnalystInput(lead, data) };
    }),
});

server.addHandler({
  name: "analyse",
  description:
    "Store a lead-analyst verdict as a new version. Pass replyJson — a function cannot wait for a model, so the caller makes the agent call. Never changes status.",
  parameters: {
    ...ENV,
    leadId: LEAD_ID,
    replyJson: S("The agent's reply, as returned in response.content"),
    agent: S("Override the agent link name"),
  },
  execute: async (args) => {
    const p = parsePayload(args);
    const leadId = str(p, "leadId");
    const replyJson = p.replyJson;
    const agent = optStr(p, "agent");
    return handle(() =>
      withDetail(analyseLead({ leadId, replyJson, agent: agent ?? undefined }), leadId)
    );
  },
});

// --- conversion -------------------------------------------------------------

server.addHandler({
  name: "convert",
  description:
    "Qualified lead → Account + Contact + Deal, queueing the Facilio client and contact writes. Idempotent.",
  parameters: {
    ...ENV,
    leadId: LEAD_ID,
    dealTitle: S("Title for the deal"),
    estimatedValue: N("Deal value, defaults to the lead's"),
    salesOwnerEmail: S("Sales owner to hand the deal to"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const leadId = str(p, "leadId");
      return withDetail(
        convertLead({
          leadId,
          actor: optStr(p, "actorEmail"),
          dealTitle: optStr(p, "dealTitle"),
          estimatedValue: optNum(p, "estimatedValue"),
          salesOwnerEmail: optStr(p, "salesOwnerEmail"),
        }),
        leadId
      );
    }),
});

// --- accounts ---------------------------------------------------------------

const ACCOUNT_ID = S("Account id (uuid)");

server.addHandler({
  name: "account-list",
  description:
    "List accounts — the companies behind converted leads — with how many leads resolved to each and how many deals came out of them.",
  parameters: {
    ...ENV,
    search: S("Substring match on name, email or website domain"),
    syncStatus: S("Filter by Facilio sync state: pending or synced"),
    limit: N("Page size, default 50, max 200"),
    offset: N("Page offset"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return listAccounts({
        search: optStr(p, "search"),
        syncStatus: optStr(p, "syncStatus"),
        limit: readLimit(p),
        offset: readOffset(p),
      });
    }),
});

server.addHandler({
  name: "account-get",
  description:
    "One account with its contacts, its deals, and every lead that resolved to this company — repeat enquiries included.",
  parameters: { ...ENV, accountId: ACCOUNT_ID },
  execute: async (args) => handle(() => accountDetail(str(parsePayload(args), "accountId"))),
});

// --- outbox -----------------------------------------------------------------

server.addHandler({
  name: "sync-drain",
  description:
    "Process queued Facilio writes. A 'retry' outcome is normal — CMMS calls intermittently exceed the fetch timeout.",
  parameters: { ...ENV, batchSize: N("Tasks per pass, 1-25, default 5") },
  execute: async (args) => {
    const p = parsePayload(args);
    const batch = optNum(p, "batchSize") ?? 5;
    return handle(() => drain(batch));
  },
});

server.addHandler({
  name: "sync-status",
  description: "Outbox counts by status plus recent failures",
  parameters: {},
  execute: async () => handle(() => syncStatus()),
});

server.addHandler({
  name: "sync-retry",
  description: "Requeue a failed sync task",
  parameters: { ...ENV, taskId: S("Sync task id") },
  execute: async (args) => handle(() => retry(str(parsePayload(args), "taskId"))),
});

server.addHandler({
  name: "reference",
  description: "Allowed enum values, so callers never hardcode them",
  parameters: {},
  execute: async () =>
    handle(() => ({
      statuses: LEAD_STATUSES,
      dispositionReasons: DISPOSITION_REASONS,
      sources: LEAD_SOURCES,
      activityKinds: ["call", "email", "note", "attachment", "meeting"],
      assignmentRoles: ["actioner", "sales"],
    })),
});

// --- web chat intake --------------------------------------------------------
// The model call happens in the BROWSER (a function cannot wait for an LLM), so
// these handlers persist the exchange the client already had with the agent.

server.addHandler({
  name: "intake-start",
  description: "Begin a web-chat session. Returns an unguessable session token and the opening line.",
  parameters: {
    ...ENV,
    sourceUrl: S("Page the visitor started from"),
    userAgent: S("Visitor user agent"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return startSession({ sourceUrl: optStr(p, "sourceUrl"), userAgent: optStr(p, "userAgent") });
    }),
});

server.addHandler({
  name: "intake-turn",
  description:
    "Record one exchange and accumulate what the agent extracted. Pass the agent's reply as agentReply.",
  parameters: {
    ...ENV,
    sessionToken: S("Session token from intake-start"),
    message: S("What the visitor typed"),
    agentReply: S("The agent's reply, as returned in response.content"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return recordTurn({
        sessionToken: str(p, "sessionToken"),
        message: str(p, "message"),
        agentReply: p.agentReply,
      });
    }),
});

server.addHandler({
  name: "intake-transcript",
  description: "The conversation so far, plus what is still missing. Used to resume after a reload.",
  parameters: { ...ENV, sessionToken: S("Session token") },
  execute: async (args) => handle(() => transcript(str(parsePayload(args), "sessionToken"))),
});

server.addHandler({
  name: "intake-submit",
  description: "Turn the conversation into a lead. Idempotent — a session yields at most one lead.",
  parameters: { ...ENV, sessionToken: S("Session token") },
  execute: async (args) => handle(() => submitSession(str(parsePayload(args), "sessionToken"))),
});

server.execute();
