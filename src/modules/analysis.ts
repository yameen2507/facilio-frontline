/**
 * Running the lead-analyst agent and storing its verdict.
 *
 * Server-side agent calls go through the ai-studio connection, not an agents
 * base URL: the run injects `AGENTS_TOKEN` but NOT `AGENTS_URL` (verified), so
 * `process.system.CONNECTIONS_URL` + the `facilio-ai-studio` connection is the
 * only reachable path. It is two serialised fetches — create thread, then chat.
 *
 * The verdict NEVER writes `fl_lead.status`. A human decides; the agent advises.
 * That separation is what makes the override rate measurable, which is the metric
 * that eventually justifies auto-closing low scores.
 */

import { mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";
import { executeAction } from "../shared/facilio";
import { parseAgentContent } from "../domain/agent-reply";
import { parseAnalystReply, type AnalystResult } from "../domain/scoring";
import {
  type ConfigData,
  configData,
  coverageBrief,
  DEFAULT_ANALYST_TASK,
  getSetting,
  promptConfig,
  promptEdited,
} from "./settings";
import { getLead } from "./lead";

/**
 * The ai-studio actions address an agent by its flow-ai **link name**, which the
 * platform suffixes with the app's id — `lead-analyst_<appuuid>`, not
 * `lead-analyst`. It is held in settings rather than hardcoded so it can be
 * corrected without a rebuild, and so a re-created agent is a config change.
 */
/** Re-exported: this module was where callers first found it. */
export { parseAgentContent };

export const ANALYST_AGENT_SETTING = "lead.analyst_agent";
export const ANALYST_LINK_SETTING = "lead.analyst_agent_link";

/**
 * An agent has TWO identifiers and they are not interchangeable:
 *
 *   logical name  `lead-analyst`              → `vibe.executeAgent` in the browser,
 *                                               which resolves by (app, name)
 *   link name     `lead-analyst_<appuuid>`    → the ai-studio connection actions
 *
 * Passing the link name to the browser SDK returns 404 "agent not found".
 */
export function analystAgentName(data?: ConfigData): string {
  if (data) {
    const v = data.settings[ANALYST_AGENT_SETTING];
    return typeof v === "string" && v ? v : "lead-analyst";
  }
  return getSetting<string>(ANALYST_AGENT_SETTING, "lead-analyst");
}

/** Link name, for the server-side path only. */
export function analystAgentLink(): string {
  const configured = getSetting<string>(ANALYST_LINK_SETTING, "");
  if (!configured) {
    throw new Error(
      `no analyst link name configured — set "${ANALYST_LINK_SETTING}" from \`facilio vibe agent get lead-analyst\``
    );
  }
  return configured;
}

export interface AnalystIdentity {
  name: string;
  link: string;
  /** Blank `link` is a normal state, not an error — only the server path needs it. */
  linkConfigured: boolean;
}

/**
 * Who the analyst is, for display. Deliberately does NOT throw on a missing
 * link name: the settings screen has to be able to show that it is unset, which
 * is exactly the state `analystAgentLink()` refuses to return.
 */
export function analystIdentity(data?: ConfigData): AnalystIdentity {
  // Two settings reads, or none when the caller already fetched the config.
  const link = data
    ? data.settings[ANALYST_LINK_SETTING] ?? ""
    : getSetting<string>(ANALYST_LINK_SETTING, "");

  return {
    name: analystAgentName(data),
    link: typeof link === "string" ? link : "",
    linkConfigured: typeof link === "string" && link.trim() !== "",
  };
}

/**
 * How to read a gap, stated in the input rather than in the agent's own
 * instructions — those are fixed when the agent is created, so a correctness
 * rule that lives there cannot be fixed without re-creating it.
 *
 * NOT operator-editable, unlike the closing task line. This is not tuning: an
 * analyst that invents a city produces a verdict about a place the enquiry never
 * mentioned, and no amount of retuning the task makes that acceptable.
 */
const READING_RULES = [
  "HOW TO READ THIS LEAD:",
  '- "not stated" means the enquiry did not say. It is not permission to assume.',
  "- Never infer a city, region or service from the SERVICE SCOPE above. That list is what we sell and where — it is not evidence about where THIS lead is.",
  "- With the location not stated you cannot conclude outside_region, and you cannot conclude the site is in one of our areas either. Say plainly in the summary that the location is unknown, and let the score carry that doubt instead of resolving it with a guess.",
  "- The currency is evidence about location. Our areas quote in AED, SAR, OMR, QAR, KWD and BHD; a budget in any other currency is a reason to doubt the site is in our region, not something to pass over.",
].join("\n");

/** Everything the analyst needs, as plain text. */
export function buildAnalystInput(lead: {
  companyName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteDomain: string | null;
  serviceType: string | null;
  description: string | null;
  siteAddress: string | null;
  siteCity: string | null;
  siteRegion: string | null;
  estimatedValue: number | null;
  currency: string | null;
  source: string;
}, data: ConfigData = configData()): string {
  /** Absent, so the line is dropped. Used where silence carries no meaning: a
      missing phone number tells the analyst nothing about scope. */
  const field = (label: string, value: unknown) =>
    value === null || value === undefined || value === "" ? null : `${label}: ${String(value)}`;

  /**
   * Absent, and SAID SO.
   *
   * Only for the fields the verdict actually turns on. A dropped line is
   * indistinguishable from a field that does not apply, so a lead with no city
   * used to reach the analyst as a scope list headed by our areas and nothing
   * contradicting it — and it answered with the first area on the list. Naming
   * the gap is what makes "we were not told" an available thought.
   *
   * Not applied to the contact fields on purpose: five "not stated" lines that
   * change no verdict only dilute the two that do.
   */
  const scopeField = (label: string, value: unknown) =>
    value === null || value === undefined || value === ""
      ? `${label}: not stated`
      : `${label}: ${String(value)}`;

  const lines = [
    coverageBrief(data),
    "",
    "LEAD:",
    field("Company", lead.companyName),
    field("Contact", lead.contactName),
    field("Email", lead.contactEmail),
    field("Phone", lead.contactPhone),
    field("Website", lead.websiteDomain),
    scopeField("Service asked for", lead.serviceType),
    field("Site address", lead.siteAddress),
    scopeField("City", lead.siteCity),
    scopeField("Region", lead.siteRegion),
    scopeField(
      "Stated budget",
      lead.estimatedValue ? `${lead.estimatedValue} ${lead.currency ?? ""}`.trim() : null
    ),
    field("Channel", lead.source),
    scopeField("Enquiry", lead.description),
    "",
    READING_RULES,
    "",
    // Editable from Settings. The agent's own instructions cannot be changed at
    // runtime, so this closing line is where an operator retunes the task.
    promptConfig(data).analystTask.trim() || DEFAULT_ANALYST_TASK,
  ].filter((l): l is string => l !== null);

  return lines.join("\n");
}

interface AgentReply {
  content: string;
  threadId: string | null;
}

/**
 * Two-step: a thread, then a message. `run-agent-chat` requires a threadId, and
 * a fresh thread per lead keeps one lead's assessment out of another's context.
 */
async function askAgent(agent: string, message: string): Promise<AgentReply> {
  const thread = await executeAction("facilio-ai-studio", "create-chat-thread", {
    agent,
    title: "lead analysis",
  });

  const threadId = thread.recordId;
  if (!threadId) {
    throw new Error(`could not create a chat thread for agent "${agent}"`);
  }

  const chat = await executeAction("facilio-ai-studio", "run-agent-chat", {
    agent,
    threadId: Number(threadId),
    message,
  });

  const content = findContent(chat.raw);
  if (!content) {
    throw new Error(`agent "${agent}" returned no readable content`);
  }

  return { content, threadId };
}

/** Agent responses are not shape-normalised, so look for the reply text. */
function findContent(node: unknown, depth = 0): string | null {
  if (typeof node === "string") return node.trim() ? node : null;
  if (!node || typeof node !== "object" || depth > 6) return null;

  const obj = node as Record<string, unknown>;

  for (const key of ["content", "message", "reply", "text", "output", "response"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v;
  }

  for (const key of Object.keys(obj)) {
    const found = findContent(obj[key], depth + 1);
    if (found) return found;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findContent(item, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/** Persist a verdict as a new version and snapshot it onto the lead for the queue. */
export function storeAnalysis(
  leadId: string,
  result: AnalystResult,
  meta: { modelName?: string | null; promptVersion?: string | null; raw?: unknown }
): { version: number } {
  const now = nowIso();

  const last = one<{ version: number }>(
    "select version from fl_lead_analysis where lead_id = $1 order by version desc limit 1",
    [leadId]
  );
  const version = (last?.version ?? 0) + 1;

  mutate(
    `insert into fl_lead_analysis
       (id, lead_id, version, verdict, score, understanding_json, relevance_json,
        reasons_json, recommendation_json, model_name, prompt_version,
        data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
    [
      leadId,
      version,
      result.verdict,
      result.score,
      JSON.stringify(result.understanding),
      JSON.stringify(result.relevance),
      JSON.stringify(result.reasons),
      JSON.stringify(result.recommendation),
      meta.modelName ?? null,
      meta.promptVersion ?? null,
      JSON.stringify({ raw: meta.raw ?? null }),
      now, // $12 — created_at and updated_at both
    ]
  );

  // Denormalised onto the lead so the queue can sort and filter without a join —
  // there are no indexes, so a per-row lookup at read time would be far worse.
  mutate(
    "update fl_lead set score = $2, verdict = $3, analysed_at = $4, updated_at = $4 where id = $1",
    [leadId, result.score, result.verdict, now]
  );

  appendEvent({
    entityType: "lead",
    entityId: leadId,
    kind: "analysed",
    actor: "lead-analyst",
    body: `${result.verdict} · score ${result.score} (${result.band})`,
    meta: { version, verdict: result.verdict, score: result.score, reasons: result.reasons },
  });

  return { version };
}

export interface AnalyseResult {
  leadId: string;
  version: number;
  verdict: string;
  score: number;
  band: string;
  reasons: string[];
  source: "agent" | "supplied";
}

/**
 * Analyse a lead. `replyJson` lets a caller supply an already-obtained agent
 * reply — used for CLI testing and as a fallback while the agent is being tuned,
 * so the pipeline can be exercised without burning model calls.
 */
export async function analyseLead(input: {
  leadId: string;
  replyJson?: unknown;
  agent?: string;
}): Promise<AnalyseResult> {
  const lead = getLead(input.leadId);
  if (!lead) throw new Error(`lead ${input.leadId} not found`);

  let raw: unknown;
  let source: "agent" | "supplied";

  if (input.replyJson !== undefined && input.replyJson !== null) {
    raw = typeof input.replyJson === "string" ? parseAgentContent(input.replyJson) : input.replyJson;
    source = "supplied";
  } else {
    const agent = input.agent ?? analystAgentLink();
    const reply = await askAgent(agent, buildAnalystInput(lead));
    raw = parseAgentContent(reply.content);
    source = "agent";
  }

  const result = parseAnalystReply(raw);
  const { version } = storeAnalysis(input.leadId, result, {
    modelName: source === "agent" ? analystAgentName() : "supplied",
    // Now that the prompt is editable, a stored verdict has to say whether it
    // came from the shipped wording — otherwise a shift in scores after someone
    // retunes Settings is indistinguishable from model drift.
    promptVersion: promptEdited() ? "v1-edited" : "v1",
    raw,
  });

  return {
    leadId: input.leadId,
    version,
    verdict: result.verdict,
    score: result.score,
    band: result.band,
    reasons: result.reasons,
    source,
  };
}
