/**
 * The lifecycle, made visible from the timestamps the transition handler stamps.
 *
 * The subtlety worth keeping: a stage with no timestamp is only "pending" if
 * nothing after it happened. If a LATER stage did, this one was deliberately
 * jumped — `in_review → qualified` is a legal move — and that is a decision worth
 * showing rather than leaving it to look identical to a stage not yet reached.
 * Hence three visual states, not two: done, skipped, and not yet.
 */

import { cn } from "@/lib/utils";
import { when } from "../../../lib/format";
import type { Lead } from "../types/lead";

type StepTone = "pending" | "done" | "skip" | "closed" | "warm";

const DOT: Record<StepTone, string> = {
  pending: "bg-card",
  done: "border-green-600 bg-green-600 dark:border-green-500 dark:bg-green-500",
  // Dashed and hollow: a stage that was jumped, not one that happened.
  skip: "border-dashed border-orange-500 bg-transparent",
  closed: "border-red-600 bg-red-600 dark:border-red-500 dark:bg-red-500",
  warm: "border-orange-500 bg-orange-500",
};

function Step({ tone, label, note }: { tone: StepTone; label: string; note: string }) {
  return (
    <div
      className={cn(
        "relative flex min-w-32 flex-1 items-center gap-3",
        // The connector to the next dot, drawn by the step it leaves. It spans
        // the step and reaches into the row gap, so the last step drops it.
        "after:absolute after:top-[5px] after:-right-1.5 after:left-[11px] after:h-0.5 after:bg-border after:content-[''] last:after:hidden"
      )}
    >
      {/* The connector crosses the whole step; dot and text sit at z-[1] so it
          runs behind them rather than through the label. */}
      <i className={cn("relative z-[1] size-[11px] shrink-0 rounded-full border-2", DOT[tone])} />
      <div className="relative z-[1]">
        <b
          className={cn(
            "block text-xs",
            tone === "done" ? "font-medium" : "text-muted-foreground font-normal",
            tone === "skip" && "italic"
          )}
        >
          {label}
        </b>
        <span className={cn("block text-xs", tone === "skip" ? "text-orange-500" : "text-muted-foreground")}>
          {note}
        </span>
      </div>
    </div>
  );
}

export function LifecycleSteps({ lead }: { lead: Lead }) {
  const stages: [string, string | null | undefined][] = [
    ["Arrived", lead.arrivedAt],
    ["In review", lead.reviewedAt],
    ["Contacted", lead.firstContactAt],
    ["Qualified", lead.qualifiedAt],
    ["Converted", lead.convertedAt],
  ];

  const lastReached = stages.reduce((acc, [, at], i) => (at ? i : acc), -1);

  return (
    <div className="flex flex-wrap gap-2">
      {stages.map(([label, at], i) => {
        const skipped = !at && i < lastReached;
        return (
          <Step
            key={label}
            tone={at ? "done" : skipped ? "skip" : "pending"}
            label={label}
            note={at ? when(at) : skipped ? "skipped" : "—"}
          />
        );
      })}

      {lead.status === "closed" ? (
        <Step tone="closed" label="Closed" note={lead.dispositionReason ?? ""} />
      ) : null}

      {lead.status === "nurture" ? (
        <Step
          tone="warm"
          label="Nurturing"
          note={lead.nurtureUntil ? `until ${lead.nurtureUntil.slice(0, 10)}` : "no date set"}
        />
      ) : null}
    </div>
  );
}
