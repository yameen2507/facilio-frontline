/**
 * The account write dialogs — F-18 (create by hand), F-19 (edit) and D-37
 * (contacts). One form component serves create and edit: same fields, same
 * validation, different verb — two copies would drift on the first new field.
 *
 * F-19's honest line: edits are LOCAL. The facilio-cmms connection has
 * create-client but no update action, so an account already in Facilio keeps
 * its Facilio record unchanged — the edit dialog SAYS that when it applies,
 * instead of letting the two quietly diverge.
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
import { autoFocusField } from "@/lib/utils";
import {
  createAccount,
  saveContact,
  updateAccount,
  type AccountFields,
} from "../api/accounts-util";
import type { Account, Contact } from "../types/account";

const BLANK: Required<AccountFields> = {
  name: "",
  email: "",
  phone: "",
  websiteDomain: "",
  street: "",
  city: "",
  state: "",
};

export function AccountFormDialog({
  open,
  onOpenChange,
  account,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null = create (F-18); a record = edit it (F-19). */
  account: Account | null;
  actor: string;
  onDone: (accountId: string) => void;
}) {
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(
      account
        ? {
            name: account.name ?? "",
            email: account.email ?? "",
            phone: account.phone ?? "",
            websiteDomain: account.websiteDomain ?? "",
            street: account.address?.street ?? "",
            city: account.address?.city ?? "",
            state: account.address?.state ?? "",
          }
        : BLANK
    );
    setError(null);
    setBusy(false);
  }, [open, account]);

  const set = (key: keyof typeof BLANK) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const name = form.name.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || busy) return;
    setBusy(true);
    setError(null);

    const fields = {
      name,
      email: form.email.trim(),
      phone: form.phone.trim(),
      websiteDomain: form.websiteDomain.trim(),
      street: form.street.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
    };

    const { data, error: err } = account
      ? await updateAccount(account.id, fields, actor)
      : await createAccount(fields, actor);

    setBusy(false);
    if (err || !data) {
      setError(err ?? "The account was not saved");
      return;
    }
    onOpenChange(false);
    onDone(data.account.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{account ? "Edit account" : "New account"}</DialogTitle>
            <DialogDescription>
              {account
                ? "The company record as the team sees it."
                : "A company worth pursuing — it does not have to enquire first. Its Facilio client is created when a deal is won, not now."}
            </DialogDescription>
          </DialogHeader>

          <div className="overlay-scroll -mx-1 flex max-h-[55vh] min-w-0 flex-col gap-4 overflow-y-auto px-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="af-name">
                Company <span className="text-destructive">*</span>
              </Label>
              <Input
                id="af-name"
                value={form.name}
                onChange={(e) => set("name")(e.target.value)}
                placeholder="Al Manzil Restaurant"
                autoFocus={!account && autoFocusField()}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="af-email">Email</Label>
                <Input
                  id="af-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email")(e.target.value)}
                  placeholder="info@almanzil.ae"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="af-phone">Phone</Label>
                <Input
                  id="af-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone")(e.target.value)}
                  placeholder="+971 4 123 4567"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="af-domain">Website</Label>
                <Input
                  id="af-domain"
                  value={form.websiteDomain}
                  onChange={(e) => set("websiteDomain")(e.target.value)}
                  placeholder="almanzil.ae"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="af-street">Address</Label>
                <Input
                  id="af-street"
                  value={form.street}
                  onChange={(e) => set("street")(e.target.value)}
                  placeholder="Al Rigga Road, Deira"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="af-city">City</Label>
                <Input
                  id="af-city"
                  value={form.city}
                  onChange={(e) => set("city")(e.target.value)}
                  placeholder="Dubai"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="af-state">Region</Label>
                <Input
                  id="af-state"
                  value={form.state}
                  onChange={(e) => set("state")(e.target.value)}
                  placeholder="Dubai"
                />
              </div>
            </div>

            {account?.facilioClientId ? (
              <p className="text-muted-foreground bg-muted/50 rounded-md px-3 py-2 text-xs">
                This company is already a client in Facilio. Changes here stay in Frontline —
                there is no update push on the connection yet, so the Facilio record keeps what
                it has.
              </p>
            ) : null}

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!name || busy}>
              {busy ? "Saving…" : account ? "Save changes" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ContactDialog({
  open,
  onOpenChange,
  accountId,
  contact,
  hasPrimary,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  /** Null = add (D-37); a record = edit it. */
  contact: Contact | null;
  /** Whether some contact already holds primary — the first one defaults on. */
  hasPrimary: boolean;
  actor: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [primary, setPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(contact?.name ?? "");
    setEmail(contact?.email ?? "");
    setPhone(contact?.phone ?? "");
    setPrimary(contact ? contact.isPrimary === "true" : !hasPrimary);
    setError(null);
    setBusy(false);
  }, [open, contact, hasPrimary]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);

    const { error: err } = await saveContact(
      accountId,
      {
        ...(contact?.id ? { contactId: contact.id } : {}),
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        isPrimary: primary,
      },
      actor
    );

    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{contact ? "Edit contact" : "Add a contact"}</DialogTitle>
            <DialogDescription>
              An FM account is never one person — the person who signs is rarely the person who
              opens the door. New contacts with an email are pushed to Facilio once the client
              record exists.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ct-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ahmed Khalil"
                autoFocus={autoFocusField()}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="ct-email">Email</Label>
                <Input
                  id="ct-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ahmed@almanzil.ae"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="ct-phone">Phone</Label>
                <Input
                  id="ct-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+971 50 123 4567"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={primary}
                onChange={(e) => setPrimary(e.target.checked)}
                className="size-4"
              />
              Primary contact
              <span className="text-muted-foreground text-xs">— one per account</span>
            </label>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy ? "Saving…" : contact ? "Save changes" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
