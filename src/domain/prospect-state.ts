/**
 * The prospect portfolio's rules. Pure — no db, no fetch, no platform imports.
 * `Prospect Portfolio Module v1.1.md` §4, §5.1, §10.
 *
 * v1.1 §11 asks for this file by name, beside the shipped `lead-state.ts`, for
 * the reason that pattern earned: these are the rules a wrong `if` turns into
 * corrupt data in a customer's live CMMS, and here they run on a laptop.
 *
 * TWO INDEPENDENT STATE MACHINES, and keeping them apart is the design (§4):
 *
 *   `verdict`       — is this real?          (a walk answers it)
 *   `convert_state` — is it in Facilio yet?  (winning the deal answers it)
 *
 * A location can be `verified` forever and never convert, because the deal was
 * lost. It can convert while `unverified`, because nobody walked it — that is
 * the blueprint path, and §2 says a large share of pursuits are priced that way.
 *
 * THERE IS NO THIRD MACHINE. Specifically there is no lost / archived state: a
 * lost deal changes nothing about a building. **The deal carries the outcome.**
 * Buildings don't have deal outcomes, deals do.
 */

// ── Levels ───────────────────────────────────────────────────────────────────

/** The same three words Facilio uses, so convert translates nothing (§5.1). */
export type LocationType = "site" | "building" | "space";

export const LOCATION_TYPES: readonly LocationType[] = ["site", "building", "space"];

/**
 * Which parent a level may hang off.
 *
 * The interesting entry is `space`, which accepts a `building` OR a `site`
 * directly — a car park or a lawn has no building above it. Facilio calls that
 * an *independent space*, and **L20 is still open on whether its API accepts
 * one**; the prospect tree accepts it today either way, because refusing to
 * model a car park would be modelling the integration rather than the world.
 */
const PARENT_TYPES: Record<LocationType, readonly LocationType[]> = {
  site: [],
  building: ["site"],
  space: ["site", "building"],
};

/** Why this parent cannot hold this child, or null. §10's create guard. */
export function parentBlocker(
  childType: LocationType,
  parentType: LocationType | null
): string | null {
  const allowed = PARENT_TYPES[childType];

  if (!parentType) {
    return allowed.length === 0
      ? null
      : `a ${childType} needs a parent — ${allowed.join(" or ")}`;
  }
  if (allowed.length === 0) {
    return "a site is the top level and cannot have a parent";
  }
  if (!allowed.includes(parentType)) {
    return `a ${childType} cannot hang off a ${parentType} — only ${allowed.join(" or ")}`;
  }
  return null;
}

// ── §4.1 verdict — is this real? ─────────────────────────────────────────────

export type Verdict =
  | "unverified"
  | "added_on_site"
  | "verified"
  | "changed"
  | "not_found"
  | "not_visited";

export const VERDICTS: readonly Verdict[] = [
  "unverified",
  "added_on_site",
  "verified",
  "changed",
  "not_found",
  "not_visited",
];

/**
 * Which verdicts demand a written reason.
 *
 * §5.1's why-line for `verdict_note` is the argument, and it is commercial, not
 * clerical: the note prints on the proposal as a qualification, so a blank here
 * is a scope gap nobody can defend in negotiation six weeks later.
 */
export const VERDICTS_NEEDING_NOTE: readonly Verdict[] = ["changed", "not_found", "not_visited"];

export function verdictNeedsNote(verdict: Verdict): boolean {
  return (VERDICTS_NEEDING_NOTE as readonly string[]).includes(verdict);
}

const VERDICT_NEXT: Record<Verdict, readonly Verdict[]> = {
  unverified: ["verified", "changed", "not_found", "not_visited"],
  // A location the surveyor created on site is already as confirmed as it gets;
  // a later visit can still find it altered.
  added_on_site: ["changed"],
  verified: ["changed"],
  // Terminal findings. Re-walking is a new survey (v1.8 T9), not a reopen.
  changed: [],
  not_found: [],
  not_visited: [],
};

export function allowedVerdicts(from: Verdict): readonly Verdict[] {
  return VERDICT_NEXT[from] ?? [];
}

/**
 * Why this verdict change is refused, or null.
 *
 * §4.1's forbidden list, asserted rather than promised. `convertState` is a
 * parameter because of the last rule: once a location is in Facilio, its verdict
 * is history and editing it would describe a record we no longer own alone.
 */
export function verdictBlocker(input: {
  from: Verdict;
  to: Verdict;
  note?: string | null;
  convertState?: ConvertState | null;
  actorIsAssignee?: boolean;
}): string | null {
  if (input.convertState === "converted") {
    return "this location is already in Facilio — its verdict is now history and cannot change";
  }
  if (input.from === input.to) return `already ${input.to}`;
  if (!allowedVerdicts(input.from).includes(input.to)) {
    const next = allowedVerdicts(input.from);
    return next.length
      ? `cannot go from ${input.from} to ${input.to} — only ${next.join(", ")}`
      : `${input.from} is final — a re-walk is a new survey, never a reopen`;
  }
  if (verdictNeedsNote(input.to) && !(input.note ?? "").trim()) {
    return `${input.to} needs a note — it prints on the proposal as a qualification`;
  }
  // Stated honestly, as `lead-state.ts` does: functions receive no caller
  // identity, so this is asserted by the caller. The audit row is honest about
  // WHAT changed and trusting about WHO — a platform property, not a bug here.
  if (input.actorIsAssignee === false) {
    return "only an active assignee on the survey can set a verdict";
  }
  return null;
}

// ── §4.2 convert_state — is it in Facilio yet? ───────────────────────────────

export type ConvertState =
  | "not_converted"
  | "queued"
  | "converted"
  | "convert_failed"
  | "excluded"
  | "already_linked";

export const CONVERT_STATES: readonly ConvertState[] = [
  "not_converted",
  "queued",
  "converted",
  "convert_failed",
  "excluded",
  "already_linked",
];

const CONVERT_NEXT: Record<ConvertState, readonly ConvertState[]> = {
  not_converted: ["queued", "excluded", "already_linked"],
  queued: ["converted", "convert_failed"],
  // Retry re-queues, and the handler reads `dedup_key` before it writes again.
  convert_failed: ["queued"],
  excluded: ["not_converted"],
  // Both terminal. `already_linked` never converts — it is already there.
  converted: [],
  already_linked: [],
};

export function allowedConvertStates(from: ConvertState): readonly ConvertState[] {
  return CONVERT_NEXT[from] ?? [];
}

/**
 * Why this convert move is refused, or null. §4.2's forbidden list.
 *
 * The Won guard is the module's whole safety claim in one line: a bid-stage
 * estimate must never appear in a CMMS the customer is billed against.
 */
export function convertBlocker(input: {
  from: ConvertState;
  to: ConvertState;
  dealIsWon: boolean;
  reason?: string | null;
  facilioId?: string | null;
}): string | null {
  if (input.from === input.to) return `already ${input.to}`;
  if (!allowedConvertStates(input.from).includes(input.to)) {
    const next = allowedConvertStates(input.from);
    return next.length
      ? `cannot go from ${input.from} to ${input.to} — only ${next.join(", ")}`
      : `${input.from} is final`;
  }
  // `already_linked` is a statement of fact about a repeat client's building, so
  // it is the one move that does not wait for Won.
  if (input.to !== "already_linked" && !input.dealIsWon) {
    return "nothing converts until the deal is Won — a bid-stage estimate must never reach the CMMS";
  }
  if (input.to === "excluded" && !(input.reason ?? "").trim()) {
    return "excluding a location from the convert needs a reason";
  }
  if (input.to === "already_linked" && !(input.facilioId ?? "").trim()) {
    return "already_linked means it carries a Facilio id — set the id, or link it first";
  }
  return null;
}

/**
 * Whether a convert run should write this location at all.
 *
 * §7.3, and it is the one rule the module is judged on: **no Facilio id = new =
 * create.** A location that already carries an id is skipped, never updated —
 * and when the survey disagrees with the live record (`verdict = changed`) that
 * is a discrepancy for a person to read, not a write. A maintained, contracted
 * record must never be overwritten by a bid-stage estimate.
 */
export function convertAction(location: {
  facilioId?: string | null;
  verdict: Verdict;
  convertState: ConvertState;
  pursuitDecision: PursuitDecision;
}): { action: "create" | "skip" | "flag"; reason: string } {
  if (location.pursuitDecision === "no_bid") {
    return { action: "skip", reason: "marked no_bid — it is out of the pursuit entirely" };
  }
  if (location.convertState === "excluded") {
    return { action: "skip", reason: "excluded from this convert run" };
  }
  if (location.convertState === "converted") {
    return { action: "skip", reason: "already written by an earlier run" };
  }
  if ((location.facilioId ?? "").trim()) {
    return location.verdict === "changed"
      ? {
          action: "flag",
          reason:
            "already in Facilio and the survey found it changed — raise a discrepancy, write nothing",
        }
      : { action: "skip", reason: "already in Facilio — no id means new, an id means leave it" };
  }
  if (location.verdict === "not_found") {
    return { action: "skip", reason: "seeded but not there — do not create a building that is not real" };
  }
  return { action: "create", reason: "no Facilio id, so it is new" };
}

// ── §5.1 the bid / no-bid call, per site ─────────────────────────────────────

export type PursuitDecision = "undecided" | "bid" | "no_bid" | "deferred";

export const PURSUIT_DECISIONS: readonly PursuitDecision[] = [
  "undecided",
  "bid",
  "no_bid",
  "deferred",
];

/**
 * Why this decision is refused, or null.
 *
 * `no_bid` needs a note because "outside our coverage area" is exactly the thing
 * worth knowing the next time this client tenders (§5.1).
 */
export function decisionBlocker(to: PursuitDecision, note?: string | null): string | null {
  if (to === "no_bid" && !(note ?? "").trim()) {
    return "no_bid needs a note — next time this client tenders, the reason is what you will want";
  }
  return null;
}

/** A `no_bid` row drops out of every total and never converts (§5.1). */
export function countsTowardScope(decision: PursuitDecision): boolean {
  return decision !== "no_bid";
}

// ── §5.1 the remaining closed enums ──────────────────────────────────────────

export type Provenance = "rfp" | "survey" | "crm" | "facilio_link" | "manual";

export const PROVENANCES: readonly Provenance[] = ["rfp", "survey", "crm", "facilio_link", "manual"];

/**
 * **[M]** from the reference walkthrough tool, whose own option text says a high
 * ceiling "may need lift or scaffolding" — which changes the crew and the
 * equipment, so it changes the price. That is why this is a band and not a
 * number nobody would fill in.
 */
export type CeilingBand = "standard_8_10ft" | "high_10_20ft" | "very_high_20ft_plus";

export const CEILING_BANDS: readonly CeilingBand[] = [
  "standard_8_10ft",
  "high_10_20ft",
  "very_high_20ft_plus",
];

/** Which Facilio module a location may be converted into — the user's choice. */
export const CONVERT_TARGETS: readonly LocationType[] = LOCATION_TYPES;

/**
 * The convert target defaults to like-for-like and must be changed explicitly.
 *
 * §12 F-7: a wrong target level produces a wrong hierarchy at scale, and it is
 * unrecoverable without deactivating production records. Defaulting to the
 * level the prospect tree already says makes the safe choice the quiet one.
 */
export function defaultConvertTarget(type: LocationType): LocationType {
  return type;
}
