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
  contractIntent?: ContractIntent | null;
  targetCompletionDate?: string | null;
  revisionNo?: number | null;
  reworkCount?: number | null;
  /** Null when nothing is owed — see the file header. */
  completenessPct?: number | null;
  /** Null when nothing was seeded. NOT the same as 0. */
  notVisitedPct?: number | null;
  visitCount?: number;
  assigneeCount?: number;
  createdAt?: string | null;
  statusChangedAt?: string | null;
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
  /** `surveyor` | `observer` — an observer may capture but cannot lead. */
  participation?: string | null;
  disciplineIds?: string[] | null;
  assignedAt?: string | null;
};

export type ProspectNode = {
  id: string;
  name: string;
  nodeType: NodeType;
  parentNodeId?: string | null;
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

export type SurveyDetailResponse = {
  survey: Survey;
  visits: Visit[];
  assignees: Assignee[];
  nodes: ProspectNode[];
  reconciliation: ReconciliationItem[];
  qualifications: Qualification[];
  /** How much of the template the T2 snapshot copied — the walk's size. */
  snapshot?: { sections: number; questions: number };
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

export type WalkState = {
  survey: Pick<Survey, "id" | "refNo" | "title" | "status" | "leadUserEmail" | "templateId">;
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
