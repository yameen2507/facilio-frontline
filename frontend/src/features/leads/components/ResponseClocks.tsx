/**
 * Three clocks, all running from arrival. Each is met, late, still ticking, or —
 * on a lead that has finished — no longer applicable.
 *
 * "Late" is computed here rather than read from `sla.isOverdue`, because that flag
 * is about the lead as a whole while this list is per clock.
 *
 * Each row leads with its state as an icon and shows the time that MATTERS for
 * that state: a met clock shows when it was met, a ticking one shows its
 * deadline, a late one shows the deadline it blew. One time per row — showing
 * both due and met was two dates the reader had to reconcile.
 */

import { CircleAlert, CircleCheck, CircleMinus, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { when } from "../../../lib/format";
import { isTerminal } from "../actions";
import type { Lead } from "../types/lead";

export function ResponseClocks({ lead }: { lead: Lead }) {
  const terminal = isTerminal(lead.status);

  const clocks: [string, string | null | undefined, string | null | undefined][] = [
    ["First response", lead.firstResponseDueAt, lead.firstContactAt],
    ["Qualification", lead.qualificationDueAt, lead.qualifiedAt],
    ["Hand to sales", lead.assignmentDueAt, lead.assignedAt],
  ];

  return (
    <div>
      {clocks.map(([label, due, met]) => {
        const late = !met && !terminal && due && Date.parse(due) < Date.now();
        const icon = met ? (
          <CircleCheck className="size-4 shrink-0 text-green-600 dark:text-green-500" aria-hidden="true" />
        ) : terminal ? (
          // Not a ticking clock: nothing is going to happen on a finished
          // lead, and a live-looking row on a closed record reads as an
          // oversight.
          <CircleMinus className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        ) : late ? (
          <CircleAlert className="size-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
        ) : (
          <Clock className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        );

        return (
          <div
            key={label}
            className="flex items-center gap-2.5 border-b border-dashed py-2.5 first:pt-0 last:border-b-0 last:pb-0"
          >
            {icon}
            <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
            <span
              className={cn(
                "text-xs whitespace-nowrap tabular-nums",
                late ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
              )}
            >
              {met
                ? `met ${when(met)}`
                : terminal
                  ? "n/a"
                  : late
                    ? `was due ${when(due)}`
                    : due
                      ? `due ${when(due)}`
                      : "no deadline"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
