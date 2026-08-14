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
  Bot,
  Building2,
  ClipboardList,
  Handshake,
  Landmark,
  FileSignature,
  FileText,
  Inbox,
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
  /** Gives this item one of the phone tab bar's slots. There are five and the
      last is "More", so FOUR items can carry it — everything unflagged falls
      into the More sheet, which is a real destination, not a leftovers bin. */
  mobile?: boolean;
  /** Parks an item without deleting its config — deleting loses the work, the
      flag records that the surface exists but is not shipping. */
  hidden?: boolean;
};

export type NavEntry =
  | NavItemEntry
  // A `section` starts a new sidebar group; groups are the divider. The label
  // is optional: a group whose one item already names itself (Intake agent)
  // would just repeat that name as a heading.
  | { type: "section"; label?: string };

/** Where "/" sends you. */
export const DEFAULT_ROUTE = "/leads";

export const NAV_TOP: NavEntry[] = [
  // `badge` names a count from the app-level counts context, fed up by the
  // owning feature — so the sidebar still needs no feature import.
  { type: "item", to: "/leads", icon: Inbox, label: "Leads", badge: "openLeads", mobile: true },
  { type: "item", to: "/accounts", icon: Building2, label: "Accounts", mobile: true },
  // The survey lane. Templates sit beside surveys rather than under Settings:
  // the form builder is a platform piece other modules will consume, and an Ops
  // lead authors templates far more often than an Admin touches setup.
  { type: "section", label: "Surveys" },
  { type: "item", to: "/surveys", icon: ClipboardList, label: "Surveys", badge: "pendingSurveys", mobile: true },
  // The fourth phone slot goes to Templates rather than the widget: authoring
  // is day-to-day work, and the widget is a preview you look at once.
  { type: "item", to: "/templates", icon: FileText, label: "Templates", mobile: true },
  // The commercial lane — what a finished survey becomes. Its own group rather
  // than a fifth item under Surveys: a proposal is priced by a different person
  // (the estimator) and answers a different question (what it costs), and the
  // section label is the only divider this rail has.
  //
  // NO `mobile` FLAG, deliberately. The phone tab bar has five slots and the
  // last is "More", so exactly four items can carry one — and all four are
  // taken by the lanes that are worked from a phone. Pricing is desk work;
  // Proposals lives in the More sheet, which is a real destination.
  { type: "section", label: "Commercial" },
  // Deals lead the group: the deal is the pursuit itself — the portfolio is
  // built FOR one and the proposal is priced AGAINST one, so reading the group
  // top-to-bottom is again the actual sequence.
  //
  // NO `mobile` flag, same arithmetic as the rest of this group: the four tab
  // slots belong to the lanes worked from a phone, and moving a deal through
  // its stages is desk work. Deals lives in the More sheet.
  { type: "item", to: "/deals", icon: Handshake, label: "Deals" },
  // The portfolio sits ABOVE proposals because it is what gets priced: the tree
  // is built during the pursuit, the proposal is priced off it, and the convert
  // runs after the win. Reading the group top-to-bottom is the actual sequence.
  //
  // NO `mobile` flag: the phone tab bar has four slots and all four go to lanes
  // that are genuinely worked from a phone. Building a site list out of an RFP
  // attachment is desk work, so the portfolio lives in the More sheet.
  { type: "item", to: "/portfolio", icon: Landmark, label: "Portfolio" },
  { type: "item", to: "/proposals", icon: FileSignature, label: "Proposals" },
  // Its own group at the rail's end: the intake agent is the whole pipeline —
  // presentation AND the analyst brief — seen the way a visitor meets it, not
  // one of the day-to-day work lanes above. Unlabelled: "Intake" over a single
  // "Intake agent" entry read as the same word twice.
  { type: "section" },
  { type: "item", to: "/chat", icon: Bot, label: "Intake agent" },
];

/** Pinned to the sidebar footer, away from the modules. */
export const SETTINGS_NAV: NavItemEntry = {
  type: "item",
  to: "/settings",
  icon: SlidersHorizontal,
  label: "Settings",
};

export type NavGroup = { label?: string; items: NavItemEntry[] };

/**
 * NAV_TOP folded into labelled groups — a `section` entry starts a new one, and
 * group spacing is the divider.
 *
 * Shared by the rail and the phone's More sheet, which show DIFFERENT slices of
 * the same list (`keep` is how the sheet asks for only what the tab bar didn't
 * take). Two copies of this fold would drift the moment a section is added.
 * Empty groups are dropped, so a section whose every item went to the tab bar
 * leaves no orphan heading behind.
 */
export function navGroups(keep: (item: NavItemEntry) => boolean = () => true): NavGroup[] {
  const groups: NavGroup[] = [{ items: [] }];
  for (const entry of NAV_TOP) {
    if (entry.type === "section") groups.push({ label: entry.label, items: [] });
    else if (!entry.hidden && keep(entry)) groups[groups.length - 1].items.push(entry);
  }
  return groups.filter((g) => g.items.length > 0);
}

/** The items holding a phone tab-bar slot, in nav order. */
export const MOBILE_TABS: NavItemEntry[] = NAV_TOP.filter(
  (e): e is NavItemEntry => e.type === "item" && !e.hidden && Boolean(e.mobile),
);
