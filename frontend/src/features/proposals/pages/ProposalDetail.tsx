/**
 * The proposal record — live against `proposal.get`, one batched query.
 *
 * The page is built around one claim: EVERY NUMBER ON IT CAME FROM THE SERVER.
 * `get` computes the totals, the expiry, the approval exception list and the
 * readiness warnings on read, and every write handler returns the whole
 * recomputed proposal — so the page replaces its state wholesale rather than
 * patching a line and re-adding the money. A total the browser worked out is a
 * total that can disagree with the document the client is holding.
 *
 * THE TWO TOTALS ARE NEVER ADDED. A one-time mobilisation fee and a monthly
 * service charge are different kinds of money; a single figure covering both is
 * true of neither, and it is the number a client would sign.
 *
 * Every lifecycle action here is live. Which ones SHOW is gated on the
 * proposal's computed status, and the state machine in
 * `src/domain/proposal-state.ts` is the single authority for what is legal —
 * the buttons mirror that table rather than restating it. An action the server
 * still refuses reports its reason verbatim.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CheckCircle2,
  Circle,
  FileText,
  GitCompareArrows,
  Handshake,
  ListPlus,
  Send,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useActor } from "../../../app/auth";
import { PageShell } from "../../../app/shell/PageShell";
import { runAssessment, type Assessment } from "../../../lib/assess";
import { ago, humanise, plural, when } from "../../../lib/format";
import { AssessmentPanel } from "../../../ui/AssessmentPanel";
import { Card, Stack } from "../../../ui/Card";
import { Facts } from "../../../ui/Facts";
import { SkeletonRows } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { Tabs, type Tab } from "../../../ui/Tabs";
import { useToast } from "../../../ui/Toast";
import { Button } from "@/components/ui/button";
import { LinkButton } from "../../../ui/Button";
import {
  approveProposal,
  generateLines,
  getProposal,
  getReference,
  respondToProposal,
  returnProposal,
  reviseProposal,
  sendProposal,
  submitForApproval,
  withdrawProposal,
  type UnpricedItem,
} from "../api/proposals-util";
import { money, numeric, percent } from "../money";
import { ConfirmDialog, ReasonDialog, RespondDialog } from "../components/ActionDialogs";
import { ApprovalPanel } from "../components/ApprovalPanel";
import { DiffPane } from "../components/DiffPane";
import { LinesPane } from "../components/LinesPane";
import { NegotiationThread } from "../components/NegotiationThread";
import { ExpiryChip, ProposalStatusChip } from "../components/ProposalChips";
import { RateCardCard } from "../components/RateCardCard";
import { TermsCard } from "../components/TermsCard";
import {
  PROPOSAL_STATUS_LABEL,
  PROPOSAL_TRAIL,
  canRevise,
  type Proposal,
  type ProposalReference,
  type ProposalStatus,
} from "../types/proposal";

type TabId = "pricing" | "terms" | "negotiation" | "revision" | "activity";

/**
 * The agent this page runs. It advises; it does not write.
 *
 * A one-member union rather than a bare string: `estimation-intelligence` is
 * still a live agent with its handlers intact — only its panel came off this
 * page — so the day it comes back this is the one line that widens.
 */
type ProposalAgent = "proposal-intelligence";

/** The newest run of one agent, or null before it has ever run. */
const assessmentBy = (proposal: Proposal, agent: ProposalAgent): Assessment | null =>
  proposal.assessments?.find((a) => a.agent === agent) ?? null;

/** Which dialog is open. One piece of state rather than six booleans — only one
    of these can ever be up, and six flags is six chances for two to be true. */
type Action = "submit" | "approve" | "return" | "send" | "withdraw" | "respond" | "revise" | null;

export function ProposalDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const actor = useActor();
  const toast = useToast();

  // Which proposal this component is currently showing. An agent run checks
  // against it before writing — see `runAgent`.
  const showing = useRef(id);
  showing.current = id;

  const [tab, setTab] = useState<TabId>("pricing");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [reference, setReference] = useState<ProposalReference | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [action, setAction] = useState<Action>(null);
  const [generating, setGenerating] = useState(false);
  /** What the last generate could not price. Never dropped — an unpriced item
      the estimator cannot see is one that quietly leaves the proposal. */
  const [unpriced, setUnpriced] = useState<UnpricedItem[]>([]);
  /** Which agent is mid-run, so only its own button says "Reading…". */
  const [assessing, setAssessing] = useState<ProposalAgent | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    getProposal(id).then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (data) setProposal(data.proposal);
    });
    return () => {
      live = false;
    };
  }, [id, reloadKey]);

  // The enum vocabulary, fetched once and separately: the editor needs it, the
  // record does not, and folding it into the detail read would make every page
  // load pay for a list of units that never changes.
  useEffect(() => {
    let live = true;
    getReference().then(({ data }) => {
      if (live && data) setReference(data);
    });
    return () => {
      live = false;
    };
  }, []);

  const reload = () => setReloadKey((k) => k + 1);

  /**
   * Every lifecycle call answers with the refreshed proposal, so success is
   * "take what came back" rather than "fetch it again" — one round trip instead
   * of two, and no window where the screen shows the old status.
   */
  const applied = (
    result: { data: { proposal: Proposal } | null; error: string | null },
    done: string
  ): string | null => {
    if (result.error || !result.data?.proposal) return result.error ?? "That did not go through";
    setProposal(result.data.proposal);
    toast(done);
    return null;
  };

  /**
   * The model call is made HERE, not in the handler: a platform function aborts
   * at the ~10s fetch timeout and these agents take longer. The server builds
   * the prompt and stores the reply; this page is the leg in between.
   *
   * GUARDED ON THE ID, unlike the lifecycle actions above, and the difference is
   * the wait. This is the same component for /proposals/a and /proposals/b, and
   * an agent run is tens of seconds — long enough that leaving for another
   * proposal mid-run is ordinary behaviour, not a race you have to be unlucky to
   * hit. The toast still fires either way: the user wants to hear that the check
   * they started finished, even from the next page.
   */
  const runAgent = async (agent: ProposalAgent) => {
    if (!id) return;
    const startedOn = id;
    setAssessing(agent);
    const { data, error: err } = await runAssessment<{ proposal: Proposal }>(
      "proposal",
      "proposalId",
      id,
      agent,
      actor
    );
    if (showing.current === startedOn) setAssessing(null);

    if (err || !data?.proposal) {
      toast(err ?? "The check did not complete", true);
      return;
    }
    if (showing.current !== startedOn) {
      toast("Pre-send check finished");
      return;
    }
    setProposal(data.proposal);
    toast("Read and recorded");
  };

  const runGenerate = async () => {
    if (!id) return;
    setGenerating(true);
    const { data, error: err } = await generateLines(id, actor);
    setGenerating(false);

    if (err || !data) {
      toast(err ?? "Lines could not be generated", true);
      return;
    }
    setProposal(data.proposal);
    setUnpriced(data.unpriced ?? []);
    toast(`${plural(data.created, "line", "lines")} drafted from the survey`);
  };

  const tabs: Tab<TabId>[] = [
    { id: "pricing", label: "Pricing", count: proposal?.lines.length },
    { id: "terms", label: "Terms" },
    { id: "negotiation", label: "Negotiation", count: proposal?.negotiation?.length },
    // Only a revision has something to compare against. Offering the tab on a
    // v1 would be offering an empty room.
    ...(proposal?.parentProposalId ? [{ id: "revision" as const, label: "Revision" }] : []),
    { id: "activity", label: "Activity", count: proposal?.events?.length },
  ];

  return (
    <PageShell
      title={
        proposal
          ? `${proposal.refNo} v${proposal.revisionNo ?? 1}${proposal.title ? ` — ${proposal.title}` : ""}`
          : "Proposal"
      }
      subtitle={
        proposal
          ? `${PROPOSAL_STATUS_LABEL[proposal.status] ?? proposal.status}${
              proposal.updatedAt ? ` · updated ${ago(proposal.updatedAt)}` : ""
            }`
          : "Loading…"
      }
      // Loose buttons, not one wrapping div: the shell's action slot wraps its
      // ITEMS, and a single rigid row cannot wrap — on a phone it would run off
      // the screen. size="sm" throughout, matching every other page's header.
      actions={
        proposal ? (
          <ProposalActions
            proposal={proposal}
            generating={generating}
            onGenerate={runGenerate}
            onAction={setAction}
          />
        ) : null
      }
      strip={proposal ? <Tabs items={tabs} active={tab} onChange={setTab} /> : undefined}
    >
      <Stack>
        {!loaded ? (
          <Card pad={false}>
            <SkeletonRows count={4} />
          </Card>
        ) : error ? (
          <Card pad={false}>
            <ErrorState message={error} onRetry={reload} />
          </Card>
        ) : proposal ? (
          <>
            {/* The band that never leaves: where it stands, what it is worth,
                and how long that is true for. Whatever tab is open, these are
                the three questions asked of a proposal. */}
            <SummaryBand proposal={proposal} />

            {/* WARNINGS, NEVER BLOCKS (C8). The app tells the truth about what
                it noticed; the estimator is the one who decides to send. */}
            <WarningsCard warnings={proposal.warnings} />

            {unpriced.length ? <UnpricedCard items={unpriced} /> : null}

            {tab === "pricing" ? (
              <>
                {/* Card first, then the exceptions, then the lines — step 2 of
                    the derivation, then what it cost us, then step 6. */}
                <RateCardCard
                  rateCard={proposal.rateCard}
                  resolvedReason={proposal.rateCardResolvedReason}
                  currency={proposal.currency}
                />
                <ApprovalPanel approval={proposal.approval} />
                <LinesPane
                  proposal={proposal}
                  reference={reference}
                  actor={actor}
                  onSaved={setProposal}
                />

                {/* The agent reads the lines above, which is why it sits under
                    them rather than in the band at the top. It cannot change
                    anything: `Generate lines` remains the deterministic
                    survey-to-rate-card join, and this only says where the
                    result does not hold up. */}
                <AssessmentPanel
                  title="Pre-send check"
                  assessment={assessmentBy(proposal, "proposal-intelligence")}
                  running={assessing === "proposal-intelligence"}
                  onRun={() => runAgent("proposal-intelligence")}
                  runLabel="Check before sending"
                  blurb="Reads this proposal against the discovery sheet, the frozen survey and the rate card, and reports what is missing, inconsistent or unsupported."
                  recordUpdatedAt={proposal.updatedAt}
                  recordNoun="proposal"
                  staleAdvice="Run it again before sending."
                />
              </>
            ) : null}

            {tab === "terms" ? (
              <>
                <TermsCard proposal={proposal} actor={actor} onSaved={setProposal} />
                <ProvenanceCard proposal={proposal} />
              </>
            ) : null}

            {tab === "negotiation" ? (
              <NegotiationThread proposal={proposal} actor={actor} onAdded={setProposal} />
            ) : null}

            {tab === "revision" ? (
              <DiffPane
                proposalId={proposal.id}
                parentProposalId={proposal.parentProposalId}
                currency={proposal.currency}
              />
            ) : null}

            {tab === "activity" ? <ActivityCard proposal={proposal} /> : null}
          </>
        ) : null}
      </Stack>

      {id && proposal ? (
        <>
          <ConfirmDialog
            open={action === "submit"}
            onOpenChange={(o) => setAction(o ? "submit" : null)}
            title="Send this for approval"
            description={`${plural(
              proposal.approval?.exceptions.length ?? 0,
              "line deviates",
              "lines deviate"
            )} beyond what this proposal can carry unapproved. The approver sees those lines and their reasons — not the document.`}
            confirmLabel="Submit for approval"
            busyLabel="Submitting…"
            onConfirm={async () =>
              applied(await submitForApproval(id, actor), "Sent for approval")
            }
          />

          <ConfirmDialog
            open={action === "approve"}
            onOpenChange={(o) => setAction(o ? "approve" : null)}
            title={
              proposal.status === "draft" ? "Clear this for sending" : "Approve the deviations"
            }
            description={
              proposal.status === "draft"
                ? "Every line is within the discount threshold, so no approver is needed — the proposal clears itself and becomes sendable. Nothing about the price changes."
                : "This approves a departure from the rate card, not the card itself — the price list carries its own approval, and the two are different decisions."
            }
            confirmLabel="Approve"
            busyLabel="Approving…"
            onConfirm={async () => applied(await approveProposal(id, actor), "Approved")}
          />

          <ReasonDialog
            open={action === "return"}
            onOpenChange={(o) => setAction(o ? "return" : null)}
            title="Return this to the estimator"
            description="It goes back to draft with your reason on the record. Returning without one leaves the estimator guessing at what to change."
            label="Why it is coming back"
            placeholder="Which line, and what would make it approvable"
            confirmLabel="Return it"
            busyLabel="Returning…"
            onConfirm={async (reason) =>
              applied(await returnProposal(id, reason, actor), "Returned to draft")
            }
          />

          <ConfirmDialog
            open={action === "send"}
            onOpenChange={(o) => setAction(o ? "send" : null)}
            title="Send this proposal"
            description="Sending FREEZES this revision and stamps a checksum: what the client holds from this moment can never change. Any later change is a new revision, and the client keeps seeing this one until that revision is itself sent."
            confirmLabel="Freeze and send"
            busyLabel="Sending…"
            onConfirm={async () => applied(await sendProposal(id, actor), "Sent and frozen")}
          />

          <ReasonDialog
            open={action === "withdraw"}
            onOpenChange={(o) => setAction(o ? "withdraw" : null)}
            title="Withdraw this proposal"
            description="We are pulling the offer back. The client's copy still exists — this records that it no longer stands, and why."
            label="Why it is being withdrawn"
            placeholder="Kept on the record"
            confirmLabel="Withdraw"
            busyLabel="Withdrawing…"
            destructive
            onConfirm={async (reason) =>
              applied(await withdrawProposal(id, reason, actor), "Withdrawn")
            }
          />

          <RespondDialog
            open={action === "respond"}
            onOpenChange={(o) => setAction(o ? "respond" : null)}
            onConfirm={async (decision, reason) =>
              applied(
                await respondToProposal(id, decision, reason, actor),
                decision === "accepted" ? "Acceptance recorded" : "Rejection recorded"
              )
            }
          />

          <ConfirmDialog
            open={action === "revise"}
            onOpenChange={(o) => setAction(o ? "revise" : null)}
            title="Raise a revision"
            description="A new draft with these lines copied into it, and its own validity. This one stays live until the new revision is actually sent — getting that wrong is how you honour a price you never issued."
            confirmLabel="Create the revision"
            busyLabel="Creating…"
            onConfirm={async () => {
              const { data, error: err } = await reviseProposal(id, actor);
              if (err || !data?.proposal) return err ?? "The revision was not created";
              toast(`Revision v${data.proposal.revisionNo ?? "next"} created`);
              navigate(`/proposals/${data.proposal.id}`);
              return null;
            }}
          />
        </>
      ) : null}
    </PageShell>
  );
}

// ── Header actions ───────────────────────────────────────────────────────────

/**
 * What can be done, by status. The UI disables what it can see; the state
 * machine in `domain/proposal-state.ts` is the authority, and it runs
 * server-side where nothing in the browser can talk it round.
 *
 * Gated on the COMPUTED status, so a lapsed offer offers a revision rather than
 * a send — even though the column still says sent.
 */
function ProposalActions({
  proposal,
  generating,
  onGenerate,
  onAction,
}: {
  proposal: Proposal;
  generating: boolean;
  onGenerate: () => void;
  onAction: (action: Action) => void;
}) {
  const status = proposal.status;
  const needsApproval = Boolean(proposal.approval?.needsApproval);

  return (
    <>
      {status === "draft" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={onGenerate}
          disabled={generating || !proposal.surveyRevisionId}
          // The only explanation a disabled control can give — and this one is
          // a real answer, not a shrug: there is no survey to price from.
          title={
            proposal.surveyRevisionId
              ? "Draft priced lines from the frozen survey revision"
              : "This proposal has no survey revision behind it, so there is nothing to generate from — add the lines by hand"
          }
        >
          {/* NOT a sparkle, deliberately. In this app the sparkle means "an
              agent reads this" — it is on six buttons that make a model call.
              This one is a deterministic join from the frozen survey to the
              rate card, and wearing the same icon made three people in a row
              ask whether it was AI. */}
          <ListPlus className="size-4" />
          {generating ? "Generating…" : "Generate lines"}
        </Button>
      ) : null}

      {status === "draft" && needsApproval ? (
        <Button size="sm" variant="outline" onClick={() => onAction("submit")}>
          <ShieldCheck className="size-4" />
          Submit for approval
        </Button>
      ) : null}

      {/* THERE IS NO DRAFT → SENT EDGE. The state table allows `approve` from
          draft as well as from pending_approval, and that is the spec's
          "within authority, automatic" path — so a draft with no exceptions
          clears itself and becomes sendable, rather than skipping the state.
          Offering Send here would only ever surface a rejection. */}
      {status === "draft" && !needsApproval ? (
        <Button
          size="sm"
          onClick={() => onAction("approve")}
          disabled={!proposal.lines.length}
          title="Every line is within the discount threshold, so this needs no approver"
        >
          <ShieldCheck className="size-4" />
          Approve to send
        </Button>
      ) : null}

      {status === "pending_approval" ? (
        <>
          <Button size="sm" onClick={() => onAction("approve")}>
            <ShieldCheck className="size-4" />
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAction("return")}>
            <Undo2 className="size-4" />
            Return
          </Button>
        </>
      ) : null}

      {status === "approved" ? (
        <Button size="sm" onClick={() => onAction("send")} disabled={!proposal.lines.length}>
          <Send className="size-4" />
          Send
        </Button>
      ) : null}

      {status === "sent" ? (
        <>
          <Button size="sm" onClick={() => onAction("respond")}>
            <Handshake className="size-4" />
            Record response
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAction("withdraw")}>
            Withdraw
          </Button>
        </>
      ) : null}

      {canRevise(status) ? (
        <Button size="sm" variant="outline" onClick={() => onAction("revise")}>
          <GitCompareArrows className="size-4" />
          Revise
        </Button>
      ) : null}

      <LinkButton to={`/proposals/${proposal.id}/document`} small>
        <FileText className="size-4" />
        Document
      </LinkButton>
    </>
  );
}

// ── The band ─────────────────────────────────────────────────────────────────

/** One number in the band: quiet label, loud value, optional footnote. */
function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div> : null}
    </div>
  );
}

/**
 * The lifecycle trail with the proposal's position on it. The four endings that
 * are not an acceptance sit OFF the line under a banner: a withdrawn proposal
 * has no position on the road to acceptance, and drawing one would be a claim
 * about where it might still go.
 */
function TrailStepper({ status }: { status: ProposalStatus }) {
  const off = !PROPOSAL_TRAIL.includes(status);
  const idx = PROPOSAL_TRAIL.indexOf(status);

  return (
    <div className="flex flex-col gap-2.5">
      {off ? (
        <div className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium">
          <XCircle className="size-4 shrink-0" aria-hidden="true" />
          {PROPOSAL_STATUS_LABEL[status]} — this revision is no longer the live offer
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-y-2">
        {PROPOSAL_TRAIL.map((step, i) => {
          const done = !off && idx > i;
          const current = !off && step === status;
          return (
            <div key={step} className="flex items-center">
              {i > 0 ? (
                <div
                  className={cn("mx-1 h-px w-3.5 sm:w-5", done || current ? "bg-primary/50" : "bg-border")}
                />
              ) : null}
              <div className={cn("flex items-center gap-1.5 rounded-full py-1", current && "bg-muted px-2")}>
                {done ? (
                  <CheckCircle2
                    className="size-3.5 shrink-0 text-green-600 dark:text-green-500"
                    aria-hidden="true"
                  />
                ) : current ? (
                  <span className="bg-primary size-2 shrink-0 rounded-full" aria-hidden="true" />
                ) : (
                  <Circle className="text-muted-foreground/40 size-3.5 shrink-0" aria-hidden="true" />
                )}
                <span
                  className={cn(
                    "text-xs whitespace-nowrap",
                    current ? "font-medium" : done ? "text-muted-foreground" : "text-muted-foreground/60"
                  )}
                >
                  {PROPOSAL_STATUS_LABEL[step]}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryBand({ proposal }: { proposal: Proposal }) {
  const optional =
    (proposal.optionalOneTimeTotal ?? 0) > 0 || (proposal.optionalRecurringMonthlyTotal ?? 0) > 0;

  return (
    <Card
      title="Where this stands"
      meta={<ProposalStatusChip status={proposal.status} />}
    >
      <TrailStepper status={proposal.status} />

      <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
        {/* Two totals, side by side, never one. */}
        <Tile
          label="One-time"
          value={money(proposal.totalOneTime, proposal.currency)}
          sub="charged once"
        />
        <Tile
          label="Recurring"
          value={money(proposal.totalRecurringMonthly, proposal.currency)}
          sub="every month"
        />
        <Tile
          label="Validity"
          value={<ExpiryChip days={proposal.daysToExpiry} />}
          sub={
            proposal.storedStatus && proposal.storedStatus !== proposal.status
              ? `the record still says ${humanise(proposal.storedStatus)}`
              : proposal.validUntil
                ? `until ${when(proposal.validUntil)}`
                : "no date set"
          }
        />
        <Tile
          label="Revision"
          value={`v${proposal.revisionNo ?? 1}`}
          // Through `numeric()`, not a bare truthiness test: `deviationPct` is
          // not on the platform's numeric-column list, so a zero arrives as the
          // STRING "0" — which is truthy, and would print "+0.0% off card" on
          // every proposal that never left the card price.
          sub={
            numeric(proposal.deviationPct)
              ? `${percent(proposal.deviationPct)} off card`
              : proposal.parentProposalId
                ? "revised from an earlier one"
                : "first version"
          }
        />
      </div>

      {optional ? (
        <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">
          Optional services are priced separately and are NOT in the totals above —{" "}
          {money(proposal.optionalOneTimeTotal, proposal.currency)} one-time and{" "}
          {money(proposal.optionalRecurringMonthlyTotal, proposal.currency)} per month, which the
          client picks from at acceptance.
        </p>
      ) : null}
    </Card>
  );
}

/** The readiness warnings, as warnings. They never gate a button. */
function WarningsCard({ warnings }: { warnings: string[] | undefined }) {
  if (!warnings?.length) return null;

  return (
    <Card title="Worth knowing before this goes out" pad={false}>
      <ul className="flex flex-col">
        {warnings.map((w) => (
          <li key={w} className="flex items-start gap-2.5 border-b px-4 py-2.5 text-sm last:border-b-0">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-orange-600 dark:text-orange-400"
              aria-hidden="true"
            />
            <span className="min-w-0">{w}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground border-t px-4 py-2.5 text-xs">
        None of these stops a send. A person decides what goes to a client.
      </p>
    </Card>
  );
}

/** What the last generate could not price — named, never silently dropped. */
function UnpricedCard({ items }: { items: UnpricedItem[] }) {
  return (
    <Card title="Not priced by the card" meta={`${items.length}`} pad={false}>
      {items.map((u, i) => (
        <div key={`${u.estimationKey ?? u.label ?? "item"}-${i}`} className="border-b px-4 py-2.5 last:border-b-0">
          <div className="text-sm font-medium">{u.label ?? u.estimationKey ?? "Unnamed item"}</div>
          <div className="text-muted-foreground text-xs">{u.reason}</div>
        </div>
      ))}
      <p className="text-muted-foreground border-t px-4 py-2.5 text-xs">
        These came back from the survey with nothing on the card to price them against. Add them as
        custom lines, or leave them out deliberately — either way somebody chose.
      </p>
    </Card>
  );
}

// ── Terms tab, second card ───────────────────────────────────────────────────

/** Where this proposal came from and what has been done to it — the audit
    facts that belong on a record but never on a document. */
function ProvenanceCard({ proposal }: { proposal: Proposal }) {
  return (
    <Card title="Provenance">
      <Facts
        items={[
          { label: "Survey revision", value: proposal.surveyRevisionId ? "Priced from a frozen survey" : "Priced without a survey" },
          { label: "Created", value: proposal.createdAt ? when(proposal.createdAt) : null },
          { label: "Created by", value: proposal.createdBy },
          {
            label: "Approved",
            value: proposal.approvedAt
              ? `${when(proposal.approvedAt)}${proposal.approvedBy ? ` · ${proposal.approvedBy}` : ""}`
              : null,
          },
          {
            label: "Sent",
            value: proposal.sentAt
              ? `${when(proposal.sentAt)}${proposal.sentBy ? ` · ${proposal.sentBy}` : ""}`
              : null,
          },
          {
            label: "Decision",
            value: proposal.decision
              ? `${humanise(proposal.decision)}${proposal.decidedAt ? ` · ${when(proposal.decidedAt)}` : ""}`
              : null,
          },
          { label: "Reason", value: proposal.decisionReason },
          {
            label: "Checksum",
            // Text that looks numeric, and the proof this revision has not
            // moved since it was sent. Monospaced so it can be compared.
            value: proposal.checksum ? (
              <code className="font-mono text-xs break-all">{proposal.checksum}</code>
            ) : (
              "Stamped on send"
            ),
          },
        ]}
      />
    </Card>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  lines_generated: "Lines generated",
  line_saved: "Line saved",
  line_repriced: "Line repriced",
  line_removed: "Line removed",
  status_change: "Status change",
  submitted: "Sent for approval",
  approved: "Approved",
  returned: "Returned",
  sent: "Sent to the client",
  withdrawn: "Withdrawn",
  revised: "Revision raised",
  rendered: "Document rendered",
};

function ActivityCard({ proposal }: { proposal: Proposal }) {
  const events = proposal.events ?? [];

  if (!events.length) {
    return (
      <Card pad={false}>
        <Empty
          title="No activity"
          body="Every reprice, approval, send and response lands here, newest first — one audit spine, which the negotiation thread is a filtered view of."
        />
      </Card>
    );
  }

  return (
    <Card pad={false}>
      {/* A timeline, not a table: these rows are one story in order, and the
          dots give the eye a spine to run down. */}
      <div className="flex flex-col px-4 py-4">
        {events.map((e, i) => (
          <div key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < events.length - 1 ? (
              <span className="bg-border absolute top-4 bottom-0 left-[5px] w-px" aria-hidden="true" />
            ) : null}
            <span
              className="border-muted-foreground/40 bg-background mt-1.5 size-[11px] shrink-0 rounded-full border-2"
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-sm font-medium">
                {KIND_LABEL[e.kind] ?? e.kind.replace(/_/g, " ")}
              </span>
              {e.body ? <span className="text-sm">{e.body}</span> : null}
              {typeof e.meta?.reason === "string" ? (
                <span className="text-muted-foreground text-xs">“{e.meta.reason}”</span>
              ) : null}
              <span className="text-muted-foreground ml-auto text-xs whitespace-nowrap">
                {e.actor ? `${e.actor.split("@")[0]} · ` : ""}
                {ago(e.occurredAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
