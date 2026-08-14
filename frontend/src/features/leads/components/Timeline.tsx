/**
 * Activity as a real timeline — icon nodes on a connecting rail, grouped by
 * day — and the ownership list, which uses the same node look without a rail
 * (assignments are current holders, not a sequence to walk).
 *
 * Event kinds arrive as the server writes them (`status.qualified`,
 * `activity.call`, `analysed`…); `eventMeta` translates each into an icon and
 * a sentence a reader doesn't have to decode. An unknown kind falls back to
 * the raw name humanised rather than disappearing — a new server event should
 * show up ugly, not not at all.
 *
 * Times render through the Date formatters, not string slices: `occurredAt`
 * is UTC, and the old `.slice(11, 16)` showed UTC clock time beside lifecycle
 * stamps formatted in local time.
 */

import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CircleDot,
  CircleX,
  Clock,
  GitMerge,
  Hand,
  Handshake,
  Inbox,
  Mail,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  RefreshCw,
  Sparkles,
  StickyNote,
  UserCog,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { isToday, isYesterday } from "date-fns";
import { cn } from "@/lib/utils";
import { humanise, onDay } from "../../../lib/format";
import type { Assignment, TimelineEvent } from "../types/lead";

// ── Event vocabulary ─────────────────────────────────────────────────────

type EventMeta = { Icon: LucideIcon; label: string; tone: string };

const NEUTRAL = "bg-muted text-muted-foreground";

function eventMeta(kind: string): EventMeta {
  switch (kind) {
    case "created":
      return { Icon: Inbox, label: "Lead captured", tone: NEUTRAL };
    case "created.duplicate":
      return {
        Icon: GitMerge,
        label: "Duplicate captured",
        tone: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
      };
    case "updated":
      return { Icon: Pencil, label: "Details updated", tone: NEUTRAL };
    case "claimed":
      return { Icon: Hand, label: "Claimed", tone: NEUTRAL };
    case "assigned":
      return { Icon: UserPlus, label: "Assigned", tone: NEUTRAL };
    case "analysed":
      return { Icon: Sparkles, label: "AI assessed", tone: "bg-primary/10 text-primary" };
    case "converted":
      return {
        Icon: BadgeCheck,
        label: "Converted to deal",
        tone: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
      };
    case "synced":
      return { Icon: RefreshCw, label: "Synced to Facilio", tone: NEUTRAL };
    case "intake.submitted":
      // The conversation that produced the lead — the full transcript is the
      // Conversation tab beside this one.
      return { Icon: MessageSquare, label: "Captured from website chat", tone: "bg-primary/10 text-primary" };
  }

  if (kind.startsWith("status.")) {
    const to = kind.slice("status.".length);
    if (to === "closed") {
      return {
        Icon: CircleX,
        label: "Closed",
        tone: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
      };
    }
    if (to === "converted") {
      return {
        Icon: BadgeCheck,
        label: "Converted",
        tone: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
      };
    }
    if (to === "nurture") {
      return {
        Icon: Clock,
        label: "Moved to nurture",
        tone: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
      };
    }
    return { Icon: ArrowRight, label: `Moved to ${humanise(to)}`, tone: NEUTRAL };
  }

  if (kind.startsWith("activity.")) {
    const what = kind.slice("activity.".length);
    const ACTIVITY: Record<string, { Icon: LucideIcon; label: string }> = {
      call: { Icon: Phone, label: "Call logged" },
      email: { Icon: Mail, label: "Email logged" },
      note: { Icon: StickyNote, label: "Note added" },
      meeting: { Icon: CalendarDays, label: "Meeting logged" },
      attachment: { Icon: Paperclip, label: "Attachment added" },
    };
    const hit = ACTIVITY[what];
    if (hit) return { ...hit, tone: NEUTRAL };
  }

  return { Icon: CircleDot, label: humanise(kind), tone: NEUTRAL };
}

// ── Timeline ─────────────────────────────────────────────────────────────

const timeOf = (at: string | null | undefined): string =>
  at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

const dayLabel = (at: string): string => {
  const d = new Date(at);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return onDay(at);
};

/** Consecutive events sharing a local calendar day, under one divider. */
function groupByDay(events: TimelineEvent[]): { label: string; events: TimelineEvent[] }[] {
  const groups: { label: string; events: TimelineEvent[] }[] = [];
  for (const e of events) {
    const label = e.occurredAt ? dayLabel(e.occurredAt) : "Undated";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.events.push(e);
    else groups.push({ label, events: [e] });
  }
  return groups;
}

function EventRow({ event, last }: { event: TimelineEvent; last: boolean }) {
  const { Icon, label, tone } = eventMeta(event.kind);
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* The rail: drawn by each row down to the next node, dropped by the
          day's last row so the line ends at a node, not in space. */}
      {!last ? <span className="bg-border absolute top-7 bottom-0 left-[13px] w-px" aria-hidden="true" /> : null}
      <span className={cn("relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full", tone)}>
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{label}</span>
          {event.actor ? (
            <span className="text-muted-foreground truncate text-xs">{event.actor.split("@")[0]}</span>
          ) : null}
          <span className="flex-1" aria-hidden="true" />
          <span className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
            {timeOf(event.occurredAt)}
          </span>
        </div>
        {event.body ? <div className="text-foreground/90 mt-0.5 text-sm">{event.body}</div> : null}
      </div>
    </li>
  );
}

export const Timeline = ({ events }: { events: TimelineEvent[] }) => {
  if (!events.length) {
    return <div className="text-muted-foreground py-2 text-sm">Nothing has happened on this lead yet.</div>;
  }
  return (
    <div>
      {groupByDay(events).map((group) => (
        <div key={group.label} className="mt-5 first:mt-0">
          <div className="text-muted-foreground mb-3 text-[10px] font-medium tracking-[0.06em] uppercase">
            {group.label}
          </div>
          <ol className="list-none">
            {group.events.map((e, i) => (
              // Events carry no id and two can share a timestamp, so the index
              // is the only stable key. The list is append-only and never
              // reordered, which is what makes that safe here.
              <EventRow key={i} event={e} last={i === group.events.length - 1} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
};

// ── Ownership ────────────────────────────────────────────────────────────

/** The role vocabulary the assign dialog writes; anything else shows raw. */
const ROLE: Record<string, { Icon: LucideIcon; label: string }> = {
  sales: { Icon: Handshake, label: "Sales owner" },
  actioner: { Icon: UserCog, label: "Actioner" },
};

export const Ownership = ({ assignments }: { assignments: Assignment[] }) => {
  if (!assignments.length) {
    return <div className="text-muted-foreground py-1 text-sm">Not assigned to anyone yet.</div>;
  }
  return (
    <ul className="list-none">
      {assignments.map((a, i) => {
        const { Icon, label } = ROLE[a.role] ?? { Icon: UserPlus, label: humanise(a.role) };
        return (
          <li
            key={i}
            className="flex gap-2.5 border-b border-dashed py-2.5 first:pt-0 last:border-b-0 last:pb-0"
          >
            <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium">{label}</span>
                <span className="flex-1" aria-hidden="true" />
                <span className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
                  {onDay(a.createdAt)}
                </span>
              </div>
              <div className="text-foreground/90 text-sm break-words">{a.toUser}</div>
              {a.reason ? <div className="text-muted-foreground text-xs">{a.reason}</div> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
