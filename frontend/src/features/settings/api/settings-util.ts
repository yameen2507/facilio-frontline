/**
 * Settings data layer. Both endpoints are LIVE — no seam here.
 *
 * | handler        | returns / accepts                                        |
 * | -------------- | -------------------------------------------------------- |
 * | `settings-get` | `Settings`                                                |
 * | `settings-put` | SLA minutes as flat fields, or `payload` as a JSON string  |
 */

import { request } from "../../../lib/request";

export type ServiceLine = { id: string; code: string; name: string };
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
 * The agent and prompt fields go through the `payload` envelope rather than as flat
 * fields, and that is not a style choice: clearing the scope notes means sending
 * `""`, and a blank flat field is dropped upstream as an unresolved
 * connection-action template — so the clear would silently never happen.
 */
export const putPrompt = (fields: {
  analystAgent: string;
  analystAgentLink: string;
  scopeNotes: string;
  analystTask: string;
}) => request<unknown>("settings-put", { payload: JSON.stringify(fields) });

/**
 * An empty task restores the shipped default server-side, so the default wording
 * lives in exactly one place instead of being copied into this client.
 */
export const resetAnalystTask = () => request<unknown>("settings-put", { payload: JSON.stringify({ analystTask: "" }) });
