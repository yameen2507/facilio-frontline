/**
 * Normalisation for duplicate detection. Pure.
 *
 * There are no UNIQUE constraints available (ARCHITECTURE.md §3a), so dedup is a
 * lookup on these normalised values. They are stored in their own columns
 * (`email_norm`, `phone_norm`, `domain_norm`) because we match on them.
 */

export function normalizeEmail(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.includes("@")) return null;
  return trimmed;
}

/**
 * Reduce a phone number to its last 9 digits.
 *
 * Gulf numbers arrive written every possible way — `+971 50 123 4567`,
 * `00971501234567`, `0501234567`, `971-50-123-4567`. The subscriber part is the
 * stable bit, so matching on the final 9 digits makes all of those one number.
 * Shorter strings (landlines, extensions) keep whatever digits they have.
 */
export function normalizePhone(value?: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D+/g, "");
  if (digits.length < 6) return null;
  return digits.length > 9 ? digits.slice(-9) : digits;
}

/** Public email hosts must never be treated as a company identity. */
const FREE_EMAIL_HOSTS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "yandex.com",
  "mail.com",
  "gmx.com",
  "emirates.net.ae",
  "eim.ae",
]);

export function isFreeEmailHost(host: string): boolean {
  return FREE_EMAIL_HOSTS.has(host.trim().toLowerCase());
}

/**
 * Strip a domain down to `example.com`: drop scheme, credentials, `www.`, port,
 * path and trailing dot. Returns null for free email hosts, because two
 * restaurants both using gmail are not the same company.
 */
export function normalizeDomain(value?: string | null): string | null {
  if (!value) return null;

  let host = value.trim().toLowerCase();
  if (!host) return null;

  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  host = host.replace(/^[^/@]*@/, ""); // user:pass@
  host = host.split("/")[0].split("?")[0].split("#")[0];
  host = host.split(":")[0]; // port
  host = host.replace(/^www\./, "").replace(/\.$/, "");

  if (!host.includes(".") || host.includes(" ")) return null;
  if (isFreeEmailHost(host)) return null;

  return host;
}

/** Company domain from an email address, ignoring free hosts. */
export function domainFromEmail(email?: string | null): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const host = normalized.split("@")[1];
  if (!host) return null;
  return normalizeDomain(host);
}

export interface DedupKeys {
  emailNorm: string | null;
  phoneNorm: string | null;
  domainNorm: string | null;
}

/**
 * Derive all three match keys. The domain falls back to the email's host so a
 * lead with no website still contributes a company-level key.
 */
export function dedupKeys(input: {
  contactEmail?: string | null;
  contactPhone?: string | null;
  websiteDomain?: string | null;
}): DedupKeys {
  return {
    emailNorm: normalizeEmail(input.contactEmail),
    phoneNorm: normalizePhone(input.contactPhone),
    domainNorm: normalizeDomain(input.websiteDomain) ?? domainFromEmail(input.contactEmail),
  };
}

/** Collapse whitespace so "Al  Manzil " and "al manzil" compare equal. */
export function normalizeCompanyName(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase().replace(/\s+/g, " ");
  return cleaned || null;
}
