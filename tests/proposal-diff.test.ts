import { describe, expect, it } from "vitest";
import { diffProposals, totalsDelta, type DiffableLine } from "../src/domain/proposal-diff";

// Money is integer minor units throughout. Every fixture below is this line
// with one field moved, so the field under test is the only thing that could
// have produced the result.
const line = (over: Partial<DiffableLine> & { id: string }): DiffableLine => ({
  originLineId: null,
  estimationKey: null,
  description: "Daily cleaning",
  qty: 1,
  cardPrice: 10_000,
  appliedPrice: 10_000,
  lineTotal: 10_000,
  pricingMode: "standard",
  deltaReason: null,
  frequency: "monthly",
  isOptional: false,
  ...over,
});

/** The v2 copy of a v1 line: same content, new id, pointing back at its parent. */
const copyOf = (parent: DiffableLine, over: Partial<DiffableLine> = {}): DiffableLine => ({
  ...parent,
  id: `${parent.id}-v2`,
  originLineId: parent.id,
  ...over,
});

describe("what moved, line by line", () => {
  const before = line({ id: "b1" });

  it("calls a line that is only in the new revision `added`", () => {
    const added = line({ id: "b2", description: "Window cleaning", lineTotal: 4_000 });
    const diff = diffProposals([before], [copyOf(before), added]);
    const change = diff.changes.find((c) => c.description === "Window cleaning");
    expect(change?.kind).toBe("added");
    expect(change?.before).toBeNull();
    expect(change?.after).toBe(added);
    expect(change?.totalDelta).toBe(4_000);
    expect(diff.summary.added).toBe(1);
  });

  it("calls a line that is only in the old revision `removed`", () => {
    const dropped = line({ id: "b2", description: "Window cleaning", lineTotal: 4_000 });
    const diff = diffProposals([before, dropped], [copyOf(before)]);
    const change = diff.changes.find((c) => c.description === "Window cleaning");
    expect(change?.kind).toBe("removed");
    expect(change?.after).toBeNull();
    // Removing a line takes its money off the total.
    expect(change?.totalDelta).toBe(-4_000);
    expect(diff.summary.removed).toBe(1);
  });

  it("calls a changed quantity `quantity_changed`", () => {
    const diff = diffProposals([before], [copyOf(before, { qty: 3, lineTotal: 30_000 })]);
    expect(diff.changes[0].kind).toBe("quantity_changed");
    expect(diff.changes[0].changes).toContain("quantity 1 → 3");
    expect(diff.changes[0].totalDelta).toBe(20_000);
  });

  it("calls a changed rate `rate_changed`", () => {
    // Keyed off the applied unit price, not the line total — a total that moved
    // because the quantity did is not a re-price.
    const diff = diffProposals([before], [copyOf(before, { appliedPrice: 8_800, lineTotal: 8_800 })]);
    expect(diff.changes[0].kind).toBe("rate_changed");
    expect(diff.changes[0].changes).toContain("rate 10000 → 8800");
    expect(diff.changes[0].totalDelta).toBe(-1_200);
  });

  it("calls a changed pricing mode `mode_changed`, and carries the reason with it", () => {
    const diff = diffProposals(
      [before],
      [copyOf(before, { pricingMode: "discount", deltaReason: "three-year term agreed" })]
    );
    expect(diff.changes[0].kind).toBe("mode_changed");
    expect(diff.changes[0].changes).toContain("standard → discount");
    // An approver reading the diff needs to see WHY the number moved, not only
    // that it did.
    expect(diff.changes[0].changes).toContain("reason: three-year term agreed");
  });

  it("calls a changed frequency `frequency_changed`", () => {
    const diff = diffProposals([before], [copyOf(before, { frequency: "quarterly" })]);
    expect(diff.changes[0].kind).toBe("frequency_changed");
    expect(diff.changes[0].changes).toContain("monthly → quarterly");
  });

  it("calls a toggled optional flag `optional_changed`, in both directions", () => {
    const madeOptional = diffProposals([before], [copyOf(before, { isOptional: true })]);
    expect(madeOptional.changes[0].kind).toBe("optional_changed");
    expect(madeOptional.changes[0].changes).toContain("became optional");

    const optional = line({ id: "b1", isOptional: true });
    const committed = diffProposals([optional], [copyOf(optional, { isOptional: false })]);
    expect(committed.changes[0].kind).toBe("optional_changed");
    expect(committed.changes[0].changes).toContain("became a committed line");
  });

  it("calls an untouched line `unchanged`, with nothing to say about it", () => {
    const diff = diffProposals([before], [copyOf(before)]);
    expect(diff.changes[0].kind).toBe("unchanged");
    expect(diff.changes[0].changes).toEqual([]);
    expect(diff.changes[0].totalDelta).toBe(0);
    expect(diff.summary.unchanged).toBe(1);
  });

  it("reports every field that moved even though the kind names only one", () => {
    // The kind is the most significant single change, for grouping and colour;
    // `changes` carries the full story.
    const diff = diffProposals(
      [before],
      [copyOf(before, { qty: 2, appliedPrice: 9_000, frequency: "weekly", lineTotal: 18_000 })]
    );
    expect(diff.changes[0].kind).toBe("rate_changed");
    expect(diff.changes[0].changes).toEqual([
      "quantity 1 → 2",
      "rate 10000 → 9000",
      "monthly → weekly",
    ]);
  });

  it("treats a fractional quantity within tolerance as unmoved", () => {
    // Quantities are areas, so an m² recomputed from the same walk must not
    // read as a change.
    const area = line({ id: "b1", qty: 1_250.4 });
    const diff = diffProposals([area], [copyOf(area, { qty: 1_250.40001 })]);
    expect(diff.changes[0].kind).toBe("unchanged");
  });
});

describe("lines are matched by identity, not by position", () => {
  // This is the test the whole module exists for. Position-matching is what
  // makes a diff worse than no diff: one insertion at the top and every line
  // below it reads as changed, so nobody trusts the screen again.
  const v1 = [
    line({ id: "b1", description: "Daily cleaning", lineTotal: 10_000 }),
    line({ id: "b2", description: "Window cleaning", lineTotal: 4_000 }),
    line({ id: "b3", description: "Waste removal", lineTotal: 2_500 }),
    line({ id: "b4", description: "Pest control", lineTotal: 1_500 }),
  ];

  it("leaves every other line unchanged when one is inserted at the top", () => {
    const inserted = line({
      id: "new-1",
      // No origin link and no estimation key: this line has no ancestor, and
      // its description must not collide with one, or it would match on the
      // description fallback and read as unchanged.
      description: "Facade abseil",
      lineTotal: 20_000,
    });
    const v2 = [inserted, ...v1.map((l) => copyOf(l))];

    const diff = diffProposals(v1, v2);
    expect(diff.summary.added).toBe(1);
    expect(diff.summary.removed).toBe(0);
    expect(diff.summary.changed).toBe(0);
    expect(diff.summary.unchanged).toBe(4);

    // And the changes come back in the order the reader sees them on screen.
    expect(diff.changes.map((c) => c.kind)).toEqual([
      "added",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
  });

  it("leaves every line unchanged when the order is merely shuffled", () => {
    const v2 = [copyOf(v1[3]), copyOf(v1[0]), copyOf(v1[2]), copyOf(v1[1])];
    const diff = diffProposals(v1, v2);
    expect(diff.summary.unchanged).toBe(4);
    expect(diff.summary.added + diff.summary.removed + diff.summary.changed).toBe(0);
    expect(diff.headline).toBe("Nothing changed between these revisions.");
  });
});

describe("identity, best available first", () => {
  const a = line({ id: "b1", estimationKey: "k-A", description: "Daily cleaning" });
  const b = line({ id: "b2", estimationKey: "k-B", description: "Window cleaning" });

  it("prefers the explicit parent link over the estimation key", () => {
    // Deliberately contradictory: the link says A, the key says B. The link is
    // the copy's own record of what it came from, so it wins.
    const child = line({
      id: "c1",
      originLineId: "b1",
      estimationKey: "k-B",
      description: "Window cleaning",
      lineTotal: 12_000,
    });
    const diff = diffProposals([a, b], [child, copyOf(b)]);
    const matched = diff.changes.find((c) => c.after?.id === "c1");
    expect(matched?.before?.id).toBe("b1");
  });

  it("prefers the estimation key over the description", () => {
    // The key is stable across a re-walk by design; a description is the only
    // identity a user can break by editing it.
    const child = line({
      id: "c1",
      originLineId: null,
      estimationKey: "k-A",
      description: "Window cleaning",
    });
    const diff = diffProposals([a, b], [child]);
    const matched = diff.changes.find((c) => c.after?.id === "c1");
    expect(matched?.before?.id).toBe("b1");
  });

  it("falls back to the description when nothing stronger is on offer", () => {
    // Hand-added lines carry neither link nor key, and case and stray padding
    // must not split one line into an add plus a remove.
    const plain = line({ id: "p1", originLineId: null, estimationKey: null, description: "Ad-hoc jet wash" });
    const child = line({ id: "p2", originLineId: null, estimationKey: null, description: "  ad-hoc JET wash " });
    const diff = diffProposals([plain], [child]);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].kind).toBe("unchanged");
  });
});

describe("totalsDelta — committed lines only, and the two totals stay apart", () => {
  it("does not let an optional line move a total", () => {
    // An optional line has never been part of a total, so adding one is an
    // upsell shown to the client, not a price change.
    const v1 = [line({ id: "b1", frequency: "one_time", lineTotal: 10_000 })];
    const upsell = line({ id: "opt", description: "Deep clean", frequency: "one_time", lineTotal: 50_000, isOptional: true });
    const v2 = [copyOf(v1[0]), upsell];

    const diff = diffProposals(v1, v2);
    expect(diff.totals.oneTimeDelta).toBe(0);
    expect(diff.totals.recurringDelta).toBe(0);
    // The line itself is still reported as added — it is shown, just not added up.
    expect(diff.summary.added).toBe(1);
  });

  it("does not count an optional line even when it was there all along", () => {
    const lines = [
      line({ id: "b1", frequency: "one_time", lineTotal: 10_000 }),
      line({ id: "b2", frequency: "one_time", lineTotal: 99_000, isOptional: true }),
    ];
    expect(totalsDelta(lines, lines).oneTimeBefore).toBe(10_000);
  });

  it("keeps one-time and recurring money in separate buckets", () => {
    // A mobilisation fee and a monthly charge are not the same number and must
    // never be summed into one.
    const v1 = [
      line({ id: "b1", description: "Mobilisation", frequency: "one_time", lineTotal: 20_000 }),
      line({ id: "b2", description: "Daily cleaning", frequency: "monthly", lineTotal: 10_000 }),
    ];
    const v2 = [
      copyOf(v1[0], { lineTotal: 15_000 }),
      copyOf(v1[1], { lineTotal: 12_000 }),
    ];

    const totals = totalsDelta(v1, v2);
    expect(totals.oneTimeBefore).toBe(20_000);
    expect(totals.oneTimeAfter).toBe(15_000);
    expect(totals.oneTimeDelta).toBe(-5_000);
    expect(totals.recurringBefore).toBe(10_000);
    expect(totals.recurringAfter).toBe(12_000);
    expect(totals.recurringDelta).toBe(2_000);
  });

  it("treats a missing line total as zero rather than as NaN", () => {
    const v1 = [line({ id: "b1", frequency: "one_time", lineTotal: null })];
    const v2 = [copyOf(v1[0], { lineTotal: 7_500 })];
    expect(totalsDelta(v1, v2).oneTimeDelta).toBe(7_500);
  });

  it("is all zeroes for two empty revisions", () => {
    expect(totalsDelta([], [])).toEqual({
      oneTimeBefore: 0,
      oneTimeAfter: 0,
      oneTimeDelta: 0,
      recurringBefore: 0,
      recurringAfter: 0,
      recurringDelta: 0,
    });
  });
});

describe("the headline — one sentence a human can paste into an email", () => {
  it("says so plainly when nothing changed", () => {
    const v1 = [line({ id: "b1" })];
    expect(diffProposals(v1, [copyOf(v1[0])]).headline).toBe(
      "Nothing changed between these revisions."
    );
    expect(diffProposals([], []).headline).toBe("Nothing changed between these revisions.");
  });

  it("counts the moves and says which way the money went", () => {
    const v1 = [
      line({ id: "b1", description: "Mobilisation", frequency: "one_time", lineTotal: 20_000 }),
      line({ id: "b2", description: "Daily cleaning", frequency: "monthly", lineTotal: 10_000 }),
    ];
    const v2 = [
      copyOf(v1[0], { appliedPrice: 15_000, lineTotal: 15_000 }),
      copyOf(v1[1], { appliedPrice: 12_000, lineTotal: 12_000 }),
      line({ id: "new", description: "Waste removal", frequency: "one_time", lineTotal: 3_000 }),
    ];

    const headline = diffProposals(v1, v2).headline;
    expect(headline).toContain("1 added");
    expect(headline).toContain("2 repriced");
    expect(headline).toContain("one-time down 2000");
    expect(headline).toContain("recurring up 2000");
  });

  it("reports the moves without a money clause when the totals did not shift", () => {
    // Swapping one committed line for another at the same price is a real
    // change to the scope and no change to the invoice.
    const v1 = [line({ id: "b1", description: "Waste removal", frequency: "one_time", lineTotal: 3_000 })];
    const v2 = [line({ id: "n1", description: "Recycling collection", frequency: "one_time", lineTotal: 3_000 })];
    expect(diffProposals(v1, v2).headline).toBe("1 added, 1 removed.");
  });
});
