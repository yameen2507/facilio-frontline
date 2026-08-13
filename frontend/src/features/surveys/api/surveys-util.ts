/**
 * The survey data layer.
 *
 * ⚠ EVERY FUNCTION IN THIS FILE IS A [SEAM]. The `survey` platform function does
 * not exist yet — `src/functions/survey/` holds a `.gitkeep` and nothing else.
 * These are written against the frozen contract (Survey Backend Plan v1 §7) so
 * that when the handlers land, no page changes. On failure each returns
 * `{ data: null, error }` like every other call in this app, and the page
 * renders that error verbatim.
 *
 * THE FILE SHIPS COMPLETE AND UNCALLED. Pages do not invoke these yet: a page
 * that fires a request at a function which does not exist shows an error state
 * on every load, which reads as a broken product rather than an unbuilt one.
 * They render their real empty state instead, and grow the effect plus its
 * loading and error states together when the backend arrives.
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
  ReconciliationItem,
  Survey,
  SurveyDetailResponse,
  SurveyListResponse,
  Visit,
} from "../types/survey";

/** Its own platform function — never widen `lead` for a different module. */
const FN = "survey";

export const LIST_LIMIT = 100;

const call = <T>(handler: string, args: Record<string, unknown> = {}): Promise<Result<T>> =>
  requestFrom<T>(FN, handler, args);

/** Arrays and objects cannot be flat fields — they ride in `payload`. */
const payload = (body: Record<string, unknown>) => ({ payload: JSON.stringify(body) });

// ── Reads ────────────────────────────────────────────────────────────────────

/** [SEAM] `survey.list` — one hardcoded default list; saved views are a platform item. */
export const listSurveys = (status: string, search: string) =>
  call<SurveyListResponse>("list", {
    limit: LIST_LIMIT,
    // Sent only when non-empty: a blank flat field is dropped upstream as an
    // unresolved connection-action template rather than arriving as "".
    ...(status && status !== "all" ? { status } : {}),
    ...(search ? { search } : {}),
  });

/** [SEAM] `survey.get` — survey + visits + assignees + nodes + reconciliation in ONE query. */
export const getSurvey = (surveyId: string) => call<SurveyDetailResponse>("get", { surveyId });

/** [SEAM] `survey.walk` — the surveyor's whole screen in one batched read. */
export const getWalk = (surveyId: string, visitId?: string) =>
  call<unknown>("walk", { surveyId, ...(visitId ? { visitId } : {}) });

// ── Desk mutations ───────────────────────────────────────────────────────────

/** [SEAM] `survey.create` — asks three things; only `dealId` is mandatory. */
export const createSurvey = (
  dealId: string,
  actorEmail: string,
  opts: { scheduledStart?: string; scheduledEnd?: string; templateId?: string } = {}
) => call<{ survey: Survey }>("create", { dealId, actorEmail, ...opts });

/** [SEAM] `survey.update` — status is rejected here; use `transition`. */
export const updateSurvey = (surveyId: string, fields: Record<string, string>) =>
  call<{ survey: Survey }>("update", { surveyId, ...fields });

/**
 * [SEAM] `survey.transition` — guards live server-side in `domain/survey-state.ts`,
 * not in this client. Cancelling and rework both require a reason; T5/T6/T7 are
 * lead-only. The UI disables what it can, but the function is the authority.
 */
export const transitionSurvey = (
  surveyId: string,
  toStatus: string,
  reason: string,
  actorEmail: string
) => call<{ survey: Survey }>("transition", { surveyId, toStatus, reason, actorEmail });

/** [SEAM] `survey.schedule` — schedule AND reschedule; always re-runs conflict-warn. */
export const scheduleVisit = (surveyId: string, body: Record<string, unknown>) =>
  call<{ visit: Visit }>("schedule", { surveyId, ...payload(body) });

/** [SEAM] `survey.visit-transition` — `no_show` and `cancelled` require a reason. */
export const transitionVisit = (visitId: string, toStatus: string, reason: string) =>
  call<{ visit: Visit }>("visit-transition", { visitId, toStatus, reason });

/** [SEAM] `survey.assign` — multi-select, one multi-row insert. */
export const assignSurveyors = (
  surveyId: string,
  assignees: { userEmail: string; participation: string }[]
) => call<{ assignees: unknown[] }>("assign", { surveyId, ...payload({ assignees }) });

/** [SEAM] `survey.set-lead` — exactly one lead; this is the whole T3 guard. */
export const setLead = (surveyId: string, assigneeId: string, reason: string) =>
  call<{ survey: Survey }>("set-lead", { surveyId, assigneeId, reason });

// ── The walk ─────────────────────────────────────────────────────────────────

/**
 * [SEAM] `survey.capture` — THE BATCH WRITE, and the shape matters more than any
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
    verdicts?: unknown[];
  }
) => call<unknown>("capture", { surveyId, visitId, actorEmail, ...payload(body) });

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
