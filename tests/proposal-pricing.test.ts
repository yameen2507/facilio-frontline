import { describe, expect, it } from "vitest";
import {
  applyMode,
  deviationPct,
  isDeltaType,
  isPricingMode,
  modeBlockers,
  resolveRateCard,
  type ResolvableCard,
} from "../src/domain/proposal-pricing";

// Money is integer minor units throughout, matching src/domain/pricing.ts.
// 10_000 minor units = 100.00 in the proposal's currency.
const CARD_PRICE = 10_000;

describe("applyMode — one mechanism with a sign", () => {
  it("standard returns the card price untouched", () => {
    expect(applyMode({ mode: "standard", cardPrice: CARD_PRICE })).toBe(10_000);
  });

  it("discount subtracts and markup adds, symmetrically", () => {
    const down = applyMode({ mode: "discount", cardPrice: CARD_PRICE, deltaType: "pct", deltaValue: 12 });
    const up = applyMode({ mode: "markup", cardPrice: CARD_PRICE, deltaType: "pct", deltaValue: 12 });
    expect(down).toBe(8_800);
    expect(up).toBe(11_200);
    // The same distance either side of the card price — one mechanism, one sign.
    expect(CARD_PRICE - (down ?? 0)).toBe((up ?? 0) - CARD_PRICE);
  });

  it("treats a signed delta as its magnitude, so the mode owns the direction", () => {
    // An estimator typing "-10" into a discount must not accidentally mark up.
    expect(applyMode({ mode: "discount", cardPrice: CARD_PRICE, deltaType: "pct", deltaValue: -10 })).toBe(9_000);
    expect(applyMode({ mode: "markup", cardPrice: CARD_PRICE, deltaType: "pct", deltaValue: -10 })).toBe(11_000);
  });

  it("applies an amount delta in minor units, not a percentage", () => {
    expect(applyMode({ mode: "discount", cardPrice: CARD_PRICE, deltaType: "amount", deltaValue: 250 })).toBe(9_750);
    expect(applyMode({ mode: "markup", cardPrice: CARD_PRICE, deltaType: "amount", deltaValue: 250 })).toBe(10_250);
  });

  it("rounds to whole minor units", () => {
    // 10_000 × 0.335 = 3_350 exactly, so use a rate that does not divide evenly.
    const applied = applyMode({ mode: "discount", cardPrice: 9_999, deltaType: "pct", deltaValue: 7.5 });
    expect(applied).toBe(9_249); // 9_999 − 749.925
    expect(Number.isInteger(applied)).toBe(true);
  });

  it("never inverts a price and hands money back", () => {
    expect(applyMode({ mode: "discount", cardPrice: CARD_PRICE, deltaType: "pct", deltaValue: 150 })).toBe(0);
    expect(applyMode({ mode: "discount", cardPrice: CARD_PRICE, deltaType: "amount", deltaValue: 99_999 })).toBe(0);
  });

  it("custom ignores the card entirely", () => {
    expect(applyMode({ mode: "custom", cardPrice: CARD_PRICE, customPrice: 42_500 })).toBe(42_500);
    // The escape hatch for rates the card deliberately does not carry.
    expect(applyMode({ mode: "custom", cardPrice: null, customPrice: 42_500 })).toBe(42_500);
  });

  it("returns null when there is nothing to price from", () => {
    expect(applyMode({ mode: "standard", cardPrice: null })).toBeNull();
    expect(applyMode({ mode: "discount", cardPrice: null, deltaType: "pct", deltaValue: 10 })).toBeNull();
    expect(applyMode({ mode: "custom", customPrice: null })).toBeNull();
  });

  it("treats a zero delta as the card price rather than corrupting it", () => {
    expect(applyMode({ mode: "discount", cardPrice: CARD_PRICE, deltaType: "pct", deltaValue: 0 })).toBe(10_000);
  });
});

describe("modeBlockers — warn, never block", () => {
  it("demands a reason for discount, markup and custom", () => {
    for (const mode of ["discount", "markup", "custom"] as const) {
      const problems = modeBlockers({ mode, cardPrice: CARD_PRICE, customPrice: 1, deltaType: "pct", deltaValue: 5 });
      expect(problems.some((p) => p.includes("reason"))).toBe(true);
    }
  });

  it("asks nothing of a standard line", () => {
    expect(modeBlockers({ mode: "standard", cardPrice: CARD_PRICE })).toEqual([]);
  });

  it("accepts a deviation once it is explained", () => {
    const problems = modeBlockers({
      mode: "discount",
      cardPrice: CARD_PRICE,
      deltaType: "pct",
      deltaValue: 12,
      deltaReason: "three-year term agreed with the client",
    });
    expect(problems).toEqual([]);
  });

  it("rejects whitespace as a reason", () => {
    const problems = modeBlockers({
      mode: "markup",
      cardPrice: CARD_PRICE,
      deltaType: "pct",
      deltaValue: 12,
      deltaReason: "   ",
    });
    expect(problems.some((p) => p.includes("reason"))).toBe(true);
  });

  it("catches a percentage that cannot be one", () => {
    const problems = modeBlockers({
      mode: "markup",
      cardPrice: CARD_PRICE,
      deltaType: "pct",
      deltaValue: 250,
      deltaReason: "lift access and overnight crew",
    });
    expect(problems.some((p) => p.includes("percentage"))).toBe(true);
  });

  it("calls a zero discount what it is", () => {
    const problems = modeBlockers({
      mode: "discount",
      cardPrice: CARD_PRICE,
      deltaType: "pct",
      deltaValue: 0,
      deltaReason: "goodwill",
    });
    expect(problems.some((p) => p.includes("standard pricing"))).toBe(true);
  });

  it("wants a price on a custom line", () => {
    const problems = modeBlockers({ mode: "custom", deltaReason: "emergency call-out", customPrice: null });
    expect(problems.some((p) => p.includes("needs a price"))).toBe(true);
  });
});

describe("deviationPct — the approval key, and it is not margin", () => {
  it("signs the deviation the way the price moved", () => {
    expect(deviationPct(10_000, 8_800)).toBeCloseTo(-12);
    expect(deviationPct(10_000, 11_200)).toBeCloseTo(12);
    expect(deviationPct(10_000, 10_000)).toBe(0);
  });

  it("returns zero rather than Infinity when there is no card price", () => {
    expect(deviationPct(null, 5_000)).toBe(0);
    expect(deviationPct(0, 5_000)).toBe(0);
    expect(deviationPct(10_000, null)).toBe(0);
  });
});

describe("resolveRateCard — most specific wins, priority breaks ties", () => {
  const ON = "2026-08-14T00:00:00Z";

  const card = (over: Partial<ResolvableCard> & { id: string }): ResolvableCard => ({
    status: "active",
    region: null,
    clientAccountId: null,
    priority: 0,
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    ...over,
  });

  const GENERAL = card({ id: "c-general", name: "Global 2026" });
  const REGIONAL = card({ id: "c-region", name: "Dubai 2026", region: "dubai" });
  const CLIENT = card({ id: "c-client", name: "Acme", clientAccountId: "acct-1" });
  const CLIENT_REGION = card({ id: "c-both", name: "Acme Dubai", region: "dubai", clientAccountId: "acct-1" });

  it("prefers the client's regional card over every less specific one", () => {
    const r = resolveRateCard([GENERAL, REGIONAL, CLIENT, CLIENT_REGION], {
      region: "dubai",
      accountId: "acct-1",
      on: ON,
    });
    expect(r?.card.id).toBe("c-both");
    expect(r?.reason).toContain("client's regional card");
  });

  it("falls back down the specificity ladder as scope narrows", () => {
    expect(resolveRateCard([GENERAL, REGIONAL, CLIENT], { region: "dubai", accountId: "acct-1", on: ON })?.card.id)
      .toBe("c-client");
    expect(resolveRateCard([GENERAL, REGIONAL], { region: "dubai", accountId: "acct-1", on: ON })?.card.id)
      .toBe("c-region");
    expect(resolveRateCard([GENERAL, REGIONAL], { region: "abu-dhabi", accountId: "acct-9", on: ON })?.card.id)
      .toBe("c-general");
  });

  it("breaks a same-specificity tie on priority, and says so", () => {
    const low = card({ id: "c-low", name: "Low", region: "dubai", priority: 1 });
    const high = card({ id: "c-high", name: "High", region: "dubai", priority: 5 });
    const r = resolveRateCard([low, high], { region: "dubai", accountId: null, on: ON });
    expect(r?.card.id).toBe("c-high");
    expect(r?.reason).toContain("priority 5");
  });

  it("excludes cards that are not active", () => {
    const draft = card({ id: "c-draft", status: "draft", region: "dubai" });
    const archived = card({ id: "c-archived", status: "archived", region: "dubai" });
    expect(resolveRateCard([draft, archived], { region: "dubai", accountId: null, on: ON })).toBeNull();
  });

  it("respects the effective window at both ends, inclusively", () => {
    const future = card({ id: "c-future", effectiveFrom: "2026-09-01T00:00:00Z" });
    const past = card({ id: "c-past", effectiveTo: "2026-07-31T00:00:00Z" });
    const boundary = card({ id: "c-boundary", effectiveFrom: ON, effectiveTo: ON });

    expect(resolveRateCard([future, past], { region: null, accountId: null, on: ON })).toBeNull();
    expect(resolveRateCard([boundary], { region: null, accountId: null, on: ON })?.card.id).toBe("c-boundary");
  });

  it("treats an open-ended effectiveTo as still in force", () => {
    expect(resolveRateCard([GENERAL], { region: null, accountId: null, on: "2099-01-01T00:00:00Z" })?.card.id)
      .toBe("c-general");
  });

  it("never lets a scoped card leak into a scope it does not cover", () => {
    // The client's card must not price another client's proposal.
    expect(resolveRateCard([CLIENT], { region: null, accountId: "acct-2", on: ON })).toBeNull();
    expect(resolveRateCard([REGIONAL], { region: "sharjah", accountId: null, on: ON })).toBeNull();
  });

  it("reads 'none' and blank as unscoped, because CSV round-trips produce both", () => {
    const seeded = card({ id: "c-seeded", region: "none", clientAccountId: "" });
    expect(resolveRateCard([seeded], { region: "dubai", accountId: "acct-1", on: ON })?.card.id).toBe("c-seeded");
  });

  it("resolves deterministically when everything else ties", () => {
    const a = card({ id: "c-aaa", region: "dubai" });
    const b = card({ id: "c-bbb", region: "dubai" });
    const forward = resolveRateCard([a, b], { region: "dubai", accountId: null, on: ON });
    const reversed = resolveRateCard([b, a], { region: "dubai", accountId: null, on: ON });
    // A price that depends on row order is a price you cannot reproduce.
    expect(forward?.card.id).toBe(reversed?.card.id);
  });

  it("returns null rather than throwing when nothing matches", () => {
    expect(resolveRateCard([], { region: "dubai", accountId: "acct-1", on: ON })).toBeNull();
  });
});

describe("type guards", () => {
  it("accepts the four modes and two delta types, and nothing else", () => {
    expect(["standard", "discount", "markup", "custom"].every(isPricingMode)).toBe(true);
    expect(isPricingMode("freebie")).toBe(false);
    expect(isDeltaType("pct") && isDeltaType("amount")).toBe(true);
    expect(isDeltaType("percent")).toBe(false);
  });
});

describe("resolveRateCard — date-only boundaries", () => {
  // A date picker sends `2026-08-14`; `ctx.on` is a full timestamp. Lexically
  // the bare date sorts BEFORE any timestamp on the same day, so an uncorrected
  // comparison drops the card on the very day its admin said it was live.
  const card = (over: Partial<ResolvableCard> & { id: string }): ResolvableCard => ({
    status: "active",
    region: null,
    clientAccountId: null,
    priority: 0,
    effectiveFrom: null,
    effectiveTo: null,
    ...over,
  });

  const MIDDAY = "2026-08-14T09:00:00.000Z";

  it("keeps a card live through the whole of its last effective day", () => {
    const c = card({ id: "c1", effectiveFrom: "2026-01-01", effectiveTo: "2026-08-14" });
    expect(resolveRateCard([c], { region: null, accountId: null, on: MIDDAY })?.card.id).toBe("c1");
  });

  it("drops it the following day", () => {
    const c = card({ id: "c1", effectiveFrom: "2026-01-01", effectiveTo: "2026-08-14" });
    expect(resolveRateCard([c], { region: null, accountId: null, on: "2026-08-15T09:00:00.000Z" })).toBeNull();
  });

  it("makes a date-only start live from that morning, not the next day", () => {
    const c = card({ id: "c1", effectiveFrom: "2026-08-14" });
    expect(resolveRateCard([c], { region: null, accountId: null, on: MIDDAY })?.card.id).toBe("c1");
    expect(resolveRateCard([c], { region: null, accountId: null, on: "2026-08-13T23:59:00.000Z" })).toBeNull();
  });

  it("still handles full timestamps unchanged", () => {
    const c = card({ id: "c1", effectiveFrom: "2026-08-14T00:00:00Z", effectiveTo: "2026-08-14T23:00:00Z" });
    expect(resolveRateCard([c], { region: null, accountId: null, on: MIDDAY })?.card.id).toBe("c1");
  });
});
