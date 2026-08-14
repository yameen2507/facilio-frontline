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
 * property. That is not a gap in the picker — carrying a building forward from
 * an earlier pursuit is the portfolio's job (`prospect.copy-forward`, the
 * "From a previous pursuit" flow), and a copied site then shows up here like
 * any other (§3b point 3).
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
import { autoFocusField } from "@/lib/utils";
import { Combobox } from "../../../ui/Combobox";
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
  // D-15: nothing preselected — the author PICKS a published template, and
  // "start from scratch" is a choice made on purpose, never a default slipped
  // through. Empty submits as scratch, but only after the picker was seen.
  const [templateId, setTemplateId] = useState("");
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
    setTemplateId("");
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
      ...(templateId && templateId !== SCRATCH ? { templateId } : {}),
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
              {/* D-35: the one searchable lookup — a plain select stops being
                  a choice at a dozen deals, and this list is every open
                  pursuit. Search hits the ref, the title and the account. */}
              <Combobox
                id="ns-deal"
                options={deals.map((d) => ({
                  id: d.id,
                  label: `${d.refNo} — ${d.title ?? d.accountName ?? "Untitled"}`,
                  meta: d.accountName,
                  badge: d.surveyCount ? `${d.surveyCount} surveyed` : null,
                }))}
                value={dealId || null}
                onChange={setDealId}
                placeholder="Pick the deal"
                searchPlaceholder="Search deals…"
                loading={loading}
              />
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
                // D-35: searchable — a portfolio deal carries dozens of
                // properties, and scrolling a select is how the wrong one
                // gets picked. "Add a new property…" stays a real option, at
                // the end where an escape hatch belongs.
                <Combobox
                  id="ns-site"
                  options={[
                    ...sites.map((s) => ({
                      id: s.id,
                      label: s.name,
                      meta: s.code || null,
                      badge: s.facilioId ? "in Facilio" : null,
                    })),
                    { id: NEW_SITE, label: "Add a new property…" },
                  ]}
                  value={siteId || null}
                  onChange={setSiteId}
                  placeholder={!dealId ? "Pick the deal first" : "Pick the property"}
                  searchPlaceholder="Search properties…"
                  disabled={!dealId}
                  loading={Boolean(dealId) && sitesLoading}
                />
              )}

              {siteId === NEW_SITE ? (
                <Input
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="e.g. Al Bayt Grill — Downtown"
                  aria-label="New property name"
                  autoFocus={autoFocusField()}
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
              {/* D-15, as ruled: published templates ARE the list, and "Start
                  from scratch" is the last row, not the default — it caused
                  exactly the UX overload Sudharsan named. D-35: searchable. */}
              <Combobox
                id="ns-template"
                options={[
                  ...templates.map((t) => ({
                    id: t.id,
                    label: t.name,
                    meta: `v${t.versionNo}${t.questionCount ? ` · ${t.questionCount} questions` : ""}`,
                  })),
                  { id: SCRATCH, label: "Start from scratch" },
                ]}
                value={templateId || null}
                onChange={setTemplateId}
                placeholder={templates.length ? "Pick a template" : "Start from scratch"}
                searchPlaceholder="Search templates…"
                loading={loading}
              />
              {!loading && !templates.length ? (
                <span className="text-muted-foreground text-xs">
                  No published templates yet — publish one under Templates, or start from scratch.
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ns-title">Title</Label>
              {/* X-14: capped — an uncapped title broke the list rows. */}
              <Input
                id="ns-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
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
