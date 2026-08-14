/**
 * The Settings area's side navigation — grouped vertical entries, the way
 * incident.io and Vanta panel their settings (the Mobbin reference direction).
 * Data-driven so a future group or row (Organization is expected) is one entry
 * here, and every route deep-links and survives a reload.
 *
 * The same component serves both widths: a fixed left rail from `md` up (the
 * layout scrolls only the section beside it), a horizontally scrollable row
 * above the content below it — group labels step aside there, where four items
 * name themselves.
 */

import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    label: "Services",
    items: [
      { to: "/settings", label: "Service coverage" },
      { to: "/settings/service-links", label: "Service links" },
    ],
  },
  {
    label: "Pricing",
    items: [{ to: "/settings/rate-cards", label: "Rate cards" }],
  },
  {
    label: "Users & access",
    items: [
      { to: "/settings/users", label: "Users" },
      { to: "/settings/roles", label: "Roles" },
      { to: "/settings/permissions", label: "Permissions" },
    ],
  },
];

export function SettingsNav() {
  const { pathname } = useLocation();
  // Exact match is enough: settings routes have no children of their own, and
  // startsWith would light Service coverage for every sibling ("/settings" prefixes all).
  const isActive = (to: string) => pathname === to;

  return (
    <nav
      aria-label="Settings sections"
      className="flex gap-1 overflow-x-auto [scrollbar-width:none] max-md:-mx-1 max-md:px-1 md:flex-col md:gap-4 md:overflow-visible [&::-webkit-scrollbar]:hidden"
    >
      {GROUPS.map((group) => (
        <div key={group.label} className="flex gap-1 md:flex-col">
          {/* SectionTitle's idiom, local because SectionTitle carries an mt-4
              meant for card bodies. Hidden on the phone row — four items name
              themselves, and two headings would double the row's width. */}
          <div className="text-muted-foreground mb-1 px-2.5 text-[10px] font-medium tracking-[0.06em] uppercase max-md:hidden">
            {group.label}
          </div>
          {group.items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={isActive(item.to) ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
                isActive(item.to)
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
