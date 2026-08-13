/**
 * The survey data layer.
 *
 * LIVE: the desk slice (`create`, `list`, `get`, `schedule`, `transition`,
 * `deal-list`, `reference` — built 2026-08-13) and the WALK slice (`assign`,
 * `set-lead`, `walk`, `capture`, `attach` — built 2026-08-14, photos included).
 * The wrappers still marked [SEAM] below — update, visit-transition,
 * node-verdict, reconciliation and submit — await the review slice and stay
 * uncalled; their surfaces keep real empty states rather than firing at
 * missing handlers. On failure every call returns `{ data: null, error }` like
 * the rest of the app, and the page renders that error verbatim.
 *
 * | handler            | args                                            | returns                          |
 * | ------------------ | ----------------------------------------------- | -------------------------------- |
 * | `list`             | status, dealId, leadUserEmail, search, limit    | `{ surveys[], total, truncated }` |
 * | `get`              | surveyId                                        | full detail, one batched query   |
 * | `create`           | dealId, scheduledStart?, templateId?, actorEmail| `{ survey }`                     |
 * | `update`           | surveyId, title, targetCompletionDate, notes    | `{ survey }`                     |
 * | `transition`       | surveyId, toStatus, reason, actorEmail          | `{ survey }`                     |
 * | `schedule`         | surveyId, visitId?, scheduledStart, ...         | `{ visit }`                      |
 * | `visit-transition` | visitId, toStatus, reason                       | `{ visit }`                      |
 * | `assign`           | surveyId, payload:{assignees[]}                 | `{ assignees[] }`                |
 * | `set-lead`         | surveyId, assigneeId, reason                    | `{ survey }`                     |
 * | `walk`             | surveyId, visitId?                              | the whole walk state             |
 * | `capture`          | payload:{entries[],answers[],observations[]...} | refreshed walk state             |
 * | `node-verdict`     | nodeId, verdict, verdictNote, visitId           | `{ node }`                       |
 * | `reconcile`        | surveyId                                        | `{ items[] }`                    |
 * | `reconcile-decide` | itemId, decision, manualValue, actorEmail       | `{ item }`                       |
 * | `submit`           | surveyId, actorEmail                            | `{ survey, checksum }`           |
 *
 * Complex input travels inside `payload` as a JSON string: handler parameters
 * may only be `string` or `number`, so arrays cannot be sent as flat fields.
 */

import { requestFrom, type Result } from "../../../lib/request";
import type {
  Assignee,
  ReconciliationItem,
  Survey,
  SurveyDetailResponse,
  SurveyListResponse,
  Visit,
  WalkPhoto,
  WalkState,
} from "../types/survey";

/** Its own platform function — never widen `lead` for a different module. */
const FN = "survey";

export const LIST_LIMIT = 100;

const call = <T>(handler: string, args: Record<string, unknown> = {}): Promise<Result<T>> =>
  requestFrom<T>(FN, handler, args);

/** Arrays and objects cannot be flat fields — they ride in `payload`. */
const payload = (body: Record<string, unknown>) => ({ payload: JSON.stringify(body) });

// ── Reads ────────────────────────────────────────────────────────────────────

/** `survey.list` — one hardcoded default list; saved views are a platform item. */
export const listSurveys = (status: string, search: string) =>
  call<SurveyListResponse>("list", {
    limit: LIST_LIMIT,
    // Sent only when non-empty: a blank flat field is dropped upstream as an
    // unresolved connection-action template rather than arriving as "".
    ...(status && status !== "all" ? { status } : {}),
    ...(search ? { search } : {}),
  });

/** `survey.get` — survey + visits + assignees + nodes + reconciliation in ONE query. */
export const getSurvey = (surveyId: string) => call<SurveyDetailResponse>("get", { surveyId });

/** `survey.walk` — the surveyor's whole screen in one batched read. */
export const getWalk = (surveyId: string, visitId?: string) =>
  call<WalkState>("walk", { surveyId, ...(visitId ? { visitId } : {}) });

// ── Desk mutations ───────────────────────────────────────────────────────────

/** `survey.create` — asks three things; only `dealId` is mandatory. */
export const createSurvey = (
  dealId: string,
  actorEmail: string,
  opts: {
    scheduledStart?: string;
    scheduledEnd?: string;
    templateId?: string;
    title?: string;
    timezone?: string;
    targetCompletionDate?: string;
  } = {}
) => call<{ survey: Survey }>("create", { dealId, actorEmail, ...opts });

/** A deal as the create-survey picker needs it. */
export type DealOption = {
  id: string;
  refNo: string;
  title: string | null;
  stage: string;
  accountName: string | null;
  estimatedValue: number | null;
  currency: string | null;
  surveyCount: number;
};

/** `survey.deal-list` — a survey is raised AGAINST a deal, so the picker needs them. */
export const listDeals = () => call<{ deals: DealOption[] }>("deal-list");

/** A published template as the picker needs it. */
export type TemplateOption = {
  id: string;
  name: string;
  versionNo: number;
  sectionCount?: number;
  questionCount?: number;
};

/**
 * `form.template-list` filtered to published — the picker's other half. Calls
 * the `form` function directly rather than importing the templates feature's
 * api-util: features do not import each other's internals, and this thin
 * duplicate is the cheapest honest boundary.
 */
export const listPublishedTemplates = () =>
  requestFrom<{ templates: TemplateOption[] }>("form", "template-list", {
    status: "published",
    limit: 100,
  });

/** [SEAM] `survey.update` — status is rejected here; use `transition`. */
export const updateSurvey = (surveyId: string, fields: Record<string, string>) =>
  call<{ survey: Survey }>("update", { surveyId, ...fields });

/**
 * `survey.transition` — guards live server-side in `domain/survey-state.ts`,
 * not in this client. Cancelling and rework both require a reason; T5/T6/T7 are
 * lead-only. The UI disables what it can, but the function is the authority.
 */
export const transitionSurvey = (
  surveyId: string,
  toStatus: string,
  reason: string,
  actorEmail: string
) => call<{ survey: Survey }>("transition", { surveyId, toStatus, reason, actorEmail });

/** `survey.schedule` — schedule AND reschedule; always re-runs conflict-warn. */
export const scheduleVisit = (surveyId: string, body: Record<string, unknown>) =>
  call<{ visit: Visit }>("schedule", { surveyId, ...payload(body) });

/** `survey.visit-transition` — no_show/cancelled need a reason; a no-show NEVER advances the survey. */
export const transitionVisit = (visitId: string, toStatus: string, reason: string, actorEmail: string) =>
  call<{ visit: Visit }>("visit-transition", { visitId, toStatus, reason, actorEmail });

/** `survey.assign` — multi-select, one idempotent multi-row insert. */
export const assignSurveyors = (
  surveyId: string,
  assignees: { userEmail: string; participation: string }[],
  actorEmail: string
) => call<{ assignees: Assignee[] }>("assign", { surveyId, actorEmail, ...payload({ assignees }) });

/** `survey.set-lead` — exactly one lead; setting the first fires T3. */
export const setLead = (surveyId: string, assigneeId: string, reason: string, actorEmail: string) =>
  call<{ survey: Survey }>("set-lead", { surveyId, assigneeId, reason, actorEmail });

// ── The walk ─────────────────────────────────────────────────────────────────

/**
 * `survey.capture` — THE BATCH WRITE, and the shape matters more than any
 * other call in this module. A room is ~5 answers plus a condition score plus
 * photos; sent one at a time that is ~1.1s each and the surveyor abandons the
 * tool on the second floor. One room, one round trip.
 */
export const capture = (
  surveyId: string,
  visitId: string,
  actorEmail: string,
  body: {
    entries?: unknown[];
    answers?: unknown[];
    observations?: unknown[];
    photos?: unknown[];
  }
) =>
  call<WalkState & { written: Record<string, number> }>("capture", {
    surveyId,
    visitId,
    actorEmail,
    ...payload(body),
  });

/**
 * `survey.attach` — one photo outside a capture batch. Upload the bytes with
 * `vibe.uploadFile` FIRST; this records the evidence row (device capturedAt,
 * server uploadedAt, geotag).
 */
export const attachPhoto = (
  surveyId: string,
  photo: Record<string, unknown>,
  actorEmail: string
) => call<{ photo: WalkPhoto }>("attach", { surveyId, actorEmail, ...payload(photo) });

/** [SEAM] `survey.node-verdict` — a note is mandatory for not_found / not_visited / changed. */
export const setNodeVerdict = (
  nodeId: string,
  verdict: string,
  verdictNote: string,
  visitId: string
) => call<unknown>("node-verdict", { nodeId, verdict, verdictNote, visitId });

// ── Review and handoff ───────────────────────────────────────────────────────

/** [SEAM] `survey.reconcile` — deterministic diff; suggests, never decides. */
export const runReconcile = (surveyId: string) =>
  call<{ items: ReconciliationItem[] }>("reconcile", { surveyId });

/** [SEAM] `survey.reconcile-decide` — lead only. Every row is closed by a person. */
export const decideReconcileItem = (
  itemId: string,
  decision: string,
  manualValue: string,
  decisionNote: string,
  actorEmail: string
) =>
  call<{ item: ReconciliationItem }>("reconcile-decide", {
    itemId,
    decision,
    manualValue,
    decisionNote,
    actorEmail,
  });

/** [SEAM] `survey.submit` — T7. Freezes the revision and notifies the deal owner. */
export const submitSurvey = (surveyId: string, actorEmail: string) =>
  call<{ survey: Survey; checksum: string }>("submit", { surveyId, actorEmail });
