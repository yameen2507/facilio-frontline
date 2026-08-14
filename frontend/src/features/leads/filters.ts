/**
 * Which leads the inbox shows, and the numbers on the controls.
 *
 * D-25, as ruled 14 Aug: the old tab strip wore three incompatible axes as one
 * control — Open/Won/Closed is LIFECYCLE, Unclaimed is OWNERSHIP, Overdue is
 * TIME. They were mutually exclusive tabs, so "open AND unclaimed AND late"
 * was unaskable. Now lifecycle is the tab row and the other two axes are
 * independent toggles that COMBINE with it.
 *
 * X-04 rides along: the lifecycle tab is called CONVERTED, because that is the
 * status every row under it shows — "Won" belongs to the deal list.
 *
 * Pure, and separated from the page for one reason: "open" excluding terminal
 * leads while "overdue" deliberately does not — a breach that was since closed
 * still happened — are rules that are invisible when spread across inline
 * `.filter()` calls in a render.
 */

import { isTerminal } from "./actions";
import type { Lead } from "./types/lead";

/** The lifecycle axis only. */
export type TabId = "open" | "converted" | "closed" | "all";

/** The three axes, independent — this is D-25's whole point. */
export type LeadFilter = {
  tab: TabId;
  /** D-26's "nobody's picked these up" — ownership, not lifecycle. */
  unclaimed: boolean;
  /** Any response clock breached — time, not lifecycle. */
  overdue: boolean;
};

export type Buckets = Record<TabId, number> & { unclaimed: number; overdue: number };

export function countBuckets(leads: Lead[]): Buckets {
  const b: Buckets = { open: 0, converted: 0, closed: 0, all: leads.length, unclaimed: 0, overdue: 0 };
  for (const l of leads) {
    if (!isTerminal(l.status)) b.open++;
    if (!isTerminal(l.status) && !l.ownerEmail) b.unclaimed++;
    // Counted regardless of status: a breach that was later closed still happened,
    // and hiding it would make the overdue toggle look better than reality.
    if (l.sla?.isOverdue) b.overdue++;
    if (l.status === "converted") b.converted++;
    if (l.status === "closed") b.closed++;
  }
  return b;
}

function onTab(l: Lead, tab: TabId): boolean {
  switch (tab) {
    case "converted":
      return l.status === "converted";
    case "closed":
      return l.status === "closed";
    case "all":
      return true;
    case "open":
    default:
      return !isTerminal(l.status);
  }
}

export function filterLeads(leads: Lead[], f: LeadFilter): Lead[] {
  return leads.filter(
    (l) =>
      onTab(l, f.tab) &&
      // The toggles NARROW whatever the tab shows — three axes, one list.
      (!f.unclaimed || !l.ownerEmail) &&
      (!f.overdue || Boolean(l.sla?.isOverdue))
  );
}
