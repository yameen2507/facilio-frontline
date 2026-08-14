/**
 * S3 — one location: its attributes, where each value came from, and the two
 * values side by side when the feeds disagree.
 *
 * THE PAGE ONLY MAKES SENSE IF ONE RULE IS VISIBLE (§4.3): every attribute shown
 * here is a *cache of the latest accepted observation*, not a field someone typed.
 * So there is no "edit" button anywhere on this page. Changing an area means
 * recording what you observed; if it agrees with what is accepted, it lands
 * silently, and if it disagrees, both values stay and a person chooses. That is
 * why the attribute rows carry a provenance chip: the value is always *somebody's
 * claim*, never an anonymous fact.
 *
 * WHY THAT IS WORTH THE EXTRA STEP, because "just let me type it" is the obvious
 * objection: the RFP says 4,500 sqft and the surveyor measured 5,200. Both are
 * true, from different sources, at different times. A form field would keep
 * whichever was saved last and destroy the other, and six weeks into a negotiation
 * nobody could say which number the price was built on or who stood behind it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Plus } from "lucide-react";
import { useActor } from "../../../app/auth";
import { PageShell } from "../../../app/shell/PageShell";
import { onDay } from "../../../lib/format";
import { Card, SectionTitle } from "../../../ui/Card";
import { Empty, ErrorState } from "../../../ui/States";
import { SimpleRows } from "../../../ui/Skeleton";
import { Button } from "@/components/ui/button";
import { getLocation, listObservations } from "../api/prospects-util";
import {
  ConvertChip,
  DecisionChip,
  DiscrepancyChip,
  ProvenanceChip,
  TypeChip,
  VerdictChip,
} from "../components/ProspectChips";
import { ObserveDialog, ResolveDialog } from "../components/ObservationDialogs";
import {
  isAcceptedObservation,
  observationValue,
  OBSERVABLE_FIELD_LABEL,
  OBSERVABLE_FIELDS,
  type ProspectLocation,
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

  const [observeOpen, setObserveOpen] = useState(false);
  const [resolving, setResolving] = useState<FieldGroup | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    Promise.all([getLocation(id), listObservations(id)]).then(([loc, obs]) => {
      setLoading(false);
      const err = loc.error ?? obs.error;
      if (err) return setError(err);
      setLocation(loc.data?.location ?? null);
      setObservations(obs.data?.observations ?? []);
    });
  }, [id]);

  useEffect(load, [load]);

  const groups = useMemo(() => group(observations), [observations]);
  const contested = groups.filter((g) => g.pending.length);
  const linked = Boolean((location?.facilioId ?? "").trim());

  return (
    <PageShell
      title={location?.name ?? "Location"}
      subtitle={
        location
          ? [location.addressLine, location.city, location.region].filter(Boolean).join(", ") ||
            undefined
          : undefined
      }
      onBack={() => navigate(-1)}
      actions={
        location ? (
          <Button size="sm" onClick={() => setObserveOpen(true)}>
            <Plus className="size-4" />
            Record a measurement
          </Button>
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

          <Card pad={false} title="Measurements">
            {!groups.length ? (
              <Empty
                tight
                title="Nothing measured yet"
                body="Area, floors, rooms and restrooms all arrive as observations — from the RFP, from a walk, or typed in. Every value keeps the feed that said it, so two sources disagreeing becomes a question rather than a lost number."
                action={
                  <Button size="sm" onClick={() => setObserveOpen(true)}>
                    Record the first one
                  </Button>
                }
              />
            ) : (
              groups.map((g) => (
                <div
                  key={g.fieldKey}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 last:border-b-0"
                >
                  <span className="text-muted-foreground w-36 shrink-0 text-xs">{g.label}</span>
                  <span className="text-sm font-medium">
                    {g.accepted ? observationValue(g.accepted) : <em className="font-normal">unsettled</em>}
                  </span>
                  {g.accepted ? <ProvenanceChip provenance={g.accepted.provenance} /> : null}
                  <span className="min-w-2 flex-1" />
                  {g.pending.length ? (
                    <span className="text-xs text-orange-600 dark:text-orange-500">
                      {g.pending.length} other value{g.pending.length === 1 ? "" : "s"} waiting
                    </span>
                  ) : null}
                  {g.history.length ? (
                    <span className="text-muted-foreground text-xs">
                      {g.history.length} earlier
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </Card>

          {/* The audit trail. Superseded values are kept rather than deleted, so
              "why is this 5,200?" is answerable without anyone remembering. */}
          {observations.length ? (
            <Card pad={false} title="Everything anyone has said about this location">
              {observations.map((o) => (
                <div
                  key={o.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 last:border-b-0"
                >
                  <span className="text-muted-foreground w-36 shrink-0 text-xs">
                    {OBSERVABLE_FIELD_LABEL[o.fieldKey] ?? o.fieldKey}
                  </span>
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
                  {isAcceptedObservation(o) ? (
                    <span className="text-xs text-green-600 dark:text-green-500">in use</span>
                  ) : o.supersededByObservationId ? (
                    <span className="text-muted-foreground text-xs">
                      replaced{o.reconciliationDecision ? ` · ${o.reconciliationDecision}` : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-orange-600 dark:text-orange-500">waiting</span>
                  )}
                  <span className="min-w-2 flex-1" />
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {o.observedBy ?? "unknown"}
                    {o.observedAt ? ` · ${onDay(o.observedAt)}` : ""}
                  </span>
                </div>
              ))}
            </Card>
          ) : null}
        </div>
      )}

      {location ? (
        <>
          <ObserveDialog
            open={observeOpen}
            onOpenChange={setObserveOpen}
            location={location}
            fields={OBSERVABLE_FIELDS}
            actor={actor}
            onDone={load}
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
