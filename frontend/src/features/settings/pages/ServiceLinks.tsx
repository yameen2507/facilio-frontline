/**
 * Settings › Service links — each local service line's Facilio Services record.
 *
 * Split out of the coverage page (2026-08-14): coverage is a read-only view of
 * the seed, this is the one thing on the services side an admin actually edits.
 * Quote lines, rate card entries and survey templates reference the Facilio
 * record — never the local line — so an unlinked line is quotable only after
 * someone fills this in.
 *
 * The form is controlled from a `draft` map seeded once the settings arrive,
 * so an in-progress edit is never overwritten by a re-render. Content only —
 * the PageShell and side nav belong to SettingsLayout.
 */

import { useEffect, useState } from "react";
import { Button } from "../../../ui/Button";
import { Bar, Card } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { Input } from "@/components/ui/input";
import { Row, RowTitle } from "../../../ui/Row";
import { SettingsSkeleton } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { useToast } from "../../../ui/Toast";
import { SectionHeader } from "../components/SectionHeader";
import { getSettings, putServiceLines, type Settings as SettingsShape } from "../api/settings-util";

const HEADER = (
  <SectionHeader
    title="Service links"
    description="Ties each local service line to its Facilio Services record"
  />
);

export function ServiceLinks() {
  const toast = useToast();

  const [settings, setSettings] = useState<SettingsShape | null>(null);
  /** Facilio Services id per service-line id; "" means "no link". */
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
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
        setDraft(Object.fromEntries(data.serviceLines.map((l) => [l.id, l.facilioServiceId ?? ""])));
      }
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

  if (!settings || !draft) {
    return (
      <>
        {HEADER}
        <SettingsSkeleton />
      </>
    );
  }

  const saveServiceLinks = async () => {
    setSaving(true);
    // Every line travels, with its stored code/name/active untouched — this
    // save owns exactly one field. A trimmed-empty id clears the link.
    const { error: err } = await putServiceLines(
      settings.serviceLines.map((l) => ({
        code: l.code,
        name: l.name,
        active: l.active !== "false",
        facilioServiceId: (draft[l.id] ?? "").trim(),
      }))
    );
    setSaving(false);
    if (err) {
      toast(err, true);
      return;
    }
    toast("Service links saved");
    setReloadKey((k) => k + 1);
  };

  return (
    <>
      {HEADER}
      <Card title="Facilio service links" meta="every quoted service references a Facilio Services record" pad={false}>
        {settings.serviceLines.length ? (
          <>
            {settings.serviceLines.map((l) => {
              const saved = (l.facilioServiceId ?? "").trim();
              const current = (draft[l.id] ?? "").trim();
              return (
                // 480px of fixed columns overflowed a 390px phone, and the
                // record-id input was the part that got crushed. Stacked
                // below `md`; the three columns return where they fit.
                <Row
                  key={l.id}
                  className="grid-cols-1 md:grid-cols-[220px_260px_minmax(0,1fr)]"
                >
                  <RowTitle title={l.code} meta={l.name} />
                  <Input
                    className="font-mono"
                    value={draft[l.id] ?? ""}
                    placeholder="Facilio Services record id"
                    onChange={(e) => setDraft({ ...draft, [l.id]: e.target.value })}
                  />
                  <div>
                    {saved ? (
                      <Chip tone="blue">linked</Chip>
                    ) : (
                      <Chip>not linked</Chip>
                    )}
                    {current !== saved ? (
                      <span className="text-muted-foreground ml-2 text-xs">unsaved</span>
                    ) : null}
                  </div>
                </Row>
              );
            })}
            <div className="border-t p-4">
              <div className="text-muted-foreground text-xs">
                Quote lines, rate card entries and survey templates reference the Facilio Services record — never
                this local line. Links stay empty until the Services read is verified on the connection; clearing a
                field removes the link.
              </div>
              <Bar className="mt-3">
                <Button variant="primary" onClick={() => void saveServiceLinks()} disabled={saving}>
                  Save links
                </Button>
              </Bar>
            </div>
          </>
        ) : (
          <Empty title="No service lines yet" body="Service lines arrive with the seed import." tight />
        )}
      </Card>
    </>
  );
}
