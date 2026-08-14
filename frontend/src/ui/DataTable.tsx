/**
 * The list-table kit, on shadcn's Table — what the hand-rolled ROW_GRID rows
 * (ui/Row.tsx) grow into for the four list pages.
 *
 * One column vocabulary drives everything: a `Col` names the column, optionally
 * gives its header a small icon, carries the cell alignment/visibility classes,
 * and says what SHAPE of content loads into it (`skel`). Header, body cells and
 * the loading skeleton all read the same array, so the three can't drift — the
 * same guarantee ROW_GRID gave, kept across the rewrite.
 *
 * Pages compose their own cells (that's where the icons and logos live); this
 * file owns only the frame: header styling, clickable rows, skeletons.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type Col = {
  label: string;
  /** Small glyph beside the header label — the header names the column, the
      glyph lets a scanning eye find it without reading. */
  icon?: LucideIcon;
  /** Applied to the header cell AND every skeleton cell in this column —
      alignment and responsive hiding live here so th and td can't disagree.
      Pages must repeat it on their real cells (exported per page as consts). */
  className?: string;
  /** What the loading placeholder for this column looks like. */
  skel: "entity" | "chip" | "num" | "text";
};

export function ListTable({ cols, children }: { cols: Col[]; children: ReactNode }) {
  return (
    // table-fixed: with auto layout a long entity meta line sets the column's
    // min-content width, pushes the table wider than the phone screen, and the
    // trailing columns silently scroll off-screen — `truncate` in the cells
    // never gets a constrained width to act on. Fixed layout hands the sized
    // columns (w-24/w-36…) their width and the entity column the remainder,
    // so the ellipsis actually happens and every column stays on screen.
    <Table className="table-fixed">
      <TableHeader>
        {/* hover:bg-transparent: the header is not a row, it must not light up. */}
        <TableRow className="bg-muted/40 hover:bg-transparent">
          {cols.map((c) => (
            <TableHead
              key={c.label}
              className={cn(
                "text-muted-foreground h-9 px-4 text-[11px] font-medium tracking-[0.08em] uppercase",
                c.className,
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                {c.icon ? <c.icon className="size-3.5 opacity-70" aria-hidden="true" /> : null}
                {c.label}
              </span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

/** A row that navigates: clickable, and operable from the keyboard like the
    button it really is. */
export function ClickRow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <TableRow
      className="cursor-pointer"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // Only when the row itself has focus — an interactive child's key
        // events bubble here and would fire the navigation twice.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </TableRow>
  );
}

const WIDTHS = ["62%", "47%", "71%", "54%", "66%", "43%"];
const META_WIDTHS = ["84%", "68%", "77%", "59%", "88%", "64%"];
const pick = (list: string[], i: number) => list[i % list.length];

const Bar = ({ width, className }: { width: string; className?: string }) => (
  <Skeleton className={cn("bg-border inline-block h-[0.72em] min-h-2 rounded-sm align-middle", className)} style={{ width }} />
);

/** One column's placeholder, shaped like what will land there. */
function SkelCell({ kind, row }: { kind: Col["skel"]; row: number }) {
  switch (kind) {
    case "entity":
      return (
        <div className="flex items-center gap-3">
          <Skeleton className="bg-border size-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="text-sm">
              <Bar width={pick(WIDTHS, row)} />
            </div>
            <div className="mt-1 text-xs">
              <Bar width={pick(META_WIDTHS, row)} />
            </div>
          </div>
        </div>
      );
    case "chip":
      return <Skeleton className="bg-border inline-block h-[18px] w-[72px] rounded-full align-middle" />;
    case "num":
      return <Bar width="28px" className="text-sm" />;
    case "text":
      return <Bar width="56px" className="text-xs" />;
  }
}

/** Loading rows on the identical column set, so nothing shifts when data lands. */
export function ListTableSkeleton({ cols, rows = 5 }: { cols: Col[]; rows?: number }) {
  return (
    <ListTable cols={cols}>
      {Array.from({ length: rows }, (_, i) => (
        <TableRow key={i} className="hover:bg-transparent" aria-hidden="true">
          {cols.map((c) => (
            <TableCell key={c.label} className={cn("px-4 py-3", c.className)}>
              <SkelCell kind={c.skel} row={i} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </ListTable>
  );
}
