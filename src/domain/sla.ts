/**
 * SLA arithmetic. Pure — `now` is always passed in, never read from the clock,
 * so every rule here is testable without freezing time.
 *
 * There is no scheduler until the app is promoted to production, and none is
 * needed to *show* overdue: due dates are stamped when the lead arrives and
 * overdue is derived at read time.
 */

export interface SlaTargets {
  firstResponseMins: number;
  qualificationMins: number;
  assignmentMins: number;
}

export const DEFAULT_SLA: SlaTargets = {
  firstResponseMins: 60,
  qualificationMins: 1440,
  assignmentMins: 2880,
};

/** ISO 8601 UTC — the only timestamp format in this schema. Sorts as text. */
export function addMinutes(iso: string, minutes: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`invalid timestamp: ${iso}`);
  return new Date(ms + minutes * 60_000).toISOString();
}

export interface DueDates {
  firstResponseDueAt: string;
  qualificationDueAt: string;
  assignmentDueAt: string;
}

/** All three clocks run from arrival, not from the previous stage. */
export function dueDates(arrivedAt: string, targets: SlaTargets = DEFAULT_SLA): DueDates {
  return {
    firstResponseDueAt: addMinutes(arrivedAt, targets.firstResponseMins),
    qualificationDueAt: addMinutes(arrivedAt, targets.qualificationMins),
    assignmentDueAt: addMinutes(arrivedAt, targets.assignmentMins),
  };
}

/** Overdue only if the due date has passed AND the stage is not yet done. */
export function isOverdue(dueAt: string | null | undefined, now: string, completedAt?: string | null): boolean {
  if (!dueAt) return false;
  if (completedAt) return false;
  const due = Date.parse(dueAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(due) || Number.isNaN(nowMs)) return false;
  return nowMs > due;
}

export function minutesUntil(dueAt: string, now: string): number {
  return Math.round((Date.parse(dueAt) - Date.parse(now)) / 60_000);
}

export type SlaStage = "first_response" | "qualification" | "assignment";

export interface SlaSnapshot {
  breached: SlaStage[];
  nextDue: { stage: SlaStage; dueAt: string; minutesRemaining: number } | null;
  isOverdue: boolean;
}

/**
 * Which clocks a lead has broken, and which one bites next. Driven off the same
 * stamps the queue reads, so the list view and a detail view can never disagree.
 */
export function slaSnapshot(
  lead: {
    firstResponseDueAt?: string | null;
    qualificationDueAt?: string | null;
    assignmentDueAt?: string | null;
    firstContactAt?: string | null;
    qualifiedAt?: string | null;
    assignedAt?: string | null;
    status?: string | null;
  },
  now: string
): SlaSnapshot {
  // A finished lead cannot be late.
  if (lead.status === "converted" || lead.status === "closed") {
    return { breached: [], nextDue: null, isOverdue: false };
  }

  const stages: Array<{ stage: SlaStage; dueAt?: string | null; completedAt?: string | null }> = [
    { stage: "first_response", dueAt: lead.firstResponseDueAt, completedAt: lead.firstContactAt },
    { stage: "qualification", dueAt: lead.qualificationDueAt, completedAt: lead.qualifiedAt },
    { stage: "assignment", dueAt: lead.assignmentDueAt, completedAt: lead.assignedAt },
  ];

  const breached: SlaStage[] = [];
  let nextDue: SlaSnapshot["nextDue"] = null;

  for (const s of stages) {
    if (isOverdue(s.dueAt, now, s.completedAt)) {
      breached.push(s.stage);
      continue;
    }
    if (!s.completedAt && s.dueAt && !nextDue) {
      nextDue = {
        stage: s.stage,
        dueAt: s.dueAt,
        minutesRemaining: minutesUntil(s.dueAt, now),
      };
    }
  }

  return { breached, nextDue, isOverdue: breached.length > 0 };
}
