/**
 * The one place a handler call is made.
 *
 * Handlers answer with `{ ok, data?, error? }`, so a REJECTION IS A NORMAL
 * RESPONSE, not an exception. That is why this returns `{ data, error }` instead
 * of throwing: a page needs to render the failure, and a thrown error forces
 * every call site into a try/catch that then has to decide what to do anyway.
 *
 * The server's message is passed through VERBATIM. Never reword a backend error
 * here — the user reads one thing, the logs say another, and the real fix (better
 * copy at the API) never gets made.
 */

import { FUNCTION, vibe } from "./vibe";

export type Result<T> = { data: T | null; error: string | null };

type Envelope<T> = { ok?: boolean; data?: T; error?: string };

export async function request<T>(handler: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  try {
    const res = await vibe.executeFunction<Envelope<T>>(FUNCTION, handler, args);

    if (res && res.ok === false) {
      return { data: null, error: res.error ?? `${handler} was rejected` };
    }
    // Some handlers answer with the envelope, some with the payload directly.
    const data = (res && "data" in res ? res.data : (res as unknown)) as T;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: errMessage(err, `${handler} could not be reached`) };
  }
}

export function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

/**
 * Merges a partial response over a complete default, so a handler that omits a
 * field renders a usable surface instead of crashing on `undefined`.
 */
export const withDefaults = <T extends object>(defaults: T, partial: Partial<T> | null | undefined): T => ({
  ...defaults,
  ...(partial ?? {}),
});
