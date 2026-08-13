/**
 * The page shell: a fixed header, an optional fixed strip under it, and exactly
 * ONE scroll region.
 *
 *   ┌──────────────────────────────────────┐
 *   │ header: title / subtitle / actions   │  FIXED
 *   ├──────────────────────────────────────┤
 *   │ strip: tabs, filters                 │  FIXED — optional
 *   ├──────────────────────────────────────┤
 *   │ ░░ body — the only thing that scrolls│
 *   └──────────────────────────────────────┘
 *
 * This sits inside the shell's content slot (Layout), which is `overflow:
 * hidden` and deliberately keeps no scroller of its own — the real scroll
 * region belongs one layer deeper, in each page. So this is a full-height flex
 * column that owns its scroller.
 *
 * Scrolling goes through OverlayScrollbar so the bar floats over the content and
 * the body width doesn't jump when a short page becomes a long one.
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
      <div className="flex shrink-0 flex-wrap items-baseline gap-4 px-6 pt-5 pb-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-4">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <span className="text-muted-foreground text-sm">{subtitle}</span> : null}
        </div>
        <span className="flex-1" />
        {actions}
      </div>

      {/* Empty when a page has no tabs, so it contributes no height. */}
      {strip ? <div className="shrink-0 px-6 pb-3">{strip}</div> : null}

      <OverlayScrollbar style={{ flex: 1 }}>
        <div className="min-w-0 px-6 pb-10">{children}</div>
      </OverlayScrollbar>
    </div>
  );
}
