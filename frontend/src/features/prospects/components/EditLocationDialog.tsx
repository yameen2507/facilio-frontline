/**
 * ★ THE ONE EDIT FORM (§6.2). Every field in §3, grouped as §3 groups them, one
 * save.
 *
 * WHAT IT REPLACES, because the thing it replaces was defensible and still
 * wrong: v1.1 §4.3 ruled that nothing edits an attribute directly, and the build
 * applied that rule to the SCREEN as well as to the storage — so all sixteen
 * fields were typed one at a time through a modal called "Record a measurement",
 * under a panel headed MEASUREMENTS, including Country and Name. Filling one
 * building's address and size took eight round-trips. The ledger underneath was
 * never the problem. **The storage model had been shipped as the user
 * interface.**
 *
 * The ledger is untouched: `prospect.update` still writes one observation per
 * CHANGED field and still lets the acceptance flow land the value, so a priced
 * field that contradicts what is already recorded still stops and waits for a
 * person (§6.3). What changes is that the caller sends thirty fields at once —
 * and that the word "observation" never reaches this screen.
 *
 * TWO RULES THIS FORM MUST NOT BREAK:
 *
 * 1. **A blank box means "I did not fill this in", never "delete what is
 *    there".** An emptied field is not sent at all, so the form cannot claim a
 *    clearance the server will not perform — `update` pushes an empty value to
 *    `skipped` and leaves the stored value alone.
 * 2. **Provenance is inferred, not chosen.** A person typing here stamps
 *    `manual`; the walk stamps `survey` and the ingest stamps `rfp` from their
 *    own call sites. The old modal asked the user to pick, which is how "rfp"
 *    ended up in a sentence that reads "From documents" everywhere else (X-13).
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import { Separator } from "@/components/ui/separator";
import { plural } from "../../../lib/format";
import { updateLocation } from "../api/prospects-util";
import {
  EDIT_GROUPS,
  EDITABLE_FIELDS,
  fieldTier,
  OBSERVABLE_FIELD_LABEL,
  type EditableField,
  type ProspectLocation,
} from "../types/prospect";

/**
 * The fields whose content is a sentence rather than a token, given a whole row
 * instead of half of one. A name or a street in a half-width box scrolls
 * sideways while you are still typing it.
 */
const WIDE_FIELDS = new Set(["name", "description", "location_name", "street"]);

/**
 * The field keys are the COLUMN names (`no_of_floors`), because that is what the
 * handler's allowlist takes; the read model is camel-cased. One conversion, in
 * one place, rather than a second hand-kept map that can drift from the first.
 */
const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * What the form shows for a field, given the location it is editing.
 *
 * Indexed dynamically, so it is read through a record cast once here rather than
 * at thirty call sites: the field list is data and `ProspectLocation` is a
 * closed type, so no amount of narrowing makes `location[key]` legal.
 *
 * Zero is a real answer — a ground floor is `floor_level: 0` — so only null and
 * undefined become an empty box.
 */
function currentValue(location: ProspectLocation, field: EditableField): string {
  const raw = (location as unknown as Record<string, unknown>)[camel(field.key)];
  return raw === null || raw === undefined ? "" : String(raw);
}

const prefill = (location: ProspectLocation): Record<string, string> =>
  Object.fromEntries(EDITABLE_FIELDS.map((f) => [f.key, currentValue(location, f)]));

/**
 * The server's reason, ended as a sentence.
 *
 * X-13 was this exact seam: the conflict copy ran `{reason}` straight into the
 * next string with nothing between them, so two sentences arrived fused. The
 * reason is still shown VERBATIM — this adds a full stop when the clause has no
 * terminator of its own and changes not one word of it.
 */
const asSentence = (s: string) => {
  const t = s.trim();
  return !t || /[.!?]$/.test(t) ? t : `${t}.`;
};

export function EditLocationDialog({
  open,
  onOpenChange,
  location,
  actor,
  onSaved,
  onShowContested,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: ProspectLocation | null;
  actor: string;
  /** Refetch. Called on every save, including one that raised a conflict —
      the fields that DID land are already live behind the dialog. */
  onSaved: () => void;
  /** Take the reader to the values now waiting to be settled. */
  onShowContested: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  /** What the location said when the form opened — the diff is against this. */
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** The server's message, VERBATIM. */
  const [error, setError] = useState<string | null>(null);
  /**
   * Kept AFTER a save that raised conflicts instead of closing, because the
   * useful information is that those values are NOT in use. Closing on "saved"
   * would imply the numbers had landed when the point is that they have not.
   */
  const [contested, setContested] = useState<Array<{ fieldKey: string; reason: string }> | null>(
    null
  );

  useEffect(() => {
    if (!open || !location) return;
    setValues(prefill(location));
    setInitial(prefill(location));
    setError(null);
    setContested(null);
  }, [open, location]);

  const set = (key: string) => (value: string) => setValues((v) => ({ ...v, [key]: value }));

  /**
   * What will actually be sent.
   *
   * An emptied box is EXCLUDED, not sent as "": the handler skips empty values
   * and leaves the stored one alone, so sending it would let the form report a
   * clearance that never happened and the value would reappear on reload.
   */
  const changedFields = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) {
      const next = (values[f.key] ?? "").trim();
      if (!next || next === (initial[f.key] ?? "").trim()) continue;
      out[f.key] = next;
    }
    return out;
  }, [values, initial]);

  /**
   * Derived, never stored. X-16 was a stored error that survived the keystroke
   * that fixed it; and §1.4's keystroke guard — "about 4.5k" produces nothing —
   * is one of the things this pass must not regress.
   */
  const badNumbers = EDITABLE_FIELDS.filter(
    (f) =>
      f.kind === "number" &&
      (values[f.key] ?? "").trim() !== "" &&
      !Number.isFinite(Number((values[f.key] ?? "").trim()))
  );

  const changedCount = Object.keys(changedFields).length;
  const canSubmit = Boolean(location) && changedCount > 0 && badNumbers.length === 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!location || !canSubmit || busy) return;
    setBusy(true);
    setError(null);
    setContested(null);

    // Provenance is not passed: a person typing into this form IS `manual`, and
    // the default says so without offering it as a choice (§6.2).
    const { data, error: err } = await updateLocation(location.id, changedFields, actor);
    setBusy(false);
    if (err || !data) return setError(err ?? "Nothing was saved");

    onSaved();

    if (data.conflicts > 0) {
      // `outcome` is the server's enum and never reaches the screen — it is only
      // ever filtered on. The field's own label and the reason are what show.
      setContested(
        data.changed
          .filter((c) => c.outcome === "conflict")
          .map((c) => ({ fieldKey: c.fieldKey, reason: c.reason }))
      );
      return;
    }
    onOpenChange(false);
  };

  const priced = Object.keys(changedFields).filter((k) => fieldTier(k) === "priced").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {contested ? (
          /* Not an error, and it must not read as one: nothing was overwritten,
             which is the system doing the one thing it was built to do. */
          <div className="flex min-w-0 flex-col gap-5">
            <DialogHeader>
              <DialogTitle>
                Saved, with {plural(contested.length, "value", "values")} to settle
              </DialogTitle>
              <DialogDescription>
                {contested.length === 1
                  ? "One value disagrees with what was already recorded, so it is waiting for someone to choose. Nothing was overwritten and the rest of your changes are in."
                  : "These values disagree with what was already recorded, so they are waiting for someone to choose. Nothing was overwritten and the rest of your changes are in."}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              {contested.map((c) => (
                <div key={c.fieldKey} className="border-orange-500/40 bg-orange-500/5 rounded-md border px-3 py-2">
                  {/* The label, never the field key — `no_of_floors` is a column
                      name and no user should ever meet one. */}
                  <span className="text-sm font-medium">
                    {OBSERVABLE_FIELD_LABEL[c.fieldKey] ?? c.fieldKey}
                  </span>
                  {/* The server's sentence on its own line, not run into the one
                      after it. That fusion was X-13. */}
                  <div className="text-muted-foreground mt-0.5 text-sm">{asSentence(c.reason)}</div>
                </div>
              ))}
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Close
                </Button>
              </DialogClose>
              <Button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onShowContested();
                }}
              >
                Settle {contested.length === 1 ? "it" : "them"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
            <DialogHeader>
              <DialogTitle>Edit {location?.name ?? "this property"}</DialogTitle>
              <DialogDescription>
                Everything about this property, in one form and one save. A box you leave empty is
                left as it is — clearing a value the RFP filled in is its own deliberate act, not
                something a blank box does.
              </DialogDescription>
            </DialogHeader>

            <div className="overlay-scroll -mx-1 flex max-h-[55vh] min-w-0 flex-col gap-4 overflow-y-auto px-1">
              {EDIT_GROUPS.map((group, i) => (
                <div key={group.title} className="flex min-w-0 flex-col gap-3">
                  {i > 0 ? <Separator className="mb-1" /> : null}
                  {/* The micro-label from ui/Card's SectionTitle, written out
                      rather than imported: that component carries card-body
                      margins, which double the gap inside this flex column. */}
                  <div>
                    <div className="text-muted-foreground text-[10px] font-medium tracking-[0.06em] uppercase">
                      {group.title}
                    </div>
                    {group.note ? (
                      <p className="text-muted-foreground mt-1 text-xs">{group.note}</p>
                    ) : null}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {group.fields.map((f) => (
                      <div
                        key={f.key}
                        className={
                          WIDE_FIELDS.has(f.key)
                            ? "flex min-w-0 flex-col gap-1.5 sm:col-span-2"
                            : "flex min-w-0 flex-col gap-1.5"
                        }
                      >
                        <Label htmlFor={`el-${f.key}`}>{f.label}</Label>

                        {f.kind === "select" ? (
                          /* X-12: a band, not a number. Ceiling height decides
                             whether the crew needs a lift, so "12" typed into a
                             free-text box priced nothing. */
                          <Select
                            value={values[f.key] || undefined}
                            onValueChange={(v) => set(f.key)(v)}
                          >
                            <SelectTrigger id={`el-${f.key}`} className="w-full">
                              <SelectValue placeholder="Not recorded" />
                            </SelectTrigger>
                            <SelectContent>
                              {(f.options ?? []).map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            id={`el-${f.key}`}
                            value={values[f.key] ?? ""}
                            onChange={(e) => set(f.key)(e.target.value)}
                            inputMode={f.kind === "number" ? "decimal" : undefined}
                          />
                        )}

                        {/* C35 — every field says why it exists. Already right in
                            the build; kept field-for-field. */}
                        {f.help ? (
                          <span className="text-muted-foreground text-xs">{f.help}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {error ? <span className="text-destructive text-sm">{error}</span> : null}

            {/* Said before the save, not after it: a priced change can come back
                unapplied, and that is much easier to read as intended when it
                was announced in advance (§6.3). */}
            {priced > 0 ? (
              <span className="text-muted-foreground text-xs">
                {plural(priced, "change", "changes")} here can move the price. If one disagrees with
                what is already recorded, both values are kept and someone settles it — nothing is
                overwritten.
              </span>
            ) : null}

            <DialogFooter>
              {!canSubmit ? (
                <span className="text-muted-foreground mr-auto self-center text-xs">
                  {badNumbers.length
                    ? `${badNumbers[0].label} has to be a number`
                    : "Nothing has changed yet"}
                </span>
              ) : null}
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!canSubmit || busy}>
                {busy
                  ? "Saving…"
                  : changedCount
                    ? `Save ${plural(changedCount, "change", "changes")}`
                    : "Save"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
