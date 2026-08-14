/**
 * The intake agent page: configuration and the live widget on ONE page, the
 * way Chatbase's Playground does it — edit on the left, see it on the right,
 * no separate preview step. Config drives the preview LIVE from the draft
 * state; ONE Publish button in the page header persists all of it.
 *
 * Three cards, grouped by the question they answer:
 *   Appearance   — how the widget looks (logo, name, tagline, colour)
 *   Conversation — what it says (greeting, per-turn guidance)
 *   Lead analysis — how what it captures is scored (the analyst's briefing)
 *
 * Two independent fetches feed them: the widget config (`widget-get`, one
 * setting row) and the analyst settings (`settings-get`). Each has its OWN
 * reload key so retrying the one that failed cannot re-fetch — and wipe the
 * unpublished draft of — the one that didn't.
 *
 * The greeting is the one field the preview cannot apply mid-transcript (the
 * agent must see the same first message the visitor saw) — it applies when the
 * next conversation starts, and its hint says so.
 */

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PageShell } from "../../../app/shell/PageShell";
import { withDefaults } from "../../../lib/request";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { TextLines } from "../../../ui/Skeleton";
import { ErrorState } from "../../../ui/States";
import { useToast } from "../../../ui/Toast";
import { getAnalystSettings, putPrompt, type AnalystSettings } from "../api/analyst-util";
import {
  ACCENT_PRESETS,
  getWidgetConfig,
  putWidgetConfig,
  WIDGET_DEFAULTS,
  type WidgetConfig,
} from "../api/widget-config";
import { AnalystCard, type AnalystDraft } from "../components/AnalystCard";
import { WidgetPreview, WidgetSkeleton } from "../components/WidgetPreview";
import { FIELD_HINT, FIELD_LABEL } from "../fields";

/**
 * Downscale an upload to a 128px square data URL so a logo is a few KB riding
 * inside the one config row — never a file the embed would have to fetch
 * through the platform's auth wall.
 */
async function fileToLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file could not be read as an image"));
      i.src = url;
    });

    const SIZE = 128;
    const side = Math.min(img.width, img.height) || SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("That file could not be read as an image");
    // Centre-crop to a square, the shape the header renders it in.
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);

    // WebP is ~half the bytes; a browser that can't encode it answers with PNG.
    const webp = canvas.toDataURL("image/webp", 0.9);
    const data = webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
    if (data.length > 160_000) throw new Error("That image is too complex — try a simpler logo");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function Playground() {
  const toast = useToast();

  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [widgetReload, setWidgetReload] = useState(0);

  const [analyst, setAnalyst] = useState<AnalystSettings | null>(null);
  // Controlled from a draft seeded once the settings arrive, so an in-progress
  // edit is never overwritten by a re-render.
  const [analystDraft, setAnalystDraft] = useState<AnalystDraft | null>(null);
  const [analystError, setAnalystError] = useState<string | null>(null);
  const [analystReload, setAnalystReload] = useState(0);

  const [publishing, setPublishing] = useState(false);

  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let live = true;
    setConfig(null);
    setConfigError(null);
    getWidgetConfig().then(({ data, error }) => {
      if (!live) return;
      if (error || !data) setConfigError(error ?? "Could not load the widget");
      else setConfig(withDefaults(WIDGET_DEFAULTS, data.config));
    });
    return () => {
      live = false;
    };
  }, [widgetReload]);

  useEffect(() => {
    let live = true;
    setAnalyst(null);
    setAnalystDraft(null);
    setAnalystError(null);
    getAnalystSettings().then(({ data, error }) => {
      if (!live) return;
      if (error || !data) {
        setAnalystError(error ?? "Could not load the analyst settings");
        return;
      }
      setAnalyst(data);
      setAnalystDraft({
        scopeNotes: data.prompt?.scopeNotes ?? "",
        analystTask: data.prompt?.analystTask ?? "",
      });
    });
    return () => {
      live = false;
    };
  }, [analystReload]);

  const set = <K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) =>
    setConfig((c) => (c ? { ...c, [key]: value } : c));

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      set("logo", await fileToLogo(file));
    } catch (err) {
      toast(err instanceof Error ? err.message : "That image could not be used", true);
    }
  };

  /** The one save. Both writes run together; each half reseeds from what the
      server stored the moment IT succeeds, so a failure in the other half is
      reported without pretending this one didn't publish. */
  const publish = async () => {
    if (!config || !analystDraft) return;
    setPublishing(true);
    const [widget, prompt] = await Promise.all([putWidgetConfig(config), putPrompt(analystDraft)]);
    setPublishing(false);

    if (widget.data) setConfig(withDefaults(WIDGET_DEFAULTS, widget.data.config));
    if (prompt.data?.settings) {
      // An empty task comes back as the restored default, and the brief may
      // have re-rendered — the response is the truth, not the draft.
      setAnalyst(prompt.data.settings);
      setAnalystDraft({
        scopeNotes: prompt.data.settings.prompt?.scopeNotes ?? "",
        analystTask: prompt.data.settings.prompt?.analystTask ?? "",
      });
    }

    const error = widget.error ?? prompt.error;
    if (error) {
      toast(error, true);
      return;
    }
    toast("Published — live from the next conversation");
  };

  // The preview follows the DRAFT, so edits show before they are published;
  // while the config loads, the canvas blobs fall back to the theme colour.
  const accent = config?.accent || "var(--primary)";
  const loadFailed = Boolean(configError || analystError);

  return (
    <PageShell
      title="Intake agent"
      subtitle="Your website chat, and how its leads are assessed"
      actions={
        <Button
          variant="primary"
          onClick={() => void publish()}
          disabled={publishing || !config || !analystDraft}
          title={
            loadFailed
              ? "Fix the load error first"
              : !config || !analystDraft
                ? "Still loading"
                : undefined
          }
        >
          {publishing ? "Publishing…" : "Publish"}
        </Button>
      }
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          {configError ? (
            <Card title="Widget">
              <ErrorState message={configError} onRetry={() => setWidgetReload((k) => k + 1)} tight />
            </Card>
          ) : !config ? (
            <>
              <Card title="Appearance">
                <TextLines count={4} />
              </Card>
              <Card title="Conversation">
                <TextLines count={3} />
              </Card>
            </>
          ) : (
            <>
              <Card title="Appearance">
                <span className={FIELD_LABEL}>Logo</span>
                <div className="flex items-center gap-3">
                  {config.logo ? (
                    <img
                      src={config.logo}
                      alt="Widget logo"
                      className="size-11 shrink-0 rounded-xl border object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="bg-primary text-primary-foreground grid size-11 shrink-0 place-items-center rounded-xl text-base font-semibold"
                      style={config.accent ? { background: config.accent, color: "#fff" } : undefined}
                    >
                      {(config.companyName.trim()[0] ?? "•").toUpperCase()}
                    </div>
                  )}
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      void pickLogo(e.target.files?.[0]);
                      e.target.value = ""; // so re-picking the same file fires again
                    }}
                  />
                  <Button small onClick={() => fileInput.current?.click()}>
                    Upload
                  </Button>
                  {config.logo ? (
                    <Button small onClick={() => set("logo", "")}>
                      Remove
                    </Button>
                  ) : null}
                </div>

                <label className={`${FIELD_LABEL} mt-4`} htmlFor="w-company">
                  Company name
                </label>
                <Input
                  id="w-company"
                  type="text"
                  value={config.companyName}
                  placeholder={WIDGET_DEFAULTS.companyName}
                  onChange={(e) => set("companyName", e.target.value)}
                />

                <label className={`${FIELD_LABEL} mt-4`} htmlFor="w-tagline">
                  Tagline
                </label>
                <Input
                  id="w-tagline"
                  type="text"
                  value={config.tagline}
                  placeholder={WIDGET_DEFAULTS.tagline}
                  onChange={(e) => set("tagline", e.target.value)}
                />
                <span className={FIELD_HINT}>The line under the name in the widget header.</span>

                <span className={`${FIELD_LABEL} mt-4`}>Brand colour</span>
                <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Brand colour">
                  {/* First swatch is the theme itself — selected means "follow
                      the console theme", which is also what empty stores. */}
                  <Swatch
                    name="Theme"
                    selected={config.accent === ""}
                    fill="var(--primary)"
                    onPick={() => set("accent", "")}
                  />
                  {ACCENT_PRESETS.map((c) => (
                    <Swatch
                      key={c.value}
                      name={c.name}
                      selected={config.accent === c.value}
                      fill={c.value}
                      onPick={() => set("accent", c.value)}
                    />
                  ))}
                </div>
              </Card>

              <Card title="Conversation">
                <label className={FIELD_LABEL} htmlFor="w-greeting">
                  Greeting
                </label>
                <Textarea
                  id="w-greeting"
                  rows={2}
                  value={config.greeting}
                  placeholder="Empty uses the built-in greeting"
                  onChange={(e) => set("greeting", e.target.value)}
                />
                <span className={FIELD_HINT}>Opens every chat. Applies from the next conversation.</span>

                <label className={`${FIELD_LABEL} mt-4`} htmlFor="w-guidance">
                  Guidance
                </label>
                <Textarea
                  id="w-guidance"
                  rows={3}
                  value={config.guidance}
                  placeholder="e.g. Keep replies short. We respond within one business day. Never promise a same-day visit."
                  onChange={(e) => set("guidance", e.target.value)}
                />
                <span className={FIELD_HINT}>
                  Instructions the assistant follows in every chat — tone, offers, what not to say.
                </span>
              </Card>
            </>
          )}

          {analystError ? (
            <Card title="Lead analysis">
              <ErrorState message={analystError} onRetry={() => setAnalystReload((k) => k + 1)} tight />
            </Card>
          ) : !analyst || !analystDraft ? (
            <Card title="Lead analysis">
              <TextLines count={4} />
            </Card>
          ) : (
            <AnalystCard settings={analyst} draft={analystDraft} onChange={setAnalystDraft} />
          )}
        </div>

        {/* The canvas the reference tools preview on — it reads as "the widget
            floats on someone else's page". Two accent-tinted blobs under the
            dot grid give the glass something to blur; both follow the draft
            colour live. Sticky so the preview rides along while the form
            column scrolls.

            The min-height fills the scroller exactly on desktop: 100dvh minus
            the PageShell band (61px = py-3 + one min-h-9 row + border) minus
            the body's pt-6/pb-6 (48px). Content-sized, the canvas ended
            mid-viewport and the page trailed off into dead space below it;
            full, it frames the (vertically centred) widget like a stage. */}
        <div className="relative overflow-hidden rounded-xl border p-4 sm:p-8 lg:sticky lg:top-6 lg:flex lg:min-h-[calc(100dvh-109px)] lg:items-center lg:justify-center">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px]"
          />
          <div
            aria-hidden="true"
            className="absolute -top-16 -left-12 size-72 rounded-full opacity-30 blur-3xl"
            style={{ background: accent }}
          />
          <div
            aria-hidden="true"
            className="absolute -right-16 -bottom-20 size-80 rounded-full opacity-25 blur-3xl"
            style={{ background: accent }}
          />
          {config ? <WidgetPreview config={config} /> : <WidgetSkeleton />}
        </div>
      </div>
    </PageShell>
  );
}

/** One colour choice. A ring names the pick; the title names the colour. */
function Swatch({
  name,
  fill,
  selected,
  onPick,
}: {
  name: string;
  fill: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={name}
      title={name}
      onClick={onPick}
      className={cn(
        "size-7 cursor-pointer rounded-full border border-black/10 transition-transform hover:scale-110 motion-reduce:transition-none dark:border-white/20",
        selected && "ring-ring ring-offset-background ring-2 ring-offset-2"
      )}
      style={{ background: fill }}
    />
  );
}
