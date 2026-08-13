/**
 * Buttons, and the link that looks like one — thin adapters over shadcn's
 * Button so the app's call sites keep their two-variant vocabulary
 * ("default" outline, "primary" filled) while the styling comes from the
 * design system.
 *
 * Two exports rather than one component with an optional `href`: a button that
 * may or may not be an anchor needs a union of two different event and attribute
 * sets, and every call site then has to satisfy both. Separate names keep each
 * one honest about what it renders.
 */

import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button as UIButton } from "@/components/ui/button";
import { Icon, type IconName } from "./Icon";

type Variant = "default" | "primary";

const uiVariant = (variant: Variant): "default" | "outline" =>
  variant === "primary" ? "default" : "outline";

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
  const button = (
    <UIButton
      type="button"
      variant={uiVariant(variant)}
      size={small ? "sm" : "default"}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
    >
      {glyph ? <Icon name={glyph} size={13} /> : null}
      {children}
    </UIButton>
  );

  // shadcn's disabled state sets pointer-events-none, which also swallows the
  // title tooltip — the one explanation a disabled control can give. The inert
  // wrapper takes over hover duty only in that state.
  return disabled && title ? <span title={title}>{button}</span> : button;
}

/**
 * A route link that looks like a button.
 *
 * Wraps the router's `Link` (via asChild) rather than a bare `<a href="#/…">`:
 * a raw hash anchor navigates around the router, and it makes every call site
 * spell out a route as a string with a `#` prefix — the one kind of route
 * reference that keeps compiling while silently breaking if the router changed.
 * A `Button` with `useNavigate` would give up middle-click, right-click and
 * open-in-new-tab, which a link should never lose.
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
    <UIButton asChild variant={uiVariant(variant)} size={small ? "sm" : "default"}>
      <Link to={to}>
        {glyph ? <Icon name={glyph} size={13} /> : null}
        {children}
      </Link>
    </UIButton>
  );
}
