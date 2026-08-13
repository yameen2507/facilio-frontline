/**
 * The page shell: ONE bordered header band, and exactly ONE scroll region.
 * Every page (inbox, accounts, surveys, settings, detail views) renders
 * through this, so the header is designed here once.
 *
 *   ┌──────────────────────────────────────┐
 *   │ EYEBROW                              │  FIXED ─┐ one band, one
 *   │ Title  ·  subtext           actions  │         │ border under it
 *   │ tabs ────────────··········· extras  │  FIXED ─┘ (strip optional)
 *   ├──────────────────────────────────────┤
 *   │ ░░ body — the only thing that scrolls│
 *   └──────────────────────────────────────┘
 *
 * ONE band is the rule; a cramped band is not. The eyebrow names the module,
 * the title sits big under it with the subtext trailing on the same baseline,
 * actions centre against them on the right, and the strip's tabs sit FLUSH on
 * the band's border (the underline restyle in ui/Tabs pairs with this — its
 * active bar overlaps the border via -mb-px). The shape before that — a tall
 * title row plus a floating boxed tab group — spent two bands' worth of height
 * saying one band's worth of things, so the breathing room here is bought
 * inside the single band, never by splitting it.
 *
 * The band also carries a faint top-down wash from `muted`: the fixed header
 * and the scrolling body are the same colour otherwise, and the border alone
 * was doing all the work of separating them.
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
      <div className="from-muted/40 to-background shrink-0 border-b bg-gradient-to-b px-4 pt-6 max-md:pl-14 sm:px-6">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 pb-5">
          <div className="min-w-0 flex-1">
            {label ? (
              <div className="text-muted-foreground mb-1.5 truncate text-[11px] font-medium tracking-[0.14em] uppercase">
                {label}
              </div>
            ) : null}
            {/* Baseline, not centre: the subtext trails the title as a second
                clause of one line, and wraps under it only when it must. */}
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h1 className="truncate text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
              {subtitle ? (
                <p className="text-muted-foreground min-w-0 truncate text-sm">
                  <span aria-hidden="true" className="mr-2.5 opacity-40">·</span>
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
          {/* flex-wrap, not shrink-0: a detail page carries five actions, and on
              a phone they wrap under the title instead of forcing a scroll. */}
          {actions ? (
            <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
          ) : null}
        </div>

        {/* items-end so tabs land on the border while taller extras (a search
            field) bottom-align beside them; contributes no height when absent.
            Wraps on phones — tabs above, search below. */}
        {strip ? (
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">{strip}</div>
        ) : null}
      </div>

      <OverlayScrollbar style={{ flex: 1 }}>
        <div className="min-w-0 px-4 pt-5 pb-10 sm:px-6">{children}</div>
      </OverlayScrollbar>
    </div>
  );
}
