/**
 * Navigation as data.
 *
 * One array drives the sidebar markup AND which entry is highlighted. Adding a
 * page means adding an entry here — not editing markup, a route table, and a
 * separate detail-page lookup that all have to agree.
 *
 * Each feature owns a path namespace (`/leads`, `/leads/:id`), which is what lets
 * the highlight be a plain first-segment comparison: a lead detail page is still
 * under `/leads`, so it lights up "Lead inbox" for free. The vanilla console had
 * `#inbox` and `#lead/<id>` as unrelated top-level routes and needed a lookup
 * table to connect them.
 *
 * Segment EQUALITY, never `startsWith` — `/accounts` starts with `/account`, so a
 * prefix test would light up two entries at once.
 *
 * `hidden` parks a surface without deleting its entry: deleting loses the work,
 * the flag records that the page exists but is not shipping yet.
 */

import type { IconName } from "../ui/Icon";

export type NavEntry =
  | { kind: "section"; label: string }
  | {
      kind: "item";
      /** First path segment, and the route it links to. */
      segment: string;
      label: string;
      glyph: IconName;
      /** Show the open-lead badge on this entry. */
      badge?: boolean;
      hidden?: boolean;
    };

export type NavItem = Extract<NavEntry, { kind: "item" }>;

export const NAV: NavEntry[] = [
  { kind: "section", label: "Leads" },
  { kind: "item", segment: "leads", label: "Lead inbox", glyph: "inbox", badge: true },
  { kind: "item", segment: "accounts", label: "Accounts", glyph: "building" },
  { kind: "item", segment: "settings", label: "Scope & SLA", glyph: "sliders" },
  { kind: "section", label: "Customer view" },
  { kind: "item", segment: "chat", label: "Website chat", glyph: "chat" },
];

export const visibleNav = (): NavEntry[] => NAV.filter((e) => e.kind === "section" || !e.hidden);

/** The first path segment: "/leads/abc" → "leads". "/" falls back to the default. */
export const segmentOf = (pathname: string): string => pathname.split("/")[1] || "leads";

/** Where "/" sends you. */
export const DEFAULT_ROUTE = "/leads";
