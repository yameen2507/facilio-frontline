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
import {
  childTypesOf,
  countsTowardScope,
  toTree,
  TYPE_LABEL,
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

export function PortfolioTree() {
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const dealId = params.get("deal") ?? "";

  const [deals, setDeals] = useState<Deal[]>([]);
  const [locations, setLocations] = useState<ProspectLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const found = data?.deals ?? [];
      setDeals(found);
      // One deal is not a choice — select it rather than making the user open a
      // dropdown to reach the only destination.
      if (!dealId && found.length === 1) {
        setParams({ deal: found[0].id }, { replace: true });
      }
    });
    return () => {
      live = false;
    };
    // Runs once: the deal list does not change while this page is open, and
    // re-running on `dealId` would re-fetch it on every switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    if (!dealId) {
      setLocations([]);
      return;
    }
    setLoading(true);
    setError(null);
    listLocations(dealId, true).then(({ data, error: err }) => {
      setLoading(false);
      if (err) return setError(err);
      setLocations(data?.locations ?? []);
    });
  }, [dealId]);

  useEffect(load, [load]);

  const rows = useMemo(() => toTree(locations), [locations]);

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

  return (
    <PageShell
      title="Prospect portfolio"
      subtitle={
        deal
          ? `${deal.refNo} · ${deal.title ?? deal.accountName ?? "Untitled deal"}`
          : "Buildings you hope to be paid to maintain, before they are anything else."
      }
      count={dealId && !loading ? rows.length : undefined}
      strip={
        <Select
          value={dealId}
          onValueChange={(v) => setParams({ deal: v })}
          disabled={!deals.length}
        >
          <SelectTrigger className="w-full sm:w-80">
            <SelectValue placeholder={deals.length ? "Pick the pursuit" : "No deals yet"} />
          </SelectTrigger>
          <SelectContent>
            {deals.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.refNo} — {d.title ?? d.accountName ?? "Untitled"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      actions={
        dealId ? (
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
      }
    >
      {!dealId ? (
        <Card pad={false}>
          <Empty
            title="Pick a pursuit"
            body="A portfolio belongs to one deal. The same building bid twice is two records — one per pursuit — because a survey is a point-in-time record of what was there that day."
          />
        </Card>
      ) : loading ? (
        <Card pad={false}>
          <SimpleRows count={5} />
        </Card>
      ) : error ? (
        <Card pad={false}>
          <ErrorState message={error} onRetry={load} />
        </Card>
      ) : !rows.length ? (
        <Card pad={false}>
          <Empty
            title="Nothing in this pursuit yet"
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
            {rows.map((row) => (
              <LocationRow
                key={row.id}
                row={row}
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
        dealId={dealId}
        parent={modal.kind === "create" ? modal.parent : null}
        actor={actor}
        onDone={load}
      />
      <PasteFromRfpDialog
        open={modalOpen && modal.kind === "paste"}
        onOpenChange={setModalOpen}
        dealId={dealId}
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
function LocationRow({
  row,
  descendants,
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

      {row.code ? (
        <span className="text-muted-foreground shrink-0 font-mono text-xs">{row.code}</span>
      ) : null}

      {row.clientLevelLabel ? (
        <span className="text-muted-foreground shrink-0 text-xs">{row.clientLevelLabel}</span>
      ) : null}

      {row.areaSqft ? (
        <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
          <Ruler className="size-3" aria-hidden="true" />
          {row.areaSqft} sq ft
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
