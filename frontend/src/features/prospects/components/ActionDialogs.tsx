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
import {
  copyForward,
  createLocation,
  deactivateLocation,
  linkFacilio,
  listLocations,
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
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType(allowed[0] ?? "space");
    setName("");
    setCode("");
    setClientLevelLabel("");
    setStreet("");
    setCity("");
    setError(null);
    // `allowed` is derived from `parent`, which is in the dep list already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parent]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await createLocation(owner.dealId ?? "", type, name.trim(), actor, {
      ...(owner.leadId ? { leadId: owner.leadId } : {}),
      ...(owner.accountId ? { accountId: owner.accountId } : {}),
      ...(parent ? { parentId: parent.id } : {}),
      provenance: "manual",
      ...(code.trim() ? { code: code.trim() } : {}),
      ...(clientLevelLabel.trim() ? { clientLevelLabel: clientLevelLabel.trim() } : {}),
      ...(street.trim() ? { street: street.trim() } : {}),
      ...(city.trim() ? { city: city.trim() } : {}),
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
          : "A property in this pursuit. A name is enough to start — the rest can be filled in as it arrives."
      }
      error={error}
      busy={busy}
      submitLabel="Add"
      canSubmit={Boolean(name.trim())}
      blockedReason="Give it a name"
      onSubmit={submit}
    >
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
      </div>

      {/* X-21 — offered at EVERY level, not just a site. This was gated on
          `type === "site"`, and "Add inside" can never create a site, so a
          building or a floor could not be given an address at all. Facilio hangs
          a Location record off every level, and a surveyor dispatched to a
          building needs its address as much as one sent to a site. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <span className="text-muted-foreground text-xs sm:col-span-2">
            The first thing an RFP contains and the last thing the surveyor needs. It also decides
            whether the site is inside a service area at all.
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
