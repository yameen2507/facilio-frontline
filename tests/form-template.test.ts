import { describe, expect, it } from "vitest";
import {
  deriveEstimationKey,
  archiveBlocker,
  editBlocker,
  FIELD_TYPES,
  isEstimable,
  isTemplateStatus,
  LEVEL_BINDINGS,
  publishBlockers,
  publishStatusBlocker,
  TEMPLATE_STATUSES,
  UNITS,
  type PublishSection,
} from "../src/domain/form-template";

const q = (
  fieldType: string,
  options: unknown[] | null = null,
  extra: { unit?: string | null; estimationKey?: string | null } = {}
) => ({ fieldType, options, ...extra });
const section = (...questions: ReturnType<typeof q>[]): PublishSection => ({ questions });
/** A `number` needs a unit to be publishable, so the valid form is the default. */
const num = (unit: string | null = "sqft", estimationKey: string | null = null) =>
  q("number", null, { unit, estimationKey });

describe("the lifecycle: draft -> published -> archived, one-way", () => {
  it("only a draft is editable", () => {
    expect(editBlocker("draft")).toBeNull();
    expect(editBlocker("published")).toMatch(/clone/);
    expect(editBlocker("archived")).toMatch(/archived/);
  });

  it("only a draft is publishable", () => {
    expect(publishStatusBlocker("draft")).toBeNull();
    expect(publishStatusBlocker("published")).toMatch(/already/);
    expect(publishStatusBlocker("archived")).toMatch(/clone/);
  });

  it("draft and published can be archived; archived cannot again", () => {
    expect(archiveBlocker("draft")).toBeNull();
    expect(archiveBlocker("published")).toBeNull();
    expect(archiveBlocker("archived")).toMatch(/already/);
  });

  it("recognises exactly the three statuses", () => {
    for (const s of TEMPLATE_STATUSES) expect(isTemplateStatus(s)).toBe(true);
    expect(isTemplateStatus("live")).toBe(false);
    expect(isTemplateStatus(1)).toBe(false);
  });
});

describe("the publish guard — three blockers, reported together", () => {
  it("blocks an empty template on the section rule alone", () => {
    // No sections means no questions either, but piling both on is noise —
    // the frontend copy behaves the same way.
    expect(publishBlockers([])).toEqual(["Add at least one section"]);
  });

  it("blocks sections with no questions anywhere", () => {
    expect(publishBlockers([section(), section()])).toEqual(["Add at least one question"]);
  });

  it("passes when any one section carries the questions", () => {
    expect(publishBlockers([section(), section(q("short_text"))])).toEqual([]);
  });

  it("counts every thin options question, not just the first", () => {
    const blockers = publishBlockers([
      section(q("options", []), q("options", ["only one"]), q("options", ["a", "b"])),
    ]);
    expect(blockers).toEqual(["2 options question(s) need at least two choices"]);
  });

  it("treats missing options the same as an empty list", () => {
    expect(publishBlockers([section(q("options", null))])).toEqual([
      "1 options question(s) need at least two choices",
    ]);
  });

  it("ignores option counts on non-options field types", () => {
    // `number` carries its own rule (a unit), so it is exercised in its own
    // describe rather than smuggled through the options case.
    for (const t of FIELD_TYPES.filter((t) => t !== "options" && t !== "number")) {
      expect(publishBlockers([section(q(t, null))])).toEqual([]);
    }
    expect(publishBlockers([section(num())])).toEqual([]);
  });

  it("reports independent blockers together", () => {
    const blockers = publishBlockers([section(q("options", ["solo"]))]);
    // One section, one question — only the options rule fires.
    expect(blockers).toEqual(["1 options question(s) need at least two choices"]);
  });
});

describe("C31 — the number type and its unit", () => {
  it("blocks a number question with no unit", () => {
    expect(publishBlockers([section(num(null))])).toEqual(["1 number question(s) need a unit"]);
  });

  it("blocks a number question whose unit is not one of ours", () => {
    expect(publishBlockers([section(num("square feet"))])).toEqual([
      "1 number question(s) need a unit",
    ]);
  });

  it("counts every unitless number question, not just the first", () => {
    expect(publishBlockers([section(num(null), num(null), num("sqm"))])).toEqual([
      "2 number question(s) need a unit",
    ]);
  });

  it("accepts every unit on the fixed list", () => {
    for (const u of UNITS) expect(publishBlockers([section(num(u))])).toEqual([]);
  });

  it("lets a number carry an estimation key — that is the whole point", () => {
    expect(publishBlockers([section(num("sqft", "total_sqft"))])).toEqual([]);
  });
});

describe("C31 — an estimation key only sits where it can be priced", () => {
  it("blocks the F-02 shape: a key on free text", () => {
    expect(publishBlockers([section(q("short_text", null, { estimationKey: "total_sqft" }))])).toEqual(
      [
        "1 question(s) carry an estimation key on a type that cannot be priced — move it to Number or Options",
      ]
    );
  });

  it("allows a key on options", () => {
    expect(
      publishBlockers([section(q("options", ["a", "b"], { estimationKey: "condition" }))])
    ).toEqual([]);
  });

  it("treats a blank or whitespace key as no key at all", () => {
    expect(publishBlockers([section(q("short_text", null, { estimationKey: "" }))])).toEqual([]);
    expect(publishBlockers([section(q("short_text", null, { estimationKey: "   " }))])).toEqual([]);
  });

  it("reports a misplaced key alongside a unitless number, not instead of it", () => {
    const blockers = publishBlockers([
      section(num(null), q("long_text", null, { estimationKey: "notes" })),
    ]);
    expect(blockers).toHaveLength(2);
    expect(blockers).toContain("1 number question(s) need a unit");
  });

  it("agrees with isEstimable about which types qualify", () => {
    expect(FIELD_TYPES.filter(isEstimable)).toEqual(["number", "options"]);
  });
});

describe("the enum sets the reference handler serves", () => {
  it("holds five field types — `number` closed D-k per §8 C31", () => {
    expect(FIELD_TYPES).toEqual(["short_text", "long_text", "number", "options", "attachment"]);
  });

  it("holds the five units, fixed so `sqft` and `sq ft` cannot both exist", () => {
    expect(UNITS).toEqual(["sqft", "sqm", "each", "linear_m", "hours"]);
  });

  it("holds the three level bindings", () => {
    expect(LEVEL_BINDINGS).toEqual(["per_survey", "per_building", "per_space"]);
  });
});

describe("deriveEstimationKey — F-02, the key is derived, never typed", () => {
  it("slugs the question text and appends the unit", () => {
    expect(deriveEstimationKey("What is the total floor area?", "sqft")).toBe(
      "total_floor_area_sqft"
    );
  });

  it("is deterministic — same question, same key, every save", () => {
    const a = deriveEstimationKey("Number of extraction hoods", "each");
    const b = deriveEstimationKey("Number of extraction hoods", "each");
    expect(a).toBe(b);
  });

  it("drops filler words so two phrasings land on one key", () => {
    expect(deriveEstimationKey("What is the total area?", "sqm")).toBe(
      deriveEstimationKey("Total area", "sqm")
    );
  });

  it("keeps sqft and sqm apart — different priceable facts", () => {
    expect(deriveEstimationKey("Total area", "sqft")).not.toBe(
      deriveEstimationKey("Total area", "sqm")
    );
  });

  it("does not double the unit when the text already names it", () => {
    expect(deriveEstimationKey("Total sqft", "sqft")).toBe("total_sqft");
  });

  it("survives an empty label", () => {
    expect(deriveEstimationKey("", "hours")).toBe("question_hours");
    expect(deriveEstimationKey("?!", null)).toBe("question");
  });
});
