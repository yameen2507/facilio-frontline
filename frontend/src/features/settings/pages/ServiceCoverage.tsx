/**
 * Settings › Service coverage — what we do and where.
 *
 * Read-only: coverage decides what the AI counts as in-scope, and it arrives
 * with the seed import. It is a matrix OF the service catalogue, which is the
 * sibling section and the editable one (pages/Services.tsx); the analyst's
 * briefing lives on the Intake agent page with the rest of the intake pipeline.
 *
 * DELIBERATELY NOT HERE any more (removed 2026-08-14, defaults rule):
 * the response targets and the survey-capture card. Both run on the seeded
 * defaults (`migrate seed-config` — sla.* and survey.*), and both stay
 * editable without UI via `lead.settings-put` / `survey.settings-put`.
 * The parked card is components/SurveySettings.tsx if a surface is ever
 * wanted back.
 *
 * Content only — the PageShell and side nav belong to SettingsLayout.
 */

import { useEffect, useState } from "react";
import { Card } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { Row, RowTitle } from "../../../ui/Row";
import { SettingsSkeleton } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { SectionHeader } from "../components/SectionHeader";
import { getSettings, type Settings as SettingsShape } from "../api/settings-util";

const HEADER = (
  <SectionHeader
    title="Service coverage"
    description="Where we operate and what each area offers — what the AI checks a lead against"
  />
);

export function ServiceCoverage() {
  const [settings, setSettings] = useState<SettingsShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
      if (data) setSettings(data);
    });

    return () => {
      live = false;
    };
  }, [reloadKey]);

  // Every state renders inside the content column, so the side nav never
  // disappears — a section that fails must not take its siblings' routes down.
  if (error) {
    return (
      <>
        {HEADER}
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </>
    );
  }

  if (!settings) {
    return (
      <>
        {HEADER}
        <SettingsSkeleton />
      </>
    );
  }

  const lineById = Object.fromEntries(settings.serviceLines.map((l) => [l.id, l]));

  return (
    <>
      {HEADER}
      <Card title="Coverage by area" pad={false}>
        {settings.areas.length ? (
          <>
            {settings.areas.map((area) => {
              const served = settings.coverage
                .filter((c) => c.areaId === area.id && c.active === "true")
                .map((c) => lineById[c.serviceLineId])
                .filter(Boolean);
              return (
                // One column on a phone — the area name over its chips —
                // because 180px of label beside them left the chip cell too
                // narrow to fit even one.
                <Row
                  key={area.id}
                  className="grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)]"
                >
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
    </>
  );
}
