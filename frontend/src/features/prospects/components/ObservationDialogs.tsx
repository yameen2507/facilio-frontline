/**
 * The two halves of §4.3, as dialogs: recording a value, and settling a
 * disagreement about one.
 *
 * Neither of these is an edit form, and the copy is written to make that legible
 * rather than to hide it. "Record a measurement" is not a longer way to say
 * "edit": the value you type is *your claim*, it keeps your name on it, and if it
 * contradicts what is already accepted then both survive and someone chooses. A
 * form that silently replaced the old number would be shorter and would also
 * destroy the only evidence of how the price was built.
 */

import { useEffect, useState, type FormEvent } from "react";
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
import { autoFocusField } from "@/lib/utils";
import { decideObservation, observe } from "../api/prospects-util";
import { ProvenanceChip } from "./ProspectChips";
import {
  NUMERIC_FIELDS,
  OBSERVABLE_FIELD_LABEL,
  observationValue,
  PROVENANCE_LABEL,
  RECONCILIATION_DECISION_LABEL,
  type ProspectLocation,
  type ProspectObservation,
  type Provenance,
  type ReconciliationDecision,
} from "../types/prospect";

/** Which feeds a person can claim to be speaking for, by hand. */
const MANUAL_PROVENANCES: Provenance[] = ["manual", "rfp", "survey"];

// ── Record ───────────────────────────────────────────────────────────────────

export function ObserveDialog({
  open,
  onOpenChange,
  location,
  fields,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: ProspectLocation;
  fields: string[];
  actor: string;
  onDone: () => void;
}) {
  const [fieldKey, setFieldKey] = useState("area_sqft");
  const [value, setValue] = useState("");
  const [provenance, setProvenance] = useState<Provenance>("manual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What the server decided. Kept AFTER a successful write instead of closing,
   * because on a conflict the useful information is that nothing was applied —
   * closing the dialog on "saved" would imply the number is now in use when it
   * is not.
   */
  const [outcome, setOutcome] = useState<{ kind: string; reason: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setFieldKey("area_sqft");
    setValue("");
    setProvenance("manual");
    setError(null);
    setOutcome(null);
  }, [open]);

  const numeric = NUMERIC_FIELDS.includes(fieldKey);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    const { data, error: err } = await observe(location.id, fieldKey, value.trim(), actor, {
      provenance,
    });
    setBusy(false);
    if (err || !data) return setError(err ?? "The measurement was not recorded");

    onDone();

    if (data.outcome === "conflict") {
      // Stay open and say so. The value was recorded but is NOT in use.
      setOutcome({ kind: "conflict", reason: data.reason });
      setValue("");
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Record a measurement</DialogTitle>
            <DialogDescription>
              What you record is kept as your reading of {location.name}, with your name on it. If
              it matches what is already there it becomes the value in use; if it disagrees, both
              are kept and someone settles it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ob-field">What are you measuring</Label>
              <Select value={fieldKey} onValueChange={setFieldKey}>
                <SelectTrigger id="ob-field" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((f) => (
                    <SelectItem key={f} value={f}>
                      {OBSERVABLE_FIELD_LABEL[f] ?? f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ob-value">
                Value <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ob-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode={numeric ? "decimal" : undefined}
                placeholder={numeric ? "4500" : ""}
                autoFocus={autoFocusField()}
              />
              {numeric ? (
                <span className="text-muted-foreground text-xs">
                  A number. &ldquo;About 4.5k&rdquo; is refused rather than stored — a building
                  whose area is a phrase cannot be priced.
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ob-prov">Where it came from</Label>
              <Select value={provenance} onValueChange={(v) => setProvenance(v as Provenance)}>
                <SelectTrigger id="ob-prov" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_PROVENANCES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVENANCE_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground text-xs">
                Recorded with the value, because the document and the walk will disagree and you
                will need to know which is which.
              </span>
            </div>
          </div>

          {error ? <span className="text-destructive text-sm">{error}</span> : null}

          {outcome?.kind === "conflict" ? (
            <div className="border-orange-500/40 bg-orange-500/5 rounded-md border px-3 py-2">
              <span className="text-sm font-medium">Recorded, but not in use</span>
              <div className="text-muted-foreground mt-1 text-sm">
                {outcome.reason} Nothing was overwritten — settle it on the location and the winner
                becomes the value everything else reads.
              </div>
            </div>
          ) : null}

          <DialogFooter>
            {!value.trim() ? (
              <span className="text-muted-foreground mr-auto self-center text-xs">
                Enter a value
              </span>
            ) : null}
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {outcome ? "Close" : "Cancel"}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!value.trim() || busy}>
              {busy ? "Recording…" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Settle ───────────────────────────────────────────────────────────────────

/** The shape the detail page groups a field's observations into. */
type FieldGroup = {
  fieldKey: string;
  label: string;
  accepted: ProspectObservation | null;
  pending: ProspectObservation[];
};

export function ResolveDialog({
  open,
  onOpenChange,
  locationId,
  group,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  group: FieldGroup | null;
  actor: string;
  onDone: () => void;
}) {
  const [decision, setDecision] = useState<ReconciliationDecision>("accepted_survey");
  const [manualValue, setManualValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Which sources are actually in this conflict — the rest cannot be chosen. */
  const all = group ? [...(group.accepted ? [group.accepted] : []), ...group.pending] : [];
  const provenances = [...new Set(all.map((o) => o.provenance))];
  const hasSurvey = provenances.includes("survey");
  const hasRfp = provenances.includes("rfp");

  useEffect(() => {
    if (!open || !group) return;
    // Default to whichever source is present, survey first: the walk saw the
    // building. Never defaulted to a manual override — that would nudge the user
    // toward discarding both readings.
    setDecision(hasSurvey ? "accepted_survey" : hasRfp ? "accepted_rfp" : "manual_override");
    setManualValue("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group]);

  const options: ReconciliationDecision[] = [
    ...(hasSurvey ? (["accepted_survey"] as ReconciliationDecision[]) : []),
    ...(hasRfp ? (["accepted_rfp"] as ReconciliationDecision[]) : []),
    "manual_override",
    "pushed_to_clarification",
  ];

  const needsValue = decision === "manual_override";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!group || busy || (needsValue && !manualValue.trim())) return;
    setBusy(true);
    setError(null);
    const { error: err } = await decideObservation(
      locationId,
      group.fieldKey,
      decision,
      actor,
      needsValue ? manualValue.trim() : undefined
    );
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Settle {group?.label ?? "this value"}</DialogTitle>
            <DialogDescription>
              Both readings are true statements from different sources at different times. Whatever
              you choose becomes the value the proposal is priced on, and the other is kept with
              your decision recorded against it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            {all.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                <span className="text-sm font-medium">{observationValue(o)}</span>
                <ProvenanceChip provenance={o.provenance} />
                <span className="min-w-2 flex-1" />
                <span className="text-muted-foreground text-xs">{o.observedBy ?? "unknown"}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rs-decision">What should it be</Label>
            <Select value={decision} onValueChange={(v) => setDecision(v as ReconciliationDecision)}>
              <SelectTrigger id="rs-decision" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((d) => (
                  <SelectItem key={d} value={d}>
                    {RECONCILIATION_DECISION_LABEL[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {decision === "pushed_to_clarification" ? (
              <span className="text-muted-foreground text-xs">
                Nothing is recorded as the value. The field stays unsettled on purpose, so the open
                question is visible rather than hidden behind a guess.
              </span>
            ) : null}
          </div>

          {needsValue ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rs-manual">
                The value to use <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rs-manual"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                autoFocus={autoFocusField()}
              />
              <span className="text-muted-foreground text-xs">
                For when neither reading was right — a re-measure, or a corrected drawing.
              </span>
            </div>
          ) : null}

          {error ? <span className="text-destructive text-sm">{error}</span> : null}

          <DialogFooter>
            {needsValue && !manualValue.trim() ? (
              <span className="text-muted-foreground mr-auto self-center text-xs">
                Enter the value
              </span>
            ) : null}
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || (needsValue && !manualValue.trim())}>
              {busy ? "Settling…" : "Settle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
