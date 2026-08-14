/**
 * Display formatting. Pure, so it is the cheapest thing in the app to test.
 */

/** "3m ago" / "2h ago" / "5d ago". Empty string for a missing timestamp. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Absolute date and time, short form: "3 Aug, 14:20". */
export const when = (at: string | null | undefined): string =>
  at ? new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

/** Date alone, for deadlines that carry no time of day: "13 Sep". */
export const onDay = (at: string | null | undefined): string =>
  at ? new Date(at).toLocaleDateString([], { day: "numeric", month: "short" }) : "—";

/** Minor-unit-free money for display only; the domain does the real maths. */
export const money = (value: number | string | null | undefined, currency = "AED"): string =>
  value === null || value === undefined || value === "" ? "—" : `${currency} ${Number(value).toLocaleString()}`;

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** How each recurring frequency reads after an amount. */
const FREQ_SUFFIX: Record<string, string> = {
  monthly: "/mo",
  quarterly: "/qtr",
  annual: "/yr",
};

/**
 * D-05 money: the amount plus what KIND of amount it is. "AED 12,000/mo" and
 * "AED 12,000 one-off" must never read the same — that ambiguity is the whole
 * defect. An untyped value (rows that predate the field) prints as plain money,
 * claiming nothing it does not know.
 */
export const typedMoney = (
  value: number | string | null | undefined,
  currency = "AED",
  valueType?: string | null,
  valueFrequency?: string | null
): string => {
  const base = money(value, currency);
  if (base === "—" || !valueType) return base;
  const suffix = valueFrequency ? (FREQ_SUFFIX[valueFrequency] ?? `/${valueFrequency}`) : "";
  if (valueType === "recurring") return `${base}${suffix}`;
  if (valueType === "both") return `${base} one-off + recurring${suffix}`;
  return `${base} one-off`;
};

/** "in_review" → "in review". Statuses arrive snake_cased from the database. */
export const humanise = (s: string | null | undefined): string => String(s ?? "").replace(/_/g, " ");

/**
 * X-15: an address line that never stutters. City and region are separate
 * facts that are often the same word (Dubai, Dubai), so repeats are dropped
 * case-insensitively while the first spelling is kept.
 */
export const placeLine = (...parts: Array<string | null | undefined>): string => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = (p ?? "").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.join(", ");
};

/** Minutes remaining as the shortest readable unit: "45m" / "3h". */
export const shortDuration = (mins: number): string => (mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`);
