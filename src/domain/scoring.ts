/**
 * Turning the analyst's raw score into something a queue can sort by, and
 * validating what the model gives back. Pure.
 *
 * Agent output is untrusted: a schema constrains shape, not truthfulness, so
 * everything here clamps and defaults rather than assuming the model behaved.
 */

export type Verdict = "relevant" | "not_relevant" | "outside_region";

export const VERDICTS: readonly Verdict[] = ["relevant", "not_relevant", "outside_region"];

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

export type ScoreBand = "hot" | "warm" | "cool" | "cold";

/** Bands exist so the UI and the queue agree on what "high priority" means. */
export function scoreBand(score: number): ScoreBand {
  if (score >= 75) return "hot";
  if (score >= 50) return "warm";
  if (score >= 25) return "cool";
  return "cold";
}

/** Clamp to 0-100 and round. Models drift outside declared bounds — the platform
 *  does not preserve `minimum`/`maximum` on a schema round-trip. */
export function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface AnalystResult {
  verdict: Verdict;
  score: number;
  band: ScoreBand;
  understanding: Record<string, unknown>;
  relevance: Record<string, unknown>;
  reasons: string[];
  recommendation: Record<string, unknown>;
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/**
 * Coerce whatever the agent returned into a shape the rest of the code can rely
 * on. Never throws: a malformed reply becomes a `not_relevant` score of 0, which
 * lands in the review queue rather than silently qualifying a lead.
 */
export function parseAnalystReply(raw: unknown): AnalystResult {
  const root = asObject(raw);
  const relevance = asObject(root.relevance);
  const scoreObj = asObject(root.score);

  const verdict = isVerdict(relevance.verdict) ? relevance.verdict : "not_relevant";
  const score = clampScore(
    typeof scoreObj.value !== "undefined" ? scoreObj.value : root.score
  );

  const reasons = [
    ...asStringArray(relevance.reasons),
    ...asStringArray(scoreObj.fitReasons),
    ...asStringArray(scoreObj.redFlags),
  ];

  return {
    verdict,
    score,
    band: scoreBand(score),
    understanding: asObject(root.understanding),
    relevance,
    reasons,
    recommendation: asObject(root.recommendation),
  };
}

/**
 * Queue ordering weight: overdue always outranks score, because a breached SLA
 * on a warm lead costs more than a cold lead sitting comfortably in time.
 */
export function queuePriority(input: { score: number; isOverdue: boolean }): number {
  return (input.isOverdue ? 1000 : 0) + clampScore(input.score);
}
