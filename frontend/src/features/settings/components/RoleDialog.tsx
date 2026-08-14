/**
 * Create/edit a role — name, description and whether it is active (spec §10:
 * roles are created, edited, activated and deactivated; never hard-deleted,
 * because users may still point at one).
 *
 * A system role (System Admin) keeps its name and stays active: the controls
 * disable with the reason beside them, and the server rejects it regardless.
 * What a role PERMITS is not edited here — that is the Permissions tab, where
 * roles sit side by side and can be compared.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useActor } from "../../../app/auth";
import type { AccessRole } from "../../../app/access";
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
import { Textarea } from "@/components/ui/textarea";
import { saveRole } from "../api/access-util";
import { ExplainedButton } from "./ExplainedButton";

export function RoleDialog({
  open,
  onOpenChange,
  role,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The record being edited; null creates. */
  role: AccessRole | null;
  onSaved: () => void;
}) {
  const actor = useActor();

  // The record survives the exit animation: the parent clears its state the
  // moment the dialog closes, and rendering from the prop would flip a system
  // role's disabled controls back on mid-fade. Synced during render (React's
  // adjust-state-on-prop-change pattern), and only while open.
  const [record, setRecord] = useState<AccessRole | null>(role);
  if (open && record !== role) setRecord(role);
  const isSystem = record?.isSystem === "true";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState("true");

  const [busy, setBusy] = useState(false);
  /** The server's message, VERBATIM. */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Fields reset on OPEN, so a half-typed value never resurfaces later.
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setActive(role?.active ?? "true");
    setError(null);
  }, [open, role]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);

    const { data, error: err } = await saveRole(
      {
        ...(role ? { id: role.id } : {}),
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        active,
      },
      actor
    );

    setBusy(false);
    if (err || !data) {
      setError(err ?? "The role was not saved");
      return;
    }
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{record ? "Edit role" : "New role"}</DialogTitle>
            <DialogDescription>
              {record
                ? "A role names a job; what it can do is set per action on the Permissions tab."
                : "Creates the role with no permissions — grant them on the Permissions tab after saving."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rd-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rd-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSystem}
                placeholder="e.g. Survey Manager"
              />
              {isSystem ? (
                <span className="text-muted-foreground text-xs">
                  {record?.name} is a system role — its name is fixed.
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rd-description">Description</Label>
              <Textarea
                id="rd-description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this role is for, in a line"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rd-active">Status</Label>
              <Select value={active} onValueChange={setActive} disabled={isSystem}>
                <SelectTrigger id="rd-active" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive — its users go read-only</SelectItem>
                </SelectContent>
              </Select>
              {isSystem ? (
                <span className="text-muted-foreground text-xs">
                  A system role cannot be deactivated — that is what keeps the admins from locking
                  themselves out.
                </span>
              ) : null}
            </div>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <ExplainedButton
              type="submit"
              disabled={!name.trim() || busy}
              title={!name.trim() ? "Give the role a name" : undefined}
            >
              {busy ? "Saving…" : record ? "Save role" : "Create role"}
            </ExplainedButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
