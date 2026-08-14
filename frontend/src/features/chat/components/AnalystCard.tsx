/**
 * The lead analyst's briefing — moved here from Settings so this page owns the
 * WHOLE intake pipeline: the widget a visitor talks to, and the analyst that
 * assesses what comes in. Both agents' identities stay CLI-managed; what this
 * card owns is the part of the briefing that gets APPENDED per run.
 *
 * Fetches on mount, independently of the widget column beside it — the widget
 * config is localStorage and cannot fail, while this is a real read that owes
 * its own loading and error states.
 */

import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "../../../ui/Button";
import { Bar, Card } from "../../../ui/Card";
import { TextLines } from "../../../ui/Skeleton";
import { ErrorState } from "../../../ui/States";
import { useToast } from "../../../ui/Toast";
import {
  getAnalystSettings,
  putPrompt,
  resetAnalystTask,
  type AnalystSettings,
} from "../api/analyst-util";

const FIELD_LABEL = "text-muted-foreground mb-1 block text-xs";

type Draft = { scopeNotes: string; analystTask: string };

export function AnalystCard() {
  const toast = useToast();

  const [settings, setSettings] = useState<AnalystSettings | null>(null);
  // Controlled from a draft seeded once the settings arrive, so an in-progress
  // edit is never overwritten by a re-render.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  // The prompt preview is a reference view, not an editing surface, so it stays
  // folded away: open, it is taller than everything above it put together and
  // it pushed the two editable fields off the bottom of the column.
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    let live = true;
    setSettings(null);
    setError(null);

    getAnalystSettings().then(({ data, error: err }) => {
      if (!live) return;
      if (err) {
        setError(err);
        return;
      }
      if (data) {
        setSettings(data);
        setDraft({
          scopeNotes: data.prompt?.scopeNotes ?? "",
          analystTask: data.prompt?.analystTask ?? "",
        });
      }
    });

    return () => {
      live = false;
    };
  }, [reloadKey]);

  const savePrompt = async () => {
    if (!draft) return;
    setSaving(true);
    const { error: err } = await putPrompt(draft);
    setSaving(false);
    if (err) {
      toast(err, true);
      return;
    }
    toast("Briefing saved");
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

  if (error) {
    return (
      <Card title="Lead analyst agent">
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} tight />
      </Card>
    );
  }

  if (!settings || !draft) {
    return (
      <Card title="Lead analyst agent">
        <TextLines count={5} />
      </Card>
    );
  }

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
    <Card title="Lead analyst agent" meta="CLI-managed">
      {/* Neither agent's identity is editable here. The conversation runs on
          the `intake` agent and the assessment on the analyst; instructions,
          provider and model for both are fixed when each agent is created —
          change those with `facilio vibe agent update`. This card owns the
          part that gets APPENDED to every analyst briefing. */}
      <div className="text-muted-foreground text-xs">
        Runs on <span className="font-mono">intake</span>, assessed by{" "}
        <span className="font-mono">{settings.agent?.name || "lead-analyst"}</span>. Change either
        one's instructions, provider or model with{" "}
        <span className="font-mono">facilio vibe agent update</span>.
        {settings.agent?.linkConfigured ? null : (
          <div className="text-destructive mt-1">
            The Flow-AI link is not set (
            <span className="font-mono">facilio vibe agent get lead-analyst</span>), so server-side
            assessment will fail. Assessing from this console still works.
          </div>
        )}
      </div>

      <label className={`${FIELD_LABEL} mt-4`} htmlFor="an-scope">
        Scope notes — appended to the generated service brief
      </label>
      <Textarea
        id="an-scope"
        rows={3}
        value={draft.scopeNotes}
        placeholder="e.g. No high-rise façade work. Minimum job value AED 2,000."
        onChange={(e) => setDraft({ ...draft, scopeNotes: e.target.value })}
      />

      <label className={`${FIELD_LABEL} mt-4`} htmlFor="an-task">
        Task instruction — the closing line the analyst gets for every lead
      </label>
      <Textarea
        id="an-task"
        rows={2}
        value={draft.analystTask}
        onChange={(e) => setDraft({ ...draft, analystTask: e.target.value })}
      />

      <Bar className="mt-4">
        <Button variant="primary" onClick={() => void savePrompt()} disabled={saving}>
          Save briefing
        </Button>
        <Button onClick={() => void restoreTask()} disabled={saving}>
          Restore default task
        </Button>
      </Bar>

      <div className="text-muted-foreground mt-3 text-xs">
        Applies to the next assessment; stored verdicts keep the prompt version that produced them.
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">What the analyst receives</span>
        <Button small onClick={() => setShowPrompt(!showPrompt)}>
          {showPrompt ? "Hide" : "Show"}
        </Button>
      </div>
      {showPrompt ? (
        <pre className="bg-muted text-muted-foreground mt-2 max-h-60 overflow-auto rounded-md p-3 font-mono text-[11px] whitespace-pre-wrap">
          {promptPreview}
        </pre>
      ) : null}
    </Card>
  );
}
