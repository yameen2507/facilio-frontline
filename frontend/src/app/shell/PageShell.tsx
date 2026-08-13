/**
 * The page shell: ONE bordered header band, and exactly ONE scroll region.
 * Every page (inbox, accounts, surveys, settings, detail views) renders
 * through this, so the header is designed here once.
 *
 *   ┌──────────────────────────────────────┐
 *   │ module › Title · subtext    actions  │  FIXED ─┐ one flat band,
 *   │ [tab][tab][tab]   ····· search/extra │  FIXED ─┘ one border under it
 *   ├──────────────────────────────────────┤
 *   │ ░░ body — the only thing that scrolls│
 *   └──────────────────────────────────────┘
 *
 * The shape is taken from how Linear, Stripe and Attio head their list pages
 * (checked against real screens on Mobbin, 2026-08): a SLIM title row — the
 * module reads as a breadcrumb prefix inline with the title, the subtext
 * trails on the same line, actions sit right — and ONE compact control row
 * where pill tabs (ui/Tabs) sit left and search/extras sit right. Nothing
 * stacks: the eyebrow-over-big-title-over-subtitle version of this header
 * spent ~120px saying what this says in ~90, and none of the references
 * decorate the band (no gradient wash — flat bg, border does the separating).
 *
 * Scrolling goes through OverlayScrollbar so the bar floats over the content
 * and the body width doesn't jump when a short page becomes a long one.
 */

import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { NAV_TOP } from "../../layout/sidebar/nav-config";
import OverlayScrollbar from "../../ui/OverlayScrollbar";

/**
 * Where the page sits, read off the same nav data the sidebar is built from —
 * so a page carries its module name without every call site restating it, and
 * a nav rename moves both at once. A grouped item answers with its section
 * ("Surveys" over Templates); an ungrouped one answers with its own label
 * ("Lead inbox" over Inbox); a detail view inherits its list's answer, which is
 * where this earns its keep — the title there is a record, not a place.
 */
function moduleOf(path: string): string | undefined {
  let section: string | undefined;
  let best: { label: string; section?: string; length: number } | undefined;
  for (const entry of NAV_TOP) {
    if (entry.type === "section") {
      section = entry.label;
      continue;
    }
    if (!path.startsWith(entry.to)) continue;
    // Longest prefix wins, so "/surveys/new" never answers with a shorter
    // sibling route that happens to prefix it.
    if (!best || entry.to.length > best.length) {
      best = { label: entry.label, section, length: entry.to.length };
    }
  }
  // Settings is deliberately absent: it is pinned to the sidebar footer rather
  // than being one of the module lanes, so it has no lane to name.
  return best && (best.section ?? best.label);
}

/** Either string sits inside the other, ignoring case. */
function contains(a: string, b: string): boolean {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x.includes(y) || y.includes(x);
}

export function PageShell({
  title,
  subtitle,
  eyebrow,
  actions,
  strip,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Overrides the module name derived from the route. */
  eyebrow?: string;
  actions?: ReactNode;
  /** Tabs or a filter bar. Stays put while the body scrolls. */
  strip?: ReactNode;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const module = eyebrow ?? moduleOf(pathname);
  // Suppressed when it would only repeat the title back — "SURVEYS / Surveys",
  // "LEAD INBOX / Inbox". Substring, not equality: the near-misses are the ones
  // that read worst.
  const label = module && !contains(module, title) ? module : undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* px steps down on phones — six units of gutter is a tenth of the screen.
          The mobile sidebar trigger floats at top-left (Layout), so the title
          indents past it below md. */}
      <div className="shrink-0 border-b px-4 pt-2 max-md:pl-14 sm:px-6">
        {/* The title row: one slim line, Linear-breadcrumb style. min-h rather
            than h so wrapped actions on a phone can grow it. */}
        <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-1">
          <div className="flex min-w-0 flex-1 items-baseline gap-x-2">
            {label ? (
              <span className="text-muted-foreground shrink-0 text-sm">
                {label} <span aria-hidden="true" className="mx-0.5 opacity-50">›</span>
              </span>
            ) : null}
            <h1 className="truncate text-base leading-tight font-semibold tracking-tight">{title}</h1>
            {subtitle ? (
              <p className="text-muted-foreground min-w-0 truncate text-sm max-sm:hidden">
                <span aria-hidden="true" className="mr-2 opacity-40">·</span>
                {subtitle}
              </p>
            ) : null}
          </div>
          {/* flex-wrap, not shrink-0: a detail page carries five actions, and on
              a phone they wrap under the title instead of forcing a scroll. */}
          {actions ? (
            <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
          ) : null}
        </div>

        {/* The control row: pill tabs left, search/extras right, all one
            compact line that wraps on phones — tabs above, search below. */}
        {strip ? (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-0.5 pb-2.5">
            {strip}
          </div>
        ) : null}
      </div>

      <OverlayScrollbar style={{ flex: 1 }}>
        <div className="min-w-0 px-4 pt-5 pb-10 sm:px-6">{children}</div>
      </OverlayScrollbar>
    </div>
  );
}
