/**
 * The template list.
 *
 * ⚠ SEAM: makes NO request. `form.template-list` is written in
 * `api/templates-util.ts` but the `form` function does not exist, so this page
 * renders its real empty state rather than firing at a missing endpoint and
 * showing an error on every load.
 *
 * That is also why there is no loading or error state here yet: nothing loads
 * and nothing can fail. They arrive with the effect, not before it — a `loading`
 * flag nothing reads is an unused local and fails the build.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FilePlus2, Plus } from "lucide-react";
import { PageShell } from "../../../app/shell/PageShell";
import { Bar, Card } from "../../../ui/Card";
import { Empty } from "../../../ui/States";
import { Tabs, type Tab } from "../../../ui/Tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TemplateStatus } from "../types/template";

type Filter = TemplateStatus | "all";

const TABS: Tab<Filter>[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "published", label: "Published" },
  { id: "archived", label: "Archived" },
];

export function TemplateList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

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
          <Tabs items={TABS} active={filter} onChange={setFilter} />
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
    </PageShell>
  );
}
