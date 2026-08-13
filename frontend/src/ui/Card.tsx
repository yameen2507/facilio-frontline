/**
 * A surface, optionally with a header.
 *
 * `pad` off when the body is a row list that supplies its own padding — a padded
 * wrapper around full-bleed rows leaves a gutter down both sides that no row
 * divider reaches across.
 */

import type { CSSProperties, ReactNode } from "react";

export function Card({
  title,
  meta,
  children,
  pad = true,
  style,
}: {
  /** Omit for a plain surface with no header — that is what a row list is. */
  title?: string;
  /** The muted note on the right of the header. */
  meta?: ReactNode;
  children?: ReactNode;
  pad?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className="card" style={style}>
      {title ? (
        <header>
          <h3>{title}</h3>
          <span className="grow" />
          {meta ? <span className="head-meta">{meta}</span> : null}
        </header>
      ) : null}
      {pad ? <div className="in">{children}</div> : children}
    </div>
  );
}

/** The small uppercase label that divides content inside a card body. */
export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <div className="sec-t">{children}</div>
);

/** Vertical group of cards. */
export const Stack = ({ children }: { children: ReactNode }) => <div className="stack">{children}</div>;

/** The two-column page split; collapses to one column under 1080px. */
export const Split = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div className="split" style={style}>
    {children}
  </div>
);

/** Horizontal action bar. */
export const Bar = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div className="bar" style={style}>
    {children}
  </div>
);
