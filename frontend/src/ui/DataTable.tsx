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
 *
 * BELOW `sm` THE TABLE IS THE WRONG SHAPE. A 390px screen holds two columns of
 * it, so the old answer was hiding columns until only the entity cell and one
 * chip survived — a table wearing a disguise. The phone kit at the bottom of
 * this file (MobileList / MobileRow) is the honest form: one stacked card per
 * record, title and status on the first line, meta under it, the surviving
 * facts in a wrap row. A page renders BOTH — the table with `max-sm:hidden`,
 * the MobileList right after it (it carries `sm:hidden` itself) — and the
 * skeleton pairs them the same way, so neither state can show the wrong shape.
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

/** The header-cell type treatment, exported for tables that cannot use Col[]
    (the permissions matrix builds its columns from data, not a fixed array). */
export const HEADER_CELL = "text-[11px] font-medium tracking-[0.08em] uppercase";

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

export function ListTable({
  cols,
  className,
  children,
}: {
  cols: Col[];
  /** Pass `max-sm:hidden` when a MobileList follows — the pair swap on the
      same edge. Not baked in, because a table with no phone counterpart
      going blank below `sm` is worse than a squeezed one. */
  className?: string;
  children: ReactNode;
}) {
  return (
    // table-fixed: with auto layout a long entity meta line sets the column's
    // min-content width, pushes the table wider than the phone screen, and the
    // trailing columns silently scroll off-screen — `truncate` in the cells
    // never gets a constrained width to act on. Fixed layout hands the sized
    // columns (w-24/w-36…) their width and the entity column the remainder,
    // so the ellipsis actually happens and every column stays on screen.
    <Table className={cn("table-fixed", className)}>
      <TableHeader>
        {/* hover:bg-transparent: the header is not a row, it must not light up. */}
        <TableRow className="bg-muted/40 hover:bg-transparent">
          {cols.map((c) => (
            <TableHead
              key={c.label}
              className={cn("text-muted-foreground h-9 px-4", HEADER_CELL, c.className)}
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

/**
 * Loading placeholders shaped like whatever this width will actually show —
 * table rows from `sm` up, stacked phone rows below it — so nothing shifts
 * when data lands, on either form. One component rather than two call sites
 * because the loading branch is where a page would forget the pairing.
 */
export function ListTableSkeleton({ cols, rows = 5 }: { cols: Col[]; rows?: number }) {
  return (
    <>
      <ListTable cols={cols} className="max-sm:hidden">
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
      <MobileList aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          // py-4 matches MobileRow, so nothing shifts when data lands.
          <div key={i} className="flex items-start gap-3 px-4 py-4">
            <Skeleton className="bg-border size-8 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1 text-sm">
                  <Bar width={pick(WIDTHS, i)} />
                </div>
                <Skeleton className="bg-border h-[18px] w-[72px] shrink-0 rounded-full" />
              </div>
              <div className="mt-1 text-xs">
                <Bar width={pick(META_WIDTHS, i)} />
              </div>
            </div>
          </div>
        ))}
      </MobileList>
    </>
  );
}

// ── The phone list — what the table folds into below `sm` ───────────────────

/**
 * Applied to the Card that wraps a list: below `sm` the floating card reads as
 * a box inside a box — 16px gutter, ring, rounding, all spent on chrome around
 * rows that are already self-dividing — so the surface bleeds to the screen
 * edges. The negative margins cancel PageShell's phone body insets exactly
 * (px-4 / pb-4 below `sm`, where --safe-bottom is 0 because the tab bar
 * carries the device inset; from `sm` up the insets differ but this class is
 * gone by then). The bottom bleed is included here, not left to each page:
 * scrolled to the end, the list's closing hairline lands ON the tab bar's
 * border instead of floating 16px above it. From `sm` up the card is
 * unchanged.
 */
export const PHONE_BLEED =
  "max-sm:-mx-4 max-sm:-mb-4 max-sm:rounded-none max-sm:border-x-0 max-sm:shadow-none";

/**
 * Added to PHONE_BLEED when the list is the body's FIRST child (Leads,
 * Accounts): the card pulls up over the body's top inset and drops its own top
 * hairline, so the header band's border becomes the list's top edge — no
 * stranded 16px strip of page background, no doubled line. Surveys can't take
 * this: its filter chip sits between the header and the list and needs that
 * breathing room.
 */
export const PHONE_BLEED_TOP = "max-sm:-mt-4 max-sm:border-t-0";

/**
 * The frame: `sm:hidden` is built in (a "mobile list" showing on desktop would
 * be a naming lie), dividers come from the frame rather than each row so the
 * last row never has to know it's last.
 */
export function MobileList({
  children,
  "aria-hidden": ariaHidden,
}: {
  children: ReactNode;
  "aria-hidden"?: boolean;
}) {
  return (
    <div className="divide-y sm:hidden" aria-hidden={ariaHidden}>
      {children}
    </div>
  );
}

/**
 * One record as a stacked card: leading visual, then title with the status
 * chip holding the line's right edge, the meta line under it, and an optional
 * wrap row of the facts that earned a phone seat. Slots rather than a data
 * array so pages pass the SAME chip components the table cells use — one
 * source for how a status is coloured, per the LeadChips rule.
 */
export function MobileRow({
  onClick,
  leading,
  title,
  meta,
  facts,
  trailing,
}: {
  onClick: () => void;
  /** Logo or avatar tile. */
  leading?: ReactNode;
  title: ReactNode;
  /** Muted one-liner under the title; truncates rather than wraps. */
  meta?: ReactNode;
  /** Chips and short values, in a wrap row under the meta line. */
  facts?: ReactNode;
  /** The one status that must survive triage — pinned to the title line. */
  trailing?: ReactNode;
}) {
  return (
    <div
      // py-4, not the table cells' py-3: a card stacks three lines where a
      // table row holds one, and the tighter inset read as clutter on a phone.
      className="hover:bg-muted/50 active:bg-muted/50 flex cursor-pointer items-start gap-3 px-4 py-4"
      onClick={onClick}
      // A row that navigates is a control — same contract as ClickRow above.
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
      {/* pt-0.5 seats the 32px tile on the title's optical line rather than
          the row's very top, which read as the logo floating. */}
      {leading ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-medium">{title}</div>
          {trailing ? <div className="shrink-0">{trailing}</div> : null}
        </div>
        {meta ? <div className="text-muted-foreground mt-0.5 truncate text-xs">{meta}</div> : null}
        {/* gap-y-1 keeps a wrapped second line of facts readable; mt-2.5 is
            what separates "facts about the record" from "the record's name" —
            a step larger than the title→meta gap, so the two groups read as
            two groups. gap-x-4: each fact leads with its own icon now, so the
            icons need enough water between them to read as leaders rather
            than trailers of the previous fact. */}
        {facts ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">{facts}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One fact in a MobileRow's facts line: the column's own glyph standing in for
 * the header the card doesn't have, the VALUE in foreground ink, the label in
 * muted — the same value-over-unit hierarchy RowStat gives the table, laid
 * flat. Pages pass the SAME lucide icon their Col[] uses for that column, so a
 * fact is findable across the two forms by its glyph.
 */
export function MobileFact({
  icon: Icon,
  value,
  children,
}: {
  icon: LucideIcon;
  /** The emphasized part — a count, a score. Omit for an all-muted fact
      (a relative date has no number worth lifting off the line). */
  value?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
      <span className="min-w-0">
        {value !== undefined && value !== null ? (
          <span className="text-foreground font-medium tabular-nums">{value}</span>
        ) : null}
        {value !== undefined && value !== null && children ? " " : null}
        {children}
      </span>
    </span>
  );
}
