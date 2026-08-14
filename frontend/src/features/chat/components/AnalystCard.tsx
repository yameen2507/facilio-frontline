/**
 * The lead analyst's briefing — the third card of the intake agent page.
 *
 * CONTROLLED, deliberately: the page owns the fetch and the draft so its one
 * Publish button can save this alongside the widget config. This card only
 * renders fields and reports edits; loading and error live with the owner.
 *
 * Neither agent's identity is editable here. The conversation runs on the
 * `intake` agent and the assessment on the analyst; instructions, provider and
 * model for both are fixed when each agent is created — change those with
 * `facilio vibe agent update`. This card owns the part APPENDED per run.
 */

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import type { AnalystSettings } from "../api/analyst-util";
import { FIELD_HINT, FIELD_LABEL } from "../fields";

export type AnalystDraft = { scopeNotes: string; analystTask: string };

export function AnalystCard({
  settings,
  draft,
  onChange,
}: {
  settings: AnalystSettings;
  draft: AnalystDraft;
  onChange: (draft: AnalystDraft) => void;
}) {
  // The prompt preview is a reference view, not an editing surface, so it stays
  // folded away: open, it is taller than everything above it put together.
  const [showPrompt, setShowPrompt] = useState(false);

  const linked = Boolean(settings.agent?.linkConfigured);
  const agentName = settings.agent?.name || "lead-analyst";

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
    <Card
      title="Lead analysis"
      meta={
        <Chip tone={linked ? "green" : "orange"} dot small>
          {linked ? `${agentName} connected` : "link not set"}
        </Chip>
      }
    >
      <div className="text-muted-foreground text-xs">
        Every captured lead is scored by the <span className="font-mono">{agentName}</span> agent.
        {linked ? null : (
          <span className="text-destructive">
            {" "}
            The Flow-AI link is not set — read it with{" "}
            <span className="font-mono">facilio vibe agent get {agentName}</span> and save it via{" "}
            <span className="font-mono">settings-put</span>. Until then only this console can assess.
          </span>
        )}
      </div>

      <label className={`${FIELD_LABEL} mt-4`} htmlFor="an-scope">
        Scope notes
      </label>
      <Textarea
        id="an-scope"
        rows={3}
        value={draft.scopeNotes}
        placeholder="e.g. No high-rise façade work. Minimum job value AED 2,000."
        onChange={(e) => onChange({ ...draft, scopeNotes: e.target.value })}
      />
      <span className={FIELD_HINT}>Added to the service brief the analyst judges against.</span>

      <label className={`${FIELD_LABEL} mt-4`} htmlFor="an-task">
        Task instruction
      </label>
      <Textarea
        id="an-task"
        rows={2}
        value={draft.analystTask}
        onChange={(e) => onChange({ ...draft, analystTask: e.target.value })}
      />
      <span className={FIELD_HINT}>The closing line of every assessment. Empty restores the default.</span>

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
