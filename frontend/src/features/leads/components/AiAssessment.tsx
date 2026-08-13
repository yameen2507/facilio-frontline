/**
 * The analyst's verdict.
 *
 * The score is coloured by URGENCY, not by good/bad: a high score is a hot lead
 * someone needs to call, which is why 75+ is red rather than green.
 */

import { Button } from "../../../ui/Button";
import { SectionTitle } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { Empty } from "../../../ui/States";
import { ago, humanise } from "../../../lib/format";
import type { Analysis, Lead } from "../types/lead";

const scoreColour = (score: number | null | undefined): string =>
  score === null || score === undefined
    ? "text-muted-foreground"
    : score >= 75
      ? "text-red-600 dark:text-red-400"
      : score >= 50
        ? "text-orange-600 dark:text-orange-400"
        : "text-muted-foreground";

export function AiAssessment({
  lead,
  band,
  analysis,
  onAssess,
  assessing,
}: {
  lead: Lead;
  band?: string | null;
  analysis?: Analysis | null;
  onAssess: () => void;
  assessing: boolean;
}) {
  if (!analysis) {
    return (
      <Empty
        title="Not assessed yet"
        body="The analyst scores relevance against your service coverage and says what to ask before quoting."
        action={
          <Button variant="primary" onClick={onAssess} disabled={assessing}>
            {assessing ? "Assessing…" : "Assess with AI"}
          </Button>
        }
        tight
      />
    );
  }

  const reasons = analysis.reasons ?? [];
  const missing = analysis.understanding?.missingInfo ?? [];
  const nextAction = analysis.recommendation?.nextAction;

  return (
    <>
      <div className="mb-4 flex items-center gap-4">
        <div>
          <div
            className={`text-[32px] leading-none font-medium tracking-tight tabular-nums ${scoreColour(lead.score)}`}
          >
            {lead.score}
          </div>
          <div className="text-muted-foreground text-xs">of 100 · {band ?? ""}</div>
        </div>
        <div>
          <Chip tone={lead.verdict === "relevant" ? "green" : "red"}>{humanise(String(lead.verdict))}</Chip>
          <div className="text-muted-foreground mt-1 text-xs">assessed {ago(lead.analysedAt)}</div>
        </div>
      </div>

      {nextAction ? (
        <>
          <SectionTitle>Recommended next step</SectionTitle>
          <div>{nextAction}</div>
        </>
      ) : null}

      {reasons.length ? (
        <>
          <SectionTitle>Why</SectionTitle>
          <ul className="list-disc space-y-1 pl-4 text-sm text-foreground/90">
            {reasons.slice(0, 6).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      ) : null}

      {missing.length ? (
        <>
          <SectionTitle>Ask before quoting</SectionTitle>
          <ul className="list-disc space-y-1 pl-4 text-sm text-foreground/90">
            {missing.slice(0, 5).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
