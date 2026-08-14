/**
 * Settings › Rate cards — the price list a proposal is derived from (Proposal
 * Spec v1 §3).
 *
 * Until this page existed a rate card could only arrive through the seeder, so
 * the whole pricing model was untouchable by a real user. One route, two views:
 * the list, and the card being edited (header form + its pricing rows). The
 * selection is component state rather than a sub-route because SettingsNav
 * matches its entries exactly and the layout keys its fade on the pathname — a
 * `/settings/rate-cards/:id` route would unlight the nav entry and re-fade the
 * pane on every click.
 *
 * WHAT IS DELIBERATELY NOT HERE (spec §3, settled 14 Aug — the cuts are the
 * design): Cost Rate, Minimum Sell Rate and Minimum Charge collapsed into ONE
 * price, so no margin is shown; there is no margin anywhere in this product.
 * The criteria engine (Criteria/Operator/Value/AND-OR) became two nullable
 * columns, Region and Client. Approved By, Country, Notes and the audit table
 * are gone — the audit is `fl_event`.
 *
 * Content only — the PageShell and side nav belong to SettingsLayout.
 */

import { useEffect, useState, type FormEvent } from "react";
import { CalendarRange, Hash, KeyRound, Layers, Plus, Ruler, Tag, Wallet } from "lucide-react";
import { Card } from "../../../ui/Card";
import { Chip, type Tone } from "../../../ui/Chip";
import { ClickRow, ListTable, ListTableSkeleton, type Col } from "../../../ui/DataTable";
import { DateField } from "../../../ui/DateField";
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
import {
  BASIS_LABEL,
  CARD_STATUSES,
  CURRENCIES,
  FREQUENCIES,
  FREQUENCY_LABEL,
  PRICING_BASES,
  STATUS_LABEL,
  UNITS_BY_BASIS,
  UNIT_LABEL,
  listRateCards,
  removeRateCardRow,
  saveRateCard,
  saveRateCardRow,
  type RateCard,
  type RateCardRow,
} from "../api/ratecards-util";

/** Radix Select forbids an empty item value, so "not set" needs a sentinel. */
const UNSET = "__unset";

const STATUS_TONE: Record<string, Tone> = {
  active: "green",
  draft: "orange",
  archived: "neutral",
};

const CARD_COLS: Col[] = [
  { label: "Rate card", icon: Tag, skel: "entity" },
  { label: "Scope", icon: Layers, className: "w-52 max-lg:hidden", skel: "text" },
  { label: "Priority", icon: Hash, className: "w-20 text-right max-sm:hidden", skel: "num" },
  { label: "Effective", icon: CalendarRange, className: "w-44 max-md:hidden", skel: "text" },
  { label: "Status", className: "w-28", skel: "chip" },
];

const ROW_COLS: Col[] = [
  { label: "Service", icon: Tag, skel: "entity" },
  { label: "Basis · unit", icon: Ruler, className: "w-36", skel: "text" },
  { label: "Frequency", className: "w-28 max-lg:hidden", skel: "text" },
  { label: "Price", icon: Wallet, className: "w-28 text-right", skel: "num" },
  { label: "Estimation key", icon: KeyRound, className: "w-40 max-md:hidden", skel: "text" },
];

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * `YYYY-MM-DD` read off the local calendar. Built from parts on purpose:
 * `new Date("2026-08-25")` parses as UTC midnight and shows the day before for
 * anyone west of UTC — the same trap DateField documents.
 */
function displayDate(value: string | null): string | null {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "14 Aug 2026 → open" — a window with no end is the normal case, not an error. */
const effectiveWindow = (card: RateCard): string => {
  const from = displayDate(card.effectiveFrom) ?? "no start";
  const to = displayDate(card.effectiveTo) ?? "open";
  return `${from} → ${to}`;
};

const scopeOf = (card: RateCard): string =>
  `${card.region ?? "All regions"} · ${card.clientAccountId ? "One client" : "All clients"}`;

function money(value: number | null, currency: string): string {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    // An unrecognised currency code must not take the table down with it.
    return `${currency} ${value.toFixed(2)}`;
  }
}

// ── The rule, in words ───────────────────────────────────────────────────────

/**
 * Resolution is the least obvious thing on this page: an admin who has just
 * authored a card and watched a proposal ignore it needs the four conditions
 * and the two tiebreaks written down, not inferred. Kept verbatim in step with
 * `resolveRateCard` in src/domain/proposal-pricing.ts.
 */
const ResolutionNote = () => (
  <Card title="Which card wins" className="mt-5">
    <p className="text-muted-foreground text-xs">
      A proposal resolves ONE card at the moment it is created. A card is eligible only when all
      four hold: its status is <Chip small>Active</Chip>, today falls inside its effective window,
      its region matches the site's or is blank, and its client matches the account's or is blank.
      A blank region or client means <em>every</em> one — not none.
    </p>
    <p className="text-muted-foreground mt-2 text-xs">
      Among the eligible, <span className="text-foreground font-medium">the most specific wins</span>{" "}
      — client + region, then client, then region, then neither. Only when two cards are equally
      specific does <span className="text-foreground font-medium">the higher priority</span> break
      the tie, and a remaining tie falls to the card id so the same inputs always resolve the same
      way. A card that never wins is usually a general card sitting behind a regional one, not a
      priority that is too low.
    </p>
  </Card>
);

// ── One pricing row ──────────────────────────────────────────────────────────

function RowDialog({
  open,
  onOpenChange,
  cardId,
  row,
  currency,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardId: string;
  /** The row being edited; null creates. */
  row: RateCardRow | null;
  currency: string;
  onSaved: () => void;
}) {
  // The record survives the exit animation — the parent clears its state the
  // moment the dialog closes, and reading the prop would flip the title and the
  // Deactivate button mid-fade.
  const [record, setRecord] = useState<RateCardRow | null>(row);
  if (open && record !== row) setRecord(row);

  const [serviceCode, setServiceCode] = useState("");
  const [facilioServiceId, setFacilioServiceId] = useState("");
  const [description, setDescription] = useState("");
  const [estimationKey, setEstimationKey] = useState("");
  const [pricingBasis, setPricingBasis] = useState<string>("unit");
  const [uom, setUom] = useState("");
  const [frequency, setFrequency] = useState(UNSET);
  const [price, setPrice] = useState("");

  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  /** The server's message, VERBATIM. */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Fields reset on OPEN, so a half-typed price never resurfaces on another row.
    // Both stored values are re-checked against the master rather than trusted:
    // a basis outside unit|hour|visit has no unit list at all, and a unit that
    // is legal for no basis (the seed row's "unit") would render the dropdown
    // blank and then save itself straight back.
    const stored = row?.pricingBasis ?? "unit";
    const basis = UNITS_BY_BASIS[stored] ? stored : "unit";
    const units = UNITS_BY_BASIS[basis];
    setServiceCode(row?.serviceCode ?? "");
    setFacilioServiceId(row?.facilioServiceId ?? "");
    setDescription(row?.description ?? "");
    setEstimationKey(row?.estimationKey ?? "");
    setPricingBasis(basis);
    setUom(row?.uom && units.includes(row.uom) ? row.uom : units[0]);
    setFrequency(row?.defaultFrequency ?? UNSET);
    setPrice(row?.price !== null && row?.price !== undefined ? String(row.price) : "");
    setConfirmRemove(false);
    setError(null);
  }, [open, row]);

  const units = UNITS_BY_BASIS[pricingBasis] ?? UNITS_BY_BASIS.unit;
  const priceValue = Number(price);
  const priceValid = price.trim() !== "" && Number.isFinite(priceValue) && priceValue >= 0;
  const canSave = serviceCode.trim() !== "" && priceValid && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);

    const { error: err } = await saveRateCardRow({
      cardId,
      ...(row ? { rowId: row.id } : {}),
      serviceCode: serviceCode.trim(),
      facilioServiceId: facilioServiceId.trim(),
      description: description.trim(),
      estimationKey: estimationKey.trim(),
      pricingBasis,
      uom,
      // Major units in; ratecards-util converts to minor at the wire.
      price: priceValue,
      defaultFrequency: frequency === UNSET ? "" : frequency,
    });

    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
    onSaved();
  };

  const remove = async () => {
    if (!row) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await removeRateCardRow(cardId, row.id);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{record ? "Edit pricing row" : "New pricing row"}</DialogTitle>
            <DialogDescription>
              Price, basis and unit are one atomic fact — a price with no basis cannot be applied to
              anything.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rr-service">
                Service <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rr-service"
                value={serviceCode}
                onChange={(e) => setServiceCode(e.target.value)}
                placeholder="e.g. CLEAN_ROUTINE"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rr-facilio">Facilio Services record</Label>
              <Input
                id="rr-facilio"
                className="font-mono"
                value={facilioServiceId}
                onChange={(e) => setFacilioServiceId(e.target.value)}
                placeholder="record id"
              />
              <span className="text-muted-foreground text-xs">
                A quoted service references the Facilio record, never the local line — the ids live
                on the Service links page.
              </span>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="rr-description">Line description</Label>
              <Textarea
                id="rr-description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What the proposal line will read"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rr-basis">
                Pricing basis <span className="text-destructive">*</span>
              </Label>
              <Select
                value={pricingBasis}
                onValueChange={(next) => {
                  setPricingBasis(next);
                  // The unit master DEPENDS on the basis: leaving sq_ft under
                  // Hour would save a unit that basis cannot express.
                  setUom(UNITS_BY_BASIS[next][0]);
                }}
              >
                <SelectTrigger id="rr-basis" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRICING_BASES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {BASIS_LABEL[b]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rr-uom">
                Unit <span className="text-destructive">*</span>
              </Label>
              <Select value={uom} onValueChange={setUom}>
                <SelectTrigger id="rr-uom" className="w-full">
                  <SelectValue />
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

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rr-frequency">Frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger id="rr-frequency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>No default</SelectItem>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {FREQUENCY_LABEL[f] ?? f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rr-price">
                Price <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground shrink-0 text-xs">{currency}</span>
                <Input
                  id="rr-price"
                  className="tabular-nums"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <span className="text-muted-foreground text-xs">
                One price. Cost, minimum sell rate and minimum charge were cut, so no margin is
                shown here or anywhere.
              </span>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="rr-key">Estimation key</Label>
              <Input
                id="rr-key"
                className="font-mono"
                value={estimationKey}
                onChange={(e) => setEstimationKey(e.target.value)}
                placeholder="e.g. washroom_deep_clean"
              />
              <span className="text-muted-foreground text-xs">
                The join to the survey walk — the key the estimator reads, so pricing never depends
                on how a question was worded. A row without one can still be added to a proposal by
                hand, but it can never be auto-drafted from a survey.
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
                className="text-destructive hover:text-destructive"
                onClick={() => void remove()}
              >
                {confirmRemove ? "Confirm — stop pricing with this row" : "Deactivate"}
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
                  !serviceCode.trim()
                    ? "Name the service this row prices"
                    : !priceValid
                      ? "Give the row a price"
                      : undefined
                }
              >
                {busy ? "Saving…" : record ? "Save row" : "Add row"}
              </ExplainedButton>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

/** The header form's working copy — nine fields, exactly the ones spec §3 kept. */
type HeaderDraft = {
  name: string;
  currency: string;
  region: string;
  clientAccountId: string;
  priority: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string;
  /** Cut from the header, carried untouched so saving cannot blank it. */
  description: string;
};

const blankDraft = (): HeaderDraft => ({
  name: "",
  currency: "AED",
  region: "",
  clientAccountId: "",
  priority: "0",
  status: "draft",
  effectiveFrom: "",
  effectiveTo: "",
  description: "",
});

const draftOf = (card: RateCard): HeaderDraft => ({
  name: card.name,
  currency: card.currency,
  region: card.region ?? "",
  clientAccountId: card.clientAccountId ?? "",
  priority: String(card.priority),
  status: card.status,
  effectiveFrom: card.effectiveFrom ?? "",
  effectiveTo: card.effectiveTo ?? "",
  description: card.description ?? "",
});

export function RateCards() {
  const toast = useToast();

  const [cards, setCards] = useState<RateCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  /** null is the list; "new" is an unsaved card; anything else is a card id. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<HeaderDraft>(blankDraft);
  const [savingHeader, setSavingHeader] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);

  // Visibility and the record are one state: null closed, {row: null} creates.
  const [rowDialog, setRowDialog] = useState<{ row: RateCardRow | null } | null>(null);

  useEffect(() => {
    let live = true;
    listRateCards().then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (!data) return;
      setCards(data);
      // A card that no longer comes back — hard-deleted behind our back — would
      // strand the detail view on nothing. Checked HERE, against data that has
      // actually landed, rather than during render: a create sets the selection
      // one render before the reload answers, and a render-phase check would
      // bounce the admin back to the list mid-save.
      setSelectedId((prev) =>
        prev && prev !== "new" && !data.some((c) => c.id === prev) ? null : prev
      );
    });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const selected = selectedId && selectedId !== "new" ? cards.find((c) => c.id === selectedId) : undefined;

  const openCard = (card: RateCard) => {
    setSelectedId(card.id);
    setDraft(draftOf(card));
    setHeaderError(null);
  };

  const openNew = () => {
    setSelectedId("new");
    setDraft(blankDraft());
    setHeaderError(null);
  };

  const set = (patch: Partial<HeaderDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // Effective From is the one date the spec does NOT mark nullable, and for a
  // reason worth stating: a blank one makes the card eligible from the
  // beginning of time, which is the silent scope-widening the resolution note
  // exists to prevent.
  const headerReady = draft.name.trim() !== "" && draft.effectiveFrom !== "";

  const saveHeader = async () => {
    if (!headerReady || savingHeader) return;
    setSavingHeader(true);
    setHeaderError(null);

    const { data, error: err } = await saveRateCard({
      ...(selected ? { cardId: selected.id } : {}),
      name: draft.name.trim(),
      description: draft.description,
      currency: draft.currency,
      // Trimmed-empty clears the scope, which is what makes a card apply
      // everywhere — the payload envelope is what lets the blank survive.
      region: draft.region.trim(),
      clientAccountId: draft.clientAccountId.trim(),
      priority: Number(draft.priority) || 0,
      status: draft.status,
      effectiveFrom: draft.effectiveFrom,
      effectiveTo: draft.effectiveTo,
    });

    setSavingHeader(false);
    if (err) {
      setHeaderError(err);
      return;
    }
    // A create has to land on the card it just made, or the admin cannot add
    // rows to it. The id may come back bare or wrapped; both are read.
    const saved = (data ?? {}) as Record<string, unknown>;
    const inner = (saved.card ?? saved.rateCard ?? saved) as Record<string, unknown>;
    const newId = typeof inner.id === "string" ? inner.id : null;
    if (!selected) {
      // No id back means we cannot open what was just created, and staying in
      // create mode would make the next save a second card. Back to the list,
      // where the new one is now visible.
      setSelectedId(newId);
    }
    toast(selected ? "Rate card saved" : "Rate card created");
    setReloadKey((k) => k + 1);
  };

  // ── List ───────────────────────────────────────────────────────────────────

  if (!selectedId) {
    return (
      <>
        <SectionHeader
          title="Rate cards"
          description="The price list every proposal is derived from — one price per service, per basis"
          actions={
            <Button size="sm" onClick={openNew}>
              <Plus className="size-4" />
              New rate card
            </Button>
          }
        />
        <Card pad={false}>
          {!loaded ? (
            <ListTableSkeleton cols={CARD_COLS} rows={4} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
          ) : cards.length ? (
            <ListTable cols={CARD_COLS}>
              {cards.map((c) => (
                <ClickRow key={c.id} onClick={() => openCard(c)}>
                  <TableCell className="px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      <div className="text-muted-foreground truncate text-xs">
                        {c.currency} · {c.rows.length} {c.rows.length === 1 ? "row" : "rows"}
                        <span className="lg:hidden"> · {scopeOf(c)}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground w-52 truncate px-4 py-3 text-xs max-lg:hidden">
                    {scopeOf(c)}
                  </TableCell>
                  <TableCell className="w-20 px-4 py-3 text-right text-sm tabular-nums max-sm:hidden">
                    {c.priority}
                  </TableCell>
                  <TableCell className="text-muted-foreground w-44 truncate px-4 py-3 text-xs max-md:hidden">
                    {effectiveWindow(c)}
                  </TableCell>
                  <TableCell className="w-28 px-4 py-3">
                    <Chip tone={STATUS_TONE[c.status] ?? "neutral"} dot>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </Chip>
                  </TableCell>
                </ClickRow>
              ))}
            </ListTable>
          ) : (
            <Empty
              title="No rate cards yet"
              body="A proposal cannot price itself without one — every line falls back to being typed by hand."
              action={
                <Button variant="outline" onClick={openNew}>
                  <Plus className="size-4" />
                  Create a rate card
                </Button>
              }
            />
          )}
        </Card>
        <ResolutionNote />
      </>
    );
  }

  // ── One card ───────────────────────────────────────────────────────────────

  const rows = selected?.rows ?? [];
  const currency = draft.currency;

  return (
    <>
      <SectionHeader
        title={selected ? selected.name : "New rate card"}
        description={
          selected
            ? "Its scope, its window and the services it prices"
            : "Name it and save, then its pricing rows can be added"
        }
        actions={
          <Button size="sm" variant="outline" onClick={() => setSelectedId(null)}>
            All rate cards
          </Button>
        }
      />

      {/* A refetch can fail while a card is open — a row saves, the reload
          errors, and the table would otherwise just not show the new row with
          nothing said. The detail view owes the same three states as the list. */}
      {error ? (
        <Card className="mb-5" pad={false}>
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} tight />
        </Card>
      ) : null}

      <Card title="Card header" meta="9 fields — the rest were cut on 14 Aug">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="rc-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rc-name"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. UAE standard 2026"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rc-currency">Currency</Label>
            <Select value={draft.currency} onValueChange={(v) => set({ currency: v })}>
              <SelectTrigger id="rc-currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-xs">
              Stamped onto a proposal when the card resolves, and never moves after that.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rc-status">Status</Label>
            <Select value={draft.status} onValueChange={(v) => set({ status: v })}>
              <SelectTrigger id="rc-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-xs">
              Only an Active card is ever resolved.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rc-region">Region</Label>
            <Input
              id="rc-region"
              value={draft.region}
              onChange={(e) => set({ region: e.target.value })}
              placeholder="Leave blank for every region"
            />
            <span className="text-muted-foreground text-xs">
              Matched against the account's region, falling back to the lead's site region — free
              text, so it must read exactly as those records spell it.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rc-client">Client account</Label>
            <Input
              id="rc-client"
              className="font-mono"
              value={draft.clientAccountId}
              onChange={(e) => set({ clientAccountId: e.target.value })}
              placeholder="Leave blank for every client"
            />
            <span className="text-muted-foreground text-xs">
              The account id this card is negotiated for. A client card beats a regional one.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rc-from">
              Effective from <span className="text-destructive">*</span>
            </Label>
            {/* Plain YYYY-MM-DD, per the handler contract. Resolution compares
                these lexically against a full timestamp, so whether a card is
                live on its own last day is a backend boundary to confirm — not
                something to paper over with a client-side T23:59:59. */}
            <DateField
              id="rc-from"
              value={draft.effectiveFrom}
              onChange={(v) => set({ effectiveFrom: v })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rc-to">Effective to</Label>
            <DateField id="rc-to" value={draft.effectiveTo} onChange={(v) => set({ effectiveTo: v })} />
            <span className="text-muted-foreground text-xs">Clear it for an open-ended card.</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rc-priority">Priority</Label>
            <Input
              id="rc-priority"
              className="tabular-nums"
              inputMode="numeric"
              value={draft.priority}
              onChange={(e) => set({ priority: e.target.value })}
              placeholder="0"
            />
            <span className="text-muted-foreground text-xs">
              Higher wins — but only between two cards of the same specificity.
            </span>
          </div>
        </div>

        {headerError ? <p className="text-destructive mt-4 text-sm">{headerError}</p> : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <ExplainedButton
            disabled={!headerReady || savingHeader}
            title={
              !draft.name.trim()
                ? "Give the card a name"
                : !draft.effectiveFrom
                  ? "Say when the card starts applying"
                  : undefined
            }
            onClick={() => void saveHeader()}
          >
            {savingHeader ? "Saving…" : selected ? "Save header" : "Create rate card"}
          </ExplainedButton>
          <Button variant="outline" onClick={() => setSelectedId(null)}>
            Cancel
          </Button>
        </div>
      </Card>

      <Card
        className="mt-5"
        pad={false}
        title="Pricing rows"
        meta={
          selected
            ? `${rows.length} ${rows.length === 1 ? "row" : "rows"}`
            : "available once the card exists"
        }
      >
        {!selected ? (
          <Empty
            title="Save the card first"
            body="Rows hang off a card, so there is nothing to attach them to yet."
            tight
          />
        ) : rows.length ? (
          <>
            <ListTable cols={ROW_COLS}>
              {rows.map((r) => (
                <ClickRow key={r.id} onClick={() => setRowDialog({ row: r })}>
                  <TableCell className="px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{r.serviceCode ?? "Unnamed service"}</div>
                      <div className="text-muted-foreground truncate text-xs">
                        {r.description ?? "No description"}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground w-36 truncate px-4 py-3 text-xs">
                    {BASIS_LABEL[r.pricingBasis] ?? r.pricingBasis}
                    {r.uom ? ` · ${UNIT_LABEL[r.uom] ?? r.uom}` : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground w-28 truncate px-4 py-3 text-xs max-lg:hidden">
                    {r.defaultFrequency ? (FREQUENCY_LABEL[r.defaultFrequency] ?? r.defaultFrequency) : "—"}
                  </TableCell>
                  <TableCell className="w-28 px-4 py-3 text-right text-sm tabular-nums">
                    {money(r.price, currency)}
                  </TableCell>
                  <TableCell className="w-40 px-4 py-3 max-md:hidden">
                    {r.estimationKey ? (
                      <code className="text-muted-foreground block truncate font-mono text-xs">
                        {r.estimationKey}
                      </code>
                    ) : (
                      // Not decoration: without a key this row is invisible to
                      // the survey walk and can only ever be added by hand.
                      <Chip tone="orange" small>
                        no key
                      </Chip>
                    )}
                  </TableCell>
                </ClickRow>
              ))}
            </ListTable>
            <div className="flex flex-wrap items-center gap-3 border-t p-4">
              <Button size="sm" variant="outline" onClick={() => setRowDialog({ row: null })}>
                <Plus className="size-4" />
                Add row
              </Button>
              <span className="text-muted-foreground text-xs">
                A deactivated row stops pricing new proposals; the ones that already used it keep
                resolving.
              </span>
            </div>
          </>
        ) : (
          <Empty
            title="No pricing rows yet"
            body="A card with no rows resolves and then prices nothing."
            tight
            action={
              <Button variant="outline" onClick={() => setRowDialog({ row: null })}>
                <Plus className="size-4" />
                Add the first row
              </Button>
            }
          />
        )}
      </Card>

      <ResolutionNote />

      <RowDialog
        open={rowDialog !== null}
        onOpenChange={(open) => {
          if (!open) setRowDialog(null);
        }}
        cardId={selected?.id ?? ""}
        row={rowDialog?.row ?? null}
        currency={currency}
        onSaved={() => setReloadKey((k) => k + 1)}
      />
    </>
  );
}
