/**
 * The analyst-brief slice of the lead module's settings, called from the
 * widget playground. All three wrappers are LIVE.
 *
 * | handler        | args                                   | returns / effect        |
 * | -------------- | -------------------------------------- | ----------------------- |
 * | `settings-get` | —                                      | brief, agent, prompt (+ fields this page ignores) |
 * | `settings-put` | payload: `{scopeNotes, analystTask}`   | saves the briefing      |
 * | `settings-put` | payload: `{analystTask: ""}`           | restores the default task |
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

export const putPrompt = (fields: { scopeNotes: string; analystTask: string }) =>
  call<unknown>("settings-put", { payload: JSON.stringify(fields) });

/** An empty task restores the shipped default server-side, so the default
    wording lives in exactly one place instead of being copied into clients. */
export const resetAnalystTask = () =>
  call<unknown>("settings-put", { payload: JSON.stringify({ analystTask: "" }) });
