/**
 * Completeness, the review guard and the submit guard. Pure functions over
 * counts — no db, no fetch, no platform imports. The handler does the counting;
 * this file decides what the counts mean.
 *
 * THE DISTINCTION THIS FILE OWNS: `not_visited_pct` over an empty seeded set is
 * `null`, never `0`. A survey where nobody ever imported the RFP's building
 * list has no seeded nodes, so T7's "every seeded node has a verdict" is
 * vacuously true — that is correct behaviour, not a hole. But publishing `0`
 * on the handoff payload would tell the estimator the whole site was walked and
 * priced with eyes open. It wasn't. `null` says "we cannot tell you", which is
 * the honest answer and the one Yameen's lane can branch on.
 *
 * WARN VERSUS BLOCK is the other rule here, and it is deliberate throughout:
 * a survey with 80% of its nodes unvisited still completes (D-S11 — never a
 * forced gate). It warns loudly. Blockers are only things that make the payload
 * wrong, not things that make it thin.
 */

export interface SurveyCounts {
  /** Nodes that came from the RFP/CRM — the set a verdict is owed on. */
  seededNodes: number;
  /** Of those, how many carry any verdict. */
  verdictedNodes: number;
  /** Of those, how many were verdicted `not_visited`. */
  notVisitedNodes: number;
  /** Snapshot questions marked `is_required`. */
  requiredQuestions: number;
  /** Of those, answered OR explicitly marked not-applicable. */
  answeredRequired: number;
  /** Reconciliation rows still awaiting a person's decision. */
  openReconciliationItems: number;
  /** Visits still `planned` or `in_progress`. */
  openVisits: number;
}

export interface CompletenessSettings {
  /** `survey.allow_complete_with_not_visited` — defaults permissive (D-S14). */
  allowCompleteWithNotVisited: boolean;
  /** `survey.not_visited_warn_threshold_pct` — warn above this, never block. */
  notVisitedWarnThresholdPct: number;
  /** `survey.rework_warn_after_bounces` — banner, not a block (F7). */
  reworkWarnAfterBounces: number;
}

export const DEFAULT_COMPLETENESS_SETTINGS: CompletenessSettings = {
  allowCompleteWithNotVisited: true,
  notVisitedWarnThresholdPct: 20,
  reworkWarnAfterBounces: 3,
};

const pct = (part: number, whole: number): number => Math.round((part / whole) * 1000) / 10;

/**
 * Verdicted nodes plus answered required questions, over everything owed.
 * `null` when nothing is owed — a template-less survey with no seeded tree has
 * no denominator, and 0% would read as "nothing done" rather than "nothing
 * asked". Same reasoning as `notVisitedPct`.
 */
export function completenessPct(c: SurveyCounts): number | null {
  const owed = c.seededNodes + c.requiredQuestions;
  if (owed <= 0) return null;
  return pct(c.verdictedNodes + c.answeredRequired, owed);
}

/** `null` when nothing was ever seeded — see the file header. */
export function notVisitedPct(c: SurveyCounts): number | null {
  if (c.seededNodes <= 0) return null;
  return pct(c.notVisitedNodes, c.seededNodes);
}

export interface GuardResult {
  ok: boolean;
  /** Things that stop the move. Shown as errors. */
  blockers: string[];
  /** Things the person should see and may proceed past. */
  warnings: string[];
}

/**
 * T5 — `in_progress -> pending_review`. One guard, and v3 was missing it (F6):
 * no visit may still be open. The lead must cancel or no-show them first,
 * otherwise reconciliation runs against a tree nobody finished walking and
 * prices a building nobody saw.
 */
export function reviewGuard(c: SurveyCounts): GuardResult {
  const blockers: string[] = [];

  if (c.openVisits > 0) {
    blockers.push(
      `${c.openVisits} visit(s) still planned or in progress — cancel, no-show or complete them first`
    );
  }

  return { ok: blockers.length === 0, blockers, warnings: [] };
}

/**
 * T7 — `pending_review -> completed`. The full guard set from v1.7 §A1.8.
 * Mandatory-photo checking is not here: it is a per-observation rule the
 * capture path enforces at write time, against `survey.require_photo_below_condition`.
 */
export function submitGuard(
  c: SurveyCounts,
  reworkCount: number,
  settings: CompletenessSettings = DEFAULT_COMPLETENESS_SETTINGS
): GuardResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const unverdicted = c.seededNodes - c.verdictedNodes;
  if (unverdicted > 0) {
    blockers.push(`${unverdicted} seeded node(s) have no verdict`);
  }

  const unanswered = c.requiredQuestions - c.answeredRequired;
  if (unanswered > 0) {
    blockers.push(
      `${unanswered} required question(s) neither answered nor marked not-applicable`
    );
  }

  if (c.openReconciliationItems > 0) {
    blockers.push(`${c.openReconciliationItems} reconciliation item(s) still undecided`);
  }

  if (c.openVisits > 0) {
    blockers.push(`${c.openVisits} visit(s) still open`);
  }

  const nv = notVisitedPct(c);

  if (nv === null) {
    warnings.push(
      "no nodes were ever seeded, so coverage cannot be measured — not_visited_pct is published as null, not 0"
    );
  } else if (nv > 0 && !settings.allowCompleteWithNotVisited) {
    blockers.push(`${nv}% of seeded nodes were not visited and the org does not allow completing with unvisited nodes`);
  } else if (nv > settings.notVisitedWarnThresholdPct) {
    warnings.push(
      `${nv}% of seeded nodes were not visited — the estimator prices this with eyes open`
    );
  }

  if (reworkCount >= settings.reworkWarnAfterBounces) {
    warnings.push(`this survey has bounced back for rework ${reworkCount} times`);
  }

  return { ok: blockers.length === 0, blockers, warnings };
}

/**
 * `is_condition_survey_complete` — every in-scope space carries a condition
 * score. Gates comprehensive contracts, so it is derived, never typed in.
 */
export function isConditionSurveyComplete(spaces: number, scoredSpaces: number): boolean {
  return spaces > 0 && scoredSpaces >= spaces;
}
