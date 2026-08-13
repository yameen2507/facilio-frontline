/**
 * The action set is the one piece of lead logic that is pure, so it is the one
 * piece that can be pinned down without a browser. Picked up by the repo's
 * existing vitest run.
 */

import { describe, expect, it } from "vitest";
import { actionsFor, isTerminal } from "./actions";
import type { LeadStatus } from "./types/lead";

const lead = (status: LeadStatus, ownerEmail: string | null = null) => ({ status, ownerEmail });

describe("actionsFor", () => {
  it("offers Claim only while the lead is unowned", () => {
    expect(actionsFor(lead("new"), false)).toContain("claim");
    expect(actionsFor(lead("new", "rep@x.com"), false)).not.toContain("claim");
  });

  it("never offers Claim on a terminal lead, owned or not", () => {
    expect(actionsFor(lead("converted"), false)).not.toContain("claim");
    expect(actionsFor(lead("closed"), false)).not.toContain("claim");
  });

  it("swaps Assess for Re-assess once a verdict exists", () => {
    expect(actionsFor(lead("in_review"), false)).toContain("assess");
    expect(actionsFor(lead("in_review"), false)).not.toContain("reassess");
    expect(actionsFor(lead("in_review"), true)).toContain("reassess");
    expect(actionsFor(lead("in_review"), true)).not.toContain("assess");
  });

  it("allows qualifying straight out of nurture", () => {
    expect(actionsFor(lead("nurture"), true)).toContain("qualify");
  });

  it("does not offer Nurture to a lead already nurturing", () => {
    expect(actionsFor(lead("nurture"), true)).not.toContain("nurture");
  });

  it("offers Convert only from qualified", () => {
    expect(actionsFor(lead("qualified"), true)).toContain("convert");
    for (const s of ["new", "in_review", "contacted", "nurture", "closed"] as LeadStatus[]) {
      expect(actionsFor(lead(s), true)).not.toContain("convert");
    }
  });

  it("offers no state-changing action on a terminal lead", () => {
    for (const s of ["converted", "closed"] as LeadStatus[]) {
      const ids = actionsFor(lead(s, "rep@x.com"), true);
      expect(ids).not.toContain("qualify");
      expect(ids).not.toContain("nurture");
      expect(ids).not.toContain("assign");
      expect(ids).not.toContain("close");
      // Reading and re-assessing a closed lead are still legitimate.
      expect(ids).toEqual(["log-call", "reassess"]);
    }
  });

  it("always allows logging a call", () => {
    for (const s of ["new", "in_review", "contacted", "qualified", "nurture", "converted", "closed"] as LeadStatus[]) {
      expect(actionsFor(lead(s), true)).toContain("log-call");
    }
  });

  it("agrees with isTerminal", () => {
    expect(isTerminal("converted")).toBe(true);
    expect(isTerminal("closed")).toBe(true);
    expect(isTerminal("new")).toBe(false);
  });
});
