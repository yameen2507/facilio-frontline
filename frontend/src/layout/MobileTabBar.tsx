/**
 * The phone navigation: a bottom tab bar, and a More sheet behind its last slot.
 *
 * This REPLACES the offcanvas rail below `md`. A left drawer costs a tap and a
 * reach to the top-left corner before you can see where you might go; a tab bar
 * puts the four everyday lanes under the thumb and never hides them. The rail
 * is still the whole story on tablet and desktop — AppSidebar renders from
 * `md:` up, this from `md:` down, and 768px is both Tailwind's `md` and
 * use-mobile's breakpoint, so the two can't both be on screen.
 *
 * IN FLOW, not fixed: the bar is the last child of the shell's inset, under the
 * page's own scroll region. Nothing has to reserve room for it and no page can
 * scroll its last row underneath it. What DOES have to move are the overlays
 * that fix themselves to the viewport (the toast, a page's floating save pill)
 * — they add `--bottom-nav` to their own offset; see globals.css.
 *
 * Nav order and grouping come from nav-config, same as the rail: an item earns
 * a tab slot with `mobile: true`, everything else lands in the sheet.
 */

import { useEffect, useState } from "react";
import { LogOut, MoreHorizontal } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useUser } from "@/app/auth";
import { useCounts } from "@/app/counts";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { vibe } from "@/lib/vibe";
import { ThemeSwitcher } from "@/theme/ThemeSwitcher";
import { initials } from "./NavUser";
import {
  MOBILE_TABS,
  SETTINGS_NAV,
  navGroups,
  type NavItemEntry,
} from "./sidebar/nav-config";

/** Everything the tab bar didn't take, still in its labelled groups. */
const MORE_GROUPS = navGroups((item) => !item.mobile);

/** The unread pill over a tab's glyph. Nothing until the count is known — a
    zero would claim an empty inbox before anything has been fetched. */
function TabBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-2.5 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-medium tabular-nums">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Icon over label, the whole cell tappable. The active lane is the foreground
    colour and nothing else: a filled pill under a 5-slot bar reads as a button
    someone left pressed, and the label is already doing the naming. */
function Tab({
  to,
  icon: Icon,
  label,
  active,
  badge,
  expanded,
  onClick,
}: {
  to?: string;
  icon: NavItemEntry["icon"];
  label: string;
  /** Highlighted — you are on this lane, or on something the More sheet owns. */
  active: boolean;
  badge?: number;
  /** Whether the sheet this tab opens is showing. Separate from `active`: More
      stays highlighted while you sit on one of its routes with the sheet shut,
      and announcing that as expanded would be a lie to a screen reader. */
  expanded?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="relative flex items-center justify-center">
        <Icon className="size-5" aria-hidden="true" />
        <TabBadge count={badge} />
      </span>
      <span className="max-w-full truncate">{label}</span>
    </>
  );
  // min-w-0 on a flex-1 cell, or a long label sets the cell's min-content width
  // and the five slots stop being equal.
  const className = cn(
    "flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors",
    active ? "text-foreground" : "text-muted-foreground",
  );

  return to ? (
    <Link to={to} className={className} aria-current={active ? "page" : undefined} onClick={onClick}>
      {body}
    </Link>
  ) : (
    <button type="button" className={className} onClick={onClick} aria-haspopup="dialog" aria-expanded={expanded}>
      {body}
    </button>
  );
}

/** A destination inside the More sheet — a full-width row, not a tab. */
function SheetLink({
  item,
  active,
  badge,
  onNavigate,
}: {
  item: NavItemEntry;
  active: boolean;
  badge?: number;
  onNavigate: () => void;
}) {
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
        active ? "bg-muted text-foreground font-medium" : "text-foreground hover:bg-muted/60",
      )}
    >
      <item.icon className="size-4 shrink-0 opacity-80" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge ? <span className="text-muted-foreground text-xs tabular-nums">{badge}</span> : null}
    </Link>
  );
}

export default function MobileTabBar() {
  const { pathname } = useLocation();
  const counts = useCounts();
  const me = useUser();
  const [open, setOpen] = useState(false);

  // A route change from anywhere — a sheet link, the browser's back gesture —
  // ends the sheet's business. Without this, back leaves it hanging over the
  // page it just returned to.
  useEffect(() => setOpen(false), [pathname]);

  const at = (path: string) => pathname.startsWith(path);
  const badgeFor = (item: NavItemEntry): number | undefined => {
    const n = item.badge === "openLeads" ? counts.openLeads
      : item.badge === "pendingSurveys" ? counts.pendingSurveys
      : null;
    return n || undefined;
  };
  // The More slot lights up for anything it owns, so the bar always shows where
  // you are — otherwise Settings and the widget read as "nowhere".
  const inMore =
    open ||
    at(SETTINGS_NAV.to) ||
    MORE_GROUPS.some((g) => g.items.some((i) => at(i.to)));

  const name = me.user?.name;
  const email = me.user?.email;

  return (
    <>
      {/* h-14 is the number `--bottom-nav` repeats in globals.css; the safe-area
          pad sits OUTSIDE it so the row of targets keeps its full height above
          the home indicator instead of being squeezed by it. */}
      <nav
        className="bg-background shrink-0 border-t pb-[env(safe-area-inset-bottom,0px)] md:hidden"
        aria-label="Main"
      >
        <div className="flex h-14 items-stretch">
          {MOBILE_TABS.map((item) => (
            <Tab
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              active={at(item.to)}
              badge={badgeFor(item)}
            />
          ))}
          <Tab
            icon={MoreHorizontal}
            label="More"
            active={inMore}
            expanded={open}
            onClick={() => setOpen(true)}
          />
        </div>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        {/* Rises from the same edge the trigger sits on. Capped at 85dvh
            because this list grows every time a module ships and a sheet taller
            than the screen has no way out.

            The cap is on the FRAME and the scroll is on the list inside it, not
            both on this element: SheetContent is a flex column, and a flex
            child's `min-height: auto` means it refuses to shrink — so
            `overflow-y-auto` out here would clip the list rather than scroll
            it. The frame also keeps the safe-area pad below the scroller, where
            it belongs. */}
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] gap-0 overflow-hidden rounded-t-xl pb-[env(safe-area-inset-bottom,0px)]"
        >
          <SheetHeader className="shrink-0 pb-2">
            <SheetTitle className="text-base">More</SheetTitle>
            <SheetDescription className="sr-only">
              The rest of the navigation, settings and your account.
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            {MORE_GROUPS.map((group, i) => (
              <div key={group.label ?? i} className="flex flex-col gap-0.5">
                {group.label ? (
                  <span className="text-muted-foreground px-3 pb-1 text-xs font-medium">{group.label}</span>
                ) : null}
                {group.items.map((item) => (
                  <SheetLink
                    key={item.to}
                    item={item}
                    active={at(item.to)}
                    badge={badgeFor(item)}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </div>
            ))}

            <div className="flex flex-col gap-0.5">
              <SheetLink
                item={SETTINGS_NAV}
                active={at(SETTINGS_NAV.to)}
                onNavigate={() => setOpen(false)}
              />
            </div>

            {/* Identity, the theme control and sign out — the three things the
                rail's footer carries on desktop, in the same order. */}
            <div className="flex flex-col gap-0.5 border-t pt-4">
              <div className="flex items-center gap-3 px-3 py-1">
                <Avatar className="size-9 rounded-lg">
                  <AvatarFallback className="rounded-lg text-xs font-medium">
                    {initials(name, email)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 leading-snug">
                  <span className="truncate text-sm font-medium">{name ?? email ?? "…"}</span>
                  {email && name ? (
                    <span className="text-muted-foreground truncate text-xs">{email}</span>
                  ) : null}
                  {me.org?.orgId ? (
                    <span className="text-muted-foreground text-xs">Org {String(me.org.orgId)}</span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm">Theme</span>
                <ThemeSwitcher />
              </div>

              <button
                type="button"
                onClick={() => vibe.logout()}
                className="text-foreground hover:bg-muted/60 flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors"
              >
                <LogOut className="size-4 shrink-0 opacity-80" aria-hidden="true" />
                Sign out
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
