/**
 * Prospect portfolio types — `Prospect Portfolio Module v1.1.md` §5.1.
 *
 * The vocabulary is v1.1's and §0a's: a row is a **location**, its level is
 * `type`, and "node" is purged. If you are looking for `nodeType`, the survey
 * lane's older read shape had it; this is the one that matches the table.
 *
 * Booleans are STRINGS across this codebase — `"true"` / `"false"` — because the
 * app database has no boolean column. `if (l.isActive)` is true for `"false"`.
 */

/** The same three words Facilio uses, so convert translates nothing. */
export type LocationType = "site" | "building" | "space";

export const LOCATION_TYPES: LocationType[] = ["site", "building", "space"];

export const TYPE_LABEL: Record<LocationType, string> = {
  site: "Site",
  building: "Building",
  space: "Space",
};

/** §4.1 — is this real? */
export type Verdict =
  | "unverified"
  | "added_on_site"
  | "verified"
  | "changed"
  | "not_found"
  | "not_visited";

export const VERDICTS: Verdict[] = [
  "unverified",
  "added_on_site",
  "verified",
  "changed",
  "not_found",
  "not_visited",
];

export const VERDICT_LABEL: Record<Verdict, string> = {
  unverified: "Unverified",
  added_on_site: "Found on site",
  verified: "Verified",
  changed: "Changed",
  not_found: "Not found",
  not_visited: "Not visited",
};

/**
 * The three that print on the proposal as a qualification, so the note is
 * mandatory. Mirrors `src/domain/prospect-state.ts` — that copy decides.
 */
export const VERDICTS_NEEDING_NOTE: Verdict[] = ["changed", "not_found", "not_visited"];

export const verdictNeedsNote = (v: Verdict) => VERDICTS_NEEDING_NOTE.includes(v);

/** §4.2 — is it in Facilio yet? */
export type ConvertState =
  | "not_converted"
  | "queued"
  | "converted"
  | "convert_failed"
  | "excluded"
  | "already_linked";

export const CONVERT_STATE_LABEL: Record<ConvertState, string> = {
  not_converted: "Not in Facilio",
  queued: "Queued",
  converted: "In Facilio",
  convert_failed: "Convert failed",
  excluded: "Excluded",
  already_linked: "Already in Facilio",
};

/** §5.1 — the bid / no-bid call, per site. */
export type PursuitDecision = "undecided" | "bid" | "no_bid" | "deferred";

export const PURSUIT_DECISIONS: PursuitDecision[] = ["undecided", "bid", "no_bid", "deferred"];

export const DECISION_LABEL: Record<PursuitDecision, string> = {
  undecided: "Undecided",
  bid: "Bid",
  no_bid: "No bid",
  deferred: "Deferred",
};

/** Which feed said it — the RFP and the surveyor WILL disagree (C25). */
export type Provenance = "rfp" | "survey" | "crm" | "facilio_link" | "manual";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  rfp: "From documents",
  survey: "From the walk",
  crm: "Earlier pursuit",
  facilio_link: "Linked from Facilio",
  manual: "Entered by hand",
};

export type CeilingBand = "standard_8_10ft" | "high_10_20ft" | "very_high_20ft_plus";

export const CEILING_LABEL: Record<CeilingBand, string> = {
  standard_8_10ft: "8–10 ft",
  high_10_20ft: "10–20 ft (may need a lift)",
  very_high_20ft_plus: "20 ft+ (lift or scaffolding)",
};

export type ProspectLocation = {
  id: string;
  dealId: string;
  surveyId?: string | null;
  type: LocationType;
  parentId?: string | null;
  /** The materialised lineage. Sorting by it IS depth-first tree order. */
  ancestryPath: string;
  name: string;
  code?: string | null;
  /** What the CLIENT calls this level — "facility", "tower", "block". */
  clientLevelLabel?: string | null;
  tagsJson?: string | null;
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  areaSqft?: number | null;
  floorCount?: number | null;
  roomCount?: number | null;
  restroomCount?: number | null;
  floorLabel?: string | null;
  ceilingHeightBand?: CeilingBand | null;
  spaceCategory?: string | null;
  pursuitDecision: PursuitDecision;
  pursuitDecisionNote?: string | null;
  provenance: Provenance;
  sourceAttachmentId?: string | null;
  verdict: Verdict;
  verdictNote?: string | null;
  verdictBy?: string | null;
  verdictAt?: string | null;
  verdictVisitId?: string | null;
  facilioId?: string | null;
  facilioModule?: string | null;
  previousPursuitId?: string | null;
  convertState: ConvertState;
  createdAt?: string | null;
};

/** A site as the pickers need it — `site-list` returns this, not the full row. */
export type SiteOption = {
  id: string;
  name: string;
  code?: string | null;
  facilioId?: string | null;
  city?: string | null;
  addressLine?: string | null;
  /** Buildings and spaces beneath it. A platform `count(*)` arrives as a STRING. */
  childCount?: number | string | null;
};

/** One row of `convert-preflight`. */
export type PreflightRow = {
  locationId: string;
  name: string;
  type: LocationType;
  action: "create" | "skip" | "flag";
  reason: string;
  blockers: string[];
};

export type Preflight = {
  dealIsWon: boolean;
  willCreate: number;
  willSkip: number;
  flags: number;
  rows: PreflightRow[];
};

/**
 * A location plus its depth, which the tree needs and the table does not store.
 *
 * Depth is DERIVED from `ancestry_path` rather than counted by walking parents:
 * the path already holds the whole chain, and a row whose parent is missing
 * still renders at its true depth instead of silently jumping to the root — which
 * is exactly the C3 failure the ancestry rule exists to make visible.
 */
export type TreeRow = ProspectLocation & { depth: number; orphaned: boolean };

export function toTree(locations: ProspectLocation[]): TreeRow[] {
  const byId = new Map(locations.map((l) => [l.id, l]));
  return locations.map((l) => ({
    ...l,
    depth: Math.max(0, (l.ancestryPath ?? "").split("/").filter(Boolean).length - 1),
    orphaned: Boolean(l.parentId) && !byId.has(l.parentId as string),
  }));
}

/** Which levels may sit under this one — mirrors `parentBlocker` in domain/. */
export function childTypesOf(type: LocationType): LocationType[] {
  if (type === "site") return ["building", "space"];
  if (type === "building") return ["space"];
  return [];
}

/** A no_bid row drops out of every total (§5.1). */
export const countsTowardScope = (d: PursuitDecision) => d !== "no_bid";

// ── Observations (§4.3) ──────────────────────────────────────────────────────

/**
 * One thing a feed said about one field of one location.
 *
 * `locationId` is the read alias; the physical column is `prospect_node_id`, from
 * before §0a purged "node". There is no ALTER on this platform, so the name
 * stays and the query aliases it.
 *
 * Append-only. A value that lost a reconciliation is superseded, never deleted —
 * the chain is how "who said 4,500 and when" survives the decision that
 * replaced it.
 */
export type ProspectObservation = {
  id: string;
  locationId: string;
  dealId: string;
  surveyId?: string | null;
  fieldKey: string;
  valueText?: string | null;
  valueNumber?: number | null;
  provenance: Provenance;
  observedBy?: string | null;
  observedAt?: string | null;
  visitId?: string | null;
  /** A STRING, like every boolean here. `"false"` is truthy. */
  isAccepted?: string | null;
  acceptedBy?: string | null;
  acceptedAt?: string | null;
  supersededByObservationId?: string | null;
  reconciliationDecision?: string | null;
};

/** One field where two feeds disagree and nobody has chosen yet. */
export type Conflict = {
  locationId: string;
  locationName: string;
  fieldKey: string;
  label: string;
  accepted: ProspectObservation | null;
  pending: ProspectObservation[];
};

export type ReconciliationDecision =
  | "accepted_survey"
  | "accepted_rfp"
  | "manual_override"
  | "pushed_to_clarification";

export const RECONCILIATION_DECISION_LABEL: Record<ReconciliationDecision, string> = {
  accepted_survey: "Take the survey value",
  accepted_rfp: "Take the document value",
  manual_override: "Use a different value",
  pushed_to_clarification: "Ask the client",
};

/**
 * The fields an observation may set — mirrors `src/domain/observation-state.ts`,
 * which is the copy that decides. Kept in step by hand, like the template
 * builder's field-type list.
 */
export const OBSERVABLE_FIELD_LABEL: Record<string, string> = {
  name: "Name",
  code: "Client reference",
  area_sqft: "Area (sq ft)",
  floor_count: "Floors",
  room_count: "Rooms",
  restroom_count: "Restrooms",
  floor_label: "Floor",
  ceiling_height_band: "Ceiling height",
  space_category: "Category",
  address_line: "Address",
  city: "City",
  region: "Region",
  country: "Country",
  postcode: "Postcode",
  latitude: "Latitude",
  longitude: "Longitude",
};

/** Which fields are numeric, so the detail form asks for the right keyboard. */
export const NUMERIC_FIELDS = [
  "area_sqft",
  "floor_count",
  "room_count",
  "restroom_count",
  "latitude",
  "longitude",
];

export const OBSERVABLE_FIELDS = Object.keys(OBSERVABLE_FIELD_LABEL);

/** How a value reads, whichever typed column holds it. Zero is a real answer. */
export function observationValue(o: {
  valueText?: string | null;
  valueNumber?: number | null;
}): string {
  if (o.valueNumber !== null && o.valueNumber !== undefined) return String(o.valueNumber);
  return o.valueText ?? "";
}

export const isAcceptedObservation = (o: ProspectObservation) => o.isAccepted === "true";
