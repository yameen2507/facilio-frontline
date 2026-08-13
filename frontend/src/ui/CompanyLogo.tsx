/**
 * The company mark that leads every entity row: the real logo when a domain is
 * known, initials on a deterministic tint when it is not.
 *
 * The logo comes from Google's favicon service — one URL, no key, no probing —
 * and radix Avatar's image→fallback machinery means a 404, a blocked fetch or
 * a slow network all degrade to the initials tile without a broken-image flash.
 * (The Facilio icon CDN taught this codebase that remote icons fail silently;
 * here the failure mode is designed in rather than discovered.)
 *
 * Free-mail domains are refused: a lead whose contact writes from gmail.com
 * must not wear Google's logo as if it were the company's.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "mail.com",
  "gmx.com",
]);

/** The domain a logo can be looked up for — a website domain wins, an email's
    domain stands in only when it isn't a personal-mail provider. */
export function logoDomain({
  domain,
  email,
}: {
  domain?: string | null;
  email?: string | null;
}): string | undefined {
  const site = domain?.trim().toLowerCase().replace(/^www\./, "");
  if (site) return site;
  const fromEmail = email?.split("@")[1]?.trim().toLowerCase();
  if (fromEmail && !FREE_MAIL.has(fromEmail)) return fromEmail;
  return undefined;
}

/** First letters of the first two words — "Acme Facilities" → "AF". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]);
  return (letters.join("") || "?").toUpperCase();
}

/** A stable hue per name, so a company keeps its colour between visits and no
    two neighbouring rows are likely to match. Tint at low alpha over the card
    surface, so it works untouched in both themes. */
function tint(name: string): { background: string; color: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return {
    background: `hsl(${h} 65% 50% / 0.16)`,
    color: `hsl(${h} 65% 50%)`,
  };
}

export function CompanyLogo({
  name,
  domain,
  email,
  className,
}: {
  name?: string | null;
  domain?: string | null;
  email?: string | null;
  className?: string;
}) {
  const d = logoDomain({ domain, email });
  const label = name?.trim() || d || "?";
  return (
    // rounded-lg, not full: company marks are tiles, people are circles.
    <Avatar className={cn("size-8 rounded-lg border", className)}>
      {d ? (
        <AvatarImage
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`}
          alt=""
          // The service returns a grey globe for unknown domains — still a
          // truthful "we looked", so it stays. p-1.5 keeps small favicons from
          // touching the tile's edge.
          className="bg-background rounded-lg object-contain p-1.5"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : null}
      <AvatarFallback className="rounded-lg text-[11px] font-semibold" style={tint(label)}>
        {initials(label)}
      </AvatarFallback>
    </Avatar>
  );
}
