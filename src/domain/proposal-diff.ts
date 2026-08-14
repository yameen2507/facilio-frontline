/**
 * The line-level diff between two proposal revisions.
 * Pure — no db, no fetch, no platform imports.
 *
 * THE DIFF IS WHAT MAKES REVISION 2 CHEAPER THAN REVISION 1. That is the whole
 * job: the measured pain is that roughly half of all quotes get revised, and
 * the cost of a revision is not the re-pricing — it is a human re-reading two
 * documents side by side to work out what actually moved.
 *
 * So this answers one question in one screen: what changed, by how much, and
 * what did it do to the totals.
 *
 * Lines are matched by IDENTITY, not by position. A line inserted at the top of
 * v2 must not make every line below it read as "changed" — that is the failure
 * mode that makes a diff worse than no diff at all.
 */

export type ChangeKind =
  | "added"
  | "removed"
  | "quantity_changed"
  | "rate_changed"
  | "mode_changed"
  | "frequency_changed"
  | "optional_changed"
  | "description_changed"
  | "unchanged";

export interface DiffableLine {
  id: string;
  /**
   * What makes this "the same line" across revisions. A revision COPIES its
   * parent's lines, so the copy carries the parent line's id here.
   */
  originLineId?: string | null;
  /** The survey key, when there is one — the most stable identity available. */
  estimationKey?: string | null;
  description: string;
  qty: number;
  /** Minor units. */
  cardPrice: number | null;
  appliedPrice: number | null;
  lineTotal: number | null;
  pricingMode: string | null;
  deltaReason?: string | null;
  frequency: string | null;
  isOptional: boolean;
}

export interface LineChange {
  kind: ChangeKind;
  description: string;
  /** Null on `added`; the previous revision's line otherwise. */
  before: DiffableLine | null;
  /** Null on `removed`; this revision's line otherwise. */
  after: DiffableLine | null;
  /** Every field that moved, in words a human reads. */
  changes: string[];
  /** Minor units, signed. What this line did to the money. */
  totalDelta: number;
}

export interface TotalsDelta {
  oneTimeBefore: number;
  oneTimeAfter: number;
  oneTimeDelta: number;
  recurringBefore: number;
  recurringAfter: number;
  recurringDelta: number;
}

export interface ProposalDiff {
  changes: LineChange[];
  totals: TotalsDelta;
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
  /** One sentence a human can paste into an email. */
  headline: string;
}

/**
 * Identity, best available first:
 *   1. the explicit parent link a copied line carries
 *   2. the survey estimation key, which is stable across re-walks by design
 *   3. the description, which is the last resort and the only one a user can
 *      break by editing
 */
const normalize = (s: string): string => String(s ?? "").trim().toLowerCase();

function identity(line: DiffableLine): string {
  if (line.originLineId) return `origin:${line.originLineId}`;
  if (line.estimationKey) return `key:${line.estimationKey}`;
  return `desc:${normalize(line.description)}`;
}

/** The previous revision's line is matched by its OWN id too, because the child
 *  points back at it — so both sides of the pair have to be indexable. */
function beforeKeys(line: DiffableLine): string[] {
  const keys = [`origin:${line.id}`];
  if (line.originLineId) keys.push(`origin:${line.originLineId}`);
  if (line.estimationKey) keys.push(`key:${line.estimationKey}`);
  keys.push(`desc:${normalize(line.description)}`);
  return keys;
}

const money = (v: number | null): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Quantities are fractional (areas), so compare with a tolerance rather than ===. */
const sameQty = (a: number, b: number): boolean => Math.abs(a - b) < 0.0001;

export function diffProposals(
  before: readonly DiffableLine[],
  after: readonly DiffableLine[]
): ProposalDiff {
  const index = new Map<string, DiffableLine>();
  for (const line of before) {
    for (const key of beforeKeys(line)) {
      // First writer wins, so the strongest identity is not overwritten by a
      // weaker one from a different line.
      if (!index.has(key)) index.set(key, line);
    }
  }

  const matched = new Set<string>();
  const changes: LineChange[] = [];

  for (const line of after) {
    const key = identity(line);
    const candidate =
      index.get(key) ??
      (line.estimationKey ? index.get(`key:${line.estimationKey}`) : undefined) ??
      index.get(`desc:${normalize(line.description)}`);

    // A before-line can be claimed ONCE. Without this, two new lines sharing a
    // description both resolve to the same prior line — two changes against one
    // original, and a second original wrongly reported as removed. That is
    // precisely the confusion the identity ladder exists to prevent.
    const prior = candidate && !matched.has(candidate.id) ? candidate : undefined;

    if (!prior) {
      changes.push({
        kind: "added",
        description: line.description,
        before: null,
        after: line,
        changes: ["added to this revision"],
        totalDelta: money(line.lineTotal),
      });
      continue;
    }

    matched.add(prior.id);

    const notes: string[] = [];
    // Wording is not in the spec's list of changes, but the client reads it on
    // the document — a silently reworded line is a change they can see and we
    // cannot. It ranks last, so it never masks a change to the money.
    // Normalised the SAME way the identity key is. If matching treats two
    // spellings as one line, change-detection must agree — otherwise a line is
    // simultaneously "the same line" and "a reworded line".
    const reworded = normalize(prior.description) !== normalize(line.description);
    if (reworded) notes.push(`wording: "${prior.description}" → "${line.description}"`);
    if (!sameQty(prior.qty, line.qty)) notes.push(`quantity ${prior.qty} → ${line.qty}`);
    if (money(prior.appliedPrice) !== money(line.appliedPrice)) {
      notes.push(`rate ${money(prior.appliedPrice)} → ${money(line.appliedPrice)}`);
    }
    if ((prior.pricingMode ?? "standard") !== (line.pricingMode ?? "standard")) {
      notes.push(`${prior.pricingMode ?? "standard"} → ${line.pricingMode ?? "standard"}`);
      // The reason travels with the mode: an approver reading the diff needs to
      // see WHY the number moved, not just that it did.
      if (line.deltaReason) notes.push(`reason: ${line.deltaReason}`);
    }
    if ((prior.frequency ?? "") !== (line.frequency ?? "")) {
      notes.push(`${prior.frequency ?? "—"} → ${line.frequency ?? "—"}`);
    }
    if (prior.isOptional !== line.isOptional) {
      notes.push(line.isOptional ? "became optional" : "became a committed line");
    }

    // The kind is the most significant single change, for grouping and colour;
    // `changes` carries the full story.
    let kind: ChangeKind = "unchanged";
    if (notes.length) {
      if (prior.isOptional !== line.isOptional) kind = "optional_changed";
      else if ((prior.pricingMode ?? "standard") !== (line.pricingMode ?? "standard")) kind = "mode_changed";
      else if (money(prior.appliedPrice) !== money(line.appliedPrice)) kind = "rate_changed";
      else if (!sameQty(prior.qty, line.qty)) kind = "quantity_changed";
      else if ((prior.frequency ?? "") !== (line.frequency ?? "")) kind = "frequency_changed";
      else kind = "description_changed";
    }

    changes.push({
      kind,
      description: line.description,
      before: prior,
      after: line,
      changes: notes,
      totalDelta: money(line.lineTotal) - money(prior.lineTotal),
    });
  }

  for (const line of before) {
    if (matched.has(line.id)) continue;
    changes.push({
      kind: "removed",
      description: line.description,
      before: line,
      after: null,
      changes: ["removed from this revision"],
      totalDelta: -money(line.lineTotal),
    });
  }

  const totals = totalsDelta(before, after);
  const summary = {
    added: changes.filter((c) => c.kind === "added").length,
    removed: changes.filter((c) => c.kind === "removed").length,
    changed: changes.filter((c) => c.kind !== "added" && c.kind !== "removed" && c.kind !== "unchanged").length,
    unchanged: changes.filter((c) => c.kind === "unchanged").length,
  };

  return { changes, totals, summary, headline: headline(summary, totals) };
}

/**
 * Committed lines only, on both sides — an optional line has never been part of
 * a total, so moving one must not read as a price change.
 */
export function totalsDelta(
  before: readonly DiffableLine[],
  after: readonly DiffableLine[]
): TotalsDelta {
  // A line with no frequency counts as one-time, matching `pricing.ts`'s own
  // fallback. Reading absent-as-recurring would quietly multiply a single
  // charge into a monthly commitment.
  const isRecurring = (l: DiffableLine): boolean =>
    Boolean(l.frequency) && l.frequency !== "one_time";

  const sum = (lines: readonly DiffableLine[], recurring: boolean): number =>
    lines
      .filter((l) => !l.isOptional && isRecurring(l) === recurring)
      .reduce((n, l) => n + money(l.lineTotal), 0);

  const oneTimeBefore = sum(before, false);
  const oneTimeAfter = sum(after, false);
  const recurringBefore = sum(before, true);
  const recurringAfter = sum(after, true);

  return {
    oneTimeBefore,
    oneTimeAfter,
    oneTimeDelta: oneTimeAfter - oneTimeBefore,
    recurringBefore,
    recurringAfter,
    recurringDelta: recurringAfter - recurringBefore,
  };
}

function headline(summary: ProposalDiff["summary"], totals: TotalsDelta): string {
  const parts: string[] = [];
  if (summary.added) parts.push(`${summary.added} added`);
  if (summary.removed) parts.push(`${summary.removed} removed`);
  if (summary.changed) parts.push(`${summary.changed} repriced`);

  if (!parts.length) return "Nothing changed between these revisions.";

  const movement: string[] = [];
  if (totals.oneTimeDelta !== 0) {
    movement.push(`one-time ${totals.oneTimeDelta > 0 ? "up" : "down"} ${Math.abs(totals.oneTimeDelta)}`);
  }
  if (totals.recurringDelta !== 0) {
    movement.push(`recurring ${totals.recurringDelta > 0 ? "up" : "down"} ${Math.abs(totals.recurringDelta)}`);
  }

  return movement.length ? `${parts.join(", ")} — ${movement.join(", ")}.` : `${parts.join(", ")}.`;
}
