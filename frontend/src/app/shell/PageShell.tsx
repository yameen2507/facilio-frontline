/**
 * The page shell: ONE bordered header band, and exactly ONE scroll region.
 * Every page (inbox, accounts, surveys, settings, detail views) renders
 * through this, so the header is designed here once.
 *
 *   ┌──────────────────────────────────────┐
 *   │ title            ·          actions  │  FIXED ─┐ one band, one
 *   │ subtext                              │         │ border under it
 *   │ tabs ────────────··········· extras  │  FIXED ─┘ (strip optional)
 *   ├──────────────────────────────────────┤
 *   │ ░░ body — the only thing that scrolls│
 *   └──────────────────────────────────────┘
 *
 * The band is deliberately compact: title and subtext stack tight on the
 * left, actions centre against them on the right, and the strip's tabs sit
 * FLUSH on the band's border (the underline restyle in ui/Tabs pairs with
 * this — its active bar overlaps the border via -mb-px). The previous shape —
 * a tall title row plus a floating boxed tab group — spent two bands' worth
 * of height saying one band's worth of things.
 *
 * Scrolling goes through OverlayScrollbar so the bar floats over the content
 * and the body width doesn't jump when a short page becomes a long one.
 */

import type { ReactNode } from "react";
import OverlayScrollbar from "../../ui/OverlayScrollbar";

export function PageShell({
  title,
  subtitle,
  actions,
  strip,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Tabs or a filter bar. Stays put while the body scrolls. */
  strip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* px steps down on phones — six units of gutter is a tenth of the screen.
          The mobile sidebar trigger floats at top-left (Layout), so the title
          indents past it below md. */}
      <div className="shrink-0 border-b px-4 pt-4 max-md:pl-14 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">{title}</h1>
            {subtitle ? (
              <p className="text-muted-foreground mt-0.5 truncate text-xs leading-tight">{subtitle}</p>
            ) : null}
          </div>
          <span className="flex-1" />
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
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">{strip}</div>
        ) : null}
      </div>

      <OverlayScrollbar style={{ flex: 1 }}>
        <div className="min-w-0 px-4 pt-5 pb-10 sm:px-6">{children}</div>
      </OverlayScrollbar>
    </div>
  );
}
