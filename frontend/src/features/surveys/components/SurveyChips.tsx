/**
 * Status vocabulary, rendered.
 *
 * `Coverage` is the one worth reading twice: `notVisitedPct` is nullable, and
 * null is NOT zero. Null means nothing was ever seeded, so coverage could not be
 * measured; zero means every seeded node was walked. Printing null as "0% not
 * visited" tells the estimator the whole site was covered when in fact nobody
 * knows — which is exactly the number a price gets built on.
 */

import { cn } from "@/lib/utils";
import { Chip, type Tone } from "../../../ui/Chip";
import {
  SURVEY_STATUS_LABEL,
  VERDICT_LABEL,
  VISIT_STATUS_LABEL,
  type NodeVerdict,
  type SurveyStatus,
  type VisitStatus,
} from "../types/survey";

const SURVEY_TONE: Record<SurveyStatus, Tone> = {
  draft: "neutral",
  scheduled: "blue",
  assigned: "blue",
  in_progress: "orange",
  pending_review: "orange",
  completed: "green",
  cancelled: "red",
};

const VISIT_TONE: Record<VisitStatus, Tone> = {
  planned: "blue",
  in_progress: "orange",
  done: "green",
  // A wasted trip is a real, recurring event in a tender — roughly ten bidders
  // compete for one tenderer-controlled slot. It must never read as "surveyed".
  no_show: "red",
  cancelled: "neutral",
};

const VERDICT_TONE: Record<NodeVerdict, Tone> = {
  unverified: "neutral",
  verified: "green",
  changed: "orange",
  not_found: "red",
  added_on_site: "blue",
  not_visited: "orange",
};

/**
 * The `of` prefix names WHICH THING the state belongs to, and it is not
 * decoration. A survey and its visit are different objects with overlapping
 * vocabularies — "Scheduled" and "Planned" are near-synonyms in English — so
 * two unlabelled pills side by side (the walk header shows exactly that) read
 * as one fact printed twice rather than two facts about two objects.
 *
 * Opt-in, because most call sites already answer the question by position: a
 * Facts row labelled "Status", a chip inside a visit's own row. Prefixing there
 * would be the same word twice.
 */
const Qualified = ({ of, children }: { of?: string; children: string }) =>
  of ? (
    <>
      <span className="opacity-60">{of}</span>
      <span aria-hidden="true" className="opacity-40">
        ·
      </span>
      {children}
    </>
  ) : (
    <>{children}</>
  );

export const SurveyStatusChip = ({ status, of }: { status: SurveyStatus; of?: string }) => (
  <Chip tone={SURVEY_TONE[status] ?? "neutral"} dot>
    <Qualified of={of}>{SURVEY_STATUS_LABEL[status] ?? status}</Qualified>
  </Chip>
);

export const VisitStatusChip = ({ status, of }: { status: VisitStatus; of?: string }) => (
  <Chip tone={VISIT_TONE[status] ?? "neutral"} dot>
    <Qualified of={of}>{VISIT_STATUS_LABEL[status] ?? status}</Qualified>
  </Chip>
);

export const VerdictChip = ({ verdict }: { verdict: NodeVerdict }) => (
  <Chip tone={VERDICT_TONE[verdict] ?? "neutral"}>{VERDICT_LABEL[verdict] ?? verdict}</Chip>
);

/**
 * Completeness as a single-hue meter with the number beside it — the number
 * carries the value (text ink, not colour), the bar just makes a column of
 * them scannable. Null is NOT zero: nothing is owed until the snapshot is
 * copied and capture starts, so null renders as a dash, never an empty bar.
 */
export function CompletenessMeter({ pct, className }: { pct?: number | null; className?: string }) {
  if (pct === null || pct === undefined) {
    return (
      <span
        className="text-muted-foreground text-sm"
        title="Measured once the walk starts capturing answers"
      >
        —
      </span>
    );
  }
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="bg-muted h-1.5 w-16 shrink-0 overflow-hidden rounded-full">
        <span className="bg-primary block h-full rounded-full" style={{ width: `${clamped}%` }} />
      </span>
      <span className="text-sm tabular-nums">{clamped}%</span>
    </span>
  );
}

/** Coverage, stated honestly — including when it cannot be stated. */
export function Coverage({ notVisitedPct }: { notVisitedPct?: number | null }) {
  if (notVisitedPct === null || notVisitedPct === undefined) {
    return (
      <span
        className="text-muted-foreground text-sm"
        title="No nodes were seeded from the tender documents, so there is nothing to measure coverage against."
      >
        Not measured
      </span>
    );
  }

  return (
    <span className="text-sm">
      <span className="tabular-nums">{100 - notVisitedPct}%</span>
      <span className="text-muted-foreground"> of seeded nodes walked</span>
    </span>
  );
}
