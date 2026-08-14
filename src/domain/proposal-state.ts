/**
 * The proposal lifecycle, and the approval decision.
 * Pure — no db, no fetch, no platform imports.
 *
 * Two things live here that are easy to get wrong and expensive when you do:
 *
 *  1. THE REVISION BOUNDARY IS `sent` (spec §5 R1). Before a proposal is sent,
 *     edits are just edits and no version churn happens. After it, any change
 *     is a new revision. This is what clients already expect from the document
 *     tools they use, and it is the difference between v7-where-nothing-changed
 *     and a version history that means something.
 *
 *  2. NEGOTIATION IS NOT A STATE (spec §5 R2). A client saying "do it for 40k"
 *     is an EVENT on the proposal, not a status change. A revision exists only
 *     when we deliberately re-price. Without that split you get seven versions
 *     and no idea which one they are looking at.
 *
 * Approval keys off DEVIATION FROM CARD PRICE, not profitability — the rate
 * card carries one price and no cost, so margin is not visible anywhere in this
 * product. That is a stated consequence of the 14 Aug rate-card cut, not an
 * oversight, and it should be said out loud rather than implied.
 */

export type ProposalStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "superseded"
  | "withdrawn";

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "superseded",
  "withdrawn",
];

export function isProposalStatus(value: unknown): value is ProposalStatus {
  return typeof value === "string" && (PROPOSAL_STATUSES as readonly string[]).includes(value);
}

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  superseded: "Superseded",
  withdrawn: "Withdrawn",
};

/** Nothing further happens to a proposal in one of these. */
export const TERMINAL: readonly ProposalStatus[] = [
  "accepted",
  "rejected",
  "expired",
  "superseded",
  "withdrawn",
];

export function isTerminal(status: ProposalStatus): boolean {
  return TERMINAL.includes(status);
}

/** Edits are allowed right up to the moment the client can see it, and no further. */
export function isEditable(status: ProposalStatus): boolean {
  return status === "draft" || status === "pending_approval";
}

export type TransitionName =
  | "submit_for_approval"
  | "approve"
  | "return"
  | "send"
  | "withdraw"
  | "accept"
  | "reject"
  | "supersede"
  | "expire";

interface TransitionRule {
  from: readonly ProposalStatus[];
  to: ProposalStatus;
  /** A state change nobody can explain is one nobody can defend. */
  reasonRequired?: boolean;
}

/**
 * The whole state machine, in one table. `expire` and `supersede` are here for
 * completeness but are never user actions — see the two notes below.
 */
export const TRANSITIONS: Record<TransitionName, TransitionRule> = {
  submit_for_approval: { from: ["draft"], to: "pending_approval" },
  approve: { from: ["draft", "pending_approval"], to: "approved" },
  // Returning a proposal without saying why makes the approver's job invisible
  // and the estimator's next move a guess.
  return: { from: ["pending_approval"], to: "draft", reasonRequired: true },
  send: { from: ["approved"], to: "sent" },
  withdraw: { from: ["sent"], to: "withdrawn", reasonRequired: true },
  accept: { from: ["sent"], to: "accepted" },
  // Win/loss analysis is only as good as the reason field behind it.
  reject: { from: ["sent"], to: "rejected", reasonRequired: true },
  // Not a user action: the parent flips only when a CHILD REVISION IS SENT.
  supersede: { from: ["sent", "approved", "draft", "pending_approval"], to: "superseded" },
  // Not a user action and never a stored status — see `effectiveStatus`.
  expire: { from: ["sent"], to: "expired" },
};

export interface TransitionInput {
  status: ProposalStatus;
  transition: TransitionName;
  reason?: string | null;
}

/**
 * Why this transition cannot happen, or null. Returning the reason as a
 * sentence rather than a boolean is deliberate: the message is rendered
 * verbatim to the user, so the rule and its explanation cannot drift apart.
 */
export function transitionBlocker(input: TransitionInput): string | null {
  const rule = TRANSITIONS[input.transition];
  if (!rule) return `"${input.transition}" is not a proposal transition`;

  if (!rule.from.includes(input.status)) {
    return `cannot ${input.transition.replace(/_/g, " ")} a ${STATUS_LABEL[input.status].toLowerCase()} proposal (allowed from: ${rule.from.join(", ")})`;
  }

  if (rule.reasonRequired) {
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason) return `a reason is required to ${input.transition.replace(/_/g, " ")} a proposal`;
  }

  return null;
}

export function nextStatus(transition: TransitionName): ProposalStatus {
  return TRANSITIONS[transition].to;
}

// --- approval (spec §4) ----------------------------------------------------------

export interface ApprovalLine {
  pricingMode: string | null;
  /** Signed percentage this line moved from the card price. */
  deviationPct: number;
  isOptional: boolean;
  deltaReason?: string | null;
  description?: string | null;
}

export interface ApprovalInput {
  lines: readonly ApprovalLine[];
  /** `proposal.discount_approval_pct` from fl_setting. Default 10. */
  thresholdPct: number;
}

export interface ApprovalDecision {
  /** True when this proposal must go to an approver before it can be sent. */
  needsApproval: boolean;
  /**
   * THE EXCEPTION LIST — the only thing the approver should be shown.
   * Handing them the whole document is the same as handing them nothing.
   */
  exceptions: Array<{
    description: string;
    mode: string;
    deviationPct: number;
    reason: string | null;
    why: string;
  }>;
  reason: string;
}

/**
 * Per spec §4:
 *   every line standard, or marked up          -> no approval
 *   any discount within the threshold          -> no approval
 *   discount beyond the threshold, or ANY custom line -> pending approval
 *
 * Markup never needs approval: charging more than the card is a commercial
 * judgement that costs the business nothing. A custom line always does, because
 * there is no card price behind it to check the number against.
 */
export function approvalDecision(input: ApprovalInput): ApprovalDecision {
  const threshold = Number.isFinite(input.thresholdPct) ? Math.abs(input.thresholdPct) : 10;
  const exceptions: ApprovalDecision["exceptions"] = [];

  for (const line of input.lines) {
    // An optional line is not sold yet, so it cannot commit the business to a
    // discount. It joins the exception list only once the client takes it.
    if (line.isOptional) continue;

    const mode = line.pricingMode ?? "standard";
    const description = line.description ?? "Untitled line";

    if (mode === "custom") {
      exceptions.push({
        description,
        mode,
        deviationPct: line.deviationPct,
        reason: line.deltaReason ?? null,
        why: "custom price — there is no card rate to check it against",
      });
      continue;
    }

    if (mode === "discount" && Math.abs(line.deviationPct) > threshold) {
      exceptions.push({
        description,
        mode,
        deviationPct: line.deviationPct,
        reason: line.deltaReason ?? null,
        why: `${Math.abs(line.deviationPct).toFixed(1)}% discount is beyond the ${threshold}% threshold`,
      });
    }
  }

  const needsApproval = exceptions.length > 0;
  return {
    needsApproval,
    exceptions,
    reason: needsApproval
      ? `${exceptions.length} line(s) deviate beyond what this proposal can carry unapproved`
      : `every line is within the ${threshold}% threshold`,
  };
}

// --- expiry (spec §5 R8) ----------------------------------------------------------

/**
 * Expiry is COMPUTED AT READ TIME, never written by a scheduled job.
 *
 * That is not a shortcut: jobs fire only on production, and this app has not
 * been promoted. But it is also the better design — a proposal that expired
 * overnight should read as expired the moment someone opens it, not whenever a
 * job last happened to run.
 *
 * Only a `sent` proposal can expire. A draft has never been offered to anyone,
 * and a terminal one has already ended.
 */
export function effectiveStatus(
  stored: ProposalStatus,
  validUntil: string | null | undefined,
  now: string
): ProposalStatus {
  if (stored !== "sent") return stored;
  if (!validUntil || String(validUntil).trim() === "") return stored;
  // ISO-8601 UTC throughout this schema, so lexical order is chronological.
  return String(validUntil) < now ? "expired" : stored;
}

/**
 * Days until the offer lapses; negative once it has. Null when it never does.
 * Callers render this as "expires in 6 days" — the absolute time-to-expiry the
 * chase logic is meant to key off, rather than a percentage of a window.
 */
export function daysToExpiry(validUntil: string | null | undefined, now: string): number | null {
  if (!validUntil || String(validUntil).trim() === "") return null;
  const end = Date.parse(String(validUntil));
  const from = Date.parse(now);
  if (!Number.isFinite(end) || !Number.isFinite(from)) return null;

  const days = (end - from) / 86_400_000;
  // Round AWAY from zero once lapsed, towards it while still live. Plain
  // `Math.ceil` turns a validity twelve hours past into `-0`, so a caller
  // branching on `days < 0` reads "still live" while `effectiveStatus` has
  // already flipped to expired — the badge and the countdown disagreeing on the
  // same row. Anything past the date is at least -1.
  return days < 0 ? Math.floor(days) : Math.ceil(days);
}

// --- negotiation (spec §5 R2) -------------------------------------------------------

/**
 * A counter-offer is a thing that HAPPENED, not a state the proposal is in.
 * These are `fl_event` kinds on the one audit spine — never a second table, and
 * never a status.
 */
export type NegotiationKind =
  | "counter_offer"
  | "question"
  | "objection"
  | "scope_change_request"
  | "client_note";

export const NEGOTIATION_KINDS: readonly NegotiationKind[] = [
  "counter_offer",
  "question",
  "objection",
  "scope_change_request",
  "client_note",
];

export function isNegotiationKind(value: unknown): value is NegotiationKind {
  return typeof value === "string" && (NEGOTIATION_KINDS as readonly string[]).includes(value);
}

export const NEGOTIATION_LABEL: Record<NegotiationKind, string> = {
  counter_offer: "Counter-offer",
  question: "Question",
  objection: "Objection",
  scope_change_request: "Scope change requested",
  client_note: "Note from the client",
};

/**
 * Negotiation can be recorded against a live offer, and against one that has
 * just been rejected or has lapsed — both of those are where the conversation
 * that produces the next revision usually happens (spec §5 R8: rejection and
 * expiry are not dead ends).
 */
export function canRecordNegotiation(status: ProposalStatus): boolean {
  return status === "sent" || status === "rejected" || status === "expired";
}

/**
 * A revision can be raised from a live offer, or from one that ended without a
 * deal. Not from an accepted one — a change after acceptance is a NEW proposal
 * against the won deal, which is the recommendations loop, not a new revision
 * (spec §5 R7).
 */
export function canRevise(status: ProposalStatus): boolean {
  return status === "sent" || status === "rejected" || status === "expired" || status === "withdrawn";
}
