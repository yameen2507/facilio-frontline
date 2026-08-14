/**
 * Pricing: the deterministic math between a frozen survey payload and a quote.
 * Pure — no db, no fetch, no platform imports.
 *
 * Doctrine (CLAUDE.md §6): pricing has exactly one correct answer, so no model
 * is ever asked — and on this platform none could be (§3a P5: a function cannot
 * call a model). Money flows through here, so two rules hold everywhere:
 *
 *  1. A condition score never travels without its scale direction. D-e is
 *     unsettled — FM convention reads 5 as excellent, the cleaning-buildup
 *     convention is the exact inverse, and both live in this product. A rate
 *     card therefore RECORDS the direction its multipliers were authored in,
 *     and this module flips scores when the payload disagrees, rather than
 *     silently multiplying the wrong end of the scale into a contract.
 *  2. Anything this module cannot price is RETURNED as unpriced, never
 *     dropped. Incompleteness is published, not hidden (survey spec §5 rule 4).
 *
 * Vocabulary: `serviceCode` is a code from this app's service catalogue
 * (`fl_service_line.code`, written by modules/service.ts) and it is the ONLY
 * way a priced line names a service. It is nullable throughout — a custom line
 * prices something the catalogue does not carry. Nothing here validates the
 * code; that is modules/proposal.ts's job, at the database boundary where the
 * catalogue can actually be read.
 */

// --- frequency (C12: one-time + recurring lines) ------------------------------

export type Frequency =
  | "one_time"
  | "daily"
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "quarterly"
  | "annual";

/** Same vocabulary the survey lane seeds as `survey.suggested_frequencies`. */
export const FREQUENCIES: readonly Frequency[] = [
  "one_time",
  "daily",
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "annual",
];

export function isFrequency(value: unknown): value is Frequency {
  return typeof value === "string" && (FREQUENCIES as readonly string[]).includes(value);
}

/**
 * Calendar-month equivalence for recurring lines, so a weekly rate and a
 * quarterly rate can sit in one "monthly recurring" total the way the market's
 * reference proposal prices (one-time deep clean + monthly recurring). Daily
 * means calendar days; a working-days variant is a rate-card choice (price the
 * entry accordingly), not a different formula.
 */
export const OCCURRENCES_PER_MONTH: Record<Frequency, number | null> = {
  one_time: null,
  daily: 365 / 12,
  weekly: 52 / 12,
  fortnightly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
};

// --- condition (C11: rate adjusted by condition score, D-e-safe) --------------

export type ScaleDirection = "1_is_worst" | "1_is_best";

export function isScaleDirection(value: unknown): value is ScaleDirection {
  return value === "1_is_worst" || value === "1_is_best";
}

/** 2 on a 1–5 scale read the other way round is 4. */
export function flipScore(score: number, min = 1, max = 5): number {
  return max + min - score;
}

export interface ConditionAdjustment {
  multiplier: number;
  /** The score expressed in the rate card's own direction (after any flip). */
  cardScore: number | null;
  flipped: boolean;
}

/**
 * Look up the multiplier for a score against a rate card's multiplier map,
 * flipping the score first when the card and the score were authored in
 * opposite directions. No score, no map, or no entry for the score all mean
 * "no adjustment" (×1) — a missing multiplier must never zero a price.
 */
export function conditionMultiplier(
  score: number | null | undefined,
  multipliers: Record<string, number> | null | undefined,
  cardDirection: ScaleDirection,
  scoreDirection: ScaleDirection
): ConditionAdjustment {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return { multiplier: 1, cardScore: null, flipped: false };
  }

  const flipped = cardDirection !== scoreDirection;
  const cardScore = flipped ? flipScore(score) : score;
  const raw = multipliers?.[String(cardScore)];
  const multiplier = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 1;

  return { multiplier, cardScore, flipped };
}

// --- line math ----------------------------------------------------------------

/**
 * MONEY IS INTEGER MINOR UNITS, EVERYWHERE IN THIS MODULE.
 *
 * ARCHITECTURE.md §7 is a frozen contract: "integer minor units in JS,
 * numeric(14,2) in Postgres. Never a float." Conversion to major units happens
 * once, at the db boundary in `src/modules/proposal.ts` — never here, because
 * `src/domain` is pure and a second conversion site is a second rounding bug.
 *
 * Three fractional inputs flow through the same expression — `qty` (areas are
 * not integers), `conditionMultiplier` (×1.12), and `OCCURRENCES_PER_MONTH`
 * (52/12, 365/12, 1/3) — so the rounding rule has to be stated rather than
 * assumed:
 *
 *  1. Rates and prices are integer minor units. Quantities and multipliers
 *     stay fractional.
 *  2. Round EXACTLY ONCE per line, at the line boundary. Intermediate products
 *     are never rounded mid-chain: `monthlyEquivalent` is derived from the
 *     unrounded per-occurrence value, not from the rounded one.
 *  3. NEVER re-round a sum. Totals add already-rounded integer line values.
 *     Rounding per line, summing, then rounding again gives a third answer.
 */
const minor = (x: number): number => Math.round(x);

export interface LinePriceInput {
  qty: number;
  /** Integer minor units. */
  unitRate: number;
  /** From `conditionMultiplier`; defaults to no adjustment. */
  multiplier?: number;
  /**
   * Per-occurrence floor in minor units — small rooms still cost a callout.
   * Applied AFTER any pricing mode (see `proposal-pricing.ts`), so a discount
   * cannot price a job below the cost of mobilising a crew.
   */
  minCharge?: number | null;
  frequency: Frequency;
}

export interface LinePrice {
  /** qty × rate × multiplier, floored at minCharge, per occurrence. */
  perOccurrence: number;
  /** Set only for `one_time` lines. */
  oneTime: number | null;
  /** Set only for recurring lines: perOccurrence × occurrences/month. */
  monthlyEquivalent: number | null;
}

export function priceLine(input: LinePriceInput): LinePrice {
  const multiplier = input.multiplier ?? 1;
  const raw = input.qty * input.unitRate * multiplier;
  const floored =
    typeof input.minCharge === "number" && Number.isFinite(input.minCharge)
      ? Math.max(raw, input.minCharge)
      : raw;
  const perOccurrence = minor(floored);

  const perMonth = OCCURRENCES_PER_MONTH[input.frequency];
  // Note `floored`, not `perOccurrence`: rule 2. Deriving the monthly figure
  // from the already-rounded per-occurrence value compounds the error twelve
  // times a year.
  return perMonth === null
    ? { perOccurrence, oneTime: perOccurrence, monthlyEquivalent: null }
    : { perOccurrence, oneTime: null, monthlyEquivalent: minor(floored * perMonth) };
}

// --- quote totals (C10: optional lines shown, never added) ---------------------

export interface TotalableLine {
  isOptional: boolean;
  oneTime: number | null;
  monthlyEquivalent: number | null;
}

export interface QuoteTotals {
  oneTimeSubtotal: number;
  recurringMonthlySubtotal: number;
  /** The upsell menu: totalled so it can be SHOWN, excluded from the subtotals. */
  optionalOneTimeTotal: number;
  optionalRecurringMonthlyTotal: number;
}

export function quoteTotals(lines: readonly TotalableLine[]): QuoteTotals {
  const totals = { one: 0, monthly: 0, optOne: 0, optMonthly: 0 };

  for (const line of lines) {
    if (line.isOptional) {
      totals.optOne += line.oneTime ?? 0;
      totals.optMonthly += line.monthlyEquivalent ?? 0;
    } else {
      totals.one += line.oneTime ?? 0;
      totals.monthly += line.monthlyEquivalent ?? 0;
    }
  }

  // No rounding here — rule 3. Every input is already an integer minor-unit
  // line value, so the sum is exact and re-rounding could only move it.
  return {
    oneTimeSubtotal: totals.one,
    recurringMonthlySubtotal: totals.monthly,
    optionalOneTimeTotal: totals.optOne,
    optionalRecurringMonthlyTotal: totals.optMonthly,
  };
}

export interface TaxedTotals extends QuoteTotals {
  taxPct: number;
  taxOneTime: number;
  taxRecurringMonthly: number;
  totalOneTime: number;
  totalRecurringMonthly: number;
}

/** Tax applies to the committed subtotals only — optional lines are not sold yet. */
export function applyTax(totals: QuoteTotals, taxPct: number): TaxedTotals {
  const pct = Number.isFinite(taxPct) && taxPct > 0 ? taxPct : 0;
  const taxOneTime = minor((totals.oneTimeSubtotal * pct) / 100);
  const taxRecurringMonthly = minor((totals.recurringMonthlySubtotal * pct) / 100);

  // The tax figures are the only rounding point; the totals are integer sums.
  return {
    ...totals,
    taxPct: pct,
    taxOneTime,
    taxRecurringMonthly,
    totalOneTime: totals.oneTimeSubtotal + taxOneTime,
    totalRecurringMonthly: totals.recurringMonthlySubtotal + taxRecurringMonthly,
  };
}

// --- drafting from the frozen handoff payload (M2b) ----------------------------

/**
 * The slices of the survey spec's §5 payload this module reads. Keys are
 * snake_case because that is the payload's wire format — it is a frozen JSON
 * document, not a mapped DB row. Everything is optional because an estimator
 * must be able to price a partial payload; what cannot be priced is reported.
 */
export interface HandoffObservation {
  condition_score?: number | null;
  condition_scale_direction?: string | null;
  suggested_frequency?: string | null;
}

export interface HandoffNode {
  node_id: number | string;
  name?: string | null;
  observation?: HandoffObservation | null;
}

export interface HandoffEstimationValue {
  estimation_key: string;
  value: unknown;
  scope_node_id?: number | string | null;
  source_answer_id?: number | string | null;
}

export interface HandoffRecommendation {
  title?: string | null;
  /** v1.8 keeps recommendations on answers; the built tables keep them apart. */
  label?: string | null;
  value?: unknown;
  answer_role?: string | null;
  recommendation_type?: string | null;
  urgency?: string | null;
  suggested_service_id?: string | null;
  prospect_node_id?: number | string | null;
  scope_node_id?: number | string | null;
}

export interface HandoffPayload {
  survey?: { contract_intent?: string | null; not_visited_pct?: number | null } | null;
  portfolio?: HandoffNode[] | null;
  estimation_values?: HandoffEstimationValue[] | null;
  /** v1.8-shaped: answers carrying `answer_role: "recommendation"`. */
  answers?: HandoffRecommendation[] | null;
  /** Built-table-shaped: a separate recommendations array. Both are accepted. */
  recommendations?: HandoffRecommendation[] | null;
}

/** One rate card entry, as the quote lane sees it. */
export interface RateEntry {
  /** Joins §5 `estimation_values` to a price. The contract is the KEY (§5 rule 2). */
  estimationKey: string | null;
  description?: string | null;
  serviceCode?: string | null;
  uom?: string | null;
  /** `fl_rate_card_row.price` — ONE price per row, in integer minor units. */
  price: number;
  minCharge?: number | null;
  /** Keyed by score AS AUTHORED — `conditionScaleDirection` says which way. */
  conditionMultipliers?: Record<string, number> | null;
  conditionScaleDirection?: ScaleDirection;
  defaultFrequency?: Frequency;
}

export interface DraftLine {
  description: string;
  /** A catalogue code, unvalidated here — see the header. */
  serviceCode: string | null;
  estimationKey: string | null;
  scopeNodeId: string | null;
  sourceRole: "finding" | "recommendation";
  qty: number;
  uom: string | null;
  /**
   * The card's price, COPIED at creation and never looked up again — that is
   * what makes a sent proposal immune to a later rate change. Null means
   * "needs a human": the line is surfaced, not priced.
   */
  cardPrice: number | null;
  conditionScore: number | null;
  conditionMultiplier: number;
  frequency: Frequency;
  perOccurrence: number | null;
  oneTime: number | null;
  monthlyEquivalent: number | null;
  isOptional: boolean;
}

export interface DraftResult {
  lines: DraftLine[];
  /** Everything the rate card could not price. Published, never dropped. */
  unpriced: Array<{ reason: string; estimationKey?: string; label?: string }>;
  warnings: string[];
}

/**
 * The §5 payload rendered as draft quote lines — the survey→quote handoff's
 * consuming half (CLAUDE.md M2b). Deterministic: same payload + same rate card
 * = same draft, which is what lets a revised survey be re-drafted and diffed.
 *
 * Recommendations become OPTIONAL lines (C10) with no rate: the reference
 * proposal's upsell menu is shown to the customer but excluded from totals,
 * and pricing an upsell is a human decision, not a lookup. The surveyor's
 * `suggested_frequency` is likewise NOT auto-applied — the app suggests, the
 * estimator decides; the rate entry's default frequency is the formula input.
 */
export function draftLinesFromHandoff(
  payload: HandoffPayload,
  entries: readonly RateEntry[],
  opts?: { scaleDirection?: ScaleDirection }
): DraftResult {
  const lines: DraftLine[] = [];
  const unpriced: DraftResult["unpriced"] = [];
  const warnings: string[] = [];

  const byKey = new Map<string, RateEntry>();
  for (const e of entries) {
    if (e.estimationKey) byKey.set(e.estimationKey, e);
  }

  const nodes = new Map<string, HandoffNode>();
  for (const n of payload.portfolio ?? []) nodes.set(String(n.node_id), n);

  // The payload's scores travel with their direction (§5). When absent — an
  // older payload, a hand-built fixture — assume the FM convention and SAY SO.
  const payloadDirection =
    opts?.scaleDirection ??
    (payload.portfolio ?? [])
      .map((n) => n.observation?.condition_scale_direction)
      .find(isScaleDirection);
  const scoreDirection: ScaleDirection = payloadDirection ?? "1_is_worst";
  if (!payloadDirection) {
    warnings.push(
      "payload carries no condition_scale_direction — assumed 1_is_worst (D-e is unsettled; confirm before this draft prices anything)"
    );
  }

  let flippedAny = false;

  for (const ev of payload.estimation_values ?? []) {
    const entry = byKey.get(ev.estimation_key);
    if (!entry) {
      unpriced.push({
        reason: "no rate card entry for this estimation key",
        estimationKey: ev.estimation_key,
      });
      continue;
    }

    // BLANK IS NOT ZERO. `Number("")`, `Number("   ")` and `Number(null)` are
    // all 0, and 0 is finite — so without this guard an unanswered quantity
    // sails through as a zero-quantity line and prints on the client's proposal
    // as a service we have agreed to perform for nothing. An answer nobody gave
    // is missing, not free, and it belongs in `unpriced` with everything else
    // the card could not price.
    const raw = ev.value;
    const blank =
      raw === null ||
      raw === undefined ||
      (typeof raw === "string" && raw.trim() === "");

    const qty = blank ? Number.NaN : typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(qty)) {
      // The D-k failure mode arriving in the wild: a quantity that reads as
      // prose ("~4,500 sq ft") cannot silently become money.
      unpriced.push({
        reason: blank
          ? "no value was captured for this key — it cannot be priced until someone answers it"
          : `value is not a number: ${JSON.stringify(ev.value)}`,
        estimationKey: ev.estimation_key,
      });
      continue;
    }

    const scopeNodeId = ev.scope_node_id === null || ev.scope_node_id === undefined
      ? null
      : String(ev.scope_node_id);
    const node = scopeNodeId ? nodes.get(scopeNodeId) : undefined;
    const score = node?.observation?.condition_score ?? null;

    const adjustment = conditionMultiplier(
      score,
      entry.conditionMultipliers,
      entry.conditionScaleDirection ?? "1_is_worst",
      scoreDirection
    );
    flippedAny = flippedAny || adjustment.flipped;

    const frequency = entry.defaultFrequency ?? "one_time";
    const price = priceLine({
      qty,
      unitRate: entry.price,
      multiplier: adjustment.multiplier,
      minCharge: entry.minCharge,
      frequency,
    });

    const base = entry.description ?? ev.estimation_key;
    lines.push({
      description: node?.name ? `${base} — ${node.name}` : base,
      serviceCode: entry.serviceCode ?? null,
      estimationKey: ev.estimation_key,
      scopeNodeId,
      sourceRole: "finding",
      qty,
      uom: entry.uom ?? null,
      cardPrice: entry.price,
      conditionScore: score,
      conditionMultiplier: adjustment.multiplier,
      frequency,
      perOccurrence: price.perOccurrence,
      oneTime: price.oneTime,
      monthlyEquivalent: price.monthlyEquivalent,
      isOptional: false,
    });
  }

  if (flippedAny) {
    warnings.push(
      `rate card multipliers and payload scores use opposite scale directions — scores were flipped before applying multipliers (payload: ${scoreDirection})`
    );
  }

  const recommendations = [
    ...(payload.recommendations ?? []),
    ...(payload.answers ?? []).filter((a) => a.answer_role === "recommendation"),
  ];

  for (const rec of recommendations) {
    // In the answers shape the recommendation TEXT is the surveyor's value
    // ("Grease trap servicing looks overdue" — §5's own example); the label is
    // only the question wording, so it is the last resort before the fallback.
    const label =
      rec.title ??
      (typeof rec.value === "string" && rec.value.trim() ? rec.value : null) ??
      rec.label ??
      "Recommended additional service";
    const nodeId = rec.prospect_node_id ?? rec.scope_node_id;

    lines.push({
      description: label,
      // The surveyor's suggested service, which is a catalogue CODE now that
      // the app owns its services — upper-cased to match how the catalogue
      // stores it, and checked against the catalogue by the caller.
      serviceCode: rec.suggested_service_id?.trim().toUpperCase() || null,
      estimationKey: null,
      scopeNodeId: nodeId === null || nodeId === undefined ? null : String(nodeId),
      sourceRole: "recommendation",
      qty: 1,
      uom: null,
      cardPrice: null,
      conditionScore: null,
      conditionMultiplier: 1,
      frequency: "one_time",
      perOccurrence: null,
      oneTime: null,
      monthlyEquivalent: null,
      isOptional: true,
    });
    unpriced.push({ reason: "recommendation has no rate — price it by hand", label });
  }

  return { lines, unpriced, warnings };
}

// --- readiness (warn, never block) ---------------------------------------------

export interface QuoteReadinessInput {
  contractType?: string | null;
  /** C14: prints on the quote and the agreement for semi-comprehensive. */
  liabilityThresholdAmount?: number | null;
  lines: ReadonlyArray<{ cardPrice: number | null; isOptional: boolean }>;
  notVisitedPct?: number | null;
  /** Matches `survey.not_visited_warn_threshold_pct`; default 20. */
  notVisitedWarnPct?: number;
}

/**
 * What a human should see before a quote leaves the building. Warnings, never
 * blocks — the same rule the survey lane holds everywhere. AI drafts and math
 * computes, but a person sends (C8).
 */
export function quoteReadiness(input: QuoteReadinessInput): string[] {
  const warnings: string[] = [];

  if (input.lines.length === 0) {
    warnings.push("quote has no lines");
  }

  if (
    input.contractType === "semi_comprehensive" &&
    (input.liabilityThresholdAmount === null || input.liabilityThresholdAmount === undefined)
  ) {
    warnings.push(
      "semi-comprehensive contract has no liability threshold amount — it prints on the quote and the agreement (C14)"
    );
  }

  const unpricedRequired = input.lines.filter((l) => l.cardPrice === null && !l.isOptional).length;
  if (unpricedRequired > 0) {
    warnings.push(`${unpricedRequired} line(s) have no rate and count toward the total — price them first`);
  }

  const unpricedOptional = input.lines.filter((l) => l.cardPrice === null && l.isOptional).length;
  if (unpricedOptional > 0) {
    warnings.push(
      `${unpricedOptional} optional line(s) have no rate — they print on the quote but never join the total`
    );
  }

  const warnAt = input.notVisitedWarnPct ?? 20;
  if (
    typeof input.notVisitedPct === "number" &&
    Number.isFinite(input.notVisitedPct) &&
    input.notVisitedPct >= warnAt
  ) {
    warnings.push(
      `${input.notVisitedPct}% of the surveyed scope was not visited — the estimator prices with eyes open`
    );
  }

  return warnings;
}
