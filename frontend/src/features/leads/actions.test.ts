/**
 * The action set is the one piece of lead logic that is pure, so it is the one
 * piece that can be pinned down without a browser. Picked up by the repo's
 * existing vitest run.
 */

import { describe, expect, it } from "vitest";
import {
  actionsFor,
  isTerminal,
  MOVES,
  movesFor,
  newLeadBlockers,
  PERMISSION_OF,
  type LeadActionId,
} from "./actions";
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

describe("movesFor", () => {
  it("recommends Claim on an unowned new lead, and nothing once owned", () => {
    expect(movesFor(lead("new")).next).toBe("claim");
    expect(movesFor(lead("new", "rep@x.com")).next).toBeNull();
  });

  it("recommends the first call while in review — logging it is the transition", () => {
    expect(movesFor(lead("in_review")).next).toBe("log-call");
  });

  it("recommends Qualify from contacted and straight out of nurture", () => {
    expect(movesFor(lead("contacted")).next).toBe("qualify");
    expect(movesFor(lead("nurture")).next).toBe("qualify");
  });

  it("recommends Convert only from qualified", () => {
    expect(movesFor(lead("qualified")).next).toBe("convert");
    for (const s of ["new", "in_review", "contacted", "nurture"] as LeadStatus[]) {
      expect(movesFor(lead(s)).next).not.toBe("convert");
    }
  });

  it("offers no moves at all on a terminal lead", () => {
    for (const s of ["converted", "closed"] as LeadStatus[]) {
      expect(movesFor(lead(s, "rep@x.com"))).toEqual({ next: null, others: [] });
    }
  });

  it("always keeps Close available on a live lead, as an 'other', never the recommendation", () => {
    for (const s of ["new", "in_review", "contacted", "qualified", "nurture"] as LeadStatus[]) {
      const moves = movesFor(lead(s));
      expect(moves.others).toContain("close");
      expect(moves.next).not.toBe("close");
    }
  });

  it("names a destination state for every move", () => {
    // The whole point of MOVES: a control can always say where it lands.
    expect(MOVES.claim.to).toBe("in_review");
    expect(MOVES["log-call"].to).toBe("contacted");
    expect(MOVES.qualify.to).toBe("qualified");
    expect(MOVES.nurture.to).toBe("nurture");
    expect(MOVES.convert.to).toBe("converted");
    expect(MOVES.close.to).toBe("closed");
  });
});

describe("PERMISSION_OF", () => {
  const IDS: LeadActionId[] = [
    "claim",
    "log-call",
    "assess",
    "reassess",
    "qualify",
    "nurture",
    "assign",
    "convert",
    "close",
  ];

  it("maps every lead action to a catalog permission", () => {
    // The Record type enforces this at compile time; the runtime check guards
    // the list itself, so a new action cannot ship without deciding its gate.
    expect(Object.keys(PERMISSION_OF).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(PERMISSION_OF[id]).toBeTruthy();
  });

  it("keeps the deliberate non-obvious mappings", () => {
    // Claiming assigns the lead to yourself; closing is this UI's disqualify.
    expect(PERMISSION_OF.claim).toBe("assign");
    expect(PERMISSION_OF.close).toBe("disqualify");
    expect(PERMISSION_OF["log-call"]).toBe("add_note");
  });
});

/**
 * The manual form once asked for a company name and nothing else, while the chat
 * agent refused to file without a contact, an email and a service. These pin the
 * manual door to the agent's rules so the queue stops receiving leads nobody can
 * act on.
 */
describe("newLeadBlockers", () => {
  const filled = {
    companyName: "Al Manzil",
    contactName: "Ahmed Khalil",
    contactEmail: "ahmed@almanzil.ae",
    serviceType: "Hood cleaning",
    estimatedValue: "",
  };
  const fields = (over: Partial<typeof filled> = {}) => ({ ...filled, ...over });
  const blocked = (over: Partial<typeof filled> = {}) =>
    newLeadBlockers(fields(over)).map((b) => b.field);

  it("lets a complete lead through", () => {
    expect(newLeadBlockers(fields())).toEqual([]);
  });

  it("requires the contact — a lead with no person on it cannot be worked", () => {
    expect(blocked({ contactName: "" })).toContain("contactName");
    expect(blocked({ contactName: "   " })).toContain("contactName");
  });

  it("leaves the company optional — a household enquiry has no business name", () => {
    expect(blocked({ companyName: "" })).toEqual([]);
    expect(blocked({ companyName: "   " })).toEqual([]);
  });

  it("requires an email, and one shaped like an address", () => {
    expect(blocked({ contactEmail: "" })).toContain("contactEmail");
    expect(blocked({ contactEmail: "0501234567" })).toContain("contactEmail");
    expect(blocked({ contactEmail: "ahmed@almanzil" })).toContain("contactEmail");
    expect(blocked({ contactEmail: "a@b.co" })).not.toContain("contactEmail");
  });

  it("requires a service — this is what the assessment scores on", () => {
    expect(blocked({ serviceType: "" })).toContain("serviceType");
    expect(blocked({ serviceType: "  " })).toContain("serviceType");
  });

  it("leaves the value optional, but refuses one that is not a number", () => {
    expect(blocked({ estimatedValue: "" })).not.toContain("estimatedValue");
    expect(blocked({ estimatedValue: "12000" })).not.toContain("estimatedValue");
    expect(blocked({ estimatedValue: "twelve thousand" })).toContain("estimatedValue");
  });

  it("reports every problem at once, in field order", () => {
    expect(
      blocked({ companyName: "", contactName: "", contactEmail: "", serviceType: "" })
    ).toEqual(["contactName", "contactEmail", "serviceType"]);
  });

  /** The manual door and the chat agent must demand the same three things, or a
      lead means something different depending on how it arrived. */
  it("matches what the intake agent refuses to file without", () => {
    expect(blocked({ contactName: "", contactEmail: "", serviceType: "" }).sort()).toEqual([
      "contactEmail",
      "contactName",
      "serviceType",
    ]);
  });
});
