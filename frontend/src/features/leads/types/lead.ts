/**
 * Lead domain types, as the `lead` function actually returns them.
 *
 * Two things to know before trusting a field here:
 *
 * 1. **Numbers may arrive as strings.** The app database returns `numeric`,
 *    `bigint` and `count(*)` as JS strings while `int` comes back as a number
 *    (ARCHITECTURE.md §3a). Fields that can be either are typed `number | string`
 *    and coerced at the point of display, not scattered through the UI.
 * 2. **Booleans are strings.** There is no boolean column type, so flags travel as
 *    `"true"` / `"false"`.
 */

export type LeadStatus =
  | "new"
  | "in_review"
  | "contacted"
  | "qualified"
  | "nurture"
  | "converted"
  | "closed";

export type Verdict = "relevant" | "not_relevant" | string;

/**
 * The channels `create` accepts. `widget` is deliberately absent from the
 * staff-facing picker (see NewLeadDialog) but stays in the type, because leads
 * already in the queue carry it.
 */
export type LeadSource = "widget" | "tender" | "inapp";

/** The lead `create` matched against, when it decided the new one is a repeat. */
export type DuplicateMatch = {
  id: string;
  refNo: string;
  companyName: string | null;
  status: string;
  matchedOn: "email" | "phone" | "domain";
};

/**
 * What `create` answers with — NOT a `LeadDetail`. A duplicate still gets a row:
 * it comes back `status: "closed"` with `duplicateOf` populated, and never enters
 * the queue. A caller that ignores `duplicateOf` reports a capture that, from the
 * inbox's point of view, did not happen.
 */
export type CreatedLead = {
  leadId: string;
  refNo: string;
  status: LeadStatus;
  duplicateOf: DuplicateMatch | null;
};

/** The response clocks, derived server-side when the list is read. */
export type Sla = {
  isOverdue: boolean;
  breached: string[];
  nextDue?: { minutesRemaining: number } | null;
};

export type Lead = {
  id: string;
  refNo: string;
  companyName: string;
  source: string;
  status: LeadStatus;

  serviceType?: string | null;
  siteCity?: string | null;
  siteAddress?: string | null;
  description?: string | null;

  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  websiteDomain?: string | null;

  estimatedValue?: number | string | null;
  currency?: string | null;

  ownerEmail?: string | null;
  accountId?: string | null;
  dealId?: string | null;

  score?: number | null;
  band?: string | null;
  verdict?: Verdict | null;
  analysedAt?: string | null;

  // Lifecycle stamps. A missing one does not always mean "not yet" — see
  // LifecycleSteps for why a gap can mean the stage was deliberately skipped.
  createdAt: string;
  arrivedAt?: string | null;
  reviewedAt?: string | null;
  firstContactAt?: string | null;
  qualifiedAt?: string | null;
  convertedAt?: string | null;
  assignedAt?: string | null;

  firstResponseDueAt?: string | null;
  qualificationDueAt?: string | null;
  assignmentDueAt?: string | null;

  dispositionReason?: string | null;
  nurtureUntil?: string | null;

  /** The overflow column every table carries, since a table's shape is permanent. */
  data?: { intakeSessionToken?: string } | null;

  sla?: Sla | null;
};

export type Analysis = {
  reasons?: string[];
  recommendation?: { nextAction?: string };
  understanding?: { missingInfo?: string[] };
};

export type TimelineEvent = {
  occurredAt?: string | null;
  kind: string;
  actor?: string | null;
  body?: string | null;
};

export type Assignment = {
  createdAt?: string | null;
  role: string;
  toUser: string;
  reason?: string | null;
};

/**
 * A later enquiry that was auto-closed into this lead. `matchedOn` is
 * recomputed from the dedup keys when the detail is read, so it is null if an
 * edit since the merge broke the key equality.
 */
export type MergedDuplicate = {
  id: string;
  refNo: string;
  createdAt: string;
  matchedOn: "email" | "phone" | "domain" | null;
};

/** What `get` returns, and what every mutation returns as `detail`. */
export type LeadDetail = {
  lead: Lead;
  analysis?: Analysis | null;
  band?: string | null;
  sla?: Sla | null;
  timeline: TimelineEvent[];
  assignments: Assignment[];
  duplicates: MergedDuplicate[];
};

export type TranscriptMessage = { role: "agent" | "visitor" | "system"; content: string };

/**
 * A survey row as the lead page needs it — this module's own copy, not the
 * surveys module's richer type, so deleting either feature never breaks the
 * other. `status` stays a plain string here: the survey lifecycle is that
 * module's vocabulary and a new state must not break this page.
 */
export type DealSurvey = {
  id: string;
  refNo: string;
  title?: string | null;
  status: string;
  templateName?: string | null;
  targetCompletionDate?: string | null;
  createdAt?: string | null;
};
