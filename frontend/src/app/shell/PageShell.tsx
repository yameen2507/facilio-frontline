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
 * This now sits inside the ported `MainContent`, which is `height: 100%` with
 * `overflow: hidden` and deliberately keeps no scroller of its own — the comment
 * in that file is explicit that the real scroll region belongs one layer deeper,
 * in each page. So this is a full-height flex column that owns its scroller,
 * rather than the fragment it used to be when it was a direct flex child of the
 * old `<main>`.
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
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <div className="top">
        <div className="top-text">
          <h1>{title}</h1>
          {subtitle ? <span className="sub">{subtitle}</span> : null}
        </div>
        <span className="grow" />
        {actions}
      </div>

      {strip ? <div className="page-tabs">{strip}</div> : null}

      <OverlayScrollbar style={{ flex: 1 }}>
        <div className="content">{children}</div>
      </OverlayScrollbar>
    </div>
  );
}
