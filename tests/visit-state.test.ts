import { describe, expect, it } from "vitest";
import {
  canTransition,
  cascadesSurveyForward,
  isOpen,
  isTerminal,
  requiresReason,
  stampColumnFor,
  validateVisitTransition,
  VISIT_STATUSES,
} from "../src/domain/visit-state";

describe("the no-show path — the one that makes the metrics honest", () => {
  it("does NOT cascade the survey forward", () => {
    expect(cascadesSurveyForward("no_show")).toBe(false);
    expect(validateVisitTransition({
      from: "planned",
      to: "no_show",
      reason: "tenderer gave the slot to another bidder",
    }).cascadesSurvey).toBe(false);
  });

  it("only an actually-started visit moves the survey", () => {
    expect(cascadesSurveyForward("in_progress")).toBe(true);
    for (const s of ["planned", "done", "no_show", "cancelled"] as const) {
      expect(cascadesSurveyForward(s)).toBe(false);
    }
  });

  it("demands a reason, because a wasted trip has to say why", () => {
    expect(requiresReason("no_show")).toBe(true);
    expect(() => validateVisitTransition({ from: "planned", to: "no_show" })).toThrow(
      /marking a visit no_show requires a reason/
    );
  });

  it("is terminal — a retry is a new visit, not a revived one", () => {
    expect(isTerminal("no_show")).toBe(true);
    expect(() =>
      validateVisitTransition({ from: "no_show", to: "planned", reason: "rebooked" })
    ).toThrow(/terminal — reschedule means a new visit/);
  });

  it("cannot be claimed for a visit that already started", () => {
    expect(canTransition("in_progress", "no_show")).toBe(false);
  });
});

describe("the ordinary path", () => {
  it("planned -> in_progress -> done", () => {
    expect(canTransition("planned", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "done")).toBe(true);
  });

  it("stamps the right clock at each end", () => {
    expect(stampColumnFor("in_progress")).toBe("actual_start_at");
    expect(stampColumnFor("done")).toBe("actual_end_at");
    expect(stampColumnFor("no_show")).toBeNull();
    expect(stampColumnFor("cancelled")).toBeNull();
  });

  it("cancels from either open state, with a reason", () => {
    expect(canTransition("planned", "cancelled")).toBe(true);
    expect(canTransition("in_progress", "cancelled")).toBe(true);
    expect(() => validateVisitTransition({ from: "planned", to: "cancelled" })).toThrow(
      /requires a reason/
    );
    expect(
      validateVisitTransition({ from: "planned", to: "cancelled", reason: "site closed" }).reason
    ).toBe("site closed");
  });

  it("needs no reason to simply start or finish", () => {
    expect(requiresReason("in_progress")).toBe(false);
    expect(requiresReason("done")).toBe(false);
    expect(validateVisitTransition({ from: "planned", to: "in_progress" }).reason).toBeNull();
  });
});

describe("isOpen — what blocks the survey's move to review (F6)", () => {
  it("counts planned and in_progress as open", () => {
    expect(isOpen("planned")).toBe(true);
    expect(isOpen("in_progress")).toBe(true);
  });

  it("counts every settled outcome as closed, no-show included", () => {
    expect(isOpen("done")).toBe(false);
    expect(isOpen("no_show")).toBe(false);
    expect(isOpen("cancelled")).toBe(false);
  });
});

describe("input hygiene", () => {
  it("rejects unknown statuses and no-ops", () => {
    expect(() => validateVisitTransition({ from: "banana", to: "done" })).toThrow(
      /unknown current visit status/
    );
    expect(() => validateVisitTransition({ from: "planned", to: "banana" })).toThrow(
      /unknown target visit status/
    );
    expect(() => validateVisitTransition({ from: "planned", to: "planned" })).toThrow(
      /already planned/
    );
  });

  it("declares five states and no more", () => {
    expect(VISIT_STATUSES).toHaveLength(5);
  });
});
