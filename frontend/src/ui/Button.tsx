/**
 * Buttons, and the link that looks like one.
 *
 * Two exports rather than one component with an optional `href`: a button that
 * may or may not be an anchor needs a union of two different event and attribute
 * sets, and every call site then has to satisfy both. Separate names keep each
 * one honest about what it renders.
 */

import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "./Icon";

type Variant = "default" | "primary";

const classFor = (variant: Variant, small: boolean) =>
  `btn${variant === "primary" ? " pri" : ""}${small ? " sm" : ""}`;

export function Button({
  children,
  onClick,
  variant = "default",
  small = false,
  disabled = false,
  title,
  glyph,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  small?: boolean;
  disabled?: boolean;
  /** Shown on hover, and the only explanation a disabled control can give. */
  title?: string;
  glyph?: IconName;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className={classFor(variant, small)}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
    >
      {glyph ? <Icon name={glyph} size={13} /> : null}
      {children}
    </button>
  );
}

/**
 * A route link that looks like a button.
 *
 * Wraps the router's `Link` rather than a bare `<a href="#/…">`. A raw hash anchor
 * does navigate — HashRouter observes `location.hash` — but it goes around the
 * router, and it makes every call site spell out a route as a string with a `#`
 * prefix. Those literals are the one kind of route reference that would keep
 * compiling while silently breaking if the router ever changed.
 *
 * This is the design system's only dependency on the router. Accepted because the
 * alternative — a `Button` with `useNavigate` — gives up middle-click, right-click
 * and open-in-new-tab, which a link should never lose.
 */
export function LinkButton({
  children,
  to,
  variant = "default",
  small = false,
  glyph,
}: {
  children: ReactNode;
  /** A router path, with no leading `#`: "/leads", "/accounts/123". */
  to: string;
  variant?: Variant;
  small?: boolean;
  glyph?: IconName;
}) {
  return (
    <Link className={classFor(variant, small)} to={to}>
      {glyph ? <Icon name={glyph} size={13} /> : null}
      {children}
    </Link>
  );
}
