/**
 * S1 — the prospect portfolio tree. §8 calls this one "P1 — this is the module",
 * and §14's cut line says do not cut it.
 *
 * WHY IT IS A PAGE WITH A DEAL PICKER RATHER THAN A TAB: v1.1 §8 puts this on a
 * Portfolio tab on the Deal, and the Deal detail surface does not exist (`F-14`).
 * Rather than block the module on someone else's page, the deal is a control at
 * the top; when the Deal page lands, this component becomes its tab body and the
 * picker is deleted. The deal also rides in the URL, so a specific pursuit's
 * portfolio is a link.
 *
 * THE TREE IS RENDERED IN SERVER ORDER AND NEVER SORTED HERE. `prospect.list`
 * returns rows ordered by `ancestry_path`, and lexicographic order over those
 * paths IS depth-first tree order — the parent immediately followed by its
 * children. Depth comes from counting the path's segments, not from walking
 * parents, which means a row whose parent is missing still draws at its true
 * depth and gets flagged rather than silently jumping to the root. That silent
 * jump is exactly the C3 failure the ancestry rule exists to expose.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Building2,
  ChevronRight,
  SlidersHorizontal,
  X,
  ClipboardPaste,
  CopyPlus,
  Link2,
  MapPin,
  MoreHorizontal,
  Move,
  Plus,
  Ruler,
  Trash2,
} from "lucide-react";
import { useActor } from "../../../app/auth";
import { PageShell } from "../../../app/shell/PageShell";
import { plural } from "../../../lib/format";
import { Card } from "../../../ui/Card";
import { CountLine } from "../../../ui/Row";
import { Empty, ErrorState } from "../../../ui/States";
import { SimpleRows } from "../../../ui/Skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listDeals, listLocations } from "../api/prospects-util";
import {
  ConvertChip,
  DecisionChip,
  DiscrepancyChip,
  ProvenanceChip,
  VerdictChip,
} from "../components/ProspectChips";
import {
  CopyForwardDialog,
  DecisionDialog,
  LinkFacilioDialog,
  NewLocationDialog,
  RemoveDialog,
  ReparentDialog,
  VerdictDialog,
} from "../components/ActionDialogs";
import { PasteFromRfpDialog } from "../components/PasteFromRfpDialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  childTypesOf,
  countsTowardScope,
  toTree,
  DECISION_LABEL,
  LOCATION_TYPES,
  PURSUIT_DECISIONS,
  TYPE_LABEL,
  VERDICT_LABEL,
  VERDICTS,
  type ProspectLocation,
  type TreeRow,
} from "../types/prospect";

type Deal = { id: string; refNo: string; title: string | null; accountName: string | null };

/** Which dialog is open. One value, so two can never be. */
type Modal =
  | { kind: "none" }
  | { kind: "create"; parent: ProspectLocation | null }
  | { kind: "paste"; parent: ProspectLocation | null }
  | { kind: "decision"; location: ProspectLocation }
  | { kind: "verdict"; location: ProspectLocation }
  | { kind: "reparent"; location: ProspectLocation }
  | { kind: "link"; location: ProspectLocation }
  | { kind: "remove"; location: ProspectLocation }
  | { kind: "copy" };

/**
 * Fixes this list to one owner, so the same component can be a Lead, Account or
 * Deal tab (§5.1). When a scope is given its filter control is hidden — a Deal
 * tab does not need a deal picker — and when it is absent this is the top-level
 * Portfolio page showing everything.
 */
export type PortfolioScope = { leadId?: string; accountId?: string; dealId?: string };

/** The filter bar's state. Every one of them is a §5.2 filter. */
type Filters = {
  dealId: string;
  type: string;
  pursuitDecision: string;
  verdict: string;
  inFacilio: string;
  country: string;
  state: string;
  city: string;
  needsAttention: string;
  search: string;
};

const NO_FILTERS: Filters = {
  dealId: "",
  type: "",
  pursuitDecision: "",
  verdict: "",
  inFacilio: "",
  country: "",
  state: "",
  city: "",
  needsAttention: "",
  search: "",
};

/** Radix Select cannot carry an empty-string value, so "any" is a token. */
const ANY = "__any__";

export function PortfolioTree({ scope }: { scope?: PortfolioScope } = {}) {
  const actor = useActor();
  const [params, setParams] = useSearchParams();

  /**
   * The deal filter lives in the URL so a filtered view is linkable and survives
   * a reload — it used to be the page's gate, and keeping the same `?deal=`
   * parameter means every existing deep link still lands somewhere sensible. It
   * is now one filter among nine rather than the thing standing between the user
   * and the page.
   */
  const urlDeal = params.get("deal") ?? "";
  const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS, dealId: urlDeal });
  const setFilter = (key: keyof Filters) => (value: string) =>
    setFilters((f) => ({ ...f, [key]: value === ANY ? "" : value }));

  const [deals, setDeals] = useState<Deal[]>([]);
  const [locations, setLocations] = useState<ProspectLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** A scoped tab fixes its owner; the global page reads it from the filter. */
  const dealId = scope ? (scope.dealId ?? "") : filters.dealId;
  const isScoped = Boolean(scope);

  /**
   * Visibility is split from the record. The dialogs interpolate a location's
   * name, so deriving `open` from the record would blank the name during the exit
   * animation — the user reads "Remove ." at the moment they decide.
   */
  const [modal, setModal] = useState<Modal>({ kind: "none" });
  const [modalOpen, setModalOpen] = useState(false);
  const show = (next: Modal) => {
    setModal(next);
    setModalOpen(true);
  };

  useEffect(() => {
    let live = true;
    listDeals().then(({ data, error: err }) => {
      if (!live) return;
      if (err) return setError(err);
      // No auto-select any more: the page is not gated on a deal, so choosing
      // one FOR the user would silently hide the rest of their portfolio.
      setDeals(data?.deals ?? []);
    });
    return () => {
      live = false;
    };
    // Runs once: the deal list does not change while this page is open, and
    // re-running on `dealId` would re-fetch it on every switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * X-6 — no gate. An unfiltered load is the WHOLE portfolio, which is what
   * makes this a module instead of a tab on a deal. The server does the
   * filtering: it is one full scan either way (no indexes), and doing it here
   * would mean the row count on screen disagreed with the filter that produced
   * it as soon as the list hit its 2,000-row ceiling.
   */
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listLocations(
      scope
        ? { ...scope, ...(scope.dealId ? {} : { dealId: filters.dealId }) }
        : { ...filters },
      true
    ).then(({ data, error: err }) => {
      setLoading(false);
      if (err) return setError(err);
      setLocations(data?.locations ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scope?.leadId,
    scope?.accountId,
    scope?.dealId,
    filters.dealId,
    filters.type,
    filters.pursuitDecision,
    filters.verdict,
    filters.inFacilio,
    filters.country,
    filters.state,
    filters.city,
    filters.needsAttention,
    filters.search,
  ]);

  useEffect(load, [load]);

  const allRows = useMemo(() => toTree(locations), [locations]);

  /**
   * COLLAPSE, which is what makes a tree a tree (X-11).
   *
   * The list was unusable at 200 buildings because every space under every one
   * of them was always on screen. Collapsing is stored as the set of ids that
   * are SHUT rather than the set that are open, so a newly loaded tree starts
   * fully expanded and a filter that reveals new rows shows them — the opposite
   * default would hide results the user just asked for.
   *
   * A row is hidden when any ancestor is shut, which `ancestryPath` answers
   * directly: a child's path starts with its parent's.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapsed = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Path prefixes of every shut row, so descendants can be tested cheaply. */
  const shutPaths = useMemo(
    () =>
      allRows.filter((r) => collapsed.has(r.id)).map((r) => `${r.ancestryPath ?? ""}/`),
    [allRows, collapsed]
  );

  const rows = useMemo(
    () => allRows.filter((r) => !shutPaths.some((p) => (r.ancestryPath ?? "").startsWith(p))),
    [allRows, shutPaths]
  );

  /** Direct + indirect descendants, for the "(6)" badge on a shut row. */
  const hiddenUnder = useCallback(
    (r: TreeRow) =>
      allRows.filter((o) => (o.ancestryPath ?? "").startsWith(`${r.ancestryPath}/`)).length,
    [allRows]
  );

  /**
   * §5.3 — group by `building_key` on the GLOBAL list only.
   *
   * The same physical building bid three times is three rows, deliberately: a
   * survey is a point-in-time record and copying beats sharing. But on a screen
   * whose whole job is "which of this client's buildings have we been inside?",
   * three rows for one building is noise, so they collapse to one with a chip
   * that expands. A scoped tab NEVER groups — inside one pursuit, one row is one
   * row, and collapsing there would hide a genuine duplicate.
   *
   * Grouping on `buildingKey ?? id` means a row that has never been copied
   * forward is simply its own group. Nothing is invented to make it fit.
   */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const grouping = !isScoped;

  const { visible, siblingsOf } = useMemo(() => {
    if (!grouping) return { visible: rows, siblingsOf: new Map<string, number>() };

    const byKey = new Map<string, TreeRow[]>();
    for (const r of rows) {
      const key = r.buildingKey ?? r.id;
      byKey.set(key, [...(byKey.get(key) ?? []), r]);
    }

    const out: TreeRow[] = [];
    const counts = new Map<string, number>();
    // Walk `rows`, not the map, so server order survives the grouping.
    const emitted = new Set<string>();
    for (const r of rows) {
      const key = r.buildingKey ?? r.id;
      const group = byKey.get(key) ?? [r];
      if (group.length === 1) {
        out.push(r);
        continue;
      }
      if (emitted.has(key)) {
        if (expanded.has(key)) out.push(r);
        continue;
      }
      emitted.add(key);
      out.push(r);
      counts.set(r.id, group.length);
      if (expanded.has(key)) {
        for (const other of group.slice(1)) out.push(other);
      }
    }
    return { visible: out, siblingsOf: counts };
  }, [rows, grouping, expanded]);

  /** How many rows sit beneath each one — the tree already tells us, via paths. */
  const descendantsOf = useCallback(
    (l: ProspectLocation) =>
      locations.filter((o) => (o.ancestryPath ?? "").startsWith(`${l.ancestryPath}/`)).length,
    [locations]
  );

  /** Legal destinations for a move: anything that may hold this level, minus
      itself and anything beneath it (which would be a cycle). */
  const reparentCandidates = useCallback(
    (l: ProspectLocation) =>
      locations.filter(
        (o) =>
          o.id !== l.id &&
          !(o.ancestryPath ?? "").startsWith(`${l.ancestryPath}/`) &&
          childTypesOf(o.type).includes(l.type)
      ),
    [locations]
  );

  const scoped = rows.filter((r) => countsTowardScope(r.pursuitDecision));
  const sites = rows.filter((r) => r.type === "site");
  const orphans = rows.filter((r) => r.orphaned);

  const deal = deals.find((d) => d.id === dealId);

  /**
   * Geography options come from the rows actually returned, not a hardcoded
   * list: this product's service areas are a settings table, and inventing a
   * country list here would be a second source of truth that drifts from it.
   *
   * The cost is honest and worth stating — a filter only offers a value that is
   * present in the CURRENT result set, so narrowing to one city then removes the
   * others from the city list until the filter is cleared.
   */
  const optionsFor = (pick: (l: ProspectLocation) => string | null | undefined) =>
    [...new Set(locations.map((l) => (pick(l) ?? "").trim()).filter(Boolean))].sort();

  const activeCount = Object.entries(filters).filter(
    ([k, v]) => v !== "" && !(isScoped && k === "dealId")
  ).length;

  /**
   * §5.2's filters, collapsed behind one control.
   *
   * Nine dropdowns in a row was the whole width of the page spent on controls
   * that are empty most of the time. They live in a popover now, with two
   * things kept OUTSIDE it so no state is hidden: the search box, which is the
   * most-used one, and a chip per active filter. A count on the button means
   * you can see that something is filtering even with the popover shut — the
   * failure mode of tucking filters away is a user staring at a short list and
   * not knowing why.
   */
  const filterChips = ([
    { key: "dealId", label: deals.find((d) => d.id === filters.dealId)?.refNo ?? filters.dealId },
    { key: "type", label: TYPE_LABEL[filters.type as keyof typeof TYPE_LABEL] ?? filters.type },
    {
      key: "pursuitDecision",
      label: DECISION_LABEL[filters.pursuitDecision as keyof typeof DECISION_LABEL] ??
        filters.pursuitDecision,
    },
    { key: "verdict", label: VERDICT_LABEL[filters.verdict as keyof typeof VERDICT_LABEL] ?? filters.verdict },
    { key: "inFacilio", label: filters.inFacilio === "true" ? "In Facilio" : "Not in Facilio" },
    { key: "country", label: filters.country },
    { key: "state", label: filters.state },
    { key: "city", label: filters.city },
    {
      key: "needsAttention",
      label:
        filters.needsAttention === "unsettled"
          ? "Has a value to settle"
          : filters.needsAttention === "missing_area"
            ? "No area yet"
            : "Not visited",
    },
  ] satisfies Array<{ key: keyof Filters; label: string }>).filter(
    (c) => filters[c.key] !== "" && !(isScoped && c.key === "dealId")
  );

  const filterBar = (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filters.search}
          onChange={(e) => setFilter("search")(e.target.value)}
          placeholder="Search name, reference, number or street"
          className="h-9 w-full sm:w-72"
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-2">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Filters
              {activeCount > 0 ? (
                <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs">
                  {activeCount}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80">
            <div className="flex flex-col gap-3">
              {!isScoped ? (
                <FilterRow
                  label="Pursuit"
                  value={filters.dealId}
                  onChange={(v) => {
                    setFilter("dealId")(v);
                    if (v === ANY) setParams({}, { replace: true });
                    else setParams({ deal: v }, { replace: true });
                  }}
                  placeholder="Any pursuit"
                  options={deals.map((d) => ({
                    value: d.id,
                    label: `${d.refNo} — ${d.title ?? d.accountName ?? "Untitled"}`,
                  }))}
                />
              ) : null}
              <FilterRow
                label="Level"
                value={filters.type}
                onChange={setFilter("type")}
                placeholder="Any level"
                options={LOCATION_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
              />
              <FilterRow
                label="Decision"
                value={filters.pursuitDecision}
                onChange={setFilter("pursuitDecision")}
                placeholder="Any decision"
                options={PURSUIT_DECISIONS.map((d) => ({ value: d, label: DECISION_LABEL[d] }))}
              />
              <FilterRow
                label="Verdict"
                value={filters.verdict}
                onChange={setFilter("verdict")}
                placeholder="Any verdict"
                options={VERDICTS.map((v) => ({ value: v, label: VERDICT_LABEL[v] }))}
              />
              <FilterRow
                label="In Facilio"
                value={filters.inFacilio}
                onChange={setFilter("inFacilio")}
                placeholder="Either"
                options={[
                  { value: "true", label: "Already in Facilio" },
                  { value: "false", label: "Not in Facilio yet" },
                ]}
              />
              <FilterRow
                label="Country"
                value={filters.country}
                onChange={setFilter("country")}
                placeholder="Any country"
                options={optionsFor((l) => l.country).map((c) => ({ value: c, label: c }))}
              />
              <FilterRow
                label="State"
                value={filters.state}
                onChange={setFilter("state")}
                placeholder="Any state"
                options={optionsFor((l) => l.state).map((c) => ({ value: c, label: c }))}
              />
              <FilterRow
                label="City"
                value={filters.city}
                onChange={setFilter("city")}
                placeholder="Any city"
                options={optionsFor((l) => l.city).map((c) => ({ value: c, label: c }))}
              />
              <FilterRow
                label="Needs attention"
                value={filters.needsAttention}
                onChange={setFilter("needsAttention")}
                placeholder="Anything"
                options={[
                  { value: "unsettled", label: "Has a value to settle" },
                  { value: "missing_area", label: "No area yet" },
                  { value: "not_visited", label: "Not visited" },
                ]}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Every active filter as a removable chip, so nothing is hidden behind
          the popover and clearing one is a single click. */}
      {filterChips.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {filterChips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setFilter(c.key)("");
                if (c.key === "dealId") setParams({}, { replace: true });
              }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
            >
              {c.label}
              <X className="size-3" aria-hidden="true" />
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              setFilters({ ...NO_FILTERS });
              setParams({}, { replace: true });
            }}
          >
            Clear all
          </Button>
        </div>
      ) : null}
    </div>
  );

  /**
   * Whether a new property has somewhere to belong.
   *
   * THE BUG THIS FIXES: the gate used to be `dealId` alone, so the Lead and
   * Account tabs — where the owner IS known, just not as a deal — showed no Add
   * buttons at all. The Lead tab exists precisely so the sites named in an
   * enquiry can be recorded before any deal exists, and it could not record one.
   *
   * §4's rule is "at least one of lead, account or deal", and the server enforces
   * exactly that, so the UI should ask exactly that too.
   */
  const owner: PortfolioScope | null = scope
    ? scope
    : filters.dealId
      ? { dealId: filters.dealId }
      : null;

  const addActions = (
        owner ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => show({ kind: "copy" })}>
              <CopyPlus className="size-4" />
              From a previous pursuit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => show({ kind: "paste", parent: null })}
            >
              <ClipboardPaste className="size-4" />
              Paste a site list
            </Button>
            <Button size="sm" onClick={() => show({ kind: "create", parent: null })}>
              <Plus className="size-4" />
              Add a property
            </Button>
          </div>
        ) : null
  );

  const content = (
    <>
      {loading ? (
        <Card pad={false}>
          <SimpleRows count={5} />
        </Card>
      ) : error ? (
        <Card pad={false}>
          <ErrorState message={error} onRetry={load} />
        </Card>
      ) : !rows.length && activeCount > 0 ? (
        /* Filtered to nothing is NOT the same as having nothing, and offering
           "Add a property" here would be answering a question nobody asked. */
        <Card pad={false}>
          <Empty
            title="No property matches these filters"
            body="Nothing in the portfolio fits every filter at once. Widen one, or clear them and start again."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setFilters({ ...NO_FILTERS });
                  setParams({}, { replace: true });
                }}
              >
                Clear {plural(activeCount, "filter", "filters")}
              </Button>
            }
          />
        </Card>
      ) : !rows.length ? (
        <Card pad={false}>
          <Empty
            title="Nothing here yet"
            body="Sites named in the RFP, a building someone walked last week, or a store described on a phone call — all three land here. A name on its own is enough to start."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => show({ kind: "paste", parent: null })}>
                  <ClipboardPaste className="size-4" />
                  Paste a site list
                </Button>
                <Button variant="outline" onClick={() => show({ kind: "create", parent: null })}>
                  <Plus className="size-4" />
                  Add one by hand
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          {orphans.length ? (
            /* C3, surfaced rather than repaired. A row whose parent is missing
               saves fine and then vanishes from a site-scoped view, so the one
               thing this page must not do is quietly re-home it. */
            <div className="border-destructive/40 bg-destructive/5 mb-3 rounded-md border px-4 py-3">
              <span className="text-destructive text-sm font-medium">
                {plural(orphans.length, "row", "rows")} with a missing parent
              </span>
              <div className="text-muted-foreground mt-1 text-sm">
                These sit under something that is no longer in this pursuit, so they will not appear
                in a site-scoped view or convert correctly. Move each one somewhere real.
              </div>
            </div>
          ) : null}

          <Card pad={false}>
            {visible.map((row) => (
              <LocationRow
                key={row.id}
                row={row}
                childCount={hiddenUnder(row)}
                collapsed={collapsed.has(row.id)}
                onToggleCollapse={() => toggleCollapsed(row.id)}
                pursuits={siblingsOf.get(row.id) ?? 0}
                onTogglePursuits={() =>
                  setExpanded((e) => {
                    const key = row.buildingKey ?? row.id;
                    const next = new Set(e);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                descendants={descendantsOf(row)}
                onAdd={() => show({ kind: "create", parent: row })}
                onPaste={() => show({ kind: "paste", parent: row })}
                onDecision={() => show({ kind: "decision", location: row })}
                onVerdict={() => show({ kind: "verdict", location: row })}
                onMove={() => show({ kind: "reparent", location: row })}
                onLink={() => show({ kind: "link", location: row })}
                onRemove={() => show({ kind: "remove", location: row })}
              />
            ))}
          </Card>

          <CountLine>
            {plural(sites.length, "property", "properties")} ·{" "}
            {plural(rows.length, "location", "locations")} in all
            {scoped.length !== rows.length ? (
              <>
                {" · "}
                {rows.length - scoped.length} not being bid, excluded from every total
              </>
            ) : null}
          </CountLine>
        </>
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}

      <NewLocationDialog
        open={modalOpen && modal.kind === "create"}
        onOpenChange={setModalOpen}
        owner={owner ?? {}}
        parent={modal.kind === "create" ? modal.parent : null}
        actor={actor}
        onDone={load}
      />
      <PasteFromRfpDialog
        open={modalOpen && modal.kind === "paste"}
        onOpenChange={setModalOpen}
        owner={owner ?? {}}
        parent={modal.kind === "paste" ? modal.parent : null}
        actor={actor}
        onDone={load}
      />
      <DecisionDialog
        open={modalOpen && modal.kind === "decision"}
        onOpenChange={setModalOpen}
        location={modal.kind === "decision" ? modal.location : null}
        actor={actor}
        onDone={load}
      />
      <VerdictDialog
        open={modalOpen && modal.kind === "verdict"}
        onOpenChange={setModalOpen}
        location={modal.kind === "verdict" ? modal.location : null}
        actor={actor}
        onDone={load}
      />
      <ReparentDialog
        open={modalOpen && modal.kind === "reparent"}
        onOpenChange={setModalOpen}
        location={modal.kind === "reparent" ? modal.location : null}
        candidates={modal.kind === "reparent" ? reparentCandidates(modal.location) : []}
        descendantCount={modal.kind === "reparent" ? descendantsOf(modal.location) : 0}
        actor={actor}
        onDone={load}
      />
      <LinkFacilioDialog
        open={modalOpen && modal.kind === "link"}
        onOpenChange={setModalOpen}
        location={modal.kind === "link" ? modal.location : null}
        actor={actor}
        onDone={load}
      />
      <RemoveDialog
        open={modalOpen && modal.kind === "remove"}
        onOpenChange={setModalOpen}
        location={modal.kind === "remove" ? modal.location : null}
        descendantCount={modal.kind === "remove" ? descendantsOf(modal.location) : 0}
        actor={actor}
        onDone={load}
      />
      <CopyForwardDialog
        open={modalOpen && modal.kind === "copy"}
        onOpenChange={setModalOpen}
        dealId={dealId}
        deals={deals}
        actor={actor}
        onDone={load}
      />
    </>
  );

  /**
   * A scoped tab renders the BODY only.
   *
   * `PageShell` draws a page title, a back affordance and the sticky action
   * strip — all correct for the top-level Portfolio page and all wrong nested
   * inside a Deal tab, where the page already has a title and the reader would
   * meet two headers stacked. So the shell wraps the content on the standalone
   * page and is skipped on a tab, rather than the tab re-implementing the body.
   */
  const body = (
    <>
      {isScoped ? (
        /* The tab still needs the filters and the add buttons the shell would
           otherwise have carried. */
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {filterBar}
          {addActions}
        </div>
      ) : null}
      {content}
    </>
  );

  if (isScoped) return body;

  return (
    <PageShell
      title="Prospect portfolio"
      subtitle={
        deal
          ? `${deal.refNo} · ${deal.title ?? deal.accountName ?? "Untitled deal"}`
          : "Buildings you hope to be paid to maintain, before they are anything else."
      }
      count={loading ? undefined : rows.length}
      strip={filterBar}
      actions={addActions}
    >
      {content}
    </PageShell>
  );
}

// ── One row of the tree ──────────────────────────────────────────────────────

/**
 * Depth is drawn with padding rather than nested DOM.
 *
 * A flat list of rows keeps the divider rhythm even (§15 — whitespace groups,
 * dividers separate) and means the server's ordering is the only thing deciding
 * structure. Nesting divs would put a second, client-side opinion about the tree
 * on screen, and the two can disagree.
 */
/**
 * One labelled filter inside the popover.
 *
 * Radix Select cannot hold an empty string, so "any" rides as a token and is
 * translated back to "" on the way out — otherwise clearing a filter would send
 * `?city=` and match nothing, which reads as "no results" rather than "no
 * filter".
 *
 * A filter with nothing to offer is not rendered: an empty dropdown is a dead
 * control that still costs a click to discover. That matters more here than it
 * did in a visible bar, because inside a popover the user has already paid a
 * click to look.
 */
function FilterRow({
  label,
  value,
  onChange,
  placeholder,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  if (!options.length) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      <Select value={value || ANY} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-48">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{placeholder}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function LocationRow({
  row,
  descendants,
  childCount = 0,
  collapsed = false,
  onToggleCollapse,
  pursuits = 0,
  onTogglePursuits,
  onAdd,
  onPaste,
  onDecision,
  onVerdict,
  onMove,
  onLink,
  onRemove,
}: {
  row: TreeRow;
  descendants: number;
  /** Everything beneath it, at any depth — the count shown when shut. */
  childCount?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** >1 when other pursuits share this building (§5.3). 0 when not grouped. */
  pursuits?: number;
  onTogglePursuits?: () => void;
  onAdd: () => void;
  onPaste: () => void;
  onDecision: () => void;
  onVerdict: () => void;
  onMove: () => void;
  onLink: () => void;
  onRemove: () => void;
}) {
  const linked = Boolean((row.facilioId ?? "").trim());
  const canHoldChildren = childTypesOf(row.type).length > 0;
  const noBid = row.pursuitDecision === "no_bid";

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2.5 last:border-b-0"
      // The indent is the level, so the level is never also a chip — that would
      // be the same fact printed twice.
      style={{ paddingLeft: `calc(1rem + ${row.depth} * 1.25rem)` }}
    >
      {/* The disclosure sits in a fixed-width slot whether or not it renders, so
          a leaf's icon lines up with its siblings' rather than shifting left. */}
      {childCount > 0 ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${row.name}` : `Collapse ${row.name}`}
          className="text-muted-foreground hover:text-foreground -ml-1 flex size-5 shrink-0 items-center justify-center rounded"
        >
          <ChevronRight
            className={collapsed ? "size-4" : "size-4 rotate-90"}
            aria-hidden="true"
          />
        </button>
      ) : (
        <span className="-ml-1 size-5 shrink-0" aria-hidden="true" />
      )}

      {row.type === "site" ? (
        <Building2 className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      ) : row.type === "building" ? (
        <Building2 className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <MapPin className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
      )}

      {/* The name is the link, not the whole row: the row carries a menu and
          several chips, and a row-wide click target would swallow them. */}
      <Link
        to={`/portfolio/${row.id}`}
        className={
          noBid
            ? "text-muted-foreground min-w-0 text-sm font-medium line-through hover:underline"
            : "min-w-0 text-sm font-medium hover:underline"
        }
      >
        {row.name}
      </Link>

      {collapsed && childCount > 0 ? (
        <span className="text-muted-foreground shrink-0 text-xs">
          {childCount} inside
        </span>
      ) : null}

      {pursuits > 1 ? (
        /* The same physical building, bid more than once. A chip rather than a
           merge: the rows stay separate records, this only stops the list
           printing one building three times before anyone has asked. */
        <button
          type="button"
          onClick={onTogglePursuits}
          className="text-muted-foreground hover:text-foreground shrink-0 rounded border px-1.5 py-0.5 text-xs"
        >
          {plural(pursuits, "pursuit", "pursuits")}
        </button>
      ) : null}

      {row.code ? (
        <span className="text-muted-foreground shrink-0 font-mono text-xs">{row.code}</span>
      ) : null}

      {row.clientLevelLabel ? (
        <span className="text-muted-foreground shrink-0 text-xs">{row.clientLevelLabel}</span>
      ) : null}

      {row.area ? (
        <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
          <Ruler className="size-3" aria-hidden="true" />
          {row.area} sq ft
        </span>
      ) : null}

      {row.city ? (
        <span className="text-muted-foreground shrink-0 text-xs">{row.city}</span>
      ) : null}

      <span className="min-w-2 flex-1" />

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {row.orphaned ? (
          <span className="text-destructive text-xs font-medium">parent missing</span>
        ) : null}
        {/* The discrepancy is the loudest thing in the row when it applies: it
            means the survey and a live Facilio record disagree and we wrote
            nothing. A silent no-op is indistinguishable from a bug. */}
        {linked && row.verdict === "changed" ? <DiscrepancyChip /> : null}
        <ProvenanceChip provenance={row.provenance} />
        <VerdictChip verdict={row.verdict} />
        {row.pursuitDecision !== "undecided" ? (
          <DecisionChip decision={row.pursuitDecision} />
        ) : null}
        {row.convertState !== "not_converted" ? <ConvertChip state={row.convertState} /> : null}
      </div>

      {/* The menu swallows its clicks so a future clickable row cannot fire
          underneath it — including items rendered through a portal, which still
          bubble through the React tree. */}
      <div
        className="shrink-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Actions for ${row.name}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canHoldChildren ? (
              <>
                <DropdownMenuItem onSelect={onAdd}>
                  <Plus className="size-4" />
                  Add inside {TYPE_LABEL[row.type].toLowerCase()}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onPaste}>
                  <ClipboardPaste className="size-4" />
                  Paste a list inside
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onSelect={onDecision}>Bid or no bid…</DropdownMenuItem>
            <DropdownMenuItem onSelect={onVerdict}>Record what was found…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onMove}>
              <Move className="size-4" />
              Move{descendants > 0 ? ` (with ${descendants} inside)` : ""}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onLink}>
              <Link2 className="size-4" />
              {linked ? "Change the Facilio link…" : "Link to Facilio…"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <Trash2 className="size-4" />
              Remove from pursuit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
