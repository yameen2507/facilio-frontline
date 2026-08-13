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

import { Link, useLocation } from "react-router-dom";
import { useCounts } from "@/app/counts";
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
} from "@/components/ui/sidebar";
import {
  DEFAULT_ROUTE,
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

function NavButton({ item, active, badge }: { item: NavItemEntry; active: boolean; badge?: number }) {
  return (
    <SidebarMenuItem>
      {/* `tooltip` is the collapsed rail's label — without it an icon-only
          item is unexplained. */}
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
  const { openLeads } = useCounts();
  const at = (path: string) => location.pathname.startsWith(path);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to={DEFAULT_ROUTE}>
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold">
                  F
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">Frontline</span>
                  <span className="text-muted-foreground truncate text-xs">Facilio</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {toGroups().map((group, i) => (
          <SidebarGroup key={group.label ?? i}>
            {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavButton
                    key={item.to}
                    item={item}
                    active={at(item.to)}
                    badge={item.badge && openLeads ? openLeads : undefined}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <NavButton item={SETTINGS_NAV} active={at(SETTINGS_NAV.to)} />
        </SidebarMenu>
      </SidebarFooter>

      {/* The grab handle on the sidebar's edge — click toggles the rail. */}
      <SidebarRail />
    </Sidebar>
  );
}
