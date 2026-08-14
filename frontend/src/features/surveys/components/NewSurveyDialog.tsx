/**
 * The create-survey dialog — which deal, which PROPERTY, which template, and
 * (optionally) when the first visit is.
 *
 * The deal and the property are both mandatory (§8 C32). The property used to be
 * absent entirely, and its absence was the root cause of two live defects: with
 * no site recorded, `walk.ts` had no root to hang discovered rooms off, so every
 * space was created parentless in violation of the C3 ancestry rule (`F-03`),
 * and the surveyor was dispatched with no address (`P-08`).
 *
 * The site list is deal-scoped, so a deal's first survey always names a new
 * property. That is not a gap in the picker — `fl_prospect_node` has no
 * `previous_pursuit_id`, so a building genuinely cannot be carried forward from
 * an earlier pursuit yet (§3b point 3).
 *
 * A template must be PUBLISHED — the picker only offers those — and starting
 * without one is allowed (D-S3): the walk is empty until the lead adds ad-hoc
 * sections. A visit date fires T1+T2 at creation: the survey lands `scheduled`
 * with its snapshot copied; no date lands `draft`.
 *
 * The pickers load when the dialog OPENS, not when the page mounts — the list
 * page should not pay extra round trips for a dialog most visits never open. The
 * site list is the exception: it cannot load until a deal is chosen, so it
 * reloads on every deal change.
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
  listSites,
  type DealOption,
  type SiteOption,
  type TemplateOption,
} from "../api/surveys-util";

/** Radix Select cannot carry an empty-string value, so "no template" is a token. */
const SCRATCH = "__scratch__";

/** Same trick for "the property is not in the list yet". */
const NEW_SITE = "__new_site__";

export function NewSurveyDialog({
  open,
  onOpenChange,
  initialDealId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselects the deal — the lead/account pages deep-link here with one. */
  initialDealId?: string;
}) {
  const navigate = useNavigate();
  const actor = useActor();

  const [deals, setDeals] = useState<DealOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(false);

  const [dealId, setDealId] = useState("");
  /** A site id, or NEW_SITE while the user is naming one. */
  const [siteId, setSiteId] = useState("");
  const [siteName, setSiteName] = useState("");
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  /** The list could not be read. Naming a new property still works. */
  const [sitesUnavailable, setSitesUnavailable] = useState(false);
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
    setDealId(initialDealId ?? "");
    setSiteId("");
    setSiteName("");
    setSites([]);
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
  }, [open, initialDealId]);

  /**
   * The site list belongs to the deal, so it reloads whenever the deal changes
   * and the previous choice is dropped — carrying a site from the old deal over
   * would attach this survey's tree under another pursuit's property, which the
   * server rejects anyway.
   */
  useEffect(() => {
    if (!open || !dealId) {
      setSites([]);
      setSiteId("");
      return;
    }
    setSiteId("");
    setSiteName("");
    setSitesLoading(true);

    let live = true;
    listSites(dealId).then(({ data, error: err }) => {
      if (!live) return;
      setSitesLoading(false);

      // A failed PICKER is not a failed form. Naming a new property does not
      // need this list at all, so drop to that path and say so in one line
      // rather than parking the server's raw message in the fatal slot below —
      // which is reserved for a create that actually failed. Dumping a 404 body
      // there made a recoverable state look terminal and left the only usable
      // control undiscovered.
      if (err) {
        setSites([]);
        setSitesUnavailable(true);
        setSiteId(NEW_SITE);
        return;
      }

      setSitesUnavailable(false);
      const found = data?.sites ?? [];
      setSites(found);
      // A deal with no sites yet has exactly one honest path, so take it rather
      // than making the user discover "Add a new property" in the list.
      if (!found.length) setSiteId(NEW_SITE);
    });
    return () => {
      live = false;
    };
  }, [open, dealId]);

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

  /** Either an existing site is picked, or a new one is named. Never neither. */
  const siteChosen = siteId === NEW_SITE ? Boolean(siteName.trim()) : Boolean(siteId);
  const canSubmit = Boolean(dealId) && siteChosen && !endBeforeStart && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const { data, error: err } = await createSurvey(dealId, actor, {
      ...(siteId === NEW_SITE ? { siteName: siteName.trim() } : { prospectSiteId: siteId }),
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
              Raised against a deal, for one property. Scheduling the first visit copies the
              template at that moment, so later template edits never reach this survey.
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
              <Label htmlFor="ns-site">
                Property <span className="text-destructive">*</span>
              </Label>
              {/* With no readable list there is nothing to choose between, so
                  the picker is not rendered at all — a select whose only option
                  is "add a new one" is a control pretending to be a choice. */}
              {sitesUnavailable ? null : (
                <Select
                  value={siteId}
                  onValueChange={setSiteId}
                  disabled={!dealId || sitesLoading}
                >
                  <SelectTrigger id="ns-site" className="w-full">
                    <SelectValue
                      placeholder={
                        !dealId
                          ? "Pick the deal first"
                          : sitesLoading
                            ? "Loading properties…"
                            : "Pick the property"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.code ? ` · ${s.code}` : ""}
                        {s.facilioId ? " · in Facilio" : ""}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_SITE}>Add a new property…</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {siteId === NEW_SITE ? (
                <Input
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="e.g. Al Bayt Grill — Downtown"
                  aria-label="New property name"
                  autoFocus
                />
              ) : null}

              {/* C35: what the field is FOR, not what it is called. */}
              <span className="text-muted-foreground text-xs">
                The property being surveyed. Every room the surveyor finds is recorded underneath
                it, so the walk cannot start without one.
              </span>

              {sitesUnavailable ? (
                <span className="text-muted-foreground text-xs">
                  This deal&rsquo;s existing properties could not be read, so name the property
                  here. If it already exists you will get a second copy of it — worth checking the
                  deal once the list is readable again.
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

            {/* Side by side only where both date fields fit: at 390px each half
                was ~150px, narrower than the date-and-time value inside it. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              disabled={!canSubmit}
              title={
                !dealId
                  ? "Pick the deal this survey is for"
                  : !siteChosen
                    ? "Pick the property being surveyed, or name a new one"
                    : undefined
              }
            >
              {busy ? "Creating…" : "Create survey"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
