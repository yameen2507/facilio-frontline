/**
 * Settings › Services — what this company sells.
 *
 * This page replaced "Service links" on 2026-08-15. That page held one field
 * per service, a Facilio Services record id, and every one of them read "not
 * linked" because the Services read action was never resolved. The app owns its
 * services now: they are created, described and retired here, and a rate card
 * row, a proposal line and a survey recommendation all name one by CODE.
 *
 * TWO THINGS THIS PAGE IS CAREFUL ABOUT, both for the same reason — there are
 * no foreign keys in this database to catch either:
 *
 *  - THE CODE CANNOT BE EDITED once a service exists. It is the value stored on
 *    every priced row, so changing it here would leave those rows naming a
 *    service nothing answers to. The field is disabled on an existing service,
 *    and it says why.
 *  - RETIRING SHOWS ITS BLAST RADIUS. Pricing refuses to resolve a retired
 *    service, so the count of rows that name it is on the button, not in a
 *    place the admin has to go looking.
 *
 * Content only — the PageShell and side nav belong to SettingsLayout.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Hash, Plus, Ruler, Tag } from "lucide-react";
import { Card } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { ClickRow, ListTable, ListTableSkeleton, type Col } from "../../../ui/DataTable";
import { Empty, ErrorState } from "../../../ui/States";
import { useToast } from "../../../ui/Toast";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ExplainedButton } from "../components/ExplainedButton";
import { SectionHeader } from "../components/SectionHeader";
import { BASIS_LABEL, UNIT_LABEL } from "../api/ratecards-util";
import {
  listServices,
  saveService,
  type Catalogue,
  type Service,
} from "../api/settings-util";

/** Radix Select forbids an empty item value, so "no default" needs a sentinel. */
const UNSET = "__unset";

const COLS: Col[] = [
  { label: "Service", icon: Tag, skel: "entity" },
  { label: "Prices as", icon: Ruler, className: "w-44 max-md:hidden", skel: "text" },
  { label: "Used by", icon: Hash, className: "w-28 text-right max-sm:hidden", skel: "num" },
  { label: "Status", className: "w-28", skel: "chip" },
];

const HEADER = (actions?: React.ReactNode) => (
  <SectionHeader
    title="Services"
    description="What we sell — every rate card row, proposal line and recommendation names one of these"
    actions={actions}
  />
);

/** "Unit · Sq ft", or the honest blank. */
const pricesAs = (service: Service): string => {
  const basis = service.defaultPricingBasis;
  if (!basis) return "No default";
  const unit = service.defaultUom;
  return `${BASIS_LABEL[basis] ?? basis}${unit ? ` · ${UNIT_LABEL[unit] ?? unit}` : ""}`;
};

// ── One service ──────────────────────────────────────────────────────────────

function ServiceDialog({
  open,
  onOpenChange,
  service,
  usage,
  unitsByBasis,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The service being edited; null creates. */
  service: Service | null;
  /** How many priced rows name it — 0 for a service being created. */
  usage: number;
  unitsByBasis: Record<string, string[]>;
  onSaved: (next: Catalogue) => void;
}) {
  // The record survives the exit animation — the parent clears its state the
  // moment the dialog closes, and reading the prop would flip the title and the
  // Retire button mid-fade.
  const [record, setRecord] = useState<Service | null>(service);
  if (open && record !== service) setRecord(service);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [basis, setBasis] = useState(UNSET);
  const [uom, setUom] = useState(UNSET);
  const [active, setActive] = useState(true);

  const [busy, setBusy] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  /** The server's message, VERBATIM. */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Fields reset on OPEN, so a half-typed code never resurfaces on another
    // service. A stored unit is re-checked against its basis rather than
    // trusted: a unit that is legal for no basis would render the dropdown
    // blank and then save itself straight back.
    const storedBasis = service?.defaultPricingBasis ?? "";
    const nextBasis = storedBasis && unitsByBasis[storedBasis] ? storedBasis : UNSET;
    const units = nextBasis === UNSET ? [] : (unitsByBasis[nextBasis] ?? []);
    setCode(service?.code ?? "");
    setName(service?.name ?? "");
    setDescription(service?.description ?? "");
    setBasis(nextBasis);
    setUom(
      service?.defaultUom && units.includes(service.defaultUom)
        ? service.defaultUom
        : (units[0] ?? UNSET)
    );
    setActive(service?.active !== "false");
    setConfirmRetire(false);
    setError(null);
  }, [open, service, unitsByBasis]);

  const units = basis === UNSET ? [] : (unitsByBasis[basis] ?? []);
  const canSave = code.trim() !== "" && name.trim() !== "" && !busy;

  const persist = async (nextActive: boolean) => {
    setBusy(true);
    setError(null);

    const { data, error: err } = await saveService({
      code: code.trim(),
      name: name.trim(),
      description: description.trim(),
      // "" clears the default, which the payload envelope is what preserves.
      defaultPricingBasis: basis === UNSET ? "" : basis,
      defaultUom: basis === UNSET || uom === UNSET ? "" : uom,
      active: nextActive,
    });

    setBusy(false);
    if (err || !data) {
      setError(err ?? "the save did not come back");
      return;
    }
    onOpenChange(false);
    onSaved(data);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    void persist(active);
  };

  const toggleActive = () => {
    // Retiring is the destructive direction, so it is the one that asks twice.
    // Bringing a service back is not.
    if (active && !confirmRetire) {
      setConfirmRetire(true);
      return;
    }
    void persist(!active);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{record ? record.code : "New service"}</DialogTitle>
            <DialogDescription>
              {record
                ? "Its name, what it covers, and how it is normally priced."
                : "A code and a name are enough — everything else can follow."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sv-code">
                Code <span className="text-destructive">*</span>
              </Label>
              <Input
                id="sv-code"
                className="font-mono uppercase"
                value={code}
                disabled={record !== null}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. KEC"
              />
              <span className="text-muted-foreground text-xs">
                {record
                  ? "Fixed. Every rate card row and proposal line that prices this service stores this code — changing it would leave them pointing at nothing."
                  : "Letters, digits, _ and -. Upper-cased, and fixed once saved — it is what every priced row will store."}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sv-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="sv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Kitchen extract cleaning"
              />
              <span className="text-muted-foreground text-xs">
                What a person calls it — on the coverage matrix and in the lead form.
              </span>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="sv-description">What it covers</Label>
              <Textarea
                id="sv-description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="TR19-compliant grease removal from canopy, plenum and ductwork"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sv-basis">Normally priced by</Label>
              <Select
                value={basis}
                onValueChange={(next) => {
                  setBasis(next);
                  // The unit master DEPENDS on the basis: leaving sq_ft under
                  // Hour would store a unit that basis cannot express.
                  setUom(next === UNSET ? UNSET : ((unitsByBasis[next] ?? [])[0] ?? UNSET));
                }}
              >
                <SelectTrigger id="sv-basis" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>No default</SelectItem>
                  {Object.keys(unitsByBasis).map((b) => (
                    <SelectItem key={b} value={b}>
                      {BASIS_LABEL[b] ?? b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground text-xs">
                A prefill, not a rule — a rate card row can still price it any way it likes.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sv-uom">Unit</Label>
              <Select value={uom} onValueChange={setUom} disabled={basis === UNSET}>
                <SelectTrigger id="sv-uom" className="w-full">
                  <SelectValue placeholder="Pick a basis first" />
                </SelectTrigger>
                <SelectContent>
                  {units.map((u) => (
                    <SelectItem key={u} value={u}>
                      {UNIT_LABEL[u] ?? u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground text-xs">
                The units on offer follow the basis.
              </span>
            </div>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter className="sm:justify-between">
            {record ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                className={active ? "text-destructive hover:text-destructive" : undefined}
                onClick={toggleActive}
              >
                {!active
                  ? "Bring back"
                  : confirmRetire
                    ? usage
                      ? `Confirm — ${usage} priced ${usage === 1 ? "row" : "rows"} stop resolving`
                      : "Confirm — stop selling this"
                    : "Retire"}
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
                title={
                  !code.trim()
                    ? "Give the service a code"
                    : !name.trim()
                      ? "Give the service a name"
                      : undefined
                }
              >
                {busy ? "Saving…" : record ? "Save service" : "Add service"}
              </ExplainedButton>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

export function Services() {
  const toast = useToast();

  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Visibility and the record are one state: null closed, {service: null} creates.
  const [dialog, setDialog] = useState<{ service: Service | null } | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);

    listServices().then(({ data, error: err }) => {
      if (!live) return;
      setError(err);
      if (data) setCatalogue(data);
    });

    return () => {
      live = false;
    };
  }, [reloadKey]);

  const services = catalogue?.services ?? [];
  const usage = catalogue?.usage ?? {};
  const unitsByBasis = catalogue?.unitsByBasis ?? {};

  const addButton = (
    <Button size="sm" onClick={() => setDialog({ service: null })}>
      <Plus className="size-4" />
      New service
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

  return (
    <>
      {HEADER(catalogue ? addButton : undefined)}

      <Card pad={false}>
        {!catalogue ? (
          <ListTableSkeleton cols={COLS} rows={5} />
        ) : services.length ? (
          <>
            <ListTable cols={COLS}>
              {services.map((s) => {
                const retired = s.active === "false";
                const uses = usage[s.code] ?? 0;
                return (
                  <ClickRow key={s.id} onClick={() => setDialog({ service: s })}>
                    <TableCell className="px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <code className="shrink-0 font-mono text-xs">{s.code}</code>
                          <span className="truncate text-sm font-medium">{s.name}</span>
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {s.description || "No description yet"}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground w-44 truncate px-4 py-3 text-xs max-md:hidden">
                      {pricesAs(s)}
                    </TableCell>
                    <TableCell className="w-28 px-4 py-3 text-right text-sm tabular-nums max-sm:hidden">
                      {/* Not decoration: this is the number of rows that stop
                          resolving the moment the service is retired. */}
                      {uses || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="w-28 px-4 py-3">
                      {retired ? (
                        <Chip tone="neutral" dot>
                          Retired
                        </Chip>
                      ) : (
                        <Chip tone="green" dot>
                          Selling
                        </Chip>
                      )}
                    </TableCell>
                  </ClickRow>
                );
              })}
            </ListTable>
            <div className="text-muted-foreground border-t p-4 text-xs">
              A retired service stays on the proposals that already priced it, but nothing new can
              be priced against it — pricing refuses to resolve one. A service the AI should qualify
              leads for also needs an area:{" "}
              <Link to="/settings" className="font-medium underline-offset-4 hover:underline">
                Service coverage
              </Link>{" "}
              is where each one is switched on per place, and until it is switched on somewhere the
              analyst treats it as out of scope.
            </div>
          </>
        ) : (
          <Empty
            title="No services yet"
            body="Until one exists, a rate card row has nothing to price and the lead form has no service to offer."
            action={
              <Button variant="outline" onClick={() => setDialog({ service: null })}>
                <Plus className="size-4" />
                Add the first service
              </Button>
            }
          />
        )}
      </Card>

      <ServiceDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        service={dialog?.service ?? null}
        usage={dialog?.service ? (usage[dialog.service.code] ?? 0) : 0}
        unitsByBasis={unitsByBasis}
        onSaved={(next) => {
          setCatalogue(next);
          toast("Service saved");
        }}
      />
    </>
  );
}
