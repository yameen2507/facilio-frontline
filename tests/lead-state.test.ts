import { describe, expect, it } from "vitest";
import {
  allowedNext,
  canTransition,
  isTerminal,
  requiresReason,
  stampColumnFor,
  validateTransition,
  valueFieldsBlocker,
} from "../src/domain/lead-state";

describe("lead status transitions", () => {
  it("walks the happy path", () => {
    expect(canTransition("new", "in_review")).toBe(true);
    expect(canTransition("in_review", "contacted")).toBe(true);
    expect(canTransition("contacted", "qualified")).toBe(true);
    expect(canTransition("qualified", "converted")).toBe(true);
  });

  it("lets obvious spam die without being claimed", () => {
    expect(canTransition("new", "closed")).toBe(true);
  });

  it("refuses to skip the funnel", () => {
    expect(canTransition("new", "converted")).toBe(false);
    expect(canTransition("new", "qualified")).toBe(false);
    expect(canTransition("in_review", "converted")).toBe(false);
  });

  it("treats converted and closed as terminal", () => {
    expect(isTerminal("converted")).toBe(true);
    expect(isTerminal("closed")).toBe(true);
    expect(allowedNext("closed")).toHaveLength(0);
  });

  it("allows nurture to come back to life", () => {
    expect(canTransition("in_review", "nurture")).toBe(true);
    expect(canTransition("nurture", "contacted")).toBe(true);
    expect(canTransition("nurture", "in_review")).toBe(true);
  });
});

describe("validateTransition", () => {
  it("returns the normalised pair on a legal move", () => {
    expect(validateTransition({ from: "new", to: "in_review" })).toEqual({
      from: "new",
      to: "in_review",
      reason: null,
    });
  });

  it("demands a reason when closing", () => {
    expect(() => validateTransition({ from: "new", to: "closed" })).toThrow(
      /requires a disposition reason/
    );
    expect(validateTransition({ from: "new", to: "closed", reason: "spam" }).reason).toBe("spam");
  });

  it("rejects an unknown reason", () => {
    expect(() =>
      validateTransition({ from: "new", to: "closed", reason: "because-i-said-so" })
    ).toThrow(/requires a disposition reason/);
  });

  it("rejects a reason on a non-closing move", () => {
    expect(() =>
      validateTransition({ from: "new", to: "in_review", reason: "spam" })
    ).toThrow(/only applies when closing/);
  });

  it("rejects illegal, repeated and terminal moves with a usable message", () => {
    expect(() => validateTransition({ from: "new", to: "converted" })).toThrow(
      /cannot go from new to converted \(allowed: in_review, closed\)/
    );
    expect(() => validateTransition({ from: "new", to: "new" })).toThrow(/already new/);
    expect(() => validateTransition({ from: "closed", to: "in_review" })).toThrow(/terminal/);
  });

  it("rejects statuses that do not exist", () => {
    expect(() => validateTransition({ from: "banana", to: "new" })).toThrow(/unknown current/);
    expect(() => validateTransition({ from: "new", to: "banana" })).toThrow(/unknown target/);
  });
});

describe("requiresReason / stampColumnFor", () => {
  it("only closing needs a reason", () => {
    expect(requiresReason("closed")).toBe(true);
    expect(requiresReason("qualified")).toBe(false);
  });

  it("maps each stage to its timestamp column", () => {
    expect(stampColumnFor("in_review")).toBe("reviewed_at");
    expect(stampColumnFor("contacted")).toBe("first_contact_at");
    expect(stampColumnFor("qualified")).toBe("qualified_at");
    expect(stampColumnFor("converted")).toBe("converted_at");
    expect(stampColumnFor("closed")).toBe("closed_at");
    expect(stampColumnFor("nurture")).toBeNull();
  });
});

describe("estimated value fields (D-05)", () => {
  it("accepts the three shapes the ruling names", () => {
    expect(valueFieldsBlocker({ valueType: "one_off" })).toBeNull();
    expect(valueFieldsBlocker({ valueType: "recurring", valueFrequency: "monthly" })).toBeNull();
    expect(valueFieldsBlocker({ valueType: "both", valueFrequency: "quarterly" })).toBeNull();
  });

  it("allows an absent type — the widget and legacy rows predate the field", () => {
    expect(valueFieldsBlocker({})).toBeNull();
    expect(valueFieldsBlocker({ valueType: null, valueFrequency: null })).toBeNull();
  });

  it("refuses a recurring value with no frequency", () => {
    expect(valueFieldsBlocker({ valueType: "recurring" })).toMatch(/frequency/);
    expect(valueFieldsBlocker({ valueType: "both" })).toMatch(/frequency/);
  });

  it("refuses a frequency on a one-off or untyped value", () => {
    expect(valueFieldsBlocker({ valueType: "one_off", valueFrequency: "monthly" })).toMatch(
      /recurring/
    );
    expect(valueFieldsBlocker({ valueFrequency: "monthly" })).toMatch(/recurring/);
  });

  it("names an unknown type or frequency instead of guessing", () => {
    expect(valueFieldsBlocker({ valueType: "weekly" })).toMatch(/valueType/);
    expect(
      valueFieldsBlocker({ valueType: "recurring", valueFrequency: "fortnightly" })
    ).toMatch(/valueFrequency/);
  });
});
