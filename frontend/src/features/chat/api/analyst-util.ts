/**
 * The analyst-brief slice of the lead module's settings, called from the
 * intake agent page. Both wrappers are LIVE.
 *
 * | handler        | args                                   | returns / effect        |
 * | -------------- | -------------------------------------- | ----------------------- |
 * | `settings-get` | —                                      | brief, agent, prompt (+ fields this page ignores) |
 * | `settings-put` | payload: `{scopeNotes, analystTask}`   | saves; an empty task restores the shipped default |
 *
 * A deliberate thin COPY of the settings feature's wrappers, not an import:
 * features never reach into each other's internals (the precedent is
 * surveys-util's own `listPublishedTemplates` over the `form` function), and
 * this duplicate is the cheapest honest boundary.
 *
 * The prompt fields go through the `payload` envelope rather than as flat
 * fields, and that is not a style choice: clearing the scope notes means
 * sending `""`, and a blank flat field is dropped upstream as an unresolved
 * connection-action template — the clear would silently never happen.
 */

import { requestFrom, type Result } from "../../../lib/request";

/** Only what the analyst card reads — `settings-get` returns more, ignored here. */
export type AnalystSettings = {
  /** The generated service brief the analyst is given, built from coverage. */
  brief?: string | null;
  agent?: { name: string; link: string; linkConfigured: boolean } | null;
  prompt?: { scopeNotes: string; analystTask: string } | null;
};

const call = <T>(handler: string, args: Record<string, unknown> = {}): Promise<Result<T>> =>
  requestFrom<T>("lead", handler, args);

export const getAnalystSettings = () => call<AnalystSettings>("settings-get");

/** Returns the refreshed settings so the caller can reseed its draft — an empty
    `analystTask` is restored to the shipped default SERVER-side, and only the
    response says what that wording is. */
export const putPrompt = (fields: { scopeNotes: string; analystTask: string }) =>
  call<{ settings: AnalystSettings }>("settings-put", { payload: JSON.stringify(fields) });
