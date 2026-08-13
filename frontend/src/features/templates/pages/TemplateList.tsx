/**
 * The template list — live against `form.template-list`.
 *
 * One fetch, filtered client-side. The tabs and the search box slice the same
 * ≤100-row result rather than refetching per keystroke: a handler round trip
 * costs ~1.1s of fixed overhead, and an org has dozens of templates, not
 * thousands. The server-side `search`/`status` parameters exist for the day
 * that stops being true.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock3, FilePlus2, FileText, ListChecks, MoreVertical, Plus } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { ago, plural } from "../../../lib/format";
import { Card } from "../../../ui/Card";
import { Chip, type Tone } from "../../../ui/Chip";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { Tabs, type Tab } from "../../../ui/Tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "../../../ui/Toast";
import { archiveTemplate, cloneTemplate, listTemplates, publishTemplate } from "../api/templates-util";
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
 * The thumbnail's look, derived from the template's name the same way
 * CompanyLogo tints its initials: one hash feeds both the hue and which
 * texture the tile wears, so every template keeps its identity between visits
 * and neighbours rarely match. Two stops ~40° apart on the wheel keep the
 * gradient lively without ever pairing complementary colours. Saturated ink
 * works over both themes because the tile is its own surface.
 */
function thumbOf(name: string): { style: React.CSSProperties; texture: number } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return {
    style: {
      background: `linear-gradient(135deg, hsl(${h} 70% 52%), hsl(${(h + 42) % 360} 78% 38%))`,
    },
    // A different divisor than the hue's, so texture and colour don't travel
    // together — two teal cards can still wear different weaves.
    texture: Math.floor(h / 7) % 4,
  };
}

/** One tile of each texture, all white-on-nothing so the gradient shows
    through: dots, diagonal weave, drafting grid, and the sidebar's wave. */
const TEXTURES: { w: number; h: number; draw: React.ReactNode }[] = [
  { w: 12, h: 12, draw: <circle cx="2" cy="2" r="1.1" fill="white" /> },
  { w: 10, h: 10, draw: <path d="M-1 11 L11 -1" stroke="white" strokeWidth="1.2" fill="none" /> },
  { w: 14, h: 14, draw: <path d="M13.5 0 V13.5 H0" stroke="white" fill="none" /> },
  { w: 16, h: 8, draw: <path d="M0 4C2.7 0.8 5.3 0.8 8 4C10.7 7.2 13.3 7.2 16 4" stroke="white" fill="none" /> },
];

/** The texture layer: an SVG pattern over the gradient, quiet enough that the
    colour stays the subject and the weave only shows on a second look. */
function ThumbTexture({ texture }: { texture: number }) {
  const id = useId();
  const t = TEXTURES[texture];
  return (
    <svg className="absolute inset-0 size-full opacity-[0.16]" aria-hidden="true">
      <defs>
        <pattern id={id} width={t.w} height={t.h} patternUnits="userSpaceOnUse">
          {t.draw}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * Clickable now that the builder hydrates from `/templates/:id` — a draft
 * opens editable, published and archived open straight into their preview.
 * The ⋯ menu carries the lifecycle moves; Archive IS this model's delete
 * (soft, reversible, and in-flight surveys keep their snapshots).
 */
function TemplateCard({
  t,
  busy,
  onOpen,
  onClone,
  onPublish,
  onArchive,
}: {
  t: Template;
  busy: boolean;
  onOpen: () => void;
  onClone: () => void;
  onPublish: () => void;
  onArchive: () => void;
}) {
  const thumb = thumbOf(t.name);
  return (
    // Flat like every other surface: no shadow at rest or on hover — the
    // border tint is the hover cue, and the glyph animation the delight.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group bg-card hover:border-ring/40 relative flex cursor-pointer flex-col overflow-hidden rounded-xl border transition-colors">
      {/* The status chip lives on the thumbnail, where there is empty space —
          in the body it was shoulder-to-shoulder with the name and the ⋯ menu.
          A sibling of the thumb div, not a child, so an archived card's
          grayscale/dim filter never washes out its own label. */}
      <span className="absolute top-2.5 left-2.5 z-[1]">
        <Chip tone={STATUS_TONE[t.status]}>{t.status}</Chip>
      </span>
      {/* The thumbnail. Archived templates go grayscale — the shelf keeps its
          shape but visibly steps out of the working set. */}
      <div
        className={cn("relative h-28 shrink-0", t.status === "archived" && "opacity-60 grayscale")}
        style={thumb.style}
      >
        <ThumbTexture texture={thumb.texture} />
        {/* A soft top-left light so the gradient reads as a lit surface. */}
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(120% 90% at 18% 0%, rgb(255 255 255 / 0.28), transparent 55%)" }}
        />
        {/* The document glyph, oversized and bleeding off the corner — the
            gallery's version of the row tile, grown to poster scale. Stroke
            thinned from lucide's default 2 so at this size it stays a
            watermark, not a diagram. */}
        <FileText
          strokeWidth={1.25}
          className="absolute -right-3 -bottom-4 size-20 rotate-[-8deg] text-white/25 transition-transform duration-300 group-hover:rotate-0"
          aria-hidden="true"
        />
        {/* Only a REAL category earns the label: every template is born with
            the default "General", and a word all cards share says nothing. */}
        {t.category && t.category.trim().toLowerCase() !== "general" ? (
          <span className="absolute bottom-2 left-3 max-w-[70%] truncate text-[11px] font-medium tracking-[0.08em] text-white/85 uppercase">
            {t.category}
          </span>
        ) : null}
      </div>

      {/* Body: name + meta with only the ⋯ menu beside them (the status chip
          moved up onto the thumbnail), then a hairline above the stats footer.
          flex-1 + mt-auto keeps every card's footer on one line across the
          row, however long the names above them run. */}
      <div className="flex flex-1 flex-col p-3.5 pt-3">
        {/* pb-3 is the minimum air above the footer hairline; mt-auto on the
            footer grows it when a short name leaves the card with spare rows. */}
        <div className="flex items-start justify-between gap-2 pb-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{t.name}</div>
            <div className="text-muted-foreground mt-0.5 truncate text-xs">
              v{t.versionNo}
              {` · ${t.sectionCount ?? 0} section${t.sectionCount === 1 ? "" : "s"}`}
              {t.usageCount ? ` · used by ${t.usageCount}` : ""}
            </div>
          </div>
          {/* stopPropagation: the menu lives on a clickable card, and opening
              it must not also open the template. Nudged into the corner so the
              hit target is generous without stealing body padding. */}
          <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground -mt-1 -mr-1.5 size-7 shrink-0"
                  disabled={busy}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Actions for ${t.name}`}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onSelect={onOpen}>
                  {t.status === "draft" ? "Edit" : "View preview"}
                </DropdownMenuItem>
                {t.status === "draft" ? (
                  <DropdownMenuItem onSelect={onPublish}>Publish</DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={onClone}>Clone to new draft</DropdownMenuItem>
                {t.status !== "archived" ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={onArchive}>
                      Archive
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* A hairline over the stats so the footer reads as its own band. */}
        <div className="text-muted-foreground mt-auto flex items-center gap-3 border-t pt-2.5 text-xs">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="size-3.5" aria-hidden="true" />
            {plural(t.questionCount ?? 0, "question", "questions")}
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
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  /** Id of the card whose action is in flight — its menu locks meanwhile. */
  const [busyId, setBusyId] = useState<string | null>(null);

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

  /** One lifecycle move: run it, toast the outcome verbatim, refresh the shelf. */
  const act = async (
    t: Template,
    run: () => Promise<{ data: unknown; error: string | null }>,
    done: string
  ) => {
    setBusyId(t.id);
    const { error: err } = await run();
    setBusyId(null);
    if (err) {
      toast(err, true);
      return;
    }
    toast(done);
    setReloadKey((k) => k + 1);
  };

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
        <Button size="sm" onClick={() => navigate("/templates/new")}>
          <Plus className="size-4" />
          New template
        </Button>
      }
      strip={<Tabs items={tabs} active={filter} onChange={setFilter} />}
      search={
        <Input
          type="text"
          placeholder="Search templates"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-full sm:w-56"
          aria-label="Search templates"
        />
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
            <TemplateCard
              key={t.id}
              t={t}
              busy={busyId === t.id}
              onOpen={() => navigate(`/templates/${t.id}`)}
              onClone={() =>
                void cloneTemplate(t.id).then(({ data, error: err }) => {
                  if (err || !data) toast(err ?? "The clone did not land", true);
                  else navigate(`/templates/${data.template.id}`);
                })
              }
              onPublish={() =>
                void act(t, () => publishTemplate(t.id), `${t.name} published`)
              }
              onArchive={() =>
                void act(
                  t,
                  () => archiveTemplate(t.id),
                  `${t.name} archived — off the pickers; surveys in flight keep their snapshots`
                )
              }
            />
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
