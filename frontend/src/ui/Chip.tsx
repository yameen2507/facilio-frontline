/**
 * The status pill — shadcn's Badge with this app's tone vocabulary.
 *
 * Tones are named for the colour they carry, not for what they mean on one
 * screen. The previous names (`hot`, `warm`, `good`) had to be mentally
 * translated to red/orange/green at every call site to know what would appear.
 *
 * Status colours come from the Tailwind palette with explicit dark: pairs —
 * the shadcn theme has no semantic red/orange/green tokens, and this is the
 * idiomatic shadcn way to add them.
 */

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "blue" | "green" | "orange" | "red";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  blue: "border-transparent bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  green: "border-transparent bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
  orange: "border-transparent bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
  red: "border-transparent bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
};

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
    <Badge variant="outline" className={cn("rounded-full font-medium whitespace-nowrap", TONES[tone])}>
      {dot ? <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </Badge>
  );
}
