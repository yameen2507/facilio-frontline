/**
 * The tab rules, pinned. These are cheap to get subtly wrong and expensive to
 * notice: a wrong filter shows a plausible list, not an error.
 */

import { describe, expect, it } from "vitest";
import { countBuckets, filterLeads } from "./filters";
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

const overdue: Sla = { isOverdue: true, breached: ["first_response"] };

describe("countBuckets", () => {
  it("counts open as everything not converted or closed", () => {
    const b = countBuckets([mk("new"), mk("in_review"), mk("converted"), mk("closed")]);
    expect(b.open).toBe(2);
    expect(b.won).toBe(1);
    expect(b.closed).toBe(1);
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

describe("filterLeads", () => {
  const leads = [
    mk("new"),
    mk("in_review", { owner: "rep@x.com" }),
    mk("qualified", { sla: overdue }),
    mk("converted"),
    mk("closed"),
  ];

  it("open excludes converted and closed", () => {
    expect(filterLeads(leads, "open").map((l) => l.status)).toEqual(["new", "in_review", "qualified"]);
  });

  it("unclaimed is the unowned, non-terminal leads", () => {
    const ids = filterLeads(leads, "unclaimed");
    expect(ids).toHaveLength(2);
    expect(ids.every((l) => !l.ownerEmail)).toBe(true);
  });

  it("won and closed are single statuses", () => {
    expect(filterLeads(leads, "won").map((l) => l.status)).toEqual(["converted"]);
    expect(filterLeads(leads, "closed").map((l) => l.status)).toEqual(["closed"]);
  });

  it("overdue ignores status entirely", () => {
    expect(filterLeads(leads, "overdue").map((l) => l.status)).toEqual(["qualified"]);
  });

  it("counts and filters agree for every tab", () => {
    const b = countBuckets(leads);
    for (const tab of ["open", "unclaimed", "overdue", "won", "closed"] as const) {
      expect(filterLeads(leads, tab)).toHaveLength(b[tab]);
    }
  });
});
