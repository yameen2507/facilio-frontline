/**
 * What an advisory agent said, on whichever record it read.
 *
 * ONE COMPONENT FOR EVERY AGENT, because their replies are close enough in
 * shape: a map of fields, tens wide, differing mostly in which keys are filled.
 * A panel per agent would be six copies of this with different labels.
 *
 * "Close enough" and not "identical", and the difference cost a bug: five of
 * the six return flat strings, but `lead-intelligence` nests — twelve of its
 * seventeen fields are objects or arrays of objects. `toLines` below is what
 * absorbs that, and it is why every value goes through one reader rather than
 * being rendered where it is found.
 *
 * THE FOLD IS THE DESIGN. These agents answer every check they were given, so
 * most of a reply is "None" and "Not applicable" — which is information (it was
 * checked and it was clean) but not information anyone needs at a glance. So
 * what it flagged is open, what it cleared is folded behind a count, and
 * nothing is dropped. A panel that showed only problems would be unable to tell
 * "checked, fine" apart from "never looked".
 *
 * AND IT DECIDES NOTHING. No button here changes a status, a stage or a price;
 * the agents themselves refuse to, several saying so in their own guardrails.
 * A person reads this and acts.
 */

import { useState } from "react";
import { Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Assessment } from "../lib/assess";
import { ago } from "../lib/format";
import { Card } from "./Card";
import { Chip, type Tone } from "./Chip";
import { CLEAR, humanise, isAfter, SOURCE_FLAGS, toLines } from "./assessment-fields";

/** Read off each agent's own schema. Ordered as a person reads them. */
const FIRST: Record<string, string[]> = {
  "proposal-intelligence": [
    "preSendReadinessReason", "missingRequirements", "inconsistencies", "scopeCheck",
    "serviceCheck", "quantityCheck", "frequencyCheck", "pricingCheck", "rateCardCheck",
    "recommendedCorrection", "primaryNextAction",
  ],
  "estimation-intelligence": [
    "commercialReadinessReason", "exceptions", "serviceLines", "calculations",
    "applicableRateCard", "minimumChargeNotes", "assumptions", "primaryNextAction",
  ],
  "survey-intelligence": [
    "commercialReadinessReason", "missingInformation", "inconsistencies", "risks",
    "cleaningScope", "measurements", "services", "frequencies", "primaryNextAction",
  ],
  "lost-deal-intelligence": [
    "primaryLossReason", "secondaryLossReasons", "pricePosition", "competitor",
    "customerFeedback", "lessonsLearned", "winLossPattern", "recommendedAction",
    "reengagementOpportunity",
  ],
  "handover-intelligence": [
    "operationalReadinessReason", "outstandingActions", "handoverRisks", "documents",
    "finalScope", "sites", "services", "frequency", "quantities", "timing", "manpower",
    "exclusions", "specialRequirements", "commitments", "contacts", "versionConflicts",
    "primaryNextAction",
  ],
  "lead-intelligence": [
    "leadUnderstanding", "serviceFit", "regionFit", "redFlags", "dataGaps",
    "completeness", "accountSignal", "opportunity", "urgency",
    "qualificationRecommendation", "nextBestAction",
  ],
};

/**
 * Status to colour. Written per agent rather than by keyword matching: these
 * are declared enums, and a regex over them would silently mis-colour the day
 * an agent's schema gains a value.
 */
function tone(agent: string, status: string | null): Tone {
  if (!status) return "neutral";
  switch (agent) {
    case "proposal-intelligence":
      if (status === "Ready to Send") return "green";
      if (status === "Ready with Minor Corrections") return "orange";
      return "red";
    case "estimation-intelligence":
      if (status === "Ready for Commercial Review") return "green";
      if (status === "Ready with Minor Exceptions") return "orange";
      return "red";
    case "survey-intelligence":
      if (status === "Ready for Estimation") return "green";
      if (status === "Ready with Minor Gaps") return "orange";
      return "red";
    case "lost-deal-intelligence":
      if (status === "Confirmed") return "green";
      if (status === "Strong Signal") return "blue";
      if (status === "Possible") return "orange";
      return "neutral";
    case "handover-intelligence":
      if (status === "Ready for Operations") return "green";
      if (status === "Ready with Minor Actions") return "orange";
      return "red";
    case "lead-intelligence":
      if (status === "P1") return "red";
      if (status === "P2") return "orange";
      if (status === "P3") return "blue";
      return "neutral";
    default:
      return "neutral";
  }
}

/** One field: its label, then its lines — a bullet list once there is more than one. */
function Finding({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground text-[10px] font-medium tracking-[0.06em] uppercase">
        {label}
      </div>
      {lines.length > 1 ? (
        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-sm">
          {lines.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : (
        <div className="text-sm">{lines[0]}</div>
      )}
    </div>
  );
}

export function AssessmentPanel({
  title,
  assessment,
  running,
  onRun,
  runLabel = "Run check",
  /** Why the run is unavailable. A disabled control that explains itself. */
  disabledReason,
  /** What this agent is for, shown before it has ever run. */
  blurb,
  /**
   * The record's own `updatedAt`. A verdict read after the record changed is a
   * verdict about the old record, and "2h ago" does not say that — you have to
   * already know when the edit was to work it out.
   *
   * Storing an assessment does NOT touch the record, so a fresh run can never
   * mark itself stale.
   */
  recordUpdatedAt,
  /** What changed, in this record's words: "proposal", "survey", "lead". */
  recordNoun = "record",
  /** What the reader should do about it. */
  staleAdvice,
}: {
  title: string;
  assessment: Assessment | null;
  running: boolean;
  onRun: () => void;
  runLabel?: string;
  disabledReason?: string | null;
  blurb: string;
  recordUpdatedAt?: string | null;
  recordNoun?: string;
  staleAdvice?: string;
}) {
  const [showClear, setShowClear] = useState(false);

  const runButton = (
    <Button
      size="sm"
      variant="outline"
      onClick={onRun}
      disabled={running || Boolean(disabledReason)}
      title={disabledReason ?? blurb}
    >
      <Sparkles className="size-4" />
      {running ? "Reading…" : assessment ? "Run again" : runLabel}
    </Button>
  );

  if (!assessment) {
    return (
      <Card title={title}>
        <div className="flex flex-col items-start gap-3">
          <div className="text-muted-foreground text-xs">
            {disabledReason ?? blurb}
          </div>
          {runButton}
        </div>
      </Card>
    );
  }

  // STRICTLY after, so a record touched in the same second as the run does not
  // read as stale. An unparseable date on either side means we cannot know —
  // and a staleness warning nobody can trust is worse than none.
  const stale = isAfter(recordUpdatedAt, assessment.createdAt);

  const fields = assessment.fields ?? {};
  const order = FIRST[assessment.agent] ?? [];
  const keys = [...order.filter((k) => k in fields), ...Object.keys(fields).filter((k) => !order.includes(k))];

  const flagged: Array<[string, string[]]> = [];
  const cleared: Array<[string, string[]]> = [];
  const sources: string[] = [];

  for (const key of keys) {
    const lines = toLines(fields[key]);
    if (!lines.length) continue;
    // The headline fields are already in the header; the summary is above.
    if (key === "summary" || lines.join(" ") === assessment.summary) continue;
    if (SOURCE_FLAGS.test(key)) {
      sources.push(`${humanise(key).replace(/ provided$/i, "")}: ${lines.join(", ")}`);
      continue;
    }
    // Clear only when EVERY line is clear — a list with one real finding and
    // four "not applicable"s belongs open, not folded away.
    (lines.every((l) => CLEAR.test(l)) ? cleared : flagged).push([humanise(key), lines]);
  }

  // `lead-intelligence` nests its data-gap flags one level down; the other five
  // put theirs at the top. Same meaning, so the same footer line.
  const gaps = fields.dataGaps;
  if (gaps && typeof gaps === "object" && !Array.isArray(gaps)) {
    for (const [k, v] of Object.entries(gaps)) {
      if (SOURCE_FLAGS.test(k)) sources.push(`${humanise(k).replace(/ provided$/i, "")}: ${String(v)}`);
    }
  }

  return (
    <Card
      title={title}
      meta={
        <span className="flex items-center gap-2">
          {/* Greyed once stale. The verdict is still readable — it may well
              still be right — but it stops LOOKING current, which is the half
              of the message a banner alone cannot carry. */}
          <Chip tone={stale ? "neutral" : tone(assessment.agent, assessment.status)} dot small>
            {assessment.status ?? "no status returned"}
          </Chip>
          {assessment.headline && assessment.headline !== assessment.status ? (
            <Chip small>{assessment.headline}</Chip>
          ) : null}
          {/* WHEN it ran, not just which run it was. A verdict read after the
              price changed is a verdict about the old price, and the version
              number alone cannot say that. */}
          <span>
            v{assessment.version} · {ago(assessment.createdAt)}
          </span>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        {stale ? (
          <div className="border-border bg-muted/50 text-muted-foreground flex items-start gap-2 rounded-md border p-3 text-xs">
            <TriangleAlert className="text-foreground/70 mt-px size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="text-foreground font-medium">
                This {recordNoun} changed after the check ran.
              </span>{" "}
              {staleAdvice ?? "Run it again before you rely on it."}
            </span>
          </div>
        ) : null}

        {assessment.summary ? <div className="text-sm">{assessment.summary}</div> : null}

        {flagged.length ? (
          <div className="flex flex-col gap-3">
            {flagged.map(([label, value]) => (
              <Finding key={label} label={label} lines={value} />
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground text-sm">
            Nothing flagged. Every check came back clear.
          </div>
        )}

        {cleared.length ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setShowClear((v) => !v)}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring w-fit rounded text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
            >
              {showClear ? "Hide" : "Show"} {cleared.length} check
              {cleared.length === 1 ? "" : "s"} that came back clear
            </button>
            {showClear ? (
              <div className="flex flex-col gap-3">
                {cleared.map(([label, value]) => (
                  <Finding key={label} label={label} lines={value} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* What the brief actually carried. An agent that reports "no tender"
            is telling you about the input, not about the proposal. */}
        {sources.length ? (
          <div className="text-muted-foreground border-t pt-3 text-xs">
            Sources it was given — {sources.join(" · ")}
          </div>
        ) : null}

        <div className="flex items-center gap-3 border-t pt-3">
          {runButton}
          <span className="text-muted-foreground text-xs">
            Advisory. Nothing here has changed the record — a person decides.
          </span>
        </div>
      </div>
    </Card>
  );
}
