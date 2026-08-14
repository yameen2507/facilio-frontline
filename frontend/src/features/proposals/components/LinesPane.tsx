/**
 * The pricing table — the surface this whole module exists for.
 *
 * THE DERIVATION IS THE POINT (spec §2.2). Every line shows how its number was
 * reached: the card price it started from, the mode and the delta that moved
 * it, the stated reason, and the applied price it ended at. A price with no
 * visible derivation is a price nobody can defend to an approver or a client,
 * and the six-step chain in spec §1.2 is worth nothing if the last step is a
 * figure that appeared out of the air.
 *
 * THREE RULES THIS FILE IS BUILT AROUND:
 *
 * 1. **The UI never does arithmetic on money.** `line-save` returns the whole
 *    recomputed proposal, so every total on screen was calculated by
 *    `domain/pricing.ts` and read back. Even the deviation percentage is not
 *    derived here — the line prints the delta the estimator ENTERED, and the
 *    authoritative percentage comes from the approval exception list.
 * 2. **A reason is mandatory for discount, markup and custom** — it is what the
 *    approver reads. The editor will not save without one. That is a different
 *    thing from the server's `problems[]`, which are warnings and never block
 *    (C8): the field is required here, and everything the server has to say
 *    about a saved line is shown rather than swallowed.
 * 3. **Optional lines live in their own block, after the table, with their own
 *    subtotal, clearly outside the total** (C10, spec §10 call 8). The upsell is
 *    shown, never added — folding it in is how a client is quoted a number they
 *    never agreed to.
 */

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "../../../ui/Card";
import { Empty } from "../../../ui/States";
import { humanise } from "../../../lib/format";
import { removeLine, saveLine, type LineDraft } from "../api/proposals-util";
import { money, moneyInput, numeric, parseMoney, qty as fmtQty } from "../money";
import { FrequencyChip, PricingModeChip } from "./ProposalChips";
import {
  FREQUENCY_LABEL,
  PRICING_MODE_LABEL,
  REASON_REQUIRED_MODES,
  isLineEditable,
  type DeltaType,
  type Frequency,
  type PricingMode,
  type Proposal,
  type ProposalLine,
  type ProposalReference,
} from "../types/proposal";

/** Used only when `reference` could not be read — the handler is the authority,
    and these keep the editor usable rather than empty if that one call fails. */
const FALLBACK_MODES: PricingMode[] = ["standard", "discount", "markup", "custom"];
const FALLBACK_FREQUENCIES = Object.keys(FREQUENCY_LABEL) as Frequency[];
const FALLBACK_BASES = ["unit", "hour", "visit"];

/** The editor's fields, held as strings because that is what an input holds. */
type Form = {
  description: string;
  qty: string;
  pricingBasis: string;
  uom: string;
  frequency: string;
  pricingMode: PricingMode;
  deltaType: DeltaType;
  /** A percentage when the delta type is `pct`, MAJOR units when `amount`. */
  deltaValue: string;
  deltaReason: string;
  /** Major units. The CARD price — or, for a custom line, the estimator's own,
      because there is no card row behind it to copy from. */
  price: string;
  isOptional: boolean;
};

const blankForm = (isOptional: boolean): Form => ({
  description: "",
  qty: "1",
  pricingBasis: "unit",
  uom: "each",
  frequency: "one_time",
  pricingMode: "standard",
  deltaType: "pct",
  deltaValue: "",
  deltaReason: "",
  price: "",
  isOptional,
});

const formOf = (line: ProposalLine): Form => ({
  description: line.description ?? "",
  qty: String(numeric(line.qty) ?? 1),
  pricingBasis: String(line.pricingBasis ?? "unit"),
  uom: String(line.uom ?? "each"),
  frequency: String(line.frequency ?? "one_time"),
  pricingMode: (line.pricingMode as PricingMode) ?? "standard",
  deltaType: line.deltaType ?? "pct",
  deltaValue:
    line.deltaValue === null || line.deltaValue === undefined
      ? ""
      : line.deltaType === "amount"
        ? moneyInput(line.deltaValue)
        : String(numeric(line.deltaValue) ?? ""),
  deltaReason: line.deltaReason ?? "",
  price: moneyInput(line.cardPrice),
  isOptional: line.isOptional,
});

/** What the estimator typed, said back in one phrase — never recomputed here. */
function deltaPhrase(line: ProposalLine, currency: string | null | undefined): string | null {
  const mode = String(line.pricingMode ?? "standard");
  if (mode === "standard") return null;
  if (mode === "custom") return "priced by hand";

  const value = numeric(line.deltaValue);
  if (value === null || value === 0) return `${mode}, no value set`;

  return line.deltaType === "amount"
    ? `${money(Math.abs(value), currency)} ${mode === "discount" ? "off" : "on"}`
    : `${Math.abs(value)}% ${mode}`;
}

// ── One line, read ───────────────────────────────────────────────────────────

function LineRow({
  line,
  currency,
  editable,
  busy,
  onEdit,
  onRemove,
}: {
  line: ProposalLine;
  currency: string | null | undefined;
  editable: boolean;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const mode = String(line.pricingMode ?? "standard");
  const moved = mode !== "standard";
  const phrase = deltaPhrase(line, currency);

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b px-4 py-3 last:border-b-0">
      <span className="bg-muted text-muted-foreground flex h-6 w-7 shrink-0 items-center justify-center rounded-md font-mono text-xs">
        {line.sequenceNo}
      </span>

      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
        <span className="text-sm font-medium">{line.description ?? "Untitled line"}</span>

        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted-foreground text-xs tabular-nums">
            {fmtQty(line.qty)} {line.uom ? humanise(line.uom) : ""}
          </span>
          <FrequencyChip frequency={line.frequency as string} />
          {moved ? <PricingModeChip mode={mode} small /> : null}
        </span>

        {/* THE DERIVATION, spelled out: where the price started, what moved it,
            and where it landed. A standard line has nothing to explain, so it
            shows the one number rather than an arrow from itself to itself. */}
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums">
          {moved ? (
            <>
              <span className="line-through">{money(line.cardPrice, currency)}</span>
              <span aria-hidden="true">→</span>
              <span className="text-foreground font-medium">{money(line.appliedPrice, currency)}</span>
              {phrase ? <span className="tabular-nums">· {phrase}</span> : null}
            </>
          ) : (
            <span>{money(line.appliedPrice, currency)} from the card</span>
          )}
        </span>

        {/* The reason is what the approver reads, so it is on the line and not
            behind an expander. Its absence on a deviating line is called out
            here rather than left to be discovered at approval. */}
        {moved ? (
          line.deltaReason ? (
            <span className="text-xs italic">“{line.deltaReason}”</span>
          ) : (
            <span className="text-destructive text-xs">
              No reason recorded — a {mode} needs one, and it is what the approver reads.
            </span>
          )
        ) : null}
      </div>

      <div className="ml-auto shrink-0 text-right">
        <div className="text-sm font-medium tabular-nums">{money(line.lineTotal, currency)}</div>
        <div className="text-muted-foreground text-[11px]">
          {line.frequency && line.frequency !== "one_time" ? "per month" : "one-time"}
        </div>
      </div>

      {editable ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy} title="Edit this line">
            <Pencil className="size-3.5" />
            <span className="sr-only">Edit line</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRemove}
            disabled={busy}
            title="Remove this line"
          >
            <Trash2 className="size-3.5" />
            <span className="sr-only">Remove line</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── One line, being edited ───────────────────────────────────────────────────

function LineEditor({
  form,
  setForm,
  reference,
  currency,
  busy,
  error,
  onSave,
  onCancel,
}: {
  form: Form;
  setForm: (next: Form) => void;
  reference: ProposalReference | null;
  currency: string | null | undefined;
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });

  const modes = reference?.pricingModes ?? FALLBACK_MODES;
  const bases = reference?.pricingBases ?? FALLBACK_BASES;
  const frequencies = reference?.frequencies ?? FALLBACK_FREQUENCIES;
  // The unit master DEPENDS on the basis — an hourly rate measured in square
  // feet is a typo the form should make impossible rather than catch later.
  const units = reference?.unitsByBasis?.[form.pricingBasis] ?? ["each"];
  const reasons = reference?.deltaReasons ?? [];

  const isCustom = form.pricingMode === "custom";
  const hasDelta = form.pricingMode === "discount" || form.pricingMode === "markup";
  const reasonRequired = REASON_REQUIRED_MODES.includes(form.pricingMode);
  const reasonMissing = reasonRequired && !form.deltaReason.trim();
  const qtyValue = Number(form.qty);
  const qtyBad = !form.qty.trim() || !Number.isFinite(qtyValue) || qtyValue <= 0;

  return (
    <div className="bg-muted/30 flex flex-col gap-4 border-b px-4 py-4 last:border-b-0">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ln-desc">Description</Label>
        <Input
          id="ln-desc"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What the client reads on this line"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="ln-qty">Quantity</Label>
          <Input
            id="ln-qty"
            type="number"
            min="0"
            step="any"
            value={form.qty}
            onChange={(e) => set("qty", e.target.value)}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="ln-basis">Basis</Label>
          <Select
            value={form.pricingBasis}
            onValueChange={(v) => {
              // Changing the basis invalidates the unit, so the first legal one
              // is taken rather than leaving "sq ft per hour" on the record.
              const next = reference?.unitsByBasis?.[v]?.[0] ?? "each";
              setForm({ ...form, pricingBasis: v, uom: next });
            }}
          >
            <SelectTrigger id="ln-basis" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {bases.map((b) => (
                <SelectItem key={b} value={b}>
                  {humanise(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="ln-uom">Unit</Label>
          <Select value={form.uom} onValueChange={(v) => set("uom", v)}>
            <SelectTrigger id="ln-uom" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u} value={u}>
                  {humanise(u)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="ln-freq">Frequency</Label>
          <Select value={form.frequency} onValueChange={(v) => set("frequency", v)}>
            <SelectTrigger id="ln-freq" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {frequencies.map((f) => (
                <SelectItem key={f} value={f}>
                  {FREQUENCY_LABEL[f as Frequency] ?? humanise(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="ln-price">{isCustom ? "Your price" : "Card price"}</Label>
          <Input
            id="ln-price"
            inputMode="decimal"
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
            placeholder={`${currency ?? "AED"} 0.00`}
          />
          <span className="text-muted-foreground text-xs">
            {isCustom
              ? "There is no card rate behind a custom line, which is why it always reaches an approver."
              : "Copied from the rate card when the line was drafted, and frozen there."}
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="ln-mode">Pricing mode</Label>
          <Select
            value={form.pricingMode}
            onValueChange={(v) => set("pricingMode", v as PricingMode)}
          >
            <SelectTrigger id="ln-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modes.map((m) => (
                <SelectItem key={m} value={m}>
                  {PRICING_MODE_LABEL[m as PricingMode] ?? humanise(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Discount and markup are ONE field with a sign, and the sign lives
            server-side — the estimator types a magnitude. Shown only for the
            two modes that have one; custom carries its price instead. */}
        {hasDelta ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="ln-delta">
              {form.pricingMode === "discount" ? "Discount" : "Markup"}
            </Label>
            <div className="flex gap-2">
              <Input
                id="ln-delta"
                inputMode="decimal"
                value={form.deltaValue}
                onChange={(e) => set("deltaValue", e.target.value)}
                placeholder={form.deltaType === "pct" ? "10" : "0.00"}
                className="min-w-0 flex-1"
              />
              <Select
                value={form.deltaType}
                onValueChange={(v) => set("deltaType", v as DeltaType)}
              >
                <SelectTrigger className="w-24 shrink-0" aria-label="Delta type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(reference?.deltaTypes ?? ["pct", "amount"]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t === "pct" ? "%" : (currency ?? "amount")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
      </div>

      {/* MANDATORY for discount, markup and custom (spec §2.2 rule 3). The
          suggestions come from `reference` — free text in P1, a seeded list an
          hour later, and structured reasons are what make the number
          defensible when somebody asks in six months. */}
      {reasonRequired ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ln-reason">
            Reason
            <span className="text-destructive ml-1" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            id="ln-reason"
            value={form.deltaReason}
            onChange={(e) => set("deltaReason", e.target.value)}
            placeholder="Why this line left the card price"
            aria-invalid={reasonMissing}
          />
          {reasons.length ? (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {reasons.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => set("deltaReason", r)}
                  className="border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-full border px-2 py-0.5 text-xs transition-colors"
                >
                  {r}
                </button>
              ))}
            </div>
          ) : null}
          <span className="text-muted-foreground text-xs">
            The approver reads this, and nothing else about the line.
          </span>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={form.isOptional}
          onCheckedChange={(v) => set("isOptional", v === true)}
        />
        Optional — shown to the client, kept out of the total
      </label>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={busy || reasonMissing || qtyBad}>
          {busy ? "Saving…" : "Save line"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {reasonMissing ? (
          <span className="text-muted-foreground text-xs">
            A {form.pricingMode} needs a reason before it can be saved.
          </span>
        ) : null}
        {qtyBad ? (
          <span className="text-muted-foreground text-xs">
            A line needs a quantity above zero.
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ── The pane ─────────────────────────────────────────────────────────────────

export function LinesPane({
  proposal,
  reference,
  actor,
  onSaved,
}: {
  proposal: Proposal;
  reference: ProposalReference | null;
  actor: string;
  /** `line-save` returns the whole recomputed proposal — the page takes it
      wholesale rather than patching a line and re-adding the totals itself. */
  onSaved: (proposal: Proposal) => void;
}) {
  const editable = isLineEditable(proposal.status);
  const currency = proposal.currency;

  /** The line being edited, `"new"` for one being added, null for neither. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blankForm(false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Whatever the server had to say about the line it just saved. Warnings,
      never blocks — the save already happened. */
  const [problems, setProblems] = useState<string[]>([]);

  const committed = proposal.lines.filter((l) => !l.isOptional);
  const optional = proposal.lines.filter((l) => l.isOptional);

  const startEdit = (line: ProposalLine) => {
    setEditing(line.id);
    setForm(formOf(line));
    setError(null);
    setProblems([]);
  };

  const startAdd = (isOptional: boolean) => {
    setEditing("new");
    setForm(blankForm(isOptional));
    setError(null);
    setProblems([]);
  };

  const save = async () => {
    setBusy(true);
    setError(null);

    const mode = form.pricingMode;
    const hasDelta = mode === "discount" || mode === "markup";

    const draft: LineDraft = {
      ...(editing && editing !== "new" ? { lineId: editing } : {}),
      description: form.description.trim(),
      qty: Number(form.qty),
      pricingBasis: form.pricingBasis,
      uom: form.uom,
      frequency: form.frequency,
      // For a custom line the estimator's own number arrives HERE, because
      // there is no card row behind it to copy from.
      cardPrice: parseMoney(form.price) ?? undefined,
      pricingMode: mode,
      // Nulls, not omissions: going back to standard has to CLEAR the delta,
      // and only the payload envelope can carry an empty value at all.
      deltaType: hasDelta ? form.deltaType : null,
      deltaValue: hasDelta
        ? form.deltaType === "amount"
          ? parseMoney(form.deltaValue)
          : (numeric(form.deltaValue) ?? null)
        : null,
      deltaReason: REASON_REQUIRED_MODES.includes(mode) ? form.deltaReason.trim() : null,
      isOptional: form.isOptional,
    };

    const { data, error: err } = await saveLine(proposal.id, actor, draft);
    setBusy(false);

    if (err || !data?.proposal) {
      setError(err ?? "The line was not saved");
      return;
    }

    setEditing(null);
    setProblems(data.problems ?? []);
    onSaved(data.proposal);
  };

  const remove = async (lineId: string) => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await removeLine(proposal.id, lineId, actor);
    setBusy(false);
    if (err || !data?.proposal) {
      setError(err ?? "The line was not removed");
      return;
    }
    onSaved(data.proposal);
  };

  const rowFor = (line: ProposalLine) =>
    editing === line.id ? (
      <LineEditor
        key={line.id}
        form={form}
        setForm={setForm}
        reference={reference}
        currency={currency}
        busy={busy}
        error={error}
        onSave={save}
        onCancel={() => setEditing(null)}
      />
    ) : (
      <LineRow
        key={line.id}
        line={line}
        currency={currency}
        editable={editable}
        busy={busy}
        onEdit={() => startEdit(line)}
        onRemove={() => remove(line.id)}
      />
    );

  return (
    <>
      <Card
        title="Pricing"
        meta={editable ? undefined : `Frozen — a ${proposal.status.replace(/_/g, " ")} proposal cannot be edited`}
        pad={false}
      >
        {committed.length ? (
          committed.map(rowFor)
        ) : editing === "new" && !form.isOptional ? null : (
          <Empty
            title="No lines yet"
            tight
            body={
              proposal.surveyRevisionId
                ? "Generate them from the frozen survey revision, or add one by hand. Generating joins each surveyed entry's estimation key to the rate card, and anything the card cannot price comes back named rather than dropped."
                : "This proposal has no survey behind it, so there is nothing to generate from — the lines are added by hand, which is the path a job priced straight off a call takes."
            }
          />
        )}

        {editing === "new" && !form.isOptional ? (
          <LineEditor
            form={form}
            setForm={setForm}
            reference={reference}
            currency={currency}
            busy={busy}
            error={error}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        ) : null}

        {/* The two subtotals, side by side and NEVER added together: a one-time
            mobilisation fee and a monthly service charge are different kinds of
            money, and one figure covering both is true of neither. */}
        <div className="bg-muted/40 flex flex-wrap items-center gap-x-8 gap-y-2 border-t px-4 py-3">
          <span className="text-muted-foreground text-xs">Committed subtotals</span>
          <span className="ml-auto flex flex-wrap items-center gap-x-8 gap-y-1">
            <span className="text-sm tabular-nums">
              <span className="text-muted-foreground mr-2 text-xs">One-time</span>
              {money(proposal.oneTimeSubtotal, currency)}
            </span>
            <span className="text-sm tabular-nums">
              <span className="text-muted-foreground mr-2 text-xs">Recurring</span>
              {money(proposal.recurringMonthlySubtotal, currency)}
              <span className="text-muted-foreground text-xs"> / month</span>
            </span>
          </span>
        </div>

        {editable ? (
          <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
            <Button size="sm" variant="outline" onClick={() => startAdd(false)} disabled={busy}>
              <Plus className="size-4" />
              Add a line
            </Button>
            <Button size="sm" variant="ghost" onClick={() => startAdd(true)} disabled={busy}>
              <Plus className="size-4" />
              Add an optional line
            </Button>
          </div>
        ) : null}

        {/* The server's word on the line just saved. Shown, never used to block:
            the save already landed, and the estimator is the one who decides
            whether a warning matters (C8). */}
        {problems.length ? (
          <ul className="border-t px-4 py-3">
            {problems.map((p) => (
              <li key={p} className="text-muted-foreground text-xs">
                {p}
              </li>
            ))}
          </ul>
        ) : null}

        {error && !editing ? <p className="text-destructive px-4 py-3 text-sm">{error}</p> : null}
      </Card>

      {/* OPTIONAL SERVICES — its own block, after the pricing table, with its
          own subtotal, clearly outside the total (C10, spec §10 call 8). The
          client picks these at acceptance; forcing a re-sign to add an upsell
          is how the upsell is lost. */}
      {optional.length || (editing === "new" && form.isOptional) ? (
        <Card
          title="Optional services"
          meta="Shown to the client · outside the totals above"
          pad={false}
          // A dashed edge says "priced, but not counted" before a word is read.
          className="border-dashed"
        >
          {optional.map(rowFor)}

          {editing === "new" && form.isOptional ? (
            <LineEditor
              form={form}
              setForm={setForm}
              reference={reference}
              currency={currency}
              busy={busy}
              error={error}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          ) : null}

          <div className="bg-muted/40 flex flex-wrap items-center gap-x-8 gap-y-2 border-t px-4 py-3">
            <span className="text-muted-foreground text-xs">
              Optional subtotal — not part of what the client is being asked to accept
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-x-8 gap-y-1">
              <span className="text-sm tabular-nums">
                <span className="text-muted-foreground mr-2 text-xs">One-time</span>
                {money(proposal.optionalOneTimeTotal, currency)}
              </span>
              <span className="text-sm tabular-nums">
                <span className="text-muted-foreground mr-2 text-xs">Recurring</span>
                {money(proposal.optionalRecurringMonthlyTotal, currency)}
                <span className="text-muted-foreground text-xs"> / month</span>
              </span>
            </span>
          </div>
        </Card>
      ) : null}
    </>
  );
}
