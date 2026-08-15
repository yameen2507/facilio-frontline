/**
 * One deal: where it stands, what moves it, and everything hanging off it.
 *
 * The layout mirrors LeadDetail and AccountDetail — a fixed record rail
 * (identity, facts, contact, the originating enquiry) beside a tabbed work
 * area — so a record reads the same way everywhere in the console. The work
 * area leads with the stage path and the lifecycle actions, because "where is
 * this deal and what happens next" is the question the page exists to answer.
 *
 * Which actions show is driven by the server's `allowedNext`, not re-derived
 * here: the stage machine has one home (domain/deal-state.ts) and this page is
 * a reader of it. Every mutation returns `withDetail`, so acting never pays a
 * second fetch — the refreshed view arrives on the response.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  ClipboardList,
  FileSignature,
  Globe,
  Mail,
  MapPin,
  Phone,
  Plus,
  RotateCcw,
  Trophy,
  UserRound,
  Wrench,
  XCircle,
} from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { useActor } from "../../../app/auth";
import { useUserDirectory } from "../../../app/users";
import { runAssessment } from "../../../lib/assess";
import { ago, humanise, money, placeLine, typedMoney, when } from "../../../lib/format";
import { AssessmentPanel } from "../../../ui/AssessmentPanel";
import { Button as UIButton } from "@/components/ui/button";
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
import { captureDeal, drainAfterWin, getDeal, reopenDeal, transitionDeal, type Acted } from "../api/deals-util";
import {
  DiscoveryDialog,
  LoseDialog,
  MoveStageDialog,
  ReopenDialog,
  WinDialog,
} from "../components/ActionDialogs";
import { PortfolioTree } from "../../prospects/pages/PortfolioTree";
import { DealStageChip } from "../components/DealChips";
import { StagePath } from "../components/StagePath";
import {
  LOST_REASON_LABEL,
  type DealDetailResponse,
  type DealStage,
  type LostReason,
} from "../types/deal";

type DealTab = "overview" | "portfolio" | "surveys" | "proposals" | "activity";

/** The two agents that read a deal — one per terminal stage. Both advise. */
type DealAgent = "lost-deal-intelligence" | "handover-intelligence";

/** Survey status tones, mirroring the survey feature's chips without importing them. */
const SURVEY_TONE: Record<string, Tone> = {
  draft: "neutral",
  scheduled: "blue",
  assigned: "blue",
  in_progress: "orange",
  pending_review: "orange",
  completed: "green",
  cancelled: "red",
};

/** Proposal status tones, same arrangement — the two features stay separately shippable. */
const PROPOSAL_TONE: Record<string, Tone> = {
  draft: "neutral",
  pending_approval: "orange",
  approved: "blue",
  sent: "blue",
  accepted: "green",
  rejected: "red",
  expired: "red",
  superseded: "neutral",
  withdrawn: "neutral",
};

/** The discovery sheet's field order and labels — what the Overview card prints. */
const DISCOVERY_LABELS: [string, string][] = [
  ["facilityType", "Facility type"],
  ["numberOfSites", "Sites"],
  ["approxAreaSqft", "Approx. area (sqft)"],
  ["frequency", "Frequency"],
  ["startDate", "Expected start"],
  ["contractDurationMonths", "Duration (months)"],
  ["existingProvider", "Existing provider"],
  ["decisionMakers", "Decision makers"],
  ["procurementProcess", "Procurement"],
  ["budget", "Budget"],
];

export function DealDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const actor = useActor();
  // The sales owner as a person, not an address (X-05).
  const { nameOf } = useUserDirectory();

  const [detail, setDetail] = useState<DealDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<DealTab>("overview");

  const [moving, setMoving] = useState(false);
  const [winning, setWinning] = useState(false);
  const [losing, setLosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [capturing, setCapturing] = useState(false);
  /** Which deal agent is mid-run, so only its own button says "Reading…". */
  const [assessing, setAssessing] = useState<DealAgent | null>(null);

  // Which deal this component is showing. A long agent run checks against it
  // before writing — see `runLossAnalysis`.
  const showing = useRef(id);
  showing.current = id;

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(null);
    setTab("overview");
    getDeal(id).then(({ data, error: err }) => {
      if (!live) return;
      if (err) setError(err);
      else setDetail(data);
    });
    return () => {
      live = false;
    };
  }, [id, reloadKey]);

  /** Every dialog resolves through this: the refreshed view is ON the mutation
      response, so success is one state write and no refetch. */
  const applied = ({ data, error: err }: { data: Acted | null; error: string | null }): string | null => {
    if (err) return err;
    if (data?.detail) setDetail(data.detail);
    return null;
  };

  /**
   * The model call is made HERE, not in the handler: a platform function aborts
   * at the ~10s fetch timeout and these agents take longer. The server builds
   * the prompt and stores the reply — this page is the leg in between.
   *
   * The two deal agents are mutually exclusive by stage: one only reads a lost
   * deal, the other only a won one. They still share this runner, because what
   * differs between them is a string.
   */
  const runDealAgent = async (agent: DealAgent) => {
    const startedOn = id;
    setAssessing(agent);
    const { data, error: err } = await runAssessment<{ detail: DealDetailResponse }>(
      "deal",
      "dealId",
      id,
      agent,
      actor || ""
    );
    // Guarded on the id: this is the same component for every deal, and an
    // agent run is tens of seconds — long enough that moving to another deal
    // mid-run is ordinary. A reply for deal A must never paint over deal B,
    // and least of all as an ERROR banner on a deal that is perfectly fine.
    if (showing.current !== startedOn) return;
    setAssessing(null);
    if (err || !data?.detail) {
      setError(err ?? "That read did not complete");
      return;
    }
    setDetail(data.detail);
  };

  if (error) {
    return (
      <PageShell title="Deal">
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </PageShell>
    );
  }

  if (!detail) {
    return (
      <PageShell title="Deal" fillBody>
        <AccountDetailSkeleton />
      </PageShell>
    );
  }

  const { deal, allowedNext, account, contact, lead, surveys, proposals, timeline } = detail;
  const currency = deal.currency ?? "AED";
  const terminal = deal.stage === "won" || deal.stage === "lost";

  const workingMoves = allowedNext.filter((s): s is DealStage => s !== "won" && s !== "lost");
  const canWin = allowedNext.includes("won");
  const canLose = allowedNext.includes("lost");

  const data = deal.data ?? {};
  const discovery = (data.discovery as Record<string, unknown>) ?? {};
  const won = (data.won as Record<string, unknown>) ?? {};
  const lost = (data.lost as Record<string, unknown>) ?? {};
  const lostHistory = (data.lostHistory as unknown[]) ?? [];

  const discoveryRows = DISCOVERY_LABELS.filter(([key]) => discovery[key] !== undefined);
  // placeLine drops the "Dubai, Dubai" stutter (X-15).
  const enquiryPlace = lead ? placeLine(lead.siteAddress, lead.siteCity, lead.siteRegion) : "";

  return (
    <PageShell title={deal.title ?? deal.refNo} fillBody>
      <div className="flex min-h-0 flex-1 max-[1079px]:flex-col max-[1079px]:overflow-y-auto">
        {/* The record rail — same fixed flat panel as the lead and account records. */}
        <aside className="shrink-0 border-b min-[1080px]:min-h-0 min-[1080px]:w-[400px] min-[1080px]:border-r min-[1080px]:border-b-0">
          <OverlayScrollbar style={{ height: "100%" }}>
            <div className="pb-2 min-[1080px]:pb-[calc(--spacing(4)+env(safe-area-inset-bottom,0px))]">
              <div className="px-6 py-4">
                <CompanyLogo
                  name={account?.name ?? deal.title ?? deal.refNo}
                  domain={account?.websiteDomain}
                  email={account?.email}
                  className="size-10"
                />
                <div className="mt-2.5 truncate text-base font-semibold tracking-tight">
                  {deal.title ?? "Untitled deal"}
                </div>
                <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                  <code className="font-mono">{deal.refNo}</code>
                  <span aria-hidden="true" className="opacity-40">·</span>
                  <DealStageChip stage={deal.stage} small />
                  <span aria-hidden="true" className="opacity-40">·</span>
                  <span>{ago(deal.createdAt)}</span>
                </div>
              </div>

              <RailSection title="Deal">
                <FactList
                  rows={[
                    {
                      icon: Banknote,
                      label: "Value",
                      // D-05: the type travels with the money from the lead.
                      value: `${typedMoney(deal.estimatedValue, currency, deal.valueType, deal.valueFrequency)}${
                        won.finalValue !== undefined ? ` · final ${money(Number(won.finalValue), currency)}` : ""
                      }`,
                    },
                    { icon: UserRound, label: "Sales owner", value: deal.salesOwnerEmail ? nameOf(deal.salesOwnerEmail) : "—" },
                    { icon: Globe, label: "Source", value: humanise(deal.source) || "—" },
                    {
                      icon: CalendarDays,
                      label: "Opened",
                      value: String(deal.createdAt ?? "").slice(0, 10) || "—",
                    },
                  ]}
                />
              </RailSection>

              <RailSection title="Account">
                {account ? (
                  <FactList
                    rows={[
                      {
                        icon: Globe,
                        label: "Company",
                        value: <Link to={`/accounts/${account.id}`}>{account.name ?? "Account"}</Link>,
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
                    ]}
                  />
                ) : (
                  <p className="text-muted-foreground text-sm">No account is linked.</p>
                )}
              </RailSection>

              <RailSection title="Contact">
                {contact ? (
                  <div className="text-sm">
                    <div className="flex items-center gap-2">
                      <b className="min-w-0 truncate">{contact.name ?? "—"}</b>
                      {String(contact.isPrimary) === "true" ? <Chip small>primary</Chip> : null}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                      {contact.email ?? ""}
                      {contact.phone ? ` · ${contact.phone}` : ""}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No contact captured on this deal.
                  </p>
                )}
              </RailSection>

              <RailSection title="Enquiry">
                {lead ? (
                  <FactList
                    rows={[
                      {
                        icon: ArrowRight,
                        label: "Lead",
                        value: <Link to={`/leads/${lead.id}`}>{lead.refNo}</Link>,
                      },
                      { icon: Wrench, label: "Service", value: lead.serviceType ?? "—" },
                      { icon: MapPin, label: "Site", value: enquiryPlace || "—" },
                      {
                        icon: ClipboardList,
                        label: "AI verdict",
                        value: lead.verdict
                          ? `${humanise(lead.verdict)}${lead.score != null ? ` · ${lead.score}` : ""}`
                          : "—",
                      },
                    ]}
                  />
                ) : (
                  <p className="text-muted-foreground text-sm">No originating lead recorded.</p>
                )}
              </RailSection>
            </div>
          </OverlayScrollbar>
        </aside>

        {/* The work area. */}
        <div className="min-w-0 flex-1 min-[1080px]:min-h-0">
          <OverlayScrollbar style={{ height: "100%" }}>
            <div className="px-4 pt-4 pb-[calc(--spacing(4)+env(safe-area-inset-bottom,0px))] sm:px-6 sm:pt-6 sm:pb-[calc(--spacing(6)+env(safe-area-inset-bottom,0px))]">
              {/* The stage path and the actions that move it — the page's lead. */}
              <Card>
                <StagePath deal={deal} />
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {workingMoves.length ? (
                    <UIButton size="sm" variant="outline" onClick={() => setMoving(true)}>
                      <ArrowRight className="size-4" />
                      Move stage
                    </UIButton>
                  ) : null}
                  {canWin ? (
                    <UIButton size="sm" onClick={() => setWinning(true)}>
                      <Trophy className="size-4" />
                      Mark won
                    </UIButton>
                  ) : null}
                  {canLose ? (
                    <UIButton size="sm" variant="outline" onClick={() => setLosing(true)}>
                      <XCircle className="size-4" />
                      Mark lost
                    </UIButton>
                  ) : null}
                  {terminal ? (
                    <UIButton size="sm" variant="outline" onClick={() => setReopening(true)}>
                      <RotateCcw className="size-4" />
                      Reopen
                    </UIButton>
                  ) : null}
                  {!canWin && !terminal ? (
                    <span className="text-muted-foreground text-xs">
                      Winning needs a submitted proposal first.
                    </span>
                  ) : null}
                </div>
              </Card>

              <div className="bg-background sticky top-0 z-10 -mx-4 mt-4 mb-1 px-4 pt-1 pb-3 sm:-mx-6 sm:px-6">
                <Tabs<DealTab>
                  items={
                    [
                      { id: "overview", label: "Overview" },
                      // §5.1 — the fifth tab. F-14 is resolved: this page exists,
                      // so the pursuit's properties belong on it rather than
                      // behind a picker on a separate screen (X-6, X-20).
                      { id: "portfolio", label: "Portfolio" },
                      { id: "surveys", label: "Surveys", count: surveys.length },
                      { id: "proposals", label: "Proposals", count: proposals.length },
                      { id: "activity", label: "Activity", count: timeline.length },
                    ] satisfies Tab<DealTab>[]
                  }
                  active={tab}
                  onChange={setTab}
                />
              </div>

              {/* Panes hide rather than unmount, so a tab switch never loses scroll. */}
              <div className={tab === "overview" ? "flex flex-col gap-4" : "hidden"}>
                {deal.stage === "lost" || lostHistory.length ? (
                  <Card>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">Why it was lost</h3>
                      {deal.lostAt ? (
                        <span className="text-muted-foreground text-xs">{when(deal.lostAt)}</span>
                      ) : null}
                    </div>
                    {deal.stage === "lost" ? (
                      <FactList
                        rows={[
                          {
                            icon: XCircle,
                            label: "Reason",
                            value: LOST_REASON_LABEL[deal.lostReason as LostReason] ?? humanise(deal.lostReason),
                          },
                          ...(lost.lostReasonDetail
                            ? [{ icon: ClipboardList, label: "Detail", value: String(lost.lostReasonDetail) }]
                            : []),
                          ...(lost.competitor
                            ? [{ icon: UserRound, label: "Competitor", value: String(lost.competitor) }]
                            : []),
                          ...(lost.customerSentiment
                            ? [{ icon: Mail, label: "Sentiment", value: humanise(String(lost.customerSentiment)) }]
                            : []),
                          ...(lost.futureOpportunity
                            ? [{ icon: CalendarDays, label: "Future opportunity", value: humanise(String(lost.futureOpportunity)) }]
                            : []),
                        ]}
                      />
                    ) : null}
                    {lostHistory.length ? (
                      <p className="text-muted-foreground mt-2 text-xs">
                        {lostHistory.length === 1
                          ? "Lost once before — the earlier analysis is kept in the deal's history."
                          : `Lost ${lostHistory.length} times before — every analysis is kept in the deal's history.`}
                      </p>
                    ) : null}
                  </Card>
                ) : null}

                {/* Only on a lost deal, because that is the only state the
                    agent will read — it refuses anything else rather than
                    guessing at a loss that has not happened. Sits under the
                    capture sheet it is built from. */}
                {deal.stage === "lost" ? (
                  <AssessmentPanel
                    title="Loss analysis"
                    assessment={
                      detail.assessments?.find((a) => a.agent === "lost-deal-intelligence") ?? null
                    }
                    running={assessing === "lost-deal-intelligence"}
                    onRun={() => runDealAgent("lost-deal-intelligence")}
                    runLabel="Analyse this loss"
                    blurb="Reads the loss capture, the proposal history and every other lost deal for the pattern behind this one."
                    recordUpdatedAt={deal.updatedAt}
                    recordNoun="deal"
                    staleAdvice="The loss record changed since — run it again."
                  />
                ) : null}

                {deal.stage === "won" ? (
                  <Card>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">Won</h3>
                      {deal.wonAt ? (
                        <span className="text-muted-foreground text-xs">{when(deal.wonAt)}</span>
                      ) : null}
                    </div>
                    <FactList
                      rows={[
                        {
                          icon: Banknote,
                          label: "Final value",
                          value:
                            won.finalValue !== undefined
                              ? money(Number(won.finalValue), currency)
                              : money(deal.estimatedValue, currency),
                        },
                        {
                          icon: CalendarDays,
                          label: "Contract start",
                          value: won.contractStartDate ? String(won.contractStartDate) : "—",
                        },
                        {
                          icon: ClipboardList,
                          label: "Duration",
                          value: won.contractDurationMonths ? `${won.contractDurationMonths} months` : "—",
                        },
                      ]}
                    />
                    <p className="text-muted-foreground mt-2 text-xs">
                      Handed to operations for onboarding — the timeline carries the handover event.
                    </p>
                  </Card>
                ) : null}

                {/* Only on a won deal, directly under the win record it reads.
                    It assembles the handover from the accepted proposal, the
                    site tree and the contacts — and is told plainly that there
                    is no contract module here, so it reports the signed
                    document, the manpower plan and the exclusions as missing
                    rather than inventing them. */}
                {deal.stage === "won" ? (
                  <AssessmentPanel
                    title="Operations handover"
                    assessment={
                      detail.assessments?.find((a) => a.agent === "handover-intelligence") ?? null
                    }
                    running={assessing === "handover-intelligence"}
                    onRun={() => runDealAgent("handover-intelligence")}
                    runLabel="Prepare the handover"
                    disabledReason={
                      proposals.some((p) => p.status === "accepted" || p.status === "sent")
                        ? null
                        : "No proposal has been sent or accepted on this deal, so there is no agreed scope to hand over."
                    }
                    blurb="Turns this won deal into something Operations can act on — sites, services, frequencies, timing, contacts — and lists what is still outstanding before they can take it over."
                    recordUpdatedAt={deal.updatedAt}
                    recordNoun="deal"
                    staleAdvice="The win record changed since — run it again."
                  />
                ) : null}

                <Card>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Discovery</h3>
                    {!terminal ? (
                      <UIButton size="sm" variant="ghost" onClick={() => setCapturing(true)}>
                        {discoveryRows.length ? "Edit" : "Capture"}
                      </UIButton>
                    ) : null}
                  </div>
                  {discoveryRows.length ? (
                    <FactList
                      rows={discoveryRows.map(([key, label]) => ({
                        icon: ClipboardList,
                        label,
                        value: String(discovery[key]),
                      }))}
                    />
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      Nothing captured yet. Discovery is what estimation prices from — facility,
                      sites, frequency, decision makers, budget.
                    </p>
                  )}
                </Card>
              </div>

              <div className={tab === "surveys" ? undefined : "hidden"}>
                <Card pad={false}>
                  {surveys.length ? (
                    <>
                      {surveys.map((s) => (
                        <Row key={s.id} onClick={() => navigate(`/surveys/${s.id}`)}>
                          <RowTitle
                            title={
                              <>
                                <code className="mr-1.5 text-xs">{s.refNo}</code>
                                {s.title ?? "Untitled survey"}
                              </>
                            }
                            meta={s.targetCompletionDate ? `due ${s.targetCompletionDate}` : undefined}
                          />
                          <div>
                            <Chip tone={SURVEY_TONE[s.status] ?? "neutral"}>{humanise(s.status)}</Chip>
                          </div>
                          <RowStat value={s.completenessPct ?? null} unit="% done" />
                          <div className="text-muted-foreground mt-px text-xs">{ago(s.createdAt)}</div>
                        </Row>
                      ))}
                      {!terminal ? (
                        <div className="border-t px-4 py-2">
                          <LinkButton to={`/surveys?new=${deal.id}`}>
                            <Plus className="size-4" />
                            Raise another
                          </LinkButton>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <Empty
                      title="No surveys yet"
                      body="Raising one moves the deal into Survey required; completing it moves it on again."
                      action={
                        !terminal ? (
                          <LinkButton to={`/surveys?new=${deal.id}`}>Raise a survey</LinkButton>
                        ) : undefined
                      }
                    />
                  )}
                </Card>
              </div>

              <div className={tab === "proposals" ? undefined : "hidden"}>
                <Card pad={false}>
                  {proposals.length ? (
                    <>
                      {proposals.map((p) => (
                        <Row key={p.id} onClick={() => navigate(`/proposals/${p.id}`)}>
                          <RowTitle
                            title={
                              <>
                                <code className="mr-1.5 text-xs">
                                  {p.refNo}
                                  {(p.revisionNo ?? 1) > 1 ? ` v${p.revisionNo}` : ""}
                                </code>
                                {p.title ?? "Untitled proposal"}
                              </>
                            }
                            meta={
                              p.totalOneTime || p.totalRecurringMonthly
                                ? `${money(p.totalOneTime, p.currency ?? currency)}${
                                    p.totalRecurringMonthly
                                      ? ` + ${money(p.totalRecurringMonthly, p.currency ?? currency)}/mo`
                                      : ""
                                  }`
                                : undefined
                            }
                          />
                          <div>
                            <Chip tone={PROPOSAL_TONE[p.status] ?? "neutral"}>{humanise(p.status)}</Chip>
                          </div>
                          <RowStat value={p.revisionNo ?? 1} unit="rev" />
                          <div className="text-muted-foreground mt-px text-xs">{ago(p.createdAt)}</div>
                        </Row>
                      ))}
                      {!terminal ? (
                        <div className="border-t px-4 py-2">
                          <LinkButton to={`/proposals?new=${deal.id}`}>
                            <Plus className="size-4" />
                            Raise another
                          </LinkButton>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <Empty
                      title="No proposals yet"
                      body="Sending one moves the deal into Proposal submitted. Every version a client has held is kept."
                      action={
                        !terminal ? (
                          <LinkButton to={`/proposals?new=${deal.id}`}>
                            <FileSignature className="size-4" />
                            Raise a proposal
                          </LinkButton>
                        ) : undefined
                      }
                    />
                  )}
                </Card>
              </div>

              {/* Scoped to this deal, so the same component drops its own deal
                  picker and never groups by building — inside one pursuit, one
                  row is one row. Mounted only when open: it fetches on mount and
                  the other four tabs should not pay for it. */}
              <div className={tab === "portfolio" ? undefined : "hidden"}>
                {tab === "portfolio" ? <PortfolioTree scope={{ dealId: deal.id }} /> : null}
              </div>

              <div className={tab === "activity" ? undefined : "hidden"}>
                <Card pad={false}>
                  {timeline.length ? (
                    <ul className="flex list-none flex-col">
                      {timeline.map((e) => (
                        <li key={e.id} className="flex items-start gap-3 border-b px-4 py-3 text-sm last:border-b-0">
                          <span
                            className="bg-muted-foreground/60 mt-1.5 size-1.5 shrink-0 rounded-full"
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <div>{e.body ?? humanise(e.kind)}</div>
                            <div className="text-muted-foreground mt-0.5 text-xs">
                              {humanise(e.kind)}
                              {e.actor ? ` · ${e.actor}` : ""}
                              {` · ${when(e.occurredAt)}`}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty
                      title="No activity yet"
                      body="Stage moves, capture edits and the win/loss record all land here."
                    />
                  )}
                </Card>
              </div>
            </div>
          </OverlayScrollbar>
        </div>
      </div>

      <MoveStageDialog
        open={moving}
        onOpenChange={setMoving}
        stages={workingMoves}
        onConfirm={(toStage, note) =>
          transitionDeal({ dealId: deal.id, toStage, note, actorEmail: actor || null }).then(applied)
        }
      />
      <WinDialog
        open={winning}
        onOpenChange={setWinning}
        currency={currency}
        estimatedValue={deal.estimatedValue}
        onConfirm={(capture, note) =>
          transitionDeal({ dealId: deal.id, toStage: "won", capture, note, actorEmail: actor || null }).then(
            (result) => {
              const err = applied(result);
              // Winning queued the Facilio writes; drain now so the client
              // exists before anyone opens the Convert screen. Fire-and-forget —
              // the outbox retries anything this pass misses.
              if (!err) void drainAfterWin();
              return err;
            }
          )
        }
      />
      <LoseDialog
        open={losing}
        onOpenChange={setLosing}
        onConfirm={(lostReason, capture) =>
          transitionDeal({ dealId: deal.id, toStage: "lost", lostReason, capture, actorEmail: actor || null }).then(
            applied
          )
        }
      />
      <ReopenDialog
        open={reopening}
        onOpenChange={setReopening}
        closedStage={deal.stage}
        onConfirm={(note) => reopenDeal(deal.id, note, actor).then(applied)}
      />
      <DiscoveryDialog
        open={capturing}
        onOpenChange={setCapturing}
        existing={discovery}
        onConfirm={(values) => captureDeal(deal.id, "discovery", values, actor || null).then(applied)}
      />
    </PageShell>
  );
}
