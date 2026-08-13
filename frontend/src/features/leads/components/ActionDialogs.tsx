/**
 * The lead actions that need input, as real dialogs.
 *
 * These replaced the `prompt()` / `confirm()` calls inherited from the vanilla
 * console — a close confirmation now names its consequence, the close reason is
 * a pick from the vocabulary the backend validates instead of free text spelled
 * from memory, and the sales-vs-actioner choice is two labelled options rather
 * than OK/Cancel carrying meanings no one remembers.
 *
 * Submit contract: each `onSubmit` resolves `true` when the mutation landed
 * (the parent closes the dialog) and `false` when it was rejected (the error is
 * already toasted; the dialog stays open with the input intact so the user can
 * fix and retry). All four stay mounted with `open` driven from the parent, so
 * the radix exit animation plays; fields reset when a dialog OPENS, which is
 * also what keeps a half-typed value from resurfacing a session later.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
import { DateField } from "../../../ui/DateField";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { humanise } from "@/lib/format";

export type PendingLeadAction = "log-call" | "nurture" | "assign" | "close" | null;

/** The dispositions the backend's state machine accepts for a close. */
const CLOSE_REASONS = [
  "not_interested",
  "spam",
  "outside_region",
  "wrong_service",
  "no_budget",
  "no_response",
  "lost_to_competitor",
] as const;

export type AssignRole = "sales" | "actioner";

const nurtureDefault = () => new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

/** One dialog shell: title, consequence line, form body, cancel/submit row. */
function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  destructive = false,
  busy,
  canSubmit,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  destructive?: boolean;
  busy: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit && !busy) onSubmit();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* A form, so Enter submits from any field — what the prompt() gave for free. */}
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">{children}</div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={!canSubmit || busy}>
              {busy ? "Working…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LogCallDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setBody("");
      setBusy(false);
    }
  }, [open]);

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Log a call"
      description="Added to the lead's activity, attributed to you."
      submitLabel="Log call"
      busy={busy}
      canSubmit={body.trim().length > 0}
      onSubmit={async () => {
        setBusy(true);
        if (!(await onSubmit(body.trim()))) setBusy(false);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="log-call-body">What happened on the call?</Label>
        <Textarea
          id="log-call-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          autoFocus
        />
      </div>
    </ActionDialog>
  );
}

function NurtureDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (until: string) => Promise<boolean>;
}) {
  const [until, setUntil] = useState(nurtureDefault);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setUntil(nurtureDefault());
      setBusy(false);
    }
  }, [open]);

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nurture this lead"
      description="It leaves the active queue and returns on the date you pick."
      submitLabel="Park lead"
      busy={busy}
      canSubmit={/^\d{4}-\d{2}-\d{2}$/.test(until)}
      onSubmit={async () => {
        setBusy(true);
        if (!(await onSubmit(until))) setBusy(false);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="nurture-until">Bring it back on</Label>
        <DateField id="nurture-until" value={until} onChange={setUntil} autoFocus />
      </div>
    </ActionDialog>
  );
}

function AssignDialog({
  open,
  onOpenChange,
  defaultAssignee,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultAssignee: string;
  onSubmit: (who: string, role: AssignRole) => Promise<boolean>;
}) {
  const [who, setWho] = useState(defaultAssignee);
  const [role, setRole] = useState<AssignRole>("sales");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setWho(defaultAssignee);
      setRole("sales");
      setBusy(false);
    }
  }, [open, defaultAssignee]);

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Assign this lead"
      description="Hand it to sales, or change who is actioning it."
      submitLabel="Assign"
      busy={busy}
      canSubmit={who.trim().includes("@")}
      onSubmit={async () => {
        setBusy(true);
        if (!(await onSubmit(who.trim(), role))) setBusy(false);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="assign-email">Assign to</Label>
        <Input
          id="assign-email"
          type="email"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          placeholder="name@company.com"
          autoFocus
        />
      </div>
      <RadioGroup value={role} onValueChange={(v) => setRole(v as AssignRole)} className="gap-3">
        <div className="flex items-start gap-2">
          <RadioGroupItem value="sales" id="assign-sales" className="mt-0.5" />
          <div className="grid gap-0.5">
            <Label htmlFor="assign-sales">Hand to sales owner</Label>
            <span className="text-muted-foreground text-xs">They own the deal from here.</span>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <RadioGroupItem value="actioner" id="assign-actioner" className="mt-0.5" />
          <div className="grid gap-0.5">
            <Label htmlFor="assign-actioner">Reassign the actioner</Label>
            <span className="text-muted-foreground text-xs">
              Someone else works it; ownership does not change.
            </span>
          </div>
        </div>
      </RadioGroup>
    </ActionDialog>
  );
}

function CloseDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState<string>(CLOSE_REASONS[0]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReason(CLOSE_REASONS[0]);
      setBusy(false);
    }
  }, [open]);

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Close this lead"
      description="It leaves every queue and stops counting against response clocks. The reason is recorded on the record."
      submitLabel="Close lead"
      destructive
      busy={busy}
      canSubmit={Boolean(reason)}
      onSubmit={async () => {
        setBusy(true);
        if (!(await onSubmit(reason))) setBusy(false);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="close-reason">Why is this closing?</Label>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger id="close-reason" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLOSE_REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {humanise(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </ActionDialog>
  );
}

/** All four, mounted once on lead detail; `pending` picks which one is open. */
export function LeadActionDialogs({
  pending,
  onOpenChange,
  defaultAssignee,
  onLogCall,
  onNurture,
  onAssign,
  onCloseLead,
}: {
  pending: PendingLeadAction;
  /** Called with false when the open dialog is dismissed. */
  onOpenChange: (open: boolean) => void;
  defaultAssignee: string;
  onLogCall: (body: string) => Promise<boolean>;
  onNurture: (until: string) => Promise<boolean>;
  onAssign: (who: string, role: AssignRole) => Promise<boolean>;
  onCloseLead: (reason: string) => Promise<boolean>;
}) {
  return (
    <>
      <LogCallDialog open={pending === "log-call"} onOpenChange={onOpenChange} onSubmit={onLogCall} />
      <NurtureDialog open={pending === "nurture"} onOpenChange={onOpenChange} onSubmit={onNurture} />
      <AssignDialog
        open={pending === "assign"}
        onOpenChange={onOpenChange}
        defaultAssignee={defaultAssignee}
        onSubmit={onAssign}
      />
      <CloseDialog open={pending === "close"} onOpenChange={onOpenChange} onSubmit={onCloseLead} />
    </>
  );
}
