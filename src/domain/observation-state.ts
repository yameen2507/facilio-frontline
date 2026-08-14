/**
 * The observation acceptance flow. Pure — no db, no fetch, no platform imports.
 * `Prospect Portfolio Module v1.1.md` §4.3.
 *
 * ONE RULE CARRIES THE WHOLE FILE:
 *
 *   > A location's attribute columns are a CACHE of the latest accepted
 *   > observation. Acceptance is the only thing that writes them. Nothing edits
 *   > an attribute directly — not the UI, not a handler, not an import.
 *
 * §4.3 is new at v1.1 and it exists because both prior documents specified the
 * observation table and never the mechanism: Sudharsan asked "who feeds it, what
 * changes it, does it change the location?" and there was no answer written down.
 *
 * WHY IT MATTERS COMMERCIALLY, because the rule reads like bookkeeping and is
 * not: the RFP says 4,500 sqft and the surveyor measured 5,200. Both are true
 * statements, from different sources, at different times. Silently picking one is
 * how a proposal gets priced on a number nobody can defend six weeks later in a
 * negotiation. Keeping both and making a person choose is C25.
 */

// ── Which attributes an observation may write ───────────────────────────────

/**
 * The allowlist, and it is load-bearing for more than tidiness.
 *
 * `field_key` arrives from a caller and decides which COLUMN gets updated. Mapped
 * through anything other than a fixed table, that is both an injection surface
 * and a way to write `is_active` or `convert_state` — columns the acceptance flow
 * has no business touching — by naming them in a field key. So the map is
 * explicit, and a key that is not in it is refused rather than ignored.
 */
/**
 * ⚠ WHICH OF THESE FACILIO ACTUALLY OWNS — read from the live module metadata
 * (`get-<module>-metadata` on org #2944, 15 Aug), not from the spec.
 *
 * `noOfBuildings`, `noOfFloors` and `noOfIndependentSpaces` are **readOnly** in
 * Facilio: it derives them from the records beneath. They stay editable HERE
 * because before convert there are no records to derive from — the RFP says
 * *"about 200, sorry, 200 to 220"* and that guess is a real pricing input. But
 * **convert must never send them**, or it would push a guess into a field the
 * platform computes.
 *
 * `localId` is readOnly there too — it is Facilio's number, back-filled by
 * convert, never typed.
 *
 * OURS, WITH NO FACILIO COUNTERPART AT ALL: `room_count`, `restroom_count`,
 * `ceiling_height_band`, `operation_hours_start/_end`. The spec's §3.3 claimed
 * the operation-hours pair were `BaseSpace` fields; the metadata says they are
 * not. They are still worth keeping — when a building is open decides when the
 * crew can work — they just do not travel to Facilio.
 *
 * `classification` DOES NOT EXIST on site, building, floor or space. L9 named it
 * as one of three mandatory Facilio enums; only two of those are real
 * (`siteType`, `spaceCategory`). The column is minted and harmless, but nothing
 * will ever map to it.
 */
export const OBSERVABLE_FIELDS = {
  // --- priced (§6.3) — a disagreement here moves money ----------------------
  area: { column: "area", kind: "number", label: "Area (sq ft)", tier: "priced" },
  gross_floor_area: {
    column: "gross_floor_area",
    kind: "number",
    label: "Gross floor area (sq ft)",
    tier: "priced",
  },
  no_of_floors: { column: "no_of_floors", kind: "number", label: "Floors", tier: "priced" },
  no_of_buildings: {
    column: "no_of_buildings",
    kind: "number",
    label: "Buildings",
    tier: "priced",
  },
  room_count: { column: "room_count", kind: "number", label: "Rooms", tier: "priced" },
  restroom_count: {
    column: "restroom_count",
    kind: "number",
    label: "Restrooms",
    tier: "priced",
  },
  ceiling_height_band: {
    column: "ceiling_height_band",
    kind: "text",
    label: "Ceiling height",
    tier: "priced",
  },
  max_occupancy: {
    column: "max_occupancy",
    kind: "number",
    label: "Maximum occupancy",
    tier: "priced",
  },
  operation_hours_start: {
    column: "operation_hours_start",
    kind: "number",
    label: "Opens at",
    tier: "priced",
  },
  operation_hours_end: {
    column: "operation_hours_end",
    kind: "number",
    label: "Closes at",
    tier: "priced",
  },

  // --- descriptive — last write wins, full history kept ---------------------
  name: { column: "name", kind: "text", label: "Name", tier: "descriptive" },
  description: { column: "description", kind: "text", label: "Description", tier: "descriptive" },
  code: { column: "code", kind: "text", label: "Client reference", tier: "descriptive" },
  client_level_label: {
    column: "client_level_label",
    kind: "text",
    label: "What they call this level",
    tier: "descriptive",
  },
  floor_level: { column: "floor_level", kind: "number", label: "Floor level", tier: "descriptive" },
  space_category_id: {
    column: "space_category_id",
    kind: "text",
    label: "Category",
    tier: "descriptive",
  },
  site_type: { column: "site_type", kind: "text", label: "Site type", tier: "descriptive" },
  classification: {
    column: "classification",
    kind: "text",
    label: "Classification",
    tier: "descriptive",
  },
  no_of_independent_spaces: {
    column: "no_of_independent_spaces",
    kind: "number",
    label: "Independent spaces",
    tier: "descriptive",
  },
  no_of_sub_spaces: {
    column: "no_of_sub_spaces",
    kind: "number",
    label: "Sub-spaces",
    tier: "descriptive",
  },
  location_name: {
    column: "location_name",
    kind: "text",
    label: "Location name",
    tier: "descriptive",
  },
  street: { column: "street", kind: "text", label: "Address", tier: "descriptive" },
  city: { column: "city", kind: "text", label: "City", tier: "descriptive" },
  state: { column: "state", kind: "text", label: "State / province", tier: "descriptive" },
  country: { column: "country", kind: "text", label: "Country", tier: "descriptive" },
  zip: { column: "zip", kind: "text", label: "Postcode", tier: "descriptive" },
  location_phone: {
    column: "location_phone",
    kind: "text",
    label: "Site phone",
    tier: "descriptive",
  },
  lat: { column: "lat", kind: "number", label: "Latitude", tier: "descriptive" },
  lng: { column: "lng", kind: "number", label: "Longitude", tier: "descriptive" },
  local_id: { column: "local_id", kind: "number", label: "Facilio number", tier: "descriptive" },
} as const;

export type FieldKey = keyof typeof OBSERVABLE_FIELDS;

/**
 * §6.3 — THE TWO-TIER RULE. A disagreement is worth interrupting a human for
 * when it moves money, and not otherwise.
 *
 * `priced`      both values kept, nothing overwritten, a person settles it.
 * `descriptive` last write wins; the full history is still recorded.
 *
 * Nobody's proposal is mispriced because the RFP said "Dubai" and the surveyor
 * said "Dubai, UAE" — but today every one of those raises a queue item someone
 * has to sit down and clear. BOTH TIERS KEEP THE COMPLETE APPEND-ONLY HISTORY,
 * so nothing is lost and C25 holds; what changes is only what interrupts a
 * person.
 *
 * The counter-argument is real: a tender response is scored against the client's
 * own numbering, so an RFP that names a building differently from the surveyor
 * IS worth noticing. The mitigation is that the history still shows both, plus a
 * "names disagree" notice on the location. If that proves too weak, promoting
 * `name` and `code` is a one-word edit on their entries above — which is exactly
 * why the tier lives on the field and not in a branch somewhere.
 */
export type FieldTier = "priced" | "descriptive";

export function tierFor(fieldKey: FieldKey): FieldTier {
  return OBSERVABLE_FIELDS[fieldKey].tier;
}

export const PRICED_FIELD_KEYS = (
  Object.keys(OBSERVABLE_FIELDS) as FieldKey[]
).filter((k) => OBSERVABLE_FIELDS[k].tier === "priced");

export const FIELD_KEYS = Object.keys(OBSERVABLE_FIELDS) as FieldKey[];

export function isFieldKey(value: unknown): value is FieldKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(OBSERVABLE_FIELDS, value);
}

/** The column this key caches into. Throws rather than defaulting — see above. */
export function columnFor(fieldKey: string): string {
  if (!isFieldKey(fieldKey)) {
    throw new Error(`${fieldKey} is not an observable field — one of: ${FIELD_KEYS.join(", ")}`);
  }
  return OBSERVABLE_FIELDS[fieldKey].column;
}

export function kindFor(fieldKey: FieldKey): "text" | "number" {
  return OBSERVABLE_FIELDS[fieldKey].kind;
}

export function labelFor(fieldKey: string): string {
  return isFieldKey(fieldKey) ? OBSERVABLE_FIELDS[fieldKey].label : fieldKey;
}

// ── Typing a value ─────────────────────────────────────────────────────────

export interface TypedValue {
  valueText: string | null;
  valueNumber: number | null;
}

/**
 * Puts a value in the right column for its field.
 *
 * §5.2 is explicit that these are typed columns and never a stringly `value`,
 * and the reason is the same one that produced C31: `"~4,500 sq ft"` reaching an
 * estimator as a string is a silent corruption path into money.
 *
 * A number that will not parse is REFUSED, not stored as text. That is the
 * opposite of the walk's answer-capture policy, and deliberately so: a surveyor
 * mid-walk must never lose an answer, so unparseable input falls back to text
 * there. Here the value is being proposed as *the* area of a building, and a
 * building whose area is the word "big" is worse than a building with no area.
 */
export function typeValue(fieldKey: FieldKey, raw: unknown): TypedValue {
  const text = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!text) throw new Error(`${labelFor(fieldKey)} needs a value`);

  if (kindFor(fieldKey) === "number") {
    // Grouping commas only. A stray unit or word still fails, on purpose.
    const parsed = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(parsed)) {
      throw new Error(`${labelFor(fieldKey)} must be a number — got "${text}"`);
    }
    return { valueText: null, valueNumber: parsed };
  }
  return { valueText: text, valueNumber: null };
}

/** How a value reads on screen and in the payload, whichever column holds it. */
export function displayValue(v: { valueText?: string | null; valueNumber?: number | null }): string {
  if (v.valueNumber !== null && v.valueNumber !== undefined) return String(v.valueNumber);
  return v.valueText ?? "";
}

/**
 * Whether two observations of the same field say the same thing.
 *
 * Numbers compare as numbers, so "4500" and "4,500" and 4500 agree — three
 * spellings of one measurement should not become a conflict a human has to
 * resolve. Text compares case-insensitively and trimmed, so "Ground Floor" and
 * "ground floor" agree too.
 *
 * Deliberately NOT fuzzy beyond that. "4500" and "4520" are a real disagreement
 * even though they are close, and a tolerance would be this module quietly
 * deciding how much money a rounding error is worth.
 */
export function valuesAgree(a: TypedValue, b: TypedValue): boolean {
  if (a.valueNumber !== null && b.valueNumber !== null) return a.valueNumber === b.valueNumber;
  if (a.valueNumber !== null || b.valueNumber !== null) return false;
  return (a.valueText ?? "").trim().toLowerCase() === (b.valueText ?? "").trim().toLowerCase();
}

// ── The acceptance decision ────────────────────────────────────────────────

export type AcceptanceOutcome = "auto_accept" | "agrees" | "replaced" | "conflict";

/**
 * ONE VOCABULARY, EVERYWHERE (§6.2, fixing X-13 and X-14).
 *
 * These words go in the chips, in the settle picker, and in every message this
 * layer produces. NO RAW ENUM MAY REACH A USER — `rfp` leaking into a sentence
 * that reads "From documents" three pixels away is how the build read as three
 * different products. Because the reason strings are built here, the fix has to
 * live here too: a label map in the frontend alone would still leave the server
 * emitting `rfp` in prose.
 */
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  rfp: "From documents",
  survey: "From the walk",
  manual: "Entered by hand",
  crm: "From an earlier pursuit",
  facilio_link: "Linked from Facilio",
};

/** The label, lowercased for mid-sentence use. Never the bare enum. */
export function provenanceLabel(p: string | null | undefined): string {
  if (!p) return "the recorded";
  const label = PROVENANCE_LABEL[p as Provenance];
  return label ? label.toLowerCase() : "the recorded";
}

export interface AcceptanceResult {
  outcome: AcceptanceOutcome;
  /** True when the location's cached column should be written now. */
  writesCache: boolean;
  /** True when a person has to choose before anything is cached. */
  needsHuman: boolean;
  reason: string;
}

/**
 * §4.3's decision tree, as one function.
 *
 * The three branches and why each is right:
 *
 *  - **No accepted value yet** → auto-accept. The first thing anyone says about a
 *    building is not a conflict, and making a human confirm every field of a
 *    freshly pasted RFP would fail §3's adoption test on its own.
 *  - **Agrees with what is accepted** → accept and supersede, no human. Two feeds
 *    telling you the same number is confirmation, not work.
 *  - **Disagrees** → conflict. Both values stay live, the cache is NOT written,
 *    and a person decides. This is the only branch that exists for a commercial
 *    reason rather than a mechanical one.
 */
export function acceptanceFor(input: {
  incoming: TypedValue;
  /** The currently accepted observation for this (location, field), if any. */
  currentAccepted?: (TypedValue & { provenance?: string | null }) | null;
  incomingProvenance: Provenance;
  /** §6.3. Defaults to `priced` so a caller that forgets gets the safe branch. */
  tier?: FieldTier;
}): AcceptanceResult {
  const current = input.currentAccepted;
  const tier = input.tier ?? "priced";

  if (!current) {
    return {
      outcome: "auto_accept",
      writesCache: true,
      needsHuman: false,
      reason: "nothing was recorded for this field yet",
    };
  }

  if (valuesAgree(input.incoming, current)) {
    return {
      outcome: "agrees",
      writesCache: true,
      needsHuman: false,
      reason: `agrees with the value ${provenanceLabel(current.provenance)}`,
    };
  }

  // A Facilio link is a READ of a maintained record. It may be recorded, and it
  // may be shown beside a survey finding, but it must never win automatically —
  // §5.2: "read-only, may never be accepted over a survey value". This outranks
  // the tier: an operational fact quietly overwriting a descriptive field would
  // be the same silent-overwrite failure the ledger exists to prevent.
  if (input.incomingProvenance === "facilio_link") {
    return {
      outcome: "conflict",
      writesCache: false,
      needsHuman: true,
      reason: "the live Facilio record disagrees — a person decides, and Facilio never wins by default",
    };
  }

  // §6.3 — a descriptive field does not interrupt anyone. The new value wins,
  // the old one is superseded, and the complete history stays queryable. This
  // is the only branch where a value is overwritten without a human, and it is
  // confined to fields that cannot move a price.
  if (tier === "descriptive") {
    return {
      outcome: "replaced",
      writesCache: true,
      needsHuman: false,
      reason: `replaces the value ${provenanceLabel(current.provenance)} — both are kept in the history`,
    };
  }

  return {
    outcome: "conflict",
    writesCache: false,
    needsHuman: true,
    reason: `disagrees with the value ${provenanceLabel(current.provenance)} — both are kept until someone chooses`,
  };
}

// ── Resolving a conflict ───────────────────────────────────────────────────

export type Provenance = "rfp" | "survey" | "crm" | "facilio_link" | "manual";

export type ReconciliationDecision =
  | "accepted_survey"
  | "accepted_rfp"
  | "manual_override"
  | "pushed_to_clarification";

export const RECONCILIATION_DECISIONS: readonly ReconciliationDecision[] = [
  "accepted_survey",
  "accepted_rfp",
  "manual_override",
  "pushed_to_clarification",
];

/**
 * Why a reconciliation decision cannot be applied, or null.
 *
 * `manual_override` needs its own value — the whole point of that choice is that
 * neither source was right, so accepting it without a replacement would leave the
 * field with nothing.
 *
 * `pushed_to_clarification` deliberately writes NO value: it means the question
 * goes back to the tenderer, so the field stays unresolved on purpose and the
 * gap is visible rather than papered over with a guess.
 */
export function reconciliationBlocker(input: {
  decision: ReconciliationDecision;
  manualValue?: string | null;
  /** Which provenances are actually present in the conflict. */
  available: Provenance[];
}): string | null {
  if (input.decision === "manual_override" && !(input.manualValue ?? "").trim()) {
    return "a manual override needs the value you want recorded";
  }
  if (input.decision === "accepted_survey" && !input.available.includes("survey")) {
    return "there is no survey value in this conflict to accept";
  }
  if (input.decision === "accepted_rfp" && !input.available.includes("rfp")) {
    return "there is no document value in this conflict to accept";
  }
  return null;
}

/** Whether this decision results in a value being cached onto the location. */
export function decisionWritesCache(decision: ReconciliationDecision): boolean {
  return decision !== "pushed_to_clarification";
}

/** Which provenance a decision picks, when it picks one of the sources. */
export function decisionPicks(decision: ReconciliationDecision): Provenance | null {
  if (decision === "accepted_survey") return "survey";
  if (decision === "accepted_rfp") return "rfp";
  return null;
}
