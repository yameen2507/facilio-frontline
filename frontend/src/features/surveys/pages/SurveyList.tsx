/**
 * The survey list — one hardcoded default list.
 *
 * Saved views, column config and search are a PLATFORM concern (solved once
 * across leads, deals, quotes and surveys), not a survey one. Building a
 * survey-shaped view engine here guarantees a second, different one for deals
 * next week. What this module owes that layer when it lands is its filterable
 * fields: status, leadUserEmail, dealId, accountId, targetCompletionDate,
 * contractIntent, reworkCount, notVisitedPct.
 *
 * ⚠ SEAM: makes NO request — `survey.list` exists in `api/surveys-util.ts` but
 * the `survey` function is not built. Real empty state, no loading or error
 * state yet; both arrive with the effect.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Plus } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { Bar, Card } from "../../../ui/Card";
import { Empty } from "../../../ui/States";
import { Tabs, type Tab } from "../../../ui/Tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SurveyStatus } from "../types/survey";

type Filter = SurveyStatus | "all";

/**
 * `draft` and `cancelled` are deliberately not tabs: the working set is what is
 * live. Both remain reachable through search once the list has data.
 */
const TABS: Tab<Filter>[] = [
  { id: "all", label: "All" },
  { id: "scheduled", label: "Scheduled" },
  { id: "assigned", label: "Assigned" },
  { id: "in_progress", label: "In progress" },
  { id: "pending_review", label: "Pending review" },
  { id: "completed", label: "Completed" },
];

export function SurveyList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  return (
    <PageShell
      title="Surveys"
      subtitle="Condition surveys against a deal"
      actions={
        /* Creating a survey needs a real deal and the `survey` function; neither
           is reachable yet, so the action is present and disabled rather than
           opening a form that cannot save. */
        <Button disabled title="Creating a survey needs the survey API">
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
        <Empty
          title="No surveys yet"
          body="A survey is raised against a deal, then scheduled, assigned a lead, and walked. It ends at a frozen handoff payload the estimator prices from."
          action={
            <Button variant="outline" onClick={() => navigate("/templates")}>
              <ClipboardList className="size-4" />
              Start with a template
            </Button>
          }
        />
      </Card>
    </PageShell>
  );
}
