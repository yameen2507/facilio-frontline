/**
 * Stage vocabulary, rendered. One source for how a deal stage is coloured,
 * shared by the list rows, the detail header and the account page's deal table
 * — places that must never describe the same deal differently.
 */

import { Chip, type Tone } from "../../../ui/Chip";
import { STAGE_LABEL, type DealStage } from "../types/deal";

/**
 * The working funnel is blue once the conversation is commercial, neutral
 * while it is still being understood, orange while the ball is in the
 * customer's court — decision_pending is the stage a salesperson chases, the
 * way pending_approval reads on a proposal. Won/lost close green/red.
 */
const STAGE_TONE: Record<DealStage, Tone> = {
  opportunity: "neutral",
  discovery: "neutral",
  survey_required: "blue",
  survey_completed: "blue",
  estimation: "blue",
  proposal_submitted: "blue",
  negotiation: "orange",
  decision_pending: "orange",
  won: "green",
  lost: "red",
};

export const DealStageChip = ({ stage, small = false }: { stage: string; small?: boolean }) => (
  <Chip tone={STAGE_TONE[stage as DealStage] ?? "neutral"} dot={!small} small={small}>
    {STAGE_LABEL[stage as DealStage] ?? stage.replace(/_/g, " ")}
  </Chip>
);
