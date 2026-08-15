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
 * | `account-list`      | `{ accounts: LeadAccount[] }` — for the new-lead picker |
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

import { request, requestFrom } from "../../../lib/request";
import type {
  CreatedLead,
  DealSurvey,
  Lead,
  LeadAccountDeal,
  LeadDetail,
  LeadSource,
  TranscriptMessage,
} from "../types/lead";

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
  /** D-05: one_off | recurring | both — what kind of number the value is. */
  valueType?: string;
  /** monthly | quarterly | annual — required by the server when recurring. */
  valueFrequency?: string;
  /** D-10: where it came from — referral, existing_client, marketing, hubspot,
      cold_outreach, other. `source` above is how it ARRIVED. */
  origin?: string;
  /** The account this enquiry already belongs to, when the person raising it
      knows. Convert ranks it above its own domain/email guess. */
  accountId?: string;
};

/**
 * Just enough of an account to pick one. The accounts feature has a fuller type;
 * this is the leads feature's own thin copy, because features never import each
 * other's internals — and `account-list` is served by the `lead` function, so it
 * belongs on this client either way.
 */
export type LeadAccount = { id: string; name?: string | null; websiteDomain?: string | null };

/** Every account, for the new-lead picker. The handler caps the page; there is no
    cursor, so a very long list is searched in the combobox rather than paged. */
export const listAccountOptions = () =>
  request<{ accounts: LeadAccount[] }>("account-list", { limit: 200 });

// ── The coverage catalogue (D-04) ────────────────────────────────────────────

export type CoverageArea = {
  id: string;
  name: string;
  region: string | null;
  country: string | null;
  active: string;
};

export type CoverageServiceLine = { id: string; code: string; name: string; active: string };

export type CoverageLink = { areaId: string; serviceLineId: string; active: string };

export type CoverageOptions = {
  areas: CoverageArea[];
  serviceLines: CoverageServiceLine[];
  coverage: CoverageLink[];
};

/**
 * `lead.settings-get`, read for its catalogue only (D-04): the same matrix
 * Settings edits and the AI scores against, now feeding the intake pickers —
 * one vocabulary, three consumers. The response carries more (SLA, prompt);
 * this type simply doesn't look at it.
 */
export const getCoverageOptions = () => request<CoverageOptions>("settings-get");

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

export const convertLead = (leadId: string, actorEmail: string, overrideAssessment = false) =>
  request<Mutation & { dealRefNo: string; queued: unknown[] }>("convert", {
    leadId,
    actorEmail,
    // F-06: converting past a not_relevant verdict must be said out loud.
    ...(overrideAssessment ? { overrideAssessment: "true" } : {}),
  });

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

/**
 * Surveys raised against this lead's deal — `survey.list` filtered by dealId.
 * Calls the `survey` function directly rather than importing the surveys
 * feature's api-util: features do not import each other's internals, and this
 * thin duplicate is the cheapest honest boundary (the same pattern the surveys
 * module uses for `form.template-list`).
 */
export const listDealSurveys = (dealId: string) =>
  requestFrom<{ surveys: DealSurvey[]; total: number }>("survey", "list", { dealId, limit: 50 });

/**
 * Every deal belonging to this lead's ACCOUNT — `deal.list` filtered by account.
 *
 * By the account, not by the lead: a lead has exactly one `dealId`, so "the
 * deals of this lead" is at most one row and no aggregation at all. What is
 * actually wanted when a lead is open is what else this client has in flight —
 * which is what makes the lead's own deal readable as one of several rather than
 * as an isolated link.
 *
 * Same cross-feature rule as `listDealSurveys` above: call the `deal` function
 * directly rather than importing the deals feature's api-util.
 */
export const listAccountDeals = (accountId: string) =>
  requestFrom<{ deals: LeadAccountDeal[]; total: number }>("deal", "list", {
    accountId,
    limit: 50,
  });
