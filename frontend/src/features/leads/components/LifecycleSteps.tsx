/**
 * The lifecycle, made visible from the timestamps the transition handler stamps.
 *
 * The subtlety worth keeping: a stage with no timestamp is only "pending" if
 * nothing after it happened. If a LATER stage did, this one was deliberately
 * jumped — `in_review → qualified` is a legal move — and that is a decision worth
 * showing rather than leaving it to look identical to a stage not yet reached.
 * Hence three visual states, not two: done, skipped, and not yet.
 */

import { when } from "../../../lib/format";
import type { Lead } from "../types/lead";

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
    <div className="steps">
      {stages.map(([label, at], i) => {
        const skipped = !at && i < lastReached;
        return (
          <div className={`step ${at ? "done" : skipped ? "skip" : ""}`} key={label}>
            <i />
            <div>
              <b>{label}</b>
              <span>{at ? when(at) : skipped ? "skipped" : "—"}</span>
            </div>
          </div>
        );
      })}

      {lead.status === "closed" ? (
        <div className="step closed">
          <i />
          <div>
            <b>Closed</b>
            <span>{lead.dispositionReason ?? ""}</span>
          </div>
        </div>
      ) : null}

      {lead.status === "nurture" ? (
        <div className="step warm">
          <i />
          <div>
            <b>Nurturing</b>
            <span>{lead.nurtureUntil ? `until ${lead.nurtureUntil.slice(0, 10)}` : "no date set"}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
