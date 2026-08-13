/**
 * Settings data layer. Both endpoints are LIVE — no seam here.
 *
 * | handler        | returns / accepts                                        |
 * | -------------- | -------------------------------------------------------- |
 * | `settings-get` | `Settings`                                                |
 * | `settings-put` | SLA minutes as flat fields, or `payload` as a JSON string  |
 */

import { request } from "../../../lib/request";

export type ServiceLine = {
  id: string;
  code: string;
  name: string;
  /** "true"/"false" string, like every boolean column. */
  active?: string;
  /**
   * The Facilio Services record id this line maps to. Every service referenced
   * on a quote line, rate card entry or survey template must ultimately be a
   * Facilio Services id, never the local line — null means "not linked yet",
   * which is every line until the Services read is verified on the connection.
   */
  facilioServiceId?: string | null;
};
export type Area = { id: string; name: string; country?: string | null };
/** `active` is the string "true"/"false" — there is no boolean column type. */
export type Coverage = { areaId: string; serviceLineId: string; active: string };

export type Settings = {
  sla: { firstResponseMins: number; qualificationMins: number; assignmentMins: number };
  areas: Area[];
  serviceLines: ServiceLine[];
  coverage: Coverage[];
  /** The generated service brief the analyst is given, built from coverage. */
  brief?: string | null;
  agent?: { name: string; link: string; linkConfigured: boolean } | null;
  prompt?: { scopeNotes: string; analystTask: string } | null;
};

export const getSettings = () => request<Settings>("settings-get");

/** The response targets travel as flat numeric fields. */
export const putSla = (sla: Settings["sla"]) => request<unknown>("settings-put", { ...sla });

/**
 * The prompt fields go through the `payload` envelope rather than as flat
 * fields, and that is not a style choice: clearing the scope notes means sending
 * `""`, and a blank flat field is dropped upstream as an unresolved
 * connection-action template — so the clear would silently never happen.
 *
 * The agent identifiers (`analystAgent`, `analystAgentLink`) are accepted by the
 * same handler but are no longer sent from the console — they are CLI-managed,
 * and the UI inputs for them only ever collected mistyped copies. An absent key
 * leaves the saved value alone, like resetAnalystTask's partial payload.
 */
export const putPrompt = (fields: { scopeNotes: string; analystTask: string }) =>
  request<unknown>("settings-put", { payload: JSON.stringify(fields) });

/**
 * An empty task restores the shipped default server-side, so the default wording
 * lives in exactly one place instead of being copied into this client.
 */
export const resetAnalystTask = () => request<unknown>("settings-put", { payload: JSON.stringify({ analystTask: "" }) });

/**
 * Service-line saves travel through the payload envelope for the same reason
 * the prompt fields do: clearing a Facilio link means sending
 * `facilioServiceId: ""`, and a blank flat field is dropped upstream. `active`
 * is passed back exactly as it came, so saving links never reactivates a line.
 */
export const putServiceLines = (
  lines: Array<{ code: string; name: string; active: boolean; facilioServiceId: string }>
) => request<unknown>("settings-put", { payload: JSON.stringify({ serviceLines: lines }) });
