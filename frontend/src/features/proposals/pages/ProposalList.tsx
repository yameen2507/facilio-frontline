/**
 * The proposal list — live against `proposal.list`.
 *
 * One fetch, sliced client-side, the same reasoning the survey and template
 * lists give: tabs and search cut a ≤100-row result rather than paying ~1.1s of
 * bridge overhead per keystroke. Saved views, column config and cross-record
 * search remain a PLATFORM concern; what this module owes that layer is its
 * filterable fields — status, dealId, accountId, validUntil, revisionNo.
 *
 * THE TWO TOTALS ARE TWO COLUMNS AND ARE NEVER ADDED. A one-time mobilisation
 * fee and a monthly service charge are different kinds of money; a single
 * "value" column would be a number that is true of neither.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarClock, FileSignature, Plus, Repeat, Wallet } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { onDay, plural } from "../../../lib/format";
import { Card } from "../../../ui/Card";
import { CountLine } from "../../../ui/Row";
import { Tabs, type Tab } from "../../../ui/Tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell } from "@/components/ui/table";
import {
  ClickRow,
  ListTable,
  ListTableSkeleton,
  MobileFact,
  MobileList,
  MobileRow,
  PHONE_BLEED,
  type Col,
} from "../../../ui/DataTable";
import { CompanyLogo } from "../../../ui/CompanyLogo";
import { Empty, ErrorState } from "../../../ui/States";
import { listProposals } from "../api/proposals-util";
import { money, numeric } from "../money";
import { NewProposalDialog } from "../components/NewProposalDialog";
import { ProposalStatusChip } from "../components/ProposalChips";
import type { ProposalStatus, ProposalSummary } from "../types/proposal";

/**
 * `closed` is a slice, not a status: four different endings — rejected,
 * expired, superseded, withdrawn — all mean the same thing to someone scanning
 * a pipeline, which is "not live and not won". Each still chips its own state
 * in the row, so nothing is hidden by the grouping.
 */
type Filter = ProposalStatus | "all" | "closed";

const CLOSED: ProposalStatus[] = ["rejected", "expired", "superseded", "withdrawn"];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "pending_approval", label: "Pending approval" },
  { id: "approved", label: "Approved" },
  { id: "sent", label: "Sent" },
  { id: "accepted", label: "Accepted" },
  { id: "closed", label: "Closed" },
];

// No phone visibility classes — below `sm` the table yields to the MobileList
// and its cards. The md/lg steps remain: on a tablet the table is real but
// narrow. Each col's className must be repeated on its body cells below;
// DataTable.tsx owns that rule.
const COLS: Col[] = [
  { label: "Proposal", icon: FileSignature, skel: "entity" },
  { label: "Status", className: "w-36", skel: "chip" },
  { label: "One-time", icon: Wallet, className: "w-32 text-right", skel: "num" },
  { label: "Recurring", icon: Repeat, className: "max-md:hidden w-32 text-right", skel: "num" },
  { label: "Rev", className: "w-14", skel: "num" },
  { label: "Valid", icon: CalendarClock, className: "max-lg:hidden w-28", skel: "text" },
];

/** The entity cell's second line, shared by the table cell and the phone card
    so the two can never describe a proposal differently. */
const ProposalMeta = ({ proposal: p }: { proposal: ProposalSummary }) => {
  // `line_count` is a `count(*)`, which the platform hands back as a STRING —
  // and "0" is truthy, so a bare test would put "0 lines" on every empty
  // proposal instead of saying it has none yet.
  const lines = numeric(p.lineCount);
  return (
    <>
      {p.accountName ?? "No account"}
      {" · "}
      {lines ? plural(lines, "line", "lines") : <em>no lines yet</em>}
    </>
  );
};

/** Ref and title, with the revision on the ref where the client reads it —
    "PRP-00042 v2" is the label the document prints, so the list must match it. */
const ProposalName = ({ proposal: p }: { proposal: ProposalSummary }) => (
  <>
    <code className="mr-1.5 font-mono text-xs">
      {p.refNo}
      {(p.revisionNo ?? 1) > 1 ? ` v${p.revisionNo}` : ""}
    </code>
    {p.title ?? "Untitled proposal"}
  </>
);

/** A money cell. Right-aligned and tabular so a column of figures lines up on
    the decimal point rather than on the currency symbol. */
const MoneyCell = ({
  value,
  currency,
  className,
}: {
  value: number | null | undefined;
  currency: string | null | undefined;
  className: string;
}) => (
  <TableCell className={`px-4 py-3 text-right text-sm tabular-nums ${className}`}>
    {money(value, currency)}
  </TableCell>
);

export function ProposalList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  // `/proposals?new=<dealId>` opens the create dialog with the deal preselected
  // — the deep link a deal or survey page uses to raise a proposal in place.
  const [params, setParams] = useSearchParams();
  const newParam = params.get("new");
  const [creating, setCreating] = useState(newParam !== null);

  const closeCreate = (open: boolean) => {
    setCreating(open);
    if (!open && newParam !== null) setParams({}, { replace: true });
  };

  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [result, setResult] = useState<{ truncated?: boolean } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    listProposals("all").then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (data) {
        setProposals(data.proposals);
        setResult({ truncated: data.truncated });
      }
    });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const matches = (p: ProposalSummary, f: Filter): boolean =>
    f === "all" ? true : f === "closed" ? CLOSED.includes(p.status) : p.status === f;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return proposals.filter(
      (p) =>
        matches(p, filter) &&
        (!q ||
          p.refNo.toLowerCase().includes(q) ||
          (p.title ?? "").toLowerCase().includes(q) ||
          (p.accountName ?? "").toLowerCase().includes(q))
    );
  }, [proposals, filter, search]);

  /** Counts ride on the tabs once the fetch has landed. Left undefined until
      then — a zero during the skeleton phase claims an empty bucket before
      anything has been asked for. */
  const tabs: Tab<Filter>[] = FILTERS.map((f) => ({
    ...f,
    count: loaded && !error ? proposals.filter((p) => matches(p, f.id)).length : undefined,
  }));

  return (
    <PageShell
      title="Proposals"
      subtitle="Priced offers against a deal"
      count={loaded && !error ? rows.length : undefined}
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New proposal
        </Button>
      }
      strip={<Tabs items={tabs} active={filter} onChange={setFilter} />}
      search={
        <Input
          type="text"
          placeholder="Search by number, title or account"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
          aria-label="Search proposals"
        />
      }
    >
      <Card pad={false} className={PHONE_BLEED}>
        {!loaded ? (
          <ListTableSkeleton cols={COLS} rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : rows.length ? (
          <>
            <ListTable cols={COLS} className="max-sm:hidden">
              {rows.map((p) => (
                <ClickRow key={p.id} onClick={() => navigate(`/proposals/${p.id}`)}>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {/* The account the offer is made to — proposals carry no
                          domain, so this is the tinted-initials tile. */}
                      <CompanyLogo name={p.accountName ?? p.refNo} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          <ProposalName proposal={p} />
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          <ProposalMeta proposal={p} />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="w-36 px-4 py-3">
                    <ProposalStatusChip status={p.status} />
                  </TableCell>
                  <MoneyCell value={p.totalOneTime} currency={p.currency} className="w-32" />
                  <MoneyCell
                    value={p.totalRecurringMonthly}
                    currency={p.currency}
                    className="w-32 max-md:hidden"
                  />
                  <TableCell className="w-14 px-4 py-3 text-sm tabular-nums">
                    v{p.revisionNo ?? 1}
                  </TableCell>
                  <TableCell className="w-28 px-4 py-3 text-xs max-lg:hidden">
                    {p.validUntil ? (
                      <span
                        className={
                          (p.daysToExpiry ?? 1) < 0
                            ? "text-destructive font-medium"
                            : "text-muted-foreground"
                        }
                      >
                        {onDay(p.validUntil)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </ClickRow>
              ))}
            </ListTable>
            <MobileList>
              {rows.map((p) => (
                <MobileRow
                  key={p.id}
                  onClick={() => navigate(`/proposals/${p.id}`)}
                  leading={<CompanyLogo name={p.accountName ?? p.refNo} />}
                  title={<ProposalName proposal={p} />}
                  trailing={<ProposalStatusChip status={p.status} />}
                  meta={<ProposalMeta proposal={p} />}
                  // The money and the deadline earn the card's facts line; the
                  // revision does not — it is already on the title, where the
                  // client's own label carries it. The facts wear the table
                  // columns' glyphs so each is findable across both forms.
                  // A recurring fact only when there IS one: most proposals
                  // are one-time, and "AED 0.00 / month" is noise on all of them.
                  facts={
                    <>
                      <MobileFact icon={Wallet} value={money(p.totalOneTime, p.currency)}>
                        one-time
                      </MobileFact>
                      {p.totalRecurringMonthly ? (
                        <MobileFact
                          icon={Repeat}
                          value={money(p.totalRecurringMonthly, p.currency)}
                        >
                          / month
                        </MobileFact>
                      ) : null}
                      {p.validUntil ? (
                        <MobileFact icon={CalendarClock}>
                          <span
                            className={(p.daysToExpiry ?? 1) < 0 ? "text-destructive font-medium" : undefined}
                          >
                            {onDay(p.validUntil)}
                          </span>
                        </MobileFact>
                      ) : null}
                    </>
                  }
                />
              ))}
            </MobileList>
            <CountLine>
              {result?.truncated
                ? `Showing the first ${rows.length} of a longer list`
                : plural(rows.length, "proposal", "proposals")}
            </CountLine>
          </>
        ) : proposals.length ? (
          <Empty title="Nothing matches" body="No proposal in this slice matches the search." />
        ) : (
          <Empty
            title="No proposals yet"
            body="A proposal turns a frozen survey into priced lines using a rate card, wraps them in a template, and freezes on send — so every version a client has held stays exactly as they saw it."
            action={
              <Button variant="outline" onClick={() => setCreating(true)}>
                <FileSignature className="size-4" />
                Raise one against a deal
              </Button>
            }
          />
        )}
      </Card>

      <NewProposalDialog
        open={creating}
        onOpenChange={closeCreate}
        initialDealId={newParam || undefined}
      />
    </PageShell>
  );
}
