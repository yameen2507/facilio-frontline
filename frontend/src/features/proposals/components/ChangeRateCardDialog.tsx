/**
 * Choosing the rate card by hand.
 *
 * Resolution picks the card and prints why (§3, six rules). That is the right
 * default and it stays — but it could be WRONG in a way nobody could correct: a
 * card resolved off a stale region, or none resolved at all, left the estimator
 * holding a price list they could not change.
 *
 * The reason box is the whole point of this dialog, not a formality. It replaces
 * the resolved-reason on the proposal, so the sentence the pricing surface
 * prints is either "resolution chose this, because…" or "this person chose it,
 * because…". A price on a document has to be accountable either way, and a
 * stated human choice accounts for itself better than an inferred one.
 *
 * Prices are NOT recomputed here, and the dialog says so. A line's price is what
 * the estimator entered; quietly rewriting every line to a new card would
 * overwrite hand-set numbers under the cover of a card change.
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "../../../ui/Combobox";
import { listSelectableCards, setRateCard, type SelectableCard } from "../api/proposals-util";

export function ChangeRateCardDialog({
  open,
  onOpenChange,
  proposalId,
  currentCardId,
  actor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  currentCardId: string | null | undefined;
  actor: string;
  /** The handler returns the recomputed proposal; the page renders from it. */
  onSaved: (proposal: unknown) => void;
}) {
  const [cards, setCards] = useState<SelectableCard[] | null>(null);
  const [cardId, setCardId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  /** The server's message, verbatim — it names the card and the currency clash. */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCardId("");
    setReason("");
    setError(null);
    setBusy(false);
    listSelectableCards().then(({ data }) => setCards(data?.cards ?? null));
  }, [open]);

  // Only active cards can price a proposal — the handler refuses the rest, so
  // offering them here would be offering a button that always fails.
  const selectable = (cards ?? []).filter((c) => c.status === "active" && c.id !== currentCardId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cardId || !reason.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await setRateCard(proposalId, cardId, reason.trim(), actor);
    setBusy(false);
    if (err || !data) return setError(err ?? "the card was not changed");
    onSaved(data.proposal);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Choose the rate card</DialogTitle>
            <DialogDescription>
              This replaces the card resolution picked. Line prices stay as they are — change the
              ones you mean to change.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rc-pick">Rate card</Label>
            <Combobox
              id="rc-pick"
              options={selectable.map((c) => ({
                id: c.id,
                label: c.name ?? "Unnamed card",
                meta: [c.region ?? "All regions", c.currency].filter(Boolean).join(" · "),
              }))}
              value={cardId || null}
              onChange={setCardId}
              placeholder={cards ? "Pick a card" : "Loading cards…"}
              searchPlaceholder="Search cards…"
            />
            {cards && !selectable.length ? (
              <span className="text-muted-foreground text-xs">
                No other active card exists. A draft or archived card cannot price a proposal —
                activate one in Settings › Rate cards first.
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rc-why">
              Why this card <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="rc-why"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. client agreed the 2026 standard list at renewal"
            />
            <span className="text-muted-foreground text-xs">
              This becomes the proposal&rsquo;s stated reason, in place of the resolver&rsquo;s. It
              is what anyone asking &ldquo;why is this line 140 and not 120&rdquo; will read.
            </span>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            {!cardId ? (
              <span className="text-muted-foreground mr-auto text-xs">Pick a card to continue.</span>
            ) : !reason.trim() ? (
              <span className="text-muted-foreground mr-auto text-xs">
                A reason is required — it replaces the one on the proposal.
              </span>
            ) : null}
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!cardId || !reason.trim() || busy}>
              {busy ? "Saving…" : "Use this card"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
