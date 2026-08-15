/**
 * The filter rules, pinned. These are cheap to get subtly wrong and expensive
 * to notice: a wrong filter shows a plausible list, not an error.
 *
 * D-25 rewrote the model: lifecycle is a tab and ownership is a toggle that
 * combines with it — so these tests exercise COMBINATIONS, which the old
 * mutually-exclusive tabs could not express at all. D-25's third axis, time, was
 * retired with the SLA it judged against, so `sla` no longer appears here.
 */

import { describe, expect, it } from "vitest";
import { countBuckets, countToggles, filterLeads, type LeadFilter } from "./filters";
import type { Lead, LeadStatus } from "./types/lead";

let n = 0;
const mk = (status: LeadStatus, opts: { owner?: string | null } = {}): Lead => ({
  id: `l${++n}`,
  refNo: `L-${n}`,
  companyName: `Co ${n}`,
  source: "web",
  status,
  createdAt: "2026-08-01T00:00:00Z",
  ownerEmail: opts.owner ?? null,
  sla: null,
});

const f = (over: Partial<LeadFilter> = {}): LeadFilter => ({
  tab: "open",
  unclaimed: false,
  ...over,
});

describe("countBuckets", () => {
  it("counts open as everything not converted or closed", () => {
    const b = countBuckets([mk("new"), mk("in_review"), mk("converted"), mk("closed")]);
    expect(b.open).toBe(2);
    expect(b.converted).toBe(1);
    expect(b.closed).toBe(1);
    expect(b.all).toBe(4);
  });

  it("counts a closed lead under closed, not open, however it got there", () => {
    const b = countBuckets([mk("closed")]);
    expect(b.closed).toBe(1);
    expect(b.open).toBe(0);
  });
});

describe("filterLeads — two independent axes", () => {
  const leads = [
    mk("new"),
    mk("in_review", { owner: "rep@x.com" }),
    mk("qualified"),
    mk("converted"),
    mk("closed"),
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

  it("the axes combine — open AND unclaimed is finally askable", () => {
    const both = filterLeads(leads, f({ unclaimed: true }));
    expect(both.map((l) => l.status)).toEqual(["new", "qualified"]);
  });

  it("counts and filters agree on every lifecycle tab", () => {
    const b = countBuckets(leads);
    for (const tab of ["open", "converted", "closed", "all"] as const) {
      expect(filterLeads(leads, f({ tab }))).toHaveLength(b[tab]);
    }
  });
});

/**
 * The regression these exist for: the toggle counts used to be a single global
 * tally, so a chip under the Converted tab advertised a number drawn from every
 * lead in the system. Clicking it produced a different list — often an empty one
 * — and an honest zero is indistinguishable from a broken filter.
 */
describe("countToggles — a chip's number is the list it produces", () => {
  const leads = [
    mk("new"),
    mk("in_review", { owner: "rep@x.com" }),
    mk("qualified"),
    mk("converted"),
    mk("closed"),
  ];

  it("agrees with the filter on every tab and toggle combination", () => {
    for (const tab of ["open", "converted", "closed", "all"] as const) {
      for (const unclaimed of [false, true]) {
        const base = f({ tab, unclaimed });
        const c = countToggles(leads, base);
        expect(c.unclaimed).toBe(filterLeads(leads, { ...base, unclaimed: true }).length);
      }
    }
  });

  it("scopes to the tab — the converted lead is unclaimed, the open ones are counted apart", () => {
    expect(countToggles(leads, f({ tab: "open" })).unclaimed).toBe(2);
    expect(countToggles(leads, f({ tab: "converted" })).unclaimed).toBe(1);
    expect(countToggles(leads, f({ tab: "closed" })).unclaimed).toBe(1);
  });

  it("stays put when the toggle is already on — a chip describes the list it made", () => {
    expect(countToggles(leads, f({ unclaimed: true })).unclaimed).toBe(2);
  });
});
