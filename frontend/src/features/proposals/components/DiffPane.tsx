/**
 * What changed between this revision and the one before it.
 *
 * THE DIFF IS WHAT MAKES REVISION 2 CHEAPER THAN REVISION 1 (spec §5 R4) — the
 * whole J2 job. Without it, "we sent v3" means re-reading forty lines to find
 * the three that moved, which is how a version gets sent that nobody actually
 * checked.
 *
 * Two things about how it renders. The `changes[]` strings ARE the substance —
 * `quantity 900 → 1200`, `rate 140 → 123`, `reason: three-year term agreed` —
 * computed by `domain/proposal-diff.ts` and printed verbatim; `kind` is only
 * for grouping and colour, so a kind this page has never heard of still shows
 * its notes rather than an empty row. And `description_changed` is a real
 * change, not a cosmetic one: the client READS that wording on the document.
 *
 * `proposal.diff` is live. When it rejects — a proposal with no parent has
 * nothing to compare against — the message is rendered verbatim, because an
 * honest error beats a pane that pretends to have compared nothing.
 */

import { useEffect, useState } from "react";
import { ArrowRight, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "../../../ui/Card";
import { SkeletonRows } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { diffProposal } from "../api/proposals-util";
import { money, signedMoney } from "../money";
import { CHANGE_KIND_LABEL, type ChangeKind, type LineChange, type ProposalDiff } from "../types/proposal";

/**
 * Every kind gets a tone, and the map is exhaustive by type — a new kind on the
 * wire fails the typecheck here rather than rendering an unlabelled grey row.
 * Money leaving is orange, money arriving is green, and everything that moves
 * without adding or removing a line is neutral: what it did to the total is
 * already printed beside it, in the one place that is authoritative.
 */
const KIND_TONE: Record<ChangeKind, string> = {
  added: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
  removed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  quantity_changed: "bg-muted text-muted-foreground",
  rate_changed: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
  mode_changed: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
  frequency_changed: "bg-muted text-muted-foreground",
  optional_changed: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  description_changed: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  unchanged: "bg-muted text-muted-foreground",
};

/** One before/after pair of money, with the movement spelled out. */
function TotalRow({
  label,
  before,
  after,
  delta,
  currency,
  suffix,
}: {
  label: string;
  before: number;
  after: number;
  delta: number;
  currency: string | null | undefined;
  suffix?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-muted-foreground w-24 shrink-0 text-xs">{label}</span>
      <span className="text-muted-foreground text-sm tabular-nums line-through">
        {money(before, currency)}
      </span>
      <ArrowRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
      <span className="text-sm font-medium tabular-nums">
        {money(after, currency)}
        {suffix ? <span className="text-muted-foreground text-xs">{suffix}</span> : null}
      </span>
      <span
        className={cn(
          "ml-auto text-sm font-medium tabular-nums",
          delta > 0 && "text-green-700 dark:text-green-400",
          delta < 0 && "text-orange-700 dark:text-orange-400",
          delta === 0 && "text-muted-foreground"
        )}
      >
        {signedMoney(delta, currency)}
      </span>
    </div>
  );
}

function ChangeRow({
  change,
  currency,
}: {
  change: LineChange;
  currency: string | null | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-b px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
            KIND_TONE[change.kind] ?? "bg-muted text-muted-foreground"
          )}
        >
          {CHANGE_KIND_LABEL[change.kind] ?? change.kind.replace(/_/g, " ")}
        </span>
        <span className="min-w-0 flex-1 basis-48 text-sm font-medium">{change.description}</span>
        {/* What this one line did to the money, signed and in minor units on
            the wire. Zero is printed rather than hidden: "this line changed and
            cost nothing" is information. */}
        <span
          className={cn(
            "shrink-0 text-sm font-medium tabular-nums",
            change.totalDelta > 0 && "text-green-700 dark:text-green-400",
            change.totalDelta < 0 && "text-orange-700 dark:text-orange-400",
            change.totalDelta === 0 && "text-muted-foreground"
          )}
        >
          {signedMoney(change.totalDelta, currency)}
        </span>
      </div>

      {/* The substance. Already in words on the way out of the domain module,
          so nothing here reformats or re-derives them. */}
      {change.changes?.length ? (
        <ul className="flex flex-col gap-0.5 pl-1">
          {change.changes.map((c) => (
            <li key={c} className="text-muted-foreground text-xs tabular-nums">
              {c}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function DiffPane({
  proposalId,
  parentProposalId,
  currency,
}: {
  proposalId: string;
  /** Null on a first revision — there is nothing behind it to compare against. */
  parentProposalId: string | null | undefined;
  currency: string | null | undefined;
}) {
  const [diff, setDiff] = useState<ProposalDiff | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!parentProposalId) return;
    let live = true;
    diffProposal(proposalId, parentProposalId).then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (data) setDiff(data.diff);
    });
    return () => {
      live = false;
    };
  }, [proposalId, parentProposalId, reloadKey]);

  if (!parentProposalId) {
    return (
      <Card pad={false}>
        <Empty
          title="Nothing to compare"
          body="This is the first revision, so there is no earlier version behind it. A revision is raised when a sent proposal is deliberately re-priced — a client asking for a better number is a note on the thread until then."
        />
      </Card>
    );
  }

  if (!loaded) {
    return (
      <Card pad={false}>
        <SkeletonRows count={4} />
      </Card>
    );
  }

  if (error || !diff) {
    return (
      <Card pad={false}>
        <ErrorState
          message={error ?? "The comparison came back empty"}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </Card>
    );
  }

  // Unchanged lines are counted, never listed: a diff that prints the forty
  // lines that did not move is a diff nobody reads, which is worse than none.
  const moved = diff.changes.filter((c) => c.kind !== "unchanged");

  return (
    <>
      <Card title="What changed">
        <div className="flex items-start gap-2.5">
          <GitCompareArrows className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {/* The domain module's own sentence — written to be pasted into an
              email, so it is shown as written. */}
          <p className="text-sm">{diff.headline}</p>
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t pt-4">
          <TotalRow
            label="One-time"
            before={diff.totals.oneTimeBefore}
            after={diff.totals.oneTimeAfter}
            delta={diff.totals.oneTimeDelta}
            currency={currency}
          />
          <TotalRow
            label="Recurring"
            before={diff.totals.recurringBefore}
            after={diff.totals.recurringAfter}
            delta={diff.totals.recurringDelta}
            currency={currency}
            suffix=" / month"
          />
        </div>

        <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">
          {diff.summary.added} added · {diff.summary.removed} removed · {diff.summary.changed}{" "}
          changed · {diff.summary.unchanged} unchanged
        </p>
      </Card>

      <Card title="Line by line" meta={`${moved.length} moved`} pad={false}>
        {moved.length ? (
          moved.map((c, i) => (
            // Keyed on the surviving line's id where there is one — a removed
            // line has no `after`, and two lines can share a description.
            <ChangeRow key={c.after?.id ?? c.before?.id ?? `${c.description}-${i}`} change={c} currency={currency} />
          ))
        ) : (
          <Empty
            title="No line moved"
            tight
            body="Every line is identical to the previous revision. If nothing changed, the earlier version is still the one to send."
          />
        )}
      </Card>
    </>
  );
}
