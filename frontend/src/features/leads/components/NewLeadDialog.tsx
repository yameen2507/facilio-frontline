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
import { autoFocusField, cn } from "@/lib/utils";
import { humanise } from "@/lib/format";
import {
  createLead,
  getCoverageOptions,
  type CoverageOptions,
  type NewLeadFields,
} from "../api/leads-util";
import { Combobox } from "../../../ui/Combobox";
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
  // D-05: what kind of number the value is. One toggle, per the ruling — the
  // single amount box stays, the distinction it was destroying does not.
  valueType: "one_off",
  valueFrequency: "monthly",
  // D-10: where it came from. "" = not said — never guessed.
  origin: "",
};

/** D-10's second axis, with the labels a BDR would use. */
const ORIGINS = [
  { id: "referral", label: "Referral" },
  { id: "existing_client", label: "Existing client" },
  { id: "marketing", label: "Marketing / campaign" },
  { id: "hubspot", label: "HubSpot" },
  { id: "cold_outreach", label: "Cold outreach" },
  { id: "other", label: "Other" },
] as const;

/** The explicit escape hatch on the city picker (D-04) — it names itself so an
    out-of-coverage enquiry is a recorded fact, not a mis-picked city. */
const OUTSIDE_AREAS = "__outside__";

/** The D-05 toggle, in the order the ruling names them. */
const VALUE_TYPES = [
  { id: "one_off", label: "One-off" },
  { id: "recurring", label: "Recurring" },
  { id: "both", label: "Both" },
] as const;

const VALUE_FREQUENCIES = [
  { id: "monthly", label: "per month" },
  { id: "quarterly", label: "per quarter" },
  { id: "annual", label: "per year" },
] as const;

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

  /**
   * D-04: the coverage catalogue feeding the city and service pickers — the
   * same matrix Settings edits and the AI scores against. Loaded per open;
   * when the read fails the pickers fall back to the free-text inputs rather
   * than blocking intake on a config lookup.
   */
  const [catalogue, setCatalogue] = useState<CoverageOptions | null>(null);
  const [areaId, setAreaId] = useState<string>("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [serviceOther, setServiceOther] = useState("");

  // Fields reset on OPEN, so a half-typed enquiry never resurfaces a week later
  // attached to a different phone call.
  useEffect(() => {
    if (!open) return;
    setForm(BLANK);
    setError(null);
    setDuplicate(null);
    setBusy(false);
    setAreaId("");
    setServiceIds([]);
    setServiceOther("");
    getCoverageOptions().then(({ data }) => setCatalogue(data));
  }, [open]);

  const set = (key: keyof typeof BLANK) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const areas = (catalogue?.areas ?? []).filter((a) => a.active === "true");
  const area = areas.find((a) => a.id === areaId) ?? null;
  const outside = areaId === OUTSIDE_AREAS;
  // Service lines scoped by the chosen city (D-04); everything active when no
  // city is chosen yet or the enquiry is outside coverage.
  const coveredIds = area
    ? new Set(
        (catalogue?.coverage ?? [])
          .filter((c) => c.active === "true" && c.areaId === area.id)
          .map((c) => c.serviceLineId)
      )
    : null;
  const serviceLines = (catalogue?.serviceLines ?? []).filter(
    (l) => l.active === "true" && (!coveredIds || coveredIds.has(l.id))
  );

  const toggleService = (id: string) =>
    setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

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

    // What the columns receive: picked services by NAME plus the free-text
    // remainder — controlled vocabulary first, catch-all last (D-04).
    const pickedNames = serviceLines
      .filter((l) => serviceIds.includes(l.id))
      .map((l) => l.name);
    const serviceType = [...pickedNames, serviceOther.trim()].filter(Boolean).join(", ");

    const fields: NewLeadFields = {
      source: form.source,
      companyName: company,
      sourceDetail: form.sourceDetail.trim(),
      contactName: form.contactName.trim(),
      contactEmail: form.contactEmail.trim(),
      contactPhone: form.contactPhone.trim(),
      websiteDomain: form.websiteDomain.trim(),
      serviceType: serviceType || form.serviceType.trim(),
      description: form.description.trim(),
      siteAddress: form.siteAddress.trim(),
      // A picked area writes its own name and region; "outside our areas" and
      // a failed catalogue read fall back to what was typed.
      siteCity: area ? area.name : form.siteCity.trim(),
      siteRegion: area ? (area.region ?? area.name) : form.siteRegion.trim(),
      ...(form.origin ? { origin: form.origin } : {}),
      // Only send a currency alongside a value — a currency on an empty amount
      // says nothing and still writes a column. The D-05 pair travels the same
      // way: a type on no amount types nothing.
      ...(value
        ? {
            estimatedValue: Number(value),
            currency: form.currency,
            valueType: form.valueType,
            ...(form.valueType !== "one_off" ? { valueFrequency: form.valueFrequency } : {}),
          }
        : {}),
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
                  autoFocus={autoFocusField()}
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

                <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                  {/* D-10's second axis: HOW it arrived is above; this is WHERE
                      it came from. Two fields, so "how many wins came from
                      referrals" finally has an answer. */}
                  <Label htmlFor="nl-origin">Where it came from</Label>
                  <Select value={form.origin || undefined} onValueChange={set("origin")}>
                    <SelectTrigger id="nl-origin" className="w-full">
                      <SelectValue placeholder="Not said" />
                    </SelectTrigger>
                    <SelectContent>
                      {ORIGINS.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                <Label>Service wanted</Label>
                {/* D-04: the catalogue, not a text box — the one input the
                    whole scoring engine depends on stops being unconstrained.
                    Multi-select (an enquiry often wants two services), scoped
                    by the chosen city, free text as catch-all — never as the
                    primary path. When the catalogue cannot be read, the free
                    text IS the field, honestly labelled. */}
                {serviceLines.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {serviceLines.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        aria-pressed={serviceIds.includes(l.id)}
                        onClick={() => toggleService(l.id)}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-xs transition-colors",
                          serviceIds.includes(l.id)
                            ? "border-primary bg-muted font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                <Input
                  id="nl-service"
                  value={serviceLines.length ? serviceOther : form.serviceType}
                  onChange={(e) =>
                    serviceLines.length
                      ? setServiceOther(e.target.value)
                      : set("serviceType")(e.target.value)
                  }
                  placeholder={
                    serviceLines.length ? "Anything else they asked for" : "Kitchen hood cleaning"
                  }
                />
                {area && serviceLines.length === 0 && catalogue?.serviceLines.length ? (
                  <span className="text-muted-foreground text-xs">
                    {`Nothing in the catalogue covers ${area.name} — describe the service above and it will be scored as out of coverage.`}
                  </span>
                ) : null}
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
                  {/* D-04: a picker from the coverage list, with "outside our
                      areas" as an explicit, recorded answer. Free text only
                      when the catalogue itself is empty or unreadable. */}
                  {areas.length ? (
                    <Combobox
                      id="nl-city"
                      options={[
                        ...areas.map((a) => ({
                          id: a.id,
                          label: a.name,
                          meta: a.region && a.region !== a.name ? a.region : null,
                        })),
                        { id: OUTSIDE_AREAS, label: "Outside our areas…" },
                      ]}
                      value={areaId || null}
                      onChange={(id) => {
                        setAreaId(id);
                        // A change of city re-scopes the service chips; picks
                        // that no longer apply are dropped, not smuggled.
                        setServiceIds([]);
                      }}
                      placeholder="Pick the city"
                      searchPlaceholder="Search cities…"
                    />
                  ) : (
                    <Input
                      id="nl-city"
                      value={form.siteCity}
                      onChange={(e) => set("siteCity")(e.target.value)}
                      placeholder="Dubai"
                    />
                  )}
                </div>
                {outside || !areas.length ? (
                  <>
                    {outside ? (
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <Label htmlFor="nl-city-free">Which city</Label>
                        <Input
                          id="nl-city-free"
                          value={form.siteCity}
                          onChange={(e) => set("siteCity")(e.target.value)}
                          placeholder="Muscat"
                        />
                      </div>
                    ) : null}
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <Label htmlFor="nl-region">Region</Label>
                      <Input
                        id="nl-region"
                        value={form.siteRegion}
                        onChange={(e) => set("siteRegion")(e.target.value)}
                        placeholder="Dubai"
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label>Region</Label>
                    {/* Follows the picked city — one fact, entered once. */}
                    <Input value={area ? (area.region ?? area.name) : ""} disabled placeholder="From the city" />
                  </div>
                )}
                <div className="flex min-w-0 flex-col gap-1.5">
                  {/* D-05, as ruled: renamed, one amount box, one toggle. A
                      12,000 one-off and 12,000/month are different commercial
                      objects — this is where the difference is captured. */}
                  <Label htmlFor="nl-value">Estimated value</Label>
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
                  {value && !valueInvalid ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex gap-1" role="radiogroup" aria-label="Value type">
                        {VALUE_TYPES.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            role="radio"
                            aria-checked={form.valueType === t.id}
                            onClick={() => set("valueType")(t.id)}
                            className={cn(
                              "rounded-md border px-2.5 py-1 text-xs transition-colors",
                              form.valueType === t.id
                                ? "border-primary bg-muted font-medium"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                      {form.valueType !== "one_off" ? (
                        <Select value={form.valueFrequency} onValueChange={set("valueFrequency")}>
                          <SelectTrigger
                            className="h-7 w-32 text-xs"
                            aria-label="Recurring frequency"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {VALUE_FREQUENCIES.map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                    </div>
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
