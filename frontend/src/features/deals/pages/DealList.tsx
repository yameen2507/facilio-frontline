/**
 * The deal list — live against `deal.list`.
 *
 * One fetch, sliced client-side, the same reasoning the proposal and survey
 * lists give: tabs and search cut a ≤200-row result rather than paying ~1.1s
 * of bridge overhead per keystroke.
 *
 * There is deliberately NO "new deal" button. A deal is only ever born by
 * converting a qualified lead — the empty state says so and points there —
 * because a deal created from thin air would have no account, no dedup history
 * and no timeline root behind it.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Handshake, UserRound, Wallet } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { useUserDirectory } from "../../../app/users";
import { ago, plural, typedMoney } from "../../../lib/format";
import { LinkButton } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { CompanyLogo } from "../../../ui/CompanyLogo";
import { CountLine } from "../../../ui/Row";
import { Empty, ErrorState } from "../../../ui/States";
import { Tabs, type Tab } from "../../../ui/Tabs";
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
import { listDeals, LIST_LIMIT } from "../api/deals-util";
import { DealStageChip } from "../components/DealChips";
import type { DealListRow } from "../types/deal";

/**
 * Slices, not stages: ten stage tabs would bury the question the list answers,
 * which is "what is being worked, what is waiting on the customer, and how did
 * the rest end". Each row still chips its exact stage.
 */
type Filter = "all" | "working" | "deciding" | "won" | "lost";

/** Stages where the ball is in the customer's court — the chase list. */
const DECIDING = ["negotiation", "decision_pending"];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "working", label: "Working" },
  { id: "deciding", label: "Deciding" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

const matches = (d: DealListRow, f: Filter): boolean =>
  f === "all"
    ? true
    : f === "won" || f === "lost"
      ? d.stage === f
      : f === "deciding"
        ? DECIDING.includes(d.stage)
        : d.stage !== "won" && d.stage !== "lost" && !DECIDING.includes(d.stage);

// Each col's className must be repeated on its body cells below; DataTable.tsx
// owns that rule. Below `sm` the table yields to the MobileList.
const COLS: Col[] = [
  { label: "Deal", icon: Handshake, skel: "entity" },
  { label: "Stage", className: "w-44", skel: "chip" },
  { label: "Value", icon: Wallet, className: "w-32 text-right", skel: "num" },
  { label: "Owner", icon: UserRound, className: "max-md:hidden w-48", skel: "text" },
  { label: "Updated", icon: CalendarClock, className: "max-lg:hidden w-28", skel: "text" },
];

/** The entity cell's second line, shared by the table cell and the phone card
    so the two can never describe a deal differently. */
const DealMeta = ({ deal: d }: { deal: DealListRow }) => (
  <>
    {d.accountName ?? "No account"}
    {d.leadRefNo ? (
      <>
        {" · from "}
        <code className="font-mono">{d.leadRefNo}</code>
      </>
    ) : null}
  </>
);

const DealName = ({ deal: d }: { deal: DealListRow }) => (
  <>
    <code className="mr-1.5 font-mono text-xs">{d.refNo}</code>
    {d.title ?? "Untitled deal"}
  </>
);

export function DealList() {
  // Owners render by name, never by address (X-05); search still matches the
  // email because the row keeps it.
  const { nameOf } = useUserDirectory();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const [deals, setDeals] = useState<DealListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    listDeals().then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (data) {
        setDeals(data.deals);
        setTotal(data.total);
      }
    });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deals.filter(
      (d) =>
        matches(d, filter) &&
        (!q ||
          d.refNo.toLowerCase().includes(q) ||
          (d.title ?? "").toLowerCase().includes(q) ||
          (d.accountName ?? "").toLowerCase().includes(q) ||
          (d.salesOwnerEmail ?? "").toLowerCase().includes(q))
    );
  }, [deals, filter, search]);

  /** Counts ride on the tabs once the fetch has landed — a zero during the
      skeleton phase claims an empty bucket before anything has been asked. */
  const tabs: Tab<Filter>[] = FILTERS.map((f) => ({
    ...f,
    count: loaded && !error ? deals.filter((d) => matches(d, f.id)).length : undefined,
  }));

  return (
    <PageShell
      title="Deals"
      subtitle="The sales lifecycle a qualified lead converts into"
      count={loaded && !error ? rows.length : undefined}
      strip={<Tabs items={tabs} active={filter} onChange={setFilter} />}
      search={
        <Input
          type="text"
          placeholder="Search by number, title, account or owner"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
          aria-label="Search deals"
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
              {rows.map((d) => (
                <ClickRow key={d.id} onClick={() => navigate(`/deals/${d.id}`)}>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CompanyLogo name={d.accountName ?? d.refNo} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          <DealName deal={d} />
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          <DealMeta deal={d} />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="w-44 px-4 py-3">
                    <DealStageChip stage={d.stage} />
                  </TableCell>
                  <TableCell className="w-32 px-4 py-3 text-right text-sm tabular-nums">
                    {typedMoney(d.estimatedValue, d.currency ?? "AED", d.valueType, d.valueFrequency)}
                  </TableCell>
                  <TableCell className="text-muted-foreground w-48 truncate px-4 py-3 text-xs max-md:hidden">
                    {d.salesOwnerEmail ? nameOf(d.salesOwnerEmail) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground w-28 px-4 py-3 text-xs max-lg:hidden">
                    {ago(d.updatedAt)}
                  </TableCell>
                </ClickRow>
              ))}
            </ListTable>
            <MobileList>
              {rows.map((d) => (
                <MobileRow
                  key={d.id}
                  onClick={() => navigate(`/deals/${d.id}`)}
                  leading={<CompanyLogo name={d.accountName ?? d.refNo} />}
                  title={<DealName deal={d} />}
                  trailing={<DealStageChip stage={d.stage} />}
                  meta={<DealMeta deal={d} />}
                  facts={
                    <>
                      <MobileFact icon={Wallet} value={typedMoney(d.estimatedValue, d.currency ?? "AED", d.valueType, d.valueFrequency)} />
                      {d.salesOwnerEmail ? (
                        <MobileFact icon={UserRound}>{nameOf(d.salesOwnerEmail)}</MobileFact>
                      ) : null}
                    </>
                  }
                />
              ))}
            </MobileList>
            <CountLine>
              {total > LIST_LIMIT
                ? `Showing the first ${rows.length} of ${total}`
                : plural(rows.length, "deal", "deals")}
            </CountLine>
          </>
        ) : deals.length ? (
          <Empty title="Nothing matches" body="No deal in this slice matches the search." />
        ) : (
          <Empty
            title="No deals yet"
            body="A deal is born by converting a qualified lead — it arrives with the account, the contact and the enquiry's whole history already attached."
            action={<LinkButton to="/leads">Go to the lead inbox</LinkButton>}
          />
        )}
      </Card>
    </PageShell>
  );
}
