import { describe, expect, it } from "vitest";
import {
  applyTax,
  conditionMultiplier,
  draftLinesFromHandoff,
  flipScore,
  OCCURRENCES_PER_MONTH,
  priceLine,
  quoteReadiness,
  quoteTotals,
  type HandoffPayload,
  type RateEntry,
} from "../src/domain/pricing";
import { upsertJsonKey } from "../src/shared/row-map";

describe("frequency math", () => {
  it("one_time has no monthly equivalence", () => {
    expect(OCCURRENCES_PER_MONTH.one_time).toBeNull();
  });

  it("recurring frequencies annualise consistently", () => {
    // 12 × the monthly factor must equal occurrences per year.
    expect(12 * (OCCURRENCES_PER_MONTH.weekly as number)).toBeCloseTo(52);
    expect(12 * (OCCURRENCES_PER_MONTH.fortnightly as number)).toBeCloseTo(26);
    expect(12 * (OCCURRENCES_PER_MONTH.quarterly as number)).toBeCloseTo(4);
    expect(12 * (OCCURRENCES_PER_MONTH.annual as number)).toBeCloseTo(1);
  });
});

describe("conditionMultiplier — D-e-safe (C11)", () => {
  const multipliers = { "1": 1.5, "2": 1.25, "3": 1, "4": 0.9, "5": 0.85 };

  it("applies directly when card and score agree on direction", () => {
    const adj = conditionMultiplier(2, multipliers, "1_is_worst", "1_is_worst");
    expect(adj).toEqual({ multiplier: 1.25, cardScore: 2, flipped: false });
  });

  it("flips the score when the directions disagree", () => {
    // Score 2 under 1_is_best is score 4 under the card's 1_is_worst.
    const adj = conditionMultiplier(2, multipliers, "1_is_worst", "1_is_best");
    expect(adj).toEqual({ multiplier: 0.9, cardScore: 4, flipped: true });
  });

  it("no score, no map, or no entry all mean no adjustment", () => {
    expect(conditionMultiplier(null, multipliers, "1_is_worst", "1_is_worst").multiplier).toBe(1);
    expect(conditionMultiplier(3, null, "1_is_worst", "1_is_worst").multiplier).toBe(1);
    expect(conditionMultiplier(7, multipliers, "1_is_worst", "1_is_worst").multiplier).toBe(1);
  });

  it("a zero or negative multiplier never zeroes a price", () => {
    expect(conditionMultiplier(1, { "1": 0 }, "1_is_worst", "1_is_worst").multiplier).toBe(1);
    expect(conditionMultiplier(1, { "1": -2 }, "1_is_worst", "1_is_worst").multiplier).toBe(1);
  });

  it("flipScore is its own inverse on a 1-5 scale", () => {
    for (const s of [1, 2, 3, 4, 5]) expect(flipScore(flipScore(s))).toBe(s);
  });
});

describe("priceLine", () => {
  it("prices a one-time line into the one-time bucket only", () => {
    const p = priceLine({ qty: 4500, unitRate: 80, multiplier: 1.25, frequency: "one_time" });
    expect(p.perOccurrence).toBe(450_000);
    expect(p.oneTime).toBe(450_000);
    expect(p.monthlyEquivalent).toBeNull();
  });

  it("converts a recurring line to its monthly equivalent", () => {
    const p = priceLine({ qty: 1, unitRate: 30_000, frequency: "weekly" });
    expect(p.oneTime).toBeNull();
    expect(p.monthlyEquivalent).toBe(130_000); // 30_000 × 52/12
  });

  it("applies the per-occurrence minimum charge", () => {
    const p = priceLine({ qty: 10, unitRate: 100, minCharge: 15_000, frequency: "monthly" });
    expect(p.perOccurrence).toBe(15_000);
    expect(p.monthlyEquivalent).toBe(15_000);
  });

  it("rounds to whole minor units, once, at the line boundary", () => {
    // 100 × 52/12 = 433.33… — a weekly rate never divides evenly into a month.
    const p = priceLine({ qty: 1, unitRate: 100, frequency: "weekly" });
    expect(p.monthlyEquivalent).toBe(433);
    expect(Number.isInteger(p.monthlyEquivalent)).toBe(true);
  });

  it("derives the monthly figure from the unrounded per-occurrence value", () => {
    // qty × rate = 333.33…  Rounding that to 333 FIRST and then multiplying by
    // 52/12 gives 1443; carrying the unrounded value through gives 1444. The
    // second is correct, and the difference compounds every month.
    const p = priceLine({ qty: 3.3333, unitRate: 100, frequency: "weekly" });
    expect(p.perOccurrence).toBe(333);
    expect(p.monthlyEquivalent).toBe(1444);
  });
});

describe("quoteTotals — optional shown, never added (C10)", () => {
  it("keeps optional lines out of the subtotals but still totals them", () => {
    const totals = quoteTotals([
      { isOptional: false, oneTime: 5040, monthlyEquivalent: null },
      { isOptional: false, oneTime: null, monthlyEquivalent: 1260 },
      { isOptional: true, oneTime: 900, monthlyEquivalent: null },
      { isOptional: true, oneTime: null, monthlyEquivalent: 200 },
    ]);
    expect(totals).toEqual({
      oneTimeSubtotal: 5040,
      recurringMonthlySubtotal: 1260,
      optionalOneTimeTotal: 900,
      optionalRecurringMonthlyTotal: 200,
    });
  });

  it("taxes only the committed subtotals", () => {
    const taxed = applyTax(
      quoteTotals([
        { isOptional: false, oneTime: 1000, monthlyEquivalent: 100 },
        { isOptional: true, oneTime: 500, monthlyEquivalent: null },
      ]),
      5
    );
    expect(taxed.taxOneTime).toBe(50);
    expect(taxed.totalOneTime).toBe(1050);
    expect(taxed.taxRecurringMonthly).toBe(5);
    expect(taxed.totalRecurringMonthly).toBe(105);
    // The optional bucket is untouched by tax.
    expect(taxed.optionalOneTimeTotal).toBe(500);
  });
});

// --- drafting from the §5 payload (M2b) ---------------------------------------

const RATE_ENTRIES: RateEntry[] = [
  {
    estimationKey: "total_sqft",
    description: "General cleaning",
    serviceCode: "GC",
    facilioServiceId: null,
    uom: "sqft",
    price: 10,
    conditionMultipliers: { "1": 1.5, "2": 1.25, "3": 1, "4": 0.9, "5": 0.85 },
    conditionScaleDirection: "1_is_worst",
    defaultFrequency: "monthly",
  },
  {
    estimationKey: "restroom_count",
    description: "Restroom deep clean",
    serviceCode: "RDC",
    price: 12_000,
    defaultFrequency: "one_time",
  },
];

const PAYLOAD: HandoffPayload = {
  survey: { contract_intent: "semi_comprehensive", not_visited_pct: 6 },
  portfolio: [
    {
      node_id: 9037,
      name: "Room 204",
      observation: { condition_score: 2, condition_scale_direction: "1_is_worst" },
    },
  ],
  estimation_values: [
    { estimation_key: "total_sqft", value: 4800, scope_node_id: 9037 },
    { estimation_key: "restroom_count", value: 6, scope_node_id: null },
    { estimation_key: "window_panes", value: 40, scope_node_id: null },
    { estimation_key: "total_acreage", value: "~2 acres", scope_node_id: null },
  ],
  recommendations: [
    { title: "Grease trap servicing", recommendation_type: "upsell", suggested_service_id: null },
  ],
};

describe("draftLinesFromHandoff (M2b)", () => {
  const draft = draftLinesFromHandoff(PAYLOAD, RATE_ENTRIES);

  it("prices matched keys, using the space's condition score", () => {
    const line = draft.lines.find((l) => l.estimationKey === "total_sqft");
    expect(line?.description).toBe("General cleaning — Room 204");
    expect(line?.conditionScore).toBe(2);
    expect(line?.conditionMultiplier).toBe(1.25);
    expect(line?.monthlyEquivalent).toBe(60_000); // 4800 × 10 × 1.25, monthly
    expect(line?.isOptional).toBe(false);
  });

  it("prices an unscoped value with no condition adjustment", () => {
    const line = draft.lines.find((l) => l.estimationKey === "restroom_count");
    expect(line?.conditionMultiplier).toBe(1);
    expect(line?.oneTime).toBe(72_000);
  });

  it("returns unmatched keys and non-numeric values as unpriced, never drops them", () => {
    const reasons = draft.unpriced.map((u) => u.estimationKey ?? u.label);
    expect(reasons).toContain("window_panes");
    expect(reasons).toContain("total_acreage");
  });

  it("turns recommendations into unpriced OPTIONAL lines (C10)", () => {
    const rec = draft.lines.find((l) => l.sourceRole === "recommendation");
    expect(rec?.isOptional).toBe(true);
    expect(rec?.cardPrice).toBeNull();
    expect(rec?.description).toBe("Grease trap servicing");
  });

  it("accepts the v1.8 answers-with-answer_role shape too", () => {
    const alt = draftLinesFromHandoff(
      {
        answers: [
          { label: "Quote separately?", value: "Pressure wash loading dock", answer_role: "recommendation" },
          { label: "Floor type", value: "vinyl", answer_role: "finding" },
        ],
      },
      []
    );
    expect(alt.lines).toHaveLength(1);
    expect(alt.lines[0].description).toBe("Pressure wash loading dock");
  });

  it("flips scores and says so when card and payload disagree on direction", () => {
    const flippedEntries: RateEntry[] = [
      { ...RATE_ENTRIES[0], conditionScaleDirection: "1_is_best" },
    ];
    const flipped = draftLinesFromHandoff(PAYLOAD, flippedEntries);
    const line = flipped.lines.find((l) => l.estimationKey === "total_sqft");
    // Payload score 2 (1_is_worst) reads as 4 on a 1_is_best card.
    expect(line?.conditionMultiplier).toBe(0.9);
    expect(flipped.warnings.some((w) => w.includes("opposite scale directions"))).toBe(true);
  });

  it("warns rather than guessing silently when the payload has no direction", () => {
    const bare = draftLinesFromHandoff(
      { estimation_values: [{ estimation_key: "total_sqft", value: 100 }] },
      RATE_ENTRIES
    );
    expect(bare.warnings.some((w) => w.includes("assumed 1_is_worst"))).toBe(true);
  });
});

describe("quoteReadiness — warn, never block", () => {
  it("flags a semi-comp quote missing its liability threshold (C14)", () => {
    const warnings = quoteReadiness({
      contractType: "semi_comprehensive",
      liabilityThresholdAmount: null,
      lines: [{ cardPrice: 1_000, isOptional: false }],
    });
    expect(warnings.some((w) => w.includes("liability threshold"))).toBe(true);
  });

  it("stays quiet when the threshold is set", () => {
    const warnings = quoteReadiness({
      contractType: "semi_comprehensive",
      liabilityThresholdAmount: 500,
      lines: [{ cardPrice: 1_000, isOptional: false }],
    });
    expect(warnings).toEqual([]);
  });

  it("counts unpriced required and optional lines separately", () => {
    const warnings = quoteReadiness({
      lines: [
        { cardPrice: null, isOptional: false },
        { cardPrice: null, isOptional: true },
        { cardPrice: 500, isOptional: false },
      ],
    });
    expect(warnings.some((w) => w.includes("count toward the total"))).toBe(true);
    expect(warnings.some((w) => w.includes("never join the total"))).toBe(true);
  });

  it("surfaces high not-visited share at the default threshold", () => {
    const lines = [{ cardPrice: 1_000, isOptional: false }];
    expect(quoteReadiness({ lines, notVisitedPct: 25 }).some((w) => w.includes("not visited"))).toBe(true);
    expect(quoteReadiness({ lines, notVisitedPct: 6 })).toEqual([]);
  });
});

describe("upsertJsonKey — the data_json overflow write", () => {
  it("sets a key while preserving neighbours", () => {
    expect(upsertJsonKey('{"other":"kept"}', "facilio_service_id", "8123")).toBe(
      '{"other":"kept","facilio_service_id":"8123"}'
    );
  });

  it("null removes the key; empty and malformed blobs are replaced", () => {
    expect(upsertJsonKey('{"facilio_service_id":"8123"}', "facilio_service_id", null)).toBe("{}");
    expect(upsertJsonKey("", "k", "v")).toBe('{"k":"v"}');
    expect(upsertJsonKey("not json", "k", "v")).toBe('{"k":"v"}');
  });

  it("accepts an already-parsed object, whatever type the column inferred", () => {
    expect(upsertJsonKey({ other: 1 }, "k", "v")).toBe('{"other":1,"k":"v"}');
  });
});
