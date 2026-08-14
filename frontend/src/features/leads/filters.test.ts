/**
 * The filter rules, pinned. These are cheap to get subtly wrong and expensive
 * to notice: a wrong filter shows a plausible list, not an error.
 *
 * D-25 rewrote the model: lifecycle is a tab, ownership and time are toggles
 * that combine with it — so these tests exercise COMBINATIONS, which the old
 * mutually-exclusive tabs could not express at all.
 */

import { describe, expect, it } from "vitest";
import { countBuckets, filterLeads, type LeadFilter } from "./filters";
import type { Lead, LeadStatus, Sla } from "./types/lead";

let n = 0;
const mk = (status: LeadStatus, opts: { owner?: string | null; sla?: Sla } = {}): Lead => ({
  id: `l${++n}`,
  refNo: `L-${n}`,
  companyName: `Co ${n}`,
  source: "web",
  status,
  createdAt: "2026-08-01T00:00:00Z",
  ownerEmail: opts.owner ?? null,
  sla: opts.sla ?? null,
});

const f = (over: Partial<LeadFilter> = {}): LeadFilter => ({
  tab: "open",
  unclaimed: false,
  overdue: false,
  ...over,
});

const overdue: Sla = { isOverdue: true, breached: ["first_response"] };

describe("countBuckets", () => {
  it("counts open as everything not converted or closed", () => {
    const b = countBuckets([mk("new"), mk("in_review"), mk("converted"), mk("closed")]);
    expect(b.open).toBe(2);
    expect(b.converted).toBe(1);
    expect(b.closed).toBe(1);
    expect(b.all).toBe(4);
  });

  it("counts unclaimed only among non-terminal leads", () => {
    const b = countBuckets([mk("new"), mk("in_review", { owner: "rep@x.com" }), mk("converted")]);
    expect(b.unclaimed).toBe(1);
  });

  it("counts an overdue lead even after it closed — the breach still happened", () => {
    const b = countBuckets([mk("closed", { sla: overdue })]);
    expect(b.overdue).toBe(1);
    expect(b.open).toBe(0);
  });
});

describe("filterLeads — three independent axes", () => {
  const leads = [
    mk("new"),
    mk("in_review", { owner: "rep@x.com" }),
    mk("qualified", { sla: overdue }),
    mk("converted"),
    mk("closed", { sla: overdue }),
  ];

  it("open excludes converted and closed", () => {
    expect(filterLeads(leads, f()).map((l) => l.status)).toEqual([
      "new",
      "in_review",
      "qualified",
    ]);
  });

  it("converted and closed are single statuses — the tab says what the chip says (X-04)", () => {
    expect(filterLeads(leads, f({ tab: "converted" })).map((l) => l.status)).toEqual([
      "converted",
    ]);
    expect(filterLeads(leads, f({ tab: "closed" })).map((l) => l.status)).toEqual(["closed"]);
  });

  it("the unclaimed toggle narrows the tab — ownership combines with lifecycle", () => {
    const ids = filterLeads(leads, f({ unclaimed: true }));
    expect(ids).toHaveLength(2);
    expect(ids.every((l) => !l.ownerEmail)).toBe(true);
  });

  it("the overdue toggle narrows the tab — a closed breach shows under Closed, not Open", () => {
    expect(filterLeads(leads, f({ overdue: true })).map((l) => l.status)).toEqual(["qualified"]);
    expect(filterLeads(leads, f({ tab: "closed", overdue: true })).map((l) => l.status)).toEqual([
      "closed",
    ]);
    expect(filterLeads(leads, f({ tab: "all", overdue: true }))).toHaveLength(2);
  });

  it("the axes combine — open AND unclaimed AND overdue is finally askable", () => {
    const both = filterLeads(leads, f({ unclaimed: true, overdue: true }));
    expect(both.map((l) => l.status)).toEqual(["qualified"]);
  });

  it("counts and filters agree on every lifecycle tab", () => {
    const b = countBuckets(leads);
    for (const tab of ["open", "converted", "closed", "all"] as const) {
      expect(filterLeads(leads, f({ tab }))).toHaveLength(b[tab]);
    }
  });
});
