import { describe, expect, it } from "vitest";
import { clampScore, parseAnalystReply, queuePriority, scoreBand } from "../src/domain/scoring";

describe("scoreBand", () => {
  it("bands at the documented boundaries", () => {
    expect(scoreBand(100)).toBe("hot");
    expect(scoreBand(75)).toBe("hot");
    expect(scoreBand(74)).toBe("warm");
    expect(scoreBand(50)).toBe("warm");
    expect(scoreBand(49)).toBe("cool");
    expect(scoreBand(25)).toBe("cool");
    expect(scoreBand(24)).toBe("cold");
    expect(scoreBand(0)).toBe("cold");
  });
});

describe("clampScore", () => {
  it("clamps out-of-range values, since the platform drops schema min/max", () => {
    expect(clampScore(150)).toBe(100);
    expect(clampScore(-20)).toBe(0);
    expect(clampScore(72.6)).toBe(73);
  });

  it("coerces strings and defaults junk to zero", () => {
    expect(clampScore("80")).toBe(80);
    expect(clampScore("high")).toBe(0);
    expect(clampScore(null)).toBe(0);
    expect(clampScore(undefined)).toBe(0);
    expect(clampScore(Number.NaN)).toBe(0);
  });
});

describe("parseAnalystReply", () => {
  it("reads a well-formed reply", () => {
    const result = parseAnalystReply({
      understanding: { wants: "kitchen hood cleaning", urgency: "high" },
      relevance: {
        verdict: "relevant",
        reasons: ["kitchen extract is a core service", "Dubai is covered"],
        matchedServices: ["KEC"],
      },
      score: { value: 82, fitReasons: ["restaurant, 4 hoods"], redFlags: [] },
      recommendation: { nextAction: "call to book a survey" },
    });

    expect(result.verdict).toBe("relevant");
    expect(result.score).toBe(82);
    expect(result.band).toBe("hot");
    expect(result.reasons).toHaveLength(3);
    expect(result.understanding.wants).toBe("kitchen hood cleaning");
    expect(result.recommendation.nextAction).toBe("call to book a survey");
  });

  it("fails safe: a malformed reply lands as not_relevant/0, not as qualified", () => {
    for (const bad of [null, undefined, "a string", 42, [], {}]) {
      const result = parseAnalystReply(bad);
      expect(result.verdict).toBe("not_relevant");
      expect(result.score).toBe(0);
      expect(result.band).toBe("cold");
    }
  });

  it("rejects a verdict the model invented", () => {
    expect(parseAnalystReply({ relevance: { verdict: "maybe" } }).verdict).toBe("not_relevant");
  });

  it("accepts a bare top-level score", () => {
    expect(parseAnalystReply({ score: 60 }).score).toBe(60);
  });

  it("ignores non-string entries in reason arrays", () => {
    const result = parseAnalystReply({
      relevance: { verdict: "relevant", reasons: ["good", 5, null, "also good"] },
    });
    expect(result.reasons).toEqual(["good", "also good"]);
  });
});

describe("queuePriority", () => {
  it("puts any overdue lead above every in-time lead", () => {
    expect(queuePriority({ score: 10, isOverdue: true })).toBeGreaterThan(
      queuePriority({ score: 100, isOverdue: false })
    );
  });

  it("sorts by score within the same overdue state", () => {
    expect(queuePriority({ score: 80, isOverdue: false })).toBeGreaterThan(
      queuePriority({ score: 40, isOverdue: false })
    );
  });
});
