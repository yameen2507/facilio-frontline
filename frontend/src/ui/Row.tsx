/**
 * The row-list primitives: a clickable row, its column headings, and the count
 * line beneath.
 *
 * All three share the `.lead-row` grid, which is what makes headings line up with
 * cells by construction rather than by two sets of matching numbers kept in step
 * by hand.
 */

import type { CSSProperties, ReactNode } from "react";

export function Row({
  children,
  onClick,
  selected = false,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  style?: CSSProperties;
}) {
  const clickable = Boolean(onClick);
  return (
    <div
      className={`lead-row${selected ? " on" : ""}`}
      style={clickable ? style : { cursor: "default", ...style }}
      onClick={onClick}
      // A row that navigates is a control, so it has to be reachable and
      // operable from the keyboard, not just the mouse.
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              // Only when the row itself has focus. A future interactive child
              // (a checkbox, a menu) would otherwise fire this as its own key
              // event bubbles up, running the action twice.
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/** The primary cell: a title with a muted second line under it. */
export const RowTitle = ({ title, meta }: { title: ReactNode; meta?: ReactNode }) => (
  <div>
    <div className="co">{title}</div>
    {meta ? <div className="meta">{meta}</div> : null}
  </div>
);

/** A numeric cell with its unit beneath — score, lead count, deal count. */
export const RowStat = ({ value, unit }: { value: ReactNode; unit: string }) => (
  <div className={`score${value === null || value === undefined ? " none" : ""}`}>
    {value ?? "—"}
    <small>{unit}</small>
  </div>
);

/**
 * Column headings. Every leads console labelled its columns and this one did not
 * — a score and two chip columns with nothing saying what they were.
 */
export const TableHead = ({ columns }: { columns: string[] }) => (
  <div className="lead-row head" aria-hidden="true">
    {columns.map((c) => (
      <div key={c}>{c}</div>
    ))}
  </div>
);

/** "Showing 12 of 40" — the market-standard footer under a truncated list. */
export const CountLine = ({ children }: { children: ReactNode }) => (
  <div className="count-line">{children}</div>
);
