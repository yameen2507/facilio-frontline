/**
 * The row-list primitives: a clickable row, its column headings, and the count
 * line beneath.
 *
 * All three share ROW_GRID, which is what makes headings line up with cells by
 * construction rather than by two sets of matching numbers kept in step by
 * hand. Exported so Skeleton.tsx can build placeholder rows on the identical
 * grid — that reuse is what keeps nothing shifting when real data lands.
 */

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Main text stack, status chip, score, trailing clock column. */
export const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_96px_84px_120px] items-center gap-4 border-b px-4 py-3 last:border-b-0";

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
      className={cn(
        ROW_GRID,
        clickable && "hover:bg-muted/50 cursor-pointer",
        selected && "bg-muted",
      )}
      style={style}
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
    <div className="text-sm font-medium">{title}</div>
    {meta ? (
      <div className="text-muted-foreground mt-px text-xs [&_code]:font-mono">{meta}</div>
    ) : null}
  </div>
);

/** A numeric cell with its unit beneath — score, lead count, deal count. */
export const RowStat = ({ value, unit }: { value: ReactNode; unit: string }) => (
  <div
    className={cn(
      "text-base font-medium tabular-nums",
      (value === null || value === undefined) && "text-muted-foreground",
    )}
  >
    {value ?? "—"}
    <small className="text-muted-foreground block text-[10px] font-normal">{unit}</small>
  </div>
);

/**
 * Column headings. Every leads console labelled its columns and this one did not
 * — a score and two chip columns with nothing saying what they were.
 */
export const TableHead = ({ columns }: { columns: string[] }) => (
  <div
    className={cn(
      ROW_GRID,
      "bg-muted/50 text-muted-foreground py-2 text-[10px] font-medium tracking-[0.06em] uppercase",
    )}
    aria-hidden="true"
  >
    {columns.map((c) => (
      <div key={c}>{c}</div>
    ))}
  </div>
);

/** "Showing 12 of 40" — the market-standard footer under a truncated list. */
export const CountLine = ({ children }: { children: ReactNode }) => (
  <div className="text-muted-foreground border-t px-4 py-2 text-xs">{children}</div>
);
