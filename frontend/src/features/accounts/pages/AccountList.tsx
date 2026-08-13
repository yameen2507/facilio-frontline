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
import { PageShell } from "../../../app/shell/PageShell";
import { ago, plural } from "../../../lib/format";
import { Chip } from "../../../ui/Chip";
import { Bar, Card } from "../../../ui/Card";
import { Input } from "@/components/ui/input";
import { CountLine, Row, RowStat, RowTitle, TableHead } from "../../../ui/Row";
import { SkeletonRows } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { LinkButton } from "../../../ui/Button";
import { listAccounts } from "../api/accounts-util";
import type { Account, AccountListResponse } from "../types/account";

const COLUMNS = ["Company", "Leads", "Deals", "In Facilio"];

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
      strip={
        <Bar className="pb-4">
          <Input
            type="text"
            placeholder="Search name, email or domain"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-80"
            aria-label="Search companies"
          />
        </Bar>
      }
    >
      <Card pad={false}>
        {loading ? (
          <>
            <TableHead columns={COLUMNS} />
            <SkeletonRows count={5} />
          </>
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : rows.length ? (
          <>
            <TableHead columns={COLUMNS} />
            {rows.map((a) => (
              <Row key={a.id} onClick={() => navigate(`/accounts/${a.id}`)}>
                <RowTitle
                  title={a.name ?? "Unnamed account"}
                  meta={
                    <>
                      {a.websiteDomain ?? <em>no domain</em>}
                      {a.email ? ` · ${a.email}` : ""}
                    </>
                  }
                />
                <RowStat value={a.leadCount} unit={a.leadCount === 1 ? "lead" : "leads"} />
                <RowStat value={a.dealCount} unit={a.dealCount === 1 ? "deal" : "deals"} />
                <div>
                  <SyncChip account={a} />
                  <div className="text-muted-foreground mt-px text-xs">{ago(a.createdAt)}</div>
                </div>
              </Row>
            ))}
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
