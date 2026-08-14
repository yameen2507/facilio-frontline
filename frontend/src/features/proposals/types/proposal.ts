/**
 * Proposal domain types.
 *
 * Four platform facts are baked into these shapes, and each one is a bug this
 * file exists to prevent:
 *
 * 1. **Money is an integer in MINOR units, everywhere on the wire.** `100000`
 *    is AED 1,000.00. Format it with `../money`; never add two of them in the
 *    UI. Every total below is computed server-side and read back, which is what
 *    makes the number on screen the same number the client's document carries.
 * 2. **`status` is COMPUTED, `storedStatus` is stored.** Expiry is derived at
 *    read time and never by a job (spec §5 R8), so a lapsed offer arrives as
 *    `status: "expired"` with `storedStatus: "sent"`. Gate actions off `status`;
 *    reach for `storedStatus` only to explain what the record actually says.
 * 3. **`isOptional` is a real boolean on READ and a string on WRITE.** `get`
 *    coerces it; `line-save` takes `"true"` / `"false"`. Writes go through the
 *    `payload` envelope, which sidesteps the whole question — see
 *    `api/proposals-util.ts`.
 * 4. **`deltaValue` and `deviationPct` are not on the money conversion list.**
 *    A percentage is not money, so neither is coerced on the way out and both
 *    may arrive as a numeric STRING. They are typed as numbers here because
 *    that is the contract; read them through `numeric()` because that is the
 *    wire. And `deltaValue` changes meaning with `deltaType`: a percentage when
 *    `pct`, MINOR UNITS when `amount`.
 */

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** The nine-state lifecycle. Four of them are terminal. */
export type ProposalStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "superseded"
  | "withdrawn";

/** Discount and markup are ONE field with a sign — the server owns the sign. */
export type PricingMode = "standard" | "discount" | "markup" | "custom";

export type DeltaType = "pct" | "amount";

/** Price, basis and unit are one atomic fact — a price with no basis is unusable. */
export type PricingBasis = "unit" | "hour" | "visit";

export type Frequency =
  | "one_time"
  | "daily"
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "quarterly"
  | "annual";

export type LineSource = "survey_entry" | "recommendation" | "manual" | "external_schedule";

export type ContractType = "comprehensive" | "semi_comprehensive" | "non_comprehensive";

/**
 * A counter-offer is a thing that HAPPENED, not a state the proposal is in
 * (spec §5 R2). These are event kinds on the one audit spine — never a status,
 * and never a second table.
 */
export type NegotiationKind =
  | "counter_offer"
  | "question"
  | "objection"
  | "scope_change_request"
  | "client_note";

// ── The record ───────────────────────────────────────────────────────────────

/** One priced line. The DERIVATION is the point — see spec §2.2. */
export type ProposalLine = {
  id: string;
  sequenceNo: number;
  description: string | null;
  /** A catalogue code (Settings › Services). Null on a custom one-off line. */
  serviceCode?: string | null;
  scopeNodeId?: string | null;
  /** The survey key this line was priced from — the most stable identity there is. */
  estimationKey?: string | null;
  source?: LineSource | null;
  qty: number | null;
  pricingBasis?: PricingBasis | string | null;
  uom?: string | null;
  frequency?: Frequency | string | null;
  rateCardRowId?: string | null;
  /** COPIED at creation, never looked up — which is what makes a sent proposal
      immune to a later rate change (spec §2.2 rule 1). Minor units. */
  cardPrice: number | null;
  pricingMode?: PricingMode | string | null;
  deltaType?: DeltaType | null;
  /** A percentage when `deltaType` is `pct`; MINOR UNITS when it is `amount`. */
  deltaValue?: number | null;
  /** Mandatory for discount, markup and custom. The approver reads this. */
  deltaReason?: string | null;
  /** Minor units — the card price after the mode was applied. */
  appliedPrice: number | null;
  lineTotal: number | null;
  conditionScore?: number | null;
  conditionMultiplier?: number | null;
  perOccurrenceAmount?: number | null;
  monthlyEquivalentAmount?: number | null;
  oneTimeAmount?: number | null;
  /** A REAL boolean on read (see the file header). Shown, never totalled. */
  isOptional: boolean;
  notes?: string | null;
};

/** The card this proposal's prices came from, as `get` returns it. */
export type RateCard = {
  id: string;
  name: string | null;
  currency: string | null;
  region: string | null;
  clientAccountId: string | null;
  priority: number | null;
  status: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

/** One row of the audit spine — `fl_event`, which every proposal action writes. */
export type ProposalEvent = {
  id: string;
  kind: string;
  actor?: string | null;
  body?: string | null;
  meta?: Record<string, unknown> | null;
  occurredAt: string;
};

/** One line the approver has to rule on, and why it reached them. */
export type ApprovalException = {
  description: string;
  mode: string;
  deviationPct: number;
  reason: string | null;
  /** Plain language: what tripped the threshold. */
  why: string;
};

/**
 * What the approver would see if this were submitted now — computed on read, so
 * the estimator sees exactly what the approver will before sending it on.
 */
export type Approval = {
  needsApproval: boolean;
  /** THE EXCEPTION LIST — the only thing an approver should be shown (spec §4). */
  exceptions: ApprovalException[];
  reason: string;
};

/** The scalars every proposal read carries, list and detail alike. */
export type ProposalCore = {
  id: string;
  refNo: string;
  dealId: string | null;
  accountId: string | null;
  surveyId?: string | null;
  surveyRevisionId?: string | null;
  rateCardId?: string | null;
  /** WHY this card won. Spec §3 requires the resolution to be visible: an
      unexplained price is an unauditable one. */
  rateCardResolvedReason?: string | null;
  title: string | null;
  /** Computed — expiry is derived at read time (file header, fact 2). */
  status: ProposalStatus;
  /** What the column actually holds. */
  storedStatus?: ProposalStatus | null;
  currency: string | null;
  contractType?: ContractType | string | null;
  /** Minor units. Prints on the proposal for semi-comprehensive (C14). */
  liabilityThresholdAmount?: number | null;
  conditionScaleDirection?: string | null;
  paymentTerms?: string | null;
  expectedProgramme?: string | null;
  /** Minor units, all six. Committed lines only — optional totals are separate. */
  oneTimeSubtotal?: number | null;
  recurringMonthlySubtotal?: number | null;
  optionalOneTimeTotal?: number | null;
  optionalRecurringMonthlyTotal?: number | null;
  totalOneTime?: number | null;
  totalRecurringMonthly?: number | null;
  validUntil?: string | null;
  /** Negative once it has lapsed; null when the offer never expires. */
  daysToExpiry?: number | null;
  templateId?: string | null;
  deviationPct?: number | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  sentBy?: string | null;
  sentAt?: string | null;
  /** Stamped on send. Text that looks numeric — never coerce it. */
  checksum?: string | null;
  revisionNo?: number | null;
  parentProposalId?: string | null;
  supersededByProposalId?: string | null;
  decision?: string | null;
  decisionReason?: string | null;
  decidedAt?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

/** `proposal.get` — the whole record in one batched query. */
export type Proposal = ProposalCore & {
  lines: ProposalLine[];
  rateCard: RateCard | null;
  /** Newest first, and the whole audit spine. */
  events: ProposalEvent[];
  /** The same spine, filtered to the conversation (spec §5 R2). */
  negotiation: ProposalEvent[];
  approval: Approval;
  /** Warnings, NEVER blocks (C8). The estimator decides; the app tells the truth. */
  warnings: string[];
  /** The frozen snapshot, once something has rendered it. Null until then. */
  document?: RenderedDocument | null;
};

export type ProposalDetailResponse = { proposal: Proposal };

/** A list row — the scalars plus the two things only the list needs. */
export type ProposalSummary = ProposalCore & {
  accountName?: string | null;
  lineCount?: number | null;
};

export type ProposalListResponse = { proposals: ProposalSummary[]; truncated?: boolean };

/** `proposal.reference` — the enum vocabulary, read rather than hardcoded. */
export type ProposalReference = {
  statuses: ProposalStatus[];
  pricingModes: PricingMode[];
  deltaTypes: DeltaType[];
  pricingBases: PricingBasis[];
  /** `uom` depends on the basis — an hour rate measured in square feet is a typo. */
  unitsByBasis: Record<string, string[]>;
  lineSources: LineSource[];
  frequencies: Frequency[];
  /** Free text in P1, with these six offered. Structured reasons are what make
      a later markup-suggestion layer worth having. */
  deltaReasons: string[];
};

// ── The document (spec §6) ───────────────────────────────────────────────────

export type SectionType = "system" | "text";

export type SystemSectionKey =
  | "site_summary"
  | "pricing_table"
  | "optional_services"
  | "exclusions"
  | "acceptance";

/** One line as the document prints it — a narrower shape than ProposalLine. */
export type RenderLine = {
  description: string;
  qty: number;
  uom: string | null;
  frequency: string | null;
  appliedPrice: number | null;
  lineTotal: number | null;
  isOptional: boolean;
};

export type RenderedSection = {
  type: SectionType;
  key: string;
  title: string;
  /** Merged Markdown for a text section; empty for a system one. */
  body: string;
  /** The structured payload a system section renders from; null for text. */
  data: unknown;
};

export type RenderedDocument = {
  templateId: string | null;
  templateName: string;
  sections: RenderedSection[];
  /** Everything the renderer could not resolve — shown, never swallowed. */
  warnings: string[];
  renderedAt: string;
};

export type RenderResponse = { document: RenderedDocument };

/** A template as `template-list` returns it — the sections before any merge. */
export type ProposalTemplate = {
  id?: string | null;
  name: string;
  sections: { type: SectionType; key: string; title: string; body?: string }[];
};

// ── The diff (spec §5 R4) ────────────────────────────────────────────────────

export type ChangeKind =
  | "added"
  | "removed"
  | "quantity_changed"
  | "rate_changed"
  | "mode_changed"
  | "frequency_changed"
  | "optional_changed"
  /** Wording moved, no number did. It still matters: the client READS that text
      on the document, so a silently reworded line is a change they can see. */
  | "description_changed"
  | "unchanged";

/** A line, reduced to what a comparison needs. Money is minor units. */
export type DiffableLine = {
  id: string;
  originLineId?: string | null;
  estimationKey?: string | null;
  description: string;
  qty: number;
  cardPrice: number | null;
  appliedPrice: number | null;
  lineTotal: number | null;
  pricingMode: string | null;
  deltaReason?: string | null;
  frequency: string | null;
  isOptional: boolean;
};

export type LineChange = {
  kind: ChangeKind;
  description: string;
  /** Null on `added`. */
  before: DiffableLine | null;
  /** Null on `removed`. */
  after: DiffableLine | null;
  /** Every field that moved, already in words. */
  changes: string[];
  /** Minor units, signed — what this line did to the money. */
  totalDelta: number;
};

export type TotalsDelta = {
  oneTimeBefore: number;
  oneTimeAfter: number;
  oneTimeDelta: number;
  recurringBefore: number;
  recurringAfter: number;
  recurringDelta: number;
};

export type ProposalDiff = {
  changes: LineChange[];
  totals: TotalsDelta;
  summary: { added: number; removed: number; changed: number; unchanged: number };
  /** One sentence a human can paste into an email. */
  headline: string;
};

export type DiffResponse = { diff: ProposalDiff };

// ── Display vocabulary ───────────────────────────────────────────────────────

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  superseded: "Superseded",
  withdrawn: "Withdrawn",
};

export const PRICING_MODE_LABEL: Record<PricingMode, string> = {
  standard: "Standard",
  discount: "Discount",
  markup: "Markup",
  custom: "Custom",
};

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  one_time: "One-time",
  daily: "Daily",
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

export const NEGOTIATION_LABEL: Record<NegotiationKind, string> = {
  counter_offer: "Counter-offer",
  question: "Question",
  objection: "Objection",
  scope_change_request: "Scope change requested",
  client_note: "Note from the client",
};

export const NEGOTIATION_KINDS: NegotiationKind[] = [
  "counter_offer",
  "question",
  "objection",
  "scope_change_request",
  "client_note",
];

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  added: "Added",
  removed: "Removed",
  quantity_changed: "Quantity changed",
  rate_changed: "Repriced",
  mode_changed: "Mode changed",
  frequency_changed: "Frequency changed",
  optional_changed: "Optional changed",
  description_changed: "Reworded",
  unchanged: "Unchanged",
};

/**
 * The order a proposal actually moves in. The four ways it can end without an
 * acceptance — rejected, expired, superseded, withdrawn — are off to one side,
 * because putting them on the line would claim a position they do not have.
 */
export const PROPOSAL_TRAIL: ProposalStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
];

/** Ended without a deal. Off the trail, and none of them can be edited. */
export const TERMINAL_STATUSES: ProposalStatus[] = [
  "accepted",
  "rejected",
  "expired",
  "superseded",
  "withdrawn",
];

/** A reason is what the approver reads, so these three modes cannot go without one. */
export const REASON_REQUIRED_MODES: PricingMode[] = ["discount", "markup", "custom"];

/**
 * Lines are editable in draft AND pending_approval — `assertDraft` server-side
 * accepts both, which is what lets an estimator fix the line an approver
 * returned without first walking the proposal backwards.
 */
export const isLineEditable = (status: ProposalStatus): boolean =>
  status === "draft" || status === "pending_approval";

/**
 * Negotiation can be recorded against a live offer, and against one that has
 * just been rejected or lapsed — that is where the conversation producing the
 * next revision happens (spec §5 R8: neither is a dead end).
 */
export const canRecordNegotiation = (status: ProposalStatus): boolean =>
  status === "sent" || status === "rejected" || status === "expired";

/**
 * A revision can be raised from a live offer or one that ended without a deal —
 * never from an accepted one. A change after acceptance is a NEW proposal
 * against the won deal, which is the recommendations loop (spec §5 R7).
 */
export const canRevise = (status: ProposalStatus): boolean =>
  status === "sent" || status === "rejected" || status === "expired" || status === "withdrawn";
