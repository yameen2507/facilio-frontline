import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  checksum,
  fnv1a,
  isRevisionTrigger,
  verifyChecksum,
} from "../src/domain/survey-revision";

describe("canonicalJson", () => {
  it("sorts object keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: 3 })).toBe('{"a":3,"z":{"x":2,"y":1}}');
  });

  it("leaves array order alone, because array order is data", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson({ rooms: ["204", "101"] })).toBe('{"rooms":["204","101"]}');
  });

  it("sorts inside objects nested in arrays", () => {
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("drops undefined exactly as JSON.stringify does", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("passes nulls and primitives straight through", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(canonicalJson("plain")).toBe('"plain"');
  });
});

describe("checksum — what the frozen revision actually claims", () => {
  const payload = {
    surveyId: "s1",
    notVisitedPct: null,
    nodes: [{ name: "Tower A", areaSqft: 4500 }],
    answers: { total_sqft: "4500" },
  };

  it("is stable for the same payload", () => {
    expect(checksum(payload)).toBe(checksum(payload));
  });

  it("is UNCHANGED by key order — the whole point of canonicalising", () => {
    const reordered = {
      answers: { total_sqft: "4500" },
      nodes: [{ areaSqft: 4500, name: "Tower A" }],
      notVisitedPct: null,
      surveyId: "s1",
    };
    expect(checksum(reordered)).toBe(checksum(payload));
  });

  it("CHANGES when any value changes", () => {
    expect(checksum({ ...payload, surveyId: "s2" })).not.toBe(checksum(payload));
    expect(
      checksum({ ...payload, nodes: [{ name: "Tower A", areaSqft: 4501 }] })
    ).not.toBe(checksum(payload));
  });

  it("distinguishes null from zero — the not_visited_pct case", () => {
    expect(checksum({ ...payload, notVisitedPct: 0 })).not.toBe(checksum(payload));
  });

  it("distinguishes the string 4500 from the number 4500", () => {
    expect(checksum({ v: "4500" })).not.toBe(checksum({ v: 4500 }));
  });

  it("verifies a payload against a frozen checksum", () => {
    const frozen = checksum(payload);
    expect(verifyChecksum(payload, frozen)).toBe(true);
    expect(verifyChecksum({ ...payload, surveyId: "tampered" }, frozen)).toBe(false);
  });
});

describe("fnv1a", () => {
  it("always returns 8 lowercase hex characters", () => {
    for (const s of ["", "a", "the quick brown fox", "Tower A — مبنى"]) {
      expect(fnv1a(s)).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("matches the published FNV-1a 32-bit vectors for ASCII", () => {
    // Reference values for the standard algorithm.
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    expect(fnv1a("foobar")).toBe("bf9cf968");
  });

  it("hashes non-ASCII deterministically — Arabic site names are normal here", () => {
    expect(fnv1a("مبنى")).toBe(fnv1a("مبنى"));
    expect(fnv1a("مبنى")).not.toBe(fnv1a("مبني"));
  });

  it("separates inputs that differ only in one character", () => {
    expect(fnv1a("Room 204")).not.toBe(fnv1a("Room 205"));
  });
});

describe("isRevisionTrigger", () => {
  it("accepts the three real triggers and nothing else", () => {
    expect(isRevisionTrigger("submit")).toBe(true);
    expect(isRevisionTrigger("rework_bounce")).toBe(true);
    expect(isRevisionTrigger("cancel")).toBe(true);
    expect(isRevisionTrigger("edit")).toBe(false);
    expect(isRevisionTrigger(null)).toBe(false);
  });
});
