/**
 * The survey data layer.
 *
 * LIVE: the desk slice (`create`, `list`, `get`, `schedule`, `transition`,
 * `deal-list`, `reference` — built 2026-08-13), the WALK slice (`assign`,
 * `set-lead`, `walk`, `capture`, `attach` — built 2026-08-14, photos included)
 * the COMPLETION slice (2026-08-14): `get` now carries `readiness` and
 * `transition` enforces the T5/T7 count guards, which is what makes Send for
 * review, Send back for rework and Complete real rather than decorative; and
 * the CLOSE-OUT slice (2026-08-14): `update`, `node-verdict`, `reconcile` and
 * `reconcile-decide`, which retires the last of this file's seams — every
 * wrapper below now has a handler behind it.
 *
 * On failure every call returns `{ data: null, error }` like the rest of the
 * app, and the page renders that error verbatim.
 *
 * | handler            | args                                            | returns                          |
 * | ------------------ | ----------------------------------------------- | -------------------------------- |
 * | `list`             | status, dealId, leadUserEmail, search, limit    | `{ surveys[], total, truncated }` |
 * | `get`              | surveyId                                        | full detail + readiness          |
 * | `create`           | dealId, scheduledStart?, templateId?, actorEmail| `{ survey }`                     |
 * | `update`           | surveyId, title, targetCompletionDate, notes…   | `{ survey }`                     |
 * | `transition`       | surveyId, toStatus, reason, actorEmail          | `{ survey, warnings[] }`         |
 * | `schedule`         | surveyId, visitId?, scheduledStart, ...         | `{ visit }`                      |
 * | `visit-transition` | visitId, toStatus, reason                       | `{ visit }`                      |
 * | `assign`           | surveyId, payload:{assignees[]}                 | `{ assignees[] }`                |
 * | `set-lead`         | surveyId, assigneeId, reason                    | `{ survey }`                     |
 * | `walk`             | surveyId, visitId?                              | the whole walk state             |
 * | `capture`          | payload:{entries[],answers[],observations[]...} | refreshed walk state             |
 * | `node-import`      | surveyId, payload:{nodes[]}, actorEmail         | `{ nodes, observations }`        |
 * | `node-verdict`     | nodeId, verdict, verdictNote, actorEmail        | `{ node }`                       |
 * | `qualification-*`  | surveyId/qualificationId, text, actorEmail      | `{ qualifications[] }`           |
 * | `reconcile`        | surveyId, actorEmail                            | `{ items[], written, unreachable }` |
 * | `reconcile-decide` | itemId, decision, manualValue, actorEmail       | `{ item }`                       |
 *
 * Complex input travels inside `payload` as a JSON string: handler parameters
 * may only be `string` or `number`, so arrays cannot be sent as flat fields.
 */

import { requestFrom, type Result } from "../../../lib/request";
import type {
  AssignableUser,
  Assignee,
  ProspectNode,
  Qualification,
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

/**
 * `survey.create` — the deal AND the property are mandatory (C32). Pass
 * `prospectSiteId` for a site already on the deal, or `siteName` to create one.
 * Sending neither is rejected by the server, not silently defaulted: a survey
 * with no site is what made every room the walk found an orphan (`F-03`).
 */
export const createSurvey = (
  dealId: string,
  actorEmail: string,
  opts: {
    prospectSiteId?: string;
    siteName?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    templateId?: string;
    title?: string;
    timezone?: string;
    targetCompletionDate?: string;
  } = {}
) => call<{ survey: Survey }>("create", { dealId, actorEmail, ...opts });

/** A site as the create-survey picker needs it. */
export type SiteOption = {
  id: string;
  name: string;
  code: string | null;
  facilioId: string | null;
};

/**
 * `survey.site-list` — sites on ONE deal. Deal-scoped rather than
 * account-scoped: with no `previous_pursuit_id` column, a building cannot yet be
 * carried forward between pursuits, and sharing one row across two would break
 * §3b's point-in-time rule.
 */
export const listSites = (dealId: string) => call<{ sites: SiteOption[] }>("site-list", { dealId });

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

/**
 * `survey.update` — the record's own fields. Status is rejected here by the
 * handler, not merely omitted by this wrapper: a status that could be typed
 * into an update is a state machine with a back door.
 */
export const updateSurvey = (
  surveyId: string,
  fields: {
    title?: string;
    targetCompletionDate?: string;
    contractIntent?: string;
    notes?: string;
  },
  actorEmail: string
) => call<{ survey: Survey }>("update", { surveyId, actorEmail, ...fields });

/**
 * `survey.transition` — EVERY lifecycle move, including the three that finish a
 * survey: T5 send for review, T6 bounce back for rework, T7 complete. There is
 * no separate `submit` handler; completing IS a transition to `completed`.
 *
 * Guards live server-side and are the authority — the shape rules in
 * `domain/survey-state.ts`, the count rules (open visits, unverdicted nodes,
 * unanswered required questions, undecided reconciliation rows) in
 * `domain/survey-completeness.ts`. Cancelling and rework require a reason;
 * T5/T6/T7 are lead-only, matched against the recorded lead. The UI disables
 * what it can and shows `readiness` from `get` so a person sees what is owed
 * BEFORE clicking, but a refusal here is still the last word.
 *
 * `warnings` come back on success: things the move proceeded PAST rather than
 * things that stopped it.
 */
export const transitionSurvey = (
  surveyId: string,
  toStatus: string,
  reason: string,
  actorEmail: string
) =>
  call<{ survey: Survey; warnings?: string[] }>("transition", {
    surveyId,
    toStatus,
    reason,
    actorEmail,
  });

/** `survey.schedule` — schedule AND reschedule; always re-runs conflict-warn. */
export const scheduleVisit = (surveyId: string, body: Record<string, unknown>) =>
  call<{ visit: Visit }>("schedule", { surveyId, ...payload(body) });

/** `survey.visit-transition` — no_show/cancelled need a reason; a no-show NEVER advances the survey. */
export const transitionVisit = (visitId: string, toStatus: string, reason: string, actorEmail: string) =>
  call<{ visit: Visit }>("visit-transition", { visitId, toStatus, reason, actorEmail });

/** `survey.user-list` — active users with role, team, region and week load,
    for the assign picker (D-19). Assignment never free-types an email. */
export const listAssignableUsers = () => call<{ users: AssignableUser[] }>("user-list");

/** `survey.submit` — P-06's one button. The server routes on lead-ness:
    surveyor → pending_review; the lead's own submit completes and freezes. */
export const submitSurvey = (surveyId: string, actorEmail: string) =>
  call<{ survey: Survey; warnings: string[] }>("submit", { surveyId, actorEmail });

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

/** A frozen revision, as the handoff needs to describe it. */
export type SurveyRevision = {
  id: string;
  surveyId?: string;
  revisionNo: number;
  frozenAt?: string | null;
  frozenBy?: string | null;
  checksum?: string | null;
  triggerKind?: string | null;
  isCurrent?: string | null;
  surveyRefNo?: string | null;
  surveyTitle?: string | null;
  completenessPct?: number | null;
  notVisitedPct?: number | null;
};

/** `survey.revision-list` — what a proposal may be priced from, by survey or deal. */
export const listRevisions = (by: { surveyId?: string; dealId?: string }) =>
  call<{ revisions: SurveyRevision[] }>("revision-list", by);

/**
 * Raise a proposal against this survey's frozen revision — THE HANDOFF the
 * proposal module exists for ("a Proposal turns a frozen survey revision into
 * priced lines using a rate card", Proposal Spec §1).
 *
 * Calls the `proposal` function directly rather than importing the proposals
 * feature's api-util, for the same reason `listPublishedTemplates` above calls
 * `form` directly: features do not import each other's internals, and a thin
 * duplicate at the boundary is cheaper than a dependency between two lanes
 * that are meant to be owned separately.
 *
 * The revision id is what makes this different from raising a bare proposal —
 * without it `line-generate` stays disabled and the estimator prices from
 * nothing.
 */
export const createProposalFromSurvey = (
  dealId: string,
  surveyRevisionId: string,
  actorEmail: string,
  title?: string
) =>
  requestFrom<{ proposal: { id: string; refNo: string } }>("proposal", "create", {
    dealId,
    surveyRevisionId,
    actorEmail,
    ...(title ? { title } : {}),
  });

/** One row of the tender documents' building list, as the import dialog collects it. */
export type NodeImport = {
  name: string;
  nodeType?: string;
  /** Another node's name IN THE SAME BATCH — ids derive from names, so order
      does not matter and a parent may be listed after its children. */
  parentName?: string;
  areaSqft?: number;
  floorCount?: number;
  roomCount?: number;
  restroomCount?: number;
  floorLabel?: string;
};

/**
 * `survey.node-import` — seed the portfolio with what the tender documents
 * CLAIMED, before anybody walks it.
 *
 * This is the handler the rest of the module assumes. Without seeded nodes a
 * verdict has nothing to be recorded against, coverage has no denominator, and
 * the value-level reconciliation diffs have no claimed side to compare — which
 * is why every numeric attribute is stored as an observation too, not just as
 * a column on the node.
 *
 * Re-importing a corrected list updates in place; a node's verdict is never
 * overwritten, because the documents may be re-read but what a surveyor found
 * on site is not theirs to revise.
 */
export const importNodes = (surveyId: string, nodes: NodeImport[], actorEmail: string) =>
  call<{ nodes: number; observations: number }>("node-import", {
    surveyId,
    actorEmail,
    ...payload({ nodes }),
  });

/** `survey.qualification-add` — an exclusion that prints on the proposal. */
export const addQualification = (surveyId: string, text: string, actorEmail: string) =>
  call<{ qualifications: Qualification[] }>("qualification-add", {
    surveyId,
    text,
    actorEmail,
  });

/** `survey.qualification-remove` — soft; a withdrawn exclusion is still history. */
export const removeQualification = (qualificationId: string, actorEmail: string) =>
  call<{ qualifications: Qualification[] }>("qualification-remove", {
    qualificationId,
    actorEmail,
  });

/**
 * `survey.node-verdict` — what the surveyor found at a node the tender
 * documents claimed. A note is mandatory for changed / not_found / not_visited,
 * and the handler REFUSES a verdict on a capture-created node: that node's
 * `added_on_site` records how it came to exist, and the completion guard counts
 * on the distinction.
 */
export const setNodeVerdict = (
  nodeId: string,
  verdict: string,
  verdictNote: string,
  actorEmail: string
) => call<{ node: ProspectNode }>("node-verdict", { nodeId, verdict, verdictNote, actorEmail });

// ── Review and handoff ───────────────────────────────────────────────────────

/**
 * `survey.reconcile` — the deterministic diff; suggests, never decides.
 *
 * Idempotent: item ids are derived from the disagreement itself, so pressing
 * the button twice updates rather than duplicates, and a row somebody has
 * already closed is left exactly as they left it.
 *
 * `unreachable` names the diff types this run COULD NOT have found. The
 * value-level comparisons need the tender documents' own figures, which arrive
 * through an RFP import that does not exist in this build — so an empty result
 * means "nothing found among what we can check", not "nothing disagrees", and
 * the surface says so.
 */
export const runReconcile = (surveyId: string, actorEmail: string) =>
  call<{ items: ReconciliationItem[]; written: number; unreachable: string[] }>("reconcile", {
    surveyId,
    actorEmail,
  });

/** `survey.reconcile-decide` — every row is closed by a person (D-S2). */
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

// T7 is `transitionSurvey(id, "completed", …)`, not a handler of its own — see
// the note there. The `submit` wrapper this replaced was a seam that never had
// a handler behind it, and keeping it would have offered two ways to complete
// a survey where the server only has one.
