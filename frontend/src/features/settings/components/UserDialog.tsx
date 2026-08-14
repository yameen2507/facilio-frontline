/**
 * Create/edit a user — one dialog for both, told apart by whether `user` is
 * set. A user has exactly ONE role (spec §7): the role is a single required
 * Select, never a multi-pick.
 *
 * Roles load when the dialog OPENS, not when the Users page mounts — the list
 * should not pay a round trip for a dialog most visits never open. Manager
 * options come from the page's own already-fetched user list.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useActor } from "../../../app/auth";
import type { AccessRole, AccessUser } from "../../../app/access";
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
import { listRoles, saveUser } from "../api/access-util";
import { ExplainedButton } from "./ExplainedButton";

/** Radix Select cannot carry an empty-string value, so "no manager" is a token. */
const NO_MANAGER = "__none__";

export function UserDialog({
  open,
  onOpenChange,
  user,
  users,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The record being edited; null creates. */
  user: AccessUser | null;
  /** The page's fetched list — manager options without a second fetch. */
  users: AccessUser[];
  onSaved: () => void;
}) {
  const actor = useActor();

  // The record survives the exit animation: the parent clears its state the
  // moment the dialog closes, and rendering from the prop would flip an Edit
  // dialog's copy to "New user" mid-fade. Synced during render (React's
  // adjust-state-on-prop-change pattern), and only while open.
  const [record, setRecord] = useState<AccessUser | null>(user);
  if (open && record !== user) setRecord(user);

  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [team, setTeam] = useState("");
  const [region, setRegion] = useState("");
  const [department, setDepartment] = useState("");
  const [managerEmail, setManagerEmail] = useState(NO_MANAGER);
  const [status, setStatus] = useState("active");

  const [busy, setBusy] = useState(false);
  /** The server's message, VERBATIM. */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Fields reset on OPEN, so a half-typed value never resurfaces later.
    setName(user?.name ?? "");
    setEmail(user?.email ?? "");
    setRoleId(user?.roleId ?? "");
    setTeam(user?.team ?? "");
    setRegion(user?.region ?? "");
    setDepartment(user?.department ?? "");
    setManagerEmail(user?.managerEmail || NO_MANAGER);
    setStatus(user?.status ?? "active");
    setError(null);
    setLoading(true);

    let live = true;
    listRoles().then(({ data, error: err }) => {
      if (!live) return;
      setLoading(false);
      setError(err);
      // Only active roles are offered — an edit of a user whose role has since
      // been deactivated still shows it, so the form never silently reassigns.
      if (data) {
        setRoles(
          data.roles.filter((r) => r.active === "true" || r.id === user?.roleId)
        );
      }
    });
    return () => {
      live = false;
    };
  }, [open, user]);

  /** Managers are other users — a person cannot manage themselves. */
  const managerOptions = users.filter((u) => u.email !== email.trim());

  // A stored manager who is no longer a user (removed, renamed email) has no
  // matching item, and radix's Select would render the trigger BLANK while the
  // value silently persists. Synthesize an item so the stored value stays
  // visible and deliberately clearable.
  const orphanedManager =
    managerEmail !== NO_MANAGER && !managerOptions.some((u) => u.email === managerEmail)
      ? managerEmail
      : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !roleId || busy) return;
    setBusy(true);
    setError(null);

    const { data, error: err } = await saveUser(
      {
        ...(user ? { id: user.id } : {}),
        name: name.trim(),
        email: email.trim(),
        roleId,
        // Blanks are dropped, not sent as "" — the envelope treats "" as absent.
        ...(team.trim() ? { team: team.trim() } : {}),
        ...(region.trim() ? { region: region.trim() } : {}),
        ...(department.trim() ? { department: department.trim() } : {}),
        ...(managerEmail !== NO_MANAGER ? { managerEmail } : {}),
        status,
      },
      actor
    );

    setBusy(false);
    if (err || !data) {
      setError(err ?? "The user was not saved");
      return;
    }
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{record ? "Edit user" : "New user"}</DialogTitle>
            <DialogDescription>
              {record
                ? "Changes what this person can see and do the next time the app loads."
                : "Adds a teammate. What they can do comes from the one role you pick — configure that under Permissions."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ud-name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input id="ud-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ud-email">
                  Email <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ud-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Their Facilio account email"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ud-role">
                Role <span className="text-destructive">*</span>
              </Label>
              <Select value={roleId} onValueChange={setRoleId} disabled={loading}>
                <SelectTrigger id="ud-role" className="w-full">
                  <SelectValue placeholder={loading ? "Loading roles…" : "Pick the one role"} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                      {r.active !== "true" ? " (inactive)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ud-team">Team</Label>
                <Input id="ud-team" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="e.g. Dubai Sales" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ud-region">Region</Label>
                <Input id="ud-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Dubai" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ud-department">Department</Label>
                <Input
                  id="ud-department"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="e.g. Sales"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ud-manager">Manager</Label>
                <Select value={managerEmail} onValueChange={setManagerEmail}>
                  <SelectTrigger id="ud-manager" className="w-full">
                    <SelectValue placeholder="No manager" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_MANAGER}>No manager</SelectItem>
                    {orphanedManager ? (
                      <SelectItem value={orphanedManager}>
                        {orphanedManager} — no longer a user
                      </SelectItem>
                    ) : null}
                    {managerOptions.map((u) => (
                      <SelectItem key={u.id} value={u.email}>
                        {u.name} — {u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ud-status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="ud-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive — read-only everywhere</SelectItem>
                </SelectContent>
              </Select>
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
              disabled={!name.trim() || !email.trim() || !roleId || busy}
              title={
                !name.trim()
                  ? "Give them a name"
                  : !email.trim()
                    ? "Their email is how sign-in maps to this record"
                    : !roleId
                      ? "Every user needs exactly one role"
                      : undefined
              }
            >
              {busy ? "Saving…" : record ? "Save user" : "Create user"}
            </ExplainedButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
