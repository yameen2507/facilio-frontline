import { describe, expect, it } from "vitest";
import {
  normalizeCode,
  PRICING_BASES,
  resolveServiceDefaults,
  UNITS_BY_BASIS,
} from "../src/domain/service-catalogue";

describe("the service code — the key every priced row points at", () => {
  it("upper-cases and trims, so one service cannot become two", () => {
    expect(normalizeCode(" kec ")).toBe("KEC");
    expect(normalizeCode("Duct")).toBe("DUCT");
  });

  it("keeps the separators a real code uses", () => {
    expect(normalizeCode("clean_routine")).toBe("CLEAN_ROUTINE");
    expect(normalizeCode("hvac-ppm")).toBe("HVAC-PPM");
  });

  it("refuses a blank, because nothing can reference one", () => {
    expect(() => normalizeCode("")).toThrow(/needs a code/);
    expect(() => normalizeCode("   ")).toThrow(/needs a code/);
    expect(() => normalizeCode(null)).toThrow(/needs a code/);
  });

  it("refuses spaces and punctuation rather than storing them", () => {
    expect(() => normalizeCode("kitchen extract")).toThrow(/not a usable service code/);
    expect(() => normalizeCode("KEC!")).toThrow(/not a usable service code/);
    // A leading separator reads as a typo far more often than as a code.
    expect(() => normalizeCode("_KEC")).toThrow(/not a usable service code/);
  });

  it("refuses a code too long to sit in another table's column comfortably", () => {
    expect(normalizeCode("A".repeat(32))).toBe("A".repeat(32));
    expect(() => normalizeCode("A".repeat(33))).toThrow(/not a usable service code/);
  });
});

describe("basis and unit — one fact, validated together", () => {
  it("has no default at all without a basis", () => {
    expect(resolveServiceDefaults(null, null)).toEqual({ basis: null, uom: null });
    // A unit with no basis is dropped, not kept: it would prefill a row whose
    // own basis may not be able to express it.
    expect(resolveServiceDefaults(null, "sq_ft")).toEqual({ basis: null, uom: null });
    expect(resolveServiceDefaults("  ", "sq_ft")).toEqual({ basis: null, uom: null });
  });

  it("fills the basis's first unit rather than leaving half a default", () => {
    expect(resolveServiceDefaults("hour", null)).toEqual({ basis: "hour", uom: "hour" });
    expect(resolveServiceDefaults("visit", "")).toEqual({ basis: "visit", uom: "per_visit" });
    expect(resolveServiceDefaults("unit", null).uom).toBe(UNITS_BY_BASIS.unit[0]);
  });

  it("keeps a unit that belongs to the basis", () => {
    expect(resolveServiceDefaults("unit", "washroom")).toEqual({
      basis: "unit",
      uom: "washroom",
    });
  });

  it("REFUSES a unit its basis cannot express", () => {
    expect(() => resolveServiceDefaults("hour", "sq_ft")).toThrow(/must be one of/);
    expect(() => resolveServiceDefaults("visit", "hour")).toThrow(/must be one of/);
  });

  it("refuses a basis outside the three", () => {
    expect(() => resolveServiceDefaults("monthly", null)).toThrow(/must be one of/);
    expect(PRICING_BASES).toEqual(["unit", "hour", "visit"]);
  });
});
