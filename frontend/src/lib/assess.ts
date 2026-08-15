/**
 * Running an advisory agent from the page.
 *
 * THE MODEL CALL HAS TO HAPPEN HERE. A platform function aborts at the ~10s
 * fetch timeout and these agents take longer, so the round trip is three legs:
 * the server builds the prompt from the tables, the browser calls the agent,
 * the server stores what came back. Exactly the shape the lead analyst has used
 * since it shipped (`features/leads/pages/LeadDetail.tsx`), generalised here
 * because five agents now share it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: compose the prompt. Each agent's input
 * contract names its blocks — PROPOSAL_DRAFT, VALIDATED_SURVEY, CURRENT_DATE —
 * and an agent handed a block under a different name reports the data as
 * absent, silently and plausibly. So the wording stays on the server, in
 * `src/modules/agent-brief.ts`, and this file only carries it.
 *
 * `agent` is the LOGICAL name (`proposal-intelligence`). The app-suffixed link
 * name addresses the server-side ai-studio actions instead; passing it to the
 * browser SDK returns 404 "agent not found".
 */

import { errMessage, requestFrom, type Result } from "./request";
import { vibe } from "./vibe";

/** The wired agents, by logical name. */
export type AgentName =
  | "proposal-intelligence"
  | "estimation-intelligence"
  | "survey-intelligence"
  | "lost-deal-intelligence"
  | "handover-intelligence"
  | "lead-intelligence";

/** One stored verdict, as every detail read now returns it. */
export type Assessment = {
  id: string;
  agent: AgentName;
  version: number;
  /** The agent's headline enum, already clamped server-side — or null if it
      answered with something outside its own schema. */
  status: string | null;
  headline: string | null;
  summary: string | null;
  /** The whole verdict, verbatim. Every value is a string. */
  fields: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
};

type Brief = { agent: string; input: string };

/**
 * Build, call, store. Returns whatever the store handler returned — each
 * feature's own refreshed detail — so the caller re-renders from one shape.
 *
 * Errors come back as `Result.error` rather than thrown, matching `request`:
 * the page has to render the failure either way.
 */
export async function runAssessment<T>(
  fn: string,
  idField: string,
  entityId: string,
  agent: AgentName,
  actorEmail: string
): Promise<Result<T>> {
  const prep = await requestFrom<Brief>(fn, "assess-input", { [idField]: entityId, agent });
  if (prep.error || !prep.data) {
    return { data: null, error: prep.error ?? "The brief could not be built" };
  }

  let content: string | undefined;
  try {
    const reply = await vibe.executeAgent<{ response?: { content?: string } }>(
      prep.data.agent,
      prep.data.input
    );
    content = reply?.response?.content;
  } catch (err) {
    return { data: null, error: errMessage(err, `${agent} could not be reached`) };
  }

  if (!content) return { data: null, error: `${agent} returned nothing` };

  // Parsed server-side, not here: the fence-and-prose tolerance lives in one
  // place (`src/domain/agent-reply.ts`) and the store is what has to trust it.
  return requestFrom<T>(fn, "assess-store", {
    [idField]: entityId,
    agent,
    replyJson: content,
    actorEmail,
  });
}
