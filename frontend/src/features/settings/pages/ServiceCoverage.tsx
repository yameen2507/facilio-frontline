/**
 * Settings › Service coverage — what we do and where.
 *
 * EDITABLE since 2026-08-15. It was read-only, and the footer said "this is what
 * the AI checks a lead against" while giving the operator no way to change it:
 * opening a new city or selling an existing service somewhere new meant a
 * `settings-put` call by hand. Areas and their links are edited here now.
 *
 * It is a matrix OF the service catalogue, not the catalogue itself — a service
 * is created, described and retired on the sibling page (pages/Services.tsx),
 * and this page only says WHERE each one is sold. The analyst's free-text
 * caveats stay on the Intake agent page with the rest of the intake pipeline.
 *
 * THREE THINGS THIS PAGE IS CAREFUL ABOUT, all for the same reason — every write
 * here is an upsert on a natural key and this database has no delete path:
 *
 *  - THE AREA NAME CANNOT BE EDITED once the area exists. `saveArea` matches on
 *    name, so a rename would not rename: it would create a SECOND area, leaving
 *    the first one's coverage rows live and still in the analyst's brief.
 *  - AN AREA IS PAUSED, NEVER REMOVED. Its links survive, so bringing it back
 *    restores exactly what it sold before.
 *  - A RETIRED SERVICE IS NOT OFFERED. The brief drops inactive services, so
 *    letting one be ticked here would create coverage that changes no verdict.
 *
 * Content only — the PageShell and side nav belong to SettingsLayout.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { Row, RowTitle } from "../../../ui/Row";
import { SettingsSkeleton } from "../../../ui/Skeleton";
import { Empty, ErrorState } from "../../../ui/States";
import { useToast } from "../../../ui/Toast";
import { ExplainedButton } from "../components/ExplainedButton";
import { SectionHeader } from "../components/SectionHeader";
import {
  getSettings,
  putCoverage,
  type Area,
  type CoverageEdit,
  type ServiceLine,
  type Settings as SettingsShape,
} from "../api/settings-util";

const HEADER = (actions?: React.ReactNode) => (
  <SectionHeader
    title="Service coverage"
    description="Where we operate and what each area offers — what the AI checks a lead against"
    actions={actions}
  />
);

/** Both booleans arrive as the strings "true"/"false"; absent means true. */
const isActive = (flag?: string) => flag !== "false";

/** The services an area sells today, catalogue order, retired ones dropped. */
const servedBy = (settings: SettingsShape, areaId: string): ServiceLine[] => {
  const linked = new Set(
    settings.coverage.filter((c) => c.areaId === areaId && isActive(c.active)).map((c) => c.serviceLineId)
  );
  return settings.serviceLines.filter((l) => linked.has(l.id) && isActive(l.active));
};

// ── One area and what it sells ───────────────────────────────────────────────

function AreaDialog({
  open,
  onOpenChange,
  area,
  settings,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The area being edited; null creates. */
  area: Area | null;
  settings: SettingsShape;
  onSaved: (next: SettingsShape, message: string) => void;
}) {
  // The record survives the exit animation — the parent clears its state the
  // moment the dialog closes, and reading the prop would flip the title and the
  // Pause button mid-fade.
  const [record, setRecord] = useState<Area | null>(area);
  if (open && record !== area) setRecord(area);

  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [active, setActive] = useState(true);
  /** Service ids ticked in the dialog, before anything is saved. */
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState(false);
  /** The server's message, VERBATIM, or the local name clash. */
  const [error, setError] = useState<string | null>(null);

  // A retired service is never offered: `coverageBrief` filters inactive
  // services out, so a link to one would show here and change no verdict.
  const offerable = settings.serviceLines.filter((l) => isActive(l.active));

  useEffect(() => {
    if (!open) return;
    // Fields reset on OPEN, so a half-typed area never resurfaces on another one.
    const linked = area ? new Set(servedBy(settings, area.id).map((l) => l.id)) : new Set<string>();
    setName(area?.name ?? "");
    setRegion(area?.region ?? "");
    setCountry(area?.country ?? "");
    setActive(isActive(area?.active));
    setPicked(linked);
    setError(null);
  }, [open, area, settings]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canSave = name.trim() !== "" && !busy;

  const persist = async (nextActive: boolean) => {
    const trimmed = name.trim();

    // On create only, and case-insensitively against EVERY area including the
    // paused ones: `saveArea` matches on name, so a clash would silently adopt
    // the other area's coverage rows rather than fail.
    if (!record && settings.areas.some((a) => a.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      setError(`${trimmed} already exists — open that row to change what it offers.`);
      return;
    }

    setBusy(true);
    setError(null);

    // Only the links that CHANGED travel. Every write here is an upsert, so a
    // delta is the whole payload — and sending an explicit "false" for every
    // unticked service would litter the table with rows meaning nothing.
    const before = record ? new Set(servedBy(settings, record.id).map((l) => l.id)) : new Set<string>();
    const changed = offerable.filter((l) => picked.has(l.id) !== before.has(l.id));

    // Constructed literally, never spread from a draft: the handler tests
    // `"scopeNotes" in payload`, so a stray key would blank the analyst's
    // briefing as a side effect of saving a checkbox. See `CoverageEdit`.
    const edit: CoverageEdit = {
      areas: [
        {
          name: trimmed,
          region: region.trim(),
          country: country.trim(),
          active: nextActive,
        },
      ],
      coverage: changed.map((l) => ({
        area: trimmed,
        serviceLine: l.code,
        active: picked.has(l.id),
      })),
    };

    const { data, error: err } = await putCoverage(edit);

    setBusy(false);
    if (err || !data) {
      setError(err ?? "the save did not come back");
      return;
    }
    onOpenChange(false);
    onSaved(
      data.settings,
      !nextActive ? `${trimmed} paused` : record ? `${trimmed} saved` : `${trimmed} added`
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    void persist(active);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{record ? record.name : "New area"}</DialogTitle>
            <DialogDescription>
              {record
                ? "What this area offers. The AI treats anything else asked for here as out of scope."
                : "Name the place, then tick what it sells. Both can be changed after — the name cannot."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5 sm:col-span-3">
              <Label htmlFor="ar-name">
                Area <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ar-name"
                value={name}
                disabled={record !== null}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Riyadh"
              />
              <span className="text-muted-foreground text-xs">
                {record
                  ? "Fixed. Coverage rows and the analyst's brief both find an area by its name — renaming it here would create a second area and leave this one's services live."
                  : "The city or zone a lead names. It is what the AI matches an enquiry against, and it cannot be changed later."}
              </span>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="ar-region">Region</Label>
              <Input
                id="ar-region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="e.g. Riyadh Province"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ar-country">Country</Label>
              <Input
                id="ar-country"
                className="uppercase"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="SA"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Services offered here</span>
            {offerable.length ? (
              <div className="max-h-56 overflow-auto rounded-md border">
                {/* `htmlFor` explicitly, not a label WRAPPING the checkbox:
                    Radix's Root is a button with a hidden form input beside it,
                    and which of the two a wrapping label adopts is left to the
                    browser. Paired by id, the whole row is one honest hit area. */}
                {offerable.map((l) => (
                  <Label
                    key={l.id}
                    htmlFor={`cv-${l.id}`}
                    className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 font-normal last:border-b-0"
                  >
                    <Checkbox
                      id={`cv-${l.id}`}
                      checked={picked.has(l.id)}
                      onCheckedChange={() => toggle(l.id)}
                    />
                    <span className="min-w-0 text-sm">
                      <code className="mr-2 font-mono text-xs">{l.code}</code>
                      {l.name}
                    </span>
                  </Label>
                ))}
              </div>
            ) : (
              <Empty
                title="No services to offer yet"
                body="Add one under Services first — an area with nothing ticked changes no verdict."
                tight
              />
            )}
            <span className="text-muted-foreground text-xs">
              Unticking one stops new enquiries for it qualifying here. Nothing already quoted
              changes. A retired service is not listed — bring it back under Services first.
            </span>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter className="sm:justify-between">
            {record ? (
              // Pausing is not destructive — the links survive, so the area
              // comes back selling exactly what it sold before. That is why it
              // does not ask twice the way retiring a service does.
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                className={active ? "text-destructive hover:text-destructive" : undefined}
                onClick={() => void persist(!active)}
              >
                {active ? "Pause this area" : "Start serving again"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <ExplainedButton
                type="submit"
                disabled={!canSave}
                title={!name.trim() ? "Name the area" : undefined}
              >
                {busy ? "Saving…" : record ? "Save area" : "Add area"}
              </ExplainedButton>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

export function ServiceCoverage() {
  const toast = useToast();

  const [settings, setSettings] = useState<SettingsShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Visibility and the record are one state: null closed, {area: null} creates.
  const [dialog, setDialog] = useState<{ area: Area | null } | null>(null);

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

  const addButton = (
    <Button size="sm" onClick={() => setDialog({ area: null })}>
      <Plus className="size-4" />
      Add area
    </Button>
  );

  // Every state renders inside the content column, so the side nav never
  // disappears — a section that fails must not take its siblings' routes down.
  if (error) {
    return (
      <>
        {HEADER()}
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </>
    );
  }

  if (!settings) {
    return (
      <>
        {HEADER()}
        <SettingsSkeleton />
      </>
    );
  }

  return (
    <>
      {HEADER(addButton)}
      <Card title="Coverage by area" pad={false}>
        {settings.areas.length ? (
          <>
            {settings.areas.map((area) => {
              const served = servedBy(settings, area.id);
              // A paused area is still listed, and says so. Hiding it would
              // leave its rows in the table with nothing to bring them back.
              const paused = !isActive(area.active);
              return (
                // One column on a phone — the area name over its chips —
                // because 180px of label beside them left the chip cell too
                // narrow to fit even one.
                <Row
                  key={area.id}
                  onClick={() => setDialog({ area })}
                  className="grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)]"
                >
                  <RowTitle title={area.name} meta={area.country ?? ""} />
                  <div>
                    {paused ? (
                      <Chip tone="neutral" dot>
                        Not serving
                      </Chip>
                    ) : served.length ? (
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
                <Chip>outside region</Chip> automatically. Editing an area takes effect on the next
                lead assessed — the analyst is given this matrix with every one.
              </span>
            </div>
          </>
        ) : (
          <Empty
            title="No areas yet"
            body="Until one exists the AI has no scope to judge against, and every lead comes back unsure."
            action={
              <Button variant="outline" onClick={() => setDialog({ area: null })}>
                <Plus className="size-4" />
                Add the first area
              </Button>
            }
          />
        )}
      </Card>

      <AreaDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        area={dialog?.area ?? null}
        settings={settings}
        onSaved={(next, message) => {
          setSettings(next);
          toast(message);
        }}
      />
    </>
  );
}
