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

// ── Estimated value (D-05) ────────────────────────────────────────────────────

/**
 * The 14 Aug ruling on D-05, verbatim: MINIMAL SPLIT. One amount box stays;
 * what was added is the distinction a single number destroys — whether that
 * 12,000 happens once, every month (a 144k contract), or both. `both` keeps
 * the single amount deliberately: Sudharsan chose the toggle over a full
 * two-amount split, so the amount reads as the headline figure and the type
 * says what kind of figure it is.
 */
export type ValueType = "one_off" | "recurring" | "both";

export const VALUE_TYPES: readonly ValueType[] = ["one_off", "recurring", "both"];

export type ValueFrequency = "monthly" | "quarterly" | "annual";

export const VALUE_FREQUENCIES: readonly ValueFrequency[] = ["monthly", "quarterly", "annual"];

export function isValueType(value: unknown): value is ValueType {
  return typeof value === "string" && (VALUE_TYPES as readonly string[]).includes(value);
}

export function isValueFrequency(value: unknown): value is ValueFrequency {
  return typeof value === "string" && (VALUE_FREQUENCIES as readonly string[]).includes(value);
}

/**
 * Why the trio (type, frequency, amount) is unusable, or null when fine.
 * Absent type is ALLOWED — the widget and legacy rows predate the field, and
 * refusing them would close the front door to fix a form. But a frequency on a
 * one-off, or a recurring value with no frequency, is a contradiction the row
 * would carry forever, so those are refused at the door.
 */
export function valueFieldsBlocker(input: {
  valueType?: string | null;
  valueFrequency?: string | null;
}): string | null {
  const type = input.valueType ?? null;
  const freq = input.valueFrequency ?? null;

  if (type !== null && !isValueType(type)) {
    return `valueType must be one of: ${VALUE_TYPES.join(", ")}`;
  }
  if (freq !== null && !isValueFrequency(freq)) {
    return `valueFrequency must be one of: ${VALUE_FREQUENCIES.join(", ")}`;
  }
  if (freq && (type === null || type === "one_off")) {
    return "a frequency only makes sense on a recurring value";
  }
  if ((type === "recurring" || type === "both") && !freq) {
    return "a recurring value needs its frequency (monthly, quarterly or annual)";
  }
  return null;
}

// ── Channel vs source (D-10) ──────────────────────────────────────────────────

/**
 * The 14 Aug ruling: TWO FIELDS. Channel = how the enquiry arrived (the
 * existing `source` column: widget, tender, inapp — refined by source_detail).
 * Source = where it CAME FROM, which is this list. Mixing them is what made
 * "how many wins came from referrals" unanswerable. The column name `source`
 * was already taken by the channel and table shapes are permanent here, so the
 * where-it-came-from field is called ORIGIN in the API and "Source" in the UI.
 */
export type LeadOrigin =
  | "referral"
  | "existing_client"
  | "marketing"
  | "hubspot"
  | "cold_outreach"
  | "other";

export const LEAD_ORIGINS: readonly LeadOrigin[] = [
  "referral",
  "existing_client",
  "marketing",
  "hubspot",
  "cold_outreach",
  "other",
];

export function isLeadOrigin(value: unknown): value is LeadOrigin {
  return typeof value === "string" && (LEAD_ORIGINS as readonly string[]).includes(value);
}
