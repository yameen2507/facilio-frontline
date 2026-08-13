/**
 * The visitor intake conversation. All three endpoints are LIVE — no seam here.
 *
 * | handler          | returns                                          |
 * | ---------------- | ------------------------------------------------ |
 * | `intake-start`   | `{ sessionToken, greeting }`                       |
 * | `intake-turn`    | `{ reply, extracted, missing[], complete }`        |
 * | `intake-submit`  | `{ refNo }`                                        |
 *
 * The agent itself is NOT called here — it is called from the page, because a
 * function aborts at the ~10s fetch timeout and a model call is slower than that.
 * `intake-turn` receives the reply the browser already obtained.
 */

import { request } from "../../../lib/request";

export type IntakeTurn = {
  reply: string;
  extracted: Record<string, unknown>;
  missing: string[];
  complete: boolean;
};

export const intakeStart = () =>
  request<{ sessionToken: string; greeting: string }>("intake-start", {
    sourceUrl: location.href,
    userAgent: navigator.userAgent,
  });

export const intakeTurn = (sessionToken: string, message: string, agentReply: string | undefined) =>
  request<IntakeTurn>("intake-turn", { sessionToken, message, agentReply });

export const intakeSubmit = (sessionToken: string) => request<{ refNo: string }>("intake-submit", { sessionToken });
