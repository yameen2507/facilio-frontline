/**
 * Survey domain types.
 *
 * Three platform facts are baked into these shapes, and each one is a bug this
 * file exists to prevent:
 *
 * 1. **Booleans are STRINGS.** There is no boolean column in the app database,
 *    so flags travel as `"true"` / `"false"`. `if (section.isRepeatable)` is
 *    true for the string `"false"` — always compare to `"true"`.
 * 2. **`notVisitedPct` is `number | null`, and null is not zero.** Null means no
 *    nodes were ever seeded, so coverage could not be measured. Zero means the
 *    whole site was walked. Rendering null as 0% tells the estimator the site
 *    was covered when nobody knows.
 * 3. **Ids that look numeric are strings** — `facilioId`, `userId`,
 *    `suggestedServiceId`. They are stored as text precisely so they survive
 *    a round trip; never coerce them.
 */

import type { Assessment } from "../../../lib/assess";

/** The seven-state lifecycle. Cancelled is reachable from any pre-completed state. */
export type SurveyStatus =
  | "draft"
  | "scheduled"
  | "assigned"
  | "in_progress"
  | "pending_review"
  | "completed"
  | "cancelled";

export type VisitStatus = "planned" | "in_progress" | "done" | "no_show" | "cancelled";

export type NodeVerdict =
  | "unverified"
  | "verified"
  | "changed"
  | "not_found"
  | "added_on_site"
  | "not_visited";

export type NodeType = "site" | "building" | "space";

export type ContractIntent = "comprehensive" | "semi_comprehensive" | "non_comprehensive";

export type Survey = {
  id: string;
  refNo: string;
  title?: string | null;
  status: SurveyStatus;
  dealId: string;
  accountId?: string | null;
  accountName?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  templateVersionNo?: number | null;
  leadUserEmail?: string | null;
  /** Joined on the list read (X-05) — null when the lead predates fl_user. */
  leadUserName?: string | null;
  contractIntent?: ContractIntent | null;
  targetCompletionDate?: string | null;
  /** D-33: the earliest still-planned visit, joined on the list read. */
  nextVisitAt?: string | null;
  revisionNo?: number | null;
  reworkCount?: number | null;
  /** Null when nothing is owed — see the file header. */
  completenessPct?: number | null;
  /** Null when nothing was seeded. NOT the same as 0. */
  notVisitedPct?: number | null;
  visitCount?: number;
  assigneeCount?: number;
  createdAt?: string | null;
  /** Last write of any kind. Read to tell whether an agent's verdict predates
      the state the survey is in now. */
  updatedAt?: string | null;
  statusChangedAt?: string | null;
  /** Set at T7 — the revision a proposal prices from. */
  currentRevisionId?: string | null;
};

export type Visit = {
  id: string;
  visitNumber: string;
  sequenceNo: number;
  status: VisitStatus;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  timezone?: string | null;
  siteContactName?: string | null;
  siteContactPhone?: string | null;
  meetingInstructions?: string | null;
  accessInstructions?: string | null;
  /** `ours` | `tenderer_granted` — a granted slot is recorded, never negotiated. */
  slotSource?: string | null;
  slotGrantedBy?: string | null;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  noShowReason?: string | null;
  cancelReason?: string | null;
};

export type Assignee = {
  id: string;
  userEmail: string;
  /** Resolved from fl_user at assign time (F-22); null only on legacy rows. */
  userId?: string | null;
  /** Joined server-side, so this surface never prints a raw email (X-05). */
  userName?: string | null;
  /** `surveyor` | `observer` — an observer may capture but cannot lead. */
  participation?: string | null;
  disciplineIds?: string[] | null;
  assignedAt?: string | null;
};

/** `survey.user-list` — who can be assigned, and how loaded they are. */
export type AssignableUser = {
  id: string;
  name: string;
  email: string;
  roleName: string | null;
  team: string | null;
  region: string | null;
  /** Planned visits over the coming week on surveys this user is assigned to. */
  weekVisits: number;
};

/**
 * A row of the prospect portfolio, as the survey surfaces read it.
 *
 * The portfolio is its OWN product area (Prospect Portfolio Module v1.1) and
 * owns `fl_prospect_location`; the survey lane consumes it. `type` and
 * `parentId` are the v1.1 names — §0a purged "node" from the vocabulary, so
 * `node_type` became `type` and `parent_node_id` became `parent_id`.
 */
export type ProspectNode = {
  id: string;
  name: string;
  type: NodeType;
  parentId?: string | null;
  ancestryPath?: string | null;
  verdict: NodeVerdict;
  verdictNote?: string | null;
  areaSqft?: number | null;
  roomCount?: number | null;
  restroomCount?: number | null;
  floorLabel?: string | null;
  /** `rfp` | `crm` | `survey` | `facilio_link` | `manual` */
  provenance: string;
  /** Text, not a number — a Facilio id that merely looks numeric. */
  facilioId?: string | null;
};

export type DiffType =
  | "value_conflict"
  | "node_not_found"
  | "node_added"
  | "count_mismatch"
  | "unanswered_required"
  | "intra_survey_conflict";

export type ReconciliationItem = {
  id: string;
  diffType: DiffType;
  prospectNodeId?: string | null;
  fieldKey?: string | null;
  rfpValue?: string | null;
  surveyValue?: string | null;
  suggestedValue?: string | null;
  /** Plain-language reason. The app suggests; the person decides. */
  suggestionBasis?: string | null;
  decision?: string | null;
  decisionNote?: string | null;
  status: "open" | "decided" | string;
};

export type Qualification = {
  id: string;
  source: string;
  text: string;
  isPrintedOnProposal?: string | null;
  generatedAutomatically?: string | null;
};

export type SurveyListResponse = {
  surveys: Survey[];
  total: number;
  truncated?: boolean;
};

/** One row of the audit trail — fl_event, which every survey action writes. */
export type SurveyEvent = {
  id: string;
  entityType: string;
  kind: string;
  actor?: string | null;
  body?: string | null;
  meta?: Record<string, unknown> | null;
  occurredAt: string;
};

/**
 * What the two count guards would say right now, computed server-side in
 * `domain/survey-completeness.ts` and handed down whole.
 *
 * NOT re-derived here, and that is the point: the rules that decide whether a
 * survey may be sent for review or completed are the same functions the
 * transition handler runs, so the list a person reads before clicking is
 * exactly the list that would refuse them. A second copy in the client is a
 * second copy to drift.
 *
 * `blockers` stop the move. `warnings` do NOT — a survey with most of its site
 * unvisited still completes (D-S11); it says so loudly and the reason lands on
 * the audit trail.
 */
export type GuardResult = {
  ok: boolean;
  blockers: string[];
  warnings: string[];
};

export type SurveyCounts = {
  seededNodes: number;
  verdictedNodes: number;
  notVisitedNodes: number;
  requiredQuestions: number;
  answeredRequired: number;
  openReconciliationItems: number;
  openVisits: number;
};

export type SurveyReadiness = {
  counts: SurveyCounts;
  completenessPct: number | null;
  notVisitedPct: number | null;
  /** T5 — `in_progress → pending_review`. */
  review: GuardResult;
  /** T7 — `pending_review → completed`. */
  submit: GuardResult;
};

export type SurveyDetailResponse = {
  survey: Survey;
  visits: Visit[];
  assignees: Assignee[];
  nodes: ProspectNode[];
  reconciliation: ReconciliationItem[];
  qualifications: Qualification[];
  /** Newest first. */
  events?: SurveyEvent[];
  /** Evidence at the desk — every photo on this survey's entities. */
  photos?: WalkPhoto[];
  /** id → label, for captioning photos by the room they evidence. */
  entryLabels?: { id: string; entryLabel: string }[];
  /** How much of the template the T2 snapshot copied — the walk's size. */
  snapshot?: { sections: number; questions: number };
  /** Optional so a response from before the completion slice still parses. */
  readiness?: SurveyReadiness;
  /** Frozen revisions, newest first — what a proposal may be priced from. */
  revisions?: {
    id: string;
    revisionNo: number;
    frozenAt?: string | null;
    frozenBy?: string | null;
    checksum?: string | null;
    triggerKind?: string | null;
    isCurrent?: string | null;
  }[];
  /** The newest run of each agent that reads a survey. Advisory only. */
  assessments?: Assessment[];
};

// ── The walk ─────────────────────────────────────────────────────────────────

/** A question instance — the snapshot copy the surveyor answers. */
export type WalkQuestion = {
  id: string;
  sectionInstanceId: string;
  label: string;
  helpText?: string | null;
  fieldType: string;
  options?: string[] | null;
  allowMultiple?: string | null;
  sequenceNo: number;
  isRequired?: string | null;
  estimationKey?: string | null;
  unit?: string | null;
};

export type WalkSection = {
  id: string;
  name: string;
  description?: string | null;
  sequenceNo: number;
  isRepeatable?: string | null;
  repeatLabel?: string | null;
  createsPortfolioNode?: string | null;
  questions: WalkQuestion[];
};

export type WalkEntry = {
  id: string;
  sectionInstanceId: string;
  entryNo: number;
  entryLabel: string;
  prospectNodeId?: string | null;
  visitId?: string | null;
};

export type WalkAnswer = {
  id: string;
  questionInstanceId: string;
  sectionEntryId?: string | null;
  valueText?: string | null;
  valueNumber?: number | null;
  valueJson?: unknown;
  answeredAt?: string | null;
};

export type WalkObservation = {
  id: string;
  sectionEntryId?: string | null;
  conditionScore?: number | null;
  buildupNote?: string | null;
  observedAt?: string | null;
};

export type WalkPhoto = {
  id: string;
  entityType: string;
  entityId: string;
  vibeFileId: number;
  fileName?: string | null;
  contentType?: string | null;
  caption?: string | null;
  data?: {
    kind?: string | null;
    capturedAt?: string | null;
    uploadedAt?: string | null;
    geoLat?: number | null;
    geoLng?: number | null;
    geoAccuracyM?: number | null;
  } | null;
};

/** The org's capture rules, read from fl_setting — config, never hardcoded. */
export type WalkSettings = {
  conditionScaleLabels?: Record<string, string> | null;
  /** D-e: 1_is_worst (5 = excellent) or 5_is_worst (5 = filthy). Feeds pricing. */
  conditionScaleDirection?: string;
  requirePhotoBelowCondition?: number;
  geotagCapture?: string;
};

export type WalkState = {
  survey: Pick<Survey, "id" | "refNo" | "title" | "status" | "leadUserEmail" | "templateId">;
  settings?: WalkSettings;
  visit: Pick<
    Visit,
    "id" | "visitNumber" | "sequenceNo" | "status" | "scheduledStart" | "scheduledEnd" | "timezone"
  > | null;
  sections: WalkSection[];
  entries: WalkEntry[];
  answers: WalkAnswer[];
  observations: WalkObservation[];
  photos: WalkPhoto[];
};

// ── Display vocabulary ───────────────────────────────────────────────────────

export const SURVEY_STATUS_LABEL: Record<SurveyStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  assigned: "Assigned",
  in_progress: "In progress",
  pending_review: "Pending review",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  no_show: "No-show",
  cancelled: "Cancelled",
};

export const VERDICT_LABEL: Record<NodeVerdict, string> = {
  unverified: "Unverified",
  verified: "Verified",
  changed: "Changed",
  not_found: "Not found",
  added_on_site: "Added on site",
  not_visited: "Not visited",
};

/** The order the survey actually moves in — cancelled is off to one side. */
export const SURVEY_TRAIL: SurveyStatus[] = [
  "draft",
  "scheduled",
  "assigned",
  "in_progress",
  "pending_review",
  "completed",
];
