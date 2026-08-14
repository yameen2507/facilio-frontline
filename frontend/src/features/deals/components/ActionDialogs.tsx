/**
 * The dialogs the deal lifecycle opens.
 *
 * Four shapes: move (pick a working stage, optional note), win (the final
 * commercials deal.md 9A captures), lose (the reason plus the analysis fields
 * the win/loss report is built from), reopen (the deliberate door out of a
 * terminal stage, with a mandatory why).
 *
 * EVERY ONE RENDERS THE SERVER'S REJECTION VERBATIM AND STAYS OPEN — the stage
 * machine lives on the backend, and its message ("cannot go from X to Y…") is
 * the explanation the user needs, in the words the logs will use.
 *
 * The `onConfirm` contract is `Promise<string | null>` — the error message, or
 * null for success. A rejection is a normal response in this app, never a
 * throw (see lib/request.ts).
 */

import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LOST_REASON_LABEL,
  STAGE_LABEL,
  type DealStage,
  type LostReason,
} from "../types/deal";

/** The submit/busy/error scaffold every dialog here shares. */
function useDialogSubmit(open: boolean) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return { busy, setBusy, error, setError };
}

const ErrorLine = ({ error }: { error: string | null }) =>
  error ? <p className="text-destructive text-sm">{error}</p> : null;

const Footer = ({ busy, busyLabel, label, disabled = false, destructive = false }: {
  busy: boolean;
  busyLabel: string;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
}) => (
  <DialogFooter>
    <DialogClose asChild>
      <Button type="button" variant="outline" disabled={busy}>
        Cancel
      </Button>
    </DialogClose>
    <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy || disabled}>
      {busy ? busyLabel : label}
    </Button>
  </DialogFooter>
);

/**
 * Move to another working stage. The options are the server's own `allowedNext`
 * minus the terminal pair — winning and losing get their own dialogs because
 * each captures more than a stage name.
 */
export function MoveStageDialog({
  open,
  onOpenChange,
  stages,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: DealStage[];
  onConfirm: (toStage: DealStage, note: string) => Promise<string | null>;
}) {
  const [toStage, setToStage] = useState<DealStage | "">("");
  const [note, setNote] = useState("");
  const { busy, setBusy, error, setError } = useDialogSubmit(open);

  useEffect(() => {
    if (open) {
      // The nearest stage ahead is the overwhelmingly common move, so it is
      // preselected; the rest of the list is the skips the machine allows.
      setToStage(stages[0] ?? "");
      setNote("");
    }
  }, [open, stages]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!toStage || busy) return;
    setBusy(true);
    const err = await onConfirm(toStage, note.trim());
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Move the deal</DialogTitle>
            <DialogDescription>
              Stages that do not apply can be skipped — a repeat customer with a finished survey
              goes straight to estimation. The timeline records every move.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dm-stage">To stage</Label>
              <Select value={toStage} onValueChange={(v) => setToStage(v as DealStage)}>
                <SelectTrigger id="dm-stage" className="w-full">
                  <SelectValue placeholder="Pick a stage" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STAGE_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dm-note">Note</Label>
              <Textarea
                id="dm-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What moved it — optional, lands on the timeline"
              />
            </div>

            <ErrorLine error={error} />
          </div>

          <Footer busy={busy} busyLabel="Moving…" label="Move deal" disabled={!toStage} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Won — deal.md 9A. The final agreed value and the contract dates are captured
 * WITH the stage change so the operations handover starts from real numbers,
 * not the estimate the deal opened with. All optional: a win recorded fast
 * beats a win not recorded.
 */
export function WinDialog({
  open,
  onOpenChange,
  currency,
  estimatedValue,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  estimatedValue: number | null;
  onConfirm: (capture: Record<string, unknown>, note: string) => Promise<string | null>;
}) {
  const [finalValue, setFinalValue] = useState("");
  const [startDate, setStartDate] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [note, setNote] = useState("");
  const { busy, setBusy, error, setError } = useDialogSubmit(open);

  useEffect(() => {
    if (open) {
      setFinalValue(estimatedValue != null ? String(estimatedValue) : "");
      setStartDate("");
      setDurationMonths("");
      setNote("");
    }
  }, [open, estimatedValue]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const err = await onConfirm(
      {
        // Absent fields are simply not captured — a null here would clear
        // nothing (the sheet is new) but would still store noise.
        ...(finalValue.trim() ? { finalValue: Number(finalValue) } : {}),
        ...(startDate ? { contractStartDate: startDate } : {}),
        ...(durationMonths.trim() ? { contractDurationMonths: Number(durationMonths) } : {}),
      },
      note.trim()
    );
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Mark the deal won</DialogTitle>
            <DialogDescription>
              Won is terminal — it hands the deal to operations for onboarding. Only an authorised
              reopen brings it back.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dw-value">Final value ({currency})</Label>
                <Input
                  id="dw-value"
                  type="number"
                  min="0"
                  step="any"
                  value={finalValue}
                  onChange={(e) => setFinalValue(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dw-duration">Duration (months)</Label>
                <Input
                  id="dw-duration"
                  type="number"
                  min="1"
                  value={durationMonths}
                  onChange={(e) => setDurationMonths(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dw-start">Contract start</Label>
              <Input id="dw-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dw-note">Note</Label>
              <Textarea
                id="dw-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Final terms worth keeping with the win"
              />
            </div>

            <ErrorLine error={error} />
          </div>

          <Footer busy={busy} busyLabel="Recording…" label="Mark won" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Lost — deal.md 9B. The reason is the one mandatory field; the rest is the
 * analysis sheet the future win/loss report (and the AI behind it) reads.
 * Everything lands under `data_json.lost` and SURVIVES a reopen — the module
 * archives it to `lostHistory` rather than deleting it.
 */
export function LoseDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: LostReason, capture: Record<string, unknown>) => Promise<string | null>;
}) {
  const [reason, setReason] = useState<LostReason | "">("");
  const [detail, setDetail] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [future, setFuture] = useState("");
  const { busy, setBusy, error, setError } = useDialogSubmit(open);

  useEffect(() => {
    if (open) {
      setReason("");
      setDetail("");
      setCompetitor("");
      setSentiment("");
      setFuture("");
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason || busy) return;
    setBusy(true);
    const err = await onConfirm(reason, {
      ...(detail.trim() ? { lostReasonDetail: detail.trim() } : {}),
      ...(competitor.trim() ? { competitor: competitor.trim() } : {}),
      ...(sentiment ? { customerSentiment: sentiment } : {}),
      ...(future ? { futureOpportunity: future } : {}),
    });
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Mark the deal lost</DialogTitle>
            <DialogDescription>
              The reason is what the win/loss report is built from — "we lost it" with no cause
              recorded is the row that makes the whole report useless.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dl-reason">
                Lost reason
                <span className="text-destructive ml-1" aria-hidden="true">*</span>
              </Label>
              <Select value={reason} onValueChange={(v) => setReason(v as LostReason)}>
                <SelectTrigger id="dl-reason" className="w-full">
                  <SelectValue placeholder="Why it did not proceed" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(LOST_REASON_LABEL) as LostReason[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {LOST_REASON_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dl-detail">What happened</Label>
              <Textarea
                id="dl-detail"
                rows={2}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder='e.g. "Their price was 18% under ours"'
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dl-competitor">Who won it</Label>
              <Input
                id="dl-competitor"
                value={competitor}
                onChange={(e) => setCompetitor(e.target.value)}
                placeholder="Competitor, if known"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dl-sentiment">Customer sentiment</Label>
                <Select value={sentiment} onValueChange={setSentiment}>
                  <SelectTrigger id="dl-sentiment" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="positive">Positive</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                    <SelectItem value="negative">Negative</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dl-future">Future opportunity</Label>
                <Select value={future} onValueChange={setFuture}>
                  <SelectTrigger id="dl-future" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <ErrorLine error={error} />
          </div>

          <Footer busy={busy} busyLabel="Recording…" label="Mark lost" disabled={!reason} destructive />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The door back out of won/lost. The why is mandatory — reopening a closed
 * deal is exactly the move an audit asks about later — and the deal resumes at
 * the stage it closed from, which the description states so nobody is
 * surprised where it lands.
 */
export function ReopenDialog({
  open,
  onOpenChange,
  closedStage,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closedStage: string;
  onConfirm: (note: string) => Promise<string | null>;
}) {
  const [note, setNote] = useState("");
  const { busy, setBusy, error, setError } = useDialogSubmit(open);

  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim() || busy) return;
    setBusy(true);
    const err = await onConfirm(note.trim());
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Reopen this {closedStage} deal</DialogTitle>
            <DialogDescription>
              It resumes at the stage it closed from, and the {closedStage === "lost" ? "lost analysis is kept in the deal's history" : "win record moves to the timeline"}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dr-note">
                Why it is being reopened
                <span className="text-destructive ml-1" aria-hidden="true">*</span>
              </Label>
              <Textarea
                id="dr-note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. the selected vendor fell through and the customer came back"
              />
            </div>
            <ErrorLine error={error} />
          </div>

          <Footer busy={busy} busyLabel="Reopening…" label="Reopen deal" disabled={!note.trim()} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The discovery sheet — deal.md stage 2's capture, the fields estimation needs
 * before anything can be priced. Merged, not replaced, on save; a field left
 * blank leaves what was already captured alone, so two people can fill
 * different halves of the sheet.
 */
export function DiscoveryDialog({
  open,
  onOpenChange,
  existing,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: Record<string, unknown>;
  onConfirm: (values: Record<string, unknown>) => Promise<string | null>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const { busy, setBusy, error, setError } = useDialogSubmit(open);

  const FIELDS: { key: string; label: string; placeholder: string }[] = [
    { key: "facilityType", label: "Facility type", placeholder: "Restaurant, office, mall…" },
    { key: "numberOfSites", label: "Number of sites", placeholder: "1" },
    { key: "approxAreaSqft", label: "Approx. area (sqft)", placeholder: "12000" },
    { key: "frequency", label: "Frequency", placeholder: "Quarterly, monthly…" },
    { key: "startDate", label: "Expected start", placeholder: "2026-10-01" },
    { key: "contractDurationMonths", label: "Duration (months)", placeholder: "12" },
    { key: "existingProvider", label: "Existing provider", placeholder: "Who serves them today" },
    { key: "decisionMakers", label: "Decision makers", placeholder: "Names and roles" },
    { key: "procurementProcess", label: "Procurement process", placeholder: "Direct, RFP, tender…" },
    { key: "budget", label: "Budget", placeholder: "If they shared one" },
  ];

  useEffect(() => {
    if (open) {
      const seed: Record<string, string> = {};
      for (const f of FIELDS) {
        const v = existing[f.key];
        if (v !== undefined && v !== null) seed[f.key] = String(v);
      }
      setValues(seed);
    }
    // FIELDS is a literal; `existing` is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const out: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const v = (values[f.key] ?? "").trim();
      if (v) out[f.key] = v;
    }
    if (!Object.keys(out).length) return;
    setBusy(true);
    const err = await onConfirm(out);
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
  };

  const filled = Object.values(values).some((v) => v.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Discovery</DialogTitle>
            <DialogDescription>
              What estimation needs before anything can be priced. Saved fields merge into the
              sheet — a blank leaves what is already there alone.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-4 max-sm:grid-cols-1">
            {FIELDS.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label htmlFor={`dd-${f.key}`}>{f.label}</Label>
                <Input
                  id={`dd-${f.key}`}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                />
              </div>
            ))}
            <div className="col-span-full">
              <ErrorLine error={error} />
            </div>
          </div>

          <Footer busy={busy} busyLabel="Saving…" label="Save discovery" disabled={!filled} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
