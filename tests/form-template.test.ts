import { describe, expect, it } from "vitest";
import {
  archiveBlocker,
  editBlocker,
  FIELD_TYPES,
  isTemplateStatus,
  LEVEL_BINDINGS,
  publishBlockers,
  publishStatusBlocker,
  TEMPLATE_STATUSES,
  type PublishSection,
} from "../src/domain/form-template";

const q = (fieldType: string, options: unknown[] | null = null) => ({ fieldType, options });
const section = (...questions: ReturnType<typeof q>[]): PublishSection => ({ questions });

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
    for (const t of FIELD_TYPES.filter((t) => t !== "options")) {
      expect(publishBlockers([section(q(t, null))])).toEqual([]);
    }
  });

  it("reports independent blockers together", () => {
    const blockers = publishBlockers([section(q("options", ["solo"]))]);
    // One section, one question — only the options rule fires.
    expect(blockers).toEqual(["1 options question(s) need at least two choices"]);
  });
});

describe("the enum sets the reference handler serves", () => {
  it("holds P1's four field types — `number` awaits D-k", () => {
    expect(FIELD_TYPES).toEqual(["short_text", "long_text", "options", "attachment"]);
  });

  it("holds the three level bindings", () => {
    expect(LEVEL_BINDINGS).toEqual(["per_survey", "per_building", "per_space"]);
  });
});
