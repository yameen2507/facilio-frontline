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

/** "in_review" → "in review". Statuses arrive snake_cased from the database. */
export const humanise = (s: string | null | undefined): string => String(s ?? "").replace(/_/g, " ");

/** Minutes remaining as the shortest readable unit: "45m" / "3h". */
export const shortDuration = (mins: number): string => (mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`);
