/**
 * The create-survey dialog — v1.7 §A1.0's three questions, as three fields:
 * which deal, which template, and (optionally) when the first visit is.
 *
 * Only the deal is mandatory. A template must be PUBLISHED — the picker only
 * offers those — and starting without one is allowed (D-S3): the walk is empty
 * until the lead adds ad-hoc sections. A visit date fires T1+T2 at creation:
 * the survey lands `scheduled` with its snapshot copied; no date lands `draft`.
 *
 * Both pickers load when the dialog OPENS, not when the page mounts — the list
 * page should not pay two extra round trips for a dialog most visits never open.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useActor } from "../../../app/auth";
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
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createSurvey,
  listDeals,
  listPublishedTemplates,
  type DealOption,
  type TemplateOption,
} from "../api/surveys-util";

/** Radix Select cannot carry an empty-string value, so "no template" is a token. */
const SCRATCH = "__scratch__";

export function NewSurveyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const actor = useActor();

  const [deals, setDeals] = useState<DealOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(false);

  const [dealId, setDealId] = useState("");
  const [templateId, setTemplateId] = useState(SCRATCH);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const [busy, setBusy] = useState(false);
  /** The server's message, VERBATIM. */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Fields reset on OPEN, so a half-typed value never resurfaces later.
    setDealId("");
    setTemplateId(SCRATCH);
    setTitle("");
    setStart("");
    setEnd("");
    setError(null);
    setLoading(true);

    let live = true;
    Promise.all([listDeals(), listPublishedTemplates()]).then(([dealsRes, templatesRes]) => {
      if (!live) return;
      setLoading(false);
      setError(dealsRes.error ?? templatesRes.error);
      if (dealsRes.data) setDeals(dealsRes.data.deals);
      if (templatesRes.data) setTemplates(templatesRes.data.templates);
    });
    return () => {
      live = false;
    };
  }, [open]);

  /**
   * Picking a start offers an end two hours later, rather than making the user
   * walk the same calendar a second time. It only fills a blank or an end that
   * the new start has overtaken — never an end already chosen deliberately.
   */
  const pickStart = (next: string) => {
    setStart(next);
    if (!next) return setEnd("");
    if (!end || end <= next) setEnd(plusHours(next, 2));
  };

  /** Zero-padded fixed-width strings compare directly; no parsing needed. */
  const endBeforeStart = Boolean(start && end && end <= start);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dealId || endBeforeStart || busy) return;
    setBusy(true);
    setError(null);

    const { data, error: err } = await createSurvey(dealId, actor, {
      ...(templateId !== SCRATCH ? { templateId } : {}),
      ...(title.trim() ? { title: title.trim() } : {}),
      // datetime-local is the browser's local wall clock; the ISO conversion
      // pins it, and the IANA zone records which wall the clock was on.
      ...(start ? { scheduledStart: new Date(start).toISOString() } : {}),
      ...(end ? { scheduledEnd: new Date(end).toISOString() } : {}),
      ...(start ? { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}),
    });

    setBusy(false);
    if (err || !data) {
      setError(err ?? "The survey was not created");
      return;
    }
    onOpenChange(false);
    navigate(`/surveys/${data.survey.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>New survey</DialogTitle>
            <DialogDescription>
              Raised against a deal. Scheduling the first visit copies the template at that moment,
              so later template edits never reach this survey.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ns-deal">
                Deal <span className="text-destructive">*</span>
              </Label>
              <Select value={dealId} onValueChange={setDealId} disabled={loading}>
                <SelectTrigger id="ns-deal" className="w-full">
                  <SelectValue placeholder={loading ? "Loading deals…" : "Pick the deal"} />
                </SelectTrigger>
                <SelectContent>
                  {deals.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.refNo} — {d.title ?? d.accountName ?? "Untitled"}
                      {d.surveyCount ? ` (${d.surveyCount} surveyed)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loading && !deals.length ? (
                <span className="text-muted-foreground text-xs">
                  No deals yet — a survey is always raised against one.
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ns-template">Template</Label>
              <Select value={templateId} onValueChange={setTemplateId} disabled={loading}>
                <SelectTrigger id="ns-template" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SCRATCH}>Start from scratch</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · v{t.versionNo}
                      {t.questionCount ? ` · ${t.questionCount} questions` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loading && !templates.length ? (
                <span className="text-muted-foreground text-xs">
                  No published templates yet — publish one under Templates, or start from scratch.
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ns-title">Title</Label>
              <Input
                id="ns-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Defaults to the template or deal title"
              />
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm leading-none font-medium">First visit</span>
              {start ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground -my-1 h-auto py-1"
                  onClick={() => {
                    setStart("");
                    setEnd("");
                  }}
                >
                  Clear
                </Button>
              ) : (
                <span className="text-muted-foreground text-xs">Optional</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="ns-start" className="text-muted-foreground text-xs">
                  Starts
                </Label>
                <DateTimeField id="ns-start" value={start} onChange={pickStart} />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="ns-end" className="text-muted-foreground text-xs">
                  Ends
                </Label>
                <DateTimeField id="ns-end" value={end} onChange={setEnd} disabled={!start} />
              </div>
            </div>

            {!start ? (
              <p className="text-muted-foreground text-xs">
                Pick a start to schedule the visit — the end fills in two hours later and stays
                editable.
              </p>
            ) : null}
            {endBeforeStart ? (
              <p className="text-destructive text-xs">The end has to come after the start.</p>
            ) : null}
          </div>

          {/* The outcome, stated before the click rather than discovered after it. */}
          <p className="text-muted-foreground bg-muted/50 rounded-md px-3 py-2 text-xs">
            {start ? (
              <>
                Creates a <span className="text-foreground font-medium">scheduled</span> survey and
                copies the template now.
              </>
            ) : (
              <>
                Creates a <span className="text-foreground font-medium">draft</span>. You can
                schedule the first visit later.
              </>
            )}
          </p>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!dealId || endBeforeStart || busy}
              title={!dealId ? "Pick the deal this survey is for" : undefined}
            >
              {busy ? "Creating…" : "Create survey"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
