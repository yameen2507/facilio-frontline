import { describe, expect, it } from "vitest";
import {
  allowedNext,
  canTransition,
  incrementsRework,
  isTerminal,
  requiresLead,
  requiresReason,
  siteSelectionBlocker,
  stampColumnsFor,
  SURVEY_STATUSES,
  transitionCode,
  validateSurveyTransition,
  type SurveyStatus,
} from "../src/domain/survey-state";

const lead = { actorIsLead: true };

describe("the seven states and their legal moves", () => {
  it("walks the happy path T2 -> T7", () => {
    expect(canTransition("draft", "scheduled")).toBe(true);
    expect(canTransition("scheduled", "assigned")).toBe(true);
    expect(canTransition("assigned", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "pending_review")).toBe(true);
    expect(canTransition("pending_review", "completed")).toBe(true);
  });

  it("allows the rework bounce back to in_progress (T6)", () => {
    expect(canTransition("pending_review", "in_progress")).toBe(true);
  });

  it("allows cancel from every pre-completed state (T8)", () => {
    for (const s of ["draft", "scheduled", "assigned", "in_progress", "pending_review"] as const) {
      expect(canTransition(s, "cancelled")).toBe(true);
    }
  });

  it("names each transition with its v1.7 code", () => {
    expect(transitionCode("draft", "scheduled")).toBe("T2");
    expect(transitionCode("scheduled", "assigned")).toBe("T3");
    expect(transitionCode("assigned", "in_progress")).toBe("T4");
    expect(transitionCode("in_progress", "pending_review")).toBe("T5");
    expect(transitionCode("pending_review", "in_progress")).toBe("T6");
    expect(transitionCode("pending_review", "completed")).toBe("T7");
    expect(transitionCode("in_progress", "cancelled")).toBe("T8");
  });
});

describe("the explicitly forbidden transitions", () => {
  it("completed -> anything", () => {
    expect(isTerminal("completed")).toBe(true);
    for (const to of SURVEY_STATUSES) {
      if (to === "completed") continue;
      expect(canTransition("completed", to)).toBe(false);
    }
    expect(() => validateSurveyTransition({ from: "completed", to: "in_progress", ...lead })).toThrow(
      /completed is terminal — a re-walk is a new linked survey/
    );
  });

  it("cancelled -> anything", () => {
    expect(isTerminal("cancelled")).toBe(true);
    for (const to of SURVEY_STATUSES) {
      if (to === "cancelled") continue;
      expect(canTransition("cancelled", to)).toBe(false);
    }
    expect(() => validateSurveyTransition({ from: "cancelled", to: "draft", ...lead })).toThrow(
      /cancelled is terminal/
    );
  });

  it("pending_review -> completed by a non-lead", () => {
    expect(requiresLead("pending_review", "completed")).toBe(true);
    expect(() =>
      validateSurveyTransition({ from: "pending_review", to: "completed", actorIsLead: false })
    ).toThrow(/only the survey lead/);
    // and an omitted flag is not a yes
    expect(() => validateSurveyTransition({ from: "pending_review", to: "completed" })).toThrow(
      /only the survey lead/
    );
  });

  it("draft -> in_progress, which must pass T2 and T3 first", () => {
    expect(canTransition("draft", "in_progress")).toBe(false);
    expect(() => validateSurveyTransition({ from: "draft", to: "in_progress" })).toThrow(
      /cannot go from draft to in_progress \(allowed: scheduled, cancelled\)/
    );
  });

  it("refuses to skip the funnel generally", () => {
    expect(canTransition("draft", "assigned")).toBe(false);
    expect(canTransition("scheduled", "in_progress")).toBe(false);
    expect(canTransition("assigned", "pending_review")).toBe(false);
    expect(canTransition("in_progress", "completed")).toBe(false);
  });
});

describe("who may move it", () => {
  it("reserves T5, T6 and T7 for the lead", () => {
    expect(requiresLead("in_progress", "pending_review")).toBe(true);
    expect(requiresLead("pending_review", "in_progress")).toBe(true);
    expect(requiresLead("pending_review", "completed")).toBe(true);
  });

  it("lets the BD do the early moves and the cancel", () => {
    expect(requiresLead("draft", "scheduled")).toBe(false);
    expect(requiresLead("scheduled", "assigned")).toBe(false);
    expect(requiresLead("assigned", "in_progress")).toBe(false);
    expect(requiresLead("in_progress", "cancelled")).toBe(false);
    expect(validateSurveyTransition({ from: "draft", to: "scheduled" }).code).toBe("T2");
  });
});

describe("reasons", () => {
  it("demands one on every cancel", () => {
    for (const from of ["draft", "scheduled", "assigned", "in_progress"] as const) {
      expect(requiresReason(from, "cancelled")).toBe(true);
      expect(() => validateSurveyTransition({ from, to: "cancelled" })).toThrow(
        /cancelling a survey requires a reason/
      );
    }
    expect(
      validateSurveyTransition({ from: "draft", to: "cancelled", reason: "deal lost" }).reason
    ).toBe("deal lost");
  });

  it("demands one on a rework bounce", () => {
    expect(requiresReason("pending_review", "in_progress")).toBe(true);
    expect(() =>
      validateSurveyTransition({ from: "pending_review", to: "in_progress", ...lead })
    ).toThrow(/rework requires a reason/);
  });

  it("treats whitespace as no reason at all", () => {
    expect(() =>
      validateSurveyTransition({ from: "draft", to: "cancelled", reason: "   " })
    ).toThrow(/requires a reason/);
  });

  it("does not require one on the ordinary forward moves", () => {
    expect(requiresReason("draft", "scheduled")).toBe(false);
    expect(requiresReason("pending_review", "completed")).toBe(false);
    expect(validateSurveyTransition({ from: "scheduled", to: "assigned" }).reason).toBeNull();
  });
});

describe("side effects the handler must not re-derive", () => {
  it("stamps the cancel triple and the submit triple", () => {
    expect(stampColumnsFor("cancelled")).toEqual([
      "cancel_reason",
      "cancelled_by",
      "cancelled_at",
    ]);
    expect(stampColumnsFor("completed")).toEqual([
      "submitted_by",
      "submitted_at",
      "current_revision_id",
    ]);
    expect(stampColumnsFor("scheduled")).toEqual([]);
  });

  it("counts only the rework bounce", () => {
    expect(incrementsRework("pending_review", "in_progress")).toBe(true);
    expect(incrementsRework("in_progress", "pending_review")).toBe(false);
    expect(incrementsRework("pending_review", "completed")).toBe(false);
  });
});

describe("input hygiene", () => {
  it("rejects statuses that do not exist", () => {
    expect(() => validateSurveyTransition({ from: "banana", to: "draft" })).toThrow(
      /unknown current status/
    );
    expect(() => validateSurveyTransition({ from: "draft", to: "banana" })).toThrow(
      /unknown target status/
    );
  });

  it("rejects a no-op", () => {
    expect(() => validateSurveyTransition({ from: "draft", to: "draft" })).toThrow(
      /already draft/
    );
  });

  it("has an entry in the table for every declared status", () => {
    for (const s of SURVEY_STATUSES) {
      expect(Array.isArray(allowedNext(s as SurveyStatus))).toBe(true);
    }
  });
});

describe("C32 — a survey names the property it is for", () => {
  it("rejects neither, which is what the create form used to send", () => {
    // Before C32 the dialog asked for a deal and nothing else, so every survey
    // arrived here with no site. That is the root of F-03: walk.ts then had no
    // root to parent a discovered room to.
    expect(siteSelectionBlocker({})).toMatch(/needs the property/);
    expect(siteSelectionBlocker({ prospectSiteId: null, siteName: null })).toMatch(
      /needs the property/
    );
  });

  it("treats a blank or whitespace name as no answer", () => {
    expect(siteSelectionBlocker({ siteName: "" })).toMatch(/needs the property/);
    expect(siteSelectionBlocker({ siteName: "   " })).toMatch(/needs the property/);
  });

  it("accepts an existing site", () => {
    expect(siteSelectionBlocker({ prospectSiteId: "site-1" })).toBeNull();
  });

  it("accepts a new site's name", () => {
    expect(siteSelectionBlocker({ siteName: "Al Bayt Grill — Downtown" })).toBeNull();
  });

  it("rejects both rather than quietly preferring one", () => {
    // The two answers mean different things. Preferring the id would discard a
    // property the user named; preferring the name would create a duplicate of
    // one they had just selected.
    expect(siteSelectionBlocker({ prospectSiteId: "site-1", siteName: "New place" })).toMatch(
      /not both/
    );
  });
});
