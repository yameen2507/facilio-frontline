/**
 * The deal lifecycle as a stage path — the same segmented chevron bar the lead
 * detail page uses (leads/components/LifecycleSteps.tsx is the reference
 * implementation; the geometry is copied from there so the two records read
 * identically).
 *
 * One structural difference from the lead path: a deal carries no per-stage
 * timestamps — the timeline holds the history — so segments are positional.
 * Stages behind the current one read as done whether they were walked or
 * skipped; the skips the machine allows (deal.md's "lifecycle flexibility")
 * are a fact for the timeline, not a warning for the path.
 *
 * Won and lost land at the END: both are terminal, so there is nothing ahead.
 * A lost deal keeps its walked stages tinted up to where it died
 * (`data.closedFromStage`), because "lost in negotiation" and "lost at first
 * contact" are different stories and the bar should tell them apart.
 */

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { onDay } from "../../../lib/format";
import { ACTIVE_STAGES, STAGE_LABEL, type Deal, type DealStage } from "../types/deal";

type SegTone = "done" | "current" | "complete" | "upcoming" | "closed";

const SEG: Record<SegTone, string> = {
  done: "bg-primary/10 text-primary",
  current: "bg-primary text-primary-foreground",
  complete: "bg-primary text-primary-foreground",
  upcoming: "bg-muted text-muted-foreground/70",
  closed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const NOTCH = "10px";
const CHEVRON_MID = `polygon(0 0, calc(100% - ${NOTCH}) 0, 100% 50%, calc(100% - ${NOTCH}) 100%, 0 100%, ${NOTCH} 50%)`;
const CHEVRON_FIRST = `polygon(0 0, calc(100% - ${NOTCH}) 0, 100% 50%, calc(100% - ${NOTCH}) 100%, 0 100%)`;
const CHEVRON_LAST = `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${NOTCH} 50%)`;

type Seg = { tone: SegTone; label: string; note: string };

function Segment({
  tone,
  label,
  note,
  first,
  last,
  compact,
}: Seg & { first: boolean; last: boolean; compact: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center text-center",
        compact ? "h-7 min-w-16 px-2.5" : "h-11 min-w-24 px-3",
        first && "rounded-l-md",
        last && "rounded-r-md",
        SEG[tone]
      )}
      style={{ clipPath: first && last ? undefined : first ? CHEVRON_FIRST : last ? CHEVRON_LAST : CHEVRON_MID }}
    >
      <span
        className={cn(
          "flex max-w-full items-center gap-1.5 font-medium",
          compact ? "text-[11px]" : "text-xs"
        )}
      >
        {tone === "done" || tone === "complete" ? (
          <Check className="size-3 shrink-0" aria-hidden="true" />
        ) : null}
        {tone === "current" ? (
          <span className="size-1.5 shrink-0 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />
        ) : null}
        <span className="truncate">{label}</span>
      </span>
      {note && !compact ? (
        <span className="max-w-full truncate text-[10px] leading-tight opacity-70">{note}</span>
      ) : null}
    </div>
  );
}

export function StagePath({ deal, compact = false }: { deal: Deal; compact?: boolean }) {
  const closed = deal.stage === "won" || deal.stage === "lost";

  // Where the working funnel stops being "behind". For a closed deal that is
  // the stage it closed FROM — recorded at close time; a legacy row without
  // the record shows the whole path walked, which errs on the side of credit.
  const closedFrom = (deal.data?.closedFromStage as DealStage | undefined) ?? null;
  const reachedIdx = closed
    ? closedFrom
      ? ACTIVE_STAGES.indexOf(closedFrom)
      : ACTIVE_STAGES.length - 1
    : ACTIVE_STAGES.indexOf(deal.stage);

  const segs: Seg[] = ACTIVE_STAGES.map((stage, i) => {
    if (!closed && i === reachedIdx) return { tone: "current", label: STAGE_LABEL[stage], note: "now" };
    if (i <= reachedIdx) return { tone: "done", label: STAGE_LABEL[stage], note: "" };
    return { tone: "upcoming", label: STAGE_LABEL[stage], note: "" };
  });

  if (deal.stage === "won") {
    segs.push({ tone: "complete", label: "Won", note: deal.wonAt ? onDay(deal.wonAt) : "" });
  }
  if (deal.stage === "lost") {
    segs.push({
      tone: "closed",
      label: "Lost",
      note: deal.lostReason ? deal.lostReason.replace(/_/g, " ") : "",
    });
  }

  return (
    // Chevrons do not wrap — a broken arrow points at nothing. The bar scrolls
    // in its own container instead, and the scroller is focusable because the
    // segments hold nothing that is.
    <div className="overflow-x-auto" tabIndex={0} aria-label="Deal stage path">
      <div className="flex w-full gap-[3px]">
        {segs.map((s, i) => (
          <Segment key={s.label} {...s} first={i === 0} last={i === segs.length - 1} compact={compact} />
        ))}
      </div>
    </div>
  );
}
