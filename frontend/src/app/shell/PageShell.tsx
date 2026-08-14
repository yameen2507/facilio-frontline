/**
 * The page shell: ONE bordered header band, and exactly ONE scroll region.
 * Every page (inbox, accounts, surveys, settings, detail views) renders
 * through this, so the header is designed here once.
 *
 *   ┌──────────────────────────────────────┐
 *   │ ‹ Title · subtext           actions  │  FIXED ─┐ one flat band,
 *   │ [tab][tab][tab]   ····· search/extra │  FIXED ─┘ one border under it
 *   ├──────────────────────────────────────┤
 *   │ ░░ body — the only thing that scrolls│
 *   └──────────────────────────────────────┘
 *
 * The shape is taken from how Linear, Stripe and Attio head their list pages
 * (checked against real screens on Mobbin, 2026-08): a SLIM title row — the
 * title alone names the page (no breadcrumb path spelling out the sidebar
 * section again), the subtext trails on the same line, actions sit right —
 * and ONE compact control row where pill tabs (ui/Tabs) sit left and
 * search/extras sit right. A SECOND-LEVEL page (a record under a list, a
 * builder under its gallery) leads with a back chevron instead: depth is a
 * control you use, not a path you read. Nothing stacks, and none of the
 * references decorate the band (flat bg, the border does the separating).
 *
 * Scrolling goes through OverlayScrollbar so the bar floats over the content
 * and the body width doesn't jump when a short page becomes a long one.
 */

import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { NAV_TOP } from "../../layout/sidebar/nav-config";
import OverlayScrollbar from "../../ui/OverlayScrollbar";

/**
 * The list this page sits UNDER, read off the same nav data the sidebar is
 * built from — so a record page carries its way back without every call site
 * restating it, and a route rename moves both at once. Answered only when the
 * path is DEEPER than the matched nav item ("/leads/123" under "/leads"):
 * a top-level page has the sidebar for navigation and needs no back control.
 */
function backOf(path: string): { label: string; to: string } | undefined {
  let best: { label: string; to: string } | undefined;
  for (const entry of NAV_TOP) {
    if (entry.type === "section" || entry.hidden) continue;
    if (!path.startsWith(entry.to)) continue;
    // Longest prefix wins, so "/surveys/new" never answers with a shorter
    // sibling route that happens to prefix it.
    if (!best || entry.to.length > best.to.length) {
      best = { label: entry.label, to: entry.to };
    }
  }
  // Settings never matches — it is pinned to the sidebar footer, not a lane —
  // and a path that IS its list ("/leads") has nowhere shallower to go.
  return best && best.to !== path ? best : undefined;
}

export function PageShell({
  title,
  subtitle,
  actions,
  strip,
  search,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Tabs or a filter bar — the LEFT side of the control row. */
  strip?: ReactNode;
  /** The search field. A named slot rather than part of `strip` so search is
      ALWAYS on the control row's right, on every page — its position is a
      shell decision, not something each page re-derives. */
  search?: ReactNode;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const back = backOf(pathname);
  // With no tabs there is no control row to anchor: search joins the actions
  // on the title row's right instead of sitting alone on a second line.
  const searchInTitleRow = Boolean(search && !strip);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* px steps down on phones — six units of gutter is a tenth of the screen.
          The mobile sidebar trigger floats at top-left (Layout), so the title
          indents past it below md. */}
      {/* py-3, and the rows inside add NO outer padding of their own: the band
          breathes equally above the title and below whatever ends it — a title
          row alone, or the control row under it. */}
      <div className="shrink-0 border-b px-4 py-3 max-md:pl-14 sm:px-6">
        {/* The title row: one slim line. min-h rather than h so wrapped
            actions on a phone can grow it. */}
        <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-1 items-center gap-x-1.5">
            {back ? (
              <Link
                to={back.to}
                aria-label={`Back to ${back.label}`}
                title={`Back to ${back.label}`}
                className="text-muted-foreground hover:bg-muted hover:text-foreground -ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
              >
                <ChevronLeft className="size-4" />
              </Link>
            ) : null}
            {/* Baseline between title and subtext, centred against the chevron. */}
            <div className="flex min-w-0 items-baseline gap-x-2">
              <h1 className="truncate text-base leading-tight font-semibold tracking-tight">{title}</h1>
              {subtitle ? (
                <p className="text-muted-foreground min-w-0 truncate text-sm max-sm:hidden">
                  <span aria-hidden="true" className="mr-2 opacity-40">·</span>
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
          {/* flex-wrap, not shrink-0: a detail page carries five actions, and on
              a phone they wrap under the title instead of forcing a scroll. */}
          {actions || searchInTitleRow ? (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              {searchInTitleRow ? search : null}
              {actions}
            </div>
          ) : null}
        </div>

        {/* The control row: pill tabs left, search pinned right, one compact
            line that wraps on phones — tabs above, search below at full width.
            Rendered only when there ARE tabs; a tab-less page's search lives
            in the title row above. */}
        {strip ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 pt-2.5">
            <div className="min-w-0 flex-1">{strip}</div>
            {search ? <div className="ml-auto w-full sm:w-auto">{search}</div> : null}
          </div>
        ) : null}
      </div>

      <OverlayScrollbar style={{ flex: 1 }}>
        {/* pb grows past the iPhone home indicator when installed — the last row
            must scroll clear of it, not end underneath. */}
        <div className="min-w-0 px-4 pt-5 pb-[calc(--spacing(10)+env(safe-area-inset-bottom,0px))] sm:px-6">{children}</div>
      </OverlayScrollbar>
    </div>
  );
}
