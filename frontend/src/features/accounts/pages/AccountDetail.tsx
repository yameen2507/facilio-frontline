/**
 * One company: its contacts, its deals, and every lead that resolved to it.
 *
 * The layout mirrors LeadDetail — a fixed record rail (identity, facts,
 * contacts) beside a tabbed work area — so a record reads the same way
 * everywhere in the console. The lead history is still the point of the
 * screen (a repeat customer's whole story in one place), which is why
 * Enquiries is the first tab.
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarDays, Clock, Globe, Mail, MapPin, Phone } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { ago, money } from "../../../lib/format";
import { LinkButton } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Chip, type Tone } from "../../../ui/Chip";
import { CompanyLogo } from "../../../ui/CompanyLogo";
import { FactList } from "../../../ui/FactList";
import OverlayScrollbar from "../../../ui/OverlayScrollbar";
import { RailSection } from "../../../ui/RailSection";
import { Row, RowStat, RowTitle } from "../../../ui/Row";
import { AccountDetailSkeleton } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { Tabs, type Tab } from "../../../ui/Tabs";
import { getAccount, listAccountSurveys, type AccountSurvey } from "../api/accounts-util";
import type { AccountDetailResponse } from "../types/account";
import { SyncChip } from "./AccountList";

/** The work area's panes. */
type AccountTab = "enquiries" | "deals" | "surveys";

const STAGE_TONE: Record<string, Tone> = { open: "blue", won: "green", lost: "neutral" };

/** Survey status tones, mirroring the survey feature's chips without importing them. */
const SURVEY_STAGE_TONE: Record<string, Tone> = {
  draft: "neutral",
  scheduled: "blue",
  assigned: "blue",
  in_progress: "orange",
  pending_review: "orange",
  completed: "green",
  cancelled: "red",
};

export function AccountDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<AccountDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<AccountTab>("enquiries");

  // Fetched alongside, not inside, `account-get`: surveys belong to the survey
  // function, and widening the lead function's account view would cross the
  // module boundary that keeps the two separately deployable.
  const [surveys, setSurveys] = useState<AccountSurvey[] | null>(null);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(null);
    setSurveys(null);
    setTab("enquiries");

    getAccount(id).then(({ data, error: err }) => {
      if (!live) return;
      if (err) setError(err);
      else setDetail(data);
    });

    listAccountSurveys(id).then(({ data }) => {
      if (!live) return;
      if (data) setSurveys(data.surveys);
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
      <PageShell title="Account" fillBody>
        <AccountDetailSkeleton />
      </PageShell>
    );
  }

  const { account, contacts, deals, leads } = detail;
  const address = account.address ?? {};
  const place = [address.street, address.city, address.state].filter(Boolean).join(", ");

  return (
    // The header stays a bare title — identity detail and the sync state live
    // in the record rail, Attio-style, and the shell's back chevron carries
    // the way back to the list. fillBody hands the page its own height so the
    // rail can be a FIXED panel: on wide screens the rail and the work area
    // scroll independently; below 1080px the whole page stacks and scrolls as
    // one.
    <PageShell title={account.name ?? "Account"} fillBody>
      <div className="flex min-h-0 flex-1 max-[1079px]:flex-col max-[1079px]:overflow-y-auto">
        {/* The record rail — a FIXED flat panel with its own scroll, not a
            floating card: flat sections divided by rules, the way Attio panels
            a record. Below 1080px it stacks above the work area and the page
            scrolls as one. */}
        <aside className="shrink-0 border-b min-[1080px]:min-h-0 min-[1080px]:w-[400px] min-[1080px]:border-r min-[1080px]:border-b-0">
          <OverlayScrollbar style={{ height: "100%" }}>
            <div className="pb-2 min-[1080px]:pb-[calc(--spacing(4)+env(safe-area-inset-bottom,0px))]">
              {/* The identity block — the rail leads with WHO: mark, name,
                  the record's meta line, and the sync state right where the
                  record is read. */}
              <div className="px-6 py-4">
                <CompanyLogo
                  name={account.name}
                  domain={account.websiteDomain}
                  email={account.email}
                  className="size-10"
                />
                <div className="mt-2.5 truncate text-base font-semibold tracking-tight">
                  {account.name ?? "Unnamed account"}
                </div>
                {/* A flex row, not inline spans: icons, text and the sync chip
                    all centre on one axis instead of chasing a text baseline. */}
                <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                  {account.websiteDomain ? (
                    // One flex item, so the domain and its separator wrap
                    // TOGETHER — split, a line ends on a dangling dot.
                    <span className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1">
                        <Globe className="size-3.5 opacity-70" aria-hidden="true" />
                        {account.websiteDomain}
                      </span>
                      <span aria-hidden="true" className="opacity-40">·</span>
                    </span>
                  ) : null}
                  <span className="flex items-center gap-1">
                    <Clock className="size-3.5 opacity-70" aria-hidden="true" />
                    {ago(account.createdAt)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="opacity-40">·</span>
                    <SyncChip account={account} small />
                  </span>
                </div>
              </div>

              <RailSection title="Company">
                <FactList
                  rows={[
                    {
                      icon: Globe,
                      label: "Domain",
                      value: account.websiteDomain ? (
                        <a href={`https://${account.websiteDomain}`} target="_blank" rel="noreferrer">
                          {account.websiteDomain}
                        </a>
                      ) : (
                        "—"
                      ),
                    },
                    {
                      icon: Mail,
                      label: "Email",
                      value: account.email ? <a href={`mailto:${account.email}`}>{account.email}</a> : "—",
                    },
                    {
                      icon: Phone,
                      label: "Phone",
                      value: account.phone ? <a href={`tel:${account.phone}`}>{account.phone}</a> : "—",
                    },
                    { icon: MapPin, label: "Location", value: place || "—" },
                    {
                      icon: CalendarDays,
                      label: "Customer since",
                      value: String(account.createdAt ?? "").slice(0, 10) || "—",
                    },
                  ]}
                />
              </RailSection>

              <RailSection title="Contacts" meta={contacts.length || undefined}>
                {contacts.length ? (
                  <ul className="flex list-none flex-col gap-3.5">
                    {contacts.map((c, i) => (
                      <li key={c.email ?? i} className="text-sm">
                        <div className="flex items-center gap-2">
                          <b className="min-w-0 truncate">{c.name ?? "—"}</b>
                          {/* The flag is the STRING "true" — there is no boolean
                              column type, so comparing to `true` never matches. */}
                          {String(c.isPrimary) === "true" ? <Chip small>primary</Chip> : null}
                        </div>
                        <div className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                          {c.email ?? ""}
                          {c.phone ? ` · ${c.phone}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  // `facilioContactId` is deliberately not shown anywhere: Facilio's
                  // create-client-contact returns no id we can extract, so it is null
                  // even when the contact synced (ARCHITECTURE.md §8a), and a "—" there
                  // would read as a failure.
                  <p className="text-muted-foreground text-sm">
                    No contact captured. The intake agent adds one when a visitor gives a name.
                  </p>
                )}
              </RailSection>
            </div>
          </OverlayScrollbar>
        </aside>

        {/* The work area: the tabbed panes, scrolling independently of the
            rail behind the same overlay scrollbar. */}
        <div className="min-w-0 flex-1 min-[1080px]:min-h-0">
          <OverlayScrollbar style={{ height: "100%" }}>
            {/* Insets written out longhand for the same safe-area reason as
                the shell's own scroller. */}
            <div className="px-4 pt-4 pb-[calc(--spacing(4)+env(safe-area-inset-bottom,0px))] sm:px-6 sm:pt-6 sm:pb-[calc(--spacing(6)+env(safe-area-inset-bottom,0px))]">
              {/* The tabs pin to the pane's top edge, so the navigation stays
                  on screen while a long lead history scrolls under it. */}
              <div className="bg-background sticky top-0 z-10 -mx-4 mb-1 px-4 pt-1 pb-3 sm:-mx-6 sm:px-6">
                <Tabs<AccountTab>
                  items={
                    [
                      { id: "enquiries", label: "Enquiries", count: leads.length },
                      { id: "deals", label: "Deals", count: deals.length },
                      // No count until the surveys request lands — inventing a 0
                      // while it loads would read as an answer.
                      { id: "surveys", label: "Surveys", count: surveys?.length },
                    ] satisfies Tab<AccountTab>[]
                  }
                  active={tab}
                  onChange={setTab}
                />
              </div>

              {/* Panes hide rather than unmount, so a tab switch never loses
                  scroll position or refetches anything. */}
              <div className={tab === "enquiries" ? undefined : "hidden"}>
                <Card pad={false}>
                  {leads.length ? (
                    leads.map((l) => (
                      <Row key={l.id} onClick={() => navigate(`/leads/${l.id}`)}>
                        <RowTitle
                          title={l.refNo}
                          meta={`${l.source}${l.serviceType ? ` · ${l.serviceType}` : ""}`}
                        />
                        <div>
                          <Chip tone={l.status === "converted" ? "green" : "neutral"}>
                            {l.status.replace(/_/g, " ")}
                          </Chip>
                        </div>
                        <RowStat value={l.score ?? null} unit="score" />
                        <div className="text-muted-foreground mt-px text-xs">{ago(l.createdAt)}</div>
                      </Row>
                    ))
                  ) : (
                    <Empty title="No leads linked" body="Enquiries resolve to this company by email domain." />
                  )}
                </Card>
              </div>

              <div className={tab === "deals" ? undefined : "hidden"}>
                <Card pad={false}>
                  {deals.length ? (
                    <div className="p-4">
                      <table className="w-full border-collapse text-sm [&_tr:last-child_td]:border-b-0">
                        <tbody>
                          {deals.map((d) => (
                            <tr key={d.refNo}>
                              <td className="border-b border-dashed py-1">
                                <b>{d.title ?? "Untitled deal"}</b>
                                <div className="text-muted-foreground text-xs tabular-nums">
                                  <code className="font-mono">{d.refNo}</code>
                                  {d.salesOwnerEmail ? ` · ${d.salesOwnerEmail}` : ""}
                                </div>
                              </td>
                              <td className="text-muted-foreground border-b border-dashed py-1 text-xs tabular-nums text-right whitespace-nowrap">
                                {money(d.estimatedValue, d.currency ?? "AED")}
                              </td>
                              <td className="border-b border-dashed py-1 text-right">
                                <Chip tone={STAGE_TONE[d.stage] ?? "neutral"}>{d.stage}</Chip>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty title="No deals yet" body="Converting a qualified lead creates the first one." />
                  )}
                </Card>
              </div>

              <div className={tab === "surveys" ? undefined : "hidden"}>
                <Card pad={false}>
                  {surveys === null ? (
                    <div className="text-muted-foreground px-4 py-3 text-sm">Loading…</div>
                  ) : surveys.length ? (
                    surveys.map((s) => (
                      <Row key={s.id} onClick={() => navigate(`/surveys/${s.id}`)}>
                        <RowTitle
                          title={
                            <>
                              <code className="mr-1.5 text-xs">{s.refNo}</code>
                              {s.title ?? "Untitled survey"}
                            </>
                          }
                          meta={s.templateName ?? "from scratch"}
                        />
                        <div>
                          <Chip tone={SURVEY_STAGE_TONE[s.status] ?? "neutral"}>
                            {s.status.replace(/_/g, " ")}
                          </Chip>
                        </div>
                        <RowStat value={s.visitCount ?? 0} unit="visits" />
                        <div className="text-muted-foreground mt-px text-xs">
                          {s.createdAt ? ago(s.createdAt) : "—"}
                        </div>
                      </Row>
                    ))
                  ) : (
                    <Empty
                      title="No surveys yet"
                      body="A survey is raised against one of this company's deals."
                      action={
                        deals.length ? (
                          <LinkButton to={`/surveys?new=${deals.length === 1 ? deals[0].id : ""}`}>
                            Raise a survey
                          </LinkButton>
                        ) : undefined
                      }
                    />
                  )}
                </Card>
              </div>
            </div>
          </OverlayScrollbar>
        </div>
      </div>
    </PageShell>
  );
}
