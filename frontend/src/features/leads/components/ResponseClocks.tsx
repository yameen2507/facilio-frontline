/**
 * Three clocks, all running from arrival. Each is met, late, still ticking, or —
 * on a lead that has finished — no longer applicable.
 *
 * "Late" is computed here rather than read from `sla.isOverdue`, because that flag
 * is about the lead as a whole while this table is per clock.
 */

import { Chip } from "../../../ui/Chip";
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
    <table className="clocks">
      <tbody>
        {clocks.map(([label, due, met]) => {
          const late = !met && !terminal && due && Date.parse(due) < Date.now();
          return (
            <tr key={label}>
              <td>{label}</td>
              <td className="due">{due ? when(due) : "—"}</td>
              <td className="right">
                {met ? (
                  <Chip tone="green">met</Chip>
                ) : terminal ? (
                  // Not "pending": nothing is going to happen on a finished lead,
                  // and a pending chip on a closed record reads as an oversight.
                  <Chip>n/a</Chip>
                ) : late ? (
                  <Chip tone="red">late</Chip>
                ) : (
                  <Chip>pending</Chip>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
