/**
 * One store for every advisory agent verdict.
 *
 * WHY THIS IS GENERIC AND `fl_lead_analysis` IS NOT. The lead analyst returns a
 * SHAPE the app reasons about — a 0-100 score and a verdict enum that the inbox
 * sorts and filters on — so it earned promoted columns and a denormalisation
 * onto `fl_lead`. The five agents wired here return something else entirely: a
 * flat map of prose strings, tens of fields wide, differing only in which keys
 * they fill. Nothing sorts on them. So they share one table, keyed like
 * `fl_event`, and the verdict rides whole in `data_json`.
 *
 * WHAT IS PROMOTED, AND WHY ONLY THAT. A panel has to render a colour and a
 * heading before anyone parses JSON, so each agent nominates one enum for
 * `status`, optionally a second for `headline`, and one prose field for
 * `summary`. Everything else stays in `data_json` and is read by the panel that
 * knows what it means.
 *
 * WHAT NEVER HAPPENS HERE. No assessment writes its entity's own columns. Not
 * the proposal's status, not the survey's, not the deal's stage. The agents are
 * all built to advise and refuse to decide — several say so in their own
 * guardrails — and a row that quietly moved a proposal to "not ready" would be
 * an agent making a commercial decision. A human reads the panel and acts.
 */

import { parseAgentContent } from "../domain/agent-reply";
import { many, mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";

export type AssessmentEntity = "lead" | "survey" | "proposal" | "deal";

/**
 * Which of an agent's fields are worth a column.
 *
 * `statusValues` is not decoration — it is the integrity check. These agents
 * are schema-constrained but the reply still arrives as text, and a status the
 * UI has no colour for is worse than no status at all. An off-enum value lands
 * as null and survives in `data_json`, so nothing is lost and nothing lies.
 */
export interface AgentSpec {
  entity: AssessmentEntity;
  /** What the panel calls this run. */
  label: string;
  statusField: string;
  statusValues: readonly string[];
  /** A second enum worth promoting, where the agent has one. */
  headlineField: string | null;
  headlineValues: readonly string[];
  /** The agent's own one-line prose, for the panel header. */
  summaryField: string;
}

/**
 * The wired agents, by LOGICAL name — what `vibe.executeAgent` resolves in
 * the browser. The app-suffixed link name addresses the server-side ai-studio
 * actions instead and is never used here; passing one where the other belongs
 * returns "agent not found".
 *
 * Every field name and every enum value below is copied from the agent's own
 * `output_schema` (`facilio vibe agent get <name>`). They are fixed at agent
 * create/update and there is no runtime path to them, so if one changes there,
 * it changes here — that is the whole reason they are written down in one place.
 */
export const AGENTS = {
  "proposal-intelligence": {
    entity: "proposal",
    label: "Pre-send check",
    statusField: "preSendReadiness",
    statusValues: [
      "Ready to Send",
      "Ready with Minor Corrections",
      "Not Ready - Missing Requirements",
      "Not Ready - Commercial Inconsistency",
      "Not Ready - Tender Compliance Risk",
      "Not Ready - Scope/Quantity Conflict",
    ],
    headlineField: "severity",
    headlineValues: ["Critical", "High", "Medium", "Low", "None"],
    summaryField: "proposalSummary",
  },
  "estimation-intelligence": {
    entity: "proposal",
    label: "Pricing review",
    statusField: "commercialReadiness",
    statusValues: [
      "Ready for Commercial Review",
      "Ready with Minor Exceptions",
      "Not Ready - Missing Information",
      "Not Ready - Rate Card Exception",
      "Not Ready - Conflicting Information",
    ],
    headlineField: "estimationStatus",
    headlineValues: ["Ready", "Ready with Exceptions", "Not Ready"],
    summaryField: "estimationSummary",
  },
  "survey-intelligence": {
    entity: "survey",
    label: "Survey review",
    statusField: "commercialReadiness",
    statusValues: [
      "Ready for Estimation",
      "Ready with Minor Gaps",
      "Not Ready - Missing Information",
      "Not Ready - Conflicting Information",
    ],
    headlineField: "surveyStatus",
    headlineValues: ["Complete", "Mostly Complete", "Incomplete", "Insufficient Data"],
    summaryField: "surveySummary",
  },
  "lost-deal-intelligence": {
    entity: "deal",
    label: "Loss analysis",
    statusField: "confidence",
    statusValues: ["Confirmed", "Strong Signal", "Possible", "Unknown"],
    headlineField: null,
    headlineValues: [],
    summaryField: "lossSummary",
  },
  "handover-intelligence": {
    entity: "deal",
    label: "Operations handover",
    statusField: "operationalReadiness",
    statusValues: [
      "Ready for Operations",
      "Ready with Minor Actions",
      "Not Ready - Missing Information",
      "Not Ready - Scope Conflict",
      "Not Ready - Commercial/Approval Dependency",
    ],
    headlineField: "handoverStatus",
    headlineValues: ["Ready", "Minor Actions", "Not Ready"],
    summaryField: "handoverSummary",
  },
  "lead-intelligence": {
    entity: "lead",
    label: "Lead intelligence",
    statusField: "actionerPriority",
    statusValues: ["P1", "P2", "P3", "Unknown"],
    headlineField: "outOfScope",
    headlineValues: ["true", "false", "unknown"],
    summaryField: "aiSummary",
  },
} as const satisfies Record<string, AgentSpec>;

export type AgentName = keyof typeof AGENTS;

export const AGENT_NAMES = Object.keys(AGENTS) as AgentName[];

export function agentSpec(name: string): AgentSpec {
  const spec = (AGENTS as Record<string, AgentSpec>)[name];
  if (!spec) {
    throw new Error(`unknown agent "${name}" — wired agents are ${AGENT_NAMES.join(", ")}`);
  }
  return spec;
}

/** The agents that assess a given entity — what a page offers as buttons. */
export function agentsFor(entity: AssessmentEntity): AgentName[] {
  return AGENT_NAMES.filter((n) => AGENTS[n].entity === entity);
}

// --- reading the reply --------------------------------------------------------

/**
 * Match against the declared enum, tolerantly on case and spacing but never on
 * meaning: "ready to send" becomes "Ready to Send", "Nearly ready" becomes null.
 * A near-miss is still a miss — the panel colours by this value.
 */
function clamp(value: unknown, allowed: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  const norm = value.trim().toLowerCase();
  if (!norm) return null;
  return allowed.find((a) => a.toLowerCase() === norm) ?? null;
}

/** One line of the agent's own prose. Trimmed to what a header can hold. */
function readSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 600) : null;
}

export interface Assessment {
  id: string;
  entityType: AssessmentEntity;
  entityId: string;
  agent: string;
  version: number;
  status: string | null;
  headline: string | null;
  summary: string | null;
  /** The agent's whole verdict, verbatim. */
  fields: Record<string, unknown>;
  modelName: string | null;
  promptVersion: string | null;
  createdBy: string | null;
  createdAt: string;
}

const COLUMNS = `id, entity_type, entity_id, agent, version, status, headline, summary,
  data_json, model_name, prompt_version, created_by, created_at`;

interface StoredRow {
  id: string;
  entityType: AssessmentEntity;
  entityId: string;
  agent: string;
  version: number;
  status: string | null;
  headline: string | null;
  summary: string | null;
  data: { fields?: Record<string, unknown> } | null;
  modelName: string | null;
  promptVersion: string | null;
  createdBy: string | null;
  createdAt: string;
}

const toAssessment = (row: StoredRow): Assessment => ({
  id: row.id,
  entityType: row.entityType,
  entityId: row.entityId,
  agent: row.agent,
  version: row.version,
  status: row.status,
  headline: row.headline,
  summary: row.summary,
  fields: row.data?.fields ?? {},
  modelName: row.modelName,
  promptVersion: row.promptVersion,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
});

/**
 * The rows a detail page shows: the newest run of each agent for this entity.
 *
 * Rows arrive newest first AND highest version first, because `created_at` is a
 * whole-second ISO string: two runs of the same agent within one second tie on
 * time, and the version is the field that actually orders them.
 *
 * Folded in JS rather than asked for with `distinct on`, because the batched
 * detail reads that call this already carry the rows — see `assessmentSubquery`.
 */
export function foldLatest(rows: unknown): Assessment[] {
  const list = Array.isArray(rows) ? (rows as StoredRow[]) : [];
  const seen = new Set<string>();
  const out: Assessment[] = [];
  for (const row of list) {
    if (!row?.agent || seen.has(row.agent)) continue;
    seen.add(row.agent);
    out.push(toAssessment(row));
  }
  return out;
}

/**
 * The assessments slice of a batched detail read, newest first.
 *
 * Exists so the four detail pages pay NO extra query for their panel: every
 * `query()` costs ~194ms of fixed bridge overhead whatever it does
 * (shared/db.ts), and a per-page assessment lookup would be a fifth of a second
 * on the four busiest reads in the app. `$n` is whichever parameter already
 * holds the entity id in the caller's statement.
 */
export const assessmentSubquery = (entityType: AssessmentEntity, param: string): string =>
  `(select coalesce(json_agg(x order by x.created_at desc, x.version desc), '[]'::json) from (
      select ${COLUMNS} from fl_assessment
       where entity_type = '${entityType}' and entity_id = ${param} and is_active = 'true'
       order by created_at desc, version desc
       limit 40
    ) x)`;

/** The standalone read, for callers with no batched statement to ride on. */
export function latestAssessments(entity: AssessmentEntity, entityId: string): Assessment[] {
  return foldLatest(
    many<StoredRow>(
      `select ${COLUMNS} from fl_assessment
        where entity_type = $1 and entity_id = $2 and is_active = 'true'
        order by created_at desc, version desc limit 40`,
      [entity, entityId]
    )
  );
}

// --- writing ------------------------------------------------------------------

export interface StoreInput {
  agent: string;
  entityId: string;
  /** The agent's reply, already parsed out of `response.content`. */
  reply: unknown;
  actor?: string | null;
  /** Whether the input carried an operator-edited prompt, as the analyst records. */
  promptVersion?: string | null;
}

export interface StoreResult {
  agent: string;
  version: number;
  status: string | null;
  headline: string | null;
  summary: string | null;
}

/**
 * Persist a verdict as a new version. Never updates in place: a second opinion
 * on the same proposal is a second row, because "what did it say before we
 * changed the price" is the question this store exists to answer.
 *
 * Returns the headline only. The caller hands back the entity's own detail —
 * which now carries the assessments — so the page re-renders from one shape
 * instead of stitching a stored row into the one it already had.
 */
export function storeAssessment(input: StoreInput): StoreResult {
  const spec = agentSpec(input.agent);

  if (!input.reply || typeof input.reply !== "object" || Array.isArray(input.reply)) {
    throw new Error(`${input.agent} returned no object to store`);
  }
  const fields = input.reply as Record<string, unknown>;

  const status = clamp(fields[spec.statusField], spec.statusValues);
  const headline = spec.headlineField
    ? clamp(fields[spec.headlineField], spec.headlineValues)
    : null;
  const summary = readSummary(fields[spec.summaryField]);

  // Versioned per (entity, agent) — the pricing review's v3 has nothing to do
  // with the pre-send check's v1, even on the same proposal.
  const last = one<{ version: number }>(
    `select version from fl_assessment
      where entity_type = $1 and entity_id = $2 and agent = $3 and is_active = 'true'
      order by version desc limit 1`,
    [spec.entity, input.entityId, input.agent]
  );
  const version = (last?.version ?? 0) + 1;

  const now = nowIso();

  mutate(
    `insert into fl_assessment
       (id, entity_type, entity_id, agent, version, status, headline, summary,
        data_json, model_name, prompt_version, created_by, is_active,
        created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'true', $12, $12)`,
    [
      spec.entity,
      input.entityId,
      input.agent,
      version,
      status,
      headline,
      summary,
      JSON.stringify({ fields }),
      input.agent,
      input.promptVersion ?? "v1",
      input.actor ?? null,
      now,
    ]
  );

  appendEvent({
    entityType: spec.entity,
    entityId: input.entityId,
    kind: "assessed",
    // The agent, not the person — the timeline should read as the agent speaking.
    actor: input.agent,
    body: `${spec.label}: ${status ?? "no status returned"}`,
    meta: { agent: input.agent, version, status, headline },
  });

  return { agent: input.agent, version, status, headline, summary };
}

/**
 * The one entry point the four function handlers share: take whatever the
 * browser got back from `vibe.executeAgent`, and store it.
 *
 * The reply may arrive as the JSON string the agent actually returned, or as an
 * object a caller already parsed — the CLI and the test harness pass the latter.
 * Both are accepted so the pipeline can be exercised without a model call.
 */
export function receiveAssessment(input: {
  agent: string;
  entityId: string;
  reply: unknown;
  actor?: string | null;
}): StoreResult {
  if (input.reply === undefined || input.reply === null || input.reply === "") {
    throw new Error(`no reply supplied for ${input.agent}`);
  }

  const parsed =
    typeof input.reply === "string" ? parseAgentContent(input.reply) : input.reply;

  return storeAssessment({
    agent: input.agent,
    entityId: input.entityId,
    reply: parsed,
    actor: input.actor,
  });
}
