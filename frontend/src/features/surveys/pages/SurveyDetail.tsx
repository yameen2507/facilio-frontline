/**
 * The survey record — the lead's surface.
 *
 * ⚠ SEAM: makes NO request. `survey.get` is written and unused; the page renders
 * the not-found state because no survey can exist until the `survey` function
 * does. Every tab below is the real structure the handler's response maps onto.
 *
 * The tabs mirror the four questions actually asked of a survey: when is the
 * walk, who is doing it, what did they find, and what disagrees with the tender
 * documents. Reconciliation is its own tab rather than a section because it is
 * the lead's whole job at review, and because only the lead may decide a row.
 */

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { Card, Stack } from "../../../ui/Card";
import { Empty } from "../../../ui/States";
import { Tabs, type Tab } from "../../../ui/Tabs";
import { Button } from "@/components/ui/button";
import { SurveyStatusChip } from "../components/SurveyChips";
import { SURVEY_TRAIL } from "../types/survey";

type TabId = "overview" | "visits" | "team" | "portfolio" | "reconciliation";

const TABS: Tab<TabId>[] = [
  { id: "overview", label: "Overview" },
  { id: "visits", label: "Visits" },
  { id: "team", label: "Team" },
  { id: "portfolio", label: "Portfolio" },
  { id: "reconciliation", label: "Reconciliation" },
];

/** What each tab will hold, so the shape is legible before the data exists. */
const TAB_BODY: Record<TabId, { title: string; body: string }> = {
  overview: {
    title: "Nothing to show yet",
    body: "Status, the lead, completeness and coverage appear here once a survey exists.",
  },
  visits: {
    title: "No visits",
    body: "A visit is an appointment with a start and an end, so a two-day tender walk is one visit and not two. A no-show is recorded with a reason and deliberately does not move the survey forward.",
  },
  team: {
    title: "No one assigned",
    body: "A survey carries any number of assignees and exactly one lead. Only the lead can send it for review or submit it.",
  },
  portfolio: {
    title: "No nodes",
    body: "Site, building and space. Nodes seeded from the tender documents are verdicted on the walk; rooms found on site are added as the surveyor goes.",
  },
  reconciliation: {
    title: "Nothing to reconcile",
    body: "Every difference between what the tender documents claimed and what the surveyor found, side by side. The app suggests a value and a reason; the lead decides each row.",
  },
};

export function SurveyDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [tab, setTab] = useState<TabId>("overview");

  const current = TAB_BODY[tab];

  return (
    <PageShell
      title={id ? `Survey ${id}` : "Survey"}
      subtitle="The survey API is not connected yet"
      actions={
        <Button variant="outline" onClick={() => navigate("/surveys")}>
          <ArrowLeft className="size-4" />
          All surveys
        </Button>
      }
      strip={<Tabs items={TABS} active={tab} onChange={setTab} />}
    >
      <Stack>
        <Card pad={false}>
          <Empty title={current.title} body={current.body} />
        </Card>

        {/* The lifecycle is product information, not this survey's data — it is
            true before any survey exists, so showing it here is a legend rather
            than an invented record. */}
        {tab === "overview" ? (
          <Card title="How a survey moves">
            <div className="flex flex-wrap items-center gap-2">
              {SURVEY_TRAIL.map((status, i) => (
                <div key={status} className="flex items-center gap-2">
                  {i > 0 ? <ChevronRight className="text-muted-foreground size-3.5" /> : null}
                  <SurveyStatusChip status={status} />
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-3 text-sm">
              A survey can be cancelled from any state before completed, with a reason. Completed is
              terminal — a re-walk is a new linked survey, never a reopen. Only the lead can send a
              survey for review or submit it.
            </p>
          </Card>
        ) : null}
      </Stack>
    </PageShell>
  );
}
