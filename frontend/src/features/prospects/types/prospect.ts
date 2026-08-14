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

/**
 * The same five words Facilio uses, so convert translates nothing (v1.3 §2.3).
 *
 * `floor` is a REAL level, not a count on the building — it is its own module in
 * Facilio with 10,139 live rows. Every level is optional except `site`: a space
 * may hang off a floor, a building, a site, or another space (five deep).
 */
export type LocationType = "site" | "building" | "floor" | "space" | "zone";

export const LOCATION_TYPES: LocationType[] = ["site", "building", "floor", "space", "zone"];

export const TYPE_LABEL: Record<LocationType, string> = {
  site: "Site",
  building: "Building",
  floor: "Floor",
  space: "Space",
  zone: "Zone",
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

/**
 * ONE VOCABULARY (§6.2). These exact words go in the chips, the settle picker
 * and every message — the build used one set of words for the chips and a
 * different set for the picker, and leaked the raw `rfp` into a third place.
 * Mirrors `src/domain/observation-state.ts`, which produces the server's copy.
 */
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  rfp: "From documents",
  survey: "From the walk",
  crm: "From an earlier pursuit",
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
  /** §4 — three owners, at least one always set. All three may be read. */
  leadId?: string | null;
  accountId?: string | null;
  dealId?: string | null;
  surveyId?: string | null;
  /** Shared by every row that is the same physical building, across pursuits. */
  buildingKey?: string | null;
  previousPursuitId?: string | null;
  type: LocationType;
  parentId?: string | null;
  /** The materialised lineage. Sorting by it IS depth-first tree order. */
  ancestryPath: string;
  /** §2.3 rule 4 — the ancestry Facilio itself stores, as ids. */
  siteId?: string | null;
  buildingId?: string | null;
  floorId?: string | null;
  name: string;
  description?: string | null;
  code?: string | null;
  /** Facilio's own human-readable number, back-filled at convert. */
  localId?: number | null;
  /** What the CLIENT calls this level — "facility", "tower", "block". */
  clientLevelLabel?: string | null;
  /** A JSON array as TEXT — parse before use. The column is not `_json`. */
  tags?: string | null;
  // §3.2 — the address is a Location record in Facilio, so it takes those names.
  locationName?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  locationPhone?: string | null;
  facilioLocationId?: string | null;
  // §3.3 — size and shape.
  area?: number | null;
  grossFloorArea?: number | null;
  noOfBuildings?: number | null;
  noOfFloors?: number | null;
  noOfIndependentSpaces?: number | null;
  noOfSubSpaces?: number | null;
  /** An integer: -1 basement, 0 ground, 1 first. The name lives in `name`. */
  floorLevel?: number | null;
  maxOccupancy?: number | null;
  operationHoursStart?: number | null;
  operationHoursEnd?: number | null;
  spaceCategoryId?: string | null;
  siteType?: string | null;
  classification?: string | null;
  roomCount?: number | null;
  restroomCount?: number | null;
  ceilingHeightBand?: CeilingBand | null;
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
  /** Facilio's own name for it (§3.2) — was `addressLine` before v1.3. */
  street?: string | null;
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
/**
 * What may be created INSIDE a given level, mirroring Facilio's own modules
 * (verified against `get-<module>-metadata`, 15 Aug) and `PARENT_TYPES` in
 * `src/domain/prospect-state.ts`, which is the copy the server enforces.
 *
 * Every level below site is optional, which is why a site offers `space`
 * directly as well as `building` — 25,110 live Facilio spaces have no building,
 * and a car park under a site is the ordinary case, not an edge one.
 *
 * A space accepts a space: that is the sub-space nesting, and Facilio's
 * `create-space` takes a `space` parent for exactly this.
 */
export function childTypesOf(type: LocationType): LocationType[] {
  if (type === "site") return ["building", "floor", "space", "zone"];
  if (type === "building") return ["floor", "space"];
  if (type === "floor") return ["space"];
  if (type === "space") return ["space"];
  return [];
}

/**
 * The ancestors Facilio's create action REQUIRES for a level — not the
 * immediate parent, the whole chain. `create-floor` wants `site` AND
 * `building`; `create-space` wants `site` even when a floor is also given.
 * Mirrors FACILIO_REQUIRED_ANCESTORS on the server.
 */
export const FACILIO_REQUIRED_ANCESTORS: Record<LocationType, LocationType[]> = {
  site: [],
  building: ["site"],
  floor: ["site", "building"],
  space: ["site"],
  zone: ["site"],
};

/** Facilio has no `create-zone` action, so a zone can never be converted. */
export const CONVERTIBLE_TYPES: LocationType[] = ["site", "building", "floor", "space"];

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
 * The editable fields, grouped exactly as §3 groups them — because the one edit
 * form renders them in these groups and §6.2 says "grouped as §3 groups them".
 *
 * Mirrors `src/domain/observation-state.ts`, which is the copy that decides.
 * Kept in step by hand, like the template builder's field-type list.
 *
 * `tier` is §6.3: a PRICED field that two feeds disagree on stops and waits for
 * a person, a DESCRIPTIVE one just takes the newer value and keeps the history.
 * Nobody's proposal is mispriced because the RFP said "Dubai" and the surveyor
 * said "Dubai, UAE".
 */
export type FieldTier = "priced" | "descriptive";

export type EditableField = {
  key: string;
  label: string;
  tier: FieldTier;
  kind: "text" | "number" | "select";
  /** The on-screen help line. C35 — every field says why it exists. */
  help?: string;
  options?: Array<{ value: string; label: string }>;
};

export type FieldGroup = { title: string; note?: string; fields: EditableField[] };

export const EDIT_GROUPS: FieldGroup[] = [
  {
    title: "Identity",
    fields: [
      { key: "name", label: "Name", tier: "descriptive", kind: "text", help: "The only thing a phone call always gives you." },
      { key: "code", label: "Client's reference", tier: "descriptive", kind: "text", help: "Their numbering, not ours — a tender response is scored against it." },
      { key: "client_level_label", label: "What they call this level", tier: "descriptive", kind: "text", help: "Absorb their vocabulary rather than imposing ours — a facility, a tower, a block." },
      { key: "description", label: "Description", tier: "descriptive", kind: "text", help: "Travels to Facilio when this converts." },
      { key: "floor_level", label: "Floor level", tier: "descriptive", kind: "number", help: "A number, not a name: -1 basement, 0 ground, 1 first. Call it \"Mezzanine\" in the name." },
    ],
  },
  {
    title: "Address",
    note: "The first thing an RFP contains and the last thing the surveyor needs. It also decides whether the site is inside a service area at all.",
    fields: [
      { key: "location_name", label: "Location name", tier: "descriptive", kind: "text" },
      { key: "street", label: "Address", tier: "descriptive", kind: "text" },
      { key: "city", label: "City", tier: "descriptive", kind: "text" },
      { key: "state", label: "State / province", tier: "descriptive", kind: "text" },
      { key: "zip", label: "Postcode", tier: "descriptive", kind: "text" },
      { key: "country", label: "Country", tier: "descriptive", kind: "text", help: "Drives service-area matching — can we even serve here?" },
      { key: "location_phone", label: "Site phone", tier: "descriptive", kind: "text", help: "The site's own number, not the account's." },
      { key: "lat", label: "Latitude", tier: "descriptive", kind: "number" },
      { key: "lng", label: "Longitude", tier: "descriptive", kind: "number" },
    ],
  },
  {
    title: "Size and shape",
    note: "These price the job. If two feeds disagree on any of them, nothing is overwritten — the disagreement waits for a person.",
    fields: [
      { key: "area", label: "Area (sq ft)", tier: "priced", kind: "number", help: "The single most load-bearing number in the quote. Area drives hours, hours drive crew, crew drives price." },
      { key: "gross_floor_area", label: "Gross floor area (sq ft)", tier: "priced", kind: "number", help: "Kept apart from net on purpose: the RFP's number and the surveyor's number are frequently these two different things." },
      { key: "no_of_buildings", label: "Buildings", tier: "priced", kind: "number" },
      { key: "no_of_floors", label: "Floors", tier: "priced", kind: "number", help: "A count on the building, which can sit alongside real floor records under it." },
      { key: "no_of_independent_spaces", label: "Independent spaces", tier: "descriptive", kind: "number" },
      { key: "no_of_sub_spaces", label: "Sub-spaces", tier: "descriptive", kind: "number" },
      { key: "room_count", label: "Rooms", tier: "priced", kind: "number" },
      { key: "restroom_count", label: "Restrooms", tier: "priced", kind: "number", help: "Priced and scored separately in every cleaning contract." },
      { key: "max_occupancy", label: "Maximum occupancy", tier: "priced", kind: "number", help: "A real cleaning-frequency driver." },
      {
        key: "ceiling_height_band",
        label: "Ceiling height",
        tier: "priced",
        kind: "select",
        help: "A band, not a measurement — it changes the crew and the equipment, so it changes the price.",
        options: [
          { value: "standard_8_10ft", label: "8–10 ft" },
          { value: "high_10_20ft", label: "10–20 ft (may need a lift)" },
          { value: "very_high_20ft_plus", label: "20 ft+ (lift or scaffolding)" },
        ],
      },
      { key: "operation_hours_start", label: "Opens at", tier: "priced", kind: "number", help: "When the building is open decides when the crew can work, which decides the rate." },
      { key: "operation_hours_end", label: "Closes at", tier: "priced", kind: "number" },
    ],
  },
  {
    title: "Classification",
    fields: [
      { key: "space_category_id", label: "Category", tier: "descriptive", kind: "text" },
      { key: "site_type", label: "Site type", tier: "descriptive", kind: "text" },
      { key: "classification", label: "Classification", tier: "descriptive", kind: "text" },
      { key: "local_id", label: "Facilio number", tier: "descriptive", kind: "number", help: "Facilio's own number, filled in when this converts. Distinct from the client's reference." },
    ],
  },
];

export const EDITABLE_FIELDS: EditableField[] = EDIT_GROUPS.flatMap((g) => g.fields);

export const OBSERVABLE_FIELD_LABEL: Record<string, string> = Object.fromEntries(
  EDITABLE_FIELDS.map((f) => [f.key, f.label])
);

/** Which fields are numeric, so the form asks for the right keyboard. */
export const NUMERIC_FIELDS = EDITABLE_FIELDS.filter((f) => f.kind === "number").map((f) => f.key);

export const PRICED_FIELDS = EDITABLE_FIELDS.filter((f) => f.tier === "priced").map((f) => f.key);

export const OBSERVABLE_FIELDS = EDITABLE_FIELDS.map((f) => f.key);

export const fieldTier = (key: string): FieldTier =>
  EDITABLE_FIELDS.find((f) => f.key === key)?.tier ?? "priced";

/** How a value reads, whichever typed column holds it. Zero is a real answer. */
export function observationValue(o: {
  valueText?: string | null;
  valueNumber?: number | null;
}): string {
  if (o.valueNumber !== null && o.valueNumber !== undefined) return String(o.valueNumber);
  return o.valueText ?? "";
}

export const isAcceptedObservation = (o: ProspectObservation) => o.isAccepted === "true";
