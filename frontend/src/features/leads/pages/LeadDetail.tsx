/**
 * One lead: everything known about it, and every move available on it.
 *
 * Three things here are load-bearing and easy to undo by accident:
 *
 * 1. **The assessment runs in the BROWSER, not the server.** A function aborts at
 *    the ~10s fetch timeout and a model call is slower than that
 *    (ARCHITECTURE.md §8a). So: ask the server for the prompt, call the agent from
 *    here, post the reply back to be parsed and stored. This page is the reason the
 *    UI is not optional.
 * 2. **Mutations render from their own response.** Each handler returns the
 *    refreshed `detail`, so an action costs one round trip instead of two.
 * 3. **Every async completion is guarded.** The lead id can change under this
 *    component (it is the same component for `/leads/a` and `/leads/b`), and a
 *    reply that lands after the user moved on must not paint the previous lead's
 *    data over the current one.
 *
 * Actions that need input (log a call, nurture-until, assign, close) run through
 * the dialogs in components/ActionDialogs. Their submit callbacks return whether
 * the mutation landed: `false` keeps the dialog open with the input intact so a
 * rejected write can be fixed and retried, `true` lets it close.
 */

import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
  ArrowRight,
  Banknote,
  Building2,
  ChevronDown,
  ClipboardList,
  Clock,
  FileText,
  GitMerge,
  Handshake,
  Inbox,
  Mail,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  PenLine,
  Phone,
  User,
  UserCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button as UIButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAccess } from "../../../app/access";
import { useUserDirectory } from "../../../app/users";
import { useActor } from "../../../app/auth";
import { PageShell } from "../../../app/shell/PageShell";
import { ago, humanise, onDay, placeLine, plural, typedMoney } from "../../../lib/format";
import { errMessage } from "../../../lib/request";
import { vibe } from "../../../lib/vibe";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { CompanyLogo } from "../../../ui/CompanyLogo";
import { FactList } from "../../../ui/FactList";
import OverlayScrollbar from "../../../ui/OverlayScrollbar";
import { RailSection } from "../../../ui/RailSection";
import { LeadDetailSkeleton } from "../../../ui/Skeleton";
import { ErrorState } from "../../../ui/States";
import { useToast } from "../../../ui/Toast";
import { actionsFor, isTerminal, movesFor, MOVES, PERMISSION_OF, type LeadActionId } from "../actions";
import {
  analyseInput,
  assignLead,
  claimLead,
  convertLead,
  getLead,
  listDealSurveys,
  logCall,
  storeAnalysis,
  transitionLead,
  updateLead,
} from "../api/leads-util";
import { AiAssessment } from "../components/AiAssessment";
import {
  LeadActionDialogs,
  type AssignRole,
  type PendingLeadAction,
} from "../components/ActionDialogs";
import { SlaChip } from "../components/LeadChips";
import { SurveysPane } from "../components/SurveysPane";
import { LifecycleSteps } from "../components/LifecycleSteps";
import { ResponseClocks } from "../components/ResponseClocks";
import { PortfolioTree } from "../../prospects/pages/PortfolioTree";
import { Ownership, Timeline } from "../components/Timeline";
import { TranscriptPane } from "../components/TranscriptCard";
import { Tabs, type Tab } from "../../../ui/Tabs";
import type { DealSurvey, LeadDetail as LeadDetailShape } from "../types/lead";

/** The right-hand container's panes. */
type DetailTab = "assessment" | "portfolio" | "surveys" | "activity" | "conversation";

/**
 * How each channel presents in the header — the same vocabulary the new-lead
 * dialog uses, with an icon carrying the channel at a glance. Only `widget`
 * leads have a conversation behind them, which is why only they grow the
 * Conversation tab.
 */
const SOURCE_META: Record<string, { Icon: LucideIcon; label: string }> = {
  widget: { Icon: MessageSquare, label: "Website chat" },
  tender: { Icon: FileText, label: "Tender notice" },
  inapp: { Icon: PenLine, label: "Raised internally" },
};

export function LeadDetail() {
  const { id = "" } = useParams();
  const actor = useActor();
  const { can, loading: accessLoading } = useAccess();
  // People render by name, never by address (X-05).
  const { nameOf } = useUserDirectory();
  const toast = useToast();

  const [detail, setDetail] = useState<LeadDetailShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, setPending] = useState<PendingLeadAction>(null);
  const [tab, setTab] = useState<DetailTab>("assessment");
  const [surveys, setSurveys] = useState<DealSurvey[] | null>(null);
  const [surveysError, setSurveysError] = useState<string | null>(null);
  // Whether the full stage path has scrolled out of the work area — the
  // condensed sticky strip is shown only then.
  const [condensed, setCondensed] = useState(false);
  const pathEndRef = useRef<HTMLDivElement | null>(null);

  // Which lead this component is currently showing. An async reply checks against
  // it before writing, which is what stops a slow response for lead A from
  // painting over lead B after a navigation.
  const showing = useRef(id);
  showing.current = id;

  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(null);
    // A fresh lead starts on the verdict; a tab picked on the previous lead
    // must not carry over ("conversation" may not even exist on this one).
    setTab("assessment");

    getLead(id).then(({ data, error: err }) => {
      if (!live) return;
      if (err) setError(err);
      else setDetail(data);
    });

    return () => {
      live = false;
    };
  }, [id, reloadKey]);

  /**
   * Applies a mutation's own returned view.
   *
   * The sidebar's open-lead count is deliberately NOT refreshed here. The vanilla
   * console refetched a hundred leads after every action to update one integer;
   * returning to the inbox remounts it and refetches anyway, so the badge is stale
   * only while you stay on this page.
   */
  const settled = (result: { detail: LeadDetailShape } | null, message: string) => {
    if (!result) return;
    if (!mounted.current) return;
    toast(message);
    // The write is guarded even though the toast is not: an action started on lead
    // A must never paint its result over lead B, but the user still wants to hear
    // that it worked.
    if (showing.current === id) setDetail(result.detail);
  };

  /** Reports a rejection and returns null, so callers can `if (!ok) return`. */
  const unwrap = <T,>(res: { data: T | null; error: string | null }): T | null => {
    if (res.error) {
      toast(res.error, true);
      return null;
    }
    return res.data;
  };

  async function assess() {
    setAssessing(true);
    try {
      // 1. The prompt is built server-side from settings, so the scope brief that
      //    drives relevance is never duplicated in this client.
      const prep = unwrap(await analyseInput(id));
      if (!prep) return;

      // 2. The model call, from the page. A function would abort before it returns.
      const reply = await vibe.executeAgent<{ response?: { content?: string } }>(prep.agent, prep.input);
      const content = reply?.response?.content;
      if (!content) {
        toast("The assessor returned nothing", true);
        return;
      }

      // 3. Parsed, clamped and stored as a new version server-side.
      const stored = unwrap(await storeAnalysis(id, content));
      if (!stored) return;

      settled(stored, `${humanise(stored.verdict)} · score ${stored.score}`);
    } catch (err) {
      toast(errMessage(err, "The assessment failed"), true);
    } finally {
      // The await chain spans several seconds; the user may well have left.
      if (mounted.current) setAssessing(false);
    }
  }

  // Surveys ride on the DEAL, so they exist only after conversion. Fetched
  // here rather than in the pane because the count also feeds the tab label
  // and the enquiry banner — one request, three consumers. Keyed on dealId,
  // which appears the moment Convert lands and refetches then.
  const dealIdForSurveys = detail?.lead.dealId ?? null;
  useEffect(() => {
    setSurveys(null);
    setSurveysError(null);
    if (!dealIdForSurveys) return;

    let live = true;
    listDealSurveys(dealIdForSurveys).then(({ data, error: err }) => {
      if (!live) return;
      if (err) setSurveysError(err);
      else setSurveys(data?.surveys ?? []);
    });

    return () => {
      live = false;
    };
  }, [dealIdForSurveys, reloadKey]);

  // Watches the point just under the path card, WITH the work-area scroller as
  // the observer's root — against the window the sentinel can be "hidden" while
  // still below the pane's top edge, and the strip never fired. "Not
  // intersecting AND above the root's top" = the whole path has scrolled away,
  // which is when the condensed strip earns its place. Keyed on `detail`: the
  // sentinel exists only once the loaded view renders.
  useEffect(() => {
    const el = pathEndRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setCondensed(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0));
      },
      { root: el.closest(".overlay-scroll") }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [detail]);

  // An unassessed lead assesses ITSELF: the verdict is the first thing anyone
  // wants from this page, and the click that fetched it was pure ceremony. One
  // attempt per lead id — a failed run toasts and falls back to the card's
  // manual button rather than retrying in a loop, which with a broken assessor
  // would burn a model call per render. Terminal leads are exempt: history is
  // read, not re-scored, and re-assessment stays a deliberate act.
  const autoAssessed = useRef<string | null>(null);
  useEffect(() => {
    if (!detail || detail.analysis || assessing) return;
    if (isTerminal(detail.lead.status)) return;
    // An automatic model call WAITS for the permission answer: fail-open is
    // for controls a person still has to click, not for a write the page
    // makes by itself — a view-only role merely opening an unassessed lead
    // must not burn a model call and append an analysis version.
    if (accessLoading || !can("leads", PERMISSION_OF.assess)) return;
    if (autoAssessed.current === id) return;
    autoAssessed.current = id;
    void assess();
    // `assess` is deliberately not a dependency: it is recreated per render
    // and would re-fire this effect. The run is keyed on what actually
    // matters — which lead, and whether it has a verdict yet.
  }, [detail, id, assessing, accessLoading, can]);

  if (error) {
    return (
      <PageShell title="Lead">
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </PageShell>
    );
  }

  if (!detail) {
    return (
      <PageShell title="Lead" fillBody>
        <LeadDetailSkeleton />
      </PageShell>
    );
  }

  const lead = detail.lead;
  const token = lead.data?.intakeSessionToken;

  // Labels here are for the HEADER's buttons (claim as an ownership grab, work
  // that doesn't move the lead). A move rendered on the path card takes its
  // label from MOVES instead, where it is phrased around the state it lands in.
  const HANDLERS: Record<
    LeadActionId,
    { label: string; glyph?: ComponentProps<typeof Button>["glyph"]; run: () => Promise<void> | void }
  > = {
    claim: {
      label: "Claim",
      run: async () => settled(unwrap(await claimLead(id, actor)), "Claimed — it's yours"),
    },
    // "Add call notes", not "Record a call" — record implies audio, and this
    // is a person typing what happened on the call.
    "log-call": { label: "Add call notes", glyph: "phone", run: () => setPending("log-call") },
    assess: { label: "Assess with AI", run: assess },
    reassess: { label: "Re-assess", run: assess },
    qualify: {
      label: "Qualify",
      run: async () => settled(unwrap(await transitionLead(id, "qualified", actor)), "Qualified"),
    },
    nurture: { label: "Nurture", run: () => setPending("nurture") },
    assign: { label: "Assign…", run: () => setPending("assign") },
    convert: {
      label: "Convert to deal",
      run: async () => {
        // F-06: a not_relevant verdict gets a dialog, not a click-through —
        // the server enforces the same rule, this just asks BEFORE failing.
        if (detail?.lead.verdict === "not_relevant") {
          setPending("convert-override");
          return;
        }
        const r = unwrap(await convertLead(id, actor));
        if (r) settled(r, `${r.dealRefNo} created`);
      },
    },
    close: { label: "Close", run: () => setPending("close") },
  };

  /**
   * Dialog submits. `true` closes the dialog; `false` (a rejected write, already
   * toasted by `unwrap`) keeps it open with the input intact for a retry.
   */
  const submitLogCall = async (body: string): Promise<boolean> => {
    const r = unwrap(await logCall(id, body, actor));
    if (!r) return false;
    settled(r, "Call logged");
    setPending(null);
    return true;
  };

  const submitNurture = async (until: string): Promise<boolean> => {
    // Two steps: the status change is validated by the state machine, the date
    // is an ordinary field edit. Only the second one's view is rendered — the
    // first would be stale a moment later.
    if (!unwrap(await transitionLead(id, "nurture", actor, { note: `Nurturing until ${until}` }))) return false;
    const r = unwrap(await updateLead(id, { nurtureUntil: until }, actor));
    if (!r) return false;
    settled(r, `Parked until ${until}`);
    setPending(null);
    return true;
  };

  const submitAssign = async (who: string, role: AssignRole): Promise<boolean> => {
    const r = unwrap(await assignLead(id, who, role, actor));
    if (!r) return false;
    settled(r, `${role === "sales" ? "Sales owner" : "Actioner"} set to ${who}`);
    setPending(null);
    return true;
  };

  const submitClose = async (reason: string): Promise<boolean> => {
    const r = unwrap(await transitionLead(id, "closed", actor, { dispositionReason: reason }));
    if (!r) return false;
    settled(r, "Closed");
    setPending(null);
    return true;
  };

  /** F-06's deliberate path: convert past a not_relevant verdict, recorded. */
  const submitConvertOverride = async (): Promise<boolean> => {
    const r = unwrap(await convertLead(id, actor, true));
    if (!r) return false;
    settled(r, `${r.dealRefNo} created — assessment overridden`);
    setPending(null);
    return true;
  };

  // Both sets are pure functions of the lead's state, and both are unit-tested.
  // The header carries only work that does NOT advance the lead; anything that
  // moves it lives on the path card below, labelled with its destination.
  // Assessing — first run and re-runs alike — lives on the AI assessment pane,
  // beside the verdict it refreshes, so the header never duplicates it.
  // "claim" and "log-call" stay in the header only while they are NOT the
  // recommended move, so the same action never appears twice.
  // The state machine says what the LEAD allows; the permission matrix says
  // what the PERSON may do. Both filters run before anything renders, so a
  // forbidden move is never offered only to bounce off the server.
  const available = actionsFor(lead, Boolean(detail.analysis)).filter((a) =>
    can("leads", PERMISSION_OF[a])
  );
  const allowedMoves = movesFor(lead);
  const moves = {
    next:
      allowedMoves.next && can("leads", PERMISSION_OF[allowedMoves.next])
        ? allowedMoves.next
        : null,
    others: allowedMoves.others.filter((m) => can("leads", PERMISSION_OF[m])),
  };
  const next = moves.next;
  const headerActions = available.filter(
    (a) => (a === "claim" && next !== "claim") || (a === "log-call" && next !== "log-call")
  );

  const source = SOURCE_META[lead.source] ?? { Icon: Inbox, label: humanise(lead.source) };

  return (
    // The header carries the title and the overflow menu; identity detail,
    // the clock verdict and the primary actions live in the record rail,
    // Attio-style. fillBody hands the page its own height so the rail can be
    // a FIXED panel: on wide screens the rail and the work area scroll
    // independently; below 1080px the whole page stacks and scrolls as one.
    <PageShell
      title={lead.companyName}
      fillBody
      actions={
        /* The menu goes away entirely when nothing is left to put in it, so
           the trigger never opens onto an empty sheet. */
        available.includes("assign") ? (
          /* shadcn's Button rather than the app wrapper: asChild injects the
             trigger's props into its child, and the wrapper doesn't forward
             unknown props. */
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <UIButton variant="outline" size="sm" aria-label="More actions">
                <MoreHorizontal />
              </UIButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setPending("assign")}>Assign…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      }
    >
      <div className="flex min-h-0 flex-1 max-[1079px]:flex-col max-[1079px]:overflow-y-auto">
        {/* The record rail — a FIXED flat panel with its own scroll, not a
            floating card: flat sections divided by rules, the way Attio panels
            a record. Below 1080px it stacks above the work area and the page
            scrolls as one. */}
        <aside className="shrink-0 border-b min-[1080px]:min-h-0 min-[1080px]:w-[400px] min-[1080px]:border-r min-[1080px]:border-b-0">
          {/* The house overlay scrollbar, not Radix ScrollArea: its viewport
              wraps content in an inline display:table div that silently breaks
              position:sticky, which the work area depends on — and the thin
              floating bar solves the same always-on-track ugliness. */}
          <OverlayScrollbar style={{ height: "100%" }}>
            <div className="pb-2 min-[1080px]:pb-[calc(--spacing(4)+env(safe-area-inset-bottom,0px))]">
          {/* The identity block — the rail leads with WHO, the way Attio heads
              its record panel: mark, name, the record's meta line, then its
              actions right where the record is read. */}
          <div className="px-6 py-4">
            <CompanyLogo
              name={lead.companyName}
              domain={lead.websiteDomain}
              email={lead.contactEmail}
              className="size-10"
            />
            <div className="mt-2.5 truncate text-base font-semibold tracking-tight">{lead.companyName}</div>
            {/* A flex row, not inline spans: icons, text and the clock chip
                all centre on one axis instead of chasing a text baseline. */}
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
              <span className="font-mono">{lead.refNo}</span>
              <span aria-hidden="true" className="opacity-40">·</span>
              <span className="flex items-center gap-1">
                <source.Icon className="size-3.5 opacity-70" aria-hidden="true" />
                {source.label}
                {/* D-10: where it came from, beside how it arrived. */}
                {lead.origin ? ` · from ${humanise(lead.origin)}` : ""}
              </span>
              <span aria-hidden="true" className="opacity-40">·</span>
              <span className="flex items-center gap-1">
                <Clock className="size-3.5 opacity-70" aria-hidden="true" />
                {ago(lead.createdAt)}
              </span>
              {detail.sla ? (
                // One flex item, so the separator and the chip wrap TOGETHER —
                // split, a line ends on a dangling dot.
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="opacity-40">·</span>
                  <SlaChip sla={detail.sla} />
                </span>
              ) : null}
            </div>
            {/* The rail keeps only the everyday work; the overflow menu lives
                in the page header's right corner. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {headerActions.map((a) => (
                <Button key={a} small glyph={HANDLERS[a].glyph} onClick={() => void HANDLERS[a].run()}>
                  {HANDLERS[a].label}
                </Button>
              ))}
            </div>
          </div>

          <RailSection title="Enquiry">
            {/* The deal's surveys, surfaced where the record is read. The
                button is a tab switch, not a navigation — the list is one
                click to the right. */}
            {surveys?.length ? (
              <div className="mb-4 flex items-center gap-2 rounded-md bg-green-100 px-3 py-2.5 text-green-700 dark:bg-green-950 dark:text-green-400">
                <ClipboardList className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {plural(surveys.length, "survey", "surveys")} raised on this deal
                </span>
                <button
                  type="button"
                  onClick={() => setTab("surveys")}
                  className="shrink-0 text-xs font-medium underline-offset-4 hover:underline"
                >
                  View
                </button>
              </div>
            ) : null}
            {/* First thing in the card: the same company enquiring again is a
                buying signal, and each merged row says WHICH key matched, so
                the reader can judge the merge rather than take it on faith. */}
            {detail.duplicates.length ? (
              <div className="mb-4 rounded-md bg-orange-100 px-3 py-2.5 text-orange-700 dark:bg-orange-950 dark:text-orange-400">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <GitMerge className="size-3.5 shrink-0" aria-hidden="true" />
                  {plural(detail.duplicates.length, "duplicate enquiry", "duplicate enquiries")} merged in
                </div>
                <ul className="mt-1 flex list-none flex-col gap-0.5 pl-[22px] text-xs">
                  {detail.duplicates.map((d) => (
                    <li key={d.id}>
                      <Link to={`/leads/${d.id}`} className="font-medium underline-offset-4 hover:underline">
                        {d.refNo}
                      </Link>
                      {" · "}
                      {d.matchedOn ? `same ${d.matchedOn}` : "matched this lead"}
                      {" · "}
                      {onDay(d.createdAt)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mb-4">
              {lead.description ?? "No description captured."}
            </div>
            <FactList
              rows={[
                { icon: User, label: "Contact", value: lead.contactName ?? "—" },
                { icon: Wrench, label: "Service", value: lead.serviceType ?? "—" },
                {
                  icon: Mail,
                  label: "Email",
                  value: lead.contactEmail ? <a href={`mailto:${lead.contactEmail}`}>{lead.contactEmail}</a> : "—",
                },
                {
                  icon: Phone,
                  label: "Phone",
                  value: lead.contactPhone ? <a href={`tel:${lead.contactPhone}`}>{lead.contactPhone}</a> : "—",
                },
                {
                  icon: MapPin,
                  label: "Location",
                  // placeLine drops the "Dubai, Dubai" stutter (X-15).
                  value: placeLine(lead.siteCity, lead.siteAddress) || "—",
                },
                {
                  icon: Banknote,
                  label: "Est. value",
                  // D-05: the number plus what kind of number — 12,000/mo and
                  // 12,000 one-off must never read the same.
                  value: typedMoney(
                    lead.estimatedValue,
                    lead.currency ?? "AED",
                    lead.valueType,
                    lead.valueFrequency
                  ),
                },
                { icon: UserCheck, label: "Owner", value: lead.ownerEmail ? nameOf(lead.ownerEmail) : "unclaimed" },
                {
                  icon: Handshake,
                  label: "Deal",
                  // The next step after conversion is the site walk — offer it
                  // where the deal is, not three pages away.
                  value: lead.dealId ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Link to={`/deals/${lead.dealId}`}>View deal</Link>
                      <Link to={`/surveys?new=${lead.dealId}`}>Raise survey</Link>
                    </span>
                  ) : (
                    "—"
                  ),
                },
                {
                  icon: Building2,
                  label: "Account",
                  // The account is created FROM this lead's company at
                  // conversion, so the company name is its honest label —
                  // "Company page" said where the link went, not who it was.
                  value: lead.accountId ? (
                    <Link to={`/accounts/${lead.accountId}`}>{lead.companyName}</Link>
                  ) : (
                    "—"
                  ),
                },
              ]}
            />
            {/* The close reason lives on the path's terminal segment, and the
                merged duplicates lead the section as the banner above. */}
          </RailSection>

          <RailSection title="Response clocks">
            <ResponseClocks lead={lead} />
          </RailSection>

          <RailSection title="Ownership" meta={detail.assignments.length || undefined}>
            <Ownership assignments={detail.assignments} />
          </RailSection>
            </div>
          </OverlayScrollbar>
        </aside>

        {/* The work area: the stage path, then the tabbed panes, scrolling
            independently of the rail behind the same overlay scrollbar. */}
        <div className="min-w-0 flex-1 min-[1080px]:min-h-0">
          <OverlayScrollbar style={{ height: "100%" }}>
            {/* Insets written out longhand for the same safe-area reason as
                the shell's own scroller. */}
            <div className="px-4 pt-4 pb-[calc(--spacing(4)+env(safe-area-inset-bottom,0px))] sm:px-6 sm:pt-6 sm:pb-[calc(--spacing(6)+env(safe-area-inset-bottom,0px))]">
          {/* The path card: where the lead IS, then the moves that change
              that — kept on one surface so the flow and the controls that
              drive it are never read apart. Terminal leads get the path alone;
              there is nothing left to move. */}
          <Card className="mb-5" pad={false}>
            <div className="p-3 sm:p-4">
              <LifecycleSteps lead={lead} />
            </div>
            {next || moves.others.length ? (
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t px-4 py-3">
                {next ? (
                  // One sentence beside the button that performs it, so the
                  // control never has to be decoded ("Qualify… into what?").
                  <p className="text-muted-foreground min-w-0 flex-1 basis-56 text-sm">{MOVES[next].hint}</p>
                ) : (
                  <span className="min-w-0 flex-1 basis-56" aria-hidden="true" />
                )}
                {moves.others.length ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <UIButton variant="outline" size="sm">
                        Move to
                        <ChevronDown />
                      </UIButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                      {moves.others.map((m) => (
                        <DropdownMenuItem
                          key={m}
                          variant={m === "close" ? "destructive" : "default"}
                          className="flex-col items-start gap-0.5 py-2"
                          onSelect={() => void HANDLERS[m].run()}
                        >
                          <span className="text-sm font-medium">{MOVES[m].label}</span>
                          {/* Every item says where the move lands, so picking
                              one is never a guess. */}
                          <span className="text-muted-foreground text-xs">
                            {MOVES[m].blurb} · {humanise(lead.status)} → {humanise(MOVES[m].to)}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {next ? (
                  // shadcn's Button here too, for a different reason than the
                  // menu triggers: the app wrapper only renders a LEADING
                  // glyph, and the forward arrow must trail the label to read
                  // as "this advances it".
                  <UIButton size="sm" onClick={() => void HANDLERS[next].run()}>
                    {MOVES[next].label}
                    <ArrowRight />
                  </UIButton>
                ) : null}
              </div>
            ) : null}
          </Card>

          {/* The point just under the path card; when it crosses the viewport
              top the full path is gone and the sticky strip takes over. */}
          <div ref={pathEndRef} aria-hidden="true" />
          {condensed ? (
            // h-0 so appearing never shifts the layout — the strip floats over
            // the content on its own backdrop, sliding in from the top edge.
            // Its rendered height is 44px (py-2 + the h-7 compact bar), which
            // is the offset the pinned tabs sit at below.
            <div className="sticky top-0 z-20 h-0">
              <div className="bg-background/95 -mx-4 px-4 py-2 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200 sm:-mx-6 sm:px-6">
                <LifecycleSteps lead={lead} compact />
              </div>
            </div>
          ) : null}

          {/* The tabs pin WITH the strip: sticky at the top edge, and once the
              condensed path appears they ride 44px below it, so the position
              and the panes' navigation stay on screen together. */}
          <div
            className={cn(
              "sticky z-10 -mx-4 mb-1 bg-background px-4 pt-1 pb-3 transition-[top] duration-200 motion-reduce:transition-none sm:-mx-6 sm:px-6",
              condensed ? "top-[44px] border-b" : "top-0"
            )}
          >
            <Tabs<DetailTab>
              items={
                [
                  // X-08: the glossary says "analysis" — one word everywhere.
                  { id: "assessment", label: "AI analysis" },
                  // §5.1 — the sites named in the enquiry, before any deal
                  // exists. "The address of the sites… the full addresses"
                  // arrives with the RFP, and until now those rows had nowhere
                  // to be seen. Unlike Surveys this tab does NOT wait on a deal:
                  // having no deal yet is exactly when it is the only view.
                  { id: "portfolio", label: "Portfolio" },
                  // Surveys exist only once a deal does — a tab that can never
                  // hold content is noise on an unconverted lead.
                  ...(lead.dealId
                    ? [{ id: "surveys", label: "Surveys", count: surveys?.length } as Tab<DetailTab>]
                    : []),
                  { id: "activity", label: "Activity", count: detail.timeline.length },
                  ...(token ? [{ id: "conversation", label: "Conversation" } as Tab<DetailTab>] : []),
                ] satisfies Tab<DetailTab>[]
              }
              active={tab}
              onChange={setTab}
            />
          </div>
          {/* Panes sit FLAT under the tabs — the pane is the page here, and a
              wrapper card was chrome with no job. They hide rather than
              unmount: the transcript is its own request and the analyst ticker
              has state, and a tab switch must not refetch or restart either. */}
          <div className={tab === "assessment" ? undefined : "hidden"}>
              <AiAssessment
                lead={lead}
                band={detail.band}
                analysis={detail.analysis}
                onAssess={() => void assess()}
                assessing={assessing}
                canAssess={can("leads", PERMISSION_OF.assess)}
              />
            </div>
          {lead.dealId ? (
            <div className={tab === "surveys" ? undefined : "hidden"}>
              <SurveysPane dealId={lead.dealId} surveys={surveys} error={surveysError} />
            </div>
          ) : null}
          <div className={tab === "portfolio" ? undefined : "hidden"}>
            {tab === "portfolio" ? <PortfolioTree scope={{ leadId: lead.id }} /> : null}
          </div>

          <div className={tab === "activity" ? undefined : "hidden"}>
            <Timeline events={detail.timeline} />
          </div>
          {token ? (
            <div className={tab === "conversation" ? undefined : "hidden"}>
              <TranscriptPane token={token} />
            </div>
          ) : null}
            </div>
          </OverlayScrollbar>
        </div>
      </div>

      <LeadActionDialogs
        pending={pending}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        defaultAssignee={actor}
        score={lead.score ?? null}
        onLogCall={submitLogCall}
        onNurture={submitNurture}
        onAssign={submitAssign}
        onCloseLead={submitClose}
        onConvertOverride={submitConvertOverride}
      />
    </PageShell>
  );
}
