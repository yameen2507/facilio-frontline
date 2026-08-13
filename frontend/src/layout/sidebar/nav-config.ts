/**
 * The sidebar, as data.
 *
 * Icons are lucide components, held by reference — the icon set shadcn sizes
 * its sidebar buttons around. This replaced the Facilio icon CDN pairs
 * (`icons.facilio.com`), which had to be probed per name because a wrong pair
 * 403s and renders nothing; a wrong lucide import fails the typecheck instead.
 *
 * The old `accordion` entry was dropped with the hand-built nav: nothing used
 * it. If a nested surface ever ships, the shadcn pattern is Collapsible +
 * SidebarMenuSub (`npx shadcn add collapsible`), driven from a new entry type
 * here.
 */

import {
  Building2,
  ClipboardList,
  FileText,
  Inbox,
  MessageSquare,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type NavItemEntry = {
  type: "item";
  to: string;
  icon: LucideIcon;
  label: string;
  /** Which number from the counts context this item's badge shows. */
  badge?: "openLeads" | "pendingSurveys";
  /** Parks an item without deleting its config — deleting loses the work, the
      flag records that the surface exists but is not shipping. */
  hidden?: boolean;
};

export type NavEntry =
  | NavItemEntry
  // A `section` starts a new labelled sidebar group; groups are the divider.
  | { type: "section"; label: string };

/** Where "/" sends you. */
export const DEFAULT_ROUTE = "/leads";

export const NAV_TOP: NavEntry[] = [
  // `badge` names a count from the app-level counts context, fed up by the
  // owning feature — so the sidebar still needs no feature import.
  { type: "item", to: "/leads", icon: Inbox, label: "Leads", badge: "openLeads" },
  { type: "item", to: "/accounts", icon: Building2, label: "Accounts" },
  // The survey lane. Templates sit beside surveys rather than under Settings:
  // the form builder is a platform piece other modules will consume, and an Ops
  // lead authors templates far more often than an Admin touches setup.
  { type: "section", label: "Surveys" },
  { type: "item", to: "/surveys", icon: ClipboardList, label: "Surveys", badge: "pendingSurveys" },
  { type: "item", to: "/templates", icon: FileText, label: "Templates" },
  { type: "section", label: "Customer view" },
  { type: "item", to: "/chat", icon: MessageSquare, label: "Web widget" },
];

/** Pinned to the sidebar footer, away from the modules. */
export const SETTINGS_NAV: NavItemEntry = {
  type: "item",
  to: "/settings",
  icon: SlidersHorizontal,
  label: "Scope & SLA",
};
