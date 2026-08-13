/**
 * The template list — live against `form.template-list`.
 *
 * One fetch, filtered client-side. The tabs and the search box slice the same
 * ≤100-row result rather than refetching per keystroke: a handler round trip
 * costs ~1.1s of fixed overhead, and an org has dozens of templates, not
 * thousands. The server-side `search`/`status` parameters exist for the day
 * that stops being true.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock3, FilePlus2, FileText, ListChecks, Plus } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { ago } from "../../../lib/format";
import { Bar, Card } from "../../../ui/Card";
import { Chip, type Tone } from "../../../ui/Chip";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { Tabs, type Tab } from "../../../ui/Tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { listTemplates } from "../api/templates-util";
import type { Template, TemplateStatus } from "../types/template";

type Filter = TemplateStatus | "all";

const TABS: Tab<Filter>[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "published", label: "Published" },
  { id: "archived", label: "Archived" },
];

const STATUS_TONE: Record<TemplateStatus, Tone> = {
  draft: "orange",
  published: "green",
  archived: "neutral",
};

/**
 * Templates render as CARDS, not rows: a template is a designed artifact —
 * like a doc in a docs picker — and a gallery reads that better than a ledger.
 * The grid packs by viewport, one column on phones up to four on wide screens.
 */
const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

/**
 * The thumbnail's gradient, derived from the template's name the same way
 * CompanyLogo tints its initials: hash → hue, so every template keeps its own
 * colour between visits and neighbours rarely collide. Two stops ~40° apart on
 * the wheel keep it lively without ever pairing complementary colours.
 * Saturated ink works over both themes because the tile is its own surface.
 */
function thumbStyle(name: string): React.CSSProperties {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${h} 70% 52%), hsl(${(h + 42) % 360} 78% 38%))`,
  };
}

/**
 * Not clickable, deliberately — the old table never navigated either, because
 * the `:id` builder route renders a blank builder today (it never calls
 * `getTemplate`). Wire `onOpen` back on the day the builder hydrates from it;
 * the hover styles below are display polish, kept shy of a click affordance.
 */
function TemplateCard({ t }: { t: Template }) {
  return (
    // Flat like every other surface: no shadow at rest or on hover — the
    // border tint is the hover cue, and the glyph animation the delight.
    <div className="group bg-card hover:border-ring/40 flex flex-col overflow-hidden rounded-xl border transition-colors">
      {/* The thumbnail. Archived templates go grayscale — the shelf keeps its
          shape but visibly steps out of the working set. */}
      <div
        className={cn("relative h-28 shrink-0", t.status === "archived" && "opacity-60 grayscale")}
        style={thumbStyle(t.name)}
      >
        {/* A soft top-left light so the gradient reads as a lit surface. */}
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(120% 90% at 18% 0%, rgb(255 255 255 / 0.28), transparent 55%)" }}
        />
        {/* The document glyph, oversized and bleeding off the corner — the
            gallery's version of the row tile, grown to poster scale. */}
        <FileText
          className="absolute -right-3 -bottom-4 size-20 rotate-[-8deg] text-white/25 transition-transform duration-300 group-hover:rotate-0"
          aria-hidden="true"
        />
        {t.category ? (
          <span className="absolute bottom-2 left-3 max-w-[70%] truncate text-[11px] font-medium tracking-[0.08em] text-white/85 uppercase">
            {t.category}
          </span>
        ) : null}
      </div>

      {/* Body. flex-1 + mt-auto footer keeps every card's footer on one line
          across the row, however long the names above them run. */}
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{t.name}</div>
            <div className="text-muted-foreground mt-0.5 truncate text-xs">
              v{t.versionNo}
              {` · ${t.sectionCount ?? 0} section${t.sectionCount === 1 ? "" : "s"}`}
              {t.usageCount ? ` · used by ${t.usageCount}` : ""}
            </div>
          </div>
          <Chip tone={STATUS_TONE[t.status]}>{t.status}</Chip>
        </div>
        <div className="text-muted-foreground mt-auto flex items-center gap-3 pt-2 text-xs">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="size-3.5" aria-hidden="true" />
            {t.questionCount ?? 0} questions
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {t.updatedAt ? ago(t.updatedAt) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Loading cards on the identical grid and card anatomy, so nothing shifts. */
function CardsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={GRID} aria-busy="true" aria-label="Loading templates">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-card flex flex-col overflow-hidden rounded-xl border" aria-hidden="true">
          <Skeleton className="bg-border h-28 shrink-0 rounded-none" />
          <div className="flex flex-col gap-2 p-3.5">
            <Skeleton className="bg-border h-3.5 rounded-sm" style={{ width: ["72%", "55%", "64%", "48%"][i % 4] }} />
            <Skeleton className="bg-border h-3 rounded-sm" style={{ width: ["88%", "70%", "79%", "62%"][i % 4] }} />
            <Skeleton className="bg-border mt-2 h-3 w-2/5 rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TemplateList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    listTemplates("", "all").then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (data) setTemplates(data.templates);
    });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter(
      (t) =>
        (filter === "all" || t.status === filter) &&
        (!q ||
          t.name.toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q) ||
          (t.category ?? "").toLowerCase().includes(q))
    );
  }, [templates, filter, search]);

  // Counts appear only once the data has — no zeros during the skeleton phase.
  const tabs = useMemo(() => {
    if (!loaded || error) return TABS;
    const byStatus = new Map<string, number>();
    for (const t of templates) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
    return TABS.map((t) => ({
      ...t,
      count: t.id === "all" ? templates.length : (byStatus.get(t.id) ?? 0),
    }));
  }, [loaded, error, templates]);

  return (
    <PageShell
      title="Templates"
      subtitle="Question sets the survey copies at scheduling"
      actions={
        <Button onClick={() => navigate("/templates/new")}>
          <Plus className="size-4" />
          New template
        </Button>
      }
      strip={
        // w-full so justify-between has a full line to work across; the field
        // takes a fixed width beside the tabs and only goes full-width once it
        // has wrapped under them on a phone.
        <Bar className="w-full justify-between gap-x-6 pb-1">
          <Tabs items={tabs} active={filter} onChange={setFilter} />
          <Input
            type="text"
            placeholder="Search templates"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72"
            aria-label="Search templates"
          />
        </Bar>
      }
    >
      {/* The gallery stands on the page itself; only the empty and error
          states keep a Card so they have a surface to sit on. */}
      {!loaded ? (
        <CardsSkeleton count={8} />
      ) : error ? (
        <Card pad={false}>
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        </Card>
      ) : rows.length ? (
        <div className={GRID}>
          {rows.map((t) => (
            <TemplateCard key={t.id} t={t} />
          ))}
        </div>
      ) : templates.length ? (
        <Card pad={false}>
          <Empty
            title="Nothing matches"
            body="No template in this tab matches the search."
          />
        </Card>
      ) : (
        <Card pad={false}>
          <Empty
            title="No templates yet"
            body="A template is sections and questions. The survey copies it at scheduling, so a template edited later never reaches a survey already in flight."
            action={
              <Button onClick={() => navigate("/templates/new")}>
                <FilePlus2 className="size-4" />
                Build the first template
              </Button>
            }
          />
        </Card>
      )}
    </PageShell>
  );
}
