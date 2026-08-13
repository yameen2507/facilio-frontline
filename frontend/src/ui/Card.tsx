/**
 * A surface, optionally with a header — shadcn's Card with this app's header
 * and padding model (a bordered micro-label header, body padding that can be
 * turned off) instead of the stock gap-6/py-6 stack.
 *
 * `pad` off when the body is a row list that supplies its own padding — a padded
 * wrapper around full-bleed rows leaves a gutter down both sides that no row
 * divider reaches across.
 */

import type { CSSProperties, ReactNode } from "react";
import { Card as UICard } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Card({
  title,
  meta,
  children,
  pad = true,
  style,
  className,
}: {
  /** Omit for a plain surface with no header — that is what a row list is.
      A node rather than a string so a skeleton can put a shimmer bar here. */
  title?: ReactNode;
  /** The muted note on the right of the header. */
  meta?: ReactNode;
  children?: ReactNode;
  pad?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <UICard className={cn("gap-0 overflow-hidden py-0", className)} style={style}>
      {title ? (
        <header className="flex items-center gap-3 border-b px-4 py-2.5">
          <h3 className="text-muted-foreground text-xs font-medium tracking-[0.06em] uppercase">
            {title}
          </h3>
          <span className="flex-1" />
          {meta ? <span className="text-muted-foreground text-xs">{meta}</span> : null}
        </header>
      ) : null}
      {pad ? <div className="p-4">{children}</div> : children}
    </UICard>
  );
}

/** The small uppercase label that divides content inside a card body. */
export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <div className="text-muted-foreground mt-4 mb-1 text-[10px] font-medium tracking-[0.06em] uppercase">
    {children}
  </div>
);

/** Vertical group of cards. */
export const Stack = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col gap-5">{children}</div>
);

/** The two-column page split; collapses to one column under 1080px. */
export const Split = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div
    className="grid grid-cols-1 items-start gap-5 min-[1080px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
    style={style}
  >
    {children}
  </div>
);

/** Horizontal action bar. */
export const Bar = ({
  children,
  style,
  className,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) => (
  <div className={cn("flex flex-wrap items-center gap-2", className)} style={style}>
    {children}
  </div>
);
