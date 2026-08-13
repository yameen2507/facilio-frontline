/**
 * The page shell: a fixed header, an optional fixed strip under it, and exactly
 * ONE scroll region.
 *
 *   ┌──────────────────────────────────────┐
 *   │ header: title / subtitle / actions   │  FIXED — outside the scroller
 *   ├──────────────────────────────────────┤
 *   │ strip: tabs, filters                 │  FIXED — optional
 *   ├──────────────────────────────────────┤
 *   │ ░░ body — the only thing that scrolls│
 *   └──────────────────────────────────────┘
 *
 * Returns a FRAGMENT, not a wrapper div. `<main>` is the flex column that owns the
 * height, so these three need to be its direct children — an extra div in between
 * would swallow `flex: 1` and the body would grow instead of scrolling.
 *
 * Actions are per page rather than one global button in the chrome: "Refresh" on
 * the inbox and "Refresh" on a lead detail do different things, and a single
 * button in the shell has to guess which page it is on.
 */

import type { ReactNode } from "react";

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
    <>
      <div className="top">
        <div className="top-text">
          <h1>{title}</h1>
          {subtitle ? <span className="sub">{subtitle}</span> : null}
        </div>
        <span className="grow" />
        {actions}
      </div>

      {strip ? <div className="page-tabs">{strip}</div> : null}

      <div className="content">{children}</div>
    </>
  );
}
