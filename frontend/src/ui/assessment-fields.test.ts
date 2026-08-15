/**
 * `toLines` against a REAL agent reply.
 *
 * The fixture is a verbatim `lead-intelligence` response, captured from the
 * live agent — not hand-written. That matters: this exact bug shipped because
 * five agents return flat strings and the sixth nests, and no hand-written
 * fixture would have carried the shape nobody expected.
 *
 * The assertion that earns its place is the last one — no rendered line may
 * contain "[object Object]". That is precisely what appeared on the Zaroob
 * Restaurant Group lead in the browser.
 */

import { describe, expect, it } from "vitest";
import { toLines } from "./assessment-fields";
import reply from "./__fixtures__/lead-intelligence-reply.json";

describe("toLines", () => {
  it("splits the flat agents' semicolon lists", () => {
    expect(toLines("Missing area; Missing frequency; No photos")).toEqual([
      "Missing area",
      "Missing frequency",
      "No photos",
    ]);
  });

  it("keeps a single prose value as one line", () => {
    expect(toLines("Ready to send.")).toEqual(["Ready to send."]);
  });

  it("reads an object as labelled pairs rather than [object Object]", () => {
    expect(toLines({ level: "High", reason: "Insurance renewal next month" })).toEqual([
      "Level: High · Reason: Insurance renewal next month",
    ]);
  });

  it("reads an array of objects as one line each", () => {
    const lines = toLines([
      { flag: "No budget", severity: "Medium" },
      { flag: "No contact", severity: "High" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Flag: No budget · Severity: Medium");
  });

  it("drops empty members of an object", () => {
    expect(toLines({ action: "Assign to Sales", reason: "" })).toEqual(["Action: Assign to Sales"]);
  });

  it("reports an empty list as None, so a clean check is not mistaken for a skipped one", () => {
    expect(toLines([])).toEqual(["None"]);
    expect(toLines({})).toEqual(["None"]);
  });

  it("returns nothing for an absent field", () => {
    expect(toLines(null)).toEqual([]);
    expect(toLines(undefined)).toEqual([]);
  });

  it("renders every field of a real lead-intelligence reply without [object Object]", () => {
    const fields = reply as Record<string, unknown>;
    // The reply is nested — this is the shape the flat-string assumption missed.
    const nested = Object.keys(fields).filter(
      (k) => typeof fields[k] === "object" && fields[k] !== null
    );
    expect(nested.length).toBeGreaterThan(5);

    for (const key of Object.keys(fields)) {
      for (const line of toLines(fields[key])) {
        expect(line, `field ${key}`).not.toContain("[object Object]");
        expect(line, `field ${key}`).not.toBe("");
      }
    }
  });
});
