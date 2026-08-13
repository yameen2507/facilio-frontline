/**
 * The company list.
 *
 * Two problems the vanilla version had to solve by hand, both of which React
 * removes rather than merely simplifying — worth naming so nobody reintroduces the
 * machinery:
 *
 * 1. **Focus while typing.** The old code rendered the shell once and replaced only
 *    the rows, because rewriting the whole page mid-keystroke stole focus from the
 *    search box. Here the input is a controlled element that never unmounts, so
 *    focus survives every re-render for free.
 * 2. **Stale responses.** Two searches can be in flight — 250ms debounce, ~1s per
 *    request — and the slower one must not land on top of the newer one's rows. The
 *    effect's cleanup sets `live = false` when the term changes, so a superseded
 *    reply is discarded. No request-sequence counter needed.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Clock3, Handshake, Users } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { ago, plural } from "../../../lib/format";
import { Chip } from "../../../ui/Chip";
import { Card } from "../../../ui/Card";
import { Input } from "@/components/ui/input";
import { TableCell } from "@/components/ui/table";
import { CountLine } from "../../../ui/Row";
import { ClickRow, ListTable, ListTableSkeleton, type Col } from "../../../ui/DataTable";
import { CompanyLogo } from "../../../ui/CompanyLogo";
import { Empty, ErrorState } from "../../../ui/States";
import { LinkButton } from "../../../ui/Button";
import { listAccounts } from "../api/accounts-util";
import type { Account, AccountListResponse } from "../types/account";

// The counts hide on phones — a 390px row keeps the company and its sync
// state, which is what triage needs. Each col's className must be repeated on
// its body cells below; DataTable.tsx owns the rule.
const NUM_COL = "max-sm:hidden w-24";
const COLS: Col[] = [
  { label: "Company", icon: Building2, skel: "entity" },
  { label: "Leads", icon: Users, className: NUM_COL, skel: "num" },
  { label: "Deals", icon: Handshake, className: NUM_COL, skel: "num" },
  { label: "In Facilio", className: "w-44", skel: "chip" },
  { label: "Created", icon: Clock3, className: "max-md:hidden w-28", skel: "text" },
];

/**
 * An account exists here before it exists in Facilio — the outbox writes it later —
 * so the client id doubles as the sync state. Showing "pending" as a warning would
 * be wrong; it is the normal state for the first minute.
 */
export const SyncChip = ({ account }: { account: Pick<Account, "facilioClientId"> }) =>
  account.facilioClientId ? (
    <Chip tone="green" dot>{`client ${account.facilioClientId}`}</Chip>
  ) : (
    <Chip tone="orange" dot>
      not in Facilio yet
    </Chip>
  );

/** A count cell: tabular so columns of numbers align digit-for-digit. */
const NumCell = ({ value }: { value: number }) => (
  <TableCell className="w-24 px-4 py-3 text-sm font-medium tabular-nums max-sm:hidden">
    {value}
  </TableCell>
);

export function AccountList() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [result, setResult] = useState<AccountListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Debounce: one request per pause in typing, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setTerm(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let live = true;
    setLoading(true);

    listAccounts(term).then(({ data, error: err }) => {
      if (!live) return; // superseded by a newer term, or unmounted
      setLoading(false);
      setError(err);
      setResult(data);
    });

    return () => {
      live = false;
    };
  }, [term, reloadKey]);

  const rows = result?.accounts ?? [];
  const total = result?.total ?? 0;

  return (
    <PageShell
      title="Accounts"
      subtitle={total ? `${plural(total, "company", "companies")}${result?.truncated ? " · first page" : ""}` : undefined}
      // No tabs on this page — the shell still pins search to the row's right,
      // where it lives on every other page.
      search={
        <Input
          type="text"
          placeholder="Search name, email or domain"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-full sm:w-72"
          aria-label="Search companies"
        />
      }
    >
      <Card pad={false}>
        {loading ? (
          <ListTableSkeleton cols={COLS} rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : rows.length ? (
          <>
            <ListTable cols={COLS}>
              {rows.map((a) => (
                <ClickRow key={a.id} onClick={() => navigate(`/accounts/${a.id}`)}>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CompanyLogo name={a.name} domain={a.websiteDomain} email={a.email} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{a.name ?? "Unnamed account"}</div>
                        <div className="text-muted-foreground truncate text-xs">
                          {a.websiteDomain ?? <em>no domain</em>}
                          {a.email ? ` · ${a.email}` : ""}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <NumCell value={a.leadCount} />
                  <NumCell value={a.dealCount} />
                  <TableCell className="px-4 py-3">
                    <SyncChip account={a} />
                  </TableCell>
                  <TableCell className="text-muted-foreground w-28 px-4 py-3 text-xs max-md:hidden">
                    {ago(a.createdAt)}
                  </TableCell>
                </ClickRow>
              ))}
            </ListTable>
            <CountLine>
              {result?.truncated
                ? `Showing ${rows.length} of ${plural(total, "company", "companies")}`
                : plural(total, "company", "companies")}
            </CountLine>
          </>
        ) : term ? (
          <Empty title="No company matches that" body="Try a shorter name, or part of the email domain." />
        ) : (
          <Empty
            title="No accounts yet"
            body="A company appears here when a qualified lead is converted to a deal."
            action={<LinkButton to="/leads">Go to the lead inbox</LinkButton>}
          />
        )}
      </Card>
    </PageShell>
  );
}
