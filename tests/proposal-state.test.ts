import { describe, expect, it } from "vitest";
import {
  approvalDecision,
  canRecordNegotiation,
  canRevise,
  daysToExpiry,
  effectiveStatus,
  isEditable,
  isNegotiationKind,
  isProposalStatus,
  isTerminal,
  NEGOTIATION_KINDS,
  nextStatus,
  PROPOSAL_STATUSES,
  transitionBlocker,
  TRANSITIONS,
  type ApprovalLine,
  type ProposalStatus,
  type TransitionName,
} from "../src/domain/proposal-state";

const NOW = "2026-08-14T00:00:00Z";

// A line at the card price, with no deviation and nothing optional about it.
// Every approval fixture below is this with one field moved, so the field
// under test is the only thing that could have produced the outcome.
const line = (over: Partial<ApprovalLine> = {}): ApprovalLine => ({
  pricingMode: "standard",
  deviationPct: 0,
  isOptional: false,
  deltaReason: null,
  description: "Daily cleaning",
  ...over,
});

describe("the nine statuses", () => {
  it("recognises exactly the declared statuses and nothing else", () => {
    expect(PROPOSAL_STATUSES).toHaveLength(9);
    expect(PROPOSAL_STATUSES.every(isProposalStatus)).toBe(true);
    expect(isProposalStatus("pending")).toBe(false);
    expect(isProposalStatus(undefined)).toBe(false);
  });

  it("ends at accepted, rejected, expired, superseded and withdrawn", () => {
    for (const s of ["accepted", "rejected", "expired", "superseded", "withdrawn"] as const) {
      expect(isTerminal(s)).toBe(true);
    }
    for (const s of ["draft", "pending_approval", "approved", "sent"] as const) {
      expect(isTerminal(s)).toBe(false);
    }
  });

  it("closes editing the moment the client can see it", () => {
    // `approved` is already out of reach: the next thing that happens to it is
    // a send, and a document that changes between approval and send was never
    // really approved.
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("pending_approval")).toBe(true);
    expect(isEditable("approved")).toBe(false);
    expect(isEditable("sent")).toBe(false);
  });
});

describe("every transition the table allows is allowed", () => {
  it("passes from each of its declared `from` states", () => {
    // Enumerated rather than hand-listed: `approve` is legal from two states
    // and `supersede` from four, and a hand-written list quietly misses those.
    for (const [name, rule] of Object.entries(TRANSITIONS)) {
      for (const from of rule.from) {
        const blocker = transitionBlocker({
          status: from,
          transition: name as TransitionName,
          reason: "recorded so the reason rule never decides this test",
        });
        expect(blocker, `${name} from ${from}`).toBeNull();
      }
    }
  });

  it("lands each transition on its declared target", () => {
    expect(nextStatus("submit_for_approval")).toBe("pending_approval");
    expect(nextStatus("approve")).toBe("approved");
    expect(nextStatus("return")).toBe("draft");
    expect(nextStatus("send")).toBe("sent");
    expect(nextStatus("withdraw")).toBe("withdrawn");
    expect(nextStatus("accept")).toBe("accepted");
    expect(nextStatus("reject")).toBe("rejected");
    expect(nextStatus("supersede")).toBe("superseded");
    expect(nextStatus("expire")).toBe("expired");
  });

  it("approves straight from draft, without a detour through pending", () => {
    // A proposal with no exceptions never needs an approver, so the approval
    // step is skipped rather than rubber-stamped.
    expect(transitionBlocker({ status: "draft", transition: "approve" })).toBeNull();
  });
});

describe("the transitions that must be refused", () => {
  it("will not send anything that has not been approved", () => {
    // The one that costs money: a draft price reaching a client.
    expect(transitionBlocker({ status: "draft", transition: "send" })).toMatch(
      /cannot send a draft proposal \(allowed from: approved\)/
    );
    expect(transitionBlocker({ status: "pending_approval", transition: "send" })).toMatch(
      /cannot send a pending approval proposal/
    );
  });

  it("will not move anything out of a terminal state", () => {
    for (const from of ["accepted", "rejected", "expired", "superseded", "withdrawn"] as const) {
      for (const name of Object.keys(TRANSITIONS) as TransitionName[]) {
        expect(
          transitionBlocker({ status: from, transition: name, reason: "because" }),
          `${name} from ${from}`
        ).not.toBeNull();
      }
    }
  });

  it("will not accept or reject an offer the client has never seen", () => {
    expect(transitionBlocker({ status: "approved", transition: "accept" })).toMatch(/cannot accept/);
    expect(
      transitionBlocker({ status: "draft", transition: "reject", reason: "too expensive" })
    ).toMatch(/cannot reject/);
  });

  it("will not return a proposal that is not with an approver", () => {
    expect(
      transitionBlocker({ status: "draft", transition: "return", reason: "fix the areas" })
    ).toMatch(/cannot return a draft proposal \(allowed from: pending_approval\)/);
  });

  it("will not withdraw a draft — there is nothing out there to pull back", () => {
    expect(
      transitionBlocker({ status: "draft", transition: "withdraw", reason: "client went quiet" })
    ).toMatch(/cannot withdraw a draft proposal/);
  });

  it("names the allowed states in the refusal, because the message is what the user reads", () => {
    const blocker = transitionBlocker({ status: "sent", transition: "submit_for_approval" });
    expect(blocker).toContain("allowed from: draft");
    // The status reads as a label, not as a database value.
    expect(blocker).toContain("a sent proposal");
  });
});

describe("a state change nobody can explain is one nobody can defend", () => {
  // Each of these is checked from its LEGAL state — from the wrong state the
  // blocker is the wrong-state message and the reason rule is never reached,
  // so a loose assertion here would pass while testing nothing.
  const REASONED: ReadonlyArray<[TransitionName, ProposalStatus]> = [
    ["return", "pending_approval"],
    ["withdraw", "sent"],
    ["reject", "sent"],
  ];

  it("refuses without a reason", () => {
    for (const [transition, status] of REASONED) {
      expect(transitionBlocker({ status, transition }), transition).toMatch(
        /a reason is required to/
      );
      expect(transitionBlocker({ status, transition, reason: null }), transition).toMatch(
        /a reason is required to/
      );
    }
  });

  it("does not count whitespace as a reason", () => {
    for (const [transition, status] of REASONED) {
      expect(transitionBlocker({ status, transition, reason: "   \n\t " }), transition).toMatch(
        /a reason is required to/
      );
    }
  });

  it("accepts a real one", () => {
    for (const [transition, status] of REASONED) {
      expect(
        transitionBlocker({ status, transition, reason: "client picked another supplier" }),
        transition
      ).toBeNull();
    }
  });

  it("asks nothing of the ordinary forward moves", () => {
    expect(transitionBlocker({ status: "draft", transition: "submit_for_approval" })).toBeNull();
    expect(transitionBlocker({ status: "approved", transition: "send" })).toBeNull();
    expect(transitionBlocker({ status: "sent", transition: "accept" })).toBeNull();
  });
});

describe("approval keys off deviation from the card, not margin (spec §4)", () => {
  it("waves through a proposal where every line is standard", () => {
    const decision = approvalDecision({
      lines: [line(), line({ description: "Window cleaning" })],
      thresholdPct: 10,
    });
    expect(decision.needsApproval).toBe(false);
    expect(decision.exceptions).toEqual([]);
    expect(decision.reason).toContain("within the 10% threshold");
  });

  it("waves through a markup of any size", () => {
    // Charging more than the card costs the business nothing, so however large
    // the number it is a commercial judgement, not an exception.
    const decision = approvalDecision({
      lines: [line({ pricingMode: "markup", deviationPct: 400, deltaReason: "night shift, lift access" })],
      thresholdPct: 10,
    });
    expect(decision.needsApproval).toBe(false);
    expect(decision.exceptions).toEqual([]);
  });

  it("waves through a discount inside the threshold", () => {
    const decision = approvalDecision({
      lines: [line({ pricingMode: "discount", deviationPct: -8 })],
      thresholdPct: 10,
    });
    expect(decision.needsApproval).toBe(false);
  });

  it("treats a discount exactly at the threshold as inside it", () => {
    // Strictly beyond, not at. A 10% discount against a 10% threshold is the
    // deal the threshold was written to permit.
    const decision = approvalDecision({
      lines: [line({ pricingMode: "discount", deviationPct: -10 })],
      thresholdPct: 10,
    });
    expect(decision.needsApproval).toBe(false);
  });

  it("sends a discount beyond the threshold to an approver, and lists it", () => {
    const decision = approvalDecision({
      lines: [
        line({ description: "Daily cleaning" }),
        line({
          description: "Deep clean",
          pricingMode: "discount",
          deviationPct: -18,
          deltaReason: "three-year term agreed",
        }),
      ],
      thresholdPct: 10,
    });
    expect(decision.needsApproval).toBe(true);
    // Only the line that deviated — handing the approver the whole document is
    // the same as handing them nothing.
    expect(decision.exceptions).toHaveLength(1);
    expect(decision.exceptions[0].description).toBe("Deep clean");
    expect(decision.exceptions[0].mode).toBe("discount");
    expect(decision.exceptions[0].deviationPct).toBe(-18);
    expect(decision.exceptions[0].reason).toBe("three-year term agreed");
    expect(decision.exceptions[0].why).toContain("18.0% discount is beyond the 10% threshold");
    expect(decision.reason).toContain("1 line(s)");
  });

  it("sends any custom line to an approver, however small the deviation", () => {
    // There is no card rate behind a custom price, so there is no number to
    // check it against — the deviation is irrelevant.
    const decision = approvalDecision({
      lines: [line({ description: "Facade abseil", pricingMode: "custom", deviationPct: 0 })],
      thresholdPct: 10,
    });
    expect(decision.needsApproval).toBe(true);
    expect(decision.exceptions[0].why).toContain("no card rate to check it against");
  });

  it("never lets an optional line trigger approval", () => {
    // The strongest form of the rule: an optional line that is custom AND
    // deeply discounted still sells nothing, so it commits the business to
    // nothing. It joins the exception list only once the client takes it.
    const decision = approvalDecision({
      lines: [
        line({ description: "Optional custom", pricingMode: "custom", isOptional: true }),
        line({ description: "Optional deep discount", pricingMode: "discount", deviationPct: -60, isOptional: true }),
      ],
      thresholdPct: 10,
    });
    expect(decision.needsApproval).toBe(false);
    expect(decision.exceptions).toEqual([]);
  });

  it("moves with the configured threshold, because the setting is the rule", () => {
    const lines = [line({ pricingMode: "discount", deviationPct: -12 })];
    // Same discount, two orgs: one has set 10, the other 15.
    expect(approvalDecision({ lines, thresholdPct: 10 }).needsApproval).toBe(true);
    expect(approvalDecision({ lines, thresholdPct: 15 }).needsApproval).toBe(false);
  });

  it("falls back to 10 when the setting is not a number", () => {
    const lines = [line({ pricingMode: "discount", deviationPct: -12 })];
    const decision = approvalDecision({ lines, thresholdPct: Number.NaN });
    expect(decision.needsApproval).toBe(true);
    expect(decision.exceptions[0].why).toContain("beyond the 10% threshold");
    // …and an unset threshold reads the same way on the clean path.
    expect(approvalDecision({ lines: [line()], thresholdPct: Number.NaN }).reason).toContain(
      "within the 10% threshold"
    );
  });

  it("reads a missing pricing mode as standard rather than as an exception", () => {
    const decision = approvalDecision({
      lines: [line({ pricingMode: null, deviationPct: -30 })],
      thresholdPct: 10,
    });
    expect(decision.needsApproval).toBe(false);
  });

  it("collects every offending line, not just the first", () => {
    const decision = approvalDecision({
      lines: [
        line({ description: "A", pricingMode: "discount", deviationPct: -25 }),
        line({ description: "B", pricingMode: "custom" }),
        line({ description: "C" }),
      ],
      thresholdPct: 10,
    });
    expect(decision.exceptions.map((e) => e.description)).toEqual(["A", "B"]);
  });

  it("says an empty proposal needs no approval", () => {
    expect(approvalDecision({ lines: [], thresholdPct: 10 }).needsApproval).toBe(false);
  });
});

describe("expiry is computed at read time, never stored (spec §5 R8)", () => {
  const LAPSED = "2026-08-01T00:00:00Z";
  const AHEAD = "2026-09-01T00:00:00Z";

  it("reads a sent proposal past its validity as expired", () => {
    expect(effectiveStatus("sent", LAPSED, NOW)).toBe("expired");
  });

  it("leaves the stored status alone", () => {
    // The whole point of computing it: the row still says `sent`, and nothing
    // needed a scheduled job to run overnight for the screen to be right.
    const proposal = { status: "sent" as ProposalStatus, validUntil: LAPSED };
    expect(effectiveStatus(proposal.status, proposal.validUntil, NOW)).toBe("expired");
    expect(proposal.status).toBe("sent");
    expect(proposal.validUntil).toBe(LAPSED);
  });

  it("leaves a sent proposal inside its window alone", () => {
    expect(effectiveStatus("sent", AHEAD, NOW)).toBe("sent");
  });

  it("never expires a proposal with no validity date", () => {
    expect(effectiveStatus("sent", null, NOW)).toBe("sent");
    expect(effectiveStatus("sent", undefined, NOW)).toBe("sent");
    expect(effectiveStatus("sent", "   ", NOW)).toBe("sent");
  });

  it("only ever expires a sent proposal", () => {
    // A draft has never been offered to anyone, so a lapsed date on it means
    // nothing; a terminal one has already ended.
    for (const stored of PROPOSAL_STATUSES) {
      if (stored === "sent") continue;
      expect(effectiveStatus(stored, LAPSED, NOW), stored).toBe(stored);
    }
  });
});

describe("daysToExpiry — the absolute clock the chase logic keys off", () => {
  it("counts the days left on a live offer", () => {
    expect(daysToExpiry("2026-08-20T00:00:00Z", NOW)).toBe(6);
  });

  it("goes negative once the offer has lapsed", () => {
    expect(daysToExpiry("2026-08-04T00:00:00Z", NOW)).toBe(-10);
    expect(daysToExpiry("2026-08-13T00:00:00Z", NOW)).toBeLessThan(0);
  });

  it("is null when there is no date to count to", () => {
    expect(daysToExpiry(null, NOW)).toBeNull();
    expect(daysToExpiry(undefined, NOW)).toBeNull();
    expect(daysToExpiry("", NOW)).toBeNull();
    expect(daysToExpiry("   ", NOW)).toBeNull();
  });

  it("is null rather than NaN when a date cannot be parsed", () => {
    expect(daysToExpiry("not a date", NOW)).toBeNull();
    expect(daysToExpiry("2026-08-20T00:00:00Z", "not a date")).toBeNull();
  });
});

describe("negotiation is an event, not a state (spec §5 R2)", () => {
  it("recognises the five kinds and nothing else", () => {
    expect(NEGOTIATION_KINDS).toHaveLength(5);
    expect(NEGOTIATION_KINDS.every(isNegotiationKind)).toBe(true);
    expect(isNegotiationKind("counter")).toBe(false);
    expect(isNegotiationKind(null)).toBe(false);
  });

  it("can be recorded against a live offer, and against one that ended without a deal", () => {
    // Rejection and expiry are where the conversation that produces the next
    // revision usually happens, so neither is a dead end.
    expect(canRecordNegotiation("sent")).toBe(true);
    expect(canRecordNegotiation("rejected")).toBe(true);
    expect(canRecordNegotiation("expired")).toBe(true);
  });

  it("cannot be recorded before the client has the offer, or after the deal is done", () => {
    for (const status of ["draft", "pending_approval", "approved", "accepted", "superseded", "withdrawn"] as const) {
      expect(canRecordNegotiation(status), status).toBe(false);
    }
  });
});

describe("canRevise — and where a revision stops being the right answer", () => {
  it("is false for an accepted proposal", () => {
    // A change after acceptance is a NEW proposal against the won deal, not a
    // revision of the one that was signed (spec §5 R7).
    expect(canRevise("accepted")).toBe(false);
  });

  it("is true from a live offer and from every way one can end without a deal", () => {
    expect(canRevise("sent")).toBe(true);
    expect(canRevise("rejected")).toBe(true);
    expect(canRevise("expired")).toBe(true);
    expect(canRevise("withdrawn")).toBe(true);
  });

  it("is false before the proposal has ever been sent", () => {
    // Before first send an edit is just an edit — no version churn (spec §5 R1).
    for (const status of ["draft", "pending_approval", "approved", "superseded"] as const) {
      expect(canRevise(status), status).toBe(false);
    }
  });

  it("lets a withdrawn proposal be revised but not negotiated on", () => {
    // The asymmetry is deliberate and easy to flatten by accident: we pulled
    // the offer back, so there is no live thread to add to — but re-pricing
    // and re-issuing is exactly what happens next.
    expect(canRevise("withdrawn")).toBe(true);
    expect(canRecordNegotiation("withdrawn")).toBe(false);
  });
});
