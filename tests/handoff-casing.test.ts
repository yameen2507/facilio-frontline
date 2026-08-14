import { describe, expect, it } from "vitest";
import { mapRow } from "../src/shared/row-map";
import { draftLinesFromHandoff, type RateEntry } from "../src/domain/pricing";

/**
 * The survey→proposal seam, tested at the JOIN rather than on either side.
 *
 * Both halves passed their own tests while the seam was broken: the payload
 * builder produced `estimationKey`, the estimator read `estimation_key`, and
 * the only fixture that crossed between them was hand-written snake_case and
 * never went through `mapRow`. This asserts the shape a REAL batched read
 * produces is the shape the estimator can price.
 */
describe("handoff payload casing — the survey→proposal seam", () => {
  const ENTRIES: RateEntry[] = [
    { estimationKey: "total_sqft", description: "General cleaning", price: 10, defaultFrequency: "monthly" },
  ];

  it("camelises inner keys of an _arr column — the behaviour that broke the seam", () => {
    const mapped = mapRow({
      estimation_values_arr: JSON.stringify([{ estimation_key: "total_sqft", value: 100, scope_node_id: 1 }]),
    });
    const values = mapped.estimationValues as Record<string, unknown>[];
    expect(values[0]).toHaveProperty("estimationKey");
    expect(values[0]).not.toHaveProperty("estimation_key");
  });

  it("cannot price a camelCase payload — proving the failure was real, not theoretical", () => {
    const camel = { estimation_values: [{ estimationKey: "total_sqft", value: 100 }] } as never;
    const draft = draftLinesFromHandoff(camel, ENTRIES);
    expect(draft.lines).toHaveLength(0);
  });

  it("prices the snake_case payload the contract specifies", () => {
    const snake = { estimation_values: [{ estimation_key: "total_sqft", value: 100 }] };
    const draft = draftLinesFromHandoff(snake, ENTRIES);
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0].cardPrice).toBe(10);
  });
});

/**
 * The VALUE side of the same seam.
 *
 * `value` arrives as text on every path — the payload builder casts
 * `value_number::text` — so the estimator coerces. The dangerous case is not
 * prose, which fails loudly; it is BLANK, because `Number("")` is 0 and 0 is
 * finite. A missing quantity would otherwise print on a client's proposal as a
 * service priced at nothing.
 *
 * This becomes live the moment a numeric answer type exists (C31): today no
 * field can produce a number, so every one of these has only ever been text.
 */
describe("estimation value coercion — blank is not zero", () => {
  const ENTRIES: RateEntry[] = [
    { estimationKey: "total_sqft", description: "General cleaning", price: 10, defaultFrequency: "one_time" },
  ];

  const priceOne = (value: unknown) =>
    draftLinesFromHandoff({ estimation_values: [{ estimation_key: "total_sqft", value }] } as never, ENTRIES);

  it("prices a numeric string, a decimal string and a real number alike", () => {
    for (const v of ["4800", "4800.00", 4800]) {
      const d = priceOne(v);
      expect(d.lines).toHaveLength(1);
      expect(d.lines[0].qty).toBe(4800);
    }
  });

  it("refuses to price a blank, whitespace or null quantity", () => {
    for (const v of ["", "   ", null, undefined]) {
      const d = priceOne(v);
      expect(d.lines).toHaveLength(0);
      expect(d.unpriced[0].reason).toContain("no value was captured");
    }
  });

  it("still reports prose as unpriceable rather than guessing", () => {
    const d = priceOne("approx 2,000 sq ft");
    expect(d.lines).toHaveLength(0);
    expect(d.unpriced[0].reason).toContain("not a number");
  });

  it("treats a thousands separator as prose, not as a quantity", () => {
    // "1,200" -> NaN. Better unpriced than silently priced as 1.
    const d = priceOne("1,200");
    expect(d.lines).toHaveLength(0);
  });
});
