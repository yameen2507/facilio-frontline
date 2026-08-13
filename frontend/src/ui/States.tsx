/**
 * Empty and error — two of the three states every fetching surface owes the user.
 * The third, loading, is Skeleton.tsx.
 *
 * Write these before the happy path. Most surfaces spend most of their early life
 * empty, and a list built happy-path-first gets an empty state bolted on badly.
 */

import type { ReactNode } from "react";
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
    <div className={`empty${tight ? " tight" : ""}`}>
      <div className="empty-title">{title}</div>
      {body ? <div className="empty-body">{body}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
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
    <div className={`empty${tight ? " tight" : ""}`}>
      <div className="empty-title err">Could not load this</div>
      <div className="err-msg">{message}</div>
      {onRetry ? (
        <div className="empty-action">
          <Button onClick={onRetry}>Try again</Button>
        </div>
      ) : null}
    </div>
  );
}
