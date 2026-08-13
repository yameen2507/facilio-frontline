/**
 * Which leads each inbox tab shows, and the numbers on the tabs.
 *
 * Pure, and separated from the page for one reason: "open" excluding terminal
 * leads, "unclaimed" ALSO excluding them, and "overdue" deliberately not — an
 * overdue lead that was since closed still counts as a breach — are rules that are
 * invisible when spread across five inline `.filter()` calls in a render.
 */

import { isTerminal } from "./actions";
import type { Lead } from "./types/lead";

export type TabId = "open" | "unclaimed" | "overdue" | "won" | "closed";

export type Buckets = Record<TabId, number>;

export function countBuckets(leads: Lead[]): Buckets {
  const b: Buckets = { open: 0, unclaimed: 0, overdue: 0, won: 0, closed: 0 };
  for (const l of leads) {
    const terminal = isTerminal(l.status);
    if (!terminal) b.open++;
    if (!terminal && !l.ownerEmail) b.unclaimed++;
    // Counted regardless of status: a breach that was later closed still happened,
    // and hiding it would make the overdue tab look better than reality.
    if (l.sla?.isOverdue) b.overdue++;
    if (l.status === "converted") b.won++;
    if (l.status === "closed") b.closed++;
  }
  return b;
}

export function filterLeads(leads: Lead[], tab: TabId): Lead[] {
  switch (tab) {
    case "unclaimed":
      return leads.filter((l) => !l.ownerEmail && !isTerminal(l.status));
    case "overdue":
      return leads.filter((l) => l.sla?.isOverdue);
    case "won":
      return leads.filter((l) => l.status === "converted");
    case "closed":
      return leads.filter((l) => l.status === "closed");
    case "open":
    default:
      return leads.filter((l) => !isTerminal(l.status));
  }
}
