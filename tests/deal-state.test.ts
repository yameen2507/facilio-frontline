import { describe, expect, it } from "vitest";
import {
  ACTIVE_STAGES,
  allowedNext,
  canTransition,
  isTerminal,
  validateReopen,
  validateTransition,
} from "../src/domain/deal-state";

describe("deal stage transitions", () => {
  it("walks the full lifecycle in order", () => {
    expect(canTransition("opportunity", "discovery")).toBe(true);
    expect(canTransition("discovery", "survey_required")).toBe(true);
    expect(canTransition("survey_required", "survey_completed")).toBe(true);
    expect(canTransition("survey_completed", "estimation")).toBe(true);
    expect(canTransition("estimation", "proposal_submitted")).toBe(true);
    expect(canTransition("proposal_submitted", "negotiation")).toBe(true);
    expect(canTransition("negotiation", "decision_pending")).toBe(true);
    expect(canTransition("decision_pending", "won")).toBe(true);
  });

  it("lets a deal skip stages that do not apply (spec: lifecycle flexibility)", () => {
    // Small existing-client requirement: discovery straight to estimation.
    expect(canTransition("discovery", "estimation")).toBe(true);
    // Existing customer already surveyed: no survey stages at all.
    expect(canTransition("discovery", "proposal_submitted")).toBe(true);
    expect(canTransition("opportunity", "estimation")).toBe(true);
  });

  it("only moves backward inside the commercial loop", () => {
    expect(canTransition("negotiation", "proposal_submitted")).toBe(true);
    expect(canTransition("decision_pending", "negotiation")).toBe(true);
    expect(canTransition("decision_pending", "proposal_submitted")).toBe(true);
    // Outside the loop, no reverse gear.
    expect(canTransition("estimation", "discovery")).toBe(false);
    expect(canTransition("survey_completed", "survey_required")).toBe(false);
    expect(canTransition("negotiation", "estimation")).toBe(false);
  });

  it("can be lost from any active stage, never from a terminal one", () => {
    for (const stage of ACTIVE_STAGES) {
      expect(canTransition(stage, "lost")).toBe(true);
    }
    expect(canTransition("won", "lost")).toBe(false);
    expect(canTransition("lost", "won")).toBe(false);
  });

  it("can only be won once a proposal has been submitted", () => {
    expect(canTransition("proposal_submitted", "won")).toBe(true);
    expect(canTransition("negotiation", "won")).toBe(true);
    expect(canTransition("decision_pending", "won")).toBe(true);
    expect(canTransition("discovery", "won")).toBe(false);
    expect(canTransition("estimation", "won")).toBe(false);
  });

  it("treats won and lost as terminal", () => {
    expect(isTerminal("won")).toBe(true);
    expect(isTerminal("lost")).toBe(true);
    expect(allowedNext("won")).toEqual([]);
    expect(allowedNext("lost")).toEqual([]);
  });

  it("requires a lost reason to lose, and rejects one anywhere else", () => {
    expect(() => validateTransition({ from: "negotiation", to: "lost" })).toThrow(/lost reason/);
    expect(
      validateTransition({ from: "negotiation", to: "lost", lostReason: "price" }).lostReason
    ).toBe("price");
    expect(() =>
      validateTransition({ from: "discovery", to: "estimation", lostReason: "price" })
    ).toThrow(/only applies/);
  });

  it("rejects unknown stages and same-stage moves", () => {
    expect(() => validateTransition({ from: "open", to: "discovery" })).toThrow(/unknown current/);
    expect(() => validateTransition({ from: "discovery", to: "discovery" })).toThrow(/already/);
  });
});

describe("reopening a closed deal", () => {
  it("returns to the stage the deal closed from", () => {
    expect(validateReopen("lost", "negotiation")).toBe("negotiation");
    expect(validateReopen("won", "decision_pending")).toBe("decision_pending");
  });

  it("falls back to decision_pending when the closed-from stage is unusable", () => {
    expect(validateReopen("lost", null)).toBe("decision_pending");
    expect(validateReopen("lost", "won")).toBe("decision_pending");
  });

  it("refuses to reopen an active deal", () => {
    expect(() => validateReopen("discovery", "opportunity")).toThrow(/won or lost/);
  });
});
