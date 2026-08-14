/**
 * The survey lifecycle. Pure — no db, no fetch, no platform imports.
 *
 * Structure v1.7 §A1.8 gives ten transitions; seven are expressible as pure
 * state logic and live here. The rest need data this module deliberately cannot
 * see:
 *
 *   - T5's "no visit left in planned or in_progress" and T7's full guard set
 *     are counts, and they live in `survey-completeness.ts` as pure functions
 *     over those counts. Keeping them out of here is what lets this file be a
 *     table plus a validator rather than a query planner.
 *   - T4 (`assigned -> in_progress`) is spec'd as workflow-driven. There is no
 *     workflow engine on this platform, so it fires inside the `capture`
 *     handler as a deterministic side effect. It is still a legal transition
 *     here; only its trigger differs.
 *
 * WHO may move a survey is enforced here as far as it can be. Note the honest
 * limit: functions receive no caller identity, so `actorIsLead` is asserted by
 * the client. The audit trail is honest about what changed and trusting about
 * who — that is a platform property, not a bug in this file.
 */

export type SurveyStatus =
  | "draft"
  | "scheduled"
  | "assigned"
  | "in_progress"
  | "pending_review"
  | "completed"
  | "cancelled";

export const SURVEY_STATUSES: readonly SurveyStatus[] = [
  "draft",
  "scheduled",
  "assigned",
  "in_progress",
  "pending_review",
  "completed",
  "cancelled",
];

/**
 * `cancelled` is reachable from every pre-completed state (T8) and `completed`
 * is reachable only through review (T7). Both are terminal: D-S14 says a
 * completed survey is never reopened — a re-walk is a NEW linked survey (T9),
 * which is a row insert, not a transition, so it does not appear here.
 */
const TRANSITIONS: Record<SurveyStatus, readonly SurveyStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["assigned", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["pending_review", "cancelled"],
  pending_review: ["in_progress", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** The v1.7 transition code, for logs and error messages people have to read. */
const CODES: Record<string, string> = {
  "draft>scheduled": "T2",
  "scheduled>assigned": "T3",
  "assigned>in_progress": "T4",
  "in_progress>pending_review": "T5",
  "pending_review>in_progress": "T6",
  "pending_review>completed": "T7",
  "draft>cancelled": "T8",
  "scheduled>cancelled": "T8",
  "assigned>cancelled": "T8",
  "in_progress>cancelled": "T8",
  "pending_review>cancelled": "T8",
};

export function isSurveyStatus(value: unknown): value is SurveyStatus {
  return typeof value === "string" && (SURVEY_STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: SurveyStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function allowedNext(from: SurveyStatus): readonly SurveyStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from: SurveyStatus, to: SurveyStatus): boolean {
  return allowedNext(from).includes(to);
}

export function transitionCode(from: SurveyStatus, to: SurveyStatus): string | null {
  return CODES[`${from}>${to}`] ?? null;
}

/**
 * Cancelling always needs a reason (T8) and so does a rework bounce (T6).
 * Both are the same rule underneath: a move that destroys or repeats work has
 * to say why, because the reason is the only thing that survives to explain it.
 */
export function requiresReason(from: SurveyStatus, to: SurveyStatus): boolean {
  if (to === "cancelled") return true;
  return from === "pending_review" && to === "in_progress";
}

/**
 * From `in_progress` onward only the lead moves the survey (T5, T6, T7).
 * The BD creates, schedules, assigns and may cancel; the lead owns completeness.
 */
export function requiresLead(from: SurveyStatus, to: SurveyStatus): boolean {
  if (from === "in_progress" && to === "pending_review") return true;
  if (from === "pending_review" && (to === "in_progress" || to === "completed")) return true;
  return false;
}

export interface SurveyTransitionInput {
  from: unknown;
  to: unknown;
  reason?: unknown;
  /** Client-asserted — see the file header. */
  actorIsLead?: boolean;
}

export interface SurveyTransition {
  from: SurveyStatus;
  to: SurveyStatus;
  reason: string | null;
  code: string;
}

/**
 * Validates a status change and returns the normalised move.
 * Throws with a message meant to be shown to a caller, not swallowed.
 */
export function validateSurveyTransition(input: SurveyTransitionInput): SurveyTransition {
  const { from, to, reason, actorIsLead } = input;

  if (!isSurveyStatus(from)) throw new Error(`unknown current status: ${String(from)}`);
  if (!isSurveyStatus(to)) throw new Error(`unknown target status: ${String(to)}`);

  if (from === to) throw new Error(`survey is already ${to}`);

  if (isTerminal(from)) {
    throw new Error(
      from === "completed"
        ? "completed is terminal — a re-walk is a new linked survey, never a reopen"
        : "cancelled is terminal — a cancelled survey cannot be revived"
    );
  }

  if (!canTransition(from, to)) {
    throw new Error(
      `cannot go from ${from} to ${to} (allowed: ${allowedNext(from).join(", ")})`
    );
  }

  if (requiresLead(from, to) && actorIsLead !== true) {
    throw new Error(`only the survey lead can move a survey from ${from} to ${to}`);
  }

  const trimmed = typeof reason === "string" ? reason.trim() : "";

  if (requiresReason(from, to)) {
    if (!trimmed) {
      throw new Error(
        to === "cancelled"
          ? "cancelling a survey requires a reason"
          : "sending a survey back for rework requires a reason"
      );
    }
    return { from, to, reason: trimmed, code: transitionCode(from, to) as string };
  }

  return { from, to, reason: trimmed || null, code: transitionCode(from, to) as string };
}

/**
 * Which columns a transition stamps beyond `status` / `status_changed_*`.
 * Kept here so no handler re-derives it and they drift apart.
 */
export function stampColumnsFor(to: SurveyStatus): readonly string[] {
  switch (to) {
    case "cancelled":
      return ["cancel_reason", "cancelled_by", "cancelled_at"];
    case "completed":
      return ["submitted_by", "submitted_at", "current_revision_id"];
    default:
      return [];
  }
}

/** T6 is the only transition that increments the bounce counter. */
export function incrementsRework(from: SurveyStatus, to: SurveyStatus): boolean {
  return from === "pending_review" && to === "in_progress";
}

/**
 * C32: a survey names the property it is for, and the caller gives exactly one
 * of an existing site or a new site's name. Returns why the pair is unusable,
 * or null.
 *
 * This is the pure half of `resolveSurveySite` — the half that does not need the
 * database — and it is here rather than inline in the module so it can be
 * tested. There is no db harness in this repo, so a rule left inside a function
 * that calls `one()` is a rule with no test.
 *
 * Both-given is rejected rather than silently preferring one. The two answers
 * mean different things ("use that property" vs "there is a new property"), so
 * picking one for the caller would create a site nobody asked for, or ignore the
 * one they named.
 */
export function siteSelectionBlocker(input: {
  prospectSiteId?: string | null;
  siteName?: string | null;
}): string | null {
  const id = (input.prospectSiteId ?? "").trim();
  const name = (input.siteName ?? "").trim();

  if (id && name) {
    return "give either an existing site or a new site name, not both";
  }
  if (!id && !name) {
    return "a survey needs the property it is for — pick an existing site or name a new one";
  }
  return null;
}
