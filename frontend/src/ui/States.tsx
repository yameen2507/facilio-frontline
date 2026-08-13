/**
 * Empty and error — two of the three states every fetching surface owes the user.
 * The third, loading, is Skeleton.tsx.
 *
 * Write these before the happy path. Most surfaces spend most of their early life
 * empty, and a list built happy-path-first gets an empty state bolted on badly.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export function Empty({
  title,
  body,
  action,
  tight = false,
}: {
  /** What the surface will hold — not that it is blank. */
  title: string;
  body?: ReactNode;
  /** The action that would fill it. */
  action?: ReactNode;
  /**
   * WHEN TO SET THIS, because it was guessed at twice before being written down:
   *
   *   off (default) — a PAGE-LEVEL empty. The surface's whole reason for existing
   *                   is missing: an empty inbox, an empty account list. It fills
   *                   the card and takes the deep pad.
   *   on            — a SECTION empty inside a card that has other content around
   *                   it: no contacts on a company, no deals yet, no verdict on the
   *                   AI panel. The deep pad leaves a cavern mid-page.
   *
   * The test is not "is it inside a Card" — both are. It is whether the empty thing
   * IS the page or is one section of it.
   */
  tight?: boolean;
}) {
  return (
    <div className={cn("text-muted-foreground text-center", tight ? "px-4 py-6" : "px-4 py-11")}>
      <div className="text-foreground text-sm font-medium">{title}</div>
      {body ? <div className="mt-1 text-sm">{body}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * The backend's message, VERBATIM.
 *
 * Never a client-side rewrite: the user reads one thing while the logs say
 * another, and the real fix — better copy at the API — never gets made.
 */
export function ErrorState({
  message,
  onRetry,
  tight = false,
}: {
  message: string;
  onRetry?: () => void;
  tight?: boolean;
}) {
  return (
    <div className={cn("text-muted-foreground text-center", tight ? "px-4 py-6" : "px-4 py-11")}>
      <div className="text-destructive text-sm font-medium">Could not load this</div>
      <div className="text-destructive mt-1 text-sm">{message}</div>
      {onRetry ? (
        <div className="mt-4">
          <Button onClick={onRetry}>Try again</Button>
        </div>
      ) : null}
    </div>
  );
}
