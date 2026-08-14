/**
 * The prospect portfolio — the service layer for its own product area.
 * `Prospect Portfolio Module v1.1.md` §5, §9, §10, §11.
 *
 * WHAT THIS IS (§1): Facilio's Portfolio holds buildings you are *paid* to
 * maintain. This is the second, larger, messier one — buildings you *hope* to be
 * paid to maintain. It cannot live in Facilio's Portfolio, because that has
 * exactly one lifecycle lever (`inactive`) and no concept of "not ours yet".
 *
 * WHY IT IS NOT PART OF THE SURVEY MODULE (§2): a location can be born three
 * ways and only one of them involves a survey — a document (RFP, blueprint), a
 * walk, or a conversation. *"So if we get the dimensions of the store, then like
 * a blueprint or something like that, then we can kind of just price it out from
 * home"* — a large share of pursuits are priced with nobody ever walking the
 * building. With no walk there are no survey entries, so something other than the
 * survey has to build the tree.
 *
 * THIS MODULE IS THE ONLY WRITER of `fl_prospect_location`. The survey lane
 * reaches it through `createLocation` / `createSpaceOnWalk` rather than its own
 * SQL, so the ancestry rule and the level rules have exactly one implementation.
 *
 * THE ONE SAFETY CLAIM WORTH TESTING (§4.2): nothing in this file writes to
 * Facilio. Only `convert-to-facilio` may, it runs only when the deal is Won, and
 * it only ever CREATES. That handler is not built yet — it is blocked on G1
 * (L9/L20/L21/L22 are all unanswered), and writing it against an unverified API
 * shape would be, in §3a's words, a wish rather than a requirement.
 *
 * ATTRIBUTES ARE A CACHE (§4.3). `area_sqft`, `room_count`, `name` and friends
 * are *the latest accepted observation*, and acceptance is the only thing that
 * writes them. `update` here therefore records an observation and lets the
 * acceptance flow land the value — it does not poke the column. That rule is why
 * "three feeds disagree" is a finding rather than a data-loss bug (C25).
 */

import { childAncestry, isDescendantOf, rootAncestry } from "../domain/ancestry";
import {
  acceptanceFor,
  columnFor,
  decisionPicks,
  decisionWritesCache,
  displayValue,
  isFieldKey,
  kindFor,
  FIELD_KEYS,
  labelFor,
  reconciliationBlocker,
  typeValue,
  RECONCILIATION_DECISIONS,
  type FieldKey,
  type ReconciliationDecision,
  type TypedValue,
} from "../domain/observation-state";
import {
  convertAction,
  decisionBlocker,
  parentBlocker,
  verdictBlocker,
  CEILING_BANDS,
  CONVERT_STATES,
  LOCATION_TYPES,
  PROVENANCES,
  PURSUIT_DECISIONS,
  VERDICTS,
  type ConvertState,
  type LocationType,
  type Provenance,
  type PursuitDecision,
  type Verdict,
} from "../domain/prospect-state";
import { many, mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";

/** Read shape. Booleans are strings — the app database has no boolean column. */
export interface ProspectLocation {
  id: string;
  dealId: string;
  surveyId: string | null;
  type: LocationType;
  parentId: string | null;
  ancestryPath: string;
  name: string;
  code: string | null;
  clientLevelLabel: string | null;
  tagsJson: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  areaSqft: number | null;
  floorCount: number | null;
  roomCount: number | null;
  restroomCount: number | null;
  floorLabel: string | null;
  ceilingHeightBand: string | null;
  spaceCategory: string | null;
  pursuitDecision: PursuitDecision;
  pursuitDecisionNote: string | null;
  provenance: Provenance;
  sourceAttachmentId: string | null;
  verdict: Verdict;
  verdictNote: string | null;
  verdictBy: string | null;
  verdictAt: string | null;
  verdictVisitId: string | null;
  facilioId: string | null;
  facilioModule: string | null;
  previousPursuitId: string | null;
  convertState: ConvertState;
  createdAt: string;
}

const COLUMNS = `id, deal_id, survey_id, type, parent_id, ancestry_path, name, code,
  client_level_label, tags_json, address_line, city, region, country, postcode,
  latitude, longitude, area_sqft, floor_count, room_count, restroom_count,
  floor_label, ceiling_height_band, space_category, pursuit_decision,
  pursuit_decision_note, provenance, source_attachment_id, verdict, verdict_note,
  verdict_by, verdict_at, verdict_visit_id, facilio_id, facilio_module,
  previous_pursuit_id, convert_state, created_at`;

/** Guards an enum without trusting the caller. Mirrors the other modules. */
function inSet<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

const trimOrNull = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The whole tree for a pursuit, in depth-first order.
 *
 * `order by ancestry_path` IS depth-first order, because a child's path is its
 * parent's plus a separator — so no client-side sort is needed and none should
 * be added. Full scan, per §12 F-5: accepted, and named as a week-one limit.
 */
export function listLocations(input: {
  dealId: string;
  type?: LocationType | null;
  includeNoBid?: boolean;
}): { locations: ProspectLocation[] } {
  const params: unknown[] = [input.dealId];
  let sql = `select ${COLUMNS} from fl_prospect_location
              where deal_id = $1 and is_active = 'true'`;

  if (input.type) {
    params.push(input.type);
    sql += ` and type = $${params.length}`;
  }
  // `no_bid` drops out of every total (§5.1), so it is excluded unless asked for.
  if (!input.includeNoBid) sql += ` and pursuit_decision <> 'no_bid'`;

  sql += ` order by ancestry_path limit 2000`;
  return { locations: many<ProspectLocation>(sql, params) };
}

export function getLocation(locationId: string): { location: ProspectLocation } {
  const location = one<ProspectLocation>(
    `select ${COLUMNS} from fl_prospect_location where id = $1 and is_active = 'true' limit 1`,
    [locationId]
  );
  if (!location) throw new Error(`location ${locationId} not found`);
  return { location };
}

/**
 * Sites on a deal — what every "which property?" picker in the app reads.
 *
 * Deal-scoped, and now for a better reason than before: `previous_pursuit_id`
 * exists, so a building bid before is *copied forward* into this deal rather
 * than shared across two. §5.4 is explicit that copying beats sharing — a survey
 * is a point-in-time record, and that building's condition in March genuinely is
 * not its condition eighteen months later.
 */
export function listSites(dealId: string): {
  sites: Array<{
    id: string;
    name: string;
    code: string | null;
    facilioId: string | null;
    city: string | null;
    addressLine: string | null;
    childCount: number;
  }>;
} {
  const sites = many<{
    id: string;
    name: string;
    code: string | null;
    facilioId: string | null;
    city: string | null;
    addressLine: string | null;
    childCount: number;
  }>(
    `select l.id, l.name, l.code, l.facilio_id, l.city, l.address_line,
            (select count(*) from fl_prospect_location c
              where c.ancestry_path like l.ancestry_path || '/%'
                and c.is_active = 'true') as child_count
       from fl_prospect_location l
      where l.deal_id = $1 and l.type = 'site' and l.is_active = 'true'
      order by l.name
      limit 500`,
    [dealId]
  );
  return { sites };
}

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreateLocationInput {
  dealId: string;
  type: LocationType;
  name: string;
  parentId?: string | null;
  provenance?: Provenance | null;
  surveyId?: string | null;
  code?: string | null;
  clientLevelLabel?: string | null;
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  postcode?: string | null;
  sourceAttachmentId?: string | null;
  verdict?: Verdict | null;
  actor: string | null;
}

/**
 * One location, at any level.
 *
 * `name` is the ONLY mandatory descriptive field, and that is a product
 * decision, not laziness: a phone call gives you "the Bleecker Street store" and
 * nothing else, and a form that demands area before it will save has already
 * lost to the spreadsheet (§3's adoption test).
 *
 * Ancestry is stamped here, in the one place that creates rows, because C3's
 * failure mode is silent — a record missing a level saves and then vanishes from
 * the tree, from site-scoped work orders and from dashboards.
 */
export function createLocation(input: CreateLocationInput): { location: ProspectLocation } {
  const type = inSet(input.type, LOCATION_TYPES, "type");
  const name = trimOrNull(input.name);
  if (!name) throw new Error("a location needs a name — it is the one mandatory field");

  const provenance = input.provenance
    ? inSet(input.provenance, PROVENANCES, "provenance")
    : "manual";

  let parent: { id: string; type: LocationType; ancestryPath: string } | null = null;
  if (input.parentId) {
    parent = one<{ id: string; type: LocationType; ancestryPath: string }>(
      `select id, type, ancestry_path from fl_prospect_location
        where id = $1 and deal_id = $2 and is_active = 'true' limit 1`,
      [input.parentId, input.dealId]
    );
    // Scoped to the deal: a parent from another pursuit would graft this whole
    // subtree under someone else's property.
    if (!parent) throw new Error(`parent ${input.parentId} is not a location on this deal`);
  }

  const levelBlock = parentBlocker(type, parent?.type ?? null);
  if (levelBlock) throw new Error(levelBlock);

  const now = nowIso();
  const row = one<{ id: string }>(
    `insert into fl_prospect_location
       (id, deal_id, survey_id, type, parent_id, ancestry_path, name, code,
        client_level_label, tags_json, address_line, city, region, country, postcode,
        pursuit_decision, provenance, source_attachment_id, verdict, convert_state,
        created_by, updated_by, is_active, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, '', $5, $6,
             $7, '[]', $8, $9, $10, $11, $12,
             'undecided', $13, $14, $15, 'not_converted',
             $16, $16, 'true', '{}', $17, $17)
     returning id`,
    [
      input.dealId,
      trimOrNull(input.surveyId),
      type,
      parent?.id ?? null,
      name,
      trimOrNull(input.code),
      trimOrNull(input.clientLevelLabel),
      trimOrNull(input.addressLine),
      trimOrNull(input.city),
      trimOrNull(input.region),
      trimOrNull(input.country),
      trimOrNull(input.postcode),
      provenance,
      trimOrNull(input.sourceAttachmentId),
      input.verdict ? inSet(input.verdict, VERDICTS, "verdict") : "unverified",
      input.actor,
      now,
    ]
  );
  if (!row) throw new Error("location insert returned no row");

  // Ancestry needs the id, which only exists after the insert. A root's chain is
  // itself — the base case of the rule, not an exception to it.
  const ancestryPath = parent ? childAncestry(parent.ancestryPath, row.id) : rootAncestry(row.id);
  mutate(`update fl_prospect_location set ancestry_path = $2 where id = $1`, [row.id, ancestryPath]);

  appendEvent({
    entityType: "prospect_location",
    entityId: row.id,
    kind: "created",
    actor: input.actor,
    body: name,
    meta: { dealId: input.dealId, type, provenance, parentId: parent?.id ?? null },
  });

  return getLocation(row.id);
}

// ── Re-parent ────────────────────────────────────────────────────────────────

/**
 * Move a location, and re-stamp the whole subtree beneath it.
 *
 * The subtree is the part that is easy to forget and expensive to miss: every
 * descendant's `ancestry_path` embeds the old chain, so moving a building
 * without rewriting its spaces leaves them pointing at a lineage that no longer
 * describes them — C3's silent-disappearance failure, self-inflicted.
 */
export function reparentLocation(input: {
  locationId: string;
  newParentId: string | null;
  actor: string | null;
}): { location: ProspectLocation; descendantsRestamped: number } {
  const { location } = getLocation(input.locationId);

  let parent: { id: string; type: LocationType; ancestryPath: string } | null = null;
  if (input.newParentId) {
    parent = one<{ id: string; type: LocationType; ancestryPath: string }>(
      `select id, type, ancestry_path from fl_prospect_location
        where id = $1 and deal_id = $2 and is_active = 'true' limit 1`,
      [input.newParentId, location.dealId]
    );
    if (!parent) throw new Error(`parent ${input.newParentId} is not a location on this deal`);

    if (parent.id === location.id) throw new Error("a location cannot be its own parent");
    // The cycle guard, and `ancestry_path` makes it a string test rather than a
    // recursive walk: anything beneath me carries my chain as a prefix.
    if (isDescendantOf(parent.ancestryPath, location.ancestryPath)) {
      throw new Error("that parent sits beneath this location — the move would create a cycle");
    }
  }

  const levelBlock = parentBlocker(location.type, parent?.type ?? null);
  if (levelBlock) throw new Error(levelBlock);

  const oldPath = location.ancestryPath;
  const newPath = parent ? childAncestry(parent.ancestryPath, location.id) : rootAncestry(location.id);
  const now = nowIso();

  mutate(
    `update fl_prospect_location
        set parent_id = $2, ancestry_path = $3, updated_by = $4, updated_at = $5
      where id = $1`,
    [location.id, parent?.id ?? null, newPath, input.actor, now]
  );

  // Every descendant, in one statement: swap the old prefix for the new one.
  const descendantsRestamped = mutate(
    `update fl_prospect_location
        set ancestry_path = $2 || substring(ancestry_path from ${oldPath.length + 1}),
            updated_by = $3, updated_at = $4
      where deal_id = $5 and is_active = 'true'
        and ancestry_path like $1 || '/%'`,
    [oldPath, newPath, input.actor, now, location.dealId]
  );

  appendEvent({
    entityType: "prospect_location",
    entityId: location.id,
    kind: "reparented",
    actor: input.actor,
    body: location.name,
    meta: { from: oldPath, to: newPath, descendantsRestamped },
  });

  return { location: getLocation(location.id).location, descendantsRestamped };
}

// ── Decisions ────────────────────────────────────────────────────────────────

/** §10 `prospect.decide` — the bid / no-bid call, per site. */
export function setDecision(input: {
  locationId: string;
  decision: PursuitDecision;
  note?: string | null;
  actor: string | null;
}): { location: ProspectLocation } {
  const { location } = getLocation(input.locationId);
  const decision = inSet(input.decision, PURSUIT_DECISIONS, "pursuitDecision");

  const block = decisionBlocker(decision, input.note);
  if (block) throw new Error(block);

  const now = nowIso();
  mutate(
    `update fl_prospect_location
        set pursuit_decision = $2, pursuit_decision_note = $3, updated_by = $4, updated_at = $5
      where id = $1`,
    [location.id, decision, trimOrNull(input.note), input.actor, now]
  );

  appendEvent({
    entityType: "prospect_location",
    entityId: location.id,
    kind: "decided",
    actor: input.actor,
    body: `${location.name} — ${decision}`,
    meta: { from: location.pursuitDecision, to: decision },
  });

  return getLocation(location.id);
}

/** §10 `prospect.verdict` — is this real? The note is mandatory on three of them. */
export function setVerdict(input: {
  locationId: string;
  verdict: Verdict;
  note?: string | null;
  visitId?: string | null;
  actor: string | null;
}): { location: ProspectLocation; discrepancy: boolean } {
  const { location } = getLocation(input.locationId);
  const verdict = inSet(input.verdict, VERDICTS, "verdict");

  const block = verdictBlocker({
    from: location.verdict,
    to: verdict,
    note: input.note,
    convertState: location.convertState,
  });
  if (block) throw new Error(block);

  const now = nowIso();
  mutate(
    `update fl_prospect_location
        set verdict = $2, verdict_note = $3, verdict_by = $4, verdict_at = $5,
            verdict_visit_id = $6, updated_by = $4, updated_at = $5
      where id = $1`,
    [location.id, verdict, trimOrNull(input.note), input.actor, now, trimOrNull(input.visitId)]
  );

  // §4.1: `changed` on a location that already exists in Facilio raises a
  // discrepancy and writes NOTHING. A bid-stage estimate must never overwrite a
  // maintained, contracted record.
  const discrepancy = verdict === "changed" && Boolean((location.facilioId ?? "").trim());

  appendEvent({
    entityType: "prospect_location",
    entityId: location.id,
    kind: discrepancy ? "discrepancy_raised" : "verdicted",
    actor: input.actor,
    body: `${location.name} — ${verdict}`,
    meta: { from: location.verdict, to: verdict, facilioId: location.facilioId ?? null },
  });

  return { location: getLocation(location.id).location, discrepancy };
}

// ── Repeat pursuits (§5.4) ───────────────────────────────────────────────────

/**
 * "Add from a previous pursuit" — copies a location forward into this deal.
 *
 * §5.4, and it replaces a clone feature entirely. The copy carries structure,
 * area, address, and crucially `facilio_id`, so a repeat client's building
 * arrives already knowing it exists in Facilio and the convert skips it.
 *
 * Copying beats sharing one row across two deals, and the reason is not
 * technical: a survey is a point-in-time record. Sharing would force one truth
 * onto two visits eighteen months apart, which is wrong more often than it is
 * convenient. §12 F-9 accepts the duplication deliberately.
 */
export function copyForward(input: {
  sourceLocationId: string;
  dealId: string;
  parentId?: string | null;
  withDescendants?: boolean;
  actor: string | null;
}): { location: ProspectLocation; copied: number } {
  const source = one<ProspectLocation>(
    `select ${COLUMNS} from fl_prospect_location where id = $1 and is_active = 'true' limit 1`,
    [input.sourceLocationId]
  );
  if (!source) throw new Error(`source location ${input.sourceLocationId} not found`);
  if (source.dealId === input.dealId) {
    throw new Error("that location is already on this deal — copy forward is for an earlier pursuit");
  }

  // The copy is a normal create, so it goes through the same level and ancestry
  // rules as anything else rather than round-tripping raw columns.
  const { location } = createLocation({
    dealId: input.dealId,
    type: source.type,
    name: source.name,
    parentId: input.parentId ?? null,
    provenance: "crm",
    code: source.code,
    clientLevelLabel: source.clientLevelLabel,
    addressLine: source.addressLine,
    city: source.city,
    region: source.region,
    country: source.country,
    postcode: source.postcode,
    actor: input.actor,
  });

  const now = nowIso();
  // What makes it a copy-forward rather than a new building: the lineage link,
  // the measurements worth starting warm from, and the Facilio id.
  mutate(
    `update fl_prospect_location
        set previous_pursuit_id = $2,
            area_sqft = $3, floor_count = $4, room_count = $5, restroom_count = $6,
            floor_label = $7, ceiling_height_band = $8, space_category = $9,
            latitude = $10, longitude = $11,
            facilio_id = $12, facilio_module = $13,
            convert_state = case when coalesce($12, '') <> '' then 'already_linked' else 'not_converted' end,
            updated_by = $14, updated_at = $15
      where id = $1`,
    [
      location.id,
      source.id,
      source.areaSqft,
      source.floorCount,
      source.roomCount,
      source.restroomCount,
      source.floorLabel,
      source.ceilingHeightBand,
      source.spaceCategory,
      source.latitude,
      source.longitude,
      source.facilioId,
      source.facilioModule,
      input.actor,
      now,
    ]
  );

  let copied = 1;
  if (input.withDescendants) {
    const children = many<{ id: string }>(
      `select id from fl_prospect_location
        where parent_id = $1 and is_active = 'true' order by name`,
      [source.id]
    );
    for (const child of children) {
      copied += copyForward({
        sourceLocationId: child.id,
        dealId: input.dealId,
        parentId: location.id,
        withDescendants: true,
        actor: input.actor,
      }).copied;
    }
  }

  appendEvent({
    entityType: "prospect_location",
    entityId: location.id,
    kind: "copied_forward",
    actor: input.actor,
    body: source.name,
    meta: { sourceLocationId: source.id, sourceDealId: source.dealId, copied },
  });

  return { location: getLocation(location.id).location, copied };
}

// ── Facilio link (§10, and it is never automatic) ─────────────────────────────

/**
 * Records that this location already exists in Facilio.
 *
 * §10: **a human confirms the match, never the system.** §8 cut the
 * building-matching UI for exactly this reason — the user picks, we never guess.
 * Getting this wrong means a convert run skips a building that should have been
 * created, or worse, claims a customer's live record belongs to this pursuit.
 */
export function linkFacilio(input: {
  locationId: string;
  facilioId: string;
  facilioModule: LocationType;
  actor: string | null;
}): { location: ProspectLocation } {
  const { location } = getLocation(input.locationId);
  const facilioId = trimOrNull(input.facilioId);
  if (!facilioId) throw new Error("a Facilio id is required to link");
  const facilioModule = inSet(input.facilioModule, LOCATION_TYPES, "facilioModule");

  const now = nowIso();
  mutate(
    `update fl_prospect_location
        set facilio_id = $2, facilio_module = $3, convert_state = 'already_linked',
            updated_by = $4, updated_at = $5
      where id = $1`,
    [location.id, facilioId, facilioModule, input.actor, now]
  );

  appendEvent({
    entityType: "prospect_location",
    entityId: location.id,
    kind: "linked_facilio",
    actor: input.actor,
    body: `${location.name} → ${facilioModule} ${facilioId}`,
    meta: { facilioId, facilioModule },
  });

  return getLocation(location.id);
}

// ── Soft delete (§9: D always means is_active = false) ───────────────────────

export function deactivateLocation(input: {
  locationId: string;
  reason?: string | null;
  actor: string | null;
}): { deactivated: number } {
  const { location } = getLocation(input.locationId);

  if (location.convertState === "converted") {
    // §9's override: `converted` beats every role, Admin included.
    throw new Error("this location is in Facilio — it cannot be removed from the pursuit");
  }

  const now = nowIso();
  // The subtree goes with it. A live space under a removed building is the
  // orphan case again, just arrived at from the other direction.
  const deactivated = mutate(
    `update fl_prospect_location
        set is_active = 'false', updated_by = $2, updated_at = $3
      where is_active = 'true'
        and (id = $1 or ancestry_path like $4 || '/%')`,
    [location.id, input.actor, now, location.ancestryPath]
  );

  appendEvent({
    entityType: "prospect_location",
    entityId: location.id,
    kind: "deactivated",
    actor: input.actor,
    body: location.name,
    meta: { reason: trimOrNull(input.reason), deactivated },
  });

  return { deactivated };
}

// ── Convert pre-flight (§7.4) — read-only, and that is the point ─────────────

/**
 * What a convert run WOULD do, without doing any of it.
 *
 * §7.4 and C26: enrichment happens at the gate, not after. This is safe to build
 * ahead of the run itself because it touches Facilio not at all — it reports
 * `convertAction`'s verdict per location plus the blockers a person must clear.
 *
 * The RUN is deliberately absent: it needs L9 (mandatory Facilio enums), L20 (is
 * a space-under-site accepted?), L21 (can our role deactivate, for the reverse
 * walk?) and L22 (client contact create) — all unanswered, all G1. §3a is blunt
 * about what a requirement built on an unverified constraint is.
 */
export function convertPreflight(input: { dealId: string; dealIsWon: boolean }): {
  dealIsWon: boolean;
  willCreate: number;
  willSkip: number;
  flags: number;
  rows: Array<{
    locationId: string;
    name: string;
    type: LocationType;
    action: "create" | "skip" | "flag";
    reason: string;
    blockers: string[];
  }>;
} {
  const { locations } = listLocations({ dealId: input.dealId, includeNoBid: true });

  const rows = locations.map((l) => {
    const { action, reason } = convertAction({
      facilioId: l.facilioId,
      verdict: l.verdict,
      convertState: l.convertState,
      pursuitDecision: l.pursuitDecision,
    });

    const blockers: string[] = [];
    if (!input.dealIsWon) blockers.push("the deal is not Won");
    // C3's ordering dependency, which §7.2 calls a hard dependency: client
    // before site, site before building, building before space. A pre-flight
    // that does not check the parent produces the silent-disappearance bug.
    if (action === "create" && l.parentId) {
      const parent = locations.find((p) => p.id === l.parentId);
      if (!parent) blockers.push("its parent is not in this pursuit");
      else if (!(parent.facilioId ?? "").trim() && parent.convertState !== "converted") {
        blockers.push(`its parent "${parent.name}" must be converted first`);
      }
    }
    if (action === "create" && !(l.name ?? "").trim()) blockers.push("no name");

    return { locationId: l.id, name: l.name, type: l.type, action, reason, blockers };
  });

  return {
    dealIsWon: input.dealIsWon,
    willCreate: rows.filter((r) => r.action === "create").length,
    willSkip: rows.filter((r) => r.action === "skip").length,
    flags: rows.filter((r) => r.action === "flag").length,
    rows,
  };
}

// ── Observations (§4.3) ──────────────────────────────────────────────────────

/**
 * NOTE ON THE COLUMN NAME. §5.2 calls the foreign key `location_id`; the imported
 * table has `prospect_node_id`, from before §0a purged "node". There is no ALTER
 * (§3a P1), so the physical name stays and every query here uses it. Renaming it
 * would mean a third table and a second migration for a column nobody reads by
 * name — `fl_prospect_location` was worth that cost, this is not.
 */
export interface ProspectObservation {
  id: string;
  locationId: string;
  dealId: string;
  surveyId: string | null;
  fieldKey: string;
  valueText: string | null;
  valueNumber: number | null;
  provenance: Provenance;
  observedBy: string | null;
  observedAt: string | null;
  visitId: string | null;
  isAccepted: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  supersededByObservationId: string | null;
  reconciliationDecision: string | null;
}

const OBSERVATION_COLUMNS = `id, prospect_node_id as location_id, deal_id, survey_id, field_key,
  value_text, value_number, provenance, observed_by, observed_at, visit_id,
  is_accepted, accepted_by, accepted_at, superseded_by_observation_id, reconciliation_decision`;

/** The currently accepted observation for one field, or null. */
function acceptedFor(locationId: string, fieldKey: string): ProspectObservation | null {
  return one<ProspectObservation>(
    `select ${OBSERVATION_COLUMNS} from fl_prospect_observation
      where prospect_node_id = $1 and field_key = $2 and is_accepted = 'true'
        and superseded_by_observation_id is null
      order by observed_at desc limit 1`,
    [locationId, fieldKey]
  );
}

/**
 * Writes the location's cached attribute column.
 *
 * THIS IS THE ONLY FUNCTION IN THE CODEBASE THAT WRITES AN ATTRIBUTE, and that is
 * the §4.3 rule made structural rather than documented. The column name comes from
 * `columnFor`, which throws on anything outside its allowlist — so a caller cannot
 * reach `is_active` or `verdict` by naming it in a field key.
 */
function cacheAttribute(
  locationId: string,
  fieldKey: string,
  value: TypedValue,
  actor: string | null,
  now: string
): void {
  const column = columnFor(fieldKey);
  const raw = kindFor(fieldKey as FieldKey) === "number" ? value.valueNumber : value.valueText;
  mutate(
    `update fl_prospect_location
        set ${column} = $2, updated_by = $3, updated_at = $4
      where id = $1 and is_active = 'true'`,
    [locationId, raw, actor, now]
  );
}

/**
 * Record a value someone or something observed about a location.
 *
 * The one entry point for every feed — the AI ingest, a paste, the walk, a person
 * typing. What happens next is §4.3's decision tree, and the caller does not get
 * to choose: agreement is absorbed silently, disagreement is kept and surfaced.
 *
 * Append-only. Nothing here updates an observation in place, which is what makes
 * "three feeds disagree" a finding rather than a data-loss bug (C25).
 */
export function observe(input: {
  locationId: string;
  fieldKey: string;
  value: unknown;
  provenance?: Provenance | null;
  surveyId?: string | null;
  visitId?: string | null;
  actor: string | null;
}): {
  observation: ProspectObservation;
  outcome: "auto_accept" | "agrees" | "conflict";
  reason: string;
  conflictsWith: ProspectObservation | null;
} {
  const { location } = getLocation(input.locationId);
  if (!isFieldKey(input.fieldKey)) {
    throw new Error(`${input.fieldKey} is not an observable field`);
  }
  const provenance = input.provenance
    ? inSet(input.provenance, PROVENANCES, "provenance")
    : "manual";
  const typed = typeValue(input.fieldKey, input.value);

  const current = acceptedFor(location.id, input.fieldKey);
  const decision = acceptanceFor({
    incoming: typed,
    currentAccepted: current
      ? { valueText: current.valueText, valueNumber: current.valueNumber, provenance: current.provenance }
      : null,
    incomingProvenance: provenance,
  });

  const now = nowIso();
  const row = one<{ id: string }>(
    `insert into fl_prospect_observation
       (id, prospect_node_id, deal_id, survey_id, field_key, value_text, value_number,
        provenance, observed_by, observed_at, visit_id, is_accepted, accepted_by, accepted_at,
        data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10, $11, $12, $13,
             '{}', $9, $9)
     returning id`,
    [
      location.id,
      location.dealId,
      trimOrNull(input.surveyId),
      input.fieldKey,
      typed.valueText,
      typed.valueNumber,
      provenance,
      input.actor,
      now,
      trimOrNull(input.visitId),
      decision.needsHuman ? "false" : "true",
      decision.needsHuman ? null : input.actor,
      decision.needsHuman ? null : now,
    ]
  );
  if (!row) throw new Error("observation insert returned no row");

  if (decision.writesCache) {
    // The superseded value keeps its history rather than being deleted: the chain
    // is how "who said 4,500 and when" survives the decision that replaced it.
    if (current) {
      mutate(
        `update fl_prospect_observation
            set superseded_by_observation_id = $2, is_accepted = 'false', updated_at = $3
          where id = $1`,
        [current.id, row.id, now]
      );
    }
    cacheAttribute(location.id, input.fieldKey, typed, input.actor, now);
  }

  appendEvent({
    entityType: "prospect_location",
    entityId: location.id,
    kind: decision.needsHuman ? "observation_conflict" : "observed",
    actor: input.actor,
    body: `${labelFor(input.fieldKey)} — ${displayValue(typed)}`,
    meta: {
      fieldKey: input.fieldKey,
      provenance,
      outcome: decision.outcome,
      previous: current ? displayValue(current) : null,
    },
  });

  const observation = one<ProspectObservation>(
    `select ${OBSERVATION_COLUMNS} from fl_prospect_observation where id = $1 limit 1`,
    [row.id]
  );

  return {
    observation: observation as ProspectObservation,
    outcome: decision.outcome,
    reason: decision.reason,
    conflictsWith: decision.needsHuman ? current : null,
  };
}

/** Every observation on a location, newest first — the history view (§8 S3). */
export function listObservations(locationId: string): {
  observations: ProspectObservation[];
} {
  return {
    observations: many<ProspectObservation>(
      `select ${OBSERVATION_COLUMNS} from fl_prospect_observation
        where prospect_node_id = $1
        order by field_key, observed_at desc
        limit 500`,
      [locationId]
    ),
  };
}

export interface Conflict {
  locationId: string;
  locationName: string;
  fieldKey: string;
  label: string;
  accepted: ProspectObservation | null;
  /** Unaccepted, unsuperseded values waiting on a person. */
  pending: ProspectObservation[];
}

/**
 * Open conflicts across a pursuit — the side-by-side list a person works through.
 *
 * "Open" means an observation that is neither accepted nor superseded. A rejected
 * value is superseded, not deleted, so it leaves this list without leaving the
 * record — which is what stops the same conflict reappearing every time the list
 * is rebuilt.
 */
export function listConflicts(dealId: string): { conflicts: Conflict[] } {
  const rows = many<ProspectObservation & { locationName: string }>(
    `select ${OBSERVATION_COLUMNS},
            (select l.name from fl_prospect_location l where l.id = o.prospect_node_id) as location_name
       from fl_prospect_observation o
      where o.deal_id = $1
        and coalesce(o.is_accepted, 'false') = 'false'
        and o.superseded_by_observation_id is null
      order by o.prospect_node_id, o.field_key, o.observed_at desc
      limit 500`,
    [dealId]
  );

  const grouped = new Map<string, Conflict>();
  for (const row of rows) {
    const key = `${row.locationId}:${row.fieldKey}`;
    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        locationId: row.locationId,
        locationName: row.locationName,
        fieldKey: row.fieldKey,
        label: labelFor(row.fieldKey),
        accepted: acceptedFor(row.locationId, row.fieldKey),
        pending: [],
      };
      grouped.set(key, entry);
    }
    entry.pending.push(row);
  }

  return { conflicts: [...grouped.values()] };
}

/**
 * A person resolves one conflict. §4.3's bottom half.
 *
 * Four outcomes, and only three of them write a value: `pushed_to_clarification`
 * deliberately leaves the field unresolved, because the question has gone back to
 * the tenderer and a placeholder would hide that.
 *
 * The losing observations are superseded rather than removed, and the decision is
 * stamped on them — so six weeks later "why is this 5,200?" is answerable without
 * anyone having to remember.
 */
export function decideObservation(input: {
  locationId: string;
  fieldKey: string;
  decision: ReconciliationDecision;
  manualValue?: string | null;
  actor: string | null;
}): { resolved: boolean; cached: boolean; winner: ProspectObservation | null } {
  const { location } = getLocation(input.locationId);
  if (!isFieldKey(input.fieldKey)) {
    throw new Error(`${input.fieldKey} is not an observable field`);
  }
  const decision = inSet(input.decision, RECONCILIATION_DECISIONS, "decision");

  const open = many<ProspectObservation>(
    `select ${OBSERVATION_COLUMNS} from fl_prospect_observation
      where prospect_node_id = $1 and field_key = $2
        and coalesce(is_accepted, 'false') = 'false'
        and superseded_by_observation_id is null
      order by observed_at desc limit 50`,
    [location.id, input.fieldKey]
  );
  if (!open.length) throw new Error("there is no open conflict on that field");

  const accepted = acceptedFor(location.id, input.fieldKey);
  const available = [...new Set([...open, ...(accepted ? [accepted] : [])].map((o) => o.provenance))];

  const block = reconciliationBlocker({
    decision,
    manualValue: input.manualValue,
    available: available as Provenance[],
  });
  if (block) throw new Error(block);

  const now = nowIso();
  const picks = decisionPicks(decision);
  const winner = picks ? [...open, ...(accepted ? [accepted] : [])].find((o) => o.provenance === picks) ?? null : null;

  let cached = false;
  if (decisionWritesCache(decision)) {
    const value =
      decision === "manual_override"
        ? typeValue(input.fieldKey, input.manualValue)
        : { valueText: winner?.valueText ?? null, valueNumber: winner?.valueNumber ?? null };
    cacheAttribute(location.id, input.fieldKey, value, input.actor, now);
    cached = true;
  }

  // Everything open is closed by this decision. The winner (when one of the
  // sources won) becomes the accepted row; the rest are superseded by it.
  for (const o of open) {
    const isWinner = winner !== null && o.id === winner.id;
    mutate(
      `update fl_prospect_observation
          set is_accepted = $2, accepted_by = $3, accepted_at = $4,
              reconciliation_decision = $5,
              superseded_by_observation_id = $6, updated_at = $4
        where id = $1`,
      [
        o.id,
        isWinner ? "true" : "false",
        isWinner ? input.actor : null,
        now,
        decision,
        isWinner ? null : (winner?.id ?? null),
        now,
      ]
    );
  }

  // A previously accepted value that lost is superseded too, so the next read
  // does not find two accepted rows for one field.
  if (accepted && (!winner || accepted.id !== winner.id)) {
    mutate(
      `update fl_prospect_observation
          set is_accepted = 'false', superseded_by_observation_id = $2,
              reconciliation_decision = $3, updated_at = $4
        where id = $1`,
      [accepted.id, winner?.id ?? null, decision, now]
    );
  }

  appendEvent({
    entityType: "prospect_location",
    entityId: location.id,
    kind: "reconciled",
    actor: input.actor,
    body: `${labelFor(input.fieldKey)} — ${decision}`,
    meta: { fieldKey: input.fieldKey, decision, cached, closed: open.length },
  });

  return { resolved: true, cached, winner };
}

// ── Reference ────────────────────────────────────────────────────────────────

export function reference(): Record<string, readonly string[]> {
  return {
    types: LOCATION_TYPES,
    verdicts: VERDICTS,
    convertStates: CONVERT_STATES,
    pursuitDecisions: PURSUIT_DECISIONS,
    provenances: PROVENANCES,
    ceilingBands: CEILING_BANDS,
    // The observation flow's two closed sets. `observableFields` is also the
    // allowlist of columns acceptance may write, so a caller that hardcodes it
    // will drift from the only copy that decides.
    observableFields: FIELD_KEYS,
    reconciliationDecisions: RECONCILIATION_DECISIONS,
  };
}
