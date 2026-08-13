/**
 * Activity and ownership — two lists over the same row shape, shared as class
 * strings so the two cannot drift apart.
 */

import type { Assignment, TimelineEvent } from "../types/lead";

const ITEM = "flex gap-2.5 border-b border-dashed py-2.5 last:border-b-0";
const WHEN = "text-muted-foreground pt-px text-xs tabular-nums whitespace-nowrap";
const KIND = "font-mono text-[11px] font-medium";
const BODY = "text-sm text-foreground/90";

export const Timeline = ({ events }: { events: TimelineEvent[] }) => (
  <ul className="list-none">
    {events.map((e, i) => (
      // Events carry no id and two can share a timestamp, so the index is the only
      // stable key available. The list is append-only and never reordered, which is
      // what makes that safe here.
      <li key={i} className={ITEM}>
        <span className={WHEN}>{(e.occurredAt ?? "").slice(11, 16)}</span>
        <span className="min-w-0">
          <span className={KIND}>{e.kind}</span>
          {e.actor ? <span className="text-muted-foreground text-xs"> {e.actor.split("@")[0]}</span> : null}
          <div className={BODY}>{e.body ?? ""}</div>
        </span>
      </li>
    ))}
  </ul>
);

export const Ownership = ({ assignments }: { assignments: Assignment[] }) => (
  <ul className="list-none">
    {assignments.length ? (
      assignments.map((a, i) => (
        <li key={i} className={ITEM}>
          <span className={WHEN}>{(a.createdAt ?? "").slice(5, 10)}</span>
          <span className="min-w-0">
            <span className={KIND}>{a.role}</span>
            <div className={BODY}>
              {a.toUser}
              {a.reason ? ` — ${a.reason}` : ""}
            </div>
          </span>
        </li>
      ))
    ) : (
      <li className={`${ITEM} text-muted-foreground text-xs`}>Not assigned yet.</li>
    )}
  </ul>
);
