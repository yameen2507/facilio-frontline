/**
 * Raising a lead by hand.
 *
 * Until this existed the queue had one door: the website chat's intake agent.
 * Anything that arrived by phone, by email, or as a tender notice someone spotted
 * had to be typed in through the CLI, so in practice it was not recorded at all.
 *
 * `create` is the only writer of `fl_lead` — it allocates the ref number, stamps
 * the three SLA clocks and runs the duplicate check — so this dialog adds no
 * capture logic of its own. It collects fields and reports what came back.
 *
 * TWO VIEWS, because `create` has two outcomes. A clean capture closes the dialog
 * and opens the lead. A DUPLICATE does not: the row is created `closed` and linked
 * to the original, so it never reaches the inbox, and a dialog that just closed
 * would read as "captured" when nothing actionable happened. That case swaps the
 * body for a panel that names the original and how it matched.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useActor } from "../../../app/auth";
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
import { Textarea } from "@/components/ui/textarea";
import { humanise } from "@/lib/format";
import { createLead, type NewLeadFields } from "../api/leads-util";
import type { CreatedLead, LeadSource } from "../types/lead";

/**
 * `widget` is missing on purpose. It means the public web chat, and a lead
 * labelled that way is expected to carry an intake session token — the lead page
 * offers a transcript for it. A hand-typed lead has no transcript, so claiming
 * the channel would make the provenance a lie for the sake of one dropdown line.
 */
const SOURCES: { id: LeadSource; label: string; hint: string }[] = [
  { id: "inapp", label: "Raised internally", hint: "Phone, email, a defect, or a re-clean falling due" },
  { id: "tender", label: "Tender notice", hint: "An RFQ or tender someone picked up" },
];

/** The currencies the region actually quotes in. Free text would fragment the column. */
const CURRENCIES = ["AED", "SAR", "OMR", "QAR", "KWD", "BHD", "USD", "GBP"];

const BLANK = {
  source: "inapp" as LeadSource,
  sourceDetail: "",
  companyName: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  websiteDomain: "",
  serviceType: "",
  description: "",
  siteAddress: "",
  siteCity: "",
  siteRegion: "",
  estimatedValue: "",
  currency: "AED",
};

/** How the duplicate was spotted, said the way a person would say it. */
const MATCHED_ON: Record<string, string> = {
  email: "the same contact email",
  phone: "the same phone number",
  domain: "the same company domain",
};

export function NewLeadDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lets the inbox pick the new lead up without a second round trip on mount. */
  onCreated?: () => void;
}) {
  const navigate = useNavigate();
  const actor = useActor();

  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  /** The server's message, VERBATIM. */
  const [error, setError] = useState<string | null>(null);
  /** Set only when the capture landed as a duplicate — see the header. */
  const [duplicate, setDuplicate] = useState<CreatedLead | null>(null);

  // Fields reset on OPEN, so a half-typed enquiry never resurfaces a week later
  // attached to a different phone call.
  useEffect(() => {
    if (!open) return;
    setForm(BLANK);
    setError(null);
    setDuplicate(null);
    setBusy(false);
  }, [open]);

  const set = (key: keyof typeof BLANK) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const company = form.companyName.trim();
  // A value that is not a number would be rejected server-side, so it is caught
  // here where the field it belongs to is still on screen.
  const value = form.estimatedValue.trim();
  const valueInvalid = value !== "" && !Number.isFinite(Number(value));
  const canSubmit = Boolean(company) && !valueInvalid;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);

    const fields: NewLeadFields = {
      source: form.source,
      companyName: company,
      sourceDetail: form.sourceDetail.trim(),
      contactName: form.contactName.trim(),
      contactEmail: form.contactEmail.trim(),
      contactPhone: form.contactPhone.trim(),
      websiteDomain: form.websiteDomain.trim(),
      serviceType: form.serviceType.trim(),
      description: form.description.trim(),
      siteAddress: form.siteAddress.trim(),
      siteCity: form.siteCity.trim(),
      siteRegion: form.siteRegion.trim(),
      // Only send a currency alongside a value — a currency on an empty amount
      // says nothing and still writes a column.
      ...(value ? { estimatedValue: Number(value), currency: form.currency } : {}),
    };

    const { data, error: err } = await createLead(fields, actor);
    setBusy(false);

    if (err || !data) {
      setError(err ?? "The lead was not created");
      return;
    }

    if (data.duplicateOf) {
      // The row exists but is closed, so the Closed tab should pick it up while
      // this dialog holds its ground on the outcome.
      onCreated?.();
      setDuplicate(data);
      return;
    }
    // No refresh on the clean path: the inbox unmounts on the navigate below and
    // refetches on the way back, so asking now buys a list nobody renders.
    onOpenChange(false);
    navigate(`/leads/${data.leadId}`);
  };

  // Read out of the pair once, so the outcome view's handlers close over a value
  // TypeScript has already narrowed rather than re-asserting it at each click.
  const original = duplicate?.duplicateOf ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {duplicate && original ? (
          <div className="flex min-w-0 flex-col gap-5">
            <DialogHeader>
              <DialogTitle>Already on file</DialogTitle>
              <DialogDescription>
                {`${duplicate.refNo} matched ${original.refNo} on ${
                  MATCHED_ON[original.matchedOn] ?? original.matchedOn
                }.`}
              </DialogDescription>
            </DialogHeader>

            {/* Said plainly, because the queue will not show it. The row exists —
                source counts stay honest — but it is closed and linked. */}
            <p className="text-muted-foreground bg-muted/50 rounded-md px-3 py-2 text-xs">
              {`It was recorded and closed as a duplicate, so it will not appear in the inbox. The enquiry belongs to ${
                original.companyName ?? original.refNo
              }, which is ${humanise(original.status)} — work it there.`}
            </p>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/leads/${duplicate.leadId}`);
                }}
              >
                Open the duplicate
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/leads/${original.id}`);
                }}
              >
                {`Open ${original.refNo}`}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
            <DialogHeader>
              <DialogTitle>New lead</DialogTitle>
              <DialogDescription>
                For an enquiry that arrived off-channel. The response clocks start the moment this
                is saved, and a repeat of a lead already on file is closed and linked instead.
              </DialogDescription>
            </DialogHeader>

            <div className="overlay-scroll -mx-1 flex max-h-[55vh] min-w-0 flex-col gap-4 overflow-y-auto px-1">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nl-company">
                  Company <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="nl-company"
                  value={form.companyName}
                  onChange={(e) => set("companyName")(e.target.value)}
                  placeholder="Al Manzil Restaurant"
                  autoFocus
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="nl-source">How it came in</Label>
                  <Select
                    value={form.source}
                    onValueChange={(v) => set("source")(v as LeadSource)}
                  >
                    <SelectTrigger id="nl-source" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCES.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground text-xs">
                    {SOURCES.find((s) => s.id === form.source)?.hint}
                  </span>
                </div>

                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="nl-source-detail">Detail</Label>
                  <Input
                    id="nl-source-detail"
                    value={form.sourceDetail}
                    onChange={(e) => set("sourceDetail")(e.target.value)}
                    placeholder={form.source === "tender" ? "ADGPG" : "Inbound call"}
                  />
                </div>
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="nl-contact">Contact</Label>
                  <Input
                    id="nl-contact"
                    value={form.contactName}
                    onChange={(e) => set("contactName")(e.target.value)}
                    placeholder="Ahmed Khalil"
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="nl-phone">Phone</Label>
                  <Input
                    id="nl-phone"
                    type="tel"
                    value={form.contactPhone}
                    onChange={(e) => set("contactPhone")(e.target.value)}
                    placeholder="+971 50 123 4567"
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="nl-email">Email</Label>
                  <Input
                    id="nl-email"
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => set("contactEmail")(e.target.value)}
                    placeholder="ahmed@almanzil.ae"
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="nl-website">Website</Label>
                  <Input
                    id="nl-website"
                    value={form.websiteDomain}
                    onChange={(e) => set("websiteDomain")(e.target.value)}
                    placeholder="almanzil.ae"
                  />
                </div>
              </div>

              {/* The three dedup keys, and the only place the user can influence
                  the check — worth saying while the fields are in front of them. */}
              <span className="text-muted-foreground text-xs">
                Email, phone and website are what a repeat enquiry is matched on. Filling them in
                is what stops the same company entering the queue twice.
              </span>

              <Separator />

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nl-service">Service wanted</Label>
                <Input
                  id="nl-service"
                  value={form.serviceType}
                  onChange={(e) => set("serviceType")(e.target.value)}
                  placeholder="Kitchen hood cleaning"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nl-description">What they asked for</Label>
                <Textarea
                  id="nl-description"
                  value={form.description}
                  onChange={(e) => set("description")(e.target.value)}
                  rows={3}
                  placeholder="Four extraction hoods, 14 months uncleaned. Insurance wants TR19 before month end."
                />
                <span className="text-muted-foreground text-xs">
                  The assessment reads this. A lead with no description scores on the company and
                  service alone.
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="nl-address">Site address</Label>
                  <Input
                    id="nl-address"
                    value={form.siteAddress}
                    onChange={(e) => set("siteAddress")(e.target.value)}
                    placeholder="Al Rigga Road, Deira"
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="nl-city">City</Label>
                  <Input
                    id="nl-city"
                    value={form.siteCity}
                    onChange={(e) => set("siteCity")(e.target.value)}
                    placeholder="Dubai"
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="nl-region">Region</Label>
                  <Input
                    id="nl-region"
                    value={form.siteRegion}
                    onChange={(e) => set("siteRegion")(e.target.value)}
                    placeholder="Dubai"
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="nl-value">Rough value</Label>
                  <div className="flex gap-2">
                    <Select value={form.currency} onValueChange={set("currency")}>
                      <SelectTrigger id="nl-currency" className="w-24" aria-label="Currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      id="nl-value"
                      inputMode="decimal"
                      value={form.estimatedValue}
                      onChange={(e) => set("estimatedValue")(e.target.value)}
                      placeholder="12000"
                      className="min-w-0 flex-1"
                    />
                  </div>
                  {valueInvalid ? (
                    <span className="text-destructive text-xs">
                      The value has to be a number — leave it blank if it is not known yet.
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {error ? <p className="text-destructive text-sm">{error}</p> : null}

            <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              {/* A disabled primary action says why, next to itself. */}
              {!company ? (
                <span className="text-muted-foreground mr-auto text-xs">
                  A company name is the one thing a lead cannot be filed without.
                </span>
              ) : null}
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!canSubmit || busy}>
                {busy ? "Saving…" : "Create lead"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
