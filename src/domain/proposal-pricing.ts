/**
 * Proposal pricing: rate-card resolution and the pricing-mode layer.
 * Pure — no db, no fetch, no platform imports.
 *
 * This is the half of the pricing model that `pricing.ts` does not carry.
 * `pricing.ts` answers "what does the card say this costs" — the estimation-key
 * join, condition multipliers, frequency math and totals. This module answers
 * the two commercial questions either side of it:
 *
 *   WHICH CARD applies to this client, in this region, today  (spec §1.2 step 2)
 *   WHAT DID WE ACTUALLY CHARGE, and why                      (spec §1.2 step 5)
 *
 * Both are lookup and arithmetic — closed problems with exactly one right
 * answer — so no model is ever asked, and on this platform none could be
 * (§3a P5: a Vibe function cannot call a model). What looks like AI here and is
 * not: card resolution, deviation checks, totals. One of them must show its
 * working, which is why `resolveRateCard` returns a reason and never just a card.
 *
 * MONEY IS INTEGER MINOR UNITS. See the rounding rule in `pricing.ts` — it is
 * stated once, there, and this module obeys it.
 */

// --- pricing modes (spec §2.2) -------------------------------------------------

export type PricingMode = "standard" | "discount" | "markup" | "custom";

export const PRICING_MODES: readonly PricingMode[] = [
  "standard",
  "discount",
  "markup",
  "custom",
];

export function isPricingMode(value: unknown): value is PricingMode {
  return typeof value === "string" && (PRICING_MODES as readonly string[]).includes(value);
}

export type DeltaType = "pct" | "amount";

export const DELTA_TYPES: readonly DeltaType[] = ["pct", "amount"];

export function isDeltaType(value: unknown): value is DeltaType {
  return value === "pct" || value === "amount";
}

/**
 * The modes that owe an explanation. A number a human moved without saying why
 * is unauditable, and structured reasons are also what would make a future
 * markup-suggestion layer worth having.
 */
const REASON_REQUIRED: readonly PricingMode[] = ["discount", "markup", "custom"];

export interface ModeInput {
  mode: PricingMode;
  deltaType?: DeltaType | null;
  deltaValue?: number | null;
  deltaReason?: string | null;
  /** Minor units. Null when the card had no row — the line is unpriced. */
  cardPrice?: number | null;
  /** Minor units. Only meaningful for `custom`. */
  customPrice?: number | null;
}

/**
 * card_price + mode + delta -> applied_price, in minor units.
 *
 * Discount and markup are ONE mechanism with a sign, not two: two code paths
 * would mean two rounding bugs and two places to get the sign wrong. Discount
 * subtracts, markup adds, and everything else about them is identical.
 *
 * `custom` ignores the card entirely — it is the escape hatch for the rates the
 * card deliberately does not carry (emergency, equipment, material), which is
 * also why it always needs approval.
 */
export function applyMode(input: ModeInput): number | null {
  const { mode } = input;

  if (mode === "custom") {
    const custom = input.customPrice;
    return typeof custom === "number" && Number.isFinite(custom) ? Math.round(custom) : null;
  }

  const card = input.cardPrice;
  if (typeof card !== "number" || !Number.isFinite(card)) return null;
  if (mode === "standard") return Math.round(card);

  const value = input.deltaValue;
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    // A discount of nothing is standard pricing wearing a label. Returning the
    // card price keeps the arithmetic honest; `modeBlockers` is what tells the
    // estimator the line is mislabelled.
    return Math.round(card);
  }

  // The sign lives here and nowhere else.
  const signed = mode === "discount" ? -Math.abs(value) : Math.abs(value);
  const delta = input.deltaType === "amount" ? signed : (card * signed) / 100;

  // A discount can legitimately reach zero; it must never invert the sign of a
  // price and hand money back.
  return Math.max(0, Math.round(card + delta));
}

/**
 * What is wrong with this line, in words an estimator can act on. Warnings, not
 * blocks — the same rule the survey lane holds everywhere. A person sends (C8).
 */
export function modeBlockers(input: ModeInput): string[] {
  const problems: string[] = [];
  const { mode } = input;

  if (!isPricingMode(mode)) {
    return [`"${String(mode)}" is not a pricing mode (${PRICING_MODES.join(", ")})`];
  }

  const hasReason = typeof input.deltaReason === "string" && input.deltaReason.trim() !== "";
  if (REASON_REQUIRED.includes(mode) && !hasReason) {
    problems.push(`a ${mode} needs a reason — it is what the approver reads`);
  }

  if (mode === "discount" || mode === "markup") {
    const value = input.deltaValue;
    if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
      problems.push(`a ${mode} of zero is standard pricing — set a value or change the mode`);
    } else if (input.deltaType === "pct" && Math.abs(value) > 100) {
      problems.push(`${Math.abs(value)}% is not a percentage of anything — check the delta type`);
    }
    if (!isDeltaType(input.deltaType ?? null)) {
      problems.push(`a ${mode} needs a delta type (pct or amount)`);
    }
  }

  if (mode === "custom") {
    const custom = input.customPrice;
    if (typeof custom !== "number" || !Number.isFinite(custom)) {
      problems.push("a custom line needs a price");
    }
  }

  return problems;
}

/**
 * How far this line moved from the card, as a signed percentage. This is what
 * the approval threshold keys off (spec §4) — NOT margin, which is invisible
 * because the rate card carries one price and no cost. Say that out loud rather
 * than implying a profitability check that cannot exist.
 */
export function deviationPct(cardPrice: number | null, appliedPrice: number | null): number {
  if (
    typeof cardPrice !== "number" ||
    typeof appliedPrice !== "number" ||
    !Number.isFinite(cardPrice) ||
    !Number.isFinite(appliedPrice) ||
    cardPrice === 0
  ) {
    return 0;
  }
  return ((appliedPrice - cardPrice) / cardPrice) * 100;
}

// --- rate card resolution (spec §1.2 step 2, §3) --------------------------------

export type CardStatus = "draft" | "active" | "archived";

export interface ResolvableCard {
  id: string;
  name?: string | null;
  status?: string | null;
  /** Null means "every region". */
  region?: string | null;
  /** Null means "every client". */
  clientAccountId?: string | null;
  priority?: number | null;
  /** ISO dates. `effectiveTo` null means open-ended. */
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface ResolveContext {
  region?: string | null;
  accountId?: string | null;
  /** ISO date to resolve as-of. Callers pass `nowIso()`; tests pass a fixture. */
  on: string;
}

export interface Resolution {
  card: ResolvableCard;
  /** Prints on the proposal. An unexplained price is an unauditable one. */
  reason: string;
}

/** Empty and whitespace both mean "not set" — CSV round-trips produce both. */
const blank = (v: string | null | undefined): boolean =>
  v === null || v === undefined || String(v).trim() === "" || v === "none";

/** A bare `YYYY-MM-DD`, as a date picker sends it. */
const dateOnly = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v.trim());

/** A date-only start means from the first instant of that day. */
const startOfDay = (v: string): string => (dateOnly(v) ? `${v.trim()}T00:00:00.000Z` : v);

/** A date-only end means through the LAST instant of that day, not its start. */
const endOfDay = (v: string): string => (dateOnly(v) ? `${v.trim()}T23:59:59.999Z` : v);

/**
 * Specificity, high to low: client+region, client, region, neither. This is the
 * order that makes a client-specific card beat the regional default, which is
 * the whole point of having both.
 */
function specificity(card: ResolvableCard): number {
  const hasClient = !blank(card.clientAccountId);
  const hasRegion = !blank(card.region);
  if (hasClient && hasRegion) return 3;
  if (hasClient) return 2;
  if (hasRegion) return 1;
  return 0;
}

const SPECIFICITY_LABEL = [
  "the general card",
  "the regional card",
  "the client's card",
  "the client's regional card",
];

/**
 * Pick the card that applies. Active, in date, region matches or is null,
 * client matches or is null; most specific wins; `priority` breaks ties.
 *
 * Returns null rather than throwing when nothing matches — an estimator with no
 * card needs to be told which of the four conditions failed, and that is the
 * caller's job to surface, not this function's to crash on.
 */
export function resolveRateCard(
  cards: readonly ResolvableCard[],
  ctx: ResolveContext
): Resolution | null {
  const eligible = cards.filter((card) => {
    if ((card.status ?? "").toLowerCase() !== "active") return false;

    // Dates are ISO-8601 UTC strings, so lexical comparison is chronological —
    // but ONLY once both sides have the same precision. A date picker sends
    // `2026-08-14` while `ctx.on` is a full timestamp, and `"2026-08-14"` sorts
    // BEFORE `"2026-08-14T09:00:00Z"` because it is a prefix. Left uncorrected,
    // a card excludes itself on its own last effective day — the card is live
    // right up until the morning of the date the admin typed, then silently
    // is not. `endOfDay` is what makes "effective to the 14th" mean the 14th.
    if (!blank(card.effectiveFrom) && startOfDay(String(card.effectiveFrom)) > ctx.on) return false;
    if (!blank(card.effectiveTo) && endOfDay(String(card.effectiveTo)) < ctx.on) return false;

    // Null on the card means "applies to all", so only a PRESENT value has to
    // match. A card scoped to a region we did not ask about is not eligible.
    if (!blank(card.region) && card.region !== ctx.region) return false;
    if (!blank(card.clientAccountId) && card.clientAccountId !== ctx.accountId) return false;

    return true;
  });

  if (eligible.length === 0) return null;

  const ranked = [...eligible].sort((a, b) => {
    const bySpecificity = specificity(b) - specificity(a);
    if (bySpecificity !== 0) return bySpecificity;

    const byPriority = (b.priority ?? 0) - (a.priority ?? 0);
    if (byPriority !== 0) return byPriority;

    // Last resort: the id, so the same inputs always resolve the same way. A
    // resolution that depends on row order is a resolution you cannot reproduce.
    return String(a.id).localeCompare(String(b.id));
  });

  const card = ranked[0];
  const label = SPECIFICITY_LABEL[specificity(card)];
  const tied = eligible.filter((c) => specificity(c) === specificity(card)).length > 1;

  const reason = tied
    ? `${label} "${card.name ?? card.id}" — ${eligible.length} cards applied, priority ${card.priority ?? 0} won`
    : `${label} "${card.name ?? card.id}" — the most specific of ${eligible.length} active`;

  return { card, reason };
}
