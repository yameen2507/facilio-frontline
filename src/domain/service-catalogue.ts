/**
 * The service catalogue's rules, with no database in sight.
 *
 * A service is this app's own definition of something it sells (2026-08-15 —
 * before that a "service line" was a label for a Facilio Services record id,
 * and the id was what everything referenced). Two facts about it are worth
 * keeping pure and tested, because both are load-bearing and neither is
 * obvious:
 *
 *  1. THE CODE IS THE KEY. `fl_rate_card_row.service_code` and
 *     `fl_proposal_line.service_code` name a service by code, and this database
 *     has no foreign keys to notice when one stops matching. So a code is
 *     constrained where it is minted, and it is normalised — "duct" and "DUCT"
 *     being two services is exactly the split one key exists to prevent.
 *
 *  2. BASIS AND UNIT ARE ONE FACT. `sq_ft` under an Hour basis is not a
 *     stricter version of the same service, it is a service nothing can price.
 *
 * The writer is modules/service.ts.
 */

/** Spec §3: three bases, collapsing thirteen pricing models into three. */
export const PRICING_BASES = ["unit", "hour", "visit"] as const;

export type PricingBasis = (typeof PRICING_BASES)[number];

/** The Unit master DEPENDS on the basis (roles&response §4.3). */
export const UNITS_BY_BASIS: Record<string, readonly string[]> = {
  unit: ["sq_ft", "sq_m", "washroom", "room", "person", "site", "each"],
  hour: ["hour"],
  visit: ["per_visit"],
};

/**
 * Upper case, alphanumerics with `_` and `-`, up to 32 characters, and it must
 * start with one of the two — a code is typed once and then lives in other
 * tables' columns forever, so it is worth being narrow about.
 */
const CODE_SHAPE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

/** The stored spelling of a code, or a thrown error naming what is wrong. */
export function normalizeCode(raw: unknown): string {
  const code = String(raw ?? "").trim().toUpperCase();
  if (!code) throw new Error("a service needs a code");
  if (!CODE_SHAPE.test(code)) {
    throw new Error(
      `"${code}" is not a usable service code — letters, digits, _ and - only, up to 32 characters`
    );
  }
  return code;
}

export interface ServiceDefaults {
  basis: string | null;
  uom: string | null;
}

/**
 * A service's default basis and unit, validated together.
 *
 * No basis means no default at all — a unit on its own would prefill a rate row
 * with something the row's own basis may not be able to express. A basis with
 * no unit takes the basis's first unit rather than failing: the prefill is a
 * convenience, and half of one is worse than none.
 */
export function resolveServiceDefaults(
  basis: string | null | undefined,
  uom: string | null | undefined
): ServiceDefaults {
  const b = typeof basis === "string" ? basis.trim() : basis;
  if (!b) return { basis: null, uom: null };

  if (!(PRICING_BASES as readonly string[]).includes(b)) {
    throw new Error(`default basis must be one of: ${PRICING_BASES.join(", ")}`);
  }

  const units = UNITS_BY_BASIS[b] ?? [];
  const u = typeof uom === "string" && uom.trim() ? uom.trim() : units[0];
  if (!units.includes(u)) {
    throw new Error(`the default unit for a "${b}" service must be one of: ${units.join(", ")}`);
  }
  return { basis: b, uom: u };
}
