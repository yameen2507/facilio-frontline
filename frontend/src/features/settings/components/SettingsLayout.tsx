/**
 * The Settings area's one shell: a single PageShell whose body splits into the
 * side nav and the routed section. The nav lives HERE, outside every section's
 * fetch, so it renders in every state — a section that fails to load must not
 * take the way to its siblings with it (the rule the old tab strip stated).
 *
 * `fillBody`, because this pane panels itself: the nav column stays put and the
 * SECTION is the only thing that scrolls — the shell's single-scroller rule,
 * applied one level down. The section wrapper is keyed on the route so a nav
 * click fades just the body in (`page-enter`); the header and rail above/beside
 * it never move — App.tsx collapses settings sub-paths to one pane key for
 * exactly this reason.
 *
 * Section pages render content only: their name, description and actions are a
 * header INSIDE the content column (SectionHeader), not PageShell slots.
 */

import { Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { PageShell } from "../../../app/shell/PageShell";
import OverlayScrollbar from "../../../ui/OverlayScrollbar";
import { SettingsNav } from "./SettingsNav";

export function SettingsLayout() {
  const { pathname } = useLocation();
  // Permissions manages its own scrolling: the matrix scrolls INSIDE its card
  // so the role-name header row can be sticky (sticky cannot escape the
  // horizontal-scroll wrapper, so the card must own the vertical axis too).
  // Capping the section at the pane's height is what hands it that scroller;
  // every other section keeps growing and scrolls the pane as before.
  const sectionScrolls = pathname === "/settings/permissions";

  return (
    <PageShell title="Settings" subtitle="The workspace, its people and what each role may do" fillBody>
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        {/* The rail carries the shell's usual insets itself (fillBody hands us
            an unpadded box). Fixed width from `md` up; a horizontal row above
            the content below it. */}
        <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6 md:w-56 md:pr-0">
          <SettingsNav />
        </div>
        {/* The only scroller. Bottom padding mirrors PageShell's body: the
            last row scrolls clear of the iPhone home indicator. */}
        <OverlayScrollbar style={{ flex: 1, minWidth: 0 }}>
          <div
            key={pathname}
            className={cn(
              "page-enter min-w-0 px-4 pt-4 pb-[calc(--spacing(4)+var(--safe-bottom))] sm:px-6 sm:pt-6 sm:pb-[calc(--spacing(6)+var(--safe-bottom))] md:pl-8",
              sectionScrolls && "flex h-full flex-col"
            )}
          >
            <Outlet />
          </div>
        </OverlayScrollbar>
      </div>
    </PageShell>
  );
}
