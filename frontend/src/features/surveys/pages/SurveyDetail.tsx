/**
 * The survey record — live against `survey.get`, one batched query.
 *
 * The tabs mirror the four questions actually asked of a survey: when is the
 * walk, who is doing it, what did they find, and what disagrees with the tender
 * documents. Team, Portfolio and Reconciliation render real empty states until
 * their backend slice lands (assign / capture / reconcile are not built yet) —
 * the states are the truth, not placeholders.
 *
 * Two actions live here and both go through the state machine server-side:
 * Schedule (T2 on a draft — the moment the template snapshot is copied) and
 * Cancel (T8, reason mandatory). The UI disables what it can; the function is
 * the authority.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarPlus, ChevronRight, Footprints, UserPlus } from "lucide-react";
import { useActor } from "../../../app/auth";
import { PageShell } from "../../../app/shell/PageShell";
import { ago, when } from "../../../lib/format";
import { Card, Stack } from "../../../ui/Card";
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
import { DateTimeField } from "../../../ui/DateField";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { assignSurveyors, getSurvey, scheduleVisit, setLead, transitionSurvey } from "../api/surveys-util";
import { SurveyStatusChip, VisitStatusChip } from "../components/SurveyChips";
import {
  SURVEY_TRAIL,
  VERDICT_LABEL,
  type SurveyDetailResponse,
} from "../types/survey";

type TabId = "overview" | "visits" | "team" | "portfolio" | "reconciliation";

const TABS: Tab<TabId>[] = [
  { id: "overview", label: "Overview" },
  { id: "visits", label: "Visits" },
  { id: "team", label: "Team" },
  { id: "portfolio", label: "Portfolio" },
  { id: "reconciliation", label: "Reconciliation" },
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
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/surveys")}>
            <ArrowLeft className="size-4" />
            All surveys
          </Button>
          {survey && !terminal ? (
            <>
              <Button variant="outline" onClick={() => setScheduling(true)}>
                <CalendarPlus className="size-4" />
                {survey.status === "draft" ? "Schedule visit" : "Add visit"}
              </Button>
              <Button variant="outline" onClick={() => setAssigning(true)}>
                <UserPlus className="size-4" />
                Assign
              </Button>
              {detail?.visits.length ? (
                <Button onClick={() => navigate(`/surveys/${id}/walk`)}>
                  <Footprints className="size-4" />
                  Open walk
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setCancelling(true)}>
                Cancel survey
              </Button>
            </>
          ) : null}
        </div>
      }
      strip={<Tabs items={TABS} active={tab} onChange={setTab} />}
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
            {tab === "overview" ? <OverviewTab detail={detail} /> : null}
            {tab === "visits" ? <VisitsTab detail={detail} /> : null}
            {tab === "team" ? <TeamTab detail={detail} /> : null}
            {tab === "portfolio" ? <PortfolioTab detail={detail} /> : null}
            {tab === "reconciliation" ? <ReconciliationTab detail={detail} /> : null}
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

function OverviewTab({ detail }: { detail: SurveyDetailResponse }) {
  const s = detail.survey;
  const snapshot = detail.snapshot;

  return (
    <>
      <Card title="Survey">
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
            { label: "Visits", value: String(detail.visits.length) },
            { label: "Target completion", value: s.targetCompletionDate },
            {
              label: "Revision",
              value: `v${s.revisionNo ?? 1}${s.reworkCount ? ` · ${s.reworkCount} rework bounce(s)` : ""}`,
            },
            {
              label: "Completeness",
              value: s.completenessPct !== null && s.completenessPct !== undefined ? `${s.completenessPct}%` : null,
            },
            {
              // Null is NOT zero: null means nothing was seeded, so coverage
              // could not be measured. Zero means the whole site was walked.
              label: "Not visited",
              value:
                s.notVisitedPct !== null && s.notVisitedPct !== undefined
                  ? `${s.notVisitedPct}%`
                  : "Not measurable — no nodes seeded",
            },
            { label: "Created", value: s.createdAt ? when(s.createdAt) : null },
          ]}
        />
      </Card>

      <Card title="How a survey moves">
        <div className="flex flex-wrap items-center gap-2">
          {SURVEY_TRAIL.map((status, i) => (
            <div key={status} className="flex items-center gap-2">
              {i > 0 ? <ChevronRight className="text-muted-foreground size-3.5" /> : null}
              <SurveyStatusChip status={status} />
            </div>
          ))}
        </div>
        <p className="text-muted-foreground mt-3 text-sm">
          A survey can be cancelled from any state before completed, with a reason. Completed is
          terminal — a re-walk is a new linked survey, never a reopen. Only the lead can send a
          survey for review or submit it.
        </p>
      </Card>
    </>
  );
}

function VisitsTab({ detail }: { detail: SurveyDetailResponse }) {
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
        <div key={v.id} className="flex flex-wrap items-center gap-4 border-b px-4 py-3 last:border-b-0">
          <code className="text-sm font-medium">{v.visitNumber}</code>
          <VisitStatusChip status={v.status} />
          <span className="text-sm">
            {v.scheduledStart ? when(v.scheduledStart) : "Unscheduled"}
            {v.scheduledEnd ? ` → ${when(v.scheduledEnd)}` : ""}
          </span>
          {v.timezone ? <span className="text-muted-foreground text-xs">{v.timezone}</span> : null}
          {v.siteContactName ? (
            <span className="text-muted-foreground text-xs">
              meets {v.siteContactName}
              {v.siteContactPhone ? ` · ${v.siteContactPhone}` : ""}
            </span>
          ) : null}
          {v.noShowReason ? (
            <span className="text-destructive text-xs">no-show: {v.noShowReason}</span>
          ) : null}
        </div>
      ))}
    </Card>
  );
}

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

function PortfolioTab({ detail }: { detail: SurveyDetailResponse }) {
  if (!detail.nodes.length) {
    return (
      <Card pad={false}>
        <Empty
          title="No nodes"
          body="Site, building and space. Nodes seeded from the tender documents are verdicted on the walk; rooms found on site are added as the surveyor goes."
        />
      </Card>
    );
  }

  return (
    <Card pad={false}>
      {detail.nodes.map((n) => (
        <div key={n.id} className="flex flex-wrap items-center gap-4 border-b px-4 py-3 last:border-b-0">
          <span className="text-sm font-medium">{n.name}</span>
          <span className="text-muted-foreground text-xs">{n.nodeType}</span>
          <span className="text-muted-foreground text-xs">{VERDICT_LABEL[n.verdict] ?? n.verdict}</span>
          {n.areaSqft ? <span className="text-muted-foreground text-xs">{n.areaSqft} sqft</span> : null}
        </div>
      ))}
    </Card>
  );
}

function ReconciliationTab({ detail }: { detail: SurveyDetailResponse }) {
  if (!detail.reconciliation.length) {
    return (
      <Card pad={false}>
        <Empty
          title="Nothing to reconcile"
          body="Every difference between what the tender documents claimed and what the surveyor found, side by side. The app suggests a value and a reason; the lead decides each row."
        />
      </Card>
    );
  }

  return (
    <Card pad={false}>
      {detail.reconciliation.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-4 border-b px-4 py-3 last:border-b-0">
          <span className="text-sm font-medium">{r.diffType}</span>
          <span className="text-muted-foreground text-xs">
            RFP: {r.rfpValue ?? "—"} · Survey: {r.surveyValue ?? "—"}
          </span>
          <span className="text-xs">{r.status}</span>
        </div>
      ))}
    </Card>
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!start || busy) return;
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
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sv-start">Starts</Label>
                <DateTimeField id="sv-start" value={start} onChange={setStart} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sv-end">Ends</Label>
                <DateTimeField id="sv-end" value={end} onChange={setEnd} disabled={!start} />
              </div>
            </div>
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
