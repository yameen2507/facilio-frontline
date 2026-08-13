/**
 * The nav rail, on shadcn's Sidebar.
 *
 * `collapsible="icon"` replaces the hand-built 240px/48px rail: the provider
 * owns the collapse state (persisted in the `sidebar_state` cookie, toggled by
 * the topbar's SidebarTrigger and ⌘B), tooltips stand in for labels while
 * collapsed, and the whole thing becomes a Sheet on mobile — all behaviour the
 * old rail either hand-rolled (FLIP pills, hover-expand) or didn't have.
 *
 * Still data-driven from nav-config: a `section` entry starts a new labelled
 * group, so the shell keeps needing no feature imports.
 */

import { Fragment, useId } from "react";
import { PanelLeftOpen } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useCounts } from "@/app/counts";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavUser } from "./NavUser";
import {
  NAV_TOP,
  SETTINGS_NAV,
  type NavItemEntry,
} from "./sidebar/nav-config";

type Group = { label?: string; items: NavItemEntry[] };

/** Fold the flat entry list into labelled groups; group spacing is the divider. */
function toGroups(): Group[] {
  const groups: Group[] = [{ items: [] }];
  for (const entry of NAV_TOP) {
    if (entry.type === "section") groups.push({ label: entry.label, items: [] });
    else if (!entry.hidden) groups[groups.length - 1].items.push(entry);
  }
  return groups.filter((g) => g.items.length > 0);
}

/** The Frontline pinwheel, inlined so it needs no asset fetch. Drawn bare —
    no tile behind it — at 20px: a shade larger than the 16px nav icons so the
    brand row reads as the heading, CENTRED on the icon column's axis (x=24)
    rather than sharing its left edge — that centring is what lets the mark
    stay put when the rail collapses to icon width. */
function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      // The brand lime (#C4FF00) is built for dark ground and disappears on
      // the light sidebar, so light mode wears the same hue pulled down to
      // olive; dark mode keeps the true lime. currentColor lets one path
      // serve both.
      className={cn("text-[hsl(74_100%_29%)] dark:text-[#C4FF00]", className)}
    >
      <path
        d="M5.36269e-07 1.33971e-07C-0.00109738 4.24287 1.68369 8.31242 4.68376 11.3135C7.68383 14.3145 11.7534 16.0012 15.9974 16.0026L15.9974 1.33971e-07L5.36269e-07 1.33971e-07ZM15.9974 16.0026H32L32 1.33971e-07C29.8981 -0.000271818 27.8167 0.413492 25.8748 1.21765C23.9329 2.02181 22.1685 3.20061 20.6824 4.68669C19.1963 6.17278 18.0177 7.93703 17.2138 9.87865C16.4099 11.8203 15.9966 13.9012 15.9974 16.0026ZM15.9974 16.0026L15.9974 32H32C32.0001 29.8991 31.5863 27.8187 30.7821 25.8777C29.978 23.9366 28.7992 22.173 27.3132 20.6875C25.8272 19.2019 24.063 18.0236 22.1214 17.2197C20.1798 16.4159 18.0989 16.0023 15.9974 16.0026ZM15.9974 16.0026L5.36269e-07 16.0026L5.36269e-07 32C4.24324 31.9992 8.3124 30.3133 11.3124 27.3133C14.3125 24.3133 15.9977 20.2447 15.9974 16.0026Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * The brand row, which is also where the rail is collapsed and expanded — the
 * topbar that used to hold the trigger is gone, so the control lives beside
 * the name it collapses.
 *
 * Expanded: logo + name with the collapse trigger on the row's right.
 * Collapsed: the logo itself is the expand control — hovering swaps the mark
 * for an open-panel glyph so the affordance is visible before the click.
 * Mobile renders inside a Sheet that is always expanded and has its own close,
 * so it takes the expanded row without the trigger.
 */
function BrandHeader() {
  const { state, isMobile, toggleSidebar } = useSidebar();

  if (state === "collapsed" && !isMobile) {
    return (
      // h-12 matches the expanded brand row exactly, so the mark holds its
      // vertical position while the rail collapses instead of jumping up: the
      // rail forces menu buttons down to size-8, and the wrapper keeps that
      // shorter button centred in the same 48px slot the expanded row occupies.
      <div className="flex h-12 items-center justify-center">
        <SidebarMenuButton
          size="lg"
          onClick={toggleSidebar}
          tooltip="Expand sidebar"
          aria-label="Expand sidebar"
          // justify-center is required, not cosmetic: `size="lg"` overrides the
          // base `p-2` with `p-0` when collapsed, and that padding is the only
          // thing centering every other icon in the rail. Without it the mark
          // sits flush left against a column of centred icons.
          className="group/brand justify-center"
        >
          <div className="relative flex size-5 shrink-0 items-center justify-center">
            <BrandMark className="size-5 transition-opacity group-hover/brand:opacity-0" />
            <PanelLeftOpen className="absolute size-4 opacity-0 transition-opacity group-hover/brand:opacity-100" />
          </div>
        </SidebarMenuButton>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {/* A plain row, not a button: the name is a heading, and wrapping it in
          menu-button chrome offered a hover state for a target that had
          nothing to do. The only control on the row is the trigger. */}
      {/* px-1.5, not the row's usual px-2: it puts the 20px mark's centre at
          x=24 — the exact centre the collapsed rail gives it — so toggling the
          rail never moves the logo sideways, only fades the name. */}
      <div className="flex h-12 min-w-0 flex-1 items-center gap-2 px-1.5">
        <BrandMark className="size-5 shrink-0" />
        <span className="truncate text-sm font-semibold">Frontline</span>
      </div>
      {isMobile ? null : <SidebarTrigger className="shrink-0" />}
    </div>
  );
}

/**
 * The section divider: a soft sine wave, the one playful stroke in an
 * otherwise flat rail. The curve is the designer-supplied wavedivider.svg
 * (one 13.3px period of it), but re-inked for theming: the original carried a
 * hardcoded grey-to-charcoal gradient that only worked on one dark background,
 * so here the stroke is the sidebar's foreground at low opacity and the fade
 * is a CSS mask — the same left-to-right dissolve, correct in both themes.
 * A pattern rather than a stretched path keeps the humps the same shape at
 * any rail width; the collapsed rail just shows fewer of them, where the wave
 * does the hidden labels' job.
 */
function WaveDivider({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg
      // my-3: the wave needs air on both sides to read as a section break. The
      // groups' own py-1.5 alone left it crowded against the item above and the
      // section label below, so the three ran together as one list.
      className={cn(
        "text-sidebar-foreground/35 mx-2 my-3 h-[5px] shrink-0 [mask-image:linear-gradient(to_right,black,transparent)]",
        className
      )}
      aria-hidden="true"
    >
      <defs>
        <pattern id={id} width="13.34" height="5" patternUnits="userSpaceOnUse">
          <path
            d="M0 2.5C2.22 -0.17 4.45 -0.17 6.67 2.5C8.89 5.17 11.12 5.17 13.34 2.5"
            fill="none"
            stroke="currentColor"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

function NavButton({ item, active, badge }: { item: NavItemEntry; active: boolean; badge?: number }) {
  return (
    <SidebarMenuItem>
      {/* `tooltip` is the collapsed rail's label — without it an icon-only
          item is unexplained. */}
      {/* The active treatment is the stock bg-sidebar-accent wash — SUBTLE on
          purpose (an inverted primary pill was tried and shouted). What makes
          it visible is the --sidebar-accent token itself, stepped to a real
          contrast against the sidebar in globals.css rather than shadcn's
          near-invisible 1.5% default. */}
      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
        <Link to={item.to}>
          <item.icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {/* Nothing until the count is known — a zero would claim an empty inbox
          before anything has been fetched. */}
      {badge ? <SidebarMenuBadge>{badge}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  );
}

export default function AppSidebar() {
  const location = useLocation();
  const counts = useCounts();
  const at = (path: string) => location.pathname.startsWith(path);
  /** The number a nav item's badge shows, or nothing while it is unknown. */
  const badgeFor = (item: NavItemEntry): number | undefined => {
    const n = item.badge === "openLeads" ? counts.openLeads
      : item.badge === "pendingSurveys" ? counts.pendingSurveys
      : null;
    return n || undefined;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <BrandHeader />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* gap-0: the wave is the divider now, and the default gap on top of
          each group's padding was reading as dead space between sections. */}
      <SidebarContent className="gap-0">
        {toGroups().map((group, i) => (
          <Fragment key={group.label ?? i}>
            {i > 0 ? <WaveDivider /> : null}
            <SidebarGroup className="py-1.5">
              {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <NavButton
                      key={item.to}
                      item={item}
                      active={at(item.to)}
                      badge={badgeFor(item)}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </Fragment>
        ))}
      </SidebarContent>

      {/* Two lists, not one: the wave is a sibling of the menus rather than a
          child, because SidebarMenu is a <ul> and only <li> belongs inside it.
          Margins are zeroed here — the footer's own p-2 supplies the inset that
          keeps this wave in line with the ones above, and its gap-2 the room. */}
      <SidebarFooter>
        <SidebarMenu>
          <NavButton item={SETTINGS_NAV} active={at(SETTINGS_NAV.to)} />
        </SidebarMenu>
        <WaveDivider className="mx-0 my-0" />
        <SidebarMenu>
          <NavUser />
        </SidebarMenu>
      </SidebarFooter>

      {/* The grab handle on the sidebar's edge — click toggles the rail. */}
      <SidebarRail />
    </Sidebar>
  );
}
