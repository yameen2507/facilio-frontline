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
import { useNavigate } from "react-router-dom";
import { ClipboardList, Plus } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { ago } from "../../../lib/format";
import { Bar, Card } from "../../../ui/Card";
import { Row, RowStat, RowTitle, TableHead } from "../../../ui/Row";
import { SkeletonRows } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { Tabs, type Tab } from "../../../ui/Tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listSurveys } from "../api/surveys-util";
import { NewSurveyDialog } from "../components/NewSurveyDialog";
import { SurveyStatusChip } from "../components/SurveyChips";
import type { Survey, SurveyStatus } from "../types/survey";

type Filter = SurveyStatus | "all";

/**
 * `draft` and `cancelled` are deliberately not tabs: the working set is what is
 * live. Both remain reachable through All and search.
 */
const TABS: Tab<Filter>[] = [
  { id: "all", label: "All" },
  { id: "scheduled", label: "Scheduled" },
  { id: "assigned", label: "Assigned" },
  { id: "in_progress", label: "In progress" },
  { id: "pending_review", label: "Pending review" },
  { id: "completed", label: "Completed" },
];

const COLUMNS = ["Survey", "Status", "Visits", "Created"];

export function SurveyList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

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
      if (data) setSurveys(data.surveys);
    });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return surveys.filter(
      (s) =>
        (filter === "all" || s.status === filter) &&
        (!q ||
          s.refNo.toLowerCase().includes(q) ||
          (s.title ?? "").toLowerCase().includes(q) ||
          (s.accountName ?? "").toLowerCase().includes(q))
    );
  }, [surveys, filter, search]);

  return (
    <PageShell
      title="Surveys"
      subtitle="Condition surveys against a deal"
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New survey
        </Button>
      }
      strip={
        <Bar className="justify-between pb-1">
          <Tabs items={TABS} active={filter} onChange={setFilter} />
          <Input
            type="text"
            placeholder="Search by number, account or site"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-72"
            aria-label="Search surveys"
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
            {rows.map((s) => (
              <Row key={s.id} onClick={() => navigate(`/surveys/${s.id}`)}>
                <RowTitle
                  title={
                    <>
                      <code className="mr-1.5 text-xs">{s.refNo}</code>
                      {s.title ?? "Untitled survey"}
                    </>
                  }
                  meta={
                    <>
                      {s.accountName ?? "No account"}
                      {s.templateName ? ` · ${s.templateName}` : " · from scratch"}
                      {" · "}
                      {s.leadUserEmail ? s.leadUserEmail.split("@")[0] : <em>no lead yet</em>}
                    </>
                  }
                />
                <div>
                  <SurveyStatusChip status={s.status} />
                </div>
                <RowStat value={s.visitCount ?? 0} unit="visits" />
                <div className="text-muted-foreground text-xs">
                  {s.createdAt ? ago(s.createdAt) : "—"}
                </div>
              </Row>
            ))}
          </>
        ) : surveys.length ? (
          <Empty title="Nothing matches" body="No survey in this tab matches the search." />
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

      <NewSurveyDialog open={creating} onOpenChange={setCreating} />
    </PageShell>
  );
}
