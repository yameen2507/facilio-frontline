/**
 * The deal lifecycle (deal.md). Pure — no db, no fetch, no platform imports.
 *
 * The lead machine is a strict funnel; this one is deliberately looser, because
 * the spec's "Lifecycle Flexibility" section is a list of legal skips: a small
 * existing-client deal jumps discovery → estimation, a repeat customer with a
 * finished survey never enters the survey stages at all. Encoding every legal
 * pair as an adjacency list would be forty entries that all mean one rule, so
 * the rule is stated instead:
 *
 *   - FORWARD to any later active stage, skips included.
 *   - BACKWARD only inside the commercial loop (proposal_submitted ⇄
 *     negotiation ⇄ decision_pending) — a revised offer or a customer who
 *     reopens discussion moves the deal back a step there, but nothing outside
 *     that loop ever runs in reverse. Un-doing a survey or an estimation is a
 *     new fact about the deal, not a stage change.
 *   - LOST from any active stage (the spec's own example: Proposal Submitted →
 *     Lost), always with a reason.
 *   - WON only from the commercial loop: every winning path in the spec passes
 *     through Proposal Submitted first — there is no accepted offer to win on
 *     before one has been sent.
 *
 * Won and lost are terminal to `transition`; `validateReopen` is the separate,
 * deliberate door back out, so casual stage edits can never resurrect a deal.
 */

export type DealStage =
  | "opportunity"
  | "discovery"
  | "survey_required"
  | "survey_completed"
  | "estimation"
  | "proposal_submitted"
  | "negotiation"
  | "decision_pending"
  | "won"
  | "lost";

export const DEAL_STAGES: readonly DealStage[] = [
  "opportunity",
  "discovery",
  "survey_required",
  "survey_completed",
  "estimation",
  "proposal_submitted",
  "negotiation",
  "decision_pending",
  "won",
  "lost",
];

/** The eight working stages, in funnel order. Terminal stages sit outside it. */
export const ACTIVE_STAGES: readonly DealStage[] = DEAL_STAGES.slice(0, 8);

export const STAGE_LABEL: Record<DealStage, string> = {
  opportunity: "Opportunity",
  discovery: "Discovery",
  survey_required: "Survey required",
  survey_completed: "Survey completed",
  estimation: "Estimation",
  proposal_submitted: "Proposal submitted",
  negotiation: "Negotiation",
  decision_pending: "Decision pending",
  won: "Won",
  lost: "Lost",
};

/** Stages a customer conversation can bounce between without going forward. */
const COMMERCIAL_LOOP: readonly DealStage[] = [
  "proposal_submitted",
  "negotiation",
  "decision_pending",
];

export type LostReason =
  | "price"
  | "competitor"
  | "scope"
  | "budget"
  | "timing"
  | "customer_cancelled"
  | "existing_provider"
  | "service_capability"
  | "region"
  | "tender_cancelled"
  | "no_response"
  | "other";

export const LOST_REASONS: readonly LostReason[] = [
  "price",
  "competitor",
  "scope",
  "budget",
  "timing",
  "customer_cancelled",
  "existing_provider",
  "service_capability",
  "region",
  "tender_cancelled",
  "no_response",
  "other",
];

export function isDealStage(value: unknown): value is DealStage {
  return typeof value === "string" && (DEAL_STAGES as readonly string[]).includes(value);
}

export function isLostReason(value: unknown): value is LostReason {
  return typeof value === "string" && (LOST_REASONS as readonly string[]).includes(value);
}

export function isTerminal(stage: DealStage): boolean {
  return stage === "won" || stage === "lost";
}

const order = (stage: DealStage): number => ACTIVE_STAGES.indexOf(stage);

export function canTransition(from: DealStage, to: DealStage): boolean {
  if (isTerminal(from) || from === to) return false;
  if (to === "lost") return true;
  if (to === "won") return COMMERCIAL_LOOP.includes(from);
  if (order(to) > order(from)) return true;
  return COMMERCIAL_LOOP.includes(from) && COMMERCIAL_LOOP.includes(to);
}

export function allowedNext(from: DealStage): readonly DealStage[] {
  return DEAL_STAGES.filter((to) => canTransition(from, to));
}

export interface TransitionInput {
  from: unknown;
  to: unknown;
  lostReason?: unknown;
}

/**
 * Validates a stage change and returns the normalised pair.
 * Throws with a message meant to be shown to a caller, not swallowed.
 */
export function validateTransition(input: TransitionInput): {
  from: DealStage;
  to: DealStage;
  lostReason: LostReason | null;
} {
  const { from, to, lostReason } = input;

  if (!isDealStage(from)) throw new Error(`unknown current stage: ${String(from)}`);
  if (!isDealStage(to)) throw new Error(`unknown target stage: ${String(to)}`);

  if (from === to) throw new Error(`deal is already in ${STAGE_LABEL[to].toLowerCase()}`);

  if (isTerminal(from)) {
    throw new Error(`${from} is terminal — an authorised user must reopen the deal first`);
  }

  if (!canTransition(from, to)) {
    throw new Error(`cannot go from ${from} to ${to} (allowed: ${allowedNext(from).join(", ")})`);
  }

  if (to === "lost") {
    if (!isLostReason(lostReason)) {
      throw new Error(`losing a deal requires a lost reason (one of: ${LOST_REASONS.join(", ")})`);
    }
    return { from, to, lostReason };
  }

  if (lostReason !== undefined && lostReason !== null && lostReason !== "") {
    throw new Error(`a lost reason only applies when losing the deal, not for ${to}`);
  }

  return { from, to, lostReason: null };
}

/**
 * Reopening returns the deal to the stage it closed FROM (recorded at close
 * time), so a deal lost in negotiation resumes in negotiation — not at some
 * fixed re-entry point that forgets where the conversation was.
 */
export function validateReopen(from: unknown, closedFromStage: unknown): DealStage {
  if (!isDealStage(from)) throw new Error(`unknown current stage: ${String(from)}`);
  if (!isTerminal(from)) throw new Error(`only a won or lost deal can be reopened (this one is ${from})`);

  if (isDealStage(closedFromStage) && !isTerminal(closedFromStage)) return closedFromStage;
  // Older rows may predate the closed-from record; the latest commercial stage
  // is the safest place to resume a conversation whose position we lost.
  return "decision_pending";
}
