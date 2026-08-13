/**
 * The status pill.
 *
 * Tones are named for the colour they carry, not for what they mean on one
 * screen. The previous names (`hot`, `warm`, `good`) had to be mentally
 * translated to red/orange/green at every call site to know what would appear.
 */

import type { ReactNode } from "react";

export type Tone = "neutral" | "blue" | "green" | "orange" | "red";

export function Chip({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  /** The leading bullet, for a chip that reports a live state. */
  dot?: boolean;
}) {
  return (
    <span className={`chip ${tone}`}>
      {dot ? <span className="dot" /> : null}
      {children}
    </span>
  );
}
