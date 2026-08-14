import { describe, expect, it } from "vitest";
import {
  ANCESTRY_SEPARATOR,
  ancestryBlocker,
  ancestryDepth,
  ancestryLeaf,
  ancestrySegments,
  childAncestry,
  isDescendantOf,
  MAX_ANCESTRY_DEPTH,
  rootAncestry,
} from "../src/domain/ancestry";

// Readable stand-ins for uuids. The rule never inspects an id's shape.
const SITE = "site-1";
const BUILDING = "bldg-1";
const SPACE = "space-1";

describe("the ancestry rule — CLAUDE.md §3 point 1", () => {
  it("makes a root its own lineage", () => {
    expect(rootAncestry(SITE)).toBe(SITE);
    expect(ancestryDepth(rootAncestry(SITE))).toBe(1);
  });

  it("builds a chain one level at a time", () => {
    const site = rootAncestry(SITE);
    const building = childAncestry(site, BUILDING);
    const space = childAncestry(building, SPACE);

    expect(building).toBe("site-1/bldg-1");
    expect(space).toBe("site-1/bldg-1/space-1");
    expect(ancestrySegments(space)).toEqual([SITE, BUILDING, SPACE]);
  });

  it("parents a space directly to a site — the walk's normal case", () => {
    // Repeatable sections create spaces, and the survey's site is the only
    // parent available: there is no building in the middle unless the RFP
    // seeded one. §3b L20 asks whether Facilio accepts this too; the prospect
    // tree accepts it today.
    const space = childAncestry(rootAncestry(SITE), SPACE);
    expect(space).toBe("site-1/space-1");
    expect(ancestryDepth(space)).toBe(2);
    expect(ancestryBlocker({ id: SPACE, parentId: SITE, ancestryPath: space })).toBeNull();
  });

  it("always ends with the row's own id", () => {
    const space = childAncestry(childAncestry(rootAncestry(SITE), BUILDING), SPACE);
    expect(ancestryLeaf(space)).toBe(SPACE);
    expect(ancestryLeaf(rootAncestry(SITE))).toBe(SITE);
    expect(ancestryLeaf("")).toBeNull();
  });

  it("knows what sits beneath what", () => {
    const site = rootAncestry(SITE);
    const space = childAncestry(site, SPACE);

    expect(isDescendantOf(space, site)).toBe(true);
    expect(isDescendantOf(site, space)).toBe(false);
    // A row is not its own descendant — otherwise a site would appear inside
    // its own subtree and every roll-up would double-count.
    expect(isDescendantOf(site, site)).toBe(false);
  });

  it("never lets a sibling prefix look like a descendant", () => {
    // "site-10" starts with "site-1" as a STRING but is a different site. The
    // separator is what stops a prefix match becoming a tree relationship.
    expect(isDescendantOf("site-10/space-1", "site-1")).toBe(false);
  });
});

describe("the ancestry guard — what F-03 looked like", () => {
  it("rejects the un-stamped row", () => {
    // This is exactly what walk.ts wrote before C32: parent null, no chain.
    expect(ancestryBlocker({ id: SPACE, parentId: null, ancestryPath: "" })).toMatch(/empty/);
    expect(ancestryBlocker({ id: SPACE, parentId: null, ancestryPath: null })).toMatch(/empty/);
  });

  it("rejects an orphan that claims to be a root", () => {
    // The subtler half of F-03: the row HAD an ancestry_path, but it was its
    // own id with no parent, so a discovered room presented as a top-level
    // property. Valid-looking, and invisible in a site-scoped view.
    expect(
      ancestryBlocker({ id: SPACE, parentId: SITE, ancestryPath: rootAncestry(SPACE) })
    ).toMatch(/at least two segments/);
  });

  it("rejects a chain that forgot to append the row itself", () => {
    expect(
      ancestryBlocker({ id: SPACE, parentId: SITE, ancestryPath: rootAncestry(SITE) })
    ).toMatch(/end with the row's own id/);
  });

  it("rejects a chain built from the wrong parent", () => {
    const wrong = childAncestry(rootAncestry("site-other"), SPACE);
    expect(ancestryBlocker({ id: SPACE, parentId: SITE, ancestryPath: wrong })).toMatch(
      /second-to-last segment must be the parent/
    );
  });

  it("rejects a root that carries a parent's chain", () => {
    expect(
      ancestryBlocker({ id: SITE, parentId: null, ancestryPath: childAncestry("x", SITE) })
    ).toMatch(/single-segment/);
  });

  it("rejects a fourth level — floors and assets are out of scope", () => {
    const tooDeep = childAncestry(
      childAncestry(childAncestry(rootAncestry(SITE), BUILDING), "floor-1"),
      SPACE
    );
    expect(ancestryBlocker({ id: SPACE, parentId: "floor-1", ancestryPath: tooDeep })).toMatch(
      /site → building → space/
    );
    expect(MAX_ANCESTRY_DEPTH).toBe(3);
  });

  it("passes every level of a well-formed tree", () => {
    const site = rootAncestry(SITE);
    const building = childAncestry(site, BUILDING);
    const space = childAncestry(building, SPACE);

    expect(ancestryBlocker({ id: SITE, parentId: null, ancestryPath: site })).toBeNull();
    expect(ancestryBlocker({ id: BUILDING, parentId: SITE, ancestryPath: building })).toBeNull();
    expect(ancestryBlocker({ id: SPACE, parentId: BUILDING, ancestryPath: space })).toBeNull();
  });
});

describe("the separator is shared with the SQL that writes the path", () => {
  it("is the single character walk.ts interpolates", () => {
    // walk.ts builds the child path in SQL as
    //   $4 || '${ANCESTRY_SEPARATOR}' || md5(...)
    // importing this constant, so this assertion guards the string the
    // database actually receives rather than a parallel implementation.
    expect(ANCESTRY_SEPARATOR).toBe("/");
    expect(ANCESTRY_SEPARATOR).toHaveLength(1);
  });

  it("cannot appear inside a uuid, so a segment is never ambiguous", () => {
    expect(crypto.randomUUID()).not.toContain(ANCESTRY_SEPARATOR);
  });

  it("orders a parent immediately before its children, which is what the tree read relies on", () => {
    // survey.get sorts nodes by ancestry_path. Lexicographic order over these
    // strings IS depth-first tree order, which is why the Portfolio tab needs
    // no client-side sort.
    const site = rootAncestry(SITE);
    const rows = [childAncestry(site, "space-2"), site, childAncestry(site, "space-1")];
    expect([...rows].sort()).toEqual([site, `${site}/space-1`, `${site}/space-2`]);
  });
});
