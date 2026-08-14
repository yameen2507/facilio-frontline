/**
 * Status vocabulary, rendered. One source for how a proposal state is coloured,
 * shared by the list rows, the detail header and the diff pane — three places
 * that must never describe the same proposal differently.
 *
 * The one worth reading twice is EXPIRY. `status` arrives computed and
 * `storedStatus` arrives stored (see types/proposal.ts), so a lapsed offer is
 * chipped "Expired" while the record still says sent. That is deliberate: the
 * chip reports what is true today, and the Details pane reports what the column
 * holds. Chipping the stored value would tell a salesperson an offer is live
 * when it lapsed last week.
 */

import { Chip, type Tone } from "../../../ui/Chip";
import {
  FREQUENCY_LABEL,
  PRICING_MODE_LABEL,
  PROPOSAL_STATUS_LABEL,
  type Frequency,
  type PricingMode,
  type ProposalStatus,
} from "../types/proposal";

const PROPOSAL_TONE: Record<ProposalStatus, Tone> = {
  draft: "neutral",
  // The only state where somebody else is holding the work up.
  pending_approval: "orange",
  approved: "blue",
  sent: "blue",
  accepted: "green",
  rejected: "red",
  // Red, not neutral: an expired offer is a price we are no longer honouring,
  // and it must never read as merely "old".
  expired: "red",
  // Neither of these is a failure — a newer revision went out, or we pulled it.
  superseded: "neutral",
  withdrawn: "neutral",
};

export const ProposalStatusChip = ({ status }: { status: ProposalStatus }) => (
  <Chip tone={PROPOSAL_TONE[status] ?? "neutral"} dot>
    {PROPOSAL_STATUS_LABEL[status] ?? status}
  </Chip>
);

/**
 * A pricing mode. Standard is deliberately quiet and everything else is not:
 * on a table of forty lines the only ones worth finding are the ones that moved
 * off the card, and a discount and a markup must not look alike — one costs the
 * business money and the other does not.
 */
const MODE_TONE: Record<PricingMode, Tone> = {
  standard: "neutral",
  discount: "orange",
  markup: "blue",
  // A custom line has no card rate behind it to check the number against, which
  // is why it always reaches an approver.
  custom: "red",
};

export const PricingModeChip = ({ mode, small = false }: { mode: string; small?: boolean }) => (
  <Chip tone={MODE_TONE[mode as PricingMode] ?? "neutral"} small={small}>
    {PRICING_MODE_LABEL[mode as PricingMode] ?? mode}
  </Chip>
);

/**
 * How often a line recurs. Neutral always: a frequency is a fact about the
 * contract, not a state anyone needs alerting to — and a column of coloured
 * frequencies would drown the modes that DO need finding.
 */
export const FrequencyChip = ({ frequency }: { frequency: string | null | undefined }) => (
  <Chip tone="neutral" small>
    {FREQUENCY_LABEL[(frequency ?? "one_time") as Frequency] ?? frequency}
  </Chip>
);

/**
 * Time left on the offer, stated the way a salesperson thinks about it: the
 * absolute number of days, not a percentage of a window.
 *
 * Null is NOT zero. Null means no validity was ever set, so nothing is running
 * out; zero means it runs out today. Rendering the first as "0 days" would put
 * a proposal nobody dated at the top of the chase list.
 */
export function ExpiryChip({ days }: { days: number | null | undefined }) {
  if (days === null || days === undefined) {
    return (
      <span className="text-muted-foreground text-sm" title="No validity date has been set on this proposal">
        No expiry set
      </span>
    );
  }

  if (days < 0) {
    return (
      <Chip tone="red">{`Lapsed ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago`}</Chip>
    );
  }

  // A week is the point at which chasing stops being optional.
  return (
    <Chip tone={days <= 7 ? "orange" : "neutral"}>
      {days === 0 ? "Expires today" : `${days} ${days === 1 ? "day" : "days"} left`}
    </Chip>
  );
}
