import { describe, expect, it } from "vitest";
import { reconcile, type ReconcileInput } from "../src/domain/reconcile";

const input = (over: Partial<ReconcileInput> = {}): ReconcileInput => ({
  nodes: [],
  observations: [],
  requiredAnswers: [],
  ...over,
});

describe("the rule that must not break: suggests, never decides", () => {
  it("emits no decision field on any item, of any type", () => {
    const items = reconcile(
      input({
        nodes: [
          { nodeId: "n1", name: "Tower A", provenance: "rfp", verdict: "not_found" },
          { nodeId: "n2", name: "Annexe", provenance: "survey", verdict: "added_on_site" },
        ],
        observations: [
          { nodeId: "n3", fieldKey: "room_count", value: 40, provenance: "rfp", observedBy: "bd@x.com" },
          { nodeId: "n3", fieldKey: "room_count", value: 37, provenance: "survey", observedBy: "s@x.com" },
        ],
        requiredAnswers: [
          { questionInstanceId: "q1", label: "Floor type?", isAnswered: false, isNa: false },
        ],
      })
    );

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).not.toHaveProperty("decision");
      expect(item.suggestionBasis).toBeTruthy();
    }
  });

  it("is deterministic — same input, same rows, same order", () => {
    const i = input({
      observations: [
        { nodeId: "b", fieldKey: "area_sqft", value: 100, provenance: "rfp", observedBy: "a@x.com" },
        { nodeId: "b", fieldKey: "area_sqft", value: 120, provenance: "survey", observedBy: "s@x.com" },
        { nodeId: "a", fieldKey: "name", value: "Old", provenance: "rfp", observedBy: "a@x.com" },
        { nodeId: "a", fieldKey: "name", value: "New", provenance: "survey", observedBy: "s@x.com" },
      ],
    });
    expect(JSON.stringify(reconcile(i))).toBe(JSON.stringify(reconcile(i)));
    expect(reconcile(i).map((x) => x.prospectNodeId)).toEqual(["a", "b"]);
  });
});

describe("intra_survey_conflict — two assignees, one field (F11)", () => {
  it("produces exactly one conflict row and suggests NOTHING", () => {
    const items = reconcile(
      input({
        observations: [
          { nodeId: "n1", fieldKey: "room_count", value: 12, provenance: "survey", observedBy: "amir@x.com" },
          { nodeId: "n1", fieldKey: "room_count", value: 15, provenance: "survey", observedBy: "bo@x.com" },
        ],
      })
    );

    expect(items).toHaveLength(1);
    expect(items[0].diffType).toBe("intra_survey_conflict");
    expect(items[0].suggestedValue).toBeNull();
    expect(items[0].surveyValue).toBe("12 | 15");
    expect(items[0].suggestionBasis).toMatch(/amir@x\.com and bo@x\.com/);
    expect(items[0].suggestionBasis).toMatch(/Neither is preferred/);
  });

  it("is not raised when two surveyors happen to agree", () => {
    const items = reconcile(
      input({
        observations: [
          { nodeId: "n1", fieldKey: "room_count", value: 12, provenance: "survey", observedBy: "a@x.com" },
          { nodeId: "n1", fieldKey: "room_count", value: 12, provenance: "survey", observedBy: "b@x.com" },
        ],
      })
    );
    expect(items).toHaveLength(0);
  });

  it("takes precedence over an RFP diff — the internal disagreement comes first", () => {
    const items = reconcile(
      input({
        observations: [
          { nodeId: "n1", fieldKey: "room_count", value: 40, provenance: "rfp", observedBy: "bd@x.com" },
          { nodeId: "n1", fieldKey: "room_count", value: 12, provenance: "survey", observedBy: "a@x.com" },
          { nodeId: "n1", fieldKey: "room_count", value: 15, provenance: "survey", observedBy: "b@x.com" },
        ],
      })
    );
    expect(items).toHaveLength(1);
    expect(items[0].diffType).toBe("intra_survey_conflict");
    expect(items[0].rfpValue).toBe("40");
  });
});

describe("RFP versus survey — only reachable once node-import has run", () => {
  it("finds nothing on the RFP side when nothing was seeded", () => {
    const items = reconcile(
      input({
        observations: [
          { nodeId: "n1", fieldKey: "room_count", value: 12, provenance: "survey", observedBy: "a@x.com" },
        ],
      })
    );
    expect(items).toHaveLength(0);
  });

  it("calls a numeric disagreement a count_mismatch and suggests the counted figure", () => {
    const items = reconcile(
      input({
        observations: [
          { nodeId: "n1", fieldKey: "room_count", value: 40, provenance: "rfp", observedBy: "bd@x.com" },
          { nodeId: "n1", fieldKey: "room_count", value: 37, provenance: "survey", observedBy: "s@x.com" },
        ],
      })
    );
    expect(items[0].diffType).toBe("count_mismatch");
    expect(items[0].rfpValue).toBe("40");
    expect(items[0].surveyValue).toBe("37");
    expect(items[0].suggestedValue).toBe("37");
    expect(items[0].suggestionBasis).toMatch(/measured on site/);
  });

  it("calls a non-count disagreement a value_conflict", () => {
    const items = reconcile(
      input({
        observations: [
          { nodeId: "n1", fieldKey: "space_category", value: "Office", provenance: "rfp", observedBy: "bd@x.com" },
          { nodeId: "n1", fieldKey: "space_category", value: "Warehouse", provenance: "survey", observedBy: "s@x.com" },
        ],
      })
    );
    expect(items[0].diffType).toBe("value_conflict");
    expect(items[0].suggestedValue).toBe("Warehouse");
  });

  it("stays silent when the RFP and the surveyor agree", () => {
    const items = reconcile(
      input({
        observations: [
          { nodeId: "n1", fieldKey: "area_sqft", value: 4500, provenance: "rfp", observedBy: "bd@x.com" },
          { nodeId: "n1", fieldKey: "area_sqft", value: "4500", provenance: "survey", observedBy: "s@x.com" },
        ],
      })
    );
    expect(items).toHaveLength(0);
  });
});

describe("node verdicts", () => {
  it("raises node_not_found for a seeded node the surveyor could not find", () => {
    const items = reconcile(
      input({ nodes: [{ nodeId: "n1", name: "Block C", provenance: "rfp", verdict: "not_found" }] })
    );
    expect(items[0].diffType).toBe("node_not_found");
    expect(items[0].suggestedValue).toBeNull();
    expect(items[0].suggestionBasis).toMatch(/could not find it/);
  });

  it("raises node_added for something found on site", () => {
    const items = reconcile(
      input({
        nodes: [{ nodeId: "n2", name: "Rooftop plant", provenance: "survey", verdict: "added_on_site" }],
      })
    );
    expect(items[0].diffType).toBe("node_added");
    expect(items[0].suggestedValue).toBe("Rooftop plant");
    expect(items[0].suggestionBasis).toMatch(/stood in it/);
  });

  it("says nothing about a seeded node that was simply verified", () => {
    const items = reconcile(
      input({ nodes: [{ nodeId: "n1", name: "Tower A", provenance: "rfp", verdict: "verified" }] })
    );
    expect(items).toHaveLength(0);
  });

  it("does not raise node_not_found for a node that was merely not visited", () => {
    const items = reconcile(
      input({ nodes: [{ nodeId: "n1", name: "Tower A", provenance: "rfp", verdict: "not_visited" }] })
    );
    expect(items).toHaveLength(0);
  });
});

describe("unanswered_required — a blank is not data, an is_na is", () => {
  it("raises one row per blank required question", () => {
    const items = reconcile(
      input({
        requiredAnswers: [
          { questionInstanceId: "q1", label: "Floor type?", isAnswered: false, isNa: false },
          { questionInstanceId: "q2", label: "Access?", isAnswered: true, isNa: false },
          { questionInstanceId: "q3", label: "Lift condition?", isAnswered: false, isNa: true },
        ],
      })
    );
    expect(items).toHaveLength(1);
    expect(items[0].diffType).toBe("unanswered_required");
    expect(items[0].questionInstanceId).toBe("q1");
    expect(items[0].prospectNodeId).toBeNull();
  });
});
