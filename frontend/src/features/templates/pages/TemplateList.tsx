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
import { TableCell, TableRow } from "@/components/ui/table";
import { ListTable, ListTableSkeleton, type Col } from "../../../ui/DataTable";
import { Empty, ErrorState } from "../../../ui/States";
import { Tabs, type Tab } from "../../../ui/Tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const COLS: Col[] = [
  { label: "Template", icon: FileText, skel: "entity" },
  { label: "Status", className: "w-32", skel: "chip" },
  { label: "Questions", icon: ListChecks, className: "max-sm:hidden w-28", skel: "num" },
  { label: "Updated", icon: Clock3, className: "max-md:hidden w-28", skel: "text" },
];

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
      <Card pad={false}>
        {!loaded ? (
          <ListTableSkeleton cols={COLS} rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : rows.length ? (
          <ListTable cols={COLS}>
            {rows.map((t) => (
              // Plain rows: a template is edited through the builder, and this
              // list deliberately never navigated on click.
              <TableRow key={t.id}>
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {/* A document tile where entity rows carry a logo — same
                        footprint, so all four lists lead with the same shape. */}
                    <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg border">
                      <FileText className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{t.name}</div>
                      <div className="text-muted-foreground truncate text-xs">
                        v{t.versionNo}
                        {t.category ? ` · ${t.category}` : ""}
                        {` · ${t.sectionCount ?? 0} section${t.sectionCount === 1 ? "" : "s"}`}
                        {t.usageCount ? ` · used by ${t.usageCount} survey${t.usageCount === 1 ? "" : "s"}` : ""}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="w-32 px-4 py-3">
                  <Chip tone={STATUS_TONE[t.status]}>{t.status}</Chip>
                </TableCell>
                <TableCell className="w-28 px-4 py-3 text-sm font-medium tabular-nums max-sm:hidden">
                  {t.questionCount ?? 0}
                </TableCell>
                <TableCell className="text-muted-foreground w-28 px-4 py-3 text-xs max-md:hidden">
                  {t.updatedAt ? ago(t.updatedAt) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </ListTable>
        ) : templates.length ? (
          <Empty
            title="Nothing matches"
            body="No template in this tab matches the search."
          />
        ) : (
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
        )}
      </Card>
    </PageShell>
  );
}
