/**
 * The survey module's API — function `survey`, its own platform function
 * (ARCHITECTURE.md §9 rule 4: never widen an existing function for a
 * different module). Thin adapters only — read the input, call a module,
 * return `{ ok, data?, error? }`.
 *
 * THIS IS THE DESK SLICE of Backend Plan §7.2: create, list, get, schedule,
 * transition, plus the deal picker and reference enums. The walk
 * (`walk`/`capture`), assignment, nodes, reconciliation and submit are the
 * next slice — the frontend's surveys-util.ts documents which of its wrappers
 * are live and which still await handlers.
 */

import StudioFunctions from "@facilio/studio-functions";
import { SURVEY_STATUSES } from "../../domain/survey-state";
import { VISIT_STATUSES } from "../../domain/visit-state";
import {
  handle,
  limit as readLimit,
  offset as readOffset,
  optStr,
  parsePayload,
  str,
} from "../../shared/envelope";
import {
  createSurvey,
  listDeals,
  listSurveys,
  scheduleVisit,
  surveyDetail,
  transitionSurvey,
} from "../../modules/survey";

const S = (description: string) => ({ description, type: "string" as const });
const N = (description: string) => ({ description, type: "number" as const });

/** Every handler accepts the envelope as an alternative to flat fields. */
const ENV = { payload: S("Optional: the whole input as a JSON object string") };

const SURVEY_ID = S("Survey id (uuid)");
const ACTOR = S("Email of the user performing this action");

const server = new StudioFunctions({ name: "survey" });

server.addHandler({
  name: "create",
  description:
    "Raise a survey against a deal. Only dealId is mandatory; a template must be published; a scheduledStart also creates visit #1, moves the survey to scheduled and copies the template snapshot (T1+T2).",
  parameters: {
    ...ENV,
    dealId: S("Deal id — required"),
    templateId: S("Published form template to walk with"),
    title: S("Survey title, defaults to the template or deal title"),
    scheduledStart: S("ISO datetime of the first visit — omit to leave the survey in draft"),
    scheduledEnd: S("ISO datetime the first visit ends"),
    timezone: S("IANA timezone of the visit, e.g. Asia/Dubai"),
    targetCompletionDate: S("ISO date the survey should be done by"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return createSurvey({
        dealId: str(p, "dealId"),
        templateId: optStr(p, "templateId"),
        title: optStr(p, "title"),
        scheduledStart: optStr(p, "scheduledStart"),
        scheduledEnd: optStr(p, "scheduledEnd"),
        timezone: optStr(p, "timezone"),
        targetCompletionDate: optStr(p, "targetCompletionDate"),
        actor: optStr(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "list",
  description: "List surveys — one hardcoded default list; saved views are a platform item.",
  parameters: {
    ...ENV,
    status: S(`Filter by status: ${SURVEY_STATUSES.join(", ")}`),
    dealId: S("Filter by deal"),
    accountId: S("Filter by account"),
    leadUserEmail: S("Filter by survey lead"),
    search: S("Substring match on number, title or account name"),
    limit: N("Page size, default 50, max 200"),
    offset: N("Page offset"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return listSurveys({
        status: optStr(p, "status"),
        dealId: optStr(p, "dealId"),
        accountId: optStr(p, "accountId"),
        leadUserEmail: optStr(p, "leadUserEmail"),
        search: optStr(p, "search"),
        limit: readLimit(p),
        offset: readOffset(p),
      });
    }),
});

server.addHandler({
  name: "get",
  description:
    "One survey with visits, assignees, prospect nodes, reconciliation, qualifications and snapshot counts — one batched query.",
  parameters: { ...ENV, surveyId: SURVEY_ID },
  execute: async (args) => handle(() => surveyDetail(str(parsePayload(args), "surveyId"))),
});

server.addHandler({
  name: "schedule",
  description:
    "Schedule or reschedule a visit. On a draft survey this fires T2: status moves to scheduled and the template snapshot is copied (idempotently, every time).",
  parameters: {
    ...ENV,
    surveyId: SURVEY_ID,
    visitId: S("Existing visit to reschedule — omit to create the next visit"),
    scheduledStart: S("ISO datetime the visit starts — required"),
    scheduledEnd: S("ISO datetime the visit ends"),
    timezone: S("IANA timezone, e.g. Asia/Dubai"),
    siteContactName: S("Who meets the surveyor on site"),
    siteContactPhone: S("Site contact phone"),
    siteContactEmail: S("Site contact email"),
    meetingInstructions: S("Where and when to meet"),
    accessInstructions: S("Passes, PPE, escort rules"),
    slotSource: S("ours or tenderer_granted — a granted slot is recorded, never negotiated"),
    slotGrantedBy: S("Who granted the slot, when tenderer_granted"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return scheduleVisit(
        str(p, "surveyId"),
        {
          visitId: optStr(p, "visitId"),
          scheduledStart: str(p, "scheduledStart"),
          scheduledEnd: optStr(p, "scheduledEnd"),
          timezone: optStr(p, "timezone"),
          siteContactName: optStr(p, "siteContactName"),
          siteContactPhone: optStr(p, "siteContactPhone"),
          siteContactEmail: optStr(p, "siteContactEmail"),
          meetingInstructions: optStr(p, "meetingInstructions"),
          accessInstructions: optStr(p, "accessInstructions"),
          slotSource: optStr(p, "slotSource"),
          slotGrantedBy: optStr(p, "slotGrantedBy"),
        },
        optStr(p, "actorEmail")
      );
    }),
});

server.addHandler({
  name: "transition",
  description:
    "Change a survey's status through the state machine. Cancelling and rework need a reason; review moves are lead-only (the asserted actor must match the recorded lead).",
  parameters: {
    ...ENV,
    surveyId: SURVEY_ID,
    toStatus: S(`Target status: ${SURVEY_STATUSES.join(", ")}`),
    reason: S("Why — required when cancelling or bouncing back for rework"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return transitionSurvey({
        surveyId: str(p, "surveyId"),
        toStatus: str(p, "toStatus"),
        reason: optStr(p, "reason"),
        actor: optStr(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "deal-list",
  description:
    "Deals for the create-survey picker, with account names and how many surveys each already carries.",
  parameters: {},
  execute: async () => handle(() => listDeals()),
});

server.addHandler({
  name: "reference",
  description: "Allowed enum values, so callers never hardcode them",
  parameters: {},
  execute: async () =>
    handle(() => ({
      statuses: SURVEY_STATUSES,
      visitStatuses: VISIT_STATUSES,
      verdicts: ["unverified", "verified", "changed", "not_found", "added_on_site", "not_visited"],
      contractIntents: ["comprehensive", "semi_comprehensive", "non_comprehensive"],
      slotSources: ["ours", "tenderer_granted"],
    })),
});

server.execute();
