/**
 * One company: its contacts, its deals, and every lead that resolved to it.
 *
 * That last list is the point of the screen — a repeat customer's whole history in
 * one place.
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageShell } from "../../../app/shell/PageShell";
import { ago, money, plural } from "../../../lib/format";
import { LinkButton } from "../../../ui/Button";
import { Bar, Card, Split, Stack } from "../../../ui/Card";
import { Chip, type Tone } from "../../../ui/Chip";
import { Facts } from "../../../ui/Facts";
import { Row, RowStat, RowTitle } from "../../../ui/Row";
import { AccountDetailSkeleton } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { getAccount } from "../api/accounts-util";
import type { AccountDetailResponse } from "../types/account";
import { SyncChip } from "./AccountList";

const STAGE_TONE: Record<string, Tone> = { open: "blue", won: "green", lost: "neutral" };

export function AccountDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<AccountDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(null);

    getAccount(id).then(({ data, error: err }) => {
      if (!live) return;
      if (err) setError(err);
      else setDetail(data);
    });

    return () => {
      live = false;
    };
  }, [id, reloadKey]);

  if (error) {
    return (
      <PageShell title="Account">
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </PageShell>
    );
  }

  if (!detail) {
    return (
      <PageShell title="Account">
        <AccountDetailSkeleton />
      </PageShell>
    );
  }

  const { account, contacts, deals, leads } = detail;
  const address = account.address ?? {};
  const place = [address.street, address.city, address.state].filter(Boolean).join(", ");

  return (
    <PageShell
      title={account.name ?? "Account"}
      subtitle={`${plural(leads.length, "lead", "leads")} · ${plural(deals.length, "deal", "deals")}`}
    >
      <Bar style={{ marginBottom: "var(--spacing-container-large)" }}>
        <LinkButton to="/accounts" glyph="arrowLeft">
          Accounts
        </LinkButton>
        <span className="grow" />
        <SyncChip account={account} />
      </Bar>

      <Split>
        <Stack>
          <Card title="Enquiries" meta="every lead that resolved to this company" pad={false}>
            {leads.length ? (
              leads.map((l) => (
                <Row key={l.id} onClick={() => navigate(`/leads/${l.id}`)}>
                  <RowTitle
                    title={l.refNo}
                    meta={`${l.source}${l.serviceType ? ` · ${l.serviceType}` : ""}`}
                  />
                  <div>
                    <Chip tone={l.status === "converted" ? "green" : "neutral"}>{l.status.replace(/_/g, " ")}</Chip>
                  </div>
                  <RowStat value={l.score ?? null} unit="score" />
                  <div className="meta">{ago(l.createdAt)}</div>
                </Row>
              ))
            ) : (
              <Empty title="No leads linked" body="Enquiries resolve to this company by email domain." tight />
            )}
          </Card>

          <Card title="Deals">
            {deals.length ? (
              <table className="clocks">
                <tbody>
                  {deals.map((d) => (
                    <tr key={d.refNo}>
                      <td>
                        <b>{d.title ?? "Untitled deal"}</b>
                        <div className="due">
                          <code className="mono">{d.refNo}</code>
                          {d.salesOwnerEmail ? ` · ${d.salesOwnerEmail}` : ""}
                        </div>
                      </td>
                      <td className="due right nowrap">{money(d.estimatedValue, d.currency ?? "AED")}</td>
                      <td className="right">
                        <Chip tone={STAGE_TONE[d.stage] ?? "neutral"}>{d.stage}</Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="No deals yet" body="Converting a qualified lead creates the first one." tight />
            )}
          </Card>
        </Stack>

        <Stack>
          <Card title="Company">
            <Facts
              items={[
                {
                  label: "Domain",
                  value: account.websiteDomain ? (
                    <a href={`https://${account.websiteDomain}`} target="_blank" rel="noreferrer">
                      {account.websiteDomain}
                    </a>
                  ) : (
                    "—"
                  ),
                },
                { label: "Email", value: account.email ? <a href={`mailto:${account.email}`}>{account.email}</a> : "—" },
                { label: "Phone", value: account.phone ? <a href={`tel:${account.phone}`}>{account.phone}</a> : "—" },
                { label: "Location", value: place || "—" },
                {
                  label: "Facilio client",
                  value: account.facilioClientId ? <code className="mono">{account.facilioClientId}</code> : "queued",
                },
                { label: "Customer since", value: String(account.createdAt ?? "").slice(0, 10) || "—" },
              ]}
            />
          </Card>

          <Card title="Contacts">
            {contacts.length ? (
              <table className="clocks">
                <tbody>
                  {contacts.map((c, i) => (
                    <tr key={c.email ?? i}>
                      <td>
                        <b>{c.name ?? "—"}</b>
                        {/* The flag is the STRING "true" — there is no boolean
                            column type, so comparing to `true` never matches. */}
                        {String(c.isPrimary) === "true" ? <> <Chip>primary</Chip></> : null}
                        <div className="due">
                          {c.email ?? ""}
                          {c.phone ? ` · ${c.phone}` : ""}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              // `facilioContactId` is deliberately not shown anywhere: Facilio's
              // create-client-contact returns no id we can extract, so it is null
              // even when the contact synced (ARCHITECTURE.md §8a), and a "—" there
              // would read as a failure.
              <Empty title="No contact captured" body="The intake agent adds one when a visitor gives a name." tight />
            )}
          </Card>
        </Stack>
      </Split>
    </PageShell>
  );
}
