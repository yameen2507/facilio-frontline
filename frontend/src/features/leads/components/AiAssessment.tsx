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
    ? "var(--colors-text-description)"
    : score >= 75
      ? "var(--colors-background-semantic-red-medium)"
      : score >= 50
        ? "var(--colors-background-semantic-orange-medium)"
        : "var(--colors-text-description)";

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
      <div className="verdict">
        <div>
          <div className="big" style={{ color: scoreColour(lead.score) }}>
            {lead.score}
          </div>
          <div className="of">of 100 · {band ?? ""}</div>
        </div>
        <div>
          <Chip tone={lead.verdict === "relevant" ? "green" : "red"}>{humanise(String(lead.verdict))}</Chip>
          <div className="of" style={{ marginTop: "var(--numerical-nl-01)" }}>
            assessed {ago(lead.analysedAt)}
          </div>
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
          <ul className="reasons">
            {reasons.slice(0, 6).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      ) : null}

      {missing.length ? (
        <>
          <SectionTitle>Ask before quoting</SectionTitle>
          <ul className="reasons">
            {missing.slice(0, 5).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
