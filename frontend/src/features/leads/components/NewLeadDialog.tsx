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
  listAccountOptions,
  type CoverageOptions,
  type LeadAccount,
  type NewLeadFields,
} from "../api/leads-util";
import { Combobox } from "../../../ui/Combobox";
import { newLeadBlockers, type NewLeadField } from "../actions";
import type { CreatedLead, LeadSource } from "../types/lead";

/**
 * ONE source field. It used to be three — "How it came in", a free-text
 * "Detail", and "Where it came from" — which asked whoever was capturing a phone
 * call to split a single fact across two axes and a text box.
 *
 * The two axes still exist in the DATA, because the reporting is built on them:
 * `source` is the channel a lead ARRIVED through (a closed enum the intake
 * agent, the conversion to a deal and the inbox filter all read), `origin` is
 * where the enquiry CAME FROM. Each option below declares both, so the person
 * picks once and neither column loses a thing.
 *
 * `widget` is absent on purpose — "Website form" included. It means the public
 * web chat, and a lead labelled that way is expected to carry an intake session
 * token; the lead page offers a transcript for it. A hand-typed lead has no
 * transcript, so the channel stays `inapp` and the label is kept in
 * `sourceDetail` rather than claiming a provenance that is not there.
 */
/** Mirrors LEAD_ORIGINS server-side — spelt out so a typo below fails to compile
    rather than failing the create call. */
type LeadOriginId =
  | "referral"
  | "existing_client"
  | "marketing"
  | "hubspot"
  | "cold_outreach"
  | "other";

const SOURCE_OPTIONS: {
  id: string;
  label: string;
  source: LeadSource;
  /** null = this option says nothing about origin, so nothing is written. */
  origin: LeadOriginId | null;
  hint: string;
}[] = [
  { id: "phone_email", label: "Phone or email", source: "inapp", origin: null,
    hint: "An enquiry that reached someone directly" },
  { id: "tender", label: "Tender box", source: "tender", origin: null,
    hint: "An RFQ or tender notice someone picked up" },
  { id: "website", label: "Website form", source: "inapp", origin: null,
    hint: "Typed in from a form submission — there is no chat transcript behind it" },
  { id: "marketing", label: "Marketing campaign", source: "inapp", origin: "marketing",
    hint: "A campaign, an event, or an ad brought them in" },
  { id: "referral", label: "Referral", source: "inapp", origin: "referral",
    hint: "Someone outside the company pointed them at us" },
  { id: "existing_client", label: "Existing client", source: "inapp", origin: "existing_client",
    hint: "Repeat work, a defect, or a re-clean falling due" },
  { id: "hubspot", label: "HubSpot", source: "inapp", origin: "hubspot",
    hint: "Carried over from the CRM" },
  { id: "cold_outreach", label: "Cold outreach", source: "inapp", origin: "cold_outreach",
    hint: "We approached them first" },
  { id: "other", label: "Other", source: "inapp", origin: "other",
    hint: "None of the above — say the rest in the description" },
];

/** The currencies the region actually quotes in. Free text would fragment the column. */
const CURRENCIES = ["AED", "SAR", "OMR", "QAR", "KWD", "BHD", "USD", "GBP"];

const BLANK = {
  // The one pick that feeds both `source` and `origin` — see SOURCE_OPTIONS.
  sourceOption: "phone_email",
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
};

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

  /**
   * Whether this enquiry belongs to a client we already have.
   *
   * Stated here rather than inferred later: `convert` resolves the account from
   * the company domain or the contact email, so a repeat client writing from a
   * personal address — or a new site under a different contact — used to get a
   * SECOND account for a company already on file. A lead that names its account
   * skips the guess entirely.
   *
   * Loaded per open alongside the catalogue. A failed read leaves `null` and the
   * choice hides itself: a picker with nothing in it is worse than not offering
   * the option, and every lead can still be filed as new.
   */
  const [accounts, setAccounts] = useState<LeadAccount[] | null>(null);
  /** The mode is its OWN state, not `accountId !== ""`. Deriving it would force
      the toggle to auto-select an account to render as pressed, and whichever
      client happened to sort first would collect every mis-click. */
  const [existingClient, setExistingClient] = useState(false);
  const [accountId, setAccountId] = useState<string>("");

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
    setAccounts(null);
    setExistingClient(false);
    setAccountId("");
    getCoverageOptions().then(({ data }) => setCatalogue(data));
    listAccountOptions().then(({ data }) => setAccounts(data?.accounts ?? null));
  }, [open]);

  const set = (key: keyof typeof BLANK) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  /**
   * RETIRED means `active === "false"`, and nothing else. The flag is nullable —
   * rows seeded or imported before saveService/saveArea existed carry none — so
   * `=== "true"` hid a service that Settings, the rate-card picker and proposals
   * all show, and this form was the one place it went missing. That is the bug
   * reported as "the lead form doesn't show the services from settings", and the
   * counts not matching between the two screens.
   *
   * The other two reasons this list is shorter than the Services page are NOT
   * bugs: a retired service should not be sellable, and the chips are scoped to
   * what is covered in the chosen city (D-04).
   */
  const areas = (catalogue?.areas ?? []).filter((a) => a.active !== "false");
  const area = areas.find((a) => a.id === areaId) ?? null;
  const outside = areaId === OUTSIDE_AREAS;
  // Service lines scoped by the chosen city (D-04); everything active when no
  // city is chosen yet or the enquiry is outside coverage.
  const coveredIds = area
    ? new Set(
        (catalogue?.coverage ?? [])
          .filter((c) => c.active !== "false" && c.areaId === area.id)
          .map((c) => c.serviceLineId)
      )
    : null;
  /** Everything sellable, before the city narrows it — the denominator the
      chips' "n of m" line reports against. */
  const sellableLines = (catalogue?.serviceLines ?? []).filter((l) => l.active !== "false");
  const serviceLines = sellableLines.filter((l) => !coveredIds || coveredIds.has(l.id));

  const toggleService = (id: string) =>
    setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // Never undefined: the list is the only thing that can set the value, and BLANK
  // starts on a member of it.
  const picked =
    SOURCE_OPTIONS.find((o) => o.id === form.sourceOption) ?? SOURCE_OPTIONS[0];

  const company = form.companyName.trim();
  const value = form.estimatedValue.trim();

  // What the service columns receive: the picked chips by NAME plus the
  // free-text remainder — controlled vocabulary first, catch-all last (D-04).
  // Resolved HERE rather than at submit, because it is one of the fields the
  // form is now validated against and the check runs on every keystroke.
  // Both free-text boxes are included, not one or the other: the input writes to
  // `form.serviceType` until the catalogue arrives and to `serviceOther` after,
  // so anything typed during the fetch would otherwise be dropped the moment the
  // chips appeared. Outside that race one of the two is always "".
  const serviceType = [
    ...serviceLines.filter((l) => serviceIds.includes(l.id)).map((l) => l.name),
    serviceOther.trim(),
    form.serviceType.trim(),
  ]
    .filter(Boolean)
    .join(", ");

  const blockers = [
    // Stated first because it sits at the top of the form. Not part of
    // newLeadBlockers: that function rules on the typed fields, and this is the
    // state of a picker — "existing client" with nobody picked is a half-answered
    // question, and filing it as new would quietly contradict what was said.
    ...(existingClient && !accountId
      ? [
          {
            field: "companyName" as const,
            message: "Pick which client this is, or switch back to New.",
          },
        ]
      : []),
    ...newLeadBlockers({
      companyName: form.companyName,
      contactName: form.contactName,
      contactEmail: form.contactEmail,
      serviceType,
      estimatedValue: form.estimatedValue,
    }),
  ];
  const blocking = (field: NewLeadField) => blockers.find((b) => b.field === field);
  const canSubmit = blockers.length === 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);

    const fields: NewLeadFields = {
      // The one pick, unpacked onto the columns it stands for. `sourceDetail`
      // keeps the label so the row still records which of them it was — "Website
      // form" and a phone call both land on the `inapp` channel and would
      // otherwise be indistinguishable in the data. Nothing renders it today.
      source: picked.source,
      // `fl_lead.company_name` is not nullable and every list column reads it,
      // so a household lead borrows the contact's name rather than landing blank
      // in the queue. This is exactly what the chat agent does with a residential
      // enquiry (src/modules/intake.ts:436) — the two doors agree or the list
      // shows two different kinds of row.
      companyName: company || form.contactName.trim(),
      ...(accountId ? { accountId } : {}),
      sourceDetail: picked.label,
      contactName: form.contactName.trim(),
      contactEmail: form.contactEmail.trim(),
      contactPhone: form.contactPhone.trim(),
      websiteDomain: form.websiteDomain.trim(),
      serviceType,
      description: form.description.trim(),
      siteAddress: form.siteAddress.trim(),
      // A picked area writes its own name and region; "outside our areas" and
      // a failed catalogue read fall back to what was typed.
      siteCity: area ? area.name : form.siteCity.trim(),
      siteRegion: area ? (area.region ?? area.name) : form.siteRegion.trim(),
      ...(picked.origin ? { origin: picked.origin } : {}),
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
              {/* ONE labelled group, not two. The new/existing choice sits inside
                  the Company field rather than above it as its own control —
                  otherwise the same idea wears three names on one screen
                  ("Client", "Company", "Account") and reads as three questions.
                  The toggle only appears once accounts have arrived and there is
                  at least one; on a failed read every lead is simply new, which
                  is the truth for most of them anyway. */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nl-company">Company</Label>
                {accounts?.length ? (
                  <div className="flex gap-1" role="radiogroup" aria-label="New or existing client">
                    {[
                      { existing: false, label: "New" },
                      { existing: true, label: "Existing client" },
                    ].map((choice) => (
                      <button
                        key={choice.label}
                        type="button"
                        role="radio"
                        aria-checked={existingClient === choice.existing}
                        // Switching drops both the account AND the name it filled
                        // in, so a half-switched form cannot file a new client
                        // under an existing client's name. Switching TO existing
                        // selects nothing — the picker below asks.
                        onClick={() => {
                          setExistingClient(choice.existing);
                          setAccountId("");
                          set("companyName")("");
                        }}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-xs transition-colors",
                          existingClient === choice.existing
                            ? "border-primary bg-muted font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {/* One identity input, never two. The picker REPLACES the text
                    box rather than sitting beside it — a form carrying both would
                    ask the same question twice and let the answers disagree. */}
                {existingClient ? (
                  <Combobox
                    id="nl-company"
                    options={(accounts ?? []).map((a) => ({
                      id: a.id,
                      label: a.name ?? "Unnamed account",
                      meta: a.websiteDomain ?? null,
                    }))}
                    value={accountId || null}
                    onChange={(id) => {
                      setAccountId(id);
                      const picked = (accounts ?? []).find((a) => a.id === id);
                      set("companyName")(picked?.name ?? "");
                    }}
                    placeholder="Pick the client"
                    searchPlaceholder="Search clients…"
                  />
                ) : (
                  <Input
                    id="nl-company"
                    value={form.companyName}
                    onChange={(e) => set("companyName")(e.target.value)}
                    placeholder="Al Manzil Restaurant"
                    autoFocus={autoFocusField()}
                  />
                )}
                <span className="text-muted-foreground text-xs">
                  {existingClient
                    ? "Converting this lead will use that client's account instead of raising a second one for them."
                    : "Leave blank for a household — the lead files under the contact's name."}
                </span>
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="nl-source">Source</Label>
                <Select value={form.sourceOption} onValueChange={set("sourceOption")}>
                  <SelectTrigger id="nl-source" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_OPTIONS.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground text-xs">{picked.hint}</span>
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="nl-contact">
                    Contact <span className="text-destructive">*</span>
                  </Label>
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
                  <Label htmlFor="nl-email">
                    Email <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="nl-email"
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => set("contactEmail")(e.target.value)}
                    placeholder="ahmed@almanzil.ae"
                    aria-invalid={Boolean(form.contactEmail.trim() && blocking("contactEmail"))}
                  />
                  {/* Only once something has been typed: an empty required field
                      is not yet a mistake, and reddening it on open scolds the
                      user for not having started. */}
                  {form.contactEmail.trim() && blocking("contactEmail") ? (
                    <span className="text-destructive text-xs">
                      {blocking("contactEmail")?.message}
                    </span>
                  ) : null}
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
                <Label>
                  Service wanted <span className="text-destructive">*</span>
                </Label>
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
                ) : serviceLines.length && serviceLines.length < sellableLines.length ? (
                  // Says WHY this list is shorter than the Services page. Without
                  // it a scoped list looks like a missing one, which is how the
                  // count difference got raised as a bug in the first place.
                  <span className="text-muted-foreground text-xs">
                    {`Showing ${serviceLines.length} of ${sellableLines.length} services — the rest are not offered in ${area?.name}.`}
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
                  {blocking("estimatedValue") ? (
                    <span className="text-destructive text-xs">
                      {blocking("estimatedValue")?.message}
                    </span>
                  ) : null}
                  {value && !blocking("estimatedValue") ? (
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
              {/* A disabled primary action says why, next to itself. One at a
                  time, in field order: a stack of four red lines on an untouched
                  form reads as a telling-off, and the next one appears as each
                  is dealt with. */}
              {blockers.length ? (
                <span className="text-muted-foreground mr-auto text-xs">
                  {blockers[0].message}
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
