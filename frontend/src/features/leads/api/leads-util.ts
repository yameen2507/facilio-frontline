/**
 * The leads data layer.
 *
 * THESE ENDPOINTS ARE LIVE — there is no seam here. The `lead` function is built
 * and deployed, so every function below makes a real call and no `[SEAM]` tag
 * applies. Handlers, and what each returns:
 *
 * | handler             | returns                                              |
 * | ------------------- | ---------------------------------------------------- |
 * | `list`              | `{ leads: Lead[] }`                                  |
 * | `get`               | `LeadDetail`                                         |
 * | `claim`             | `{ detail }`                                         |
 * | `log-activity`      | `{ detail }`                                         |
 * | `transition`        | `{ detail }`                                         |
 * | `update`            | `{ detail }`                                         |
 * | `assign`            | `{ detail }`                                         |
 * | `convert`           | `{ detail, dealRefNo, queued[] }`                    |
 * | `analyse-input`     | `{ agent, input }` — the prompt, built from settings  |
 * | `analyse`           | `{ detail, verdict, score }`                          |
 * | `intake-transcript` | `{ messages: TranscriptMessage[] }`                  |
 *
 * EVERY MUTATION RETURNS THE REFRESHED `detail`. That is not incidental — every
 * request to this app costs about a second before it does any work, so a click
 * that mutates and then re-reads pays that twice. Callers render from the returned
 * detail instead of asking again.
 */

import { request } from "../../../lib/request";
import type { Lead, LeadDetail, TranscriptMessage } from "../types/lead";

/** The page size the inbox asks for. The handler has no cursor; this is the cap. */
export const LIST_LIMIT = 100;

export const listLeads = () => request<{ leads: Lead[] }>("list", { limit: LIST_LIMIT });

export const getLead = (leadId: string) => request<LeadDetail>("get", { leadId });

type Mutation = { detail: LeadDetail };

export const claimLead = (leadId: string, actorEmail: string) =>
  request<Mutation>("claim", { leadId, actorEmail });

export const logCall = (leadId: string, body: string, actorEmail: string) =>
  request<Mutation>("log-activity", { leadId, kind: "call", body, actorEmail });

export const transitionLead = (
  leadId: string,
  toStatus: string,
  actorEmail: string,
  extra: { note?: string; dispositionReason?: string } = {}
) => request<Mutation>("transition", { leadId, toStatus, actorEmail, ...extra });

export const updateLead = (leadId: string, fields: Record<string, unknown>, actorEmail: string) =>
  request<Mutation>("update", { leadId, actorEmail, ...fields });

export const assignLead = (leadId: string, toUser: string, role: "sales" | "actioner", actorEmail: string) =>
  request<Mutation>("assign", { leadId, toUser, role, reason: "assigned from the lead view", actorEmail });

export const convertLead = (leadId: string, actorEmail: string) =>
  request<Mutation & { dealRefNo: string; queued: unknown[] }>("convert", { leadId, actorEmail });

/**
 * Step one of the assessment. The prompt is built server-side from settings so the
 * scope brief that drives relevance is never duplicated in the client.
 */
export const analyseInput = (leadId: string) => request<{ agent: string; input: string }>("analyse-input", { leadId });

/** Step three: the model's reply, parsed, clamped and stored as a new version. */
export const storeAnalysis = (leadId: string, replyJson: string) =>
  request<Mutation & { verdict: string; score: number }>("analyse", { leadId, replyJson });

export const getTranscript = (sessionToken: string) =>
  request<{ messages: TranscriptMessage[] }>("intake-transcript", { sessionToken });
