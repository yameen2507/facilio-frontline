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
import { Building2, Clock3, Handshake, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "../../../app/shell/PageShell";
import { useActor } from "../../../app/auth";
import { AccountFormDialog } from "../components/AccountDialogs";
import { ago, plural } from "../../../lib/format";
import { Chip } from "../../../ui/Chip";
import { Card } from "../../../ui/Card";
import { Input } from "@/components/ui/input";
import { TableCell } from "@/components/ui/table";
import { CountLine } from "../../../ui/Row";
import {
  ClickRow,
  ListTable,
  ListTableSkeleton,
  MobileFact,
  MobileList,
  MobileRow,
  PHONE_BLEED,
  PHONE_BLEED_TOP,
  type Col,
} from "../../../ui/DataTable";
import { CompanyLogo } from "../../../ui/CompanyLogo";
import { Empty, ErrorState } from "../../../ui/States";
import { LinkButton } from "../../../ui/Button";
import { listAccounts } from "../api/accounts-util";
import type { Account, AccountListResponse } from "../types/account";

// No phone visibility classes — below `sm` the table yields to the MobileList,
// which carries every column's content as a card. Created still steps aside on
// tablet, where the table is real but narrow. Each col's className must be
// repeated on its body cells below; DataTable.tsx owns the rule.
const COLS: Col[] = [
  { label: "Company", icon: Building2, skel: "entity" },
  { label: "Leads", icon: Users, className: "w-24", skel: "num" },
  { label: "Deals", icon: Handshake, className: "w-24", skel: "num" },
  { label: "In Facilio", className: "w-44", skel: "chip" },
  { label: "Created", icon: Clock3, className: "max-md:hidden w-28", skel: "text" },
];

/** The entity cell's second line, shared by the table cell and the phone card
    so the two can never describe an account differently. */
const AccountMeta = ({ account: a }: { account: Account }) => (
  <>
    {a.websiteDomain ?? <em>no domain</em>}
    {a.email ? ` · ${a.email}` : ""}
  </>
);

/**
 * An account exists here before it exists in Facilio — the outbox writes it later —
 * so the client id doubles as the sync state. Showing "pending" as a warning would
 * be wrong; it is the normal state for the first minute.
 */
export const SyncChip = ({
  account,
  small = false,
}: {
  account: Pick<Account, "facilioClientId">;
  /** Compact, for the detail rail's meta line — full size is for table cells. */
  small?: boolean;
}) =>
  account.facilioClientId ? (
    <Chip tone="green" dot small={small}>{`client ${account.facilioClientId}`}</Chip>
  ) : (
    // X-16: NEUTRAL, not alarm-toned — pre-Won this is the CORRECT state (the
    // client is created when a deal is won, F-08), and painting the normal
    // case orange taught people to ignore the colour.
    <Chip small={small}>not in Facilio yet</Chip>
  );

/** A count cell: tabular so columns of numbers align digit-for-digit. */
const NumCell = ({ value }: { value: number }) => (
  <TableCell className="w-24 px-4 py-3 text-sm font-medium tabular-nums">
    {value}
  </TableCell>
);

export function AccountList() {
  const navigate = useNavigate();
  const actor = useActor();

  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [result, setResult] = useState<AccountListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /** F-18: an account can be raised by hand — a client-to-be does not have to
      enquire first. */
  const [creating, setCreating] = useState(false);

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
      // What the page IS, not how many rows it holds — the count (and the
      // first-page hint) already live on the table's footer line below.
      subtitle="Companies from converted leads, or added by hand"
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New account
        </Button>
      }
      // …except on phones, where the footer is gone with the full-bleed list
      // and the TOTAL sits beside the title. The truncation hint doesn't
      // survive the move — a phone header has room for one number.
      count={!loading && !error && result ? total : undefined}
      // No tabs on this page — the shell still pins search to the row's right,
      // where it lives on every other page.
      search={
        <Input
          type="text"
          placeholder="Search name, email or domain"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
          aria-label="Search companies"
        />
      }
    >
      <Card pad={false} className={`${PHONE_BLEED} ${PHONE_BLEED_TOP}`}>
        {loading ? (
          <ListTableSkeleton cols={COLS} rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : rows.length ? (
          <>
            <ListTable cols={COLS} className="max-sm:hidden">
              {rows.map((a) => (
                <ClickRow key={a.id} onClick={() => navigate(`/accounts/${a.id}`)}>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CompanyLogo name={a.name} domain={a.websiteDomain} email={a.email} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{a.name ?? "Unnamed account"}</div>
                        <div className="text-muted-foreground truncate text-xs">
                          <AccountMeta account={a} />
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
            <MobileList>
              {rows.map((a) => (
                <MobileRow
                  key={a.id}
                  onClick={() => navigate(`/accounts/${a.id}`)}
                  leading={<CompanyLogo name={a.name} domain={a.websiteDomain} email={a.email} />}
                  title={a.name ?? "Unnamed account"}
                  // Sync state on the title line — it is the one thing this
                  // list exists to answer. Full size, not `small`: the 10px
                  // variant beside a 14px title read as shrunken, and the
                  // title's truncation is the right thing to give way.
                  trailing={<SyncChip account={a} />}
                  meta={<AccountMeta account={a} />}
                  // Same glyphs as the table columns, so a fact is findable
                  // across the two forms by its icon.
                  facts={
                    <>
                      <MobileFact icon={Users} value={a.leadCount}>
                        {a.leadCount === 1 ? "lead" : "leads"}
                      </MobileFact>
                      <MobileFact icon={Handshake} value={a.dealCount}>
                        {a.dealCount === 1 ? "deal" : "deals"}
                      </MobileFact>
                      <MobileFact icon={Clock3}>{ago(a.createdAt)}</MobileFact>
                    </>
                  }
                />
              ))}
            </MobileList>
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
            body="A company appears here when a qualified lead is converted to a deal — or add one by hand."
            action={<LinkButton to="/leads">Go to the lead inbox</LinkButton>}
          />
        )}
      </Card>

      <AccountFormDialog
        open={creating}
        onOpenChange={setCreating}
        account={null}
        actor={actor}
        onDone={(accountId) => navigate(`/accounts/${accountId}`)}
      />
    </PageShell>
  );
}
