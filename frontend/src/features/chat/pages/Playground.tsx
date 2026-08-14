/**
 * The web-widget playground: configuration and the live widget on ONE page,
 * the way Chatbase's Playground does it — edit on the left, see it on the
 * right, no separate preview step.
 *
 * Config drives the preview LIVE from the draft state; Save only persists it.
 * The one exception is the greeting, which a running conversation cannot
 * honestly swap mid-transcript (the agent must see the same first message the
 * visitor saw) — it applies when the next conversation starts, and the panel
 * says so.
 *
 * This page owns the WHOLE intake pipeline: the widget a visitor talks to
 * (presentation, saved in this browser) and the lead analyst's briefing (the
 * scope notes and task appended to every assessment — a real settings read,
 * in its own card). The agents' identities stay CLI-managed either way; the
 * intake agent's instructions, provider and model are fixed at creation.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "../../../app/shell/PageShell";
import { Button } from "../../../ui/Button";
import { Bar, Card } from "../../../ui/Card";
import { useToast } from "../../../ui/Toast";
import {
  loadWidgetConfig,
  saveWidgetConfig,
  WIDGET_DEFAULTS,
  type WidgetConfig,
} from "../api/widget-config";
import { AnalystCard } from "../components/AnalystCard";
import { WidgetPreview } from "../components/WidgetPreview";

const FIELD_LABEL = "text-muted-foreground mb-1 block text-xs";

export function Playground() {
  const toast = useToast();
  const [config, setConfig] = useState<WidgetConfig>(loadWidgetConfig);

  const set = <K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) =>
    setConfig({ ...config, [key]: value });

  const save = () => {
    const ok = saveWidgetConfig(config);
    toast(ok ? "Widget saved" : "Could not save — storage is unwritable", !ok);
  };

  const reset = () => {
    setConfig(WIDGET_DEFAULTS);
    saveWidgetConfig(WIDGET_DEFAULTS);
    toast("Widget reset to defaults");
  };

  return (
    <PageShell title="Web widget" subtitle="The intake pipeline: the widget, and the analyst that assesses what comes in">
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card title="Widget">
            <label className={FIELD_LABEL} htmlFor="w-site">
              Site label
            </label>
            <Input
              id="w-site"
              type="text"
              value={config.siteLabel}
              placeholder={WIDGET_DEFAULTS.siteLabel}
              onChange={(e) => set("siteLabel", e.target.value)}
            />

            <label className={`${FIELD_LABEL} mt-4`} htmlFor="w-intro">
              Header line
            </label>
            <Input
              id="w-intro"
              type="text"
              value={config.introLine}
              placeholder={WIDGET_DEFAULTS.introLine}
              onChange={(e) => set("introLine", e.target.value)}
            />

            <label className={`${FIELD_LABEL} mt-4`} htmlFor="w-greeting">
              Greeting — applies when the next conversation starts
            </label>
            <Textarea
              id="w-greeting"
              rows={2}
              value={config.greeting}
              placeholder="Empty uses the server's greeting"
              onChange={(e) => set("greeting", e.target.value)}
            />

            <label className={`${FIELD_LABEL} mt-4`} htmlFor="w-accent">
              Visitor bubble colour
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="w-accent"
                type="color"
                // A colour input cannot be empty, so the swatch shows the pick
                // and "Use theme colour" is what clears it.
                value={config.accent || "#171717"}
                onChange={(e) => set("accent", e.target.value)}
                className="h-9 w-14 cursor-pointer p-1"
              />
              {config.accent ? (
                <Button small onClick={() => set("accent", "")}>
                  Use theme colour
                </Button>
              ) : (
                <span className="text-muted-foreground text-xs">Following the theme</span>
              )}
            </div>

            <Bar className="mt-4">
              <Button variant="primary" onClick={save}>
                Save widget
              </Button>
              <Button onClick={reset}>Reset to defaults</Button>
            </Bar>

            <div className="text-muted-foreground mt-3 text-xs">
              Saved in this browser — the embed script's settings endpoint is not built yet, so this
              styles the playground only.
            </div>
          </Card>

          {/* The analyst's briefing, under the widget it assesses for. Its own
              fetch and states — the widget column is localStorage and cannot
              fail; this can, and must say so without taking the page with it. */}
          <AnalystCard />
        </div>

        {/* The dotted canvas the reference tools preview on — it reads as "the
            widget floats on someone else's page", not as our console. */}
        <div className="rounded-xl border bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px] p-6 lg:p-10">
          <WidgetPreview config={config} />
        </div>
      </div>
    </PageShell>
  );
}
