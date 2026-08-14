/**
 * The leads data layer.
 *
 * THESE ENDPOINTS ARE LIVE — there is no seam here. The `lead` function is built
 * and deployed, so every function below makes a real call and no `[SEAM]` tag
 * applies. Handlers, and what each returns:
 *
 * | handler             | returns                                              |
 * | ------------------- | ---------------------------------------------------- |
 * | `create`            | `{ leadId, refNo, status, duplicateOf }`             |
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
 * EVERY MUTATION ON AN EXISTING LEAD RETURNS THE REFRESHED `detail`. That is not
 * incidental — every request to this app costs about a second before it does any
 * work, so a click that mutates and then re-reads pays that twice. Callers render
 * from the returned detail instead of asking again.
 *
 * `create` is the exception, and has to be: there is no lead to attach a detail to
 * until it returns one. It answers with the identifiers only, and the caller that
 * wants the full view navigates to it.
 */

import { request } from "../../../lib/request";
import type { CreatedLead, Lead, LeadDetail, LeadSource, TranscriptMessage } from "../types/lead";

/** The page size the inbox asks for. The handler has no cursor; this is the cap. */
export const LIST_LIMIT = 100;

export const listLeads = () => request<{ leads: Lead[] }>("list", { limit: LIST_LIMIT });

/**
 * Everything `create` will take from a person typing it in. `source` and
 * `companyName` are the handler's only required fields; the rest are optional
 * there too, which is why they are optional here.
 */
export type NewLeadFields = {
  source: LeadSource;
  companyName: string;
  sourceDetail?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  websiteDomain?: string;
  serviceType?: string;
  description?: string;
  siteAddress?: string;
  siteCity?: string;
  siteRegion?: string;
  estimatedValue?: number;
  currency?: string;
};

/**
 * Capture a lead. The handler is the only writer of `fl_lead` — it allocates the
 * ref number, stamps the SLA clocks and runs the duplicate check, so there is no
 * "just insert a row" path that skips any of that.
 *
 * Blank fields are stripped rather than sent as `""`: the handler's `optStr` reads
 * an empty string as "not given" for most columns, but a written `""` still lands
 * in the ones it does not, where the column should hold NULL.
 */
export const createLead = (fields: NewLeadFields, actorEmail: string) => {
  const filled = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined && v !== "")
  );
  return request<CreatedLead>("create", { ...filled, actorEmail });
};

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
