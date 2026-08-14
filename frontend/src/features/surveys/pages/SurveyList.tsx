/**
 * The survey list — live against `survey.list`.
 *
 * One fetch, filtered client-side, same reasoning as the template list: tabs
 * and search slice a ≤100-row result rather than paying ~1.1s per keystroke.
 * Saved views, column config and cross-record search remain a PLATFORM concern
 * (solved once across leads, deals, quotes and surveys); what this module owes
 * that layer is its filterable fields: status, leadUserEmail, dealId,
 * accountId, targetCompletionDate, contractIntent, reworkCount, notVisitedPct.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  ClipboardList,
  Clock3,
  FileText,
  Footprints,
  Gauge,
  Hourglass,
  Plus,
  UserCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCounts } from "../../../app/counts";
import { PageShell } from "../../../app/shell/PageShell";
import { onDay, when } from "../../../lib/format";
import { Card } from "../../../ui/Card";
import { TableCell } from "@/components/ui/table";
import {
  ClickRow,
  ListTable,
  ListTableSkeleton,
  MobileFact,
  MobileList,
  MobileRow,
  PHONE_BLEED,
  type Col,
} from "../../../ui/DataTable";
import { CompanyLogo } from "../../../ui/CompanyLogo";
import { Empty, ErrorState } from "../../../ui/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listSurveys } from "../api/surveys-util";
import { NewSurveyDialog } from "../components/NewSurveyDialog";
import { CompletenessMeter, SurveyStatusChip } from "../components/SurveyChips";
import type { Survey, SurveyStatus } from "../types/survey";

/** `overdue` is a date slice, not a status — it cuts across the live states. */
type Filter = SurveyStatus | "all" | "overdue";

/**
 * The pulse strip IS the filter — stat tiles doubling as tabs, so the page
 * carries one row of controls instead of two saying the same thing.
 * X-02: `draft` and `cancelled` ARE tiles now — three of nine surveys were
 * reachable only via All, which made them effectively lost. Every status is a
 * value.
 *
 * `chip` carries each slice's tone from the SAME vocabulary the status chips
 * use (ui/Chip's five tones — see SURVEY_TONE), so a tile and the chips in the
 * rows it filters to are the same colour. Nothing new is invented here:
 * scheduled and assigned share blue exactly as their chips do, and the icon
 * plus label do the distinguishing.
 */
const PULSE: { id: Filter; label: string; icon: LucideIcon; chip: string }[] = [
  { id: "all", label: "All", icon: ClipboardList, chip: "bg-muted text-muted-foreground" },
  {
    id: "draft",
    label: "Draft",
    icon: FileText,
    chip: "bg-muted text-muted-foreground",
  },
  {
    id: "scheduled",
    label: "Scheduled",
    icon: CalendarDays,
    chip: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
  {
    id: "assigned",
    label: "Assigned",
    icon: UserCheck,
    chip: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
  {
    id: "in_progress",
    label: "In progress",
    icon: Footprints,
    chip: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
  },
  {
    id: "pending_review",
    label: "Pending review",
    icon: Hourglass,
    chip: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
  },
  {
    id: "completed",
    label: "Completed",
    icon: CheckCircle2,
    chip: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
  },
  {
    id: "overdue",
    label: "Overdue",
    icon: AlarmClock,
    chip: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  },
  {
    id: "cancelled",
    label: "Cancelled",
    icon: XCircle,
    chip: "bg-muted text-muted-foreground",
  },
];

// No max-sm classes — below `sm` the table yields to the MobileList and its
// cards. The md/lg steps remain: on a tablet the table is real but narrow.
const COLS: Col[] = [
  { label: "Survey", icon: ClipboardList, skel: "entity" },
  { label: "Status", className: "w-36", skel: "chip" },
  { label: "Progress", icon: Gauge, className: "max-md:hidden w-32", skel: "text" },
  { label: "Visits", icon: Footprints, className: "w-20", skel: "num" },
  { label: "Target", icon: CalendarClock, className: "max-lg:hidden w-32", skel: "text" },
  // D-33: the next planned visit — the one date a coordinator scans this list
  // for. Created-ago moved to the detail page, where nostalgia belongs.
  { label: "Next visit", icon: Clock3, className: "max-md:hidden w-32", skel: "text" },
];

/** The entity cell's second line, shared by the table cell and the phone card
    so the two can never describe a survey differently. */
const SurveyMeta = ({ survey: s }: { survey: Survey }) => (
  <>
    {s.accountName ?? "No account"}
    {s.templateName ? ` · ${s.templateName}` : " · from scratch"}
    {" · "}
    {/* The joined name where one exists (X-05); the email's local part only
        for legacy leads that predate user records. */}
    {s.leadUserName ?? (s.leadUserEmail ? s.leadUserEmail.split("@")[0] : <em>no lead yet</em>)}
  </>
);

/** Overdue is a date judgement, not a status one — but terminal surveys are
    done arguing with the calendar and never flag. */
const isOverdue = (s: Survey): boolean =>
  Boolean(
    s.targetCompletionDate &&
      s.status !== "completed" &&
      s.status !== "cancelled" &&
      new Date(s.targetCompletionDate).getTime() < Date.now()
  );

/**
 * One tile of the pulse strip — a stat card that IS the tab. `aria-pressed`
 * plus the ring say which slice the table below is showing.
 *
 * Hover lifts the tile 2px rather than scaling it: at this size a scale
 * shimmers the digits, and seven of them moving reads as restless.
 */
function StatTile({
  label,
  icon: Icon,
  value,
  chipClass,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  value: string | number;
  chipClass: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "bg-card flex flex-col gap-2 rounded-xl border px-3.5 py-3 text-left",
        "transition-[transform,border-color,background-color] duration-200 ease-out",
        "hover:border-ring/40 hover:-translate-y-0.5",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        active && "border-ring/60 bg-muted/30"
      )}
    >
      <span className="flex items-center gap-2">
        {/* The tone lives in a tinted glyph tile, never in the number: a
            coloured count would compete with the status chips in the rows. */}
        <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-lg", chipClass)}>
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        <span className="text-muted-foreground min-w-0 truncate text-xs">{label}</span>
      </span>

      <span className="text-2xl leading-none font-semibold tabular-nums">{value}</span>
    </button>
  );
}

/**
 * The phone's filter: one chip that names the live slice, opening a popover
 * with all seven and their counts.
 *
 * Seven cards stacked two-up is four rows of chrome before the first survey on
 * a phone — the numbers stop being a glance and become the page. The chip
 * keeps the active slice and its count visible while costing one line.
 */
function PulseChipFilter({
  active,
  countOf,
  onPick,
}: {
  active: Filter;
  countOf: (f: Filter) => string | number;
  onPick: (f: Filter) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = PULSE.find((t) => t.id === active) ?? PULSE[0];
  const CurrentIcon = current.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bg-card hover:border-ring/40 flex w-full items-center gap-2 rounded-full border px-3 py-2 text-left transition-colors"
        >
          <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", current.chip)}>
            <CurrentIcon className="size-3" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{current.label}</span>
          <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
            {countOf(active)}
          </span>
          <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      {/* width="trigger" so the list reads as the chip's own expansion. */}
      <PopoverContent align="start" width="trigger" className="p-1">
        {PULSE.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onPick(t.id);
                setOpen(false);
              }}
              className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors"
            >
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", t.chip)}>
                <Icon className="size-3" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{t.label}</span>
              <span className="text-muted-foreground text-xs tabular-nums">{countOf(t.id)}</span>
              <Check
                className={cn("size-3.5 shrink-0", t.id === active ? "opacity-100" : "opacity-0")}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export function SurveyList() {
  const navigate = useNavigate();
  const { setPendingSurveys } = useCounts();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  // `/surveys?new=<dealId>` opens the create dialog with the deal preselected —
  // the deep link the lead and account pages use to raise a survey in place.
  const [params, setParams] = useSearchParams();
  const newParam = params.get("new");
  const [creating, setCreating] = useState(newParam !== null);
  const initialDealId = newParam || undefined;

  const closeCreate = (open: boolean) => {
    setCreating(open);
    if (!open && newParam !== null) setParams({}, { replace: true });
  };

  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    listSurveys("all", "").then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (data) {
        setSurveys(data.surveys);
        // Feeds the sidebar badge — the lead's review queue.
        setPendingSurveys(data.surveys.filter((s) => s.status === "pending_review").length);
      }
    });
    return () => {
      live = false;
    };
  }, [reloadKey, setPendingSurveys]);

  const matches = (s: Survey, f: Filter): boolean =>
    f === "all" ? true : f === "overdue" ? isOverdue(s) : s.status === f;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return surveys.filter(
      (s) =>
        matches(s, filter) &&
        (!q ||
          s.refNo.toLowerCase().includes(q) ||
          (s.title ?? "").toLowerCase().includes(q) ||
          (s.accountName ?? "").toLowerCase().includes(q))
    );
  }, [surveys, filter, search]);

  /** Every tile's count off the one fetch. Shown as an em dash until the data
      has arrived — a zero during the skeleton phase would claim an empty
      bucket before anything was fetched. */
  const countOf = (f: Filter): string | number =>
    !loaded || error ? "—" : surveys.filter((s) => matches(s, f)).length;


  return (
    <PageShell
      title="Surveys"
      subtitle="Condition surveys against a deal"
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New survey
        </Button>
      }
      // No strip: the pulse tiles below ARE the tabs, and with no control row
      // the shell seats the search in the title row, left of "New survey".
      search={
        <Input
          type="text"
          placeholder="Search by number, account or site"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
          aria-label="Search surveys"
        />
      }
    >
      {/* The pulse strip — stat cards doubling as the page's only filter.
          Clicking a tile slices the table to its rows; All resets. Phones get
          the same seven as a chip and its popover instead of four rows of
          cards. */}
      <div className="mb-4 sm:hidden">
        <PulseChipFilter active={filter} countOf={countOf} onPick={setFilter} />
      </div>
      <div className="mb-5 hidden gap-3 sm:grid sm:grid-cols-4 xl:grid-cols-7">
        {PULSE.map((t) => (
          <StatTile
            key={t.id}
            label={t.label}
            icon={t.icon}
            value={countOf(t.id)}
            chipClass={t.chip}
            active={filter === t.id}
            onClick={() => setFilter(t.id)}
          />
        ))}
      </div>

      {/* No `count` on this shell: the phone filter chip above the list
          already names the active slice and its count. */}
      <Card pad={false} className={PHONE_BLEED}>
        {!loaded ? (
          <ListTableSkeleton cols={COLS} rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : rows.length ? (
          <>
            <ListTable cols={COLS} className="max-sm:hidden">
              {rows.map((s) => (
                <ClickRow key={s.id} onClick={() => navigate(`/surveys/${s.id}`)}>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {/* The account the survey is against — surveys carry no
                          domain, so this is usually the tinted-initials tile. */}
                      <CompanyLogo name={s.accountName ?? s.refNo} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          <code className="mr-1.5 font-mono text-xs">{s.refNo}</code>
                          {s.title ?? "Untitled survey"}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          <SurveyMeta survey={s} />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="w-36 px-4 py-3">
                    <SurveyStatusChip status={s.status} />
                  </TableCell>
                  <TableCell className="w-32 px-4 py-3 max-md:hidden">
                    <CompletenessMeter pct={s.completenessPct} />
                  </TableCell>
                  <TableCell className="w-20 px-4 py-3 text-sm font-medium tabular-nums">
                    {s.visitCount ?? 0}
                  </TableCell>
                  <TableCell className="w-32 px-4 py-3 text-xs max-lg:hidden">
                    {s.targetCompletionDate ? (
                      <span className={isOverdue(s) ? "text-destructive font-medium" : "text-muted-foreground"}>
                        {onDay(s.targetCompletionDate)}
                        {isOverdue(s) ? " · overdue" : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground w-32 px-4 py-3 text-xs max-md:hidden">
                    {/* D-33: when somebody is next on site — or an honest dash
                        for a survey with nothing planned. */}
                    {s.nextVisitAt ? when(s.nextVisitAt) : "—"}
                  </TableCell>
                </ClickRow>
              ))}
            </ListTable>
            <MobileList>
              {rows.map((s) => (
                <MobileRow
                  key={s.id}
                  onClick={() => navigate(`/surveys/${s.id}`)}
                  leading={<CompanyLogo name={s.accountName ?? s.refNo} />}
                  title={
                    <>
                      <code className="mr-1.5 font-mono text-xs">{s.refNo}</code>
                      {s.title ?? "Untitled survey"}
                    </>
                  }
                  trailing={<SurveyStatusChip status={s.status} />}
                  meta={<SurveyMeta survey={s} />}
                  // Progress, visits and the target date earn the card's facts
                  // line; created-ago doesn't — the table already drops it on
                  // tablet, and a phone card has even less room for nostalgia.
                  // The facts carry the table columns' own glyphs, so a fact is
                  // findable across the two forms by its icon. The meter only
                  // when it measures something: its null form is a bare dash,
                  // which opened every draft's facts line with an orphan "—".
                  facts={
                    <>
                      {s.completenessPct !== null && s.completenessPct !== undefined ? (
                        <CompletenessMeter pct={s.completenessPct} />
                      ) : null}
                      <MobileFact icon={Footprints} value={s.visitCount ?? 0}>
                        {(s.visitCount ?? 0) === 1 ? "visit" : "visits"}
                      </MobileFact>
                      {s.targetCompletionDate ? (
                        <MobileFact icon={CalendarClock}>
                          <span className={isOverdue(s) ? "text-destructive font-medium" : undefined}>
                            {onDay(s.targetCompletionDate)}
                            {isOverdue(s) ? " · overdue" : ""}
                          </span>
                        </MobileFact>
                      ) : null}
                    </>
                  }
                />
              ))}
            </MobileList>
          </>
        ) : surveys.length ? (
          <Empty title="Nothing matches" body="No survey in this slice matches the search." />
        ) : (
          <Empty
            title="No surveys yet"
            body="A survey is raised against a deal, then scheduled, assigned a lead, and walked. It ends at a frozen handoff payload the estimator prices from."
            action={
              <Button variant="outline" onClick={() => setCreating(true)}>
                <ClipboardList className="size-4" />
                Start with a template
              </Button>
            }
          />
        )}
      </Card>

      <NewSurveyDialog open={creating} onOpenChange={closeCreate} initialDealId={initialDealId} />
    </PageShell>
  );
}
