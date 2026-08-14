/**
 * The prospect portfolio data layer.
 *
 * LIVE — every wrapper below has a handler behind it (`src/functions/prospect`,
 * built 2026-08-14). There are **no `[SEAM]` markers in this file**, and that is
 * a claim worth checking rather than trusting: the one thing the module still
 * cannot do is WRITE TO FACILIO, and rather than seam it, that action is absent.
 * See `canRunConvert` at the bottom for why, and what to flip when it lands.
 *
 * | handler             | args                                                  | returns                        |
 * | ------------------- | ----------------------------------------------------- | ------------------------------ |
 * | `list`              | dealId, type?, includeNoBid?                          | `{ locations[] }`              |
 * | `get`               | locationId                                            | `{ location }`                 |
 * | `site-list`         | dealId                                                | `{ sites[] }`                  |
 * | `create`            | dealId, type, name, parentId?, provenance?, address…  | `{ location }`                 |
 * | `reparent`          | locationId, newParentId?, actorEmail                  | `{ location, descendantsRestamped }` |
 * | `deactivate`        | locationId, reason?, actorEmail                       | `{ deactivated }`              |
 * | `set-decision`      | locationId, decision, note?, actorEmail               | `{ location }`                 |
 * | `set-verdict`       | locationId, verdict, note?, visitId?, actorEmail      | `{ location, discrepancy }`    |
 * | `copy-forward`      | sourceLocationId, dealId, parentId?, withDescendants? | `{ location, copied }`         |
 * | `link-facilio`      | locationId, facilioId, facilioModule, actorEmail      | `{ location }`                 |
 * | `convert-preflight` | dealId, dealIsWon                                     | `{ willCreate, willSkip, flags, rows[] }` |
 * | `reference`         | —                                                     | the closed enum sets           |
 *
 * On failure every call returns `{ data: null, error }` and the page renders that
 * message VERBATIM — never a client-side rewrite (§6's audit rule, and the user
 * reading one thing while the logs say another is how bad API copy survives).
 */

import { requestFrom, type Result } from "../../../lib/request";
import type {
  Conflict,
  ConvertState,
  LocationType,
  Preflight,
  ProspectLocation,
  ProspectObservation,
  PursuitDecision,
  ReconciliationDecision,
  SiteOption,
  Verdict,
} from "../types/prospect";

/** Its own platform function. A location is born three ways and only one is a
    walk, so the portfolio cannot live behind `survey` (v1.1 §2). */
const FN = "prospect";

const call = <T>(handler: string, args: Record<string, unknown> = {}): Promise<Result<T>> =>
  requestFrom<T>(FN, handler, args);

/**
 * The deal picker's options, read from the SURVEY function.
 *
 * A cross-FUNCTION read, not a cross-feature import: `requestFrom` names the
 * platform function, so this module still owns its whole data layer and stays
 * deletable. Duplicating a `deal-list` handler onto `prospect` would be two
 * queries to maintain against one table for no gain — the proposals module reads
 * `survey.revision-list` the same way.
 *
 * This picker exists only because the Deal detail surface does not (`F-14`).
 * v1.1 §8 puts the portfolio on a tab there; when that page lands, this page
 * becomes the tab's body and the picker goes away.
 */
export const listDeals = () =>
  requestFrom<{
    deals: Array<{ id: string; refNo: string; title: string | null; accountName: string | null }>;
  }>("survey", "deal-list", {});

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * `prospect.list` — the whole tree for a pursuit.
 *
 * Comes back ordered by `ancestry_path`, which IS depth-first tree order, so the
 * page renders it in sequence and adds no client-side sort. `no_bid` rows are
 * excluded by default because they drop out of every total; the tree asks for
 * them explicitly so a dropped site is still visible to the person who dropped it.
 */
export const listLocations = (dealId: string, includeNoBid = true) =>
  call<{ locations: ProspectLocation[] }>("list", { dealId, includeNoBid: String(includeNoBid) });

export const getLocation = (locationId: string) =>
  call<{ location: ProspectLocation }>("get", { locationId });

/** `prospect.site-list` — what every "which property?" picker reads. */
export const listSites = (dealId: string) => call<{ sites: SiteOption[] }>("site-list", { dealId });

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * `prospect.create` — `name` is the only required descriptive field.
 *
 * That is deliberate and it is the module's adoption bet: a phone call gives you
 * "the Bleecker Street store" and nothing else, and a form that demands an area
 * before it will save has already lost to the spreadsheet (v1.1 §3).
 */
export const createLocation = (
  dealId: string,
  type: LocationType,
  name: string,
  actorEmail: string,
  opts: {
    parentId?: string;
    provenance?: string;
    code?: string;
    clientLevelLabel?: string;
    addressLine?: string;
    city?: string;
    region?: string;
    country?: string;
    postcode?: string;
  } = {}
) => call<{ location: ProspectLocation }>("create", { dealId, type, name, actorEmail, ...opts });

/**
 * `prospect.reparent` — moves a location AND re-stamps its whole subtree.
 *
 * `descendantsRestamped` comes back so the page can say how many rows moved with
 * it: dragging a building silently rewriting forty spaces is the kind of thing a
 * user needs told, not left to infer.
 */
export const reparentLocation = (
  locationId: string,
  newParentId: string | null,
  actorEmail: string
) =>
  call<{ location: ProspectLocation; descendantsRestamped: number }>("reparent", {
    locationId,
    actorEmail,
    ...(newParentId ? { newParentId } : {}),
  });

/** `prospect.deactivate` — soft, always, and it takes the subtree with it. */
export const deactivateLocation = (locationId: string, reason: string, actorEmail: string) =>
  call<{ deactivated: number }>("deactivate", { locationId, reason, actorEmail });

/** `prospect.set-decision` — the bid/no-bid call. A note is required on no_bid. */
export const setDecision = (
  locationId: string,
  decision: PursuitDecision,
  note: string,
  actorEmail: string
) => call<{ location: ProspectLocation }>("set-decision", { locationId, decision, note, actorEmail });

/**
 * `prospect.set-verdict` — is it real?
 *
 * `discrepancy: true` means the location already carries a Facilio id and the
 * survey found it CHANGED, so nothing was written to Facilio and a person has to
 * look. That is the one response here the caller must not treat as routine.
 */
export const setVerdict = (
  locationId: string,
  verdict: Verdict,
  note: string,
  actorEmail: string,
  visitId?: string
) =>
  call<{ location: ProspectLocation; discrepancy: boolean }>("set-verdict", {
    locationId,
    verdict,
    note,
    actorEmail,
    ...(visitId ? { visitId } : {}),
  });

/** `prospect.copy-forward` — the same building, on an earlier deal (§5.4). */
export const copyForward = (
  sourceLocationId: string,
  dealId: string,
  actorEmail: string,
  opts: { parentId?: string; withDescendants?: boolean } = {}
) =>
  call<{ location: ProspectLocation; copied: number }>("copy-forward", {
    sourceLocationId,
    dealId,
    actorEmail,
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    ...(opts.withDescendants ? { withDescendants: "true" } : {}),
  });

/** `prospect.link-facilio` — a HUMAN confirms the match; we never guess. */
export const linkFacilio = (
  locationId: string,
  facilioId: string,
  facilioModule: LocationType,
  actorEmail: string
) =>
  call<{ location: ProspectLocation }>("link-facilio", {
    locationId,
    facilioId,
    facilioModule,
    actorEmail,
  });

// ── Observations (§4.3) ──────────────────────────────────────────────────────

/**
 * `prospect.observe` — record a value, and let the server decide what happens.
 *
 * The caller does NOT choose the outcome, and that is the point: `auto_accept`
 * when nothing was recorded yet, `agrees` when a second feed says the same thing,
 * `conflict` when they disagree — and on a conflict the location's attribute is
 * deliberately NOT written until a person resolves it.
 *
 * `conflictsWith` carries the value it disagreed with, so the caller can show both
 * side by side without a second round trip.
 */
export const observe = (
  locationId: string,
  fieldKey: string,
  value: string,
  actorEmail: string,
  opts: { provenance?: string; surveyId?: string; visitId?: string } = {}
) =>
  call<{
    observation: ProspectObservation;
    outcome: "auto_accept" | "agrees" | "conflict";
    reason: string;
    conflictsWith: ProspectObservation | null;
  }>("observe", { locationId, fieldKey, value, actorEmail, ...opts });

/** `prospect.observation-list` — the history behind every attribute. */
export const listObservations = (locationId: string) =>
  call<{ observations: ProspectObservation[] }>("observation-list", { locationId });

/** `prospect.reconcile-list` — open disagreements across a pursuit. */
export const listConflicts = (dealId: string) =>
  call<{ conflicts: Conflict[] }>("reconcile-list", { dealId });

/**
 * `prospect.reconcile-decide` — a person closes one disagreement.
 *
 * `pushed_to_clarification` writes no value on purpose: the question has gone
 * back to the tenderer, and a placeholder would hide an open scope question.
 */
export const decideObservation = (
  locationId: string,
  fieldKey: string,
  decision: ReconciliationDecision,
  actorEmail: string,
  manualValue?: string
) =>
  call<{ resolved: boolean; cached: boolean; winner: ProspectObservation | null }>(
    "reconcile-decide",
    { locationId, fieldKey, decision, actorEmail, ...(manualValue ? { manualValue } : {}) }
  );

// ── Convert ──────────────────────────────────────────────────────────────────

/** `prospect.convert-preflight` — READ-ONLY. Touches Facilio not at all. */
export const convertPreflight = (dealId: string, dealIsWon: boolean) =>
  call<Preflight>("convert-preflight", { dealId, dealIsWon: String(dealIsWon) });

/**
 * The convert RUN does not exist, and this flag is the entry point that stays
 * disabled until it does.
 *
 * **What to flip:** set this to `true` only once `prospect.convert-to-facilio` is
 * registered. **What else must change with it:** the Convert screen's primary
 * button currently renders disabled with `CONVERT_BLOCKED_REASON` beside it; that
 * reason line comes out at the same time, and the button needs a progress view,
 * because §7.5 requires the write to be synchronous with polling rather than
 * async (an async function run dies on restart).
 *
 * **Why it is blocked rather than seamed:** the module's whole safety claim is
 * that nothing writes to Facilio except that one handler. A wrapper that posts to
 * a route which does not exist is a promise the module is specifically built not
 * to make. G1 is open — L9 (mandatory Facilio enums), L20 (does the API accept a
 * space directly under a site?), L21 (can our role deactivate, for the reverse
 * walk?) and L22 (client contact create) are all unanswered.
 */
export const canRunConvert = false;

export const CONVERT_BLOCKED_REASON =
  "Writing to Facilio is not switched on yet — the connection questions in G1 are still open, so the pre-flight below reports what would happen without touching anything.";

/** Convert states that mean this location will never be written. */
export const TERMINAL_CONVERT_STATES: ConvertState[] = ["converted", "already_linked", "excluded"];
