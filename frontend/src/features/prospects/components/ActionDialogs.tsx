/**
 * Every write the portfolio tree can perform, as one dialog each.
 *
 * TWO PATTERNS RUN THROUGH ALL OF THEM, both learned the hard way elsewhere in
 * this app:
 *
 * 1. **Visibility is split from the record.** Each dialog takes `open` AND its
 *    target, because the body interpolates the location's name — a confirmation
 *    that derives visibility from the record spends its exit animation reading
 *    "Remove **.**", losing the identity of the thing it names at the exact
 *    moment the user is deciding.
 *
 * 2. **The server's message is shown verbatim.** Never a client-side rewrite:
 *    these handlers refuse things for real reasons ("no_bid needs a note", "that
 *    parent sits beneath this location"), and those sentences are better than
 *    anything this file could invent.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { autoFocusField } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/ui/Combobox";
import {
  copyForward,
  createLocation,
  deactivateLocation,
  linkFacilio,
  listAccountOptions,
  listDeals,
  listLeadOptions,
  listLocations,
  OWNER_OPTION_LIMITS,
  reparentLocation,
  setDecision,
  setVerdict,
} from "../api/prospects-util";
import {
  childTypesOf,
  DECISION_LABEL,
  LOCATION_TYPES,
  PURSUIT_DECISIONS,
  TYPE_LABEL,
  VERDICT_LABEL,
  VERDICTS,
  verdictNeedsNote,
  type LocationType,
  type ProspectLocation,
  type PursuitDecision,
  type Verdict,
} from "../types/prospect";

/** The shell every dialog here shares — one place for the busy/error plumbing. */
function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  error,
  busy,
  submitLabel,
  canSubmit,
  blockedReason,
  onSubmit,
  children,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  error: string | null;
  busy: boolean;
  submitLabel: string;
  canSubmit: boolean;
  /** Rendered beside a disabled action. A dead button with no reason is the
      whole cost of disabled-until-valid, and it is cheap to avoid. */
  blockedReason?: string | null;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
  destructive?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">{children}</div>

          {error ? <span className="text-destructive text-sm">{error}</span> : null}

          <DialogFooter>
            {!canSubmit && blockedReason ? (
              <span className="text-muted-foreground mr-auto self-center text-xs">
                {blockedReason}
              </span>
            ) : null}
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!canSubmit || busy}
              variant={destructive ? "destructive" : "default"}
            >
              {busy ? "Working…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Create ───────────────────────────────────────────────────────────────────

/**
 * Add a location. `name` is the only required field, on purpose (§3's adoption
 * test): the RFP coordinator must be able to turn an attachment into a structured
 * list faster than she can read it, and a form that demands an area first cannot.
 */
/**
 * Who a new property belongs to. §4 — at least one of the three, filled
 * progressively as the record matures. A lead-owned property is the normal case
 * before a deal exists, which is why this is not just a deal id.
 */
export type OwnerScope = { leadId?: string; accountId?: string; dealId?: string };

/** Empty means nobody has been named yet — the dialog has to ask. */
export const hasOwner = (o: OwnerScope) => Boolean(o.leadId || o.accountId || o.dealId);

type OwnerKind = "lead" | "account" | "deal";

const OWNER_KINDS: Array<{ kind: OwnerKind; label: string; hint: string }> = [
  {
    kind: "lead",
    label: "An enquiry",
    hint: "The sites named in an enquiry, before there is a deal to hang them on.",
  },
  {
    kind: "account",
    label: "A client",
    hint: "A building this client owns, across every pursuit rather than one of them.",
  },
  { kind: "deal", label: "A pursuit", hint: "A property in the scope of one deal." },
];

/**
 * "Whose is this?" — shown ONLY when the surface could not answer it.
 *
 * A Deal, Lead or Account tab already knows, and the module page knows whenever
 * its deal filter is set, so in the ordinary case this never renders. It exists
 * for the one case that had no answer at all: the unfiltered `/prospects` page,
 * which used to hide its Add buttons entirely rather than ask. Hiding the action
 * taught the reader that a property REQUIRES a deal, which is not the rule §4
 * states nor the one the server enforces.
 *
 * All three lists load together the moment the dialog opens. That is three reads
 * for a form most people submit once, and it is still the right trade: the kind
 * can be switched twice while deciding, and a picker that re-fetches on every
 * switch is a picker that is empty exactly when it is being looked at.
 */
function OwnerField({
  kind,
  onKindChange,
  value,
  onChange,
  options,
  loading,
  truncated,
}: {
  kind: OwnerKind;
  onKindChange: (kind: OwnerKind) => void;
  value: string;
  onChange: (id: string) => void;
  options: ComboboxOption[];
  loading: boolean;
  /** Whether this kind's list hit its own cap — the caps differ per kind. */
  truncated: boolean;
}) {
  const active = OWNER_KINDS.find((k) => k.kind === kind) ?? OWNER_KINDS[0];

  return (
    <div className="bg-muted/40 flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nl-owner-kind">
          Who is this for? <span className="text-destructive">*</span>
        </Label>
        <Select value={kind} onValueChange={(v) => onKindChange(v as OwnerKind)}>
          <SelectTrigger id="nl-owner-kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OWNER_KINDS.map((k) => (
              <SelectItem key={k.kind} value={k.kind}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-xs">{active.hint}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nl-owner">{active.label}</Label>
        <Combobox
          id="nl-owner"
          options={options}
          value={value || null}
          onChange={onChange}
          loading={loading}
          placeholder={`Pick ${active.label.toLowerCase()}`}
          searchPlaceholder="Search…"
          emptyText={loading ? "Loading…" : "Nothing matches."}
        />
        {/* The list is capped server-side, and a Combobox searches only what it
            was handed. Saying so beats a reader concluding the record is gone. */}
        {truncated ? (
          <span className="text-muted-foreground text-xs">
            The {OWNER_OPTION_LIMITS[kind]} most recent only. If yours is older, open it and add the
            property from its own Portfolio tab.
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function NewLocationDialog({
  open,
  onOpenChange,
  owner,
  parent,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** May be empty — see `OwnerField`, which is what handles that. */
  owner: OwnerScope;
  /** Null means a site at the top level. */
  parent: ProspectLocation | null;
  actor: string;
  onDone: () => void;
}) {
  const allowed: LocationType[] = parent ? childTypesOf(parent.type) : ["site"];
  const [type, setType] = useState<LocationType>(allowed[0] ?? "space");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [clientLevelLabel, setClientLevelLabel] = useState("");
  /**
   * The WHOLE postal address, in the edit form's own order and labels (§3
   * "Address"). It used to be street and city alone, which split one fact across
   * two screens: whoever added a site typed half the address they had in front
   * of them, saved, then reopened the edit dialog to finish it.
   *
   * `country` is the one that could not wait. The hint under these boxes already
   * claimed the address "decides whether the site is inside a service area at
   * all" — and the field that actually drives that matching was the one missing.
   *
   * The rest of §3 stays out on purpose. Area, floors, rooms, restrooms,
   * occupancy and operating hours are the priced tier: they come from a survey,
   * and asked here they would be guessed. A guessed area sets the hours, the
   * crew and the price, so blank is worth more than approximately-right.
   */
  const [description, setDescription] = useState("");
  const [floorLevel, setFloorLevel] = useState("");
  const [locationName, setLocationName] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState("");
  const [locationPhone, setLocationPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The owner the surface already knows, if any.
   *
   * A tab supplies it. Failing that the PARENT supplies it: adding a floor
   * inside a building never needs to ask whose building it is, and §4 guarantees
   * the parent has an owner — so on the unfiltered module page, a nested add
   * still knows, and only a new top-level site has to ask.
   */
  const surfaceOwner: OwnerScope = hasOwner(owner)
    ? owner
    : parent
      ? {
          ...(parent.leadId ? { leadId: parent.leadId } : {}),
          ...(parent.accountId ? { accountId: parent.accountId } : {}),
          ...(parent.dealId ? { dealId: parent.dealId } : {}),
        }
      : {};

  // Only ever read when nobody is known; the inherited case leaves them idle.
  const inherited = hasOwner(surfaceOwner);
  const [ownerKind, setOwnerKind] = useState<OwnerKind>("deal");
  const [ownerId, setOwnerId] = useState("");
  const [ownerLists, setOwnerLists] = useState<Record<OwnerKind, ComboboxOption[]>>({
    lead: [],
    account: [],
    deal: [],
  });
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerTruncated, setOwnerTruncated] = useState<Record<OwnerKind, boolean>>({
    lead: false,
    account: false,
    deal: false,
  });

  useEffect(() => {
    if (!open) return;
    setType(allowed[0] ?? "space");
    setName("");
    setCode("");
    setClientLevelLabel("");
    setDescription("");
    setFloorLevel("");
    setLocationName("");
    setStreet("");
    setCity("");
    setState("");
    setZip("");
    setCountry("");
    setLocationPhone("");
    setError(null);
    setOwnerId("");
    // `allowed` is derived from `parent`, which is in the dep list already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parent]);

  useEffect(() => {
    if (!open || inherited) return;
    let live = true;
    setOwnerLoading(true);
    Promise.all([listLeadOptions(), listAccountOptions(), listDeals()]).then(
      ([leadRes, accountRes, dealRes]) => {
        if (!live) return;
        setOwnerLists({
          lead: (leadRes.data?.leads ?? []).map((l) => ({
            id: l.id,
            label: l.companyName || l.refNo,
            meta: [l.refNo, l.siteCity].filter(Boolean).join(" · "),
          })),
          account: (accountRes.data?.accounts ?? []).map((a) => ({
            id: a.id,
            label: a.name || "Unnamed client",
            meta: a.websiteDomain ?? null,
          })),
          deal: (dealRes.data?.deals ?? []).map((d) => ({
            id: d.id,
            label: d.title || d.refNo,
            meta: [d.refNo, d.accountName].filter(Boolean).join(" · "),
          })),
        });
        setOwnerTruncated({
          lead: (leadRes.data?.leads ?? []).length >= OWNER_OPTION_LIMITS.lead,
          // `account-list` reports its own truncation; believed over counting.
          account:
            accountRes.data?.truncated ??
            (accountRes.data?.accounts ?? []).length >= OWNER_OPTION_LIMITS.account,
          deal: (dealRes.data?.deals ?? []).length >= OWNER_OPTION_LIMITS.deal,
        });
        setOwnerLoading(false);
      }
    );
    return () => {
      live = false;
    };
    // The three lists do not change while one dialog is open.
  }, [open, inherited]);

  /**
   * The owner actually sent. Inherited from the surface when there is one, and
   * otherwise whatever the field above collected — the same "at least one of
   * three" the server checks, asked once at the only moment it is unanswerable.
   */
  const chosen: OwnerScope | null = inherited
    ? surfaceOwner
    : ownerId
      ? { [`${ownerKind}Id`]: ownerId }
      : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !chosen || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await createLocation(chosen.dealId ?? "", type, name.trim(), actor, {
      ...(chosen.leadId ? { leadId: chosen.leadId } : {}),
      ...(chosen.accountId ? { accountId: chosen.accountId } : {}),
      ...(parent ? { parentId: parent.id } : {}),
      provenance: "manual",
      ...(code.trim() ? { code: code.trim() } : {}),
      ...(clientLevelLabel.trim() ? { clientLevelLabel: clientLevelLabel.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      // Sent when it parses. "0" is a real floor level, so an emptiness check
      // has to be the STRING being blank — `Number("") === 0` would file every
      // unanswered floor as the ground floor.
      ...(floorLevel.trim() && Number.isFinite(Number(floorLevel))
        ? { floorLevel: Number(floorLevel) }
        : {}),
      ...(locationName.trim() ? { locationName: locationName.trim() } : {}),
      ...(street.trim() ? { street: street.trim() } : {}),
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(state.trim() ? { state: state.trim() } : {}),
      ...(zip.trim() ? { zip: zip.trim() } : {}),
      ...(country.trim() ? { country: country.trim() } : {}),
      ...(locationPhone.trim() ? { locationPhone: locationPhone.trim() } : {}),
    });
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
    onDone();
  };

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={parent ? `Add inside ${parent.name}` : "Add a property"}
      description={
        parent
          ? "Everything you add here is recorded underneath its parent, so it stays in the tree when the deal is won."
          : inherited
            ? "A property in this pursuit. A name is enough to start — the rest can be filled in as it arrives."
            : "A building you hope to be paid to maintain. Say whose it is and what it is called; the rest can be filled in as it arrives."
      }
      error={error}
      busy={busy}
      submitLabel="Add"
      canSubmit={Boolean(name.trim() && chosen)}
      blockedReason={chosen ? "Give it a name" : "Say who this is for, and give it a name"}
      onSubmit={submit}
    >
      {/* First, because it is the question the rest of the form assumes an
          answer to. */}
      {!inherited ? (
        <OwnerField
          kind={ownerKind}
          onKindChange={(k) => {
            setOwnerKind(k);
            // The id belongs to the old kind — carrying it over would send a
            // lead's id as an account's.
            setOwnerId("");
          }}
          value={ownerId}
          onChange={setOwnerId}
          options={ownerLists[ownerKind]}
          loading={ownerLoading}
          truncated={ownerTruncated[ownerKind]}
        />
      ) : null}

      {allowed.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nl-type">Level</Label>
          <Select value={type} onValueChange={(v) => setType(v as LocationType)}>
            <SelectTrigger id="nl-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowed.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* A space directly under a site is legitimate, not a mistake — this
              says so before the user wonders whether they picked wrong. */}
          {parent?.type === "site" ? (
            <span className="text-muted-foreground text-xs">
              A car park, lawn or forecourt has no building above it — put it straight under the
              site.
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nl-name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="nl-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={type === "site" ? "e.g. Al Bayt Grill — Downtown" : "e.g. Ground floor lobby"}
          autoFocus={autoFocusField()}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nl-code">Client&rsquo;s reference</Label>
          <Input
            id="nl-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. BLD-04"
          />
          <span className="text-muted-foreground text-xs">
            Their numbering, not ours — a tender response is scored against it.
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {/* §3 Identity, in the edit form's order and labels. Every one is
              optional — §3's adoption bet is that a phone call gives you "the
              Bleecker Street store" and nothing else, so the form must never
              demand. What it must not do is make a fact UNSAYABLE at the moment
              it is known, which is what it was doing. */}
          <Label htmlFor="nl-level-label">What they call this level</Label>
          <Input
            id="nl-level-label"
            value={clientLevelLabel}
            onChange={(e) => setClientLevelLabel(e.target.value)}
            placeholder="facility · tower · block · unit"
          />
          <span className="text-muted-foreground text-xs">
            Absorb their vocabulary rather than imposing ours.
          </span>
        </div>
        {/* Only where it means something. A site has no floor level, and a box
            that cannot apply is worse than one that is missing. */}
        {type === "floor" || type === "space" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nl-floor-level">Floor level</Label>
            <Input
              id="nl-floor-level"
              inputMode="numeric"
              value={floorLevel}
              onChange={(e) => setFloorLevel(e.target.value)}
              placeholder="e.g. 3"
            />
            <span className="text-muted-foreground text-xs">
              A number, not a name: -1 basement, 0 ground, 1 first. Call it &ldquo;Mezzanine&rdquo;
              in the name.
            </span>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="nl-description">Description</Label>
          <Input
            id="nl-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <span className="text-muted-foreground text-xs">
            Travels to Facilio when this converts.
          </span>
        </div>
      </div>

      {/* X-21 — offered at EVERY level, not just a site. This was gated on
          `type === "site"`, and "Add inside" can never create a site, so a
          building or a floor could not be given an address at all. Facilio hangs
          a Location record off every level, and a surveyor dispatched to a
          building needs its address as much as one sent to a site. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="nl-location-name">Location name</Label>
            <Input
              id="nl-location-name"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nl-address">Address</Label>
            <Input
              id="nl-address"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nl-city">City</Label>
            <Input id="nl-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nl-state">State / province</Label>
            <Input id="nl-state" value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nl-zip">Postcode</Label>
            <Input id="nl-zip" value={zip} onChange={(e) => setZip(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nl-country">Country</Label>
            <Input id="nl-country" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nl-site-phone">Site phone</Label>
            <Input
              id="nl-site-phone"
              type="tel"
              value={locationPhone}
              onChange={(e) => setLocationPhone(e.target.value)}
            />
            <span className="text-muted-foreground text-xs">
              The site&rsquo;s own number, not the account&rsquo;s.
            </span>
          </div>
          <span className="text-muted-foreground text-xs sm:col-span-2">
            The first thing an RFP contains and the last thing the surveyor needs. The country
            decides whether the site is inside a service area at all.
          </span>
      </div>
    </ActionDialog>
  );
}

// ── Decision ─────────────────────────────────────────────────────────────────

/** The bid / no-bid call. A note is mandatory on `no_bid` and the server agrees. */
export function DecisionDialog({
  open,
  onOpenChange,
  location,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: ProspectLocation | null;
  actor: string;
  onDone: () => void;
}) {
  // Renamed off `setDecision`: the API function of that name is imported above,
  // and a shadowed import fails silently at the call site rather than loudly.
  const [decision, setDecisionValue] = useState<PursuitDecision>("bid");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !location) return;
    setDecisionValue(location.pursuitDecision === "undecided" ? "bid" : location.pursuitDecision);
    setNote(location.pursuitDecisionNote ?? "");
    setError(null);
  }, [open, location]);

  const needsNote = decision === "no_bid";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!location || busy || (needsNote && !note.trim())) return;
    setBusy(true);
    setError(null);
    const { error: err } = await setDecision(location.id, decision, note.trim(), actor);
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
    onDone();
  };

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Bid on ${location?.name ?? "this property"}?`}
      description="Decided per property. A property you are not bidding leaves every total and is never written to Facilio."
      error={error}
      busy={busy}
      submitLabel="Save decision"
      canSubmit={!needsNote || Boolean(note.trim())}
      blockedReason="Say why you are not bidding"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dd-decision">Decision</Label>
        <Select value={decision} onValueChange={(v) => setDecisionValue(v as PursuitDecision)}>
          <SelectTrigger id="dd-decision" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PURSUIT_DECISIONS.map((d) => (
              <SelectItem key={d} value={d}>
                {DECISION_LABEL[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dd-note">
          Reason {needsNote ? <span className="text-destructive">*</span> : null}
        </Label>
        <Textarea
          id="dd-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. Outside our coverage area"
        />
        <span className="text-muted-foreground text-xs">
          Next time this client tenders, the reason is what you will want to read.
        </span>
      </div>
    </ActionDialog>
  );
}

// ── Verdict ──────────────────────────────────────────────────────────────────

/**
 * What the surveyor found. Three of the six verdicts print on the proposal as a
 * qualification, so the note is mandatory — a blank there is a scope gap nobody
 * can defend in a negotiation six weeks later.
 */
export function VerdictDialog({
  open,
  onOpenChange,
  location,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: ProspectLocation | null;
  actor: string;
  onDone: () => void;
}) {
  const [verdict, setVerdictValue] = useState<Verdict>("verified");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !location) return;
    setVerdictValue("verified");
    setNote(location.verdictNote ?? "");
    setError(null);
  }, [open, location]);

  const needsNote = verdictNeedsNote(verdict);
  const linked = Boolean((location?.facilioId ?? "").trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!location || busy || (needsNote && !note.trim())) return;
    setBusy(true);
    setError(null);
    const { error: err } = await setVerdict(location.id, verdict, note.trim(), actor);
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
    onDone();
  };

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`What did the walk find at ${location?.name ?? "this location"}?`}
      description="Recorded against the property so the proposal can say what was and was not seen."
      error={error}
      busy={busy}
      submitLabel="Record finding"
      canSubmit={!needsNote || Boolean(note.trim())}
      blockedReason="This finding needs a note"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vd-verdict">Finding</Label>
        <Select value={verdict} onValueChange={(v) => setVerdictValue(v as Verdict)}>
          <SelectTrigger id="vd-verdict" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VERDICTS.filter((v) => v !== "unverified" && v !== "added_on_site").map((v) => (
              <SelectItem key={v} value={v}>
                {VERDICT_LABEL[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* §7.3, said before the user commits rather than after. */}
      {linked && verdict === "changed" ? (
        <span className="text-sm">
          This property is already in Facilio. Recording it as changed raises a discrepancy for
          someone to look at and <strong>writes nothing to Facilio</strong> — a bid-stage estimate
          never overwrites a maintained record.
        </span>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vd-note">
          Note {needsNote ? <span className="text-destructive">*</span> : null}
        </Label>
        <Textarea
          id="vd-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. Block B basement — escort unavailable, not surveyed"
        />
        {needsNote ? (
          <span className="text-muted-foreground text-xs">
            This prints on the proposal as a qualification.
          </span>
        ) : null}
      </div>
    </ActionDialog>
  );
}

// ── Re-parent ────────────────────────────────────────────────────────────────

/**
 * Move a location. The subtree moves with it, and the dialog says how many rows
 * that is before the user commits — a building silently rewriting forty spaces is
 * the kind of thing that must be told, not inferred.
 */
export function ReparentDialog({
  open,
  onOpenChange,
  location,
  candidates,
  descendantCount,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: ProspectLocation | null;
  /** Legal destinations, already filtered by the caller (it holds the tree). */
  candidates: ProspectLocation[];
  descendantCount: number;
  actor: string;
  onDone: () => void;
}) {
  const TOP = "__top__";
  const [target, setTarget] = useState(TOP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTarget(location?.parentId ?? TOP);
    setError(null);
  }, [open, location]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!location || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await reparentLocation(
      location.id,
      target === TOP ? null : target,
      actor
    );
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
    onDone();
  };

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Move ${location?.name ?? "this location"}`}
      description={
        descendantCount > 0
          ? `Everything inside it moves too — ${descendantCount} more ${
              descendantCount === 1 ? "row" : "rows"
            }.`
          : "Choose where it sits in the tree."
      }
      error={error}
      busy={busy}
      submitLabel="Move"
      canSubmit={target !== (location?.parentId ?? TOP)}
      blockedReason="It is already there"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rp-target">New parent</Label>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger id="rp-target" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {location?.type === "site" ? null : null}
            <SelectItem value={TOP}>Top level (a site)</SelectItem>
            {candidates.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} · {TYPE_LABEL[c.type].toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-xs">
          Only levels that can legally hold this one are offered, and a location can never be
          moved inside itself.
        </span>
      </div>
    </ActionDialog>
  );
}

// ── Link to Facilio ──────────────────────────────────────────────────────────

/**
 * Record that this property already exists in Facilio.
 *
 * A HUMAN confirms the match — the module never guesses, which is why the
 * automatic building-matching screen was cut from the spec. Getting it wrong
 * means either skipping a building that should have been created, or claiming a
 * customer's live record belongs to this pursuit.
 */
export function LinkFacilioDialog({
  open,
  onOpenChange,
  location,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: ProspectLocation | null;
  actor: string;
  onDone: () => void;
}) {
  const [facilioId, setFacilioId] = useState("");
  const [module, setModule] = useState<LocationType>("site");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !location) return;
    setFacilioId(location.facilioId ?? "");
    setModule((location.facilioModule as LocationType) ?? location.type);
    setConfirmed(false);
    setError(null);
  }, [open, location]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!location || busy || !facilioId.trim() || !confirmed) return;
    setBusy(true);
    setError(null);
    const { error: err } = await linkFacilio(location.id, facilioId.trim(), module, actor);
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
    onDone();
  };

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Link ${location?.name ?? "this property"} to Facilio`}
      description="For a repeat client whose building is already in the CMMS. Linking means the convert leaves it alone rather than creating a second copy."
      error={error}
      busy={busy}
      submitLabel="Link"
      canSubmit={Boolean(facilioId.trim()) && confirmed}
      blockedReason={facilioId.trim() ? "Confirm the match" : "Enter the Facilio record id"}
      onSubmit={submit}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lf-id">Facilio record id</Label>
          <Input
            id="lf-id"
            value={facilioId}
            onChange={(e) => setFacilioId(e.target.value)}
            className="font-mono text-xs"
            autoFocus={autoFocusField()}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lf-module">Which module it lives in</Label>
          <Select value={module} onValueChange={(v) => setModule(v as LocationType)}>
            <SelectTrigger id="lf-module" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCATION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="lf-confirm"
          checked={confirmed}
          onCheckedChange={(v) => setConfirmed(v === true)}
        />
        <Label htmlFor="lf-confirm" className="text-sm leading-snug font-normal">
          I have checked this is the same building in Facilio.
        </Label>
      </div>
      <span className="text-muted-foreground text-xs">
        We never match automatically. A wrong link either skips a building that should have been
        created, or attaches a live customer record to this pursuit.
      </span>
    </ActionDialog>
  );
}

// ── Remove ───────────────────────────────────────────────────────────────────

/**
 * Soft-remove. Names the consequence rather than asking "are you sure?", and
 * says what goes with it — the subtree does, and that is the part users do not
 * expect.
 */
export function RemoveDialog({
  open,
  onOpenChange,
  location,
  descendantCount,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: ProspectLocation | null;
  descendantCount: number;
  actor: string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError(null);
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!location || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await deactivateLocation(location.id, reason.trim(), actor);
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
    onDone();
  };

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      title={`Remove ${location?.name ?? "this location"} from the pursuit`}
      description={
        descendantCount > 0
          ? `Everything inside it goes too — ${descendantCount} more ${
              descendantCount === 1 ? "row" : "rows"
            }. Nothing is deleted; it stops appearing in this pursuit and stays in the record.`
          : "Nothing is deleted. It stops appearing in this pursuit and stays in the record."
      }
      error={error}
      busy={busy}
      submitLabel="Remove"
      // X-22 — the reason is REQUIRED, and the server enforces it too. Removal
      // cascades to everything inside, and nothing is ever hard-deleted, so this
      // sentence is the only way anyone later learns why the building left.
      // Gating here means the user finds that out from a disabled button rather
      // than from a rejected save.
      canSubmit={Boolean(reason.trim())}
      onSubmit={submit}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rm-reason">
          Reason <span className="text-destructive">*</span>
        </Label>
        <Input
          id="rm-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Duplicate of Tower B"
          autoFocus={autoFocusField()}
        />
        <span className="text-muted-foreground text-xs">
          Nothing is deleted — it leaves the pursuit and keeps its history. This is what anyone
          reading that history later will see.
        </span>
      </div>
    </ActionDialog>
  );
}

// ── Copy forward ─────────────────────────────────────────────────────────────

/**
 * "Add from a previous pursuit" — §5.4, and it replaces a clone feature entirely.
 *
 * The copy carries structure, area, address and the Facilio id, so a building you
 * bid eighteen months ago starts warm and the convert already knows it exists.
 * It is a COPY, not a shared row, because a survey is a point-in-time record:
 * that building's condition then is not its condition now.
 *
 * The source list is loaded per deal on demand rather than up front — most
 * pursuits never use this, and it would be two extra round trips on every visit.
 */
export function CopyForwardDialog({
  open,
  onOpenChange,
  dealId,
  deals,
  actor,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  deals: Array<{ id: string; refNo: string; title: string | null; accountName: string | null }>;
  actor: string;
  onDone: () => void;
}) {
  const [sourceDeal, setSourceDeal] = useState("");
  const [sources, setSources] = useState<ProspectLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState("");
  const [withDescendants, setWithDescendants] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSourceDeal("");
    setSources([]);
    setPick("");
    setWithDescendants(true);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !sourceDeal) return;
    setLoading(true);
    setPick("");
    let live = true;
    listLocations({ dealId: sourceDeal }, true).then(({ data, error: err }) => {
      if (!live) return;
      setLoading(false);
      if (err) return setError(err);
      // Only sites: copying a whole property forward is the case that matters,
      // and `withDescendants` brings its buildings and spaces with it.
      setSources((data?.locations ?? []).filter((l) => l.type === "site"));
    });
    return () => {
      live = false;
    };
  }, [open, sourceDeal]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pick || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await copyForward(pick, dealId, actor, { withDescendants });
    setBusy(false);
    if (err) return setError(err);
    onOpenChange(false);
    onDone();
  };

  const others = deals.filter((d) => d.id !== dealId);

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add from a previous pursuit"
      description="Bidding a building you have bid before. The copy brings its structure, measurements, address and Facilio link, so this bid starts where the last one finished."
      error={error}
      busy={busy}
      submitLabel="Copy forward"
      canSubmit={Boolean(pick)}
      blockedReason={sourceDeal ? "Pick a property" : "Pick the earlier deal"}
      onSubmit={submit}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cf-deal">Earlier deal</Label>
        <Select value={sourceDeal} onValueChange={setSourceDeal}>
          <SelectTrigger id="cf-deal" className="w-full">
            <SelectValue placeholder="Pick the deal it was bid on" />
          </SelectTrigger>
          <SelectContent>
            {others.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.refNo} — {d.title ?? d.accountName ?? "Untitled"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!others.length ? (
          <span className="text-muted-foreground text-xs">
            There is only one deal so far, so there is nothing earlier to copy from.
          </span>
        ) : null}
      </div>

      {sourceDeal ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-pick">Property</Label>
          <Select value={pick} onValueChange={setPick} disabled={loading}>
            <SelectTrigger id="cf-pick" className="w-full">
              <SelectValue
                placeholder={loading ? "Loading properties…" : "Pick the property to copy"}
              />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.city ? ` · ${s.city}` : ""}
                  {(s.facilioId ?? "").trim() ? " · in Facilio" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!loading && !sources.length ? (
            <span className="text-muted-foreground text-xs">
              That deal has no properties recorded.
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-start gap-2">
        <Checkbox
          id="cf-desc"
          checked={withDescendants}
          onCheckedChange={(v) => setWithDescendants(v === true)}
        />
        <Label htmlFor="cf-desc" className="text-sm leading-snug font-normal">
          Bring its buildings and spaces too
        </Label>
      </div>
    </ActionDialog>
  );
}
