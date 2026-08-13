/**
 * A scroll region whose scrollbar floats over the content instead of taking
 * layout width from it.
 *
 * The ported layout expects this component to exist — `NavPanel` scrolls the nav
 * list through it. The original lives in the helpdesk repo and was not part of
 * what came across, so this is a light re-implementation of the same API rather
 * than that code: `style` for the box, `rightInset` to nudge the bar, children as
 * the content.
 *
 * Deliberately native `overflow-y: auto` plus a styled thin scrollbar (see
 * `.overlay-scroll` in globals.css) rather than a scrollbar library. A JS scrollbar
 * is a lot of moving parts for a nav rail, and native scrolling keeps keyboard
 * paging, trackpad momentum and `scrollIntoView` working for free.
 */

import type { CSSProperties, ReactNode } from "react";

export default function OverlayScrollbar({
  children,
  style,
  /** Shifts the bar horizontally. Negative pulls it into the parent's padding. */
  rightInset = 0,
  className,
}: {
  children: ReactNode;
  style?: CSSProperties;
  rightInset?: number;
  className?: string;
}) {
  return (
    <div
      className={`overlay-scroll${className ? ` ${className}` : ""}`}
      style={{
        overflowY: "auto",
        overflowX: "hidden",
        // `minHeight: 0` is what lets this shrink inside a flex column instead of
        // growing the parent and pushing the scroll up to the page.
        minHeight: 0,
        ...(rightInset ? { marginRight: `${rightInset}px` } : null),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
