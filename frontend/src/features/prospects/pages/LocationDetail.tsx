/**
 * S3 — one location: its attributes, where each value came from, and the two
 * values side by side when the feeds disagree.
 *
 * THE PAGE ONLY MAKES SENSE IF ONE RULE IS VISIBLE (§4.3): every attribute shown
 * here is a *cache of the latest accepted value*, not a field someone typed. That
 * is why the attribute rows carry a provenance chip — the value is always
 * *somebody's claim*, never an anonymous fact.
 *
 * WHY THAT MATTERS, because "just let me type it" is the obvious objection: the
 * RFP says 4,500 sqft and the surveyor measured 5,200. Both are true, from
 * different sources, at different times. A plain form field would keep whichever
 * was saved last and destroy the other, and six weeks into a negotiation nobody
 * could say which number the price was built on or who stood behind it.
 *
 * ⚠ v1.3 §6.1 SUPERSEDES WHAT THIS FILE USED TO SAY. It used to claim there was
 * no Edit button anywhere on this page, and treated that as the rule made
 * visible. It was the rule made UNUSABLE: every field went through a modal called
 * "Record a measurement", so an address and a size took eight round-trips, and
 * Country and Name were filed under MEASUREMENTS. The storage model had been
 * shipped as the user interface. There is now one Edit button and one form.
 *
 * The rule itself did not move. `prospect.update` still records each changed
 * field through the same ledger, so a PRICED field that disagrees still stops and
 * waits for a person (§6.3) — what changed is that a descriptive field no longer
 * interrupts anyone, and that the word "observation" never reaches this screen.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { useActor } from "../../../app/auth";
import { PageShell } from "../../../app/shell/PageShell";
import { onDay, placeLine, plural } from "../../../lib/format";
import { Card, SectionTitle } from "../../../ui/Card";
import { Empty, ErrorState } from "../../../ui/States";
import { SimpleRows } from "../../../ui/Skeleton";
import { Button } from "@/components/ui/button";
import { getLocation, listLocations, listObservations } from "../api/prospects-util";
import {
  ConvertChip,
  DecisionChip,
  DiscrepancyChip,
  ProvenanceChip,
  TypeChip,
  VerdictChip,
} from "../components/ProspectChips";
import { ResolveDialog } from "../components/ObservationDialogs";
import {
  DecisionDialog,
  LinkFacilioDialog,
  NewLocationDialog,
  RemoveDialog,
  ReparentDialog,
  VerdictDialog,
} from "../components/ActionDialogs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditLocationDialog } from "../components/EditLocationDialog";
import {
  isAcceptedObservation,
  observationValue,
  childTypesOf,
  OBSERVABLE_FIELD_LABEL,
  RECONCILIATION_DECISION_LABEL,
  TYPE_LABEL,
  type ProspectLocation,
  type ReconciliationDecision,
  type ProspectObservation,
} from "../types/prospect";

/** One field's story: what is accepted, what is contested, what came before. */
type FieldGroup = {
  fieldKey: string;
  label: string;
  accepted: ProspectObservation | null;
  /** Neither accepted nor superseded — waiting on a person. */
  pending: ProspectObservation[];
  /** Superseded, kept for the history. */
  history: ProspectObservation[];
};

function group(observations: ProspectObservation[]): FieldGroup[] {
  const byField = new Map<string, ProspectObservation[]>();
  for (const o of observations) {
    const list = byField.get(o.fieldKey) ?? [];
    list.push(o);
    byField.set(o.fieldKey, list);
  }

  return [...byField.entries()]
    .map(([fieldKey, list]) => ({
      fieldKey,
      label: OBSERVABLE_FIELD_LABEL[fieldKey] ?? fieldKey,
      accepted: list.find(isAcceptedObservation) ?? null,
      pending: list.filter((o) => !isAcceptedObservation(o) && !o.supersededByObservationId),
      history: list.filter((o) => o.supersededByObservationId),
    }))
    // Contested fields first: they are the only ones asking for anything.
    .sort((a, b) => (b.pending.length ? 1 : 0) - (a.pending.length ? 1 : 0));
}

export function LocationDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const actor = useActor();

  const [location, setLocation] = useState<ProspectLocation | null>(null);
  const [observations, setObservations] = useState<ProspectObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [resolving, setResolving] = useState<FieldGroup | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);

  /** Which field rows have their history open. Shut by default — the history
      is detail on demand, not the headline. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (key: string) =>
    setExpanded((e) => {
      const next = new Set(e);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const openSettle = (g: FieldGroup) => {
    setResolving(g);
    setResolveOpen(true);
  };

  /** Every action the tree row menu offers, offered here too (X-19). */
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [verdictOpen, setVerdictOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  /**
   * The rest of this property's own portfolio, for the children list and for
   * the move dialog's legal destinations. Scoped to whichever owner this row
   * carries, which is the same set the tree would show.
   */
  const [siblings, setSiblings] = useState<ProspectLocation[]>([]);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    Promise.all([getLocation(id), listObservations(id)]).then(([loc, obs]) => {
      setLoading(false);
      const err = loc.error ?? obs.error;
      if (err) return setError(err);
      const found = loc.data?.location ?? null;
      setLocation(found);
      setObservations(obs.data?.observations ?? []);

      // Second hop, deliberately not awaited with the first: the page is
      // readable without it, and the children list is the only thing that
      // waits.
      if (found) {
        listLocations(
          {
            ...(found.leadId ? { leadId: found.leadId } : {}),
            ...(found.accountId ? { accountId: found.accountId } : {}),
            ...(found.dealId ? { dealId: found.dealId } : {}),
          },
          true
        ).then(({ data }) => setSiblings(data?.locations ?? []));
      }
    });
  }, [id]);

  useEffect(load, [load]);

  const groups = useMemo(() => group(observations), [observations]);
  const contested = groups.filter((g) => g.pending.length);
  const linked = Boolean((location?.facilioId ?? "").trim());

  const children = useMemo(
    () => siblings.filter((s) => s.parentId === location?.id),
    [siblings, location?.id]
  );
  const canHoldChildren = location ? childTypesOf(location.type).length > 0 : false;

  /** The chain above this row, read straight off `ancestryPath`. */
  const ancestors = useMemo(() => {
    if (!location) return [];
    const ids = (location.ancestryPath ?? "").split("/").filter(Boolean).slice(0, -1);
    return ids
      .map((aid) => siblings.find((s) => s.id === aid))
      .filter((a): a is ProspectLocation => Boolean(a));
  }, [location, siblings]);

  /** Legal destinations for a move: anything that may hold this level, minus
      itself and its own subtree (which would be a cycle). */
  const moveCandidates = useMemo(
    () =>
      location
        ? siblings.filter(
            (o) =>
              o.id !== location.id &&
              !(o.ancestryPath ?? "").startsWith(`${location.ancestryPath}/`) &&
              childTypesOf(o.type).includes(location.type)
          )
        : [],
    [siblings, location]
  );

  return (
    <PageShell
      title={location?.name ?? "Location"}
      subtitle={
        // placeLine drops the "Dubai, Dubai" stutter (X-15).
        location
          ? placeLine(location.street, location.city, location.state) || undefined
          : undefined
      }
      onBack={() => navigate(-1)}
      actions={
        location ? (
          /* X-19 — the detail page used to carry ONE action. Every action the
             tree row offers is reachable here too now, because the page you are
             reading a property on is where you decide things about it. Edit
             stays promoted; the rest sit behind a menu so the header does not
             become a toolbar. */
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />
              Edit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canHoldChildren ? (
                  <DropdownMenuItem onSelect={() => setAddChildOpen(true)}>
                    Add inside
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => setVerdictOpen(true)}>
                  Set the verdict
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDecisionOpen(true)}>
                  Bid or no bid
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMoveOpen(true)}>Move</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setLinkOpen(true)}>
                  Link to Facilio
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setRemoveOpen(true)}>
                  Remove from the pursuit
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null
      }
    >
      {loading ? (
        <Card pad={false}>
          <SimpleRows count={5} />
        </Card>
      ) : error ? (
        <Card pad={false}>
          <ErrorState message={error} onRetry={load} />
        </Card>
      ) : !location ? (
        <Card pad={false}>
          <Empty title="Not found" body="This location is not in the pursuit any more." />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {/* X-19's missing breadcrumb. `onBack` is browser history, which
              answers "where was I", not "where is this". A space three levels
              down needs to say which building it is in. */}
          {ancestors.length ? (
            <div className="text-muted-foreground -mt-1 flex flex-wrap items-center gap-1 text-xs">
              {ancestors.map((a) => (
                <span key={a.id} className="flex items-center gap-1">
                  <Link to={`/portfolio/${a.id}`} className="hover:text-foreground hover:underline">
                    {a.name}
                  </Link>
                  <span aria-hidden="true">/</span>
                </span>
              ))}
              <span className="text-foreground">{location.name}</span>
            </div>
          ) : null}

          {/* What the location IS — the four states that decide what happens to
              it, in one row, because they are read together or not at all. */}
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <TypeChip type={location.type} clientLabel={location.clientLevelLabel} />
              <VerdictChip verdict={location.verdict} />
              <DecisionChip decision={location.pursuitDecision} />
              <ConvertChip state={location.convertState} />
              {linked && location.verdict === "changed" ? <DiscrepancyChip /> : null}
              {location.code ? (
                <span className="text-muted-foreground font-mono text-xs">{location.code}</span>
              ) : null}
            </div>

            {location.verdictNote ? (
              <div className="mt-3">
                <SectionTitle>What the walk found</SectionTitle>
                <span className="text-sm">{location.verdictNote}</span>
                <div className="text-muted-foreground mt-1 text-xs">
                  This prints on the proposal as a qualification.
                  {location.verdictBy ? ` Recorded by ${location.verdictBy}` : ""}
                  {location.verdictAt ? ` ${onDay(location.verdictAt)}` : ""}
                </div>
              </div>
            ) : null}

            {location.pursuitDecisionNote ? (
              <div className="mt-3">
                <SectionTitle>Why this decision</SectionTitle>
                <span className="text-sm">{location.pursuitDecisionNote}</span>
              </div>
            ) : null}

            {location.previousPursuitId ? (
              <div className="mt-3">
                <SectionTitle>Bid before</SectionTitle>
                <span className="text-muted-foreground text-sm">
                  Copied forward from an earlier pursuit, so its measurements started warm rather
                  than blank. The two records stay separate on purpose — a survey describes a
                  building on the day it was walked.
                </span>
              </div>
            ) : null}
          </Card>

          {/* The disagreements, above everything, because they are the only thing
              on this page that is asking the reader for something. */}
          {contested.length ? (
            <Card pad={false} title={`${contested.length} value${contested.length === 1 ? "" : "s"} to settle`}>
              {contested.map((g) => (
                <div key={g.fieldKey} className="border-b px-4 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertTriangle
                      className="size-4 shrink-0 text-orange-600 dark:text-orange-500"
                      aria-hidden="true"
                    />
                    <span className="text-sm font-medium">{g.label}</span>
                    <span className="min-w-2 flex-1" />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setResolving(g);
                        setResolveOpen(true);
                      }}
                    >
                      Settle this
                    </Button>
                  </div>

                  {/* Side by side. Neither is styled as the winner — that is the
                      reader's call, and pre-ranking them would be this page
                      making it for them. */}
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {g.accepted ? <ValueCard o={g.accepted} note="currently used" /> : null}
                    {g.pending.map((o) => (
                      <ValueCard key={o.id} o={o} note="proposed" />
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          ) : null}

          {/**
            * ONE PANEL, NOT TWO.
            *
            * This used to be "What we know" followed by "Everything anyone has
            * said about this location" — and with one observation per field they
            * rendered the same four rows twice, which read as a bug. The history
            * is not a separate subject; it is the SAME row, in more detail. So a
            * field expands to show who said what, and only when it has something
            * more to say.
            */}
          <Card pad={false} title="What we know">
            {!groups.length ? (
              <Empty
                tight
                title="Nothing recorded yet"
                body="Area, floors, rooms and restrooms can come from the RFP, from a walk, or be typed in. Every value keeps the feed it came from, so two sources disagreeing becomes a question rather than a lost number."
                action={
                  <Button size="sm" onClick={() => setEditOpen(true)}>
                    Fill this in
                  </Button>
                }
              />
            ) : (
              groups.map((g) => {
                const extra = g.pending.length + g.history.length;
                const open = expanded.has(g.fieldKey);
                return (
                  <div key={g.fieldKey} className="border-b last:border-b-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="text-muted-foreground w-36 shrink-0 text-xs">{g.label}</span>
                      <span className="text-sm font-medium">
                        {g.accepted ? (
                          observationValue(g.accepted)
                        ) : (
                          <em className="font-normal">unsettled</em>
                        )}
                      </span>
                      {g.accepted ? <ProvenanceChip provenance={g.accepted.provenance} /> : null}
                      <span className="min-w-2 flex-1" />

                      {g.pending.length ? (
                        <Button size="sm" variant="outline" onClick={() => openSettle(g)}>
                          Settle {plural(g.pending.length, "value", "values")}
                        </Button>
                      ) : null}

                      {/* Only offered when there IS more — a disclosure that
                          opens onto nothing is worse than no disclosure. */}
                      {extra ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(g.fieldKey)}
                          aria-expanded={open}
                          className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
                        >
                          {open ? "Hide" : `${plural(extra, "entry", "entries")}`}
                        </button>
                      ) : null}
                    </div>

                    {open ? (
                      <div className="bg-muted/30 flex flex-col">
                        {[...g.pending, ...g.history].map((o) => (
                          <div
                            key={o.id}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 pl-[calc(1rem+9rem)]"
                          >
                            <span
                              className={
                                o.supersededByObservationId
                                  ? "text-muted-foreground text-sm line-through"
                                  : "text-sm"
                              }
                            >
                              {observationValue(o)}
                            </span>
                            <ProvenanceChip provenance={o.provenance} />
                            {o.supersededByObservationId ? (
                              <span className="text-muted-foreground text-xs">
                                replaced
                                {o.reconciliationDecision
                                  ? ` · ${
                                      RECONCILIATION_DECISION_LABEL[
                                        o.reconciliationDecision as ReconciliationDecision
                                      ] ?? "settled"
                                    }`
                                  : ""}
                              </span>
                            ) : (
                              <span className="text-xs text-orange-600 dark:text-orange-500">
                                waiting
                              </span>
                            )}
                            <span className="min-w-2 flex-1" />
                            <span className="text-muted-foreground shrink-0 text-xs">
                              {o.observedBy ?? "unknown"}
                              {o.observedAt ? ` · ${onDay(o.observedAt)}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </Card>

          {/* What is INSIDE this one — and the way to add to it. A property with
              no way to gain a floor from its own page sends the user back to the
              tree to do something they are already looking at. */}
          <Card
            pad={false}
            title={`Inside this ${TYPE_LABEL[location.type].toLowerCase()}`}
            meta={
              canHoldChildren ? (
                <Button size="sm" variant="outline" onClick={() => setAddChildOpen(true)}>
                  <Plus className="size-4" />
                  Add
                </Button>
              ) : null
            }
          >
            {!canHoldChildren ? (
              <Empty
                tight
                title="Nothing goes inside a space"
                body="A space is the deepest level that holds anything — sub-spaces hang off it, and those are added from the tree."
              />
            ) : !children.length ? (
              <Empty
                tight
                title="Nothing inside yet"
                body={`A ${TYPE_LABEL[location.type].toLowerCase()} can hold ${childTypesOf(
                  location.type
                )
                  .map((t) => TYPE_LABEL[t].toLowerCase())
                  .join(", ")}.`}
                action={
                  <Button size="sm" onClick={() => setAddChildOpen(true)}>
                    <Plus className="size-4" />
                    Add the first one
                  </Button>
                }
              />
            ) : (
              children.map((c) => (
                <Link
                  key={c.id}
                  to={`/portfolio/${c.id}`}
                  className="hover:bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 last:border-b-0"
                >
                  <TypeChip type={c.type} clientLabel={c.clientLevelLabel} />
                  <span className="text-sm font-medium">{c.name}</span>
                  {c.code ? (
                    <span className="text-muted-foreground font-mono text-xs">{c.code}</span>
                  ) : null}
                  {c.area ? (
                    <span className="text-muted-foreground text-xs">{c.area} sq ft</span>
                  ) : null}
                  <span className="min-w-2 flex-1" />
                  <VerdictChip verdict={c.verdict} />
                </Link>
              ))
            )}
          </Card>
        </div>
      )}

      {location ? (
        <>
          <EditLocationDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            location={location}
            actor={actor}
            onSaved={load}
            // A conflict raised by the save is settled in the same place every
            // other contested value is, rather than in a second bespoke screen.
            onShowContested={() => {
              const first = contested[0];
              if (!first) return;
              setResolving(first);
              setResolveOpen(true);
            }}
          />
          <NewLocationDialog
            open={addChildOpen}
            onOpenChange={setAddChildOpen}
            owner={{
              ...(location.leadId ? { leadId: location.leadId } : {}),
              ...(location.accountId ? { accountId: location.accountId } : {}),
              ...(location.dealId ? { dealId: location.dealId } : {}),
            }}
            parent={location}
            actor={actor}
            onDone={load}
          />
          <VerdictDialog
            open={verdictOpen}
            onOpenChange={setVerdictOpen}
            location={location}
            actor={actor}
            onDone={load}
          />
          <DecisionDialog
            open={decisionOpen}
            onOpenChange={setDecisionOpen}
            location={location}
            actor={actor}
            onDone={load}
          />
          <ReparentDialog
            open={moveOpen}
            onOpenChange={setMoveOpen}
            location={location}
            candidates={moveCandidates}
            descendantCount={
              siblings.filter((o) =>
                (o.ancestryPath ?? "").startsWith(`${location.ancestryPath}/`)
              ).length
            }
            actor={actor}
            onDone={load}
          />
          <LinkFacilioDialog
            open={linkOpen}
            onOpenChange={setLinkOpen}
            location={location}
            actor={actor}
            onDone={load}
          />
          <RemoveDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            location={location}
            descendantCount={
              siblings.filter((o) =>
                (o.ancestryPath ?? "").startsWith(`${location.ancestryPath}/`)
              ).length
            }
            actor={actor}
            // Removing the thing you are looking at should not leave you
            // looking at it.
            onDone={() => navigate("/portfolio")}
          />
          <ResolveDialog
            open={resolveOpen}
            onOpenChange={setResolveOpen}
            locationId={location.id}
            group={resolving}
            actor={actor}
            onDone={() => {
              setResolving(null);
              load();
            }}
          />
        </>
      ) : null}
    </PageShell>
  );
}

/** One claim, with who made it. Never styled as better than its neighbour. */
function ValueCard({ o, note }: { o: ProspectObservation; note: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{observationValue(o)}</span>
        <ProvenanceChip provenance={o.provenance} />
        <span className="text-muted-foreground text-xs">{note}</span>
      </div>
      <div className="text-muted-foreground mt-0.5 text-xs">
        {o.observedBy ?? "unknown"}
        {o.observedAt ? ` · ${onDay(o.observedAt)}` : ""}
      </div>
    </div>
  );
}
