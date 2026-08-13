/**
 * Status vocabulary, rendered.
 *
 * `Coverage` is the one worth reading twice: `notVisitedPct` is nullable, and
 * null is NOT zero. Null means nothing was ever seeded, so coverage could not be
 * measured; zero means every seeded node was walked. Printing null as "0% not
 * visited" tells the estimator the whole site was covered when in fact nobody
 * knows — which is exactly the number a price gets built on.
 */

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

export const SurveyStatusChip = ({ status }: { status: SurveyStatus }) => (
  <Chip tone={SURVEY_TONE[status] ?? "neutral"} dot>
    {SURVEY_STATUS_LABEL[status] ?? status}
  </Chip>
);

export const VisitStatusChip = ({ status }: { status: VisitStatus }) => (
  <Chip tone={VISIT_TONE[status] ?? "neutral"} dot>
    {VISIT_STATUS_LABEL[status] ?? status}
  </Chip>
);

export const VerdictChip = ({ verdict }: { verdict: NodeVerdict }) => (
  <Chip tone={VERDICT_TONE[verdict] ?? "neutral"}>{VERDICT_LABEL[verdict] ?? verdict}</Chip>
);

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
