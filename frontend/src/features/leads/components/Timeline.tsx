/**
 * Activity and ownership — two lists over the same `.tl` shape.
 */

import type { Assignment, TimelineEvent } from "../types/lead";

export const Timeline = ({ events }: { events: TimelineEvent[] }) => (
  <ul className="tl">
    {events.map((e, i) => (
      // Events carry no id and two can share a timestamp, so the index is the only
      // stable key available. The list is append-only and never reordered, which is
      // what makes that safe here.
      <li key={i}>
        <span className="when">{(e.occurredAt ?? "").slice(11, 16)}</span>
        <span className="what">
          <span className="kind">{e.kind}</span>
          {e.actor ? <span className="muted"> {e.actor.split("@")[0]}</span> : null}
          <div className="body">{e.body ?? ""}</div>
        </span>
      </li>
    ))}
  </ul>
);

export const Ownership = ({ assignments }: { assignments: Assignment[] }) => (
  <ul className="tl">
    {assignments.length ? (
      assignments.map((a, i) => (
        <li key={i}>
          <span className="when">{(a.createdAt ?? "").slice(5, 10)}</span>
          <span className="what">
            <span className="kind">{a.role}</span>
            <div className="body">
              {a.toUser}
              {a.reason ? ` — ${a.reason}` : ""}
            </div>
          </span>
        </li>
      ))
    ) : (
      <li className="muted">Not assigned yet.</li>
    )}
  </ul>
);
