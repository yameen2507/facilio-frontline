/**
 * The visit lifecycle. Pure — no db, no fetch, no platform imports.
 *
 * THE ONE THING THIS FILE EXISTS TO GET RIGHT: `no_show` must not cascade the
 * survey forward. Roughly ten bidders compete for one tenderer-controlled slot,
 * so a wasted trip is routine, not an edge case (v1.7 §9 F13). If a no-show
 * read as a capture, the survey would move to `in_progress` and every "did the
 * walk happen" metric would lie. `cascadesSurveyForward` is the whole answer,
 * and it is why this is a separate module with its own tests.
 */

export type VisitStatus = "planned" | "in_progress" | "done" | "no_show" | "cancelled";

export const VISIT_STATUSES: readonly VisitStatus[] = [
  "planned",
  "in_progress",
  "done",
  "no_show",
  "cancelled",
];

/**
 * A visit that never started can be marked no-show; one already underway
 * cannot — it happened, so it ends `done` or `cancelled`.
 */
const TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  planned: ["in_progress", "no_show", "cancelled"],
  in_progress: ["done", "cancelled"],
  done: [],
  no_show: [],
  cancelled: [],
};

export function isVisitStatus(value: unknown): value is VisitStatus {
  return typeof value === "string" && (VISIT_STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: VisitStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function allowedNext(from: VisitStatus): readonly VisitStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from: VisitStatus, to: VisitStatus): boolean {
  return allowedNext(from).includes(to);
}

/** Both wasted-trip outcomes must say why. */
export function requiresReason(to: VisitStatus): boolean {
  return to === "no_show" || to === "cancelled";
}

/**
 * Only a visit actually starting moves the survey to `in_progress` (T4).
 * A no-show leaves the survey exactly where it was — see the file header.
 */
export function cascadesSurveyForward(to: VisitStatus): boolean {
  return to === "in_progress";
}

/**
 * A visit still open blocks the survey's move to `pending_review` (F6): the
 * lead must not reconcile while two walks are still on the calendar.
 */
export function isOpen(status: VisitStatus): boolean {
  return status === "planned" || status === "in_progress";
}

export function stampColumnFor(to: VisitStatus): string | null {
  switch (to) {
    case "in_progress":
      return "actual_start_at";
    case "done":
      return "actual_end_at";
    default:
      return null;
  }
}

export interface VisitTransitionInput {
  from: unknown;
  to: unknown;
  reason?: unknown;
}

export interface VisitTransition {
  from: VisitStatus;
  to: VisitStatus;
  reason: string | null;
  cascadesSurvey: boolean;
  stampColumn: string | null;
}

export function validateVisitTransition(input: VisitTransitionInput): VisitTransition {
  const { from, to, reason } = input;

  if (!isVisitStatus(from)) throw new Error(`unknown current visit status: ${String(from)}`);
  if (!isVisitStatus(to)) throw new Error(`unknown target visit status: ${String(to)}`);

  if (from === to) throw new Error(`visit is already ${to}`);

  if (isTerminal(from)) throw new Error(`${from} is terminal — reschedule means a new visit`);

  if (!canTransition(from, to)) {
    throw new Error(
      `cannot go from ${from} to ${to} (allowed: ${allowedNext(from).join(", ")})`
    );
  }

  const trimmed = typeof reason === "string" ? reason.trim() : "";

  if (requiresReason(to) && !trimmed) {
    throw new Error(`marking a visit ${to} requires a reason`);
  }

  return {
    from,
    to,
    reason: trimmed || null,
    cascadesSurvey: cascadesSurveyForward(to),
    stampColumn: stampColumnFor(to),
  };
}
