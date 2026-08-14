/**
 * S4 — Convert to Facilio. §8 calls this one "P1 — it is the demo".
 *
 * WHAT THIS PAGE DOES TODAY: the pre-flight, in full. It reads the pursuit and
 * reports, per location, whether a convert run would create it, skip it, or raise
 * a discrepancy and write nothing — plus the blockers a person has to clear
 * first, including the ordering dependency that a parent must be in Facilio
 * before its child (C3: a record missing a level saves and then silently vanishes
 * from the tree, site-scoped work orders and dashboards).
 *
 * WHAT IT DOES NOT DO: write. `canRunConvert` is false and the primary action is
 * disabled with the reason beside it. That is not an unfinished screen — it is
 * the honest state of the boundary. §12 G1 is open: L9 (which Facilio enums are
 * mandatory on a portfolio create), L20 (does the API accept a space directly
 * under a site?), L21 (can our role deactivate a record, for the reverse walk?)
 * and L22 (can a Client Contact be created?) are all unanswered, and §3a is blunt
 * that a requirement built on an unverified constraint is a wish.
 *
 * A pre-flight is exactly the right thing to build first anyway, because C26 says
 * enrichment happens at the gate rather than after: the screen that tells you
 * what is missing has value on its own, and it has none of the risk.
 *
 * THE BUTTON READS "Convert to Facilio" because that is the user's word and
 * Sudharsan's. The handler behind it stays qualified —
 * `prospect.convert-to-facilio` — so `lead.convert` never collides with it.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, Minus, RefreshCw } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { plural } from "../../../lib/format";
import { Card, SectionTitle } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { Empty, ErrorState } from "../../../ui/States";
import { SimpleRows } from "../../../ui/Skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActor } from "../../../app/auth";
import {
  canRunConvert,
  CONVERT_BLOCKED_REASON,
  convertPreflight,
  convertRun,
  drainFacilioQueue,
  listDeals,
  type ConvertRunResult,
} from "../api/prospects-util";
import { TypeChip } from "../components/ProspectChips";
import { TYPE_LABEL, type Preflight, type PreflightRow } from "../types/prospect";

type Deal = { id: string; refNo: string; title: string | null; accountName: string | null };

export function ConvertToFacilio() {
  const [params, setParams] = useSearchParams();
  const dealId = params.get("deal") ?? "";

  const [deals, setDeals] = useState<Deal[]>([]);
  /**
   * Won-ness is a control here, not a fetch.
   *
   * `fl_deal` has a stage, but there is no Deal read surface to take it from
   * (`F-14`), and inventing a value would be worse than asking: the entire Won
   * gate would then rest on something this page guessed. So the user states it,
   * the pre-flight is computed against what they stated, and the run — when it
   * exists — must re-check server-side regardless. `convertBlocker` already does.
   */
  const [dealIsWon, setDealIsWon] = useState(false);
  const [data, setData] = useState<Preflight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actor = useActor();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runLog, setRunLog] = useState<ConvertRunResult["results"]>([]);
  const [drained, setDrained] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listDeals().then(({ data: d, error: err }) => {
      if (!live) return;
      if (err) return setError(err);
      const found = d?.deals ?? [];
      setDeals(found);
      if (!dealId && found.length === 1) setParams({ deal: found[0].id }, { replace: true });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    if (!dealId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    convertPreflight(dealId, dealIsWon).then(({ data: d, error: err }) => {
      setLoading(false);
      if (err) return setError(err);
      setData(d ?? null);
    });
  }, [dealId, dealIsWon]);

  useEffect(load, [load]);

  const deal = deals.find((d) => d.id === dealId);
  const blocked = data?.rows.filter((r) => r.blockers.length) ?? [];

  /**
   * The run, §7.5-shaped: repeated synchronous batches until nothing remains,
   * never a fire-and-forget. Two exits besides "done": a transport error, and a
   * round that makes no progress (every remaining row failed or is waiting on a
   * parent that failed) — looping past that point would hammer the same errors.
   * After the write, one drain pass: the contract tasks queued at Won defer
   * until a site exists, and this run may have just created it.
   */
  const runConvert = useCallback(async () => {
    if (!dealId || running) return;
    setRunning(true);
    setRunError(null);
    setRunLog([]);
    setDrained(null);

    const log: ConvertRunResult["results"] = [];
    for (;;) {
      const { data: round, error: err } = await convertRun(dealId, actor);
      if (err) {
        setRunError(err);
        break;
      }
      if (!round) break;
      log.push(...round.results);
      setRunLog([...log]);
      if (round.remaining === 0) break;
      if (round.created + round.recovered === 0) break;
    }

    const { data: drain } = await drainFacilioQueue();
    if (drain) {
      const done = drain.results.filter((r) => r.outcome === "done").length;
      setDrained(
        drain.claimed === 0
          ? "Nothing else was waiting in the sync queue."
          : `${done} of ${drain.claimed} queued Facilio write(s) completed${drain.deferred ? `, ${drain.deferred} still waiting on a dependency` : ""}.`
      );
    }

    setRunning(false);
    load();
  }, [dealId, actor, running, load]);

  return (
    <PageShell
      title="Convert to Facilio"
      subtitle={
        deal
          ? `${deal.refNo} · ${deal.title ?? deal.accountName ?? "Untitled deal"}`
          : "What would be created in the CMMS, checked before anything is written."
      }
      strip={
        <div className="flex flex-wrap items-center gap-3">
          <Select value={dealId} onValueChange={(v) => setParams({ deal: v })} disabled={!deals.length}>
            <SelectTrigger className="w-full sm:w-72">
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
          {dealId ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="cv-won"
                checked={dealIsWon}
                onCheckedChange={(v) => setDealIsWon(v === true)}
              />
              <label htmlFor="cv-won" className="text-sm">
                This deal is Won
              </label>
            </div>
          ) : null}
        </div>
      }
      actions={
        dealId ? (
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className="size-4" />
            Re-check
          </Button>
        ) : null
      }
    >
      {!dealId ? (
        <Card pad={false}>
          <Empty
            title="Pick a pursuit"
            body="Nothing is written to Facilio until a deal is won and someone chooses, property by property, what goes in."
          />
        </Card>
      ) : loading ? (
        <Card pad={false}>
          <SimpleRows count={3} />
        </Card>
      ) : error ? (
        <Card pad={false}>
          <ErrorState message={error} onRetry={load} />
        </Card>
      ) : !data || !data.rows.length ? (
        <Card pad={false}>
          <Empty
            title="Nothing to convert"
            body="This pursuit has no properties recorded yet. Build the portfolio first — the convert only ever writes what is already in it."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {/* The three counts, which are the whole summary. They are never added
              together: "create" and "skip" answer different questions, and a
              single total would be a number that is true of neither. */}
          <Card>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <Tally label="Would be created" value={data.willCreate} tone="green" />
              <Tally label="Left alone" value={data.willSkip} tone="neutral" />
              <Tally label="Disagree with Facilio" value={data.flags} tone="orange" />
            </div>
          </Card>

          {/* The gate, stated once, plainly, above the detail. */}
          {!canRunConvert ? (
            <div className="bg-muted/40 rounded-md border px-4 py-3">
              <span className="text-sm font-medium">Writing is switched off</span>
              <div className="text-muted-foreground mt-1 text-sm">{CONVERT_BLOCKED_REASON}</div>
            </div>
          ) : null}

          {!dealIsWon ? (
            <div className="bg-muted/40 rounded-md border px-4 py-3">
              <span className="text-sm font-medium">This deal is not marked Won</span>
              <div className="text-muted-foreground mt-1 text-sm">
                Nothing converts before Won. A bid-stage estimate must never appear in a CMMS the
                customer is billed against — so every row below is blocked until the deal closes.
              </div>
            </div>
          ) : null}

          <Card pad={false} title="Every property, and what would happen to it">
            {data.rows.map((row) => (
              <PreflightRowView key={row.locationId} row={row} />
            ))}
          </Card>

          {blocked.length ? (
            <Card title="Clear these first">
              <SectionTitle>
                {plural(blocked.length, "property", "properties")} cannot be written yet
              </SectionTitle>
              <div className="flex flex-col gap-2">
                {blocked.map((r) => (
                  <div key={r.locationId} className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{r.name}</span>
                    {r.blockers.map((b) => (
                      <span key={b} className="text-muted-foreground text-sm">
                        · {b}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
              <div className="text-muted-foreground mt-3 text-xs">
                Fixing these here rather than after the write is deliberate: a record created
                without its parent saves successfully and then disappears from the tree, from
                site-scoped work orders and from dashboards, with no error anywhere.
              </div>
            </Card>
          ) : null}

          {runLog.length || runError || drained ? (
            <Card title="This run">
              <div className="flex flex-col gap-1.5">
                {runLog.map((r) => (
                  <div key={r.locationId} className="flex flex-wrap items-center gap-2 text-sm">
                    <Chip tone={r.outcome === "failed" ? "orange" : "green"} small>
                      {r.outcome}
                    </Chip>
                    <span className="font-medium">{r.name}</span>
                    {r.facilioId ? (
                      <span className="text-muted-foreground text-xs">
                        Facilio {TYPE_LABEL[r.type].toLowerCase()} #{r.facilioId}
                      </span>
                    ) : null}
                    {r.error ? <span className="text-destructive text-xs">{r.error}</span> : null}
                  </div>
                ))}
                {/* The drain line is the contract's heartbeat: the tasks queued at
                    Won wait for a site, and this run may have just created it. */}
                {drained ? <span className="text-muted-foreground text-sm">{drained}</span> : null}
                {runError ? <span className="text-destructive text-sm">{runError}</span> : null}
              </div>
            </Card>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {/* A disabled primary action always says why, in the order the gate
                actually applies: the switch first, then Won, then the blockers. */}
            <span className="text-muted-foreground text-xs">
              {!canRunConvert
                ? "Writing to Facilio is not switched on yet"
                : !data.dealIsWon
                  ? "The deal must be Won first"
                  : blocked.length
                    ? `${plural(blocked.length, "property", "properties")} still blocked`
                    : running
                      ? "Writing to Facilio…"
                      : `${plural(data.willCreate, "property", "properties")} ready`}
            </span>
            <Button
              disabled={!canRunConvert || !data.dealIsWon || blocked.length > 0 || running || !data.willCreate}
              onClick={runConvert}
            >
              {running ? <RefreshCw className="size-4 animate-spin" /> : null}
              Convert to Facilio
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "neutral" | "orange";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xl font-medium tabular-nums">{value}</span>
      <span className="text-muted-foreground text-xs">
        <Chip tone={tone} small>
          {label}
        </Chip>
      </span>
    </div>
  );
}

/** One location's verdict, with the server's reason shown rather than reworded. */
function PreflightRowView({ row }: { row: PreflightRow }) {
  const Icon = row.action === "create" ? Check : row.action === "flag" ? AlertTriangle : Minus;
  const tone = row.action === "create" ? "green" : row.action === "flag" ? "orange" : "neutral";

  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b px-4 py-3 last:border-b-0">
      <Icon
        className={
          row.action === "create"
            ? "mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-500"
            : row.action === "flag"
              ? "mt-0.5 size-4 shrink-0 text-orange-600 dark:text-orange-500"
              : "text-muted-foreground mt-0.5 size-4 shrink-0"
        }
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{row.name}</span>
          <TypeChip type={row.type} />
        </div>
        <span className="text-muted-foreground text-sm">{row.reason}</span>
        {row.blockers.map((b) => (
          <span key={b} className="text-destructive text-xs">
            {b}
          </span>
        ))}
      </div>
      <Chip tone={tone} small>
        {row.action === "create"
          ? `New ${TYPE_LABEL[row.type].toLowerCase()}`
          : row.action === "flag"
            ? "Writes nothing"
            : "Left alone"}
      </Chip>
    </div>
  );
}
