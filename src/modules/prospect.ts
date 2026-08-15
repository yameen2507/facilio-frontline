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
 * THIS MODULE IS THE ONLY WRITER of `fl_portfolio_location`. The survey lane
 * reaches it through `createLocation` / `createSpaceOnWalk` rather than its own
 * SQL, so the ancestry rule and the level rules have exactly one implementation.
 *
 * THE ONE SAFETY CLAIM WORTH TESTING (§4.2): nothing in this file writes to
 * Facilio. Only `convert-to-facilio` may, it runs only when the deal is Won, and
 * it only ever CREATES. That handler is not built yet — it is blocked on G1
 * (L9/L20/L21/L22 are all unanswered), and writing it against an unverified API
 * shape would be, in §3a's words, a wish rather than a requirement.
 *
 * ATTRIBUTES ARE A CACHE (§4.3). `area`, `room_count`, `name` and friends
 * are *the latest accepted observation*, and acceptance is the only thing that
 * writes them. `update` here therefore records an observation and lets the
 * acceptance flow land the value — it does not poke the column. That rule is why
 * "three feeds disagree" is a finding rather than a data-loss bug (C25).
 */

import { childAncestry, isDescendantOf, rootAncestry } from "../domain/ancestry";
import {
  acceptanceFor,
  type AcceptanceOutcome,
  columnFor,
  decisionPicks,
  decisionWritesCache,
  displayValue,
  isFieldKey,
  kindFor,
  FIELD_KEYS,
  labelFor,
  reconciliationBlocker,
  tierFor,
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
import { executeAction } from "../shared/facilio";

/**
 * The table. v1.3 §3.
 *
 * Its predecessor `fl_prospect_location` is FROZEN at v1.1's column names — the
 * app role has no ALTER and re-import 500s — so the v1.3 shape could only land
 * as a new table. The old one is abandoned in place, never deleted, and
 * `migrate.copy-portfolio-locations` carried every row across keeping its id.
 */
const TABLE = "fl_portfolio_location";

/**
 * Read shape. Booleans are strings — the app database has no boolean column.
 *
 * FIELD NAMES ARE FACILIO'S OWN (§3's naming rule): `area` not `areaSqft`,
 * `street` not `addressLine`, `state` not `region`, `zip` not `postcode`. v1.1
 * claimed that principle for three type words and then abandoned it for thirty
 * columns; applying it properly is what makes convert a copy rather than a
 * translation.
 */
export interface ProspectLocation {
  id: string;
  // §4 — three nullable owners, at least one always set, filled progressively
  // as the record matures. Enforced here because no CHECK constraint exists.
  leadId: string | null;
  accountId: string | null;
  dealId: string | null;
  surveyId: string | null;
  /** §4.3 — shared by every row that is the same physical building. */
  buildingKey: string | null;
  previousPursuitId: string | null;
  type: LocationType;
  parentId: string | null;
  // §2.3 rule 4 — materialised ancestry, the shape BaseSpace actually uses.
  siteId: string | null;
  buildingId: string | null;
  floorId: string | null;
  ancestryPath: string;
  name: string;
  description: string | null;
  code: string | null;
  localId: number | null;
  clientLevelLabel: string | null;
  /**
   * A JSON array, AS TEXT — callers parse it themselves.
   *
   * §3.1 names this field `tags`, and L15 is answered: CSV inference has no
   * jsonb, so it is a text column either way. The consequence is easy to trip
   * over — `row-map` only auto-parses columns whose name ENDS in `_json`, so
   * `tags_json` would have arrived parsed and `tags` arrives as a string. Taking
   * the spec's name is the right trade (it is the name convert maps from), but
   * it has to be stated. The old `tagsJson` field, incidentally, was never
   * populated at all: the mapper stripped the suffix and emitted `tags`.
   */
  tags: string | null;
  // §3.2 — the address is a Location record in Facilio, so these take its names.
  locationName: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  locationPhone: string | null;
  facilioLocationId: string | null;
  // §3.3 — size and shape.
  area: number | null;
  grossFloorArea: number | null;
  noOfBuildings: number | null;
  noOfFloors: number | null;
  noOfIndependentSpaces: number | null;
  noOfSubSpaces: number | null;
  /** An integer: -1 basement, 0 ground, 1 first. The name lives in `name`. */
  floorLevel: number | null;
  maxOccupancy: number | null;
  operationHoursStart: number | null;
  operationHoursEnd: number | null;
  spaceCategoryId: string | null;
  siteType: string | null;
  classification: string | null;
  roomCount: number | null;
  restroomCount: number | null;
  ceilingHeightBand: string | null;
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
  convertState: ConvertState;
  createdAt: string;
}

const COLUMNS = `id, lead_id, account_id, deal_id, survey_id, building_key,
  previous_pursuit_id, type, parent_id, site_id, building_id, floor_id,
  ancestry_path, name, description, code, local_id, client_level_label, tags,
  location_name, street, city, state, zip, country, lat, lng, location_phone,
  facilio_location_id, area, gross_floor_area, no_of_buildings, no_of_floors,
  no_of_independent_spaces, no_of_sub_spaces, floor_level, max_occupancy,
  operation_hours_start, operation_hours_end, space_category_id, site_type,
  classification, room_count, restroom_count, ceiling_height_band,
  pursuit_decision, pursuit_decision_note, provenance, source_attachment_id,
  verdict, verdict_note, verdict_by, verdict_at, verdict_visit_id, facilio_id,
  facilio_module, convert_state, created_at`;

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
 * THE LIST (§5). Every property, with deal as one filter among several.
 *
 * v1.1 made this deal-gated and the module was a Deal tab wearing a module's
 * clothes — you could not answer *"which of this client's buildings have we
 * already been inside?"* without picking a pursuit first. Passing no scope now
 * returns everything, which is what makes Portfolio a top-level surface; passing
 * one scopes it to a lead, an account or a deal, and the same component serves
 * all four surfaces.
 *
 * ORDER IS STABLE AND EXPLICIT (§5.3, fixing X-11): `ancestry_path` IS
 * depth-first order, because a child's path is its parent's plus a separator,
 * and `name` breaks ties so two identical rows always land adjacent instead of
 * scattered. With no indexes this is an in-memory sort on a full scan — say so
 * rather than pretend it scales (§12 F-5).
 */
export interface ListLocationsInput {
  /** All three optional. None set = the global list. */
  leadId?: string | null;
  accountId?: string | null;
  dealId?: string | null;
  type?: LocationType | null;
  includeNoBid?: boolean;
  pursuitDecision?: PursuitDecision | null;
  verdict?: Verdict | null;
  /** `true` = already in Facilio, `false` = not yet, null = either. */
  inFacilio?: boolean | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  /** Matches a single tag inside the JSON array, which is text here (L15). */
  tag?: string | null;
  /**
   * §5.2's last filter, and the one that makes this a screen people live in
   * rather than look at: the RFP coordinator's actual work queue.
   */
  needsAttention?: "unsettled" | "missing_area" | "not_visited" | null;
  /** Matches name, code, local_id or street. */
  search?: string | null;
}

export function listLocations(input: ListLocationsInput): { locations: ProspectLocation[] } {
  const params: unknown[] = [];
  const where: string[] = ["is_active = 'true'"];

  const scope = (column: string, value: string | null | undefined) => {
    const v = trimOrNull(value);
    if (!v) return;
    params.push(v);
    where.push(`${column} = $${params.length}`);
  };
  scope("lead_id", input.leadId);
  scope("account_id", input.accountId);
  scope("deal_id", input.dealId);
  scope("type", input.type);
  scope("pursuit_decision", input.pursuitDecision);
  scope("verdict", input.verdict);
  scope("country", input.country);
  scope("state", input.state);
  scope("city", input.city);

  // `no_bid` drops out of every total (§5.1), so it is excluded unless asked for.
  if (!input.includeNoBid) where.push(`pursuit_decision <> 'no_bid'`);

  if (input.inFacilio === true) where.push(`coalesce(facilio_id, '') not in ('', 'none')`);
  if (input.inFacilio === false) where.push(`coalesce(facilio_id, '') in ('', 'none')`);

  const tag = trimOrNull(input.tag);
  if (tag) {
    // `tags` is text holding a JSON array (L15 — CSV inference has no jsonb), so
    // this is a substring match on the quoted value rather than a containment
    // operator. Quoting both sides stops "car" matching "carpark".
    params.push(`%"${tag}"%`);
    where.push(`tags like $${params.length}`);
  }

  const search = trimOrNull(input.search);
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    const p = `$${params.length}`;
    where.push(
      `(lower(name) like ${p} or lower(coalesce(code, '')) like ${p}
        or lower(coalesce(street, '')) like ${p}
        or coalesce(local_id, 0)::text like ${p})`
    );
  }

  switch (input.needsAttention) {
    case "unsettled":
      where.push(
        `exists (select 1 from fl_prospect_observation o
                  where o.prospect_node_id = ${TABLE}.id
                    and coalesce(o.is_accepted, 'false') = 'false'
                    and o.superseded_by_observation_id is null)`
      );
      break;
    case "missing_area":
      // Area is the number that prices the job; a row without one cannot be bid.
      where.push(`(area is null or area = 0)`);
      break;
    case "not_visited":
      where.push(`verdict in ('unverified', 'not_visited')`);
      break;
    default:
      break;
  }

  const sql = `select ${COLUMNS} from ${TABLE}
                where ${where.join(" and ")}
                order by ancestry_path, name
                limit 2000`;
  return { locations: many<ProspectLocation>(sql, params) };
}

export function getLocation(locationId: string): { location: ProspectLocation } {
  const location = one<ProspectLocation>(
    `select ${COLUMNS} from ${TABLE} where id = $1 and is_active = 'true' limit 1`,
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
    street: string | null;
    childCount: number;
  }>;
} {
  const sites = many<{
    id: string;
    name: string;
    code: string | null;
    facilioId: string | null;
    city: string | null;
    street: string | null;
    childCount: number;
  }>(
    `select l.id, l.name, l.code, l.facilio_id, l.city, l.street,
            (select count(*) from ${TABLE} c
              where c.ancestry_path like l.ancestry_path || '/%'
                and c.is_active = 'true') as child_count
       from ${TABLE} l
      where l.deal_id = $1 and l.type = 'site' and l.is_active = 'true'
      order by l.name
      limit 500`,
    [dealId]
  );
  return { sites };
}

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreateLocationInput {
  /**
   * §4 — the three owners are all optional here and at least one must be set.
   * A location can be born from an enquiry before any deal exists ("the full
   * addresses" arrive with the RFP), so demanding `dealId` would make the Lead
   * portfolio impossible. The guard is in `createLocation`, not the type,
   * because "at least one of three" is not expressible here.
   */
  leadId?: string | null;
  accountId?: string | null;
  dealId?: string | null;
  type: LocationType;
  name: string;
  parentId?: string | null;
  provenance?: Provenance | null;
  surveyId?: string | null;
  description?: string | null;
  code?: string | null;
  clientLevelLabel?: string | null;
  /** Shared by every row that is the same physical building (§4.3). */
  buildingKey?: string | null;
  locationName?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  zip?: string | null;
  locationPhone?: string | null;
  sourceAttachmentId?: string | null;
  verdict?: Verdict | null;
  actor: string | null;
}

/** Just enough of the parent to apply the level and ancestry rules. */
interface ParentRow {
  id: string;
  type: LocationType;
  ancestryPath: string;
  siteId: string | null;
  buildingId: string | null;
  floorId: string | null;
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

  // §4's ownership rule, enforced here because no CHECK constraint is creatable.
  // A row owned by nobody is unreachable from every surface in the product.
  const leadId = trimOrNull(input.leadId);
  const dealId = trimOrNull(input.dealId);
  let accountId = trimOrNull(input.accountId);
  if (!leadId && !accountId && !dealId) {
    throw new Error("a location needs an owner — a lead, an account or a deal");
  }

  /**
   * A deal belongs to a client, so a property recorded against the deal belongs
   * to that client too. `copyForward` has always carried `account_id` across for
   * exactly this reason; a direct create did not, and the consequence is real:
   * `listLocations` scopes on `account_id`, so a building added from the Deal
   * tab came out with `account_id` null and was INVISIBLE on its own client's
   * portfolio tab. The same building, unreachable from the client that owns it.
   *
   * Derived, never asked for — an account passed in wins. A lead is deliberately
   * NOT inherited: §4 fills the owners progressively, and the enquiry that
   * started the deal is not the enquiry that named this particular building.
   *
   * Reading `fl_deal` here does not widen the prospect module — functions share
   * one schema, and ownership is this module's own concern (`survey.listDeals`
   * reads the same table on the same grounds).
   */
  if (!accountId && dealId) {
    const owner = one<{ accountId: string | null }>(
      `select account_id from fl_deal where id = $1 limit 1`,
      [dealId]
    );
    accountId = trimOrNull(owner?.accountId ?? null);
  }

  const provenance = input.provenance
    ? inSet(input.provenance, PROVENANCES, "provenance")
    : "manual";

  let parent: ParentRow | null = null;
  if (input.parentId) {
    // Scoped to the same OWNER, not to the deal alone: a lead-owned location
    // has no deal yet, and matching on deal_id would have refused its children.
    parent = one<ParentRow>(
      `select id, type, ancestry_path, site_id, building_id, floor_id from ${TABLE}
        where id = $1 and is_active = 'true'
          and ((deal_id is not null and deal_id = $2)
            or (account_id is not null and account_id = $3)
            or (lead_id is not null and lead_id = $4))
        limit 1`,
      [input.parentId, dealId, accountId, leadId]
    );
    // A parent from another pursuit would graft this whole subtree under
    // someone else's property.
    if (!parent) throw new Error(`parent ${input.parentId} is not a location on this pursuit`);
  }

  const levelBlock = parentBlocker(type, parent?.type ?? null);
  if (levelBlock) throw new Error(levelBlock);

  // §2.3 rule 4 — the materialised ancestry Facilio actually stores. Derived
  // from the parent, never asked for: a building inherits its parent's site, a
  // floor its building, a space whichever of the three sit above it. This is
  // the check 145 live production buildings would fail, applied before the
  // write instead of lamented after it.
  const siteId = type === "site" ? null : (parent?.siteId ?? (parent?.type === "site" ? parent.id : null));
  const buildingId =
    type === "building" ? null : (parent?.buildingId ?? (parent?.type === "building" ? parent.id : null));
  const floorId = type === "floor" ? null : (parent?.floorId ?? (parent?.type === "floor" ? parent.id : null));

  const now = nowIso();
  const row = one<{ id: string }>(
    `insert into ${TABLE}
       (id, lead_id, account_id, deal_id, survey_id, building_key, type, parent_id,
        site_id, building_id, floor_id, ancestry_path, name, description, code,
        client_level_label, tags, location_name, street, city, state, country, zip,
        location_phone, pursuit_decision, provenance, source_attachment_id, verdict,
        convert_state, created_by, updated_by, is_active, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, '', $11, $12, $13,
             $14, '[]', $15, $16, $17, $18, $19, $20,
             $21, 'undecided', $22, $23, $24,
             'not_converted', $25, $25, 'true', '{}', $26, $26)
     returning id`,
    [
      leadId,
      accountId,
      dealId,
      trimOrNull(input.surveyId),
      trimOrNull(input.buildingKey),
      type,
      parent?.id ?? null,
      siteId,
      buildingId,
      floorId,
      name,
      trimOrNull(input.description),
      trimOrNull(input.code),
      trimOrNull(input.clientLevelLabel),
      trimOrNull(input.locationName),
      trimOrNull(input.street),
      trimOrNull(input.city),
      trimOrNull(input.state),
      trimOrNull(input.country),
      trimOrNull(input.zip),
      trimOrNull(input.locationPhone),
      provenance,
      trimOrNull(input.sourceAttachmentId),
      input.verdict ? inSet(input.verdict, VERDICTS, "verdict") : "unverified",
      input.actor,
      now,
    ]
  );
  if (!row) throw new Error("location insert returned no row");

  // Ancestry needs the id, which only exists after the insert. A root's chain is
  // itself — the base case of the rule, not an exception to it. A site is also
  // its own site_id, which is what makes "every row resolves to a site" a
  // single uniform check rather than one with an exception in it.
  const ancestryPath = parent ? childAncestry(parent.ancestryPath, row.id) : rootAncestry(row.id);
  mutate(
    `update ${TABLE}
        set ancestry_path = $2,
            site_id = coalesce(site_id, case when type = 'site' then $1 end),
            building_id = coalesce(building_id, case when type = 'building' then $1 end),
            floor_id = coalesce(floor_id, case when type = 'floor' then $1 end)
      where id = $1`,
    [row.id, ancestryPath]
  );

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
      `select id, type, ancestry_path from ${TABLE}
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
    `update ${TABLE}
        set parent_id = $2, ancestry_path = $3, updated_by = $4, updated_at = $5
      where id = $1`,
    [location.id, parent?.id ?? null, newPath, input.actor, now]
  );

  // Every descendant, in one statement: swap the old prefix for the new one.
  const descendantsRestamped = mutate(
    `update ${TABLE}
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
    `update ${TABLE}
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
    `update ${TABLE}
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
    `select ${COLUMNS} from ${TABLE} where id = $1 and is_active = 'true' limit 1`,
    [input.sourceLocationId]
  );
  if (!source) throw new Error(`source location ${input.sourceLocationId} not found`);
  if (source.dealId === input.dealId) {
    throw new Error("that location is already on this deal — copy forward is for an earlier pursuit");
  }

  // §4.3 — copy-forward is the moment `building_key` is stamped, because it is
  // the one moment the system KNOWS two rows are the same physical building.
  // The source may not carry one yet (nothing did before v1.3), so it adopts
  // its own id as the key and the copy joins it. Both rows then group together
  // on the global list without walking the previous_pursuit_id chain.
  const buildingKey = source.buildingKey ?? source.id;

  // The copy is a normal create, so it goes through the same level and ancestry
  // rules as anything else rather than round-tripping raw columns.
  const { location } = createLocation({
    dealId: input.dealId,
    // The account is NOT carried from the source, it is derived from the TARGET
    // deal inside `createLocation`. Copy-forward exists for the case where the
    // same physical building is bid a second time, and the second pursuit is
    // what the copy belongs to — carrying the old account would put a row on
    // one client's portfolio tab while its deal names another. `buildingKey`
    // above is what keeps the two pursuits' rows joined; ownership does not
    // have to travel for that to hold.
    type: source.type,
    name: source.name,
    parentId: input.parentId ?? null,
    provenance: "crm",
    buildingKey,
    description: source.description,
    code: source.code,
    clientLevelLabel: source.clientLevelLabel,
    locationName: source.locationName,
    street: source.street,
    city: source.city,
    state: source.state,
    country: source.country,
    zip: source.zip,
    locationPhone: source.locationPhone,
    actor: input.actor,
  });

  const now = nowIso();
  // Stamp the key onto the SOURCE too when it had none, or the pair only groups
  // from one side.
  if (!source.buildingKey) {
    mutate(`update ${TABLE} set building_key = $2, updated_at = $3 where id = $1`, [
      source.id,
      buildingKey,
      now,
    ]);
  }

  // What makes it a copy-forward rather than a new building: the lineage link,
  // the measurements worth starting warm from, and the Facilio id.
  //
  // `floor_level` and `local_id` are NOT copied. A floor's level is a fact about
  // this building's own stack and survives, but `local_id` is Facilio's number
  // for the SOURCE record — carrying it would make the copy claim an identity in
  // Facilio it does not have, and §7.3's create-only rule reads that column.
  mutate(
    `update ${TABLE}
        set previous_pursuit_id = $2,
            area = $3, gross_floor_area = $4, no_of_floors = $5, no_of_buildings = $6,
            room_count = $7, restroom_count = $8, no_of_independent_spaces = $9,
            no_of_sub_spaces = $10, floor_level = $11, max_occupancy = $12,
            operation_hours_start = $13, operation_hours_end = $14,
            ceiling_height_band = $15, space_category_id = $16, site_type = $17,
            classification = $18, lat = $19, lng = $20,
            facilio_id = $21, facilio_module = $22,
            convert_state = case when coalesce($21, '') <> '' then 'already_linked' else 'not_converted' end,
            updated_by = $23, updated_at = $24
      where id = $1`,
    [
      location.id,
      source.id,
      source.area,
      source.grossFloorArea,
      source.noOfFloors,
      source.noOfBuildings,
      source.roomCount,
      source.restroomCount,
      source.noOfIndependentSpaces,
      source.noOfSubSpaces,
      source.floorLevel,
      source.maxOccupancy,
      source.operationHoursStart,
      source.operationHoursEnd,
      source.ceilingHeightBand,
      source.spaceCategoryId,
      source.siteType,
      source.classification,
      source.lat,
      source.lng,
      source.facilioId,
      source.facilioModule,
      input.actor,
      now,
    ]
  );

  let copied = 1;
  if (input.withDescendants) {
    const children = many<{ id: string }>(
      `select id from ${TABLE}
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
    `update ${TABLE}
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

  // X-22 — the reason is REQUIRED, not optional. Removal cascades to the whole
  // subtree and nothing is ever hard-deleted, so the only way anyone later
  // learns why a building left the pursuit is the sentence typed here. Every
  // other destructive-ish action in this module already demands one; this was
  // the gap.
  const reason = trimOrNull(input.reason);
  if (!reason) {
    throw new Error("removing a location needs a reason — it is how anyone later knows why");
  }

  if (location.convertState === "converted") {
    // §9's override: `converted` beats every role, Admin included.
    throw new Error("this location is in Facilio — it cannot be removed from the pursuit");
  }

  const now = nowIso();
  // The subtree goes with it. A live space under a removed building is the
  // orphan case again, just arrived at from the other direction.
  const deactivated = mutate(
    `update ${TABLE}
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
    body: `${location.name} — ${reason}`,
    meta: { reason, deactivated },
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

    // §7 rule 3 — THE ANCESTRY CHECK, against the materialised columns and not
    // a path string. This is the test 145 live production buildings, 860 floors
    // and 480 spaces would fail today. We are the last gate before the write, so
    // it runs here as a blocker rather than as a promise made in a slide.
    if (action === "create") {
      if (l.type === "building" && !l.siteId) blockers.push("no site above it");
      if (l.type === "floor" && !l.buildingId) blockers.push("no building above it");
      if (l.type === "space" && !l.siteId && !l.buildingId && !l.floorId) {
        blockers.push("no site, building or floor above it");
      }
    }

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

// ── Convert run (§7) — the ONE writer of Facilio's portfolio ─────────────────

/**
 * G1 answered the letters the run was blocked on: L20 yes (a space is accepted
 * with only a site above it), L22 yes (client contact create works), and L9's
 * enums are captured in docs/enums.md — of which only `siteType` is sent here,
 * and only when the local value is one Facilio accepts, because an unknown enum
 * value 400s the whole create while an omitted one just leaves the field blank.
 */
const FACILIO_SITE_TYPES = new Set([
  "Common", "Hospital", "Residential", "Office", "Commercial", "Compound",
  "University", "Retail", "Residential & Commercial", "Municipality", "Mall",
  "Accommodation", "Land",
]);

/**
 * `spaceCategory` is MANDATORY on a space create (found live: the API answers
 * 200 with `success: false, "Space Category is mandatory"`). The org's picklist,
 * captured in docs/enums.md. A local category that matches passes through;
 * anything else — including the usual null — lands as "Room", the least wrong
 * default for a walked space, and the mapping stays visible here for the day a
 * category master exists.
 */
const FACILIO_SPACE_CATEGORIES = new Set([
  "Common Area", "Utility", "Office", "Hallway", "Elevator",
  "Tenant Unit", "Desk", "Lockers", "Parking Stall", "Room",
]);

const spaceCategoryFor = (local: string | null): string => {
  const trimmed = (local ?? "").trim();
  for (const known of FACILIO_SPACE_CATEGORIES) {
    if (known.toLowerCase() === trimmed.toLowerCase()) return known;
  }
  return "Room";
};

/** Facilio has no zone module — a zone promotes as a space, like the UI treats it. */
const FACILIO_MODULE: Record<LocationType, "site" | "building" | "floor" | "space"> = {
  site: "site",
  building: "building",
  floor: "floor",
  space: "space",
  zone: "space",
};

const CONVERT_ORDER: Record<LocationType, number> = { site: 0, building: 1, floor: 2, space: 3, zone: 3 };

interface ConvertRunRow {
  locationId: string;
  name: string;
  type: LocationType;
  outcome: "created" | "failed" | "recovered";
  facilioId?: string | null;
  error?: string;
}

/**
 * THE run — prospect portfolio → Facilio portfolio, at Won only.
 *
 * Shape rules, each one paid for:
 *  - Parent-first inside a single pass (sites, then buildings, floors, spaces),
 *    carrying ids created THIS run in memory, so a fresh tree lands in one call.
 *  - Batched (`batchSize`), because Facilio fetches are serialised at ~10s each
 *    and a 50-node tree in one invocation would hit the function timeout. The
 *    caller repeats until `remaining` is 0 — same contract as the sync drain.
 *  - There is no delete API for portfolio records, so the crash window between
 *    "Facilio wrote it" and "we stamped the id" is closed by the log: before
 *    creating, a success row in fl_prospect_convert_log with an id is RECOVERED
 *    (re-stamped), never re-created.
 *  - A failed node marks `convert_failed` and does not stop the run; its
 *    children simply stay blocked and surface in the next preflight.
 */
export async function convertRun(input: {
  dealId: string;
  actor: string | null;
  batchSize?: number;
}): Promise<{
  runId: string;
  attempted: number;
  created: number;
  recovered: number;
  failed: number;
  remaining: number;
  results: ConvertRunRow[];
}> {
  const deal = one<{ stage: string; refNo: string }>(
    "select stage, ref_no from fl_deal where id = $1 limit 1",
    [input.dealId]
  );
  if (!deal) throw new Error(`deal ${input.dealId} not found`);
  // §4.2's whole point, re-checked server-side no matter what the UI asserted.
  if (deal.stage !== "won") {
    throw new Error(`the deal is ${deal.stage} — Facilio's portfolio is written at Won only`);
  }

  const batch = Math.max(1, Math.min(input.batchSize ?? 4, 8));
  const { locations } = listLocations({ dealId: input.dealId, includeNoBid: true });
  const byId = new Map(locations.map((l) => [l.id, l]));
  const freshIds = new Map<string, string>();

  const facilioIdOf = (locationId: string | null): string | null => {
    if (!locationId) return null;
    const fresh = freshIds.get(locationId);
    if (fresh) return fresh;
    const row = byId.get(locationId);
    const id = (row?.facilioId ?? "").trim();
    return id && id !== "none" ? id : null;
  };

  const creatable = locations
    .filter((l) => convertAction(l).action === "create" && (l.name ?? "").trim())
    .sort(
      (a, b) =>
        CONVERT_ORDER[a.type] - CONVERT_ORDER[b.type] ||
        a.ancestryPath.localeCompare(b.ancestryPath)
    );

  const runId = fallbackConvertRunId();
  const results: ConvertRunRow[] = [];
  let created = 0;
  let recovered = 0;
  let failed = 0;

  for (const l of creatable) {
    if (results.length >= batch) break;

    const module = FACILIO_MODULE[l.type];
    const now = nowIso();

    // Crash recovery before anything else: an earlier run may have written
    // Facilio and died before stamping. Trust the log over re-creating.
    const past = one<{ facilioIdCreated: string | null }>(
      `select facilio_id_created from fl_prospect_convert_log
        where location_id = $1 and status = 'success'
          and coalesce(facilio_id_created, '') not in ('', 'none')
        order by attempted_at desc limit 1`,
      [l.id]
    );
    if (past?.facilioIdCreated) {
      stampConverted(l.id, past.facilioIdCreated, module, input.actor, now);
      freshIds.set(l.id, past.facilioIdCreated);
      recovered++;
      results.push({ locationId: l.id, name: l.name, type: l.type, outcome: "recovered", facilioId: past.facilioIdCreated });
      continue;
    }

    // The ordering gate, against live state: parents converted in THIS pass
    // count, which is what lets one run land a whole fresh tree.
    const siteFid = facilioIdOf(l.siteId ?? (l.type === "site" ? null : l.parentId));
    const buildingFid = facilioIdOf(l.buildingId);
    const floorFid = facilioIdOf(l.floorId);
    if (module !== "site" && !siteFid) continue; // parent not there yet — next run
    if (module === "floor" && !buildingFid) continue;

    let payload: Record<string, unknown>;
    if (module === "site") {
      const site: Record<string, unknown> = { name: l.name };
      if (l.siteType && FACILIO_SITE_TYPES.has(l.siteType)) site.siteType = l.siteType;
      const location: Record<string, unknown> = {};
      for (const [key, value] of Object.entries({
        name: l.locationName, street: l.street, city: l.city, state: l.state,
        zip: l.zip, country: l.country, lat: l.lat, lng: l.lng, phone: l.locationPhone,
      })) {
        if (value !== null && value !== undefined && value !== "") location[key] = value;
      }
      if (Object.keys(location).length) site.location = location;
      payload = { site };
    } else if (module === "building") {
      payload = { building: { name: l.name, site: Number(siteFid) } };
    } else if (module === "floor") {
      payload = { floor: { name: l.name, site: Number(siteFid), building: Number(buildingFid) } };
    } else {
      const space: Record<string, unknown> = {
        name: l.name,
        site: Number(siteFid),
        spaceCategory: spaceCategoryFor(l.spaceCategoryId),
      };
      if (buildingFid) space.building = Number(buildingFid);
      if (floorFid) space.floor = Number(floorFid);
      payload = { space };
    }

    const logId = insertConvertLog({
      locationId: l.id, dealId: input.dealId, module,
      parentFacilioId: module === "site" ? null : siteFid,
      runId, actor: input.actor, now,
    });

    try {
      const result = await executeAction("facilio-cmms", `create-${module}`, payload);
      if (!result.recordId) throw new Error("create succeeded but no record id came back");

      stampConverted(l.id, result.recordId, module, input.actor, nowIso());
      mutate(
        `update fl_prospect_convert_log
            set status = 'success', facilio_id_created = $2, updated_at = $3 where id = $1`,
        [logId, result.recordId, nowIso()]
      );
      freshIds.set(l.id, result.recordId);
      created++;
      results.push({ locationId: l.id, name: l.name, type: l.type, outcome: "created", facilioId: result.recordId });

      appendEvent({
        entityType: "prospect_location",
        entityId: l.id,
        kind: "converted",
        actor: input.actor,
        body: `${l.name} → Facilio ${module} ${result.recordId}`,
        meta: { facilioId: result.recordId, module, runId },
      });
    } catch (e) {
      const message = String((e as Error)?.message ?? e).slice(0, 400);
      mutate(
        `update ${TABLE} set convert_state = 'convert_failed', updated_by = $2, updated_at = $3 where id = $1`,
        [l.id, input.actor, nowIso()]
      );
      mutate(
        `update fl_prospect_convert_log set status = 'failed', error_text = $2, updated_at = $3 where id = $1`,
        [logId, message, nowIso()]
      );
      failed++;
      results.push({ locationId: l.id, name: l.name, type: l.type, outcome: "failed", error: message });
    }
  }

  const done = new Set(results.filter((r) => r.outcome !== "failed").map((r) => r.locationId));
  const remaining = creatable.filter((l) => !done.has(l.id)).length;

  return { runId, attempted: results.length, created, recovered, failed, remaining, results };
}

function stampConverted(
  locationId: string,
  facilioId: string,
  module: string,
  actor: string | null,
  now: string
): void {
  mutate(
    `update ${TABLE}
        set facilio_id = $2, facilio_module = $3, convert_state = 'converted',
            updated_by = $4, updated_at = $5
      where id = $1`,
    [locationId, facilioId, module, actor, now]
  );
}

function insertConvertLog(input: {
  locationId: string;
  dealId: string;
  module: string;
  parentFacilioId: string | null;
  runId: string;
  actor: string | null;
  now: string;
}): string {
  const row = one<{ id: string }>(
    `insert into fl_prospect_convert_log
       (id, data_json, created_at, updated_at, location_id, deal_id, target_module,
        target_parent_facilio_id, dedup_key, status, facilio_id_created, error_text,
        run_id, attempted_by, attempted_at, is_active)
     values (gen_random_uuid()::text, '{}', $6, $6, $1, $2, $3, $4, $5, 'attempted', null, null, $7, $8, $6, 'true')
     returning id`,
    [
      input.locationId, input.dealId, input.module,
      input.parentFacilioId ?? "none",
      `location:${input.locationId}:${input.module}`,
      input.now, input.runId, input.actor,
    ]
  );
  if (!row) throw new Error("could not write the convert log row");
  return row.id;
}

/** QuickJS has no crypto; run ids only need uniqueness within the log. */
function fallbackConvertRunId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Observations (§4.3) ──────────────────────────────────────────────────────

/**
 * NOTE ON THE COLUMN NAME. §5.2 calls the foreign key `location_id`; the imported
 * table has `prospect_node_id`, from before §0a purged "node". There is no ALTER
 * (§3a P1), so the physical name stays and every query here uses it. Renaming it
 * would mean a third table and a second migration for a column nobody reads by
 * name — `${TABLE}` was worth that cost, this is not.
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
    `update ${TABLE}
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
  outcome: AcceptanceOutcome;
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
    // §6.3 — priced fields raise a conflict, descriptive ones replace. The tier
    // rides on the field definition, so this is the only place that reads it.
    tier: tierFor(input.fieldKey),
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

/**
 * ★ THE ONE EDIT FORM'S BACKEND (§6.2). Many fields, one save.
 *
 * v1.1 §4.3 said *"nothing edits an attribute directly"* and the build applied
 * it uniformly, so all sixteen fields were entered one at a time through a modal
 * called "Record a measurement" — including Country and Name. Filling one
 * building's address took eight round-trips. **The storage model had been
 * shipped as the user interface.**
 *
 * The ledger underneath was never the problem and is unchanged: this still
 * writes an observation per changed field and still lets the acceptance flow
 * land the value. What changes is that the caller may send thirty fields at
 * once, and that the word "observation" never has to appear on a screen.
 *
 * UNCHANGED FIELDS ARE SKIPPED, not re-observed. Re-recording an identical value
 * on every save would bury the history that makes the ledger worth having under
 * "agrees" rows nobody wrote deliberately.
 *
 * Provenance is inferred from context by the CALLER, not chosen by the user —
 * the walk stamps `survey`, the ingest stamps `rfp`, a person typing stamps
 * `manual` — which is why it is one argument here and not one per field.
 */
export function updateLocation(input: {
  locationId: string;
  /** Field key → new value. A key absent from the map is left alone. */
  fields: Record<string, unknown>;
  provenance?: Provenance | null;
  surveyId?: string | null;
  visitId?: string | null;
  actor: string | null;
}): {
  location: ProspectLocation;
  changed: Array<{ fieldKey: string; outcome: AcceptanceOutcome; reason: string }>;
  skipped: string[];
  conflicts: number;
} {
  const { location } = getLocation(input.locationId);

  const entries = Object.entries(input.fields ?? {});
  const unknown = entries.filter(([k]) => !isFieldKey(k)).map(([k]) => k);
  if (unknown.length) {
    throw new Error(`not editable: ${unknown.join(", ")}`);
  }

  const changed: Array<{ fieldKey: string; outcome: AcceptanceOutcome; reason: string }> = [];
  const skipped: string[] = [];

  for (const [fieldKey, raw] of entries) {
    // An empty value is "leave it alone", not "clear it". Clearing a field that
    // an RFP filled in is a destructive act and needs its own deliberate action,
    // not a blank box in a form somebody tabbed through.
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      skipped.push(fieldKey);
      continue;
    }

    const key = fieldKey as FieldKey;
    const incoming = typeValue(key, raw);
    const current = acceptedFor(location.id, key);

    if (current && valuesMatch(incoming, current)) {
      skipped.push(fieldKey);
      continue;
    }

    const result = observe({
      locationId: location.id,
      fieldKey,
      value: raw,
      provenance: input.provenance ?? "manual",
      surveyId: input.surveyId,
      visitId: input.visitId,
      actor: input.actor,
    });
    changed.push({ fieldKey, outcome: result.outcome, reason: result.reason });
  }

  return {
    location: getLocation(location.id).location,
    changed,
    skipped,
    conflicts: changed.filter((c) => c.outcome === "conflict").length,
  };
}

/** Same-value test, so an unchanged field is not re-observed on every save. */
function valuesMatch(a: TypedValue, b: TypedValue): boolean {
  if (a.valueNumber !== null || b.valueNumber !== null) return a.valueNumber === b.valueNumber;
  return (a.valueText ?? "") === (b.valueText ?? "");
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
            (select l.name from ${TABLE} l where l.id = o.prospect_node_id) as location_name
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
