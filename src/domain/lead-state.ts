/**
 * The lead lifecycle. Pure — no db, no fetch, no platform imports.
 *
 * Status and reason are deliberately separate: `spam`, `duplicate`,
 * `outside_region` and `wrong_service` are reasons a lead CLOSED, not states.
 * Flattening them would make "how many closed?" a union of five values and
 * leave no way to record a reason on anything but a rejection.
 */

export type LeadStatus =
  | "new"
  | "in_review"
  | "contacted"
  | "qualified"
  | "nurture"
  | "converted"
  | "closed";

export const LEAD_STATUSES: readonly LeadStatus[] = [
  "new",
  "in_review",
  "contacted",
  "qualified",
  "nurture",
  "converted",
  "closed",
];

export type DispositionReason =
  | "spam"
  | "duplicate"
  | "outside_region"
  | "wrong_service"
  | "not_interested"
  | "no_budget"
  | "no_response"
  | "lost_to_competitor"
  | "test";

export const DISPOSITION_REASONS: readonly DispositionReason[] = [
  "spam",
  "duplicate",
  "outside_region",
  "wrong_service",
  "not_interested",
  "no_budget",
  "no_response",
  "lost_to_competitor",
  "test",
];

/**
 * `new -> closed` is intentional: obvious spam should die without an actioner
 * having to claim it first.
 */
const TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ["in_review", "closed"],
  in_review: ["contacted", "qualified", "nurture", "closed"],
  contacted: ["qualified", "nurture", "closed"],
  qualified: ["converted", "closed"],
  nurture: ["in_review", "contacted", "closed"],
  converted: [],
  closed: [],
};

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

export function isDispositionReason(value: unknown): value is DispositionReason {
  return (
    typeof value === "string" && (DISPOSITION_REASONS as readonly string[]).includes(value)
  );
}

export function isTerminal(status: LeadStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Only `closed` carries a reason — everything else must not. */
export function requiresReason(to: LeadStatus): boolean {
  return to === "closed";
}

export function allowedNext(from: LeadStatus): readonly LeadStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return allowedNext(from).includes(to);
}

export interface TransitionInput {
  from: unknown;
  to: unknown;
  reason?: unknown;
}

/**
 * Validates a status change and returns the normalised pair.
 * Throws with a message meant to be shown to a caller, not swallowed.
 */
export function validateTransition(input: TransitionInput): {
  from: LeadStatus;
  to: LeadStatus;
  reason: DispositionReason | null;
} {
  const { from, to, reason } = input;

  if (!isLeadStatus(from)) throw new Error(`unknown current status: ${String(from)}`);
  if (!isLeadStatus(to)) throw new Error(`unknown target status: ${String(to)}`);

  if (from === to) throw new Error(`lead is already ${to}`);

  if (isTerminal(from)) {
    throw new Error(`${from} is terminal — reopening means creating a new lead`);
  }

  if (!canTransition(from, to)) {
    throw new Error(`cannot go from ${from} to ${to} (allowed: ${allowedNext(from).join(", ")})`);
  }

  if (requiresReason(to)) {
    if (!isDispositionReason(reason)) {
      throw new Error(
        `closing a lead requires a disposition reason (one of: ${DISPOSITION_REASONS.join(", ")})`
      );
    }
    return { from, to, reason };
  }

  if (reason !== undefined && reason !== null && reason !== "") {
    throw new Error(`a disposition reason only applies when closing, not for ${to}`);
  }

  return { from, to, reason: null };
}

/**
 * Which timestamp column a transition stamps, if any. Keeps the handler from
 * hard-coding this mapping in several places.
 */
export function stampColumnFor(to: LeadStatus): string | null {
  switch (to) {
    case "in_review":
      return "reviewed_at";
    case "contacted":
      return "first_contact_at";
    case "qualified":
      return "qualified_at";
    case "converted":
      return "converted_at";
    case "closed":
      return "closed_at";
    default:
      return null;
  }
}
