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
  optArray,
  optNum,
  optStr,
  parsePayload,
  str,
} from "../../shared/envelope";
import { getSetting, setSetting } from "../../modules/settings";
import {
  assignSurveyors,
  createSurvey,
  listDeals,
  listSurveys,
  scheduleVisit,
  setLead,
  surveyDetail,
  transitionSurvey,
  transitionVisit,
  type AssigneeInput,
} from "../../modules/survey";
import {
  attachPhoto,
  captureBatch,
  walkState,
  type CaptureAnswer,
  type CaptureEntry,
  type CaptureObservation,
  type CapturePhoto,
} from "../../modules/walk";

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
  name: "visit-transition",
  description:
    "Move a visit through its lifecycle: planned → in_progress → done, or no_show / cancelled with a reason. A no-show NEVER advances the survey — only a real capture does.",
  parameters: {
    ...ENV,
    visitId: S("Visit id"),
    toStatus: S(`Target status: ${VISIT_STATUSES.join(", ")}`),
    reason: S("Why — required for no_show and cancelled"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return transitionVisit({
        visitId: str(p, "visitId"),
        toStatus: str(p, "toStatus"),
        reason: optStr(p, "reason"),
        actor: optStr(p, "actorEmail"),
      });
    }),
});

/** The survey settings the UI reads and edits — a subset with real consequences. */
const SURVEY_SETTINGS_VIEW = () => ({
  conditionScaleDirection: getSetting("survey.condition_scale_direction", "1_is_worst"),
  conditionScaleLabels: getSetting<Record<string, string>>("survey.condition_scale_labels", {}),
  requirePhotoBelowCondition: getSetting("survey.require_photo_below_condition", 2),
  geotagCapture: getSetting("survey.geotag_capture", "best_effort"),
  notVisitedWarnThresholdPct: getSetting("survey.not_visited_warn_threshold_pct", 20),
});

server.addHandler({
  name: "settings-get",
  description:
    "The survey module's settings: condition scale direction and labels, the photo-below-condition threshold, geotag capture mode.",
  parameters: {},
  execute: async () => handle(() => SURVEY_SETTINGS_VIEW()),
});

server.addHandler({
  name: "settings-put",
  description:
    "Update survey settings. conditionScaleDirection is decision D-e and FEEDS PRICING — two teams reading the scale opposite ways is real money, so change it deliberately.",
  parameters: {
    ...ENV,
    conditionScaleDirection: S("1_is_worst (5 = excellent, the FM convention) or 5_is_worst (5 = filthy, the buildup convention)"),
    requirePhotoBelowCondition: N("A condition at or below this needs a photo; 0 disables the rule"),
    geotagCapture: S("off or best_effort — never required, never background tracking"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const applied: string[] = [];

      const direction = optStr(p, "conditionScaleDirection");
      if (direction) {
        if (direction !== "1_is_worst" && direction !== "5_is_worst") {
          throw new Error("conditionScaleDirection must be 1_is_worst or 5_is_worst");
        }
        setSetting("survey.condition_scale_direction", direction);
        applied.push("conditionScaleDirection");
      }

      const threshold = optNum(p, "requirePhotoBelowCondition");
      if (threshold !== null) {
        if (threshold < 0 || threshold > 5) {
          throw new Error("requirePhotoBelowCondition is a 0–5 value (0 disables the rule)");
        }
        setSetting("survey.require_photo_below_condition", Math.round(threshold));
        applied.push("requirePhotoBelowCondition");
      }

      const geotag = optStr(p, "geotagCapture");
      if (geotag) {
        if (geotag !== "off" && geotag !== "best_effort") {
          throw new Error("geotagCapture must be off or best_effort");
        }
        setSetting("survey.geotag_capture", geotag);
        applied.push("geotagCapture");
      }

      if (!applied.length) throw new Error("no settings supplied");
      return { applied, settings: SURVEY_SETTINGS_VIEW() };
    }),
});

server.addHandler({
  name: "assign",
  description:
    "Assign surveyors — multi-select, one idempotent multi-row insert. Pass assignees[] (userEmail, participation, disciplineIds) inside payload. Never sets the lead; use set-lead.",
  parameters: { ...ENV, surveyId: SURVEY_ID, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const raw = optArray(p, "assignees") ?? [];
      const assignees: AssigneeInput[] = raw.map((r) => {
        const a = (r ?? {}) as Record<string, unknown>;
        return {
          userEmail: typeof a.userEmail === "string" ? a.userEmail : "",
          participation: typeof a.participation === "string" ? a.participation : null,
          disciplineIds: Array.isArray(a.disciplineIds) ? a.disciplineIds.map(String) : [],
        };
      });
      return assignSurveyors(str(p, "surveyId"), assignees, optStr(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "set-lead",
  description:
    "Make one assignee the lead — a single-statement update of fl_survey.lead_assignee_id, so two clicks cannot produce two leads. Setting the first lead fires T3 (scheduled → assigned).",
  parameters: {
    ...ENV,
    surveyId: SURVEY_ID,
    assigneeId: S("Assignee id from assign / get"),
    reason: S("Why the lead is changing hands"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return setLead(
        str(p, "surveyId"),
        str(p, "assigneeId"),
        optStr(p, "reason"),
        optStr(p, "actorEmail")
      );
    }),
});

server.addHandler({
  name: "walk",
  description:
    "The surveyor's whole screen in one batched read: survey, visit, section and question instances, entries, answers, observations, photos.",
  parameters: {
    ...ENV,
    surveyId: SURVEY_ID,
    visitId: S("Specific visit — defaults to the in-progress or next planned one"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return walkState(str(p, "surveyId"), optStr(p, "visitId"));
    }),
});

server.addHandler({
  name: "capture",
  description:
    "THE batch write: entries[], answers[], observations[] and photos[] in one payload, one round trip per room. Ids are client-supplied so a retry completes a half-landed payload instead of duplicating it. First capture moves the visit, then the survey, to in_progress (T4). A condition at or below the configured threshold must carry a photo. Returns the refreshed walk state.",
  parameters: {
    ...ENV,
    surveyId: SURVEY_ID,
    visitId: S("The visit being walked — required"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return captureBatch({
        surveyId: str(p, "surveyId"),
        visitId: str(p, "visitId"),
        entries: (optArray(p, "entries") ?? []) as unknown as CaptureEntry[],
        answers: (optArray(p, "answers") ?? []) as unknown as CaptureAnswer[],
        observations: (optArray(p, "observations") ?? []) as unknown as CaptureObservation[],
        photos: (optArray(p, "photos") ?? []) as unknown as CapturePhoto[],
        actor: optStr(p, "actorEmail"),
      });
    }),
});

server.addHandler({
  name: "attach",
  description:
    "One photo outside a capture batch. Upload the file to the Vibe file store first; this records the fl_photo row with the device's capturedAt AND the server's uploadedAt (device clocks lie), plus the geotag.",
  parameters: {
    ...ENV,
    surveyId: SURVEY_ID,
    entityType: S("What it evidences: survey, survey_visit, section_entry, answer, observation, prospect_node"),
    entityId: S("Id of that entity"),
    vibeFileId: N("File store id from uploadFile"),
    fileName: S("Original file name"),
    contentType: S("MIME type, e.g. image/jpeg"),
    sizeBytes: N("File size in bytes"),
    caption: S("What the photo shows"),
    kind: S("photo, document or audio_note — defaults to photo"),
    capturedAt: S("ISO datetime from the device"),
    geoLat: N("Latitude at capture"),
    geoLng: N("Longitude at capture"),
    geoAccuracyM: N("GPS accuracy in metres"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const vibeFileId = optNum(p, "vibeFileId");
      if (vibeFileId === null) throw new Error("vibeFileId is required");
      return attachPhoto(
        str(p, "surveyId"),
        {
          entityType: str(p, "entityType"),
          entityId: str(p, "entityId"),
          vibeFileId,
          fileName: optStr(p, "fileName"),
          contentType: optStr(p, "contentType"),
          sizeBytes: optNum(p, "sizeBytes"),
          caption: optStr(p, "caption"),
          kind: optStr(p, "kind"),
          capturedAt: optStr(p, "capturedAt"),
          geoLat: optNum(p, "geoLat"),
          geoLng: optNum(p, "geoLng"),
          geoAccuracyM: optNum(p, "geoAccuracyM"),
        },
        optStr(p, "actorEmail")
      );
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
