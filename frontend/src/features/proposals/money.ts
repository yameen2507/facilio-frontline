/**
 * Money, formatted. The proposal lane's one numeric primitive.
 *
 * MONEY CROSSES THE WIRE AS AN INTEGER IN MINOR UNITS, and this file is the only
 * place in the frontend that divides by a hundred. `src/modules/proposal.ts`
 * says the same thing from the other side: "money crosses a unit boundary here,
 * and only here". A second conversion site is a second rounding bug, and a
 * missed one is money off by a factor of a hundred.
 *
 * THE UI NEVER DOES ARITHMETIC ON A PRICE. Every subtotal, every line total and
 * every delta is computed by `domain/pricing.ts` server-side and read back — a
 * total the browser adds up is a total that disagrees with the document the
 * client holds. What this file does is turn one integer into one string.
 *
 * `numeric()` exists because of a platform quirk rather than a design choice:
 * `mapRow` coerces `numeric` columns to numbers only for the column names on
 * its list (shared/row-map.ts), and `delta_value` / `deviation_pct` are NOT on
 * it — a percentage is not money, so they never joined the money conversion.
 * They therefore arrive as a number OR as a numeric string depending on whether
 * the value came through `row_to_json` or the flat wire format. Every read of
 * those two goes through here.
 */

/**
 * Every currency this product prices in has two minor digits. When that stops
 * being true (JOD and KWD have three, JPY has none) this becomes a lookup on
 * the proposal's currency — named so the change has one obvious home. It
 * mirrors MINOR_DIGITS in `src/modules/proposal.ts`, and the two must agree.
 */
const MINOR_DIGITS = 2;
const MINOR_FACTOR = 10 ** MINOR_DIGITS;

/** ISO-4217 is three letters; anything else would make Intl throw. */
const CURRENCY_CODE = /^[A-Za-z]{3}$/;

/** A number, whatever shape the platform handed it back in. Null stays null. */
export function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Minor units → what a human reads. An absent amount is an em dash, never
 * "0.00": zero is a price somebody set, absent is a price nobody has.
 */
export function money(minor: unknown, currency: string | null | undefined = "AED"): string {
  const n = numeric(minor);
  if (n === null) return "—";

  const code = (currency ?? "AED").toUpperCase();
  const major = n / MINOR_FACTOR;

  // Intl throws a RangeError on a currency code it does not recognise, and a
  // proposal whose card carried a typo must still render its prices.
  if (!CURRENCY_CODE.test(code)) {
    return `${code} ${major.toLocaleString(undefined, {
      minimumFractionDigits: MINOR_DIGITS,
      maximumFractionDigits: MINOR_DIGITS,
    })}`;
  }

  return major.toLocaleString(undefined, {
    style: "currency",
    currency: code,
    minimumFractionDigits: MINOR_DIGITS,
    maximumFractionDigits: MINOR_DIGITS,
  });
}

/**
 * The same, with the sign spelled out — for a diff, where "+AED 1,200" and
 * "−AED 1,200" have to be told apart at a glance and a bare minus is easy to
 * miss beside a column of figures. Zero carries no sign; it did not move.
 */
export function signedMoney(minor: unknown, currency: string | null | undefined = "AED"): string {
  const n = numeric(minor);
  if (n === null) return "—";
  if (n === 0) return money(0, currency);
  return `${n > 0 ? "+" : "−"}${money(Math.abs(n), currency)}`;
}

/**
 * A percentage, signed, one decimal. Used for `deviationPct` and for a line's
 * `deltaValue` when the delta type is `pct` — see the note above on why both go
 * through `numeric()` first.
 */
export function percent(value: unknown, digits = 1): string {
  const n = numeric(value);
  if (n === null) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

/**
 * A quantity. Areas are fractional and counts are not, so trailing zeros are
 * dropped rather than padded — "1,200 sq ft", not "1,200.00 sq ft".
 */
export function qty(value: unknown): string {
  const n = numeric(value);
  if (n === null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ── The editing boundary ─────────────────────────────────────────────────────
//
// A person types MAJOR units — "123.50" — because that is what a price is to
// them. The wire takes minor. These two are the only crossing in the other
// direction, and they live here beside `money()` for the same reason: one file
// knows about the factor of a hundred, so there is one place to be wrong.

/**
 * What a human typed → the integer minor units `line-save` wants. Empty is
 * null, not zero: a cleared price field means "no price", and sending 0 would
 * quietly commit the business to giving the work away.
 */
export function parseMoney(text: string): number | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  // Grouping separators are what a person pastes back in from the page above.
  const n = Number(trimmed.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * MINOR_FACTOR);
}

/**
 * Minor units → the bare major-unit number a text input should hold. No
 * currency symbol and no grouping: both are display, and neither survives being
 * typed back in.
 */
export function moneyInput(minor: unknown): string {
  const n = numeric(minor);
  if (n === null) return "";
  return (n / MINOR_FACTOR).toFixed(MINOR_DIGITS);
}
