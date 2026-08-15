/**
 * Settings data layer. Both endpoints are LIVE — no seam here.
 *
 * | handler         | returns / accepts                                       |
 * | --------------- | ------------------------------------------------------- |
 * | `settings-get`  | `Settings`                                               |
 * | `settings-put`  | SLA minutes as flat fields, or `payload` as a JSON string|
 * | `service-list`  | `Catalogue` — the services, their usage, the masters     |
 * | `service-save`  | one service through `payload`; answers with `Catalogue`  |
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

/**
 * One service this company sells.
 *
 * This app owns them (2026-08-15). `code` is how a rate card row, a proposal
 * line and a survey recommendation all name a service, so it is the identifier
 * that matters and it never changes once a service exists — see `saveService`.
 */
export type Service = {
  id: string;
  code: string;
  name: string;
  /** "true"/"false" string, like every boolean column. */
  active?: string;
  description?: string | null;
  /** Prefills a rate card row. Null means the row picks its own. */
  defaultPricingBasis?: string | null;
  /** Belongs to `defaultPricingBasis`; null when that is null. */
  defaultUom?: string | null;
};

/** Coverage's word for the same record. */
export type ServiceLine = Service;
/**
 * One place we operate. Shaped by `fl_service_area`, all five columns — the type
 * used to name only `id`/`name`/`country`, which meant the coverage editor had to
 * cast to reach the region it edits and the flag that pauses an area.
 */
export type Area = {
  id: string;
  name: string;
  region?: string | null;
  country?: string | null;
  /** "true"/"false" string, like every boolean column. */
  active?: string;
};
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

/**
 * A coverage edit: areas to add or amend, coverage links to switch on or off.
 *
 * THREE KEYS MUST NEVER APPEAR HERE, and the type is narrow so they can't:
 *
 *  - `scopeNotes` / `analystTask` — the handler tests `"scopeNotes" in p`, not
 *    whether it holds anything, so merely carrying the key writes it. A spread
 *    of some wider draft object would blank the analyst's briefing as a side
 *    effect of saving a checkbox. Build the object literally at the call site.
 *  - `serviceLines` — that branch calls `saveService` with code/name/active
 *    only, so it would wipe the description and default pricing basis of an
 *    existing service. The catalogue's write path is `saveService`, one page over.
 *
 * Everything sent is an UPSERT on a natural key — an area by `name`, a link by
 * its (area, service) pair — so a delta is the whole payload. Nothing omitted is
 * deleted, and re-sending the same edit is a no-op.
 */
export type CoverageEdit = {
  areas?: Array<{ name: string; region?: string; country?: string; active?: boolean }>;
  /** Both sides by human name/code — the handler resolves ids, callers never see them. */
  coverage?: Array<{ area: string; serviceLine: string; active?: boolean }>;
};

/**
 * `settings-put`, for coverage only. Answers with the whole refreshed settings —
 * including the recomposed `brief` — so a save needs no second read.
 *
 * Areas are processed before coverage in the same request, so ONE call can
 * create an area and link its first service: the link resolves the name from
 * what this very call just wrote, not from a stale read.
 */
export const putCoverage = (edit: CoverageEdit) =>
  request<{ applied: Record<string, number>; settings: Settings }>("settings-put", {
    payload: JSON.stringify(edit),
  });

// ── The Facilio outbox (F-09) ────────────────────────────────────────────────

/** A queued Facilio write that gave up — shaped by fl_sync_task. */
export type SyncFailure = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  action: string;
  attempts: number | string;
  lastError: string | null;
  updatedAt?: string | null;
};

/** `sync-status` — outbox counts by status plus the recent failures. A write
    that failed silently was F-09; this is where it stops being silent. */
export const getSyncStatus = () =>
  request<{ counts: Record<string, number | string>; failures: SyncFailure[] }>("sync-status");

/** `sync-retry` — requeue one failed task, attempts reset. */
export const retrySyncTask = (taskId: string) => request<{ ok: boolean }>("sync-retry", { taskId });

/** `sync-drain` — process queued writes now instead of waiting for the timer. */
export const drainSync = () =>
  request<{ results: Array<{ action: string; outcome: string; detail?: string }> }>("sync-drain", {
    batchSize: 5,
  });

// putSla is gone with its card (removed 2026-08-14): the response targets run
// on the seeded defaults and stay editable via `lead.settings-put` without UI.
// The `sla` field stays on the Settings type because `settings-get` returns it
// and createLead stamps due dates from it.

// The analyst-brief wrappers (putPrompt, resetAnalystTask) moved with their
// card to the widget playground and live in features/chat/api/analyst-util.ts —
// its own thin copy, since features never import each other's internals. The
// `prompt`/`brief`/`agent` fields stay on the Settings type above because
// `settings-get` still returns them.

// ── The service catalogue ────────────────────────────────────────────────────

/**
 * The catalogue with its usage counts, plus the basis/unit masters.
 *
 * `usage` is how many active rate card rows and proposal lines name each
 * service, keyed by code. It is what makes retiring a service an informed
 * decision rather than a surprise the estimator finds later.
 */
export type Catalogue = {
  services: Service[];
  usage: Record<string, number>;
  pricingBases: string[];
  /** The unit list DEPENDS on the basis — never hard-code a second copy. */
  unitsByBasis: Record<string, string[]>;
};

export const listServices = () => request<Catalogue>("service-list");

export type ServiceInput = {
  /** IMMUTABLE. An unrecognised code creates; a known one updates. */
  code: string;
  name: string;
  description: string;
  defaultPricingBasis: string;
  defaultUom: string;
  active: boolean;
};

/**
 * Create or update one service, through the payload envelope.
 *
 * The envelope is not optional here: clearing a description or a default basis
 * means sending `""`, and a blank flat field is dropped upstream — the same
 * reason the rate card saves use it. Through `payload` the empty string
 * survives, so a default an admin set can also be un-set.
 *
 * Answers with the whole refreshed catalogue, so a save needs no second read.
 */
export const saveService = (input: ServiceInput) =>
  request<Catalogue>("service-save", {
    payload: JSON.stringify({ ...input, active: input.active ? "true" : "false" }),
  });
