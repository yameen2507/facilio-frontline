/**
 * The three cells that appear in both the inbox row and the lead header.
 *
 * Kept together because they encode the same thing — how a lead's state is
 * coloured — and splitting them across files is how two screens end up disagreeing
 * about what "qualified" looks like.
 */

import { Chip, type Tone } from "../../../ui/Chip";
import { RowStat } from "../../../ui/Row";
import { humanise, shortDuration } from "../../../lib/format";
import type { Lead, LeadStatus, Sla } from "../types/lead";

const STATUS_TONE: Record<LeadStatus, Tone> = {
  new: "blue",
  in_review: "neutral",
  contacted: "neutral",
  qualified: "green",
  nurture: "orange",
  converted: "green",
  closed: "neutral",
};

export const StatusChip = ({ status }: { status: LeadStatus }) => (
  <Chip tone={STATUS_TONE[status] ?? "neutral"} dot>
    {humanise(status)}
  </Chip>
);

/**
 * The response clock, as one chip.
 *
 * Three outcomes, and the order matters: overdue wins over everything, then
 * "nothing left to wait for" reads as on time, and only then the countdown.
 */
export function SlaChip({ sla }: { sla?: Sla | null }) {
  if (!sla) return null;
  if (sla.isOverdue) {
    return <Chip tone="red">{`${humanise(sla.breached[0])} late`}</Chip>;
  }
  if (!sla.nextDue) return <Chip tone="green">on time</Chip>;
  return <Chip>{`${shortDuration(sla.nextDue.minutesRemaining)} left`}</Chip>;
}

/**
 * Score with its band beneath. An unscored lead says so rather than showing a
 * zero — the two mean opposite things to whoever is triaging.
 */
export const ScoreCell = ({ lead }: { lead: Pick<Lead, "score" | "band"> }) => (
  <RowStat value={lead.score ?? null} unit={lead.score === null || lead.score === undefined ? "not scored" : (lead.band ?? "")} />
);
