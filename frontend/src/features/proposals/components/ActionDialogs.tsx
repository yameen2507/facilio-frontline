/**
 * The dialogs the lifecycle actions open.
 *
 * Three shapes, not nine: a confirmation for the moves that are irreversible, a
 * reason prompt for the moves the spec says cannot happen silently (return and
 * withdraw), and the client's answer. Each is generic over its copy, because
 * what differs between "send" and "approve" is the sentence, not the mechanics
 * — and nine near-identical dialogs is nine places for the busy state and the
 * error handling to drift apart.
 *
 * EVERY ONE OF THEM RENDERS THE SERVER'S REJECTION VERBATIM AND STAYS OPEN.
 * These handlers are a seam right now (see api/proposals-util.ts), so this is
 * not a theoretical path: the estimator finds out what the platform said, in
 * the platform's words, without losing what they had typed.
 *
 * The `onConfirm` contract is `Promise<string | null>` — the error message, or
 * null for success. A rejection is a normal response in this app, never a
 * throw, so a dialog that had to try/catch would be arguing with the request
 * layer.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** A move that cannot be taken back — send freezes a revision, approve clears a
    deviation. No input, one sentence saying what becomes true. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busyLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const err = await onConfirm();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {error ? <p className="text-destructive py-4 text-sm">{error}</p> : <div className="py-2" />}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? busyLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A move that cannot happen silently. Returning a proposal and withdrawing one
 * both carry a mandatory reason — the person on the other end has to know why,
 * and the record has to be able to answer the same question a year later.
 *
 * The confirm button is disabled until there is something to say, which is the
 * same gate the survey lane puts on cancelling.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  confirmLabel,
  busyLabel,
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  label: string;
  placeholder: string;
  confirmLabel: string;
  busyLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || busy) return;
    setBusy(true);
    const err = await onConfirm(reason.trim());
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pd-reason">{label}</Label>
              <Textarea
                id="pd-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={placeholder}
              />
            </div>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={!reason.trim() || busy}
            >
              {busy ? busyLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What the client answered. Two outcomes, and the reason is mandatory on only
 * one of them: a rejection feeds win/loss, and "we lost it" with no cause
 * recorded is the row that makes the whole report useless. An acceptance may
 * carry a note and does not need one.
 */
export function RespondDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (decision: "accepted" | "rejected", reason: string) => Promise<string | null>;
}) {
  const [decision, setDecision] = useState<"accepted" | "rejected">("accepted");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDecision("accepted");
      setReason("");
      setError(null);
    }
  }, [open]);

  const needsReason = decision === "rejected";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if ((needsReason && !reason.trim()) || busy) return;
    setBusy(true);
    const err = await onConfirm(decision, reason.trim());
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Record the client's response</DialogTitle>
            <DialogDescription>
              Acceptance is recorded here rather than signed by the client: this platform serves no
              public page, so there is nowhere for them to sign. Which optional services they took
              is part of the acceptance, and it drives the work orders.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pr-decision">They</Label>
              <Select
                value={decision}
                onValueChange={(v) => setDecision(v as "accepted" | "rejected")}
              >
                <SelectTrigger id="pr-decision" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="accepted">Accepted the proposal</SelectItem>
                  <SelectItem value="rejected">Rejected it</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pr-reason">
                {needsReason ? "Why they rejected it" : "Note"}
                {needsReason ? (
                  <span className="text-destructive ml-1" aria-hidden="true">
                    *
                  </span>
                ) : null}
              </Label>
              <Textarea
                id="pr-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  needsReason
                    ? "Price, timing, incumbent, scope — this is what win/loss is built from"
                    : "Anything worth keeping with the acceptance"
                }
              />
            </div>

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || (needsReason && !reason.trim())}>
              {busy ? "Recording…" : "Record response"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
