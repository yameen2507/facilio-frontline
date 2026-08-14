import { describe, expect, it } from "vitest";
import {
  completenessPct,
  DEFAULT_COMPLETENESS_SETTINGS,
  isConditionSurveyComplete,
  notVisitedPct,
  reviewGuard,
  submitGuard,
  type SurveyCounts,
} from "../src/domain/survey-completeness";

const counts = (over: Partial<SurveyCounts> = {}): SurveyCounts => ({
  seededNodes: 0,
  verdictedNodes: 0,
  notVisitedNodes: 0,
  requiredQuestions: 0,
  answeredRequired: 0,
  // Defaults to a walked survey — D-22's empty-survey gate is tested
  // explicitly below, not smuggled into every other case.
  answeredQuestions: 1,
  openReconciliationItems: 0,
  openVisits: 0,
  ...over,
});

describe("not_visited_pct — null, never zero, over an empty seeded set", () => {
  it("is null when nothing was ever seeded", () => {
    expect(notVisitedPct(counts())).toBeNull();
  });

  it("is 0 only when nodes WERE seeded and all were visited", () => {
    expect(notVisitedPct(counts({ seededNodes: 10, notVisitedNodes: 0 }))).toBe(0);
  });

  it("reports the real proportion otherwise", () => {
    expect(notVisitedPct(counts({ seededNodes: 10, notVisitedNodes: 8 }))).toBe(80);
    expect(notVisitedPct(counts({ seededNodes: 3, notVisitedNodes: 1 }))).toBe(33.3);
  });

  it("says so in the submit warnings when it cannot be measured", () => {
    const g = submitGuard(counts(), 0);
    expect(g.ok).toBe(true);
    expect(g.warnings.join(" ")).toMatch(/not_visited_pct is published as null, not 0/);
  });
});

describe("completeness_pct", () => {
  it("is null when nothing is owed", () => {
    expect(completenessPct(counts())).toBeNull();
  });

  it("counts verdicted nodes and answered required questions together", () => {
    expect(
      completenessPct(
        counts({ seededNodes: 5, verdictedNodes: 5, requiredQuestions: 5, answeredRequired: 0 })
      )
    ).toBe(50);
    expect(
      completenessPct(
        counts({ seededNodes: 2, verdictedNodes: 2, requiredQuestions: 2, answeredRequired: 2 })
      )
    ).toBe(100);
  });
});

describe("reviewGuard — T5, the guard v3 was missing (F6)", () => {
  it("blocks while any visit is still open", () => {
    const g = reviewGuard(counts({ openVisits: 2 }));
    expect(g.ok).toBe(false);
    expect(g.blockers[0]).toMatch(/2 visit\(s\) still planned or in progress/);
  });

  it("passes once every visit is done, no-showed or cancelled", () => {
    expect(reviewGuard(counts({ openVisits: 0 })).ok).toBe(true);
  });
});

describe("submitGuard — T7", () => {
  it("blocks on unverdicted nodes, unanswered required questions and open items", () => {
    const g = submitGuard(
      counts({
        seededNodes: 4,
        verdictedNodes: 1,
        requiredQuestions: 3,
        answeredRequired: 1,
        openReconciliationItems: 2,
        openVisits: 1,
      }),
      0
    );
    expect(g.ok).toBe(false);
    expect(g.blockers).toHaveLength(4);
    expect(g.blockers.join(" ")).toMatch(/3 seeded node\(s\) have no verdict/);
    expect(g.blockers.join(" ")).toMatch(/2 required question\(s\)/);
    expect(g.blockers.join(" ")).toMatch(/2 reconciliation item\(s\) still undecided/);
    expect(g.blockers.join(" ")).toMatch(/1 visit\(s\) still open/);
  });

  it("passes a clean survey", () => {
    const g = submitGuard(
      counts({
        seededNodes: 3,
        verdictedNodes: 3,
        requiredQuestions: 2,
        answeredRequired: 2,
      }),
      0
    );
    expect(g.ok).toBe(true);
    expect(g.blockers).toHaveLength(0);
  });

  it("still COMPLETES at 80% not-visited, but warns — the F12 case", () => {
    const g = submitGuard(
      counts({ seededNodes: 10, verdictedNodes: 10, notVisitedNodes: 8 }),
      0
    );
    expect(g.ok).toBe(true);
    expect(g.blockers).toHaveLength(0);
    expect(g.warnings.join(" ")).toMatch(/80% of seeded nodes were not visited/);
  });

  it("stays quiet below the warn threshold", () => {
    const g = submitGuard(
      counts({ seededNodes: 100, verdictedNodes: 100, notVisitedNodes: 5 }),
      0
    );
    expect(g.warnings.join(" ")).not.toMatch(/not visited/);
  });

  it("blocks unvisited nodes only when the org turned the allowance off", () => {
    const strict = { ...DEFAULT_COMPLETENESS_SETTINGS, allowCompleteWithNotVisited: false };
    const g = submitGuard(
      counts({ seededNodes: 10, verdictedNodes: 10, notVisitedNodes: 1 }),
      0,
      strict
    );
    expect(g.ok).toBe(false);
    expect(g.blockers.join(" ")).toMatch(/does not allow completing with unvisited nodes/);
  });

  it("warns on a survey that keeps bouncing, and never blocks on it (F7)", () => {
    const g = submitGuard(counts(), 3);
    expect(g.ok).toBe(true);
    expect(g.warnings.join(" ")).toMatch(/bounced back for rework 3 times/);
  });
});

describe("isConditionSurveyComplete", () => {
  it("needs every in-scope space scored", () => {
    expect(isConditionSurveyComplete(4, 4)).toBe(true);
    expect(isConditionSurveyComplete(4, 3)).toBe(false);
  });

  it("is false when there are no spaces at all — nothing was surveyed", () => {
    expect(isConditionSurveyComplete(0, 0)).toBe(false);
  });
});

describe("the D-22 submission gate — an empty survey never leaves the walk", () => {
  it("blocks review when nothing at all was answered", () => {
    const g = reviewGuard(counts({ answeredQuestions: 0 }));
    expect(g.ok).toBe(false);
    expect(g.blockers.join(" ")).toMatch(/cannot be submitted empty/);
  });

  it("blocks completion the same way — the lead's direct path has no side door", () => {
    const g = submitGuard(counts({ answeredQuestions: 0 }), 0);
    expect(g.ok).toBe(false);
    expect(g.blockers.join(" ")).toMatch(/cannot be completed empty/);
  });

  it("one answer opens the gate — the floor, not required-ness", () => {
    expect(reviewGuard(counts({ answeredQuestions: 1 })).ok).toBe(true);
  });
});
