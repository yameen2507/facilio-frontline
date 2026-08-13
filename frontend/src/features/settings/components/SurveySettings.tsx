/**
 * The survey module's settings card — self-contained on purpose. The rest of
 * the Settings page drafts and saves against the `lead` function; this card
 * talks to `survey.settings-get/put`, because a module owns its own settings
 * and functions are never widened across module lines.
 *
 * The scale direction is decision D-e and it FEEDS PRICING: the FM convention
 * reads 5 as excellent, the cleaning-buildup convention reads 5 as filthy, and
 * both conventions live in this product. Two teams reading the same number
 * opposite ways is real money on a semi-comprehensive contract — which is why
 * this is a visible org decision here, not a constant buried in code.
 */

import { useEffect, useState } from "react";
import { Card } from "../../../ui/Card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSurveySettings, putSurveySettings, type SurveySettings } from "../api/settings-util";

export function SurveySettingsCard() {
  const [settings, setSettings] = useState<SurveySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [direction, setDirection] = useState("1_is_worst");
  const [threshold, setThreshold] = useState("2");

  useEffect(() => {
    let live = true;
    getSurveySettings().then(({ data, error: err }) => {
      if (!live) return;
      setError(err);
      if (data) {
        setSettings(data);
        setDirection(data.conditionScaleDirection);
        setThreshold(String(data.requirePhotoBelowCondition));
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    const { data, error: err } = await putSurveySettings({
      conditionScaleDirection: direction,
      requirePhotoBelowCondition: Number(threshold),
    });
    setSaving(false);
    if (err || !data) {
      setError(err ?? "The settings did not save");
      return;
    }
    setSettings(data.settings);
    setSaved(true);
  };

  const labels = settings?.conditionScaleLabels ?? {};
  const scale =
    direction === "5_is_worst" ? [1, 2, 3, 4, 5].map((n) => 6 - n) : [1, 2, 3, 4, 5];

  return (
    <Card
      title="Survey capture"
      meta="the condition scale feeds pricing — change its direction deliberately"
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">Condition scale direction (D-e)</span>
          <div className="flex flex-col gap-2">
            {[
              {
                value: "1_is_worst",
                label: "1 is worst — 5 = excellent (the FM convention)",
              },
              {
                value: "5_is_worst",
                label: "5 is worst — 5 = filthy (the cleaning-buildup convention)",
              },
            ].map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="scale-direction"
                  checked={direction === opt.value}
                  onChange={() => setDirection(opt.value)}
                  className="size-4"
                />
                {opt.label}
              </label>
            ))}
          </div>
          {/* The words the surveyor sees, in the direction chosen above. */}
          <div className="text-muted-foreground text-xs">
            Reads as:{" "}
            {[1, 2, 3, 4, 5]
              .map((n, i) => `${n} ${labels[String(scale[i])] ?? ""}`)
              .join(" · ")}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs">
            A condition at or below this needs a photo before it can be saved
          </span>
          <Input
            type="number"
            min={0}
            max={5}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-20"
          />
          <span className="text-muted-foreground text-xs">0 disables the rule</span>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} disabled={saving || !settings}>
            {saving ? "Saving…" : "Save survey settings"}
          </Button>
          {saved ? <span className="text-muted-foreground text-xs">Saved.</span> : null}
          {error ? <span className="text-destructive text-xs">{error}</span> : null}
        </div>
      </div>
    </Card>
  );
}
