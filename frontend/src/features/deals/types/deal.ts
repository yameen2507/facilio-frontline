/**
 * The deal vocabulary, mirrored from `src/domain/deal-state.ts` on the backend.
 * The stage list and the transition rules live THERE; this file only names the
 * shapes and labels the UI renders. `deal.reference` serves the machine-readable
 * copy, and the detail response carries `allowedNext` per record — so nothing
 * here re-implements which move is legal.
 */

import type { Assessment } from "../../../lib/assess";

export type DealStage =
  | "opportunity"
  | "discovery"
  | "survey_required"
  | "survey_completed"
  | "estimation"
  | "proposal_submitted"
  | "negotiation"
  | "decision_pending"
  | "won"
  | "lost";

/** The eight working stages, in funnel order — the stage path renders these. */
export const ACTIVE_STAGES: DealStage[] = [
  "opportunity",
  "discovery",
  "survey_required",
  "survey_completed",
  "estimation",
  "proposal_submitted",
  "negotiation",
  "decision_pending",
];

export const STAGE_LABEL: Record<DealStage, string> = {
  opportunity: "Opportunity",
  discovery: "Discovery",
  survey_required: "Survey required",
  survey_completed: "Survey completed",
  estimation: "Estimation",
  proposal_submitted: "Proposal submitted",
  negotiation: "Negotiation",
  decision_pending: "Decision pending",
  won: "Won",
  lost: "Lost",
};

export type LostReason =
  | "price"
  | "competitor"
  | "scope"
  | "budget"
  | "timing"
  | "customer_cancelled"
  | "existing_provider"
  | "service_capability"
  | "region"
  | "tender_cancelled"
  | "no_response"
  | "other";

export const LOST_REASON_LABEL: Record<LostReason, string> = {
  price: "Price",
  competitor: "Competitor",
  scope: "Scope",
  budget: "Budget",
  timing: "Timing",
  customer_cancelled: "Customer cancelled",
  existing_provider: "Existing provider",
  service_capability: "Service capability",
  region: "Region",
  tender_cancelled: "Tender cancelled",
  no_response: "No response",
  other: "Other",
};

export interface Deal {
  id: string;
  refNo: string;
  leadId: string | null;
  accountId: string | null;
  contactId: string | null;
  title: string | null;
  stage: DealStage;
  estimatedValue: number | null;
  currency: string | null;
  /** D-05, carried from the lead at convert: one_off | recurring | both. */
  valueType?: string | null;
  /** monthly | quarterly | annual — present exactly when the value recurs. */
  valueFrequency?: string | null;
  salesOwnerEmail: string | null;
  source: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  /** The capture sheets — discovery, negotiation, decision, won, lost — ride
      whole in the overflow column; see modules/deal.ts. */
  data: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealListRow extends Deal {
  accountName: string | null;
  leadRefNo: string | null;
}

export interface DealListResponse {
  deals: DealListRow[];
  total: number;
}

/** The slim shapes `deal.get` joins in — each is a subset of another module's
    record, listed here rather than imported: features do not reach into each
    other's types. */
export type DealSurvey = {
  id: string;
  refNo: string;
  title: string | null;
  status: string;
  targetCompletionDate: string | null;
  completenessPct: number | null;
  revisionNo: number | null;
  createdAt: string;
};

export type DealProposal = {
  id: string;
  refNo: string;
  title: string | null;
  status: string;
  revisionNo: number | null;
  parentProposalId: string | null;
  totalOneTime: number | null;
  totalRecurringMonthly: number | null;
  currency: string | null;
  validUntil: string | null;
  sentAt: string | null;
  decision: string | null;
  createdAt: string;
};

export type DealEvent = {
  id: string;
  kind: string;
  actor: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  occurredAt: string;
};

export interface DealDetailResponse {
  deal: Deal;
  allowedNext: DealStage[];
  account: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    websiteDomain: string | null;
    facilioClientId: string | null;
    syncStatus: string | null;
  } | null;
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: unknown;
  } | null;
  lead: {
    id: string;
    refNo: string;
    companyName: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    source: string | null;
    sourceDetail: string | null;
    serviceType: string | null;
    description: string | null;
    siteAddress: string | null;
    siteCity: string | null;
    siteRegion: string | null;
    score: number | null;
    verdict: string | null;
  } | null;
  surveys: DealSurvey[];
  proposals: DealProposal[];
  timeline: DealEvent[];
  /** The newest run of each agent that reads a deal. Advisory only — no
      assessment has moved the stage. */
  assessments?: Assessment[];
}
