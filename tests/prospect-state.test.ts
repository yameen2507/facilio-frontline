import { describe, expect, it } from "vitest";
import {
  allowedConvertStates,
  allowedVerdicts,
  CEILING_BANDS,
  convertAction,
  convertBlocker,
  CONVERT_STATES,
  decisionBlocker,
  defaultConvertTarget,
  LOCATION_TYPES,
  countsTowardScope,
  parentBlocker,
  PROVENANCES,
  PURSUIT_DECISIONS,
  verdictBlocker,
  verdictNeedsNote,
  VERDICTS,
  type ConvertState,
  type Verdict,
} from "../src/domain/prospect-state";

describe("§5.1 levels — site → building → space, and the independent space", () => {
  it("makes a site the top level", () => {
    expect(parentBlocker("site", null)).toBeNull();
    expect(parentBlocker("site", "site")).toMatch(/top level/);
  });

  it("puts a building under a site and nowhere else", () => {
    expect(parentBlocker("building", "site")).toBeNull();
    expect(parentBlocker("building", null)).toMatch(/needs a parent/);
    expect(parentBlocker("building", "building")).toMatch(/only site/);
    expect(parentBlocker("building", "space")).toMatch(/only site/);
  });

  it("lets a space hang off a building OR straight off a site", () => {
    // The car park / lawn case. Refusing this would be modelling the
    // integration rather than the world — L20 is open on Facilio's API, not on
    // whether car parks exist.
    expect(parentBlocker("space", "building")).toBeNull();
    expect(parentBlocker("space", "site")).toBeNull();
    expect(parentBlocker("space", null)).toMatch(/needs a parent/);
    expect(parentBlocker("space", "space")).toMatch(/cannot hang off a space/);
  });

  it("has no fourth level — floors are a number, not a level", () => {
    expect(LOCATION_TYPES).toEqual(["site", "building", "space"]);
  });
});

describe("§4.1 verdict — is this real?", () => {
  it("opens from a document or a walk", () => {
    expect(allowedVerdicts("unverified")).toEqual([
      "verified",
      "changed",
      "not_found",
      "not_visited",
    ]);
    expect(allowedVerdicts("added_on_site")).toEqual(["changed"]);
  });

  it("lets a later visit disagree with a confirmed location", () => {
    expect(verdictBlocker({ from: "verified", to: "changed", note: "extended since" })).toBeNull();
  });

  it("treats a finding as final — a re-walk is a new survey", () => {
    for (const final of ["changed", "not_found", "not_visited"] as Verdict[]) {
      expect(allowedVerdicts(final)).toEqual([]);
      expect(verdictBlocker({ from: final, to: "verified" })).toMatch(/final/);
    }
  });

  it("demands a note on exactly the three that print as qualifications", () => {
    expect(VERDICTS.filter(verdictNeedsNote)).toEqual(["changed", "not_found", "not_visited"]);

    for (const to of ["changed", "not_found", "not_visited"] as Verdict[]) {
      expect(verdictBlocker({ from: "unverified", to })).toMatch(/needs a note/);
      expect(verdictBlocker({ from: "unverified", to, note: "   " })).toMatch(/needs a note/);
      expect(verdictBlocker({ from: "unverified", to, note: "escort unavailable" })).toBeNull();
    }
    // `verified` is the one finding that needs no explanation.
    expect(verdictBlocker({ from: "unverified", to: "verified" })).toBeNull();
  });

  it("freezes the verdict once the location is in Facilio", () => {
    expect(
      verdictBlocker({
        from: "unverified",
        to: "verified",
        convertState: "converted",
      })
    ).toMatch(/already in Facilio/);
  });

  it("refuses a verdict from someone who is not on the survey", () => {
    expect(
      verdictBlocker({ from: "unverified", to: "verified", actorIsAssignee: false })
    ).toMatch(/active assignee/);
    expect(
      verdictBlocker({ from: "unverified", to: "verified", actorIsAssignee: true })
    ).toBeNull();
  });

  it("says so plainly when nothing changed", () => {
    expect(verdictBlocker({ from: "verified", to: "verified" })).toMatch(/already verified/);
  });
});

describe("§4.2 convert_state — nothing reaches the CMMS before Won", () => {
  it("blocks every move out of not_converted while the deal is open", () => {
    // The module's entire safety claim, as a test rather than a promise.
    for (const to of ["queued", "excluded"] as ConvertState[]) {
      expect(convertBlocker({ from: "not_converted", to, dealIsWon: false, reason: "x" })).toMatch(
        /until the deal is Won/
      );
    }
  });

  it("lets a repeat client's building be marked already_linked before Won", () => {
    // A statement of fact about a building that is already in Facilio, not a
    // write to it — so it is the one move that does not wait.
    expect(
      convertBlocker({
        from: "not_converted",
        to: "already_linked",
        dealIsWon: false,
        facilioId: "FAC-9",
      })
    ).toBeNull();
  });

  it("needs a Facilio id to claim already_linked", () => {
    expect(
      convertBlocker({ from: "not_converted", to: "already_linked", dealIsWon: false })
    ).toMatch(/carries a Facilio id/);
  });

  it("queues, writes, and retries a failure through queued again", () => {
    expect(convertBlocker({ from: "not_converted", to: "queued", dealIsWon: true })).toBeNull();
    expect(convertBlocker({ from: "queued", to: "converted", dealIsWon: true })).toBeNull();
    expect(convertBlocker({ from: "queued", to: "convert_failed", dealIsWon: true })).toBeNull();
    expect(convertBlocker({ from: "convert_failed", to: "queued", dealIsWon: true })).toBeNull();
  });

  it("never un-converts", () => {
    expect(allowedConvertStates("converted")).toEqual([]);
    expect(convertBlocker({ from: "converted", to: "not_converted", dealIsWon: true })).toMatch(
      /final/
    );
  });

  it("never converts an already_linked location", () => {
    expect(allowedConvertStates("already_linked")).toEqual([]);
  });

  it("demands a reason to exclude", () => {
    expect(convertBlocker({ from: "not_converted", to: "excluded", dealIsWon: true })).toMatch(
      /needs a reason/
    );
    expect(
      convertBlocker({ from: "not_converted", to: "excluded", dealIsWon: true, reason: "tenant fit-out" })
    ).toBeNull();
  });

  it("covers every state in the machine", () => {
    expect(CONVERT_STATES).toHaveLength(6);
    for (const s of CONVERT_STATES) expect(allowedConvertStates(s)).toBeDefined();
  });
});

describe("§7.3 ★ the convert only ever CREATES ★", () => {
  const base = {
    verdict: "verified" as Verdict,
    convertState: "not_converted" as ConvertState,
    pursuitDecision: "bid" as const,
  };

  it("creates when there is no Facilio id — no id means new", () => {
    expect(convertAction(base).action).toBe("create");
    expect(convertAction({ ...base, facilioId: "" }).action).toBe("create");
    expect(convertAction({ ...base, facilioId: "   " }).action).toBe("create");
  });

  it("skips anything that already carries an id, never updates it", () => {
    const out = convertAction({ ...base, facilioId: "FAC-9" });
    expect(out.action).toBe("skip");
    expect(out.reason).toMatch(/already in Facilio/);
  });

  it("FLAGS a discrepancy instead of writing when the survey disagrees with a live record", () => {
    // The rule that protects a maintained, contracted record from a bid-stage
    // estimate. It must not be a write of any kind.
    const out = convertAction({ ...base, facilioId: "FAC-9", verdict: "changed" });
    expect(out.action).toBe("flag");
    expect(out.reason).toMatch(/discrepancy/);
  });

  it("does not create a building the surveyor could not find", () => {
    expect(convertAction({ ...base, verdict: "not_found" }).action).toBe("skip");
  });

  it("skips no_bid rows entirely", () => {
    expect(convertAction({ ...base, pursuitDecision: "no_bid" }).action).toBe("skip");
    // Even when it is otherwise a perfectly convertible location.
    expect(convertAction({ ...base, pursuitDecision: "no_bid", verdict: "verified" }).action).toBe(
      "skip"
    );
  });

  it("skips what an earlier run already wrote — the retry is a no-op", () => {
    expect(convertAction({ ...base, convertState: "converted" }).action).toBe("skip");
  });

  it("never returns anything but create, skip or flag", () => {
    for (const verdict of VERDICTS) {
      for (const convertState of CONVERT_STATES) {
        for (const pursuitDecision of PURSUIT_DECISIONS) {
          const { action } = convertAction({ verdict, convertState, pursuitDecision });
          expect(["create", "skip", "flag"]).toContain(action);
        }
      }
    }
  });
});

describe("§5.1 the bid / no-bid call", () => {
  it("demands a note on no_bid and nothing else", () => {
    expect(decisionBlocker("no_bid")).toMatch(/needs a note/);
    expect(decisionBlocker("no_bid", "outside our coverage area")).toBeNull();
    for (const d of ["undecided", "bid", "deferred"] as const) {
      expect(decisionBlocker(d)).toBeNull();
    }
  });

  it("drops a no_bid row out of every total", () => {
    expect(countsTowardScope("no_bid")).toBe(false);
    expect(PURSUIT_DECISIONS.filter(countsTowardScope)).toEqual([
      "undecided",
      "bid",
      "deferred",
    ]);
  });
});

describe("§12 F-7 — the convert target defaults to like-for-like", () => {
  it("proposes the level the prospect tree already says", () => {
    for (const t of LOCATION_TYPES) expect(defaultConvertTarget(t)).toBe(t);
  });
});

describe("the closed enums the reference handler serves", () => {
  it("holds the five provenances — which feed said it", () => {
    expect(PROVENANCES).toEqual(["rfp", "survey", "crm", "facilio_link", "manual"]);
  });

  it("holds the three ceiling bands, because a high ceiling changes the crew", () => {
    expect(CEILING_BANDS).toEqual(["standard_8_10ft", "high_10_20ft", "very_high_20ft_plus"]);
  });
});
