/**
 * The survey record — live against `survey.get`, one batched query.
 *
 * The tabs mirror the four questions actually asked of a survey: when is the
 * walk, who is doing it, what did they find, and what disagrees with the tender
 * documents. Portfolio and Reconciliation now ACT rather than just report —
 * verdicts are recorded on one, differences decided on the other.
 *
 * EVERY MOVE GOES THROUGH THE SERVER'S OWN RULES. Schedule (T2, which is when
 * the template snapshot is copied), Assign and set-lead (T3), Send for review
 * (T5), Send back for rework (T6), Complete (T7, which freezes the revision the
 * estimator prices from) and Cancel (T8). This page disables what it can and
 * shows `readiness` so a person sees what is owed before clicking — but the
 * handler is the authority, and a refusal from it is displayed verbatim.
 *
 * The one thing NOT editable here is status: it moves through those actions,
 * never through a form, or every guard in the module would be optional.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  Circle,
  FileSignature,
  Footprints,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  Undo2,
  Upload,
  UserPlus,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useActor } from "../../../app/auth";
import { PageShell } from "../../../app/shell/PageShell";
import { ago, humanise, onDay, plural, when } from "../../../lib/format";
import { Card, Split, Stack } from "../../../ui/Card";
import { Facts } from "../../../ui/Facts";
import { SkeletonRows } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { Tabs, type Tab } from "../../../ui/Tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateTimeField, plusHours } from "../../../ui/DateField";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addQualification,
  assignSurveyors,
  createProposalFromSurvey,
  decideReconcileItem,
  getSurvey,
  importNodes,
  removeQualification,
  runReconcile,
  scheduleVisit,
  setLead,
  setNodeVerdict,
  transitionSurvey,
  transitionVisit,
  updateSurvey,
} from "../api/surveys-util";
import { PhotoGallery } from "../components/PhotoGallery";
import { SurveyStatusChip, VerdictChip, VisitStatusChip } from "../components/SurveyChips";
import { Chip } from "../../../ui/Chip";
import {
  SURVEY_STATUS_LABEL,
  SURVEY_TRAIL,
  VERDICT_LABEL,
  type NodeVerdict,
  type ProspectNode,
  type ReconciliationItem,
  type SurveyDetailResponse,
  type SurveyStatus,
} from "../types/survey";

type TabId = "overview" | "visits" | "team" | "portfolio" | "photos" | "reconciliation" | "activity";

/**
 * Counts ride on the collection tabs once the detail has loaded — "Photos 12"
 * answers whether the tab is worth opening. Overview never carries one: it is
 * not a collection, and a number on it would be an invention.
 */
const buildTabs = (detail: SurveyDetailResponse | null): Tab<TabId>[] => [
  { id: "overview", label: "Overview" },
  { id: "visits", label: "Visits", count: detail?.visits.length },
  { id: "team", label: "Team", count: detail?.assignees.length },
  { id: "portfolio", label: "Portfolio", count: detail?.nodes.length },
  { id: "photos", label: "Photos", count: detail ? (detail.photos?.length ?? 0) : undefined },
  { id: "reconciliation", label: "Reconciliation", count: detail?.reconciliation.length },
  { id: "activity", label: "Activity", count: detail ? (detail.events?.length ?? 0) : undefined },
];

export function SurveyDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const actor = useActor();
  const [tab, setTab] = useState<TabId>("overview");

  const [detail, setDetail] = useState<SurveyDetailResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [scheduling, setScheduling] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState(false);
  /** Which lifecycle move is being confirmed — null when no dialog is open. */
  const [moving, setMoving] = useState<LifecycleMove | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    getSurvey(id).then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (data) setDetail(data);
    });
    return () => {
      live = false;
    };
  }, [id, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const survey = detail?.survey;
  const terminal = survey?.status === "completed" || survey?.status === "cancelled";

  return (
    <PageShell
      title={survey ? `${survey.refNo} — ${survey.title ?? "Untitled survey"}` : "Survey"}
      subtitle={
        survey
          ? `${survey.accountName ?? "No account"} · ${
              survey.statusChangedAt ? `moved ${ago(survey.statusChangedAt)}` : "just created"
            }`
          : "Loading…"
      }
      // Loose buttons, not one wrapping div: the shell's action slot wraps its
      // ITEMS, and a single rigid flex row can't wrap — on a phone it overflowed
      // past the left screen edge. (The old "All surveys" button duplicated the
      // shell's back chevron and only crowded the phone header.)
      actions={
        survey && !terminal ? (
          // size="sm" throughout — every button riding the shell's action slot
          // matches the list pages' "New survey", or the header reads two-storey.
          <>
            <Button size="sm" variant="outline" onClick={() => setScheduling(true)}>
              <CalendarPlus className="size-4" />
              {survey.status === "draft" ? "Schedule visit" : "Add visit"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAssigning(true)}>
              <UserPlus className="size-4" />
              Assign
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
              Edit
            </Button>
            {detail?.visits.length ? (
              // Primary while capture is still the job; once the survey is
              // waiting on review the walk is reference and Complete leads.
              <Button
                size="sm"
                variant={survey.status === "pending_review" ? "outline" : "default"}
                onClick={() => navigate(`/surveys/${id}/walk`)}
              >
                <Footprints className="size-4" />
                Open walk
              </Button>
            ) : null}
            {/* The three lifecycle moves, each offered only from the state it
                is legal in — the same table `domain/survey-state.ts` enforces.
                Offering a button the server would refuse is how a UI teaches
                people not to trust it. */}
            {survey.status === "in_progress" ? (
              <Button size="sm" variant="outline" onClick={() => setMoving("pending_review")}>
                <Send className="size-4" />
                Send for review
              </Button>
            ) : null}
            {survey.status === "pending_review" ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setMoving("in_progress")}>
                  <Undo2 className="size-4" />
                  Send back
                </Button>
                <Button size="sm" onClick={() => setMoving("completed")}>
                  <CheckCircle2 className="size-4" />
                  Complete survey
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>
              Cancel survey
            </Button>
          </>
        ) : null
      }
      strip={<Tabs items={buildTabs(detail)} active={tab} onChange={setTab} />}
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
        ) : detail && survey ? (
          <>
            {tab === "overview" ? (
              <OverviewTab detail={detail} actor={actor} terminal={terminal} onChanged={reload} />
            ) : null}
            {tab === "visits" ? (
              <VisitsTab detail={detail} actor={actor} terminal={terminal} onChanged={reload} />
            ) : null}
            {tab === "team" ? <TeamTab detail={detail} /> : null}
            {tab === "portfolio" ? (
              <PortfolioTab detail={detail} actor={actor} terminal={terminal} onChanged={reload} />
            ) : null}
            {tab === "photos" ? <PhotosTab detail={detail} /> : null}
            {tab === "reconciliation" ? (
              <ReconciliationTab
                detail={detail}
                actor={actor}
                terminal={terminal}
                onChanged={reload}
              />
            ) : null}
            {tab === "activity" ? <ActivityTab detail={detail} /> : null}
          </>
        ) : null}
      </Stack>

      {id ? (
        <>
          <ScheduleVisitDialog
            open={scheduling}
            onOpenChange={setScheduling}
            surveyId={id}
            actor={actor}
            isFirst={survey?.status === "draft"}
            onDone={reload}
          />
          <AssignDialog
            open={assigning}
            onOpenChange={setAssigning}
            surveyId={id}
            actor={actor}
            hasLead={Boolean(survey?.leadUserEmail)}
            onDone={reload}
          />
          <LifecycleDialog
            move={moving}
            onOpenChange={(open) => !open && setMoving(null)}
            surveyId={id}
            actor={actor}
            // The gate the SERVER would apply to this exact move, handed
            // straight down — never re-derived here.
            gate={moving === "completed" ? detail?.readiness?.submit : detail?.readiness?.review}
            onDone={reload}
          />
          {survey ? (
            <EditSurveyDialog
              open={editing}
              onOpenChange={setEditing}
              survey={survey}
              actor={actor}
              onDone={reload}
            />
          ) : null}
          <CancelSurveyDialog
            open={cancelling}
            onOpenChange={setCancelling}
            surveyId={id}
            actor={actor}
            onDone={reload}
          />
        </>
      ) : null}
    </PageShell>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

/**
 * The lifecycle trail with the survey's position marked on it — done steps
 * tick off, the current one is lit, the rest wait dim. A cancelled survey
 * shows the whole trail muted under a cancelled banner: where it died is on
 * the Activity tab, and pretending a position here would be a guess.
 */
function TrailStepper({ status }: { status: SurveyStatus }) {
  const cancelled = status === "cancelled";
  const idx = SURVEY_TRAIL.indexOf(status);

  return (
    <div className="flex flex-col gap-2.5">
      {cancelled ? (
        <div className="text-destructive flex items-center gap-1.5 text-sm font-medium">
          <XCircle className="size-4" aria-hidden="true" />
          Cancelled — the reason is on the Activity tab
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-y-2">
        {SURVEY_TRAIL.map((step, i) => {
          const done = !cancelled && idx > i;
          const current = !cancelled && step === status;
          return (
            <div key={step} className="flex items-center">
              {i > 0 ? (
                <div className={cn("mx-1 h-px w-3.5 sm:w-5", done || current ? "bg-primary/50" : "bg-border")} />
              ) : null}
              <div className={cn("flex items-center gap-1.5 rounded-full py-1", current && "bg-muted px-2")}>
                {done ? (
                  <CheckCircle2 className="size-3.5 shrink-0 text-green-600 dark:text-green-500" aria-hidden="true" />
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
                  {SURVEY_STATUS_LABEL[step]}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What is owed before this survey can move on — the server's own guard output,
 * printed.
 *
 * This replaced a paragraph that described the review and submit rules in
 * prose ("Only the lead can send a survey for review or submit it") at a time
 * when nothing in the UI could do either. Prose about a capability is worth
 * less than the capability's actual checklist, and this list comes from the
 * same `reviewGuard` / `submitGuard` the transition would run — so what it
 * says is owed IS what would refuse the move.
 *
 * WHICH GUARD depends on where the survey stands, because the review guard's
 * one rule ("no visit still open") is a blocker only once capture is under
 * way. On a scheduled survey an open visit is the plan, not a problem, so
 * before `in_progress` this looks PAST review to what completion will want —
 * muted, because none of it is due yet.
 */
function Readiness({
  status,
  readiness,
}: {
  status: SurveyStatus;
  readiness?: SurveyDetailResponse["readiness"];
}) {
  // A survey that has finished moving is not owed anything, and a response
  // from before the completion slice has nothing to say.
  if (!readiness || status === "completed" || status === "cancelled") return null;

  const atReview = status === "pending_review";
  const gate = atReview ? readiness.submit : readiness.review;
  // Before capture starts the review gate is not yet meaningful — see above.
  const forwardOnly = !atReview && status !== "in_progress";
  const items = forwardOnly ? readiness.submit.blockers : gate.blockers;
  const ready = items.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {ready && !forwardOnly ? (
          <CheckCircle2
            className="size-4 shrink-0 text-green-600 dark:text-green-500"
            aria-hidden="true"
          />
        ) : null}
        <span className={cn("text-sm font-medium", forwardOnly && "text-muted-foreground")}>
          {forwardOnly
            ? "Owed before this survey can complete"
            : ready
              ? atReview
                ? "Ready to complete"
                : "Ready to send for review"
              : atReview
                ? "Before this can complete"
                : "Before this can go for review"}
        </span>
      </div>

      {ready ? (
        <p className="text-muted-foreground text-xs">
          {forwardOnly
            ? "Nothing outstanding yet — the list fills in as nodes are seeded and questions come due."
            : "Everything the guard checks is settled. The lead makes the move."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm">
              <Circle
                className={cn(
                  "mt-1 size-3 shrink-0",
                  forwardOnly ? "text-muted-foreground/40" : "text-orange-500"
                )}
                aria-hidden="true"
              />
              <span className={forwardOnly ? "text-muted-foreground" : undefined}>{b}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Warnings are not blockers and never become them (D-S11): a survey
          with most of its site unvisited still completes. Showing them here
          rather than only in the confirm dialog means the lead can act on
          them while there is still time to. */}
      {readiness.submit.warnings.length ? (
        <ul className="mt-1 flex flex-col gap-1">
          {readiness.submit.warnings.map((w) => (
            <li key={w} className="text-muted-foreground flex items-start gap-2 text-xs">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-orange-500" aria-hidden="true" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-muted-foreground mt-1 text-xs">
        Completed is terminal — a re-walk is a new linked survey, never a reopen. Only the lead
        moves a survey through review.
      </p>
    </div>
  );
}

/**
 * The handoff: a completed survey becomes a priced proposal.
 *
 * THIS IS THE SEAM BETWEEN TWO LANES, and the frozen revision is the whole
 * contract across it — Proposal Spec §1 is literally "a Proposal turns a frozen
 * survey revision into priced lines using a rate card". A proposal raised
 * WITHOUT one is not a lesser version of this; it is a different thing, priced
 * by hand from nothing, with `line-generate` disabled for its whole life. So
 * this card only appears once there is a revision to hand over, and it hands
 * over that specific one rather than leaving the estimator to find it.
 *
 * It does not try to be the proposal screen. One button, then the user is in
 * the other lane, where somebody else's rules apply.
 */
function HandoffCard({
  detail,
  actor,
}: {
  detail: SurveyDetailResponse;
  actor: string;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // THE CURRENT ONE, with no fallback to "the newest". `survey.get` returns
  // every revision on the record, including one frozen beside a status change
  // that lost its race — those are written `is_current = 'false'` and promoted
  // only when the move lands, so `is_current` is the field that says "this is
  // what the survey actually completed as". Falling back to `revisions[0]`
  // would hand pricing an inert snapshot, and the proposal side filters the
  // same way, so the two paths agree on which revision is real.
  const current = detail.revisions?.find((r) => r.isCurrent === "true") ?? null;

  // Nothing to hand over until the survey has been completed and frozen.
  if (detail.survey.status !== "completed" || !current) return null;

  const raise = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    const { data, error: err } = await createProposalFromSurvey(
        detail.survey.dealId,
      current.id,
      actor,
      detail.survey.title ?? undefined
    );

    setBusy(false);
    if (err || !data?.proposal) {
      setError(err ?? "The proposal was not created");
      return;
    }
    navigate(`/proposals/${data.proposal.id}`);
  };

  return (
    <Card title="Hand off to pricing">
      <p className="text-muted-foreground -mt-1 mb-3 text-sm">
        This survey is frozen at revision v{current.revisionNo}. A proposal raised from it prices
        itself from what was actually found — quantities, condition scores and the exclusions
        above. Raised without it, every line is priced by hand.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={raise} disabled={busy}>
          <FileSignature className="size-4" />
          {busy ? "Creating…" : "Create proposal"}
        </Button>
        <span className="text-muted-foreground text-xs">
          Frozen {current.frozenAt ? ago(current.frozenAt) : "on completion"}
        </span>
      </div>
      {error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}
    </Card>
  );
}

/**
 * The exclusions that will print on the proposal.
 *
 * These are not notes — `proposal.ts` renders this list onto the document the
 * client reads, which is why they are worth a person's attention here rather
 * than being discovered at print time. Most are generated: a seeded node nobody
 * reached and a required question left blank each produce one automatically at
 * the freeze, and both disappear again if a rework closes the gap. What someone
 * types stays until they remove it.
 *
 * The generated/typed split is shown, because it tells the reader which lines
 * they can fix by finishing the survey and which they own.
 */
function QualificationsCard({
  detail,
  actor,
  terminal,
  onChanged,
}: {
  detail: SurveyDetailResponse;
  actor: string;
  terminal: boolean;
  onChanged: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await addQualification(detail.survey.id, text.trim(), actor);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setText("");
    onChanged();
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await removeQualification(id, actor);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onChanged();
  };

  const items = detail.qualifications ?? [];

  return (
    <Card title="Exclusions">
      <p className="text-muted-foreground -mt-1 mb-3 text-xs">
        Printed on the proposal, in these words. Generated ones are rebuilt every time the survey
        is frozen.
      </p>

      {items.length ? (
        <ul className="mb-3 flex flex-col gap-2">
          {items.map((q) => (
            <li key={q.id} className="flex items-start gap-2">
              <span className="min-w-0 flex-1 text-sm">
                {q.text}
                {q.generatedAutomatically === "true" ? (
                  <span className="text-muted-foreground ml-2 text-xs">generated</span>
                ) : null}
              </span>
              {/* Only what a person wrote can be withdrawn by hand — removing a
                  generated one would just bring it back at the next freeze, so
                  the way to clear it is to close the gap that caused it. */}
              {!terminal && q.generatedAutomatically !== "true" ? (
                <button
                  type="button"
                  onClick={() => remove(q.id)}
                  disabled={busy}
                  aria-label="Remove this exclusion"
                  className="text-muted-foreground hover:text-destructive shrink-0 transition-colors"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mb-3 text-sm">
          None yet. Anything the survey could not establish becomes one when it is frozen.
        </p>
      )}

      {!terminal ? (
        <form onSubmit={add} className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add an exclusion"
            aria-label="New exclusion"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!text.trim() || busy}>
            Add
          </Button>
        </form>
      ) : null}

      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
    </Card>
  );
}

/** One number in the progress band: quiet label, loud value, optional footnote. */
function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div> : null}
    </div>
  );
}

function OverviewTab({
  detail,
  actor,
  terminal,
  onChanged,
}: {
  detail: SurveyDetailResponse;
  actor: string;
  terminal: boolean;
  onChanged: () => void;
}) {
  const s = detail.survey;
  const snapshot = detail.snapshot;
  const pct = s.completenessPct;
  const notVisited = s.notVisitedPct;
  const overdue =
    Boolean(s.targetCompletionDate) &&
    s.status !== "completed" &&
    s.status !== "cancelled" &&
    new Date(s.targetCompletionDate as string).getTime() < Date.now();

  return (
    <Split>
      {/* The walk's state of play — position on the trail, then the numbers.
          The handoff leads when there is one: on a completed survey the next
          thing anybody does is price it, and burying that under the trail
          would make the finished state look like a dead end. */}
      <Stack>
        <HandoffCard detail={detail} actor={actor} />

        <Card title="Progress">
          <TrailStepper status={s.status} />

          <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
            <Tile
              label="Completeness"
              value={
                pct !== null && pct !== undefined ? (
                  `${pct}%`
                ) : (
                  <span className="text-muted-foreground text-sm font-normal">Not measured</span>
                )
              }
              sub={
                pct !== null && pct !== undefined ? (
                  <span className="bg-muted mt-1 block h-1.5 overflow-hidden rounded-full">
                    <span className="bg-primary block h-full rounded-full" style={{ width: `${pct}%` }} />
                  </span>
                ) : (
                  "starts with capture"
                )
              }
            />
            <Tile
              // Null is NOT zero: null means nothing was seeded, so coverage
              // could not be measured. Zero not-visited means fully walked.
              label="Coverage"
              value={
                notVisited !== null && notVisited !== undefined ? (
                  `${100 - notVisited}%`
                ) : (
                  <span className="text-muted-foreground text-sm font-normal">Not measured</span>
                )
              }
              sub={
                notVisited !== null && notVisited !== undefined
                  ? "of seeded nodes walked"
                  : "no nodes seeded"
              }
            />
            <Tile
              label="Visits"
              value={detail.visits.length}
              sub={plural(detail.assignees.length, "person assigned", "people assigned")}
            />
            <Tile
              label="Revision"
              value={`v${s.revisionNo ?? 1}`}
              sub={s.reworkCount ? `${plural(s.reworkCount, "rework bounce", "rework bounces")}` : "no rework"}
            />
          </div>

          <div className="mt-4 border-t pt-4">
            <Readiness status={s.status} readiness={detail.readiness} />
          </div>
        </Card>
      </Stack>

      {/* The record's facts, off to the side where they read as reference. */}
      <Stack>
        <Card title="Details">
          <Facts
            items={[
              { label: "Status", value: <SurveyStatusChip status={s.status} /> },
              { label: "Account", value: s.accountName },
              {
                label: "Template",
                value: s.templateName
                  ? `${s.templateName}${s.templateVersionNo ? ` · v${s.templateVersionNo}` : ""}`
                  : "Started from scratch",
              },
              {
                label: "Snapshot",
                value:
                  snapshot && (snapshot.sections || snapshot.questions)
                    ? `${snapshot.sections} sections · ${snapshot.questions} questions`
                    : s.status === "draft"
                      ? "Copied when the first visit is scheduled"
                      : null,
              },
              { label: "Lead", value: s.leadUserEmail ?? "Not assigned yet" },
              {
                label: "Contract intent",
                value: s.contractIntent ? humanise(s.contractIntent) : null,
              },
              {
                label: "Target completion",
                value: s.targetCompletionDate ? (
                  <span className={overdue ? "text-destructive font-medium" : undefined}>
                    {onDay(s.targetCompletionDate)}
                    {overdue ? " · overdue" : ""}
                  </span>
                ) : null,
              },
              { label: "Created", value: s.createdAt ? when(s.createdAt) : null },
            ]}
          />
        </Card>

        <QualificationsCard
          detail={detail}
          actor={actor}
          terminal={terminal}
          onChanged={onChanged}
        />
      </Stack>
    </Split>
  );
}

function VisitsTab({
  detail,
  actor,
  terminal,
  onChanged,
}: {
  detail: SurveyDetailResponse;
  actor: string;
  terminal: boolean;
  onChanged: () => void;
}) {
  /** The visit awaiting a no-show reason; done needs none and fires directly. */
  const [noShowFor, setNoShowFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = async (visitId: string, toStatus: string, why: string) => {
    setBusy(true);
    setError(null);
    const { error: err } = await transitionVisit(visitId, toStatus, why, actor);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setNoShowFor(null);
    setReason("");
    onChanged();
  };

  if (!detail.visits.length) {
    return (
      <Card pad={false}>
        <Empty
          title="No visits"
          body="A visit is an appointment with a start and an end, so a two-day tender walk is one visit and not two. A no-show is recorded with a reason and deliberately does not move the survey forward."
        />
      </Card>
    );
  }

  return (
    <Card pad={false}>
      {detail.visits.map((v) => (
        <div key={v.id} className="flex flex-col gap-2 border-b px-4 py-3.5 last:border-b-0">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <span className="bg-muted flex h-6 shrink-0 items-center rounded-md px-2 font-mono text-xs font-medium">
              {v.visitNumber}
            </span>
            <VisitStatusChip status={v.status} />

            {/* The appointment reads as a stack: when on top, who and where
                beneath — one wrapping line buried the times among the meta. */}
            <div className="flex min-w-0 flex-1 basis-52 flex-col gap-0.5">
              <span className="text-sm font-medium">
                {v.scheduledStart ? when(v.scheduledStart) : "Unscheduled"}
                {v.scheduledEnd ? ` → ${when(v.scheduledEnd)}` : ""}
              </span>
              {v.timezone || v.siteContactName ? (
                <span className="text-muted-foreground text-xs">
                  {[
                    v.timezone,
                    v.siteContactName
                      ? `meets ${v.siteContactName}${v.siteContactPhone ? ` · ${v.siteContactPhone}` : ""}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
              {v.noShowReason ? (
                <span className="text-destructive text-xs">No-show: {v.noShowReason}</span>
              ) : null}
            </div>

            {/* The two lifecycle moves the desk makes. Marking done closes the
                appointment; a no-show records the wasted trip WITHOUT moving
                the survey — that distinction is F13, and it is load-bearing. */}
            {!terminal && v.status === "in_progress" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => move(v.id, "done", "")}
              >
                Mark done
              </Button>
            ) : null}
            {!terminal && v.status === "planned" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setNoShowFor(noShowFor === v.id ? null : v.id)}
              >
                No-show
              </Button>
            ) : null}
          </div>

          {noShowFor === v.id ? (
            <div className="flex flex-wrap items-center gap-2 pl-1">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why nobody could walk — kept on the record"
                className="max-w-96"
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={!reason.trim() || busy}
                onClick={() => move(v.id, "no_show", reason.trim())}
              >
                {busy ? "Recording…" : "Record no-show"}
              </Button>
            </div>
          ) : null}
        </div>
      ))}
      {error ? <p className="text-destructive px-4 py-2 text-sm">{error}</p> : null}
    </Card>
  );
}

function PhotosTab({ detail }: { detail: SurveyDetailResponse }) {
  if (!detail.photos?.length) {
    return (
      <Card pad={false}>
        <Empty
          title="No photos yet"
          body="Every photo taken on the walk lands here with the room it evidences, the device's capture time and the geotag — the chain a qualification defence rests on."
        />
      </Card>
    );
  }

  return (
    <Card pad={false}>
      <PhotoGallery photos={detail.photos} entryLabels={detail.entryLabels ?? []} />
    </Card>
  );
}

function ActivityTab({ detail }: { detail: SurveyDetailResponse }) {
  if (!detail.events?.length) {
    return (
      <Card pad={false}>
        <Empty
          title="No activity"
          body="Every status change, assignment, lead handover and capture lands here, newest first."
        />
      </Card>
    );
  }

  return (
    <Card pad={false}>
      {/* A timeline, not a table: the rail says these rows are one story in
          order, and the dots give the eye a spine to run down. */}
      <div className="flex flex-col px-4 py-4">
        {detail.events.map((e, i) => (
          <div key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < (detail.events?.length ?? 0) - 1 ? (
              <span className="bg-border absolute top-4 bottom-0 left-[5px] w-px" aria-hidden="true" />
            ) : null}
            <span
              className="border-muted-foreground/40 bg-background mt-1.5 size-[11px] shrink-0 rounded-full border-2"
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-sm font-medium">{humaniseKind(e.kind)}</span>
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

const humaniseKind = (kind: string): string =>
  ({
    created: "Created",
    status_change: "Status change",
    lead_handover: "Lead handover",
    assigned: "Assigned",
    capture: "Capture",
    scheduled: "Visit scheduled",
    rescheduled: "Visit rescheduled",
    photo: "Photo attached",
  })[kind] ?? kind.replace(/_/g, " ");

function TeamTab({ detail }: { detail: SurveyDetailResponse }) {
  if (!detail.assignees.length) {
    return (
      <Card pad={false}>
        <Empty
          title="No one assigned"
          body="A survey carries any number of assignees and exactly one lead. Only the lead can send it for review or submit it. Assigning arrives with the next backend slice."
        />
      </Card>
    );
  }

  return (
    <Card pad={false}>
      {detail.assignees.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-4 border-b px-4 py-3 last:border-b-0">
          <span className="text-sm font-medium">{a.userEmail}</span>
          <span className="text-muted-foreground text-xs">{a.participation ?? "surveyor"}</span>
          {detail.survey.leadUserEmail === a.userEmail ? (
            <span className="text-xs font-medium">lead</span>
          ) : null}
        </div>
      ))}
    </Card>
  );
}

/** Seeded means somebody claimed this existed BEFORE the walk — the only
    nodes a verdict is owed on, and the only ones the handler will accept one
    for. Mirrors `isSeeded` in domain/reconcile.ts and the provenance filter in
    `surveyCounts`; all three have to agree or the guard counts a set the
    screen cannot act on. */
const isSeeded = (provenance: string): boolean => provenance === "rfp" || provenance === "crm";

/** The three that contradict the paperwork, and so must say what was found. */
const VERDICT_NEEDS_NOTE = new Set<NodeVerdict>(["changed", "not_found", "not_visited"]);

const VERDICT_CHOICES: NodeVerdict[] = ["verified", "changed", "not_found", "not_visited"];

function PortfolioTab({
  detail,
  actor,
  terminal,
  onChanged,
}: {
  detail: SurveyDetailResponse;
  actor: string;
  terminal: boolean;
  onChanged: () => void;
}) {
  /** The node whose verdict is being recorded — null when no dialog is open. */
  const [verdicting, setVerdicting] = useState<ProspectNode | null>(null);
  const [importing, setImporting] = useState(false);

  const importer = (
    <NodeImportDialog
      open={importing}
      onOpenChange={setImporting}
      surveyId={detail.survey.id}
      actor={actor}
      onDone={onChanged}
    />
  );

  if (!detail.nodes.length) {
    return (
      <Stack>
        <Card pad={false}>
          <Empty
            title="Nothing claimed, nothing found"
            body="Seed the tree the tender documents describe and each node arrives awaiting a verdict — which is what coverage is measured against and what the surveyor's findings are compared to. Rooms found on site are added as the walk goes."
            action={
              !terminal ? (
                <Button onClick={() => setImporting(true)}>
                  <Upload className="size-4" />
                  Seed from tender documents
                </Button>
              ) : undefined
            }
          />
        </Card>
        {importer}
      </Stack>
    );
  }

  const owed = detail.nodes.filter((n) => isSeeded(n.provenance) && n.verdict === "unverified").length;

  return (
    <Stack>
      {owed ? (
        <Card>
          <p className="text-sm">
            <strong className="font-medium">
              {plural(owed, "node still has", "nodes still have")} no verdict.
            </strong>{" "}
            <span className="text-muted-foreground">
              Every node the tender documents claimed needs one before the survey can complete —
              it is how the estimator learns what was actually there.
            </span>
          </p>
        </Card>
      ) : null}

      <Card pad={false}>
        {detail.nodes.map((n) => {
          const seeded = isSeeded(n.provenance);
          return (
            <div
              key={n.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-sm font-medium">{n.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">{n.type}</span>
                  {n.areaSqft ? (
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {n.areaSqft} sqft
                    </span>
                  ) : null}
                </div>
                {/* The note is the whole value of a contradicting verdict, so
                    it is shown, not hidden behind the row. */}
                {n.verdictNote ? (
                  <span className="text-muted-foreground text-xs">{n.verdictNote}</span>
                ) : null}
              </div>

              <VerdictChip verdict={n.verdict} />

              {/* Offered only where it MEANS something. A capture-created node
                  carries `added_on_site` as a record of how it came to exist,
                  and the handler refuses to overwrite it — so a button here
                  would be a button that only ever errors. */}
              {seeded && !terminal ? (
                <Button size="sm" variant="outline" onClick={() => setVerdicting(n)}>
                  {n.verdict === "unverified" ? "Record verdict" : "Change"}
                </Button>
              ) : null}
            </div>
          );
        })}
      </Card>

      {!terminal ? (
        <div>
          <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
            <Upload className="size-4" />
            Seed more from the documents
          </Button>
        </div>
      ) : null}

      <NodeVerdictDialog
        node={verdicting}
        onOpenChange={(open) => !open && setVerdicting(null)}
        actor={actor}
        onDone={onChanged}
      />
      {importer}
    </Stack>
  );
}

type ImportRow = {
  name: string;
  nodeType: string;
  parentName: string;
  areaSqft: string;
  roomCount: string;
  restroomCount: string;
};

const BLANK_ROW: ImportRow = {
  name: "",
  nodeType: "space",
  parentName: "",
  areaSqft: "",
  roomCount: "",
  restroomCount: "",
};

/**
 * The tender documents' building list, typed in.
 *
 * A form rather than a file upload, deliberately: there is no RFP parser and
 * pretending otherwise would mean an importer that silently mangles whatever it
 * cannot read. Typed rows are slow and honest, and the numbers matter more than
 * the speed — every figure entered here becomes the CLAIMED side of a
 * comparison, so a wrong one shows up later as a disagreement that never
 * happened.
 *
 * Parents are named, not picked: ids derive from names on the server, so a row
 * may name a parent listed after it, and re-importing a corrected list lands on
 * the same nodes instead of doubling them.
 */
function NodeImportDialog({
  open,
  onOpenChange,
  surveyId,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surveyId: string;
  actor: string;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<ImportRow[]>([{ ...BLANK_ROW }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRows([{ ...BLANK_ROW }]);
      setError(null);
    }
  }, [open]);

  const patch = (i: number, next: Partial<ImportRow>) =>
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...next } : r)));

  const named = rows.filter((r) => r.name.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !named.length) return;
    setBusy(true);
    setError(null);

    // Blank stays blank: an empty box is "the documents did not say", which is
    // different from zero. Sending 0 would invent a claim to disagree with.
    const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

    const { error: err } = await importNodes(
      surveyId,
      named.map((r) => ({
        name: r.name.trim(),
        nodeType: r.nodeType,
        ...(r.parentName.trim() ? { parentName: r.parentName.trim() } : {}),
        ...(num(r.areaSqft) !== undefined ? { areaSqft: num(r.areaSqft) } : {}),
        ...(num(r.roomCount) !== undefined ? { roomCount: num(r.roomCount) } : {}),
        ...(num(r.restroomCount) !== undefined ? { restroomCount: num(r.restroomCount) } : {}),
      })),
      actor
    );

    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Seed from the tender documents</DialogTitle>
            <DialogDescription>
              What the documents claimed exists, before anybody walks it. Each row becomes a node
              awaiting a verdict, and every figure becomes something the surveyor’s findings can
              disagree with.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[50vh] gap-3 overflow-y-auto py-4">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                <Input
                  className="sm:col-span-2"
                  value={row.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  placeholder="Name"
                  aria-label={`Node ${i + 1} name`}
                />
                <select
                  value={row.nodeType}
                  onChange={(e) => patch(i, { nodeType: e.target.value })}
                  aria-label={`Node ${i + 1} type`}
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                >
                  <option value="site">Site</option>
                  <option value="building">Building</option>
                  <option value="space">Space</option>
                </select>
                <Input
                  value={row.parentName}
                  onChange={(e) => patch(i, { parentName: e.target.value })}
                  placeholder="Inside"
                  aria-label={`Node ${i + 1} parent`}
                />
                <Input
                  value={row.areaSqft}
                  onChange={(e) => patch(i, { areaSqft: e.target.value })}
                  placeholder="sqft"
                  inputMode="numeric"
                  aria-label={`Node ${i + 1} area`}
                />
                <Input
                  value={row.restroomCount}
                  onChange={(e) => patch(i, { restroomCount: e.target.value })}
                  placeholder="WCs"
                  inputMode="numeric"
                  aria-label={`Node ${i + 1} restrooms`}
                />
              </div>
            ))}

            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRows((l) => [...l, { ...BLANK_ROW }])}
              >
                Add another
              </Button>
            </div>

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !named.length}>
              {busy ? "Importing…" : `Import ${plural(named.length, "node", "nodes")}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One node's verdict, with the note the contradicting ones require.
 *
 * The note requirement is enforced here AND server-side, and the duplication is
 * deliberate: a disabled button explains the rule while there is still time to
 * satisfy it, where an error after the fact only reports it.
 */
function NodeVerdictDialog({
  node,
  onOpenChange,
  actor,
  onDone,
}: {
  node: ProspectNode | null;
  onOpenChange: (open: boolean) => void;
  actor: string;
  onDone: () => void;
}) {
  const [verdict, setVerdict] = useState<NodeVerdict>("verified");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (node) {
      setVerdict(node.verdict === "unverified" ? "verified" : node.verdict);
      setNote(node.verdictNote ?? "");
      setError(null);
    }
  }, [node]);

  if (!node) return null;
  const needsNote = VERDICT_NEEDS_NOTE.has(verdict);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || (needsNote && !note.trim())) return;
    setBusy(true);
    setError(null);

    const { error: err } = await setNodeVerdict(node.id, verdict, note.trim(), actor);

    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{node.name}</DialogTitle>
            <DialogDescription>
              What the surveyor found, against what the tender documents claimed.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label>Verdict</Label>
              <div className="flex flex-wrap gap-1.5">
                {VERDICT_CHOICES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={v === verdict}
                    onClick={() => setVerdict(v)}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      v === verdict
                        ? "border-primary bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {VERDICT_LABEL[v]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nv-note">
                Note{needsNote ? "" : <span className="text-muted-foreground"> (optional)</span>}
              </Label>
              <Textarea
                id="nv-note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  needsNote
                    ? "What was found instead — this is what the estimator reads"
                    : "Anything worth recording"
                }
              />
              {needsNote ? (
                <p className="text-muted-foreground text-xs">
                  A “{VERDICT_LABEL[verdict]}” verdict contradicts the tender documents, so it has
                  to say what was found instead.
                </p>
              ) : null}
            </div>

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || (needsNote && !note.trim())}>
              {busy ? "Saving…" : "Save verdict"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const DIFF_LABEL: Record<string, string> = {
  value_conflict: "Value conflict",
  node_not_found: "Not found on site",
  node_added: "Found on site",
  count_mismatch: "Count mismatch",
  unanswered_required: "Required question blank",
  intra_survey_conflict: "Surveyors disagree",
};

const DECISION_LABEL: Record<string, string> = {
  accept_survey: "Use what the surveyor found",
  accept_rfp: "Use what the documents said",
  manual: "Use a different value",
  exclude: "Exclude from the proposal",
};

/**
 * Every disagreement between the tender documents and the walk, and the one
 * screen where a person closes them.
 *
 * TWO THINGS THIS SURFACE MUST NOT IMPLY. First, that an empty list means
 * nothing disagrees: three of the six diff types compare the documents' own
 * figures against site observations, and nothing in this build imports those
 * figures, so those comparisons cannot run at all. The banner says which,
 * because "no differences found" over a check that never ran is the most
 * expensive kind of reassurance. Second, that the app decided anything — every
 * row arrives open with a SUGGESTION and a reason, and stays open until a
 * person picks (D-S2).
 */
function ReconciliationTab({
  detail,
  actor,
  terminal,
  onChanged,
}: {
  detail: SurveyDetailResponse;
  actor: string;
  terminal: boolean;
  onChanged: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState<string[]>([]);
  const [deciding, setDeciding] = useState<ReconciliationItem | null>(null);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    const { data, error: err } = await runReconcile(detail.survey.id, actor);
    setRunning(false);
    if (err) {
      setError(err);
      return;
    }
    setUnreachable(data?.unreachable ?? []);
    onChanged();
  };

  const open = detail.reconciliation.filter((r) => r.status === "open");

  return (
    <Stack>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-medium">
              {open.length
                ? `${plural(open.length, "difference", "differences")} waiting on a decision`
                : detail.reconciliation.length
                  ? "Every difference has been decided"
                  : "No differences recorded yet"}
            </span>
            <span className="text-muted-foreground text-xs">
              The diff is deterministic and safe to re-run — it updates what it found last time
              and never touches a row you have already closed.
            </span>
          </div>
          {!terminal ? (
            <Button size="sm" variant="outline" onClick={run} disabled={running}>
              <RefreshCw className={cn("size-4", running && "animate-spin")} />
              {running ? "Running…" : "Run the diff"}
            </Button>
          ) : null}
        </div>

        {error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}

        {unreachable.length ? (
          <p className="text-muted-foreground mt-3 flex items-start gap-2 border-t pt-3 text-xs">
            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-orange-500" aria-hidden="true" />
            <span>
              This run could not check{" "}
              {unreachable.map((u) => DIFF_LABEL[u] ?? u).join(", ").toLowerCase()} — those
              compare the tender documents’ own figures against the walk, and no document import
              has put those figures on the record. Treat a clean result as “nothing found among
              what we can check”.
            </span>
          </p>
        ) : null}
      </Card>

      {detail.reconciliation.length ? (
        <Card pad={false}>
          {detail.reconciliation.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-medium">{DIFF_LABEL[r.diffType] ?? r.diffType}</span>
                {r.status === "open" ? (
                  <Chip tone="orange" small>
                    open
                  </Chip>
                ) : (
                  <Chip tone="green" small>
                    decided
                  </Chip>
                )}
                {r.fieldKey ? (
                  <span className="text-muted-foreground text-xs">{humanise(r.fieldKey)}</span>
                ) : null}
              </div>

              {/* The two sides, side by side — the whole point of the row. */}
              {r.rfpValue || r.surveyValue ? (
                <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
                  <span>
                    Documents: <span className="text-foreground">{r.rfpValue ?? "—"}</span>
                  </span>
                  <span>
                    Surveyor: <span className="text-foreground">{r.surveyValue ?? "—"}</span>
                  </span>
                </div>
              ) : null}

              {r.suggestionBasis ? (
                <p className="text-muted-foreground text-xs">{r.suggestionBasis}</p>
              ) : null}

              {r.status === "open" ? (
                !terminal ? (
                  <div>
                    <Button size="sm" variant="outline" onClick={() => setDeciding(r)}>
                      Decide
                    </Button>
                  </div>
                ) : null
              ) : (
                <p className="text-xs">
                  <span className="font-medium">
                    {DECISION_LABEL[r.decision ?? ""] ?? r.decision}
                  </span>
                  {r.decisionNote ? (
                    <span className="text-muted-foreground"> — {r.decisionNote}</span>
                  ) : null}
                </p>
              )}
            </div>
          ))}
        </Card>
      ) : (
        <Card pad={false}>
          <Empty
            title="Nothing to reconcile yet"
            body="Run the diff to compare what the tender documents claimed against what the surveyor found. The app suggests a value and a reason; you decide every row."
          />
        </Card>
      )}

      <ReconcileDecideDialog
        item={deciding}
        onOpenChange={(o) => !o && setDeciding(null)}
        actor={actor}
        onDone={onChanged}
      />
    </Stack>
  );
}

/** One row, closed by a person. The app never writes a decision (D-S2). */
function ReconcileDecideDialog({
  item,
  onOpenChange,
  actor,
  onDone,
}: {
  item: ReconciliationItem | null;
  onOpenChange: (open: boolean) => void;
  actor: string;
  onDone: () => void;
}) {
  const [decision, setDecision] = useState("accept_survey");
  const [manualValue, setManualValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setDecision("accept_survey");
      setManualValue("");
      setNote("");
      setError(null);
    }
  }, [item]);

  if (!item) return null;
  const needsValue = decision === "manual";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || (needsValue && !manualValue.trim())) return;
    setBusy(true);
    setError(null);

    const { error: err } = await decideReconcileItem(
      item.id,
      decision,
      manualValue.trim(),
      note.trim(),
      actor
    );

    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{DIFF_LABEL[item.diffType] ?? item.diffType}</DialogTitle>
            <DialogDescription>{item.suggestionBasis}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label>Decision</Label>
              <div className="flex flex-col gap-1">
                {Object.entries(DECISION_LABEL).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={key === decision}
                    onClick={() => setDecision(key)}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      key === decision
                        ? "border-primary bg-muted"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        key === decision ? "bg-primary" : "bg-muted-foreground/30"
                      )}
                      aria-hidden="true"
                    />
                    {label}
                    {/* Named where it is, so nobody has to hold the row's
                        suggestion in their head while choosing. */}
                    {key === "accept_survey" && item.surveyValue ? (
                      <span className="text-muted-foreground text-xs">— {item.surveyValue}</span>
                    ) : null}
                    {key === "accept_rfp" && item.rfpValue ? (
                      <span className="text-muted-foreground text-xs">— {item.rfpValue}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            {needsValue ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rd-value">Value to use</Label>
                <Input
                  id="rd-value"
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  placeholder="What the estimator should price against"
                />
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rd-note">
                Note <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="rd-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why this is the right call"
              />
            </div>

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || (needsValue && !manualValue.trim())}>
              {busy ? "Saving…" : "Record decision"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

function ScheduleVisitDialog({
  open,
  onOpenChange,
  surveyId,
  actor,
  isFirst,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surveyId: string;
  actor: string;
  isFirst: boolean;
  onDone: () => void;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStart("");
      setEnd("");
      setContact("");
      setError(null);
    }
  }, [open]);

  /** Offers an end two hours out; see the note in NewSurveyDialog. */
  const pickStart = (next: string) => {
    setStart(next);
    if (!next) return setEnd("");
    if (!end || end <= next) setEnd(plusHours(next, 2));
  };

  const endBeforeStart = Boolean(start && end && end <= start);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!start || endBeforeStart || busy) return;
    setBusy(true);
    setError(null);

    const { error: err } = await scheduleVisit(surveyId, {
      scheduledStart: new Date(start).toISOString(),
      ...(end ? { scheduledEnd: new Date(end).toISOString() } : {}),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(contact.trim() ? { siteContactName: contact.trim() } : {}),
      actorEmail: actor,
    });

    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{isFirst ? "Schedule the first visit" : "Add a visit"}</DialogTitle>
            <DialogDescription>
              {isFirst
                ? "Scheduling moves the survey out of draft and copies the template snapshot — later template edits never reach this survey."
                : "Another appointment on the same survey — a two-day walk is one visit, a second trip is a new one."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Stacked on a phone — two date-and-time fields don't fit a 390px
                dialog side by side. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="sv-start">Starts</Label>
                <DateTimeField id="sv-start" value={start} onChange={pickStart} />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="sv-end">Ends</Label>
                <DateTimeField id="sv-end" value={end} onChange={setEnd} disabled={!start} />
              </div>
            </div>
            {endBeforeStart ? (
              <p className="text-destructive text-xs">The end has to come after the start.</p>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sv-contact">Site contact</Label>
              <Input
                id="sv-contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Who meets the surveyor"
              />
            </div>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!start || busy}>
              {busy ? "Scheduling…" : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({
  open,
  onOpenChange,
  surveyId,
  actor,
  hasLead,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surveyId: string;
  actor: string;
  hasLead: boolean;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [makeLead, setMakeLead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail("");
      // The first assignee is almost always the lead — default accordingly.
      setMakeLead(!hasLead);
      setError(null);
    }
  }, [open, hasLead]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address.includes("@") || busy) return;
    setBusy(true);
    setError(null);

    const { data, error: err } = await assignSurveyors(
      surveyId,
      [{ userEmail: address, participation: "surveyor" }],
      actor
    );
    if (err || !data) {
      setBusy(false);
      setError(err ?? "The assignment did not land");
      return;
    }

    if (makeLead) {
      const assignee = data.assignees.find((a) => a.userEmail === address);
      if (assignee) {
        const { error: leadErr } = await setLead(surveyId, assignee.id, "", actor);
        if (leadErr) {
          setBusy(false);
          setError(leadErr);
          return;
        }
      }
    }

    setBusy(false);
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Assign a surveyor</DialogTitle>
            <DialogDescription>
              A survey carries any number of assignees and exactly one lead. Setting the first lead
              moves a scheduled survey to assigned — which is what opens the walk for capture.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="as-email">Email</Label>
              <Input
                id="as-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="surveyor@facilio.com"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={makeLead}
                onChange={(e) => setMakeLead(e.target.checked)}
                className="size-4"
              />
              Make them the lead
            </label>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!email.trim().includes("@") || busy}>
              {busy ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The three moves that finish a survey, in one dialog because they are one
 * shape: confirm a lifecycle change, show what the server would refuse, and
 * take a reason when the move destroys or repeats work.
 *
 * T5 `in_progress → pending_review`   Send for review
 * T6 `pending_review → in_progress`   Send back for rework — reason mandatory
 * T7 `pending_review → completed`     Complete — terminal
 *
 * All three go through `survey.transition`; there is no `submit` handler.
 * BLOCKERS ARE SHOWN, NOT JUST OBEYED: the same guard runs server-side and
 * would refuse the call, but a button that fails on click teaches nothing,
 * whereas the list tells the lead what to go and fix. The button stays
 * disabled while any blocker stands — and the server is still the authority,
 * because this list can be stale by the time it is read.
 */
type LifecycleMove = "pending_review" | "in_progress" | "completed";

const MOVE_COPY: Record<
  LifecycleMove,
  { title: string; body: string; confirm: string; busy: string; destructive?: boolean; needsReason?: boolean }
> = {
  pending_review: {
    title: "Send this survey for review",
    body: "Capture closes and the survey waits for the lead's review. It can still be sent back for rework afterwards.",
    confirm: "Send for review",
    busy: "Sending…",
  },
  in_progress: {
    title: "Send this survey back for rework",
    body: "Capture reopens and the bounce is counted on the record. The reason is what the surveyor will read, so make it the thing that needs fixing.",
    confirm: "Send back",
    busy: "Sending back…",
    needsReason: true,
  },
  completed: {
    title: "Complete this survey",
    body: "Completed is terminal. The survey cannot be reopened — a re-walk is a new linked survey — and the estimator prices from what is on it now.",
    confirm: "Complete survey",
    busy: "Completing…",
    destructive: true,
  },
};

function LifecycleDialog({
  move,
  onOpenChange,
  surveyId,
  actor,
  gate,
  onDone,
}: {
  /** Null when closed — the move IS the open state, so the copy can never
      belong to a different move than the one about to fire. */
  move: LifecycleMove | null;
  onOpenChange: (open: boolean) => void;
  surveyId: string;
  actor: string;
  gate?: { blockers: string[]; warnings: string[] };
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (move) {
      setReason("");
      setError(null);
    }
  }, [move]);

  if (!move) return null;
  const copy = MOVE_COPY[move];
  // Rework has no gate of its own — bouncing a survey back is always allowed.
  const blockers = copy.needsReason ? [] : (gate?.blockers ?? []);
  const warnings = copy.needsReason ? [] : (gate?.warnings ?? []);
  const blocked = blockers.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || blocked) return;
    if (copy.needsReason && !reason.trim()) return;
    setBusy(true);
    setError(null);

    const { error: err } = await transitionSurvey(surveyId, move, reason.trim(), actor);

    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.body}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {blocked ? (
              <div className="flex flex-col gap-2 rounded-md border p-3">
                <span className="text-sm font-medium">Not yet — this is outstanding:</span>
                <ul className="flex flex-col gap-1.5">
                  {blockers.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm">
                      <Circle className="mt-1 size-3 shrink-0 text-orange-500" aria-hidden="true" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Shown even when the move is allowed — that is the whole point of
                a warning: it goes ahead, and the person should know what they
                took with them. It lands on the audit trail either way. */}
            {!blocked && warnings.length ? (
              <ul className="flex flex-col gap-1.5">
                {warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2 text-sm">
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0 text-orange-500"
                      aria-hidden="true"
                    />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {copy.needsReason ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lc-reason">Reason</Label>
                <Textarea
                  id="lc-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="What has to be redone"
                />
              </div>
            ) : null}

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                {blocked ? "Close" : "Not now"}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant={copy.destructive ? "destructive" : "default"}
              disabled={busy || blocked || (copy.needsReason && !reason.trim())}
            >
              {busy ? copy.busy : copy.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The record's own fields. Status is conspicuously absent — it moves through
 * the lifecycle actions, and a status editable from a form is a state machine
 * with a back door.
 */
function EditSurveyDialog({
  open,
  onOpenChange,
  survey,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  survey: SurveyDetailResponse["survey"];
  actor: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(survey.title ?? "");
      // The input wants a bare date; the record carries a full timestamp.
      setTarget((survey.targetCompletionDate ?? "").slice(0, 10));
      setNotes("");
      setError(null);
    }
  }, [open, survey]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const { error: err } = await updateSurvey(
      survey.id,
      { title, targetCompletionDate: target, ...(notes.trim() ? { notes } : {}) },
      actor
    );

    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Edit this survey</DialogTitle>
            <DialogDescription>
              What it is called and when it is wanted by. Status moves through the actions in the
              header, never through a form.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="es-title">Title</Label>
              <Input
                id="es-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What this survey is called"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="es-target">Target completion</Label>
              <Input
                id="es-target"
                type="date"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Clear it to remove the date. Overdue is shown on the record, never enforced.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="es-notes">
                Notes <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="es-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Desk notes on this survey"
              />
            </div>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CancelSurveyDialog({
  open,
  onOpenChange,
  surveyId,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surveyId: string;
  actor: string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || busy) return;
    setBusy(true);
    setError(null);

    const { error: err } = await transitionSurvey(surveyId, "cancelled", reason.trim(), actor);

    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Cancel this survey</DialogTitle>
            <DialogDescription>
              Cancelled is terminal — the survey cannot be revived, and a new walk means a new
              survey. The reason is kept on the record.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cs-reason">Reason</Label>
              <Textarea
                id="cs-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why the survey is being cancelled"
              />
            </div>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Keep survey
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={!reason.trim() || busy}>
              {busy ? "Cancelling…" : "Cancel survey"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
