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
import {
  recordTurn,
  saveWidgetSettings,
  startSession,
  submitSession,
  transcript,
  widgetSettings,
} from "../../modules/intake";
import {
  accountDetail,
  createAccount,
  listAccounts,
  saveContact,
  updateAccount,
} from "../../modules/account";
import { convertLead } from "../../modules/convert";
import { drain, retry, syncStatus } from "../../modules/sync";
import {
  ANALYST_TASK_SETTING,
  configData,
  coverageView,
  DEFAULT_ANALYST_TASK,
  saveArea,
  saveCoverage,
  SCOPE_NOTES_SETTING,
  setSetting,
} from "../../modules/settings";
import { catalogueView, PRICING_BASES, saveService, UNITS_BY_BASIS } from "../../modules/service";
import { LEAD_STATUSES, DISPOSITION_REASONS } from "../../domain/lead-state";
import { buildBrief } from "../../modules/agent-brief";
import { agentsFor, receiveAssessment } from "../../modules/assessment";

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

      // Service lines travel with coverage so a seed can declare both in one
      // call. Editing the catalogue itself is `service-save` — this path only
      // ever names and switches, and never touches the catalogue fields.
      const lineIdsByCode = new Map<string, string>();
      for (const raw of optArray(p, "serviceLines") ?? []) {
        const l = raw as Record<string, unknown>;
        if (typeof l.code !== "string" || !l.code.trim())
          throw new Error("each service line needs a code");
        const saved = saveService({
          code: l.code.trim(),
          name: typeof l.name === "string" && l.name.trim() ? l.name.trim() : l.code.trim(),
          active: l.active !== false,
        });
        lineIdsByCode.set(saved.code, saved.id);
        created.serviceLines++;
      }

      // Coverage is expressed by human names so a caller never handles ids. One
      // batched read for both name lists — coverageView() would also compose the
      // scope brief, which re-reads every coverage row for nothing.
      const known = configData();
      const areaId = (name: string) =>
        areaIdsByName.get(name) ?? known.areas.find((a) => a.name === name)?.id;
      // Upper-cased on both sides: `saveService` normalises a code on the way
      // in, so a seed that spells its coverage in lower case must still find
      // the service it just created.
      const lineId = (code: string) => {
        const key = code.trim().toUpperCase();
        return lineIdsByCode.get(key) ?? known.serviceLines.find((l) => l.code === key)?.id;
      };

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

// --- the service catalogue --------------------------------------------------
// This app owns what it sells (2026-08-15). A service is created and retired
// here, and every priced row names one by `code`.

server.addHandler({
  name: "service-list",
  description:
    "The service catalogue with a usage count per service — how many active rate card rows and proposal lines name each one.",
  parameters: { ...ENV },
  execute: async () =>
    handle(() => ({
      ...catalogueView(),
      // The masters travel with the list so the browser never hard-codes a
      // second copy of them — the unit list depends on the basis, and two
      // copies drift into a unit the backend then refuses.
      pricingBases: PRICING_BASES,
      unitsByBasis: UNITS_BY_BASIS,
    })),
});

server.addHandler({
  name: "service-save",
  description:
    "Create or update one service. `code` is the natural key and is IMMUTABLE — saving an existing code updates it, and a new code creates a new service rather than renaming anything. Fields left out keep their stored value; send an empty string to clear description, basis or unit.",
  parameters: {
    ...ENV,
    code: S("Service code — letters, digits, _ and -, e.g. KEC. Upper-cased. Immutable"),
    name: S("What this service is called, e.g. Kitchen extract cleaning"),
    description: S("What the service covers, in words a proposal line can borrow"),
    defaultPricingBasis: S(`Prefills a rate card row: ${PRICING_BASES.join(" | ")}`),
    defaultUom: S("Prefills a rate card row's unit. Must belong to the basis"),
    active: S('"false" retires the service; "true" brings a retired one back'),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const code = str(p, "code");
      const name = str(p, "name");

      // `in` rather than optStr, so "" CLEARS a field instead of reading as
      // "leave it alone" — the same rule the prompt settings follow above.
      // Only the payload envelope can express that.
      const clearable = (key: string): string | null | undefined =>
        key in p ? (String(p[key] ?? "").trim() || null) : undefined;

      const saved = saveService({
        code,
        name,
        description: clearable("description"),
        defaultPricingBasis: clearable("defaultPricingBasis"),
        defaultUom: clearable("defaultUom"),
        // Unmentioned leaves it alone — see `saveService`.
        active: optBool(p, "active") ?? undefined,
      });

      // The whole catalogue back, so the page never follows a save with a read.
      return { ...saved, ...catalogueView() };
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
    estimatedValue: N("Estimated opportunity value (D-05: one number, typed by valueType)"),
    currency: S("Currency code, e.g. AED"),
    valueType: S("one_off | recurring | both — what kind of number estimatedValue is"),
    valueFrequency: S("monthly | quarterly | annual — required when the value recurs"),
    origin: S("D-10, where it came from: referral | existing_client | marketing | hubspot | cold_outreach | other"),
    accountId: S("Existing account this enquiry belongs to, when known. Convert honours it above its own domain/email guess."),
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
        valueType: optStr(p, "valueType"),
        valueFrequency: optStr(p, "valueFrequency"),
        origin: optStr(p, "origin"),
        accountId: optStr(p, "accountId"),
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
  "valueType",
  "valueFrequency",
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
    estimatedValue: N("Estimated opportunity value"),
    currency: S("Currency code"),
    valueType: S("one_off | recurring | both (D-05)"),
    valueFrequency: S("monthly | quarterly | annual — required when the value recurs"),
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
    overrideAssessment: S("'true' to convert past a not_relevant verdict (F-06) — recorded on the trail"),
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
          overrideAssessment: p.overrideAssessment === true || p.overrideAssessment === "true",
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

server.addHandler({
  name: "account-create",
  description:
    "F-18: add an account by hand — a client-to-be does not have to enquire first. Dedupes on domain, email and name, naming the existing record instead of creating a twin. No Facilio write: the client belongs to the deal's Won moment.",
  parameters: {
    ...ENV,
    name: S("Company name — required"),
    email: S("Company email"),
    phone: S("Company phone"),
    websiteDomain: S("Company website or domain"),
    street: S("Street address"),
    city: S("City"),
    state: S("Region or emirate"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return createAccount({
        name: str(p, "name"),
        email: optStr(p, "email"),
        phone: optStr(p, "phone"),
        websiteDomain: optStr(p, "websiteDomain"),
        address: {
          street: optStr(p, "street"),
          city: optStr(p, "city"),
          state: optStr(p, "state"),
        },
        actor: optStr(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "account-update",
  description:
    "F-19: edit an account's descriptive fields. LOCAL only — the connection has no update-client action, so a client already in Facilio is not changed by this.",
  parameters: {
    ...ENV,
    accountId: ACCOUNT_ID,
    name: S("Company name"),
    email: S("Company email"),
    phone: S("Company phone"),
    websiteDomain: S("Company website or domain"),
    street: S("Street address"),
    city: S("City"),
    state: S("Region or emirate"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const fields: Record<string, unknown> = {};
      for (const key of ["name", "email", "phone", "websiteDomain"]) {
        if (p[key] !== undefined) fields[key] = p[key];
      }
      if (p.street !== undefined || p.city !== undefined || p.state !== undefined) {
        fields.address = {
          street: optStr(p, "street"),
          city: optStr(p, "city"),
          state: optStr(p, "state"),
        };
      }
      return updateAccount(str(p, "accountId"), fields, optStr(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "account-contact-save",
  description:
    "D-37: add or edit a contact on an account. One primary per account, enforced in the write. A NEW contact with an email is queued for Facilio through the outbox; the drain defers it until the client itself has synced.",
  parameters: {
    ...ENV,
    accountId: ACCOUNT_ID,
    contactId: S("Contact id — omit to create"),
    name: S("Contact name — required"),
    email: S("Contact email"),
    phone: S("Contact phone"),
    isPrimary: S("'true' to make this the primary contact"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return saveContact(
        str(p, "accountId"),
        {
          id: optStr(p, "contactId"),
          name: str(p, "name"),
          email: optStr(p, "email"),
          phone: optStr(p, "phone"),
          isPrimary: p.isPrimary === true || p.isPrimary === "true",
        },
        optStr(p, "actorEmail")
      );
    }),
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

// The widget's presentation, published from the console and read by every
// surface that renders the widget — the playground today, the embed later.
// No secrets in it: the whole config ships to the visitor's browser.

server.addHandler({
  name: "widget-get",
  description: "The web widget's published presentation config and per-turn agent guidance",
  parameters: {},
  execute: async () => handle(() => ({ config: widgetSettings() })),
});

server.addHandler({
  name: "widget-put",
  description:
    "Publish the web widget's presentation. Partial — a sent field is saved, an empty one clears, an absent one keeps its stored value.",
  parameters: {
    ...ENV,
    companyName: S("Name shown in the widget header"),
    tagline: S("The line under the company name"),
    accent: S("Hex bubble/button colour like #2563eb; empty follows the theme"),
    greeting: S("First agent message; empty uses the shipped greeting"),
    guidance: S("Operator instructions the intake agent follows on every turn"),
    logo: S("Small data:image/… URL; empty shows the company initial"),
  },
  // The logo travels inside `payload` in practice: a flat connection-action
  // field can carry it too, but the console always sends the envelope so ""
  // can clear (flat blanks are dropped upstream as unresolved templates).
  execute: async (args) => handle(() => ({ config: saveWidgetSettings(parsePayload(args)) })),
});

// --- AI ---------------------------------------------------------------------

/**
 * Two handlers, one round trip apart, because a platform function CANNOT make
 * the model call: it aborts at the ~10s fetch timeout. The server builds the
 * prompt, the BROWSER calls `vibe.executeAgent`, the server stores the reply —
 * the same pair the lead analyst has used since it shipped.
 *
 * Advisory only. Nothing here changes a status, a stage or a price.
 */
server.addHandler({
  name: "assess-input",
  description:
    "The exact labelled-block prompt to send an agent for this lead, plus its logical name. " +
    "lead-intelligence is a SECOND read beside the analyst's score, never instead of it: service and region fit, completeness, red flags, duplicates and the next action. It never writes the lead. " +
    "The caller makes the model call — a function cannot wait for one.",
  parameters: {
    ...ENV,
    leadId: LEAD_ID,
    agent: S(`Which agent: ${agentsFor("lead").join(" | ")}`),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return buildBrief(str(p, "agent"), str(p, "leadId"));
    }),
});

server.addHandler({
  name: "assess-store",
  description:
    "Store an agent's verdict on this lead as a new version, and return the refreshed record.",
  parameters: {
    ...ENV,
    leadId: LEAD_ID,
    agent: S("The agent whose reply this is"),
    replyJson: S("The agent's reply, as returned in response.content"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const leadId = str(p, "leadId");
      const stored = receiveAssessment({
        agent: str(p, "agent"),
        entityId: leadId,
        reply: p.replyJson,
        actor: optStr(p, "actorEmail"),
      });
      return { stored, detail: leadDetail(leadId) };
    }),
});

server.execute();
