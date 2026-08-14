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
import { CalendarPlus, ChevronRight, Footprints, UserPlus } from "lucide-react";
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
import { DateTimeField, plusHours } from "../../../ui/DateField";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  assignSurveyors,
  getSurvey,
  scheduleVisit,
  setLead,
  transitionSurvey,
  transitionVisit,
} from "../api/surveys-util";
import { PhotoGallery } from "../components/PhotoGallery";
import { SurveyStatusChip, VisitStatusChip } from "../components/SurveyChips";
import {
  SURVEY_TRAIL,
  VERDICT_LABEL,
  type SurveyDetailResponse,
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
            {tab === "overview" ? <OverviewTab detail={detail} /> : null}
            {tab === "visits" ? (
              <VisitsTab detail={detail} actor={actor} terminal={terminal} onChanged={reload} />
            ) : null}
            {tab === "team" ? <TeamTab detail={detail} /> : null}
            {tab === "portfolio" ? <PortfolioTab detail={detail} /> : null}
            {tab === "photos" ? <PhotosTab detail={detail} /> : null}
            {tab === "reconciliation" ? <ReconciliationTab detail={detail} /> : null}
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
        <div key={v.id} className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0">
          <div className="flex flex-wrap items-center gap-4">
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
      {detail.events.map((e) => (
        <div key={e.id} className="flex flex-wrap items-baseline gap-3 border-b px-4 py-2.5 last:border-b-0">
          <span className="text-sm font-medium">{humaniseKind(e.kind)}</span>
          {e.body ? <span className="text-sm">{e.body}</span> : null}
          {typeof e.meta?.reason === "string" ? (
            <span className="text-muted-foreground text-xs">“{e.meta.reason}”</span>
          ) : null}
          <span className="text-muted-foreground ml-auto text-xs">
            {e.actor ? `${e.actor.split("@")[0]} · ` : ""}
            {ago(e.occurredAt)}
          </span>
        </div>
      ))}
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
            <div className="grid grid-cols-2 gap-3">
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
