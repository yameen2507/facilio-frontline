/**
 * The ancestry rule — CLAUDE.md §3 point 1, and one of the two crown jewels.
 * Pure: no db, no fetch, no platform imports.
 *
 * Every portfolio row carries its full lineage chain in `ancestry_path`. The
 * reason this is a rule and not a convention: a record missing a level **saves
 * successfully and then silently disappears** from the tree, from site-scoped
 * work orders, and from dashboards. There is no error to debug, because nothing
 * failed — the row is simply unreachable. And because the promotion copies the
 * prospect tree into the CMMS, an unenforced ancestry here becomes corrupt data
 * in a customer's live Facilio portfolio, where we cannot fix it.
 *
 * The hierarchy is three levels — site → building → space (v8.6 S1–S7; `floor`
 * and `asset` are out) — so a path has at most three segments.
 *
 * This module exists to make the rule testable. `walk.ts` builds the child path
 * in SQL rather than in JS, so it imports `ANCESTRY_SEPARATOR` from here: the
 * separator is one shared constant, and the tests below therefore guard the
 * string the database actually receives rather than a parallel reimplementation
 * that could drift from it.
 */

/** One character, and it must never appear inside an id. Ids are uuids, so it cannot. */
export const ANCESTRY_SEPARATOR = "/";

/** The deepest level the hierarchy admits — site, building, space. */
export const MAX_ANCESTRY_DEPTH = 3;

/**
 * A root's lineage is itself. This is the base case of the rule, not an
 * exception to it: a site has no parent, so its chain is one segment long, and
 * everything below it prefixes this value.
 */
export function rootAncestry(id: string): string {
  return id;
}

/** A child's lineage is its parent's chain plus its own id. */
export function childAncestry(parentPath: string, id: string): string {
  return `${parentPath}${ANCESTRY_SEPARATOR}${id}`;
}

/** The chain as segments, root first. */
export function ancestrySegments(path: string): string[] {
  return path.split(ANCESTRY_SEPARATOR).filter((s) => s !== "");
}

/** How deep this row sits. A site is 1. */
export function ancestryDepth(path: string): number {
  return ancestrySegments(path).length;
}

/** The row's own id — always the LAST segment. */
export function ancestryLeaf(path: string): string | null {
  const segments = ancestrySegments(path);
  return segments.length ? segments[segments.length - 1] : null;
}

/** Whether `path` sits anywhere beneath `ancestorPath`. */
export function isDescendantOf(path: string, ancestorPath: string): boolean {
  return path.startsWith(`${ancestorPath}${ANCESTRY_SEPARATOR}`);
}

/**
 * Why this row's lineage is invalid, or null when it is sound. Every create
 * path should be able to answer this about what it just wrote.
 *
 * The checks are ordered cheapest-first and each catches a failure that has a
 * real cause:
 *
 *  - an empty path is the un-stamped row — the F-03 shape;
 *  - a path not ending in the row's own id means someone stamped the parent's
 *    chain and forgot to append;
 *  - a path whose second-to-last segment is not the parent means the chain was
 *    built from the wrong row;
 *  - a root carrying more than one segment claims a parent it does not have;
 *  - anything deeper than three levels is not a hierarchy this product has.
 */
export function ancestryBlocker(node: {
  id: string;
  parentId?: string | null;
  ancestryPath?: string | null;
}): string | null {
  const path = node.ancestryPath ?? "";
  if (!path) return "ancestry_path is empty — the row will not appear in the tree";

  const segments = ancestrySegments(path);
  if (segments[segments.length - 1] !== node.id) {
    return "ancestry_path must end with the row's own id";
  }
  if (segments.length > MAX_ANCESTRY_DEPTH) {
    return `ancestry_path is ${segments.length} levels deep — the hierarchy is site → building → space`;
  }

  if (!node.parentId) {
    return segments.length === 1
      ? null
      : "a row with no parent must have a single-segment ancestry_path";
  }

  if (segments.length < 2) return "a row with a parent needs at least two segments";
  if (segments[segments.length - 2] !== node.parentId) {
    return "ancestry_path's second-to-last segment must be the parent id";
  }
  return null;
}
