/**
 * The Deal module's API. Thin adapters only — read the input, call a module,
 * return `{ ok, data?, error? }`. All logic lives in src/modules/deal.ts and
 * src/domain/deal-state.ts.
 *
 * Deals are never CREATED here: `lead.convert` is the only place an fl_deal row
 * is born, so a deal always has a lead, an account and a timeline behind it.
 *
 * Parameter conventions follow the lead function: every scalar declared flat
 * (the platform silently drops undeclared args, and connection actions can only
 * send flat fields), with the `payload` envelope for nested input.
 */

import StudioFunctions from "@facilio/studio-functions";
import {
  handle,
  limit as readLimit,
  offset as readOffset,
  oneOf,
  optBool,
  optNum,
  optStr,
  parsePayload,
  str,
} from "../../shared/envelope";
import {
  CAPTURE_SECTIONS,
  captureDeal,
  type DealDetail,
  dealDetail,
  listDeals,
  pipelineSummary,
  reopenDeal,
  transitionDeal,
  updateDeal,
} from "../../modules/deal";
import {
  ACTIVE_STAGES,
  allowedNext,
  DEAL_STAGES,
  LOST_REASONS,
  STAGE_LABEL,
} from "../../domain/deal-state";
import { buildBrief } from "../../modules/agent-brief";
import { agentsFor, receiveAssessment } from "../../modules/assessment";

const S = (description: string) => ({ description, type: "string" as const });
const N = (description: string) => ({ description, type: "number" as const });

/** Every handler accepts the envelope as an alternative to flat fields. */
const ENV = { payload: S("Optional: the whole input as a JSON object string") };

const DEAL_ID = S("Deal id (uuid)");
const ACTOR = S("Email of the user performing this action");

const server = new StudioFunctions({ name: "deal" });

/**
 * A mutation's response with the whole refreshed deal view attached — one extra
 * batched query (~194ms) instead of the client's second round trip (~1.1s).
 * Same trade as the lead function's withDetail.
 */
const withDetail = <T extends object>(result: T, dealId: string): T & { detail: DealDetail } => ({
  ...result,
  detail: dealDetail(dealId),
});

// --- read -------------------------------------------------------------------

server.addHandler({
  name: "list",
  description:
    "List deals with account name and lead ref. Filter by stage, owner, account or search; openOnly excludes won/lost.",
  parameters: {
    ...ENV,
    stage: S(`Filter by stage: ${DEAL_STAGES.join(", ")}`),
    salesOwnerEmail: S("Filter by sales owner"),
    accountId: S("Filter by account"),
    openOnly: S("true to exclude won and lost deals"),
    search: S("Substring match on title, ref number or account name"),
    limit: N("Page size, default 50, max 200"),
    offset: N("Page offset"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return listDeals({
        stage: optStr(p, "stage"),
        salesOwnerEmail: optStr(p, "salesOwnerEmail"),
        accountId: optStr(p, "accountId"),
        openOnly: optBool(p, "openOnly") ?? false,
        search: optStr(p, "search"),
        limit: readLimit(p),
        offset: readOffset(p),
      });
    }),
});

server.addHandler({
  name: "get",
  description:
    "One deal with its account, contact, originating lead, surveys, proposals, timeline and the stages it may move to next",
  parameters: { ...ENV, dealId: DEAL_ID },
  execute: async (args) => handle(() => dealDetail(str(parsePayload(args), "dealId"))),
});

server.addHandler({
  name: "pipeline",
  description: "Deal counts and total estimated value per stage — the pipeline header in one call",
  parameters: {},
  execute: async () => handle(() => ({ stages: pipelineSummary() })),
});

// --- mutate -----------------------------------------------------------------

server.addHandler({
  name: "update",
  description: "Edit descriptive fields. Stage is rejected here — use transition.",
  parameters: {
    ...ENV,
    dealId: DEAL_ID,
    actorEmail: ACTOR,
    title: S("Deal title"),
    estimatedValue: N("Estimated contract value"),
    currency: S("Currency code, e.g. AED"),
    salesOwnerEmail: S("Sales owner the deal belongs to"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);

      const nested = p.fields as Record<string, unknown> | undefined;
      const fields: Record<string, unknown> = nested && typeof nested === "object" ? { ...nested } : {};
      for (const key of ["title", "estimatedValue", "currency", "salesOwnerEmail"]) {
        if (p[key] !== undefined) fields[key] = p[key];
      }

      const dealId = str(p, "dealId");
      return withDetail(updateDeal(dealId, fields, optStr(p, "actorEmail")), dealId);
    }),
});

server.addHandler({
  name: "capture",
  description:
    "Merge per-stage tracking into the deal's capture sheet — discovery requirements, negotiation intel, decision status, won/lost detail. Values go in the payload envelope as `values`; a null value clears a field.",
  parameters: {
    ...ENV,
    dealId: DEAL_ID,
    section: S(`Which sheet: ${CAPTURE_SECTIONS.join(", ")}`),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const dealId = str(p, "dealId");
      const values = p.values as Record<string, unknown> | undefined;
      if (!values || typeof values !== "object") {
        throw new Error("values is required — pass the fields to capture inside the payload envelope");
      }
      return withDetail(
        captureDeal({
          dealId,
          section: oneOf(p, "section", CAPTURE_SECTIONS),
          values,
          actor: optStr(p, "actorEmail"),
        }),
        dealId
      );
    }),
});

server.addHandler({
  name: "transition",
  description:
    "Change a deal's stage — the only path that does. Skips forward freely, moves backward only within proposal/negotiation/decision, requires a lost reason to lose, and only wins after a proposal was submitted. Won/lost detail may travel as `capture` in the payload.",
  parameters: {
    ...ENV,
    dealId: DEAL_ID,
    toStage: S(`Target stage: ${DEAL_STAGES.join(", ")}`),
    lostReason: S(`Required when losing: ${LOST_REASONS.join(", ")}`),
    note: S("Free-text note for the timeline"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const dealId = str(p, "dealId");
      const capture = p.capture as Record<string, unknown> | undefined;
      return withDetail(
        transitionDeal({
          dealId,
          toStage: str(p, "toStage"),
          lostReason: optStr(p, "lostReason"),
          capture: capture && typeof capture === "object" ? capture : null,
          note: optStr(p, "note"),
          actor: optStr(p, "actorEmail"),
        }),
        dealId
      );
    }),
});

server.addHandler({
  name: "reopen",
  description:
    "Reopen a won or lost deal back to the stage it closed from. Records who did it; lost analysis is kept in the deal's history.",
  parameters: { ...ENV, dealId: DEAL_ID, actorEmail: ACTOR, note: S("Why it is being reopened") },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const dealId = str(p, "dealId");
      return withDetail(
        reopenDeal({ dealId, actor: str(p, "actorEmail"), note: optStr(p, "note") }),
        dealId
      );
    }),
});

// --- reference ----------------------------------------------------------------

server.addHandler({
  name: "reference",
  description: "Allowed enum values and the stage machine, so callers never hardcode them",
  parameters: {},
  execute: async () =>
    handle(() => ({
      stages: DEAL_STAGES,
      activeStages: ACTIVE_STAGES,
      stageLabels: STAGE_LABEL,
      lostReasons: LOST_REASONS,
      captureSections: CAPTURE_SECTIONS,
      transitions: Object.fromEntries(DEAL_STAGES.map((s) => [s, allowedNext(s)])),
    })),
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
    "The exact labelled-block prompt to send an agent for this deal, plus its logical name. " +
    "lost-deal-intelligence reads a LOST deal's capture sheet, its proposal history and other lost deals for patterns. It refuses a deal that is not lost. " +
    "The caller makes the model call — a function cannot wait for one.",
  parameters: {
    ...ENV,
    dealId: DEAL_ID,
    agent: S(`Which agent: ${agentsFor("deal").join(" | ")}`),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return buildBrief(str(p, "agent"), str(p, "dealId"));
    }),
});

server.addHandler({
  name: "assess-store",
  description:
    "Store an agent's verdict on this deal as a new version, and return the refreshed record.",
  parameters: {
    ...ENV,
    dealId: DEAL_ID,
    agent: S("The agent whose reply this is"),
    replyJson: S("The agent's reply, as returned in response.content"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const dealId = str(p, "dealId");
      const stored = receiveAssessment({
        agent: str(p, "agent"),
        entityId: dealId,
        reply: p.replyJson,
        actor: optStr(p, "actorEmail"),
      });
      return { stored, detail: dealDetail(dealId) };
    }),
});

server.execute();
