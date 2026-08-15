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

/** The LIFECYCLE axis only. The toggles get their own count — see below. */
export type Buckets = Record<TabId, number>;

export function countBuckets(leads: Lead[]): Buckets {
  const b: Buckets = { open: 0, converted: 0, closed: 0, all: leads.length };
  for (const l of leads) {
    if (!isTerminal(l.status)) b.open++;
    if (l.status === "converted") b.converted++;
    if (l.status === "closed") b.closed++;
  }
  return b;
}

/**
 * What each toggle would GIVE YOU if you clicked it right now — the tab it sits
 * under, plus whichever toggles are already on, plus this one.
 *
 * It used to be a global tally taken over every lead regardless of the tab, and
 * the unclaimed one counted a different set than it filtered (non-terminal only
 * when counting, any status when filtering). So "Nobody's picked up · 7" under
 * the Converted tab promised seven rows and delivered an empty list, which reads
 * as a broken filter rather than as an honest zero.
 *
 * Defined THROUGH filterLeads for exactly that reason: a count and the list it
 * describes cannot drift apart if the count is the list's length.
 */
export function countToggles(leads: Lead[], f: LeadFilter): { unclaimed: number; overdue: number } {
  return {
    unclaimed: filterLeads(leads, { ...f, unclaimed: true }).length,
    overdue: filterLeads(leads, { ...f, overdue: true }).length,
  };
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
