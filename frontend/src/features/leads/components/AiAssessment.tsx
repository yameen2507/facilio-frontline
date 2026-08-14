/**
 * The analyst's verdict.
 *
 * The score is coloured by URGENCY, not by good/bad: a high score is a hot lead
 * someone needs to call, which is why 75+ is red rather than green.
 *
 * The card has three faces: the verdict, the analyst mid-run (the page starts
 * the run itself on an unassessed lead — see LeadDetail's auto-assess effect),
 * and the manual empty state, which is now the FALLBACK — it appears only when
 * an auto-run failed or on a terminal lead, so its button is the retry.
 */

import { useEffect, useState, type ComponentProps } from "react";
import { Check, CircleHelp, Lightbulb, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../../../ui/Button";
import { Chip } from "../../../ui/Chip";
import { Empty } from "../../../ui/States";
import { ago, humanise } from "../../../lib/format";
import type { Analysis, Lead } from "../types/lead";

// The stages the run actually goes through (prompt built from your coverage,
// model call, parse and store) — the ticker describes real work, it does not
// invent progress it cannot know.
const WORKING_LINES = [
  "Reading the enquiry…",
  "Checking your service coverage…",
  "Scoring relevance…",
  "Writing up what to ask before quoting…",
];

/**
 * The analyst mid-run. Ambient by design: the ring breathes and the line
 * ticks through the pipeline's stages, signalling liveness for the several
 * seconds a model call takes — not progress, which the page cannot measure.
 * Reduced-motion users get a still ring; the line still changes (content,
 * not movement).
 */
function AnalystWorking() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % WORKING_LINES.length), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center" aria-busy="true">
      <div className="relative flex size-12 items-center justify-center">
        {/* Same 2.2s beat as the ticker, so the two read as one heartbeat. */}
        <span
          className="bg-primary/20 absolute inset-0 rounded-full [animation-duration:2.2s] motion-safe:animate-ping"
          aria-hidden="true"
        />
        <span className="bg-primary/10 text-primary relative flex size-12 items-center justify-center rounded-full">
          <Sparkles className="size-5" aria-hidden="true" />
        </span>
      </div>
      <div className="text-sm font-medium">Analyst at work</div>
      {/* Keyed so each line re-enters with a fade rather than snapping. */}
      <div
        key={step}
        className="text-muted-foreground text-xs motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700"
        aria-live="polite"
      >
        {WORKING_LINES[step]}
      </div>
    </div>
  );
}

const scoreColour = (score: number | null | undefined): string =>
  score === null || score === undefined
    ? "text-muted-foreground"
    : score >= 75
      ? "text-red-600 dark:text-red-400"
      : score >= 50
        ? "text-orange-600 dark:text-orange-400"
        : "text-muted-foreground";

/** The arc wears the same urgency colour the number does. */
const ringColour = (score: number): string =>
  score >= 75
    ? "stroke-red-600 dark:stroke-red-400"
    : score >= 50
      ? "stroke-orange-600 dark:stroke-orange-400"
      : "stroke-muted-foreground";

/** hot/warm/cool/cold, coloured by the urgency they encode (domain/scoring). */
const BAND_TONE: Record<string, ComponentProps<typeof Chip>["tone"]> = {
  hot: "red",
  warm: "orange",
  cool: "blue",
  cold: "neutral",
};

/**
 * The score as a ring gauge — one status-coloured arc on a recessive track,
 * the number in the middle. The arc draws in on mount (700ms, once); reduced
 * motion renders it directly at its end state.
 */
function ScoreRing({ score }: { score: number | null | undefined }) {
  const value = typeof score === "number" ? Math.max(0, Math.min(100, score)) : null;
  // A transition needs a frame at the empty state to travel FROM — rendering
  // straight at the target would draw nothing.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const R = 26;
  const C = 2 * Math.PI * R;

  return (
    <div className="relative size-16 shrink-0">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={R} fill="none" strokeWidth="5" className="stroke-muted" />
        {value !== null ? (
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={drawn ? C * (1 - value / 100) : C}
            className={cn(
              "transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none",
              ringColour(value)
            )}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn("text-lg leading-none font-semibold tabular-nums", scoreColour(value))}>
          {value ?? "—"}
        </span>
      </div>
    </div>
  );
}

export function AiAssessment({
  lead,
  band,
  analysis,
  onAssess,
  assessing,
  canAssess = true,
}: {
  lead: Lead;
  band?: string | null;
  analysis?: Analysis | null;
  onAssess: () => void;
  assessing: boolean;
  /** Whether the signed-in role may run the analyst — a run writes an analysis
      version, so the buttons are withheld, not just disabled, when it may not. */
  canAssess?: boolean;
}) {
  if (!analysis) {
    if (assessing) return <AnalystWorking />;
    return (
      <Empty
        title="Not assessed yet"
        body="The analyst scores relevance against your service coverage and says what to ask before quoting."
        action={
          canAssess ? (
            <Button variant="primary" onClick={onAssess}>
              Assess with AI
            </Button>
          ) : undefined
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ScoreRing score={lead.score} />
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={lead.verdict === "relevant" ? "green" : "red"}>{humanise(String(lead.verdict))}</Chip>
            {band ? <Chip tone={BAND_TONE[band] ?? "neutral"} dot>{band}</Chip> : null}
          </div>
          <div className="text-muted-foreground mt-1.5 text-xs">
            out of 100 · assessed {ago(lead.analysedAt)}
            {/* X-07: the verdict's provenance — which model, which prompt,
                which run — so a score can be argued with, not just believed. */}
            {analysis.modelName ? ` · ${analysis.modelName}` : ""}
            {analysis.promptVersion ? ` · prompt ${analysis.promptVersion}` : ""}
            {analysis.version != null ? ` · run ${analysis.version}` : ""}
          </div>
        </div>
        <span className="flex-1" aria-hidden="true" />
        {/* Beside the verdict it refreshes, not in the page header — and named
            for what it does: re-run the analyst over the lead's CURRENT
            details. Earlier versions are kept, so nothing is lost by pressing
            it. Withheld, not disabled, for a role the matrix bars from
            assessing: a run writes a version. */}
        {canAssess ? (
          <Button
            small
            glyph="refresh"
            onClick={onAssess}
            disabled={assessing}
            title="Runs the analyst again over the lead's latest details. Earlier assessments are kept as versions."
          >
            {assessing ? "Assessing…" : "Update assessment"}
          </Button>
        ) : null}
      </div>

      {nextAction ? (
        // The one thing the reader came for, as a callout rather than another
        // bullet section — it is the analyst's answer, not its working.
        <div className="bg-primary/5 mt-4 flex gap-2.5 rounded-md px-3 py-2.5">
          <Lightbulb className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-primary text-[10px] font-medium tracking-[0.06em] uppercase">
              Recommended next step
            </div>
            <div className="mt-0.5 text-sm">{nextAction}</div>
          </div>
        </div>
      ) : null}

      {/* The working: evidence and open questions side by side where the pane
          is wide enough to hold both, stacked below that. */}
      <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 min-[1360px]:grid-cols-2">
        {reasons.length ? (
          <div>
            <div className="text-muted-foreground mb-2 text-[10px] font-medium tracking-[0.06em] uppercase">
              Why this score
            </div>
            <ul className="flex list-none flex-col gap-1.5">
              {reasons.slice(0, 6).map((r, i) => (
                <li key={i} className="text-foreground/90 flex gap-2 text-sm">
                  <Check
                    className="mt-0.5 size-3.5 shrink-0 text-green-600 dark:text-green-500"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {missing.length ? (
          <div>
            <div className="text-muted-foreground mb-2 text-[10px] font-medium tracking-[0.06em] uppercase">
              Ask before quoting
            </div>
            <ul className="flex list-none flex-col gap-1.5">
              {missing.slice(0, 5).map((r, i) => (
                <li key={i} className="text-foreground/90 flex gap-2 text-sm">
                  <CircleHelp
                    className="mt-0.5 size-3.5 shrink-0 text-orange-600 dark:text-orange-400"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </>
  );
}
