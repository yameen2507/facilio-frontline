import { describe, expect, it } from "vitest";
import {
  acceptanceFor,
  columnFor,
  decisionPicks,
  decisionWritesCache,
  displayValue,
  FIELD_KEYS,
  isFieldKey,
  kindFor,
  labelFor,
  reconciliationBlocker,
  RECONCILIATION_DECISIONS,
  PRICED_FIELD_KEYS,
  provenanceLabel,
  tierFor,
  typeValue,
  valuesAgree,
  type TypedValue,
} from "../src/domain/observation-state";

const num = (n: number): TypedValue => ({ valueText: null, valueNumber: n });
const txt = (s: string): TypedValue => ({ valueText: s, valueNumber: null });

describe("the field allowlist — which columns an observation may write", () => {
  it("maps every key to a column", () => {
    for (const k of FIELD_KEYS) expect(columnFor(k)).toBeTruthy();
  });

  it("refuses a key it does not know", () => {
    expect(() => columnFor("is_active")).toThrow(/not an observable field/);
    expect(() => columnFor("convert_state")).toThrow(/not an observable field/);
    expect(() => columnFor("name; drop table")).toThrow(/not an observable field/);
  });

  it("does NOT expose the lifecycle columns", () => {
    // The acceptance flow caches measurements. It has no business writing state:
    // a field key that reached `verdict` or `is_active` would let an observation
    // move a location through a state machine that has its own guards.
    const columns = FIELD_KEYS.map(columnFor);
    for (const forbidden of [
      "is_active",
      "convert_state",
      "verdict",
      "pursuit_decision",
      "facilio_id",
      "ancestry_path",
      "parent_id",
      "deal_id",
      "type",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("recognises its own keys and nothing else", () => {
    expect(isFieldKey("area")).toBe(true);
    expect(isFieldKey("nonsense")).toBe(false);
    expect(isFieldKey(42)).toBe(false);
  });

  it("labels a field for a human, and falls back to the raw key", () => {
    expect(labelFor("area")).toBe("Area (sq ft)");
    expect(labelFor("mystery")).toBe("mystery");
  });
});

describe("typing a value — §5.2's typed columns, never a stringly value", () => {
  it("puts a number in value_number", () => {
    expect(typeValue("area", "4500")).toEqual({ valueText: null, valueNumber: 4500 });
    expect(typeValue("room_count", 12)).toEqual({ valueText: null, valueNumber: 12 });
  });

  it("strips grouping commas", () => {
    expect(typeValue("area", "4,500").valueNumber).toBe(4500);
    expect(typeValue("area", "1,234,567").valueNumber).toBe(1234567);
  });

  it("REFUSES a number it cannot parse rather than storing prose", () => {
    // The opposite of the walk's policy, on purpose: a building whose area is
    // "big" is worse than a building with no area at all.
    expect(() => typeValue("area", "~4,500 sq ft")).toThrow(/must be a number/);
    expect(() => typeValue("area", "about 4.5k")).toThrow(/must be a number/);
    expect(() => typeValue("area", "big")).toThrow(/must be a number/);
  });

  it("puts text in value_text, trimmed", () => {
    expect(typeValue("city", "  Dubai ")).toEqual({ valueText: "Dubai", valueNumber: null });
  });

  it("refuses an empty value for either kind", () => {
    expect(() => typeValue("city", "   ")).toThrow(/needs a value/);
    expect(() => typeValue("area", "")).toThrow(/needs a value/);
    expect(() => typeValue("city", null)).toThrow(/needs a value/);
  });

  it("never lets zero read as absent", () => {
    // `0` is falsy and this is the classic place it gets dropped. A ground-floor
    // count of zero is a real answer.
    expect(typeValue("no_of_floors", 0)).toEqual({ valueText: null, valueNumber: 0 });
    expect(typeValue("no_of_floors", "0").valueNumber).toBe(0);
  });

  it("knows which kind each field is", () => {
    expect(kindFor("area")).toBe("number");
    expect(kindFor("city")).toBe("text");
  });

  it("displays whichever column holds the value", () => {
    expect(displayValue(num(4500))).toBe("4500");
    expect(displayValue(txt("Dubai"))).toBe("Dubai");
    expect(displayValue(num(0))).toBe("0");
    expect(displayValue({})).toBe("");
  });
});

describe("agreement — three spellings of one measurement are not a conflict", () => {
  it("compares numbers as numbers", () => {
    expect(valuesAgree(num(4500), num(4500))).toBe(true);
    expect(valuesAgree(typeValue("area", "4,500"), num(4500))).toBe(true);
  });

  it("compares text trimmed and case-insensitively", () => {
    expect(valuesAgree(txt("Ground Floor"), txt("ground floor"))).toBe(true);
    expect(valuesAgree(txt(" Lobby "), txt("Lobby"))).toBe(true);
  });

  it("treats a near miss as a real disagreement", () => {
    // No tolerance, deliberately: a tolerance would be this module deciding how
    // much money a rounding error is worth.
    expect(valuesAgree(num(4500), num(4520))).toBe(false);
  });

  it("never says a number agrees with text", () => {
    expect(valuesAgree(num(4500), txt("4500"))).toBe(false);
  });
});

describe("§4.3 — the acceptance decision", () => {
  it("auto-accepts the first thing anyone says about a field", () => {
    const r = acceptanceFor({ incoming: num(4500), incomingProvenance: "rfp" });
    expect(r.outcome).toBe("auto_accept");
    expect(r.writesCache).toBe(true);
    expect(r.needsHuman).toBe(false);
  });

  it("accepts a second feed that agrees, with no human involved", () => {
    const r = acceptanceFor({
      incoming: num(4500),
      currentAccepted: { ...num(4500), provenance: "rfp" },
      incomingProvenance: "survey",
    });
    expect(r.outcome).toBe("agrees");
    expect(r.writesCache).toBe(true);
    expect(r.needsHuman).toBe(false);
  });

  it("raises a conflict when they disagree, and writes NOTHING", () => {
    // The RFP said 4,500 and the surveyor measured 5,200. Both are true; the
    // cache stays untouched until a person chooses.
    const r = acceptanceFor({
      incoming: num(5200),
      currentAccepted: { ...num(4500), provenance: "rfp" },
      incomingProvenance: "survey",
    });
    expect(r.outcome).toBe("conflict");
    expect(r.writesCache).toBe(false);
    expect(r.needsHuman).toBe(true);
  });

  it("never lets a Facilio read win automatically", () => {
    // §5.2: facilio_link is read-only and may never be accepted over a survey
    // value. It conflicts even against a source it would otherwise supersede.
    const r = acceptanceFor({
      incoming: num(9999),
      currentAccepted: { ...num(4500), provenance: "survey" },
      incomingProvenance: "facilio_link",
    });
    expect(r.outcome).toBe("conflict");
    expect(r.writesCache).toBe(false);
    expect(r.reason).toMatch(/never wins by default/);
  });

  it("still auto-accepts a Facilio read when nothing contradicts it", () => {
    // Recording a linked building's real area is useful; the rule is only that it
    // cannot OVERRULE a survey.
    const r = acceptanceFor({ incoming: num(4500), incomingProvenance: "facilio_link" });
    expect(r.outcome).toBe("auto_accept");
  });

  it("agrees regardless of which feeds are involved", () => {
    for (const p of ["rfp", "survey", "crm", "manual", "facilio_link"] as const) {
      const r = acceptanceFor({
        incoming: txt("Lobby"),
        currentAccepted: { ...txt("lobby"), provenance: "rfp" },
        incomingProvenance: p,
      });
      expect(r.outcome).toBe("agrees");
    }
  });
});

describe("resolving a conflict", () => {
  const both: Array<"rfp" | "survey"> = ["rfp", "survey"];

  it("accepts either source when it is present", () => {
    expect(reconciliationBlocker({ decision: "accepted_survey", available: both })).toBeNull();
    expect(reconciliationBlocker({ decision: "accepted_rfp", available: both })).toBeNull();
  });

  it("refuses to accept a source that is not in the conflict", () => {
    expect(
      reconciliationBlocker({ decision: "accepted_survey", available: ["rfp"] })
    ).toMatch(/no survey value/);
    expect(
      reconciliationBlocker({ decision: "accepted_rfp", available: ["survey"] })
    ).toMatch(/no document value/);
  });

  it("demands a value for a manual override", () => {
    expect(reconciliationBlocker({ decision: "manual_override", available: both })).toMatch(
      /needs the value/
    );
    expect(
      reconciliationBlocker({ decision: "manual_override", manualValue: "5000", available: both })
    ).toBeNull();
  });

  it("lets a clarification be pushed with no value at all", () => {
    // The question goes back to the tenderer, so the field stays unresolved ON
    // PURPOSE — visible rather than papered over with a guess.
    expect(
      reconciliationBlocker({ decision: "pushed_to_clarification", available: both })
    ).toBeNull();
    expect(decisionWritesCache("pushed_to_clarification")).toBe(false);
  });

  it("caches a value for every decision except a clarification", () => {
    for (const d of RECONCILIATION_DECISIONS) {
      expect(decisionWritesCache(d)).toBe(d !== "pushed_to_clarification");
    }
  });

  it("knows which source each decision picks", () => {
    expect(decisionPicks("accepted_survey")).toBe("survey");
    expect(decisionPicks("accepted_rfp")).toBe("rfp");
    expect(decisionPicks("manual_override")).toBeNull();
    expect(decisionPicks("pushed_to_clarification")).toBeNull();
  });
});

describe("v1.3 §6.3 — the two-tier rule, so only money interrupts a person", () => {
  const accepted = (v: number, provenance: string) => ({
    valueText: null,
    valueNumber: v,
    provenance,
  });

  it("raises a conflict when a PRICED field disagrees", () => {
    const result = acceptanceFor({
      incoming: num(5200),
      currentAccepted: accepted(4500, "rfp"),
      incomingProvenance: "survey",
      tier: "priced",
    });
    expect(result.outcome).toBe("conflict");
    expect(result.needsHuman).toBe(true);
    // Nothing is overwritten until a person chooses — the whole point.
    expect(result.writesCache).toBe(false);
  });

  it("lets a DESCRIPTIVE field replace, without interrupting anyone", () => {
    // Nobody's proposal is mispriced because the RFP said "Dubai" and the
    // surveyor said "Dubai, UAE".
    const result = acceptanceFor({
      incoming: txt("Dubai, UAE"),
      currentAccepted: { valueText: "Dubai", valueNumber: null, provenance: "rfp" },
      incomingProvenance: "survey",
      tier: "descriptive",
    });
    expect(result.outcome).toBe("replaced");
    expect(result.needsHuman).toBe(false);
    expect(result.writesCache).toBe(true);
  });

  it("defaults to the SAFE tier when a caller forgets to pass one", () => {
    const result = acceptanceFor({
      incoming: num(5200),
      currentAccepted: accepted(4500, "rfp"),
      incomingProvenance: "survey",
    });
    expect(result.outcome).toBe("conflict");
  });

  it("never lets a Facilio link win automatically, tier or no tier", () => {
    // §5.2 — an operational fact quietly overwriting our pricing input would be
    // the exact silent overwrite the ledger exists to prevent.
    const result = acceptanceFor({
      incoming: txt("Tower A"),
      currentAccepted: { valueText: "Tower 1", valueNumber: null, provenance: "survey" },
      incomingProvenance: "facilio_link",
      tier: "descriptive",
    });
    expect(result.outcome).toBe("conflict");
    expect(result.writesCache).toBe(false);
  });

  it("prices exactly the fields §6.3 lists, and nothing else", () => {
    expect([...PRICED_FIELD_KEYS].sort()).toEqual(
      [
        "area",
        "ceiling_height_band",
        "gross_floor_area",
        "max_occupancy",
        "no_of_buildings",
        "no_of_floors",
        "operation_hours_end",
        "operation_hours_start",
        "restroom_count",
        "room_count",
      ].sort()
    );
    // The address block is the case that motivated the rule.
    expect(tierFor("city")).toBe("descriptive");
    expect(tierFor("country")).toBe("descriptive");
    expect(tierFor("name")).toBe("descriptive");
    expect(tierFor("area")).toBe("priced");
  });

  it("agreement still short-circuits before the tier is consulted", () => {
    const result = acceptanceFor({
      incoming: num(4500),
      currentAccepted: accepted(4500, "rfp"),
      incomingProvenance: "survey",
      tier: "priced",
    });
    expect(result.outcome).toBe("agrees");
    expect(result.needsHuman).toBe(false);
  });
});

describe("§6.2 — one vocabulary, and no raw enum reaches a user", () => {
  it("never lets a bare enum into a sentence", () => {
    for (const p of ["rfp", "survey", "manual", "crm", "facilio_link"]) {
      expect(provenanceLabel(p)).not.toBe(p);
      expect(provenanceLabel(p)).not.toMatch(/_/);
    }
  });

  it("says 'from documents' rather than 'rfp' in a conflict message", () => {
    const result = acceptanceFor({
      incoming: num(5200),
      currentAccepted: { ...num(4500), provenance: "rfp" },
      incomingProvenance: "survey",
      tier: "priced",
    });
    expect(result.reason).toContain("from documents");
    expect(result.reason).not.toContain("rfp");
  });

  it("falls back to neutral words rather than printing null", () => {
    expect(provenanceLabel(null)).toBe("the recorded");
    expect(provenanceLabel("nonsense")).toBe("the recorded");
  });
});
