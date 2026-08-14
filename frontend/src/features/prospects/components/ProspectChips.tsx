/**
 * The portfolio's status vocabulary, as chips.
 *
 * FOUR different facts get chipped in this module and they are easy to confuse,
 * so the tones are assigned by what the user must DO, not by whether the news is
 * good:
 *
 *   verdict        — is it real?            (a walk answers it)
 *   decision       — are we bidding it?     (a person answers it)
 *   convert state  — is it in Facilio yet?  (winning answers it)
 *   provenance     — which feed said so     (never colour: it is not a state)
 *
 * Provenance is deliberately always neutral. It is not a status and nothing is
 * wrong with any of its values; colouring "From documents" orange would imply the
 * RFP is less trustworthy than the walk, which is a judgement the module refuses
 * to make on the user's behalf (C25 — both values are true statements from
 * different sources, and a person decides).
 */

import { Chip, type Tone } from "../../../ui/Chip";
import {
  CONVERT_STATE_LABEL,
  DECISION_LABEL,
  PROVENANCE_LABEL,
  TYPE_LABEL,
  VERDICT_LABEL,
  type ConvertState,
  type LocationType,
  type Provenance,
  type PursuitDecision,
  type Verdict,
} from "../types/prospect";

/**
 * `changed`, `not_found` and `not_visited` are red because each one PRINTS ON THE
 * PROPOSAL as a qualification — they are commitments being withdrawn from scope,
 * not merely survey findings. `unverified` is neutral rather than orange: nobody
 * has looked yet, which is the normal state of a freshly seeded tree and not a
 * problem to chase.
 */
const VERDICT_TONE: Record<Verdict, Tone> = {
  unverified: "neutral",
  added_on_site: "blue",
  verified: "green",
  changed: "red",
  not_found: "red",
  not_visited: "red",
};

export const VerdictChip = ({ verdict }: { verdict: Verdict }) => (
  <Chip tone={VERDICT_TONE[verdict] ?? "neutral"}>{VERDICT_LABEL[verdict] ?? verdict}</Chip>
);

/**
 * `no_bid` is red, and that is not a value judgement — it is the only decision
 * with a structural consequence: the row leaves every total and never converts,
 * so it must be impossible to miss while scanning a tree.
 */
const DECISION_TONE: Record<PursuitDecision, Tone> = {
  undecided: "neutral",
  bid: "green",
  no_bid: "red",
  deferred: "orange",
};

export const DecisionChip = ({ decision }: { decision: PursuitDecision }) => (
  <Chip tone={DECISION_TONE[decision] ?? "neutral"}>
    {DECISION_LABEL[decision] ?? decision}
  </Chip>
);

/**
 * `converted` and `already_linked` are both green and both mean "it is in the
 * CMMS" — but they arrived there differently, and the labels keep them apart
 * because only one of them was our write. `excluded` is neutral, not red: a
 * deliberate exclusion with a reason is a decision, not a failure.
 */
const CONVERT_TONE: Record<ConvertState, Tone> = {
  not_converted: "neutral",
  queued: "blue",
  converted: "green",
  convert_failed: "red",
  excluded: "neutral",
  already_linked: "green",
};

export const ConvertChip = ({ state }: { state: ConvertState }) => (
  <Chip tone={CONVERT_TONE[state] ?? "neutral"} dot>
    {CONVERT_STATE_LABEL[state] ?? state}
  </Chip>
);

/** Never coloured — see the file header. */
export const ProvenanceChip = ({ provenance }: { provenance: Provenance }) => (
  <Chip small>{PROVENANCE_LABEL[provenance] ?? provenance}</Chip>
);

/**
 * The level, shown only where position does not already say it.
 *
 * In the tree, indentation carries the level and a chip would be the same fact
 * printed twice — so the tree does not use this. The detail header and the
 * pre-flight rows do, because neither has a parent above it to indent from.
 */
export const TypeChip = ({
  type,
  clientLabel,
}: {
  type: LocationType;
  /** What the CLIENT calls this level. Theirs wins; ours goes in brackets. */
  clientLabel?: string | null;
}) => (
  <Chip small>
    {clientLabel?.trim() ? `${clientLabel.trim()} (${TYPE_LABEL[type].toLowerCase()})` : TYPE_LABEL[type]}
  </Chip>
);

/**
 * The discrepancy flag — the module's most important single piece of UI.
 *
 * It appears when a location that already exists in Facilio was found CHANGED on
 * the walk. Nothing was written and nothing will be: a bid-stage estimate must
 * never overwrite a maintained, contracted record (§7.3). The chip exists so that
 * "we wrote nothing" is visible rather than silent, because a silent no-op is
 * indistinguishable from a bug.
 */
export const DiscrepancyChip = () => (
  <Chip tone="orange" dot>
    Disagrees with Facilio
  </Chip>
);
