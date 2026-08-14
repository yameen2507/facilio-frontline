/**
 * The lifecycle as a stage path — the segmented, directional bar CRM detail
 * pages converge on (Salesforce's "Path", Pipedrive's stage bar; checked
 * against real screens on Mobbin, 2026-08). Each stage is a chevron segment
 * pointing at the next, so the bar reads as a flow with a direction, not a row
 * of dots: tinted with a check = done, filled and pulsing = where the lead is
 * NOW, grey = not reached.
 *
 * The subtlety carried over from the dot version: a stage with no timestamp is
 * only "not reached" if the lead never went past it. If it did, the stage was
 * deliberately jumped — `in_review → qualified` is a legal move — and that is
 * a decision worth showing. Hence "skipped" as its own look.
 *
 * The two off-path states render differently on purpose. Nurturing is a pause
 * MID-journey, so its segment slots into the flow after the last stage reached,
 * with the remaining stages still ahead of it. Closed is terminal, so it lands
 * at the END — there is nothing ahead.
 */

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { humanise, onDay, when } from "../../../lib/format";
import type { Lead, LeadStatus } from "../types/lead";

type SegTone = "done" | "current" | "complete" | "upcoming" | "skipped" | "nurture" | "closed";

const SEG: Record<SegTone, string> = {
  done: "bg-primary/10 text-primary",
  current: "bg-primary text-primary-foreground",
  // `complete` is a CONVERTED lead's last segment: the same strong fill as
  // current, but it takes a check instead of the beacon — a finished journey
  // has no liveness to signal.
  complete: "bg-primary text-primary-foreground",
  upcoming: "bg-muted text-muted-foreground/70",
  skipped: "bg-muted/50 text-muted-foreground/60",
  // The Chip orange pair, not a strong orange fill: white 12px text on
  // orange-500 is under 4.5:1 contrast in both themes, and the pulsing beacon
  // already carries the "lead is HERE" signal on its own.
  nurture: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
  closed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

// Chevron geometry. The notch on the left mirrors the point on the right, so
// adjacent segments nest; the first segment has no notch and the last no point,
// which is also what lets their outer corners keep the border radius (clip-path
// intersects with the rounded paint — a corner the polygon covers stays round).
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
        compact ? "h-7 min-w-20 px-3" : "h-11 min-w-28 px-4",
        first && "rounded-l-md",
        last && "rounded-r-md",
        SEG[tone]
      )}
      style={{ clipPath: first && last ? undefined : first ? CHEVRON_FIRST : last ? CHEVRON_LAST : CHEVRON_MID }}
    >
      <span
        className={cn(
          "flex max-w-full items-center gap-1.5 font-medium",
          compact ? "text-[11px]" : "text-xs",
          tone === "skipped" && "italic"
        )}
      >
        {tone === "done" || tone === "complete" ? (
          <Check className="size-3 shrink-0" aria-hidden="true" />
        ) : null}
        {tone === "current" || tone === "nurture" ? (
          // The "you are here" beacon. Pulses only for users who allow motion;
          // for everyone else it is a steady dot, which still marks the stage.
          <span className="size-1.5 shrink-0 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />
        ) : null}
        {/* Ellipsis needs a block child — truncate on the flex parent clips
            dead instead. */}
        <span className="truncate">{label}</span>
      </span>
      {note && !compact ? (
        <span className="max-w-full truncate text-[10px] leading-tight opacity-70">{note}</span>
      ) : null}
    </div>
  );
}

/**
 * `compact` is the condensed strip that sticks to the top of the work area
 * once the full path scrolls away — labels only, half the height, so the
 * lead's position stays readable without the timestamps.
 */
export function LifecycleSteps({ lead, compact = false }: { lead: Lead; compact?: boolean }) {
  const stamps: [string, string | null | undefined][] = [
    ["New", lead.arrivedAt ?? lead.createdAt],
    ["In review", lead.reviewedAt],
    ["Contacted", lead.firstContactAt],
    ["Qualified", lead.qualifiedAt],
    ["Converted", lead.convertedAt],
  ];
  const ORDER: LeadStatus[] = ["new", "in_review", "contacted", "qualified", "converted"];

  // Where the lead stands. Status is authoritative for the highlight; the
  // timestamps say how it got there. -1 means it is off the main path
  // (nurturing or closed), and "behind" falls back to the last stamped stage.
  const currentIdx = ORDER.indexOf(lead.status);
  const lastReached = stamps.reduce((acc, [, at], i) => (at ? i : acc), 0);

  const segs: Seg[] = stamps.map(([label, at], i) => {
    if (i === currentIdx) {
      // Converted is terminal — its segment celebrates completion rather than
      // pulsing forever at a record where nothing more will happen.
      const tone = lead.status === "converted" ? "complete" : "current";
      return { tone, label, note: at ? when(at) : "now" };
    }
    const behind = currentIdx >= 0 ? i < currentIdx : i <= lastReached;
    if (behind) {
      return at ? { tone: "done", label, note: when(at) } : { tone: "skipped", label, note: "skipped" };
    }
    return { tone: "upcoming", label, note: "" };
  });

  if (lead.status === "nurture") {
    segs.splice(lastReached + 1, 0, {
      tone: "nurture",
      label: "Nurturing",
      note: lead.nurtureUntil ? `until ${onDay(lead.nurtureUntil)}` : "no date set",
    });
  }

  if (lead.status === "closed") {
    segs.push({ tone: "closed", label: "Closed", note: humanise(lead.dispositionReason) });
  }

  return (
    // Chevrons do not wrap the way dots did — a broken arrow points at nothing.
    // On a narrow screen the bar scrolls in its own container instead; the
    // scroller is focusable because the segments hold nothing that is, and a
    // keyboard can't reach the later stages otherwise.
    <div className="overflow-x-auto" tabIndex={0} aria-label="Lead stage path">
      <div className="flex w-full gap-[3px]">
        {segs.map((s, i) => (
          <Segment key={s.label} {...s} first={i === 0} last={i === segs.length - 1} compact={compact} />
        ))}
      </div>
    </div>
  );
}
