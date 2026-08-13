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
import { FilePlus2, Plus } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { ago } from "../../../lib/format";
import { Bar, Card } from "../../../ui/Card";
import { Chip, type Tone } from "../../../ui/Chip";
import { Row, RowStat, RowTitle, TableHead } from "../../../ui/Row";
import { SkeletonRows } from "../../../ui/Skeleton";
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

const COLUMNS = ["Template", "Status", "Questions", "Updated"];

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
        <Bar className="justify-between pb-1">
          <Tabs items={tabs} active={filter} onChange={setFilter} />
          <Input
            type="text"
            placeholder="Search templates"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-72"
            aria-label="Search templates"
          />
        </Bar>
      }
    >
      <Card pad={false}>
        {!loaded ? (
          <>
            <TableHead columns={COLUMNS} />
            <SkeletonRows count={4} />
          </>
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : rows.length ? (
          <>
            <TableHead columns={COLUMNS} />
            {rows.map((t) => (
              <Row key={t.id}>
                <RowTitle
                  title={t.name}
                  meta={
                    <>
                      v{t.versionNo}
                      {t.category ? ` · ${t.category}` : ""}
                      {` · ${t.sectionCount ?? 0} section${t.sectionCount === 1 ? "" : "s"}`}
                      {t.usageCount ? ` · used by ${t.usageCount} survey${t.usageCount === 1 ? "" : "s"}` : ""}
                    </>
                  }
                />
                <div>
                  <Chip tone={STATUS_TONE[t.status]}>{t.status}</Chip>
                </div>
                <RowStat value={t.questionCount ?? 0} unit="questions" />
                <div className="text-muted-foreground text-xs">
                  {t.updatedAt ? ago(t.updatedAt) : "—"}
                </div>
              </Row>
            ))}
          </>
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
