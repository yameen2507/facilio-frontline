/**
 * Settings data layer. Both endpoints are LIVE — no seam here.
 *
 * | handler        | returns / accepts                                        |
 * | -------------- | -------------------------------------------------------- |
 * | `settings-get` | `Settings`                                                |
 * | `settings-put` | SLA minutes as flat fields, or `payload` as a JSON string  |
 */

import { request, requestFrom } from "../../../lib/request";

// ── Survey module settings — served by the `survey` function, not `lead` ─────

export type SurveySettings = {
  /** D-e: 1_is_worst (5 = excellent, FM convention) or 5_is_worst (5 = filthy). FEEDS PRICING. */
  conditionScaleDirection: string;
  conditionScaleLabels: Record<string, string>;
  requirePhotoBelowCondition: number;
  geotagCapture: string;
  notVisitedWarnThresholdPct: number;
};

export const getSurveySettings = () => requestFrom<SurveySettings>("survey", "settings-get");

export const putSurveySettings = (fields: {
  conditionScaleDirection?: string;
  requirePhotoBelowCondition?: number;
  geotagCapture?: string;
}) =>
  requestFrom<{ applied: string[]; settings: SurveySettings }>("survey", "settings-put", {
    ...fields,
  });

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

// putSla is gone with its card (removed 2026-08-14): the response targets run
// on the seeded defaults and stay editable via `lead.settings-put` without UI.
// The `sla` field stays on the Settings type because `settings-get` returns it
// and createLead stamps due dates from it.

// The analyst-brief wrappers (putPrompt, resetAnalystTask) moved with their
// card to the widget playground and live in features/chat/api/analyst-util.ts —
// its own thin copy, since features never import each other's internals. The
// `prompt`/`brief`/`agent` fields stay on the Settings type above because
// `settings-get` still returns them.

/**
 * Service-line saves travel through the payload envelope for the same reason
 * the prompt fields do: clearing a Facilio link means sending
 * `facilioServiceId: ""`, and a blank flat field is dropped upstream. `active`
 * is passed back exactly as it came, so saving links never reactivates a line.
 */
export const putServiceLines = (
  lines: Array<{ code: string; name: string; active: boolean; facilioServiceId: string }>
) => request<unknown>("settings-put", { payload: JSON.stringify({ serviceLines: lines }) });
