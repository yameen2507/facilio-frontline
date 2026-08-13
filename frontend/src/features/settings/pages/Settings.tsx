/**
 * Scope & SLA — what we do, where, and how fast we respond.
 *
 * This is the surface the AI's relevance judgement comes from: coverage decides
 * what counts as in-scope, and the prompt fields decide how the analyst is briefed.
 *
 * The form is controlled from a single `draft` object seeded once the settings
 * arrive, so an in-progress edit is never overwritten by a re-render.
 */

import { useEffect, useState } from "react";
import { PageShell } from "../../../app/shell/PageShell";
import { Button } from "../../../ui/Button";
import { Bar, Card, Split } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Row, RowTitle } from "../../../ui/Row";
import { SettingsSkeleton } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { useToast } from "../../../ui/Toast";
import { getSettings, putPrompt, putSla, resetAnalystTask, type Settings as SettingsShape } from "../api/settings-util";

type Draft = {
  firstResponseMins: string;
  qualificationMins: string;
  assignmentMins: string;
  analystAgent: string;
  analystAgentLink: string;
  scopeNotes: string;
  analystTask: string;
};

const draftFrom = (s: SettingsShape): Draft => ({
  firstResponseMins: String(s.sla.firstResponseMins),
  qualificationMins: String(s.sla.qualificationMins),
  assignmentMins: String(s.sla.assignmentMins),
  analystAgent: s.agent?.name ?? "",
  analystAgentLink: s.agent?.link ?? "",
  scopeNotes: s.prompt?.scopeNotes ?? "",
  analystTask: s.prompt?.analystTask ?? "",
});

export function Settings() {
  const toast = useToast();

  const [settings, setSettings] = useState<SettingsShape | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setSettings(null);
    setError(null);

    getSettings().then(({ data, error: err }) => {
      if (!live) return;
      if (err) {
        setError(err);
        return;
      }
      if (data) {
        setSettings(data);
        setDraft(draftFrom(data));
      }
    });

    return () => {
      live = false;
    };
  }, [reloadKey]);

  if (error) {
    return (
      <PageShell title="Settings">
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </PageShell>
    );
  }

  // This surface previously rendered nothing at all while it loaded.
  if (!settings || !draft) {
    return (
      <PageShell title="Settings" subtitle="What we do, where, and how fast we respond">
        <SettingsSkeleton />
      </PageShell>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });

  const lineById = Object.fromEntries(settings.serviceLines.map((l) => [l.id, l]));

  const saveSla = async () => {
    setSaving(true);
    const { error: err } = await putSla({
      firstResponseMins: Number(draft.firstResponseMins),
      qualificationMins: Number(draft.qualificationMins),
      assignmentMins: Number(draft.assignmentMins),
    });
    setSaving(false);
    // Overdue is derived when the list is read, so a change here shows on the
    // inbox immediately — there is nothing to invalidate.
    if (err) toast(err, true);
    else toast("Targets saved");
  };

  const savePrompt = async () => {
    setSaving(true);
    const { error: err } = await putPrompt({
      // Both identifiers go through optStr server-side, so a blank one means
      // "leave it alone" — the prompt fields below are the ones "" clears.
      analystAgent: draft.analystAgent,
      analystAgentLink: draft.analystAgentLink,
      scopeNotes: draft.scopeNotes,
      analystTask: draft.analystTask,
    });
    setSaving(false);
    if (err) {
      toast(err, true);
      return;
    }
    toast("Prompt saved");
    setReloadKey((k) => k + 1);
  };

  const restoreTask = async () => {
    setSaving(true);
    const { error: err } = await resetAnalystTask();
    setSaving(false);
    if (err) {
      toast(err, true);
      return;
    }
    toast("Default task restored");
    setReloadKey((k) => k + 1);
  };

  // The lead block is shown as a placeholder: the brief and the closing task are
  // the same on every run; the fields between them are the lead being assessed.
  const promptPreview = [
    settings.brief ?? "",
    "",
    "LEAD:",
    "Company: …   City: …   Service asked for: …   Enquiry: …",
    "",
    draft.analystTask,
  ].join("\n");

  return (
    <PageShell title="Settings" subtitle="What we do, where, and how fast we respond">
      <Split>
        <Card title="Service coverage" pad={false}>
          {settings.areas.length ? (
            <>
              {settings.areas.map((area) => {
                const served = settings.coverage
                  .filter((c) => c.areaId === area.id && c.active === "true")
                  .map((c) => lineById[c.serviceLineId])
                  .filter(Boolean);
                return (
                  <Row key={area.id} style={{ gridTemplateColumns: "180px 1fr" }}>
                    <RowTitle title={area.name} meta={area.country ?? ""} />
                    <div>
                      {served.length ? (
                        served.map((l) => (
                          <span key={l.id} className="mr-1">
                            <Chip tone="blue">{`${l.code} · ${l.name}`}</Chip>
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground mt-px text-xs">nothing enabled</span>
                      )}
                    </div>
                  </Row>
                );
              })}
              <div className="border-t p-4">
                <span className="text-muted-foreground text-xs">
                  This is what the AI checks a lead against. A service outside these areas is scored{" "}
                  <Chip>outside region</Chip> automatically.
                </span>
              </div>
            </>
          ) : (
            <Empty title="No areas configured" body="Coverage arrives with the seed import." tight />
          )}
        </Card>

        <Card title="Response targets">
          <label className="text-muted-foreground mt-4 mb-1 block text-xs">First response (minutes)</label>
          <Input
            type="number"
            value={draft.firstResponseMins}
            onChange={(e) => set("firstResponseMins", e.target.value)}
          />
          <label className="text-muted-foreground mt-4 mb-1 block text-xs">Qualification (minutes)</label>
          <Input
            type="number"
            value={draft.qualificationMins}
            onChange={(e) => set("qualificationMins", e.target.value)}
          />
          <label className="text-muted-foreground mt-4 mb-1 block text-xs">Hand to sales (minutes)</label>
          <Input type="number" value={draft.assignmentMins} onChange={(e) => set("assignmentMins", e.target.value)} />
          <Bar className="mt-4">
            <Button variant="primary" onClick={() => void saveSla()} disabled={saving}>
              Save targets
            </Button>
          </Bar>
          <div className="text-muted-foreground mt-3 text-xs">
            Overdue is worked out when the list loads, so a change here shows immediately — set the first target to 1
            minute to watch the inbox turn red.
          </div>
        </Card>
      </Split>

      <div className="mt-4">
        <Card title="Lead analyst agent" meta="provider, model and schema are CLI-managed">
          <Split>
            <div>
              <label className="text-muted-foreground mt-0 mb-1 block text-xs">
                Name the browser resolves
              </label>
              <Input
                type="text"
                value={draft.analystAgent}
                placeholder="lead-analyst"
                onChange={(e) => set("analystAgent", e.target.value)}
              />
            </div>
            <div>
              <label className="text-muted-foreground mt-0 mb-1 block text-xs">
                Flow-AI link name (server path)
              </label>
              <Input
                type="text"
                value={draft.analystAgentLink}
                placeholder="lead-analyst_&lt;appuuid&gt;"
                onChange={(e) => set("analystAgentLink", e.target.value)}
              />
            </div>
          </Split>

          <div className="text-muted-foreground mt-2 text-xs">
            Both point at an agent created with the CLI — copy them from{" "}
            <span className="font-mono">facilio vibe agent get lead-analyst</span>. They are two different identifiers:
            passing one where the other belongs returns <i>agent not found</i>. A blank field leaves the saved value
            unchanged.
            {settings.agent?.linkConfigured ? null : (
              <div className="text-destructive mt-1">
                The link name is not set, so server-side assessment will fail. Assessing from this console still works.
              </div>
            )}
          </div>

          <label className="text-muted-foreground mt-4 mb-1 block text-xs">
            Scope notes — appended to the generated service brief
          </label>
          <Textarea
            rows={3}
            value={draft.scopeNotes}
            placeholder="e.g. No high-rise façade work. Minimum job value AED 2,000."
            onChange={(e) => set("scopeNotes", e.target.value)}
          />

          <label className="text-muted-foreground mt-4 mb-1 block text-xs">
            Task instruction — the closing line the analyst gets for every lead
          </label>
          <Textarea rows={2} value={draft.analystTask} onChange={(e) => set("analystTask", e.target.value)} />

          <Bar className="mt-4">
            <Button variant="primary" onClick={() => void savePrompt()} disabled={saving}>
              Save agent settings
            </Button>
            <Button onClick={() => void restoreTask()} disabled={saving}>
              Restore default task
            </Button>
          </Bar>

          <div className="text-muted-foreground mt-3 text-xs">
            Applies to the next assessment; stored verdicts keep the prompt version that produced them. The agent's own
            instructions, provider, model and output schema are fixed when the agent is created — change those with{" "}
            <span className="font-mono">facilio vibe agent update</span>.
          </div>

          <label className="text-muted-foreground mt-4 mb-1 block text-xs">What the analyst receives</label>
          <pre className="bg-muted text-muted-foreground mt-1 max-h-60 overflow-auto rounded-md p-3 font-mono text-[11px] whitespace-pre-wrap">
            {promptPreview}
          </pre>
        </Card>
      </div>
    </PageShell>
  );
}
