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
import { autoFocusField } from "@/lib/utils";
import { useUserDirectory } from "../../../app/users";
import { UserPicker } from "../../../ui/UserPicker";

export type PendingLeadAction =
  | "log-call"
  | "nurture"
  | "assign"
  | "close"
  | "convert-override"
  | null;

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
      title="Add call notes"
      description="What happened on the call, saved to the lead's activity and attributed to you. The first call noted marks the lead contacted."
      submitLabel="Save notes"
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
          autoFocus={autoFocusField()}
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
        <DateField
          id="nurture-until"
          value={until}
          onChange={setUntil}
          autoFocus={autoFocusField()}
        />
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
  // D-19's rule applied here too: assignment picks a person from the
  // directory, it never types an address. The default (usually the signed-in
  // user) is preselected when it exists in the directory.
  const { users, loading, error: usersError } = useUserDirectory();

  useEffect(() => {
    if (open) {
      setWho(defaultAssignee);
      setRole("sales");
      setBusy(false);
    }
  }, [open, defaultAssignee]);

  const active = users.filter((u) => u.status === "active");

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Assign this lead"
      description="Hand it to sales, or change who is actioning it."
      submitLabel="Assign"
      busy={busy}
      canSubmit={active.some((u) => u.email === who)}
      onSubmit={async () => {
        setBusy(true);
        if (!(await onSubmit(who.trim(), role))) setBusy(false);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="assign-user">Assign to</Label>
        <UserPicker
          id="assign-user"
          users={active.map((u) => ({
            email: u.email,
            name: u.name,
            roleName: u.roleName,
            team: u.team,
            region: u.region,
          }))}
          value={who || null}
          onChange={setWho}
          loading={loading}
        />
        {usersError ? (
          <span className="text-destructive text-xs">
            {`The user list could not be read: ${usersError}`}
          </span>
        ) : null}
        {!loading && !active.length && !usersError ? (
          <span className="text-muted-foreground text-xs">
            No active users yet — add the team under Settings → Users first.
          </span>
        ) : null}
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
/**
 * F-06: the assessment said not_relevant and someone wants to convert anyway.
 * That is allowed — the AI advises, people decide — but it is a decision, so
 * the dialog states what the assessment said and the submit is the override,
 * which the server stamps onto the audit trail.
 */
function ConvertOverrideDialog({
  open,
  onOpenChange,
  score,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  score: number | null;
  onSubmit: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setBusy(false);
  }, [open]);

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Convert against the assessment?"
      description={`The AI assessed this lead as not relevant${
        score != null ? ` and scored it ${score}/100` : ""
      }. Converting anyway is allowed — the assessment advises, you decide — and the override is recorded on the lead's trail.`}
      submitLabel="Convert anyway"
      destructive
      busy={busy}
      canSubmit
      onSubmit={async () => {
        setBusy(true);
        if (!(await onSubmit())) setBusy(false);
      }}
    >
      <p className="text-muted-foreground text-sm">
        If the assessment looks wrong, re-assessing with a better description is usually the
        stronger move — the score follows the lead everywhere.
      </p>
    </ActionDialog>
  );
}

export function LeadActionDialogs({
  pending,
  onOpenChange,
  defaultAssignee,
  score,
  onLogCall,
  onNurture,
  onAssign,
  onCloseLead,
  onConvertOverride,
}: {
  pending: PendingLeadAction;
  /** Called with false when the open dialog is dismissed. */
  onOpenChange: (open: boolean) => void;
  defaultAssignee: string;
  /** The assessment score, for the override dialog's honesty line (F-06). */
  score?: number | null;
  onLogCall: (body: string) => Promise<boolean>;
  onNurture: (until: string) => Promise<boolean>;
  onAssign: (who: string, role: AssignRole) => Promise<boolean>;
  onCloseLead: (reason: string) => Promise<boolean>;
  onConvertOverride: () => Promise<boolean>;
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
      <ConvertOverrideDialog
        open={pending === "convert-override"}
        onOpenChange={onOpenChange}
        score={score ?? null}
        onSubmit={onConvertOverride}
      />
    </>
  );
}
