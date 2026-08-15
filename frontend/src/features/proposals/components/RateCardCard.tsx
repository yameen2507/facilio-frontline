/**
 * Which rate card priced this proposal, and WHY THAT ONE.
 *
 * Spec §3 makes the resolution visible on the proposal deliberately: an
 * unexplained price is an unauditable one. Resolution is six rules deep — status
 * active, today inside the effective window, region matching or null, client
 * matching or null, most specific wins, priority breaks ties — and when an
 * estimator asks "why is this line 140 and not 120", the honest answer starts
 * with the card. `rateCardResolvedReason` is the server's own sentence about
 * that, and it is printed here verbatim.
 *
 * It sits at the TOP of the pricing surface rather than in a details pane
 * because it is step 2 of the six-step derivation, and the table underneath is
 * step 6. Reading them in that order is the point.
 */

import { CreditCard, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "../../../ui/Card";
import { Facts } from "../../../ui/Facts";
import { Chip } from "../../../ui/Chip";
import { humanise, onDay } from "../../../lib/format";
import type { RateCard } from "../types/proposal";

export function RateCardCard({
  rateCard,
  resolvedReason,
  currency,
  onChange,
}: {
  rateCard: RateCard | null;
  resolvedReason: string | null | undefined;
  /** Opens the picker. Absent once the proposal is past editing, where the card
      is part of what was sent and changing it would rewrite history. */
  onChange?: () => void;
  /** The proposal's own currency — stamped at creation from the card, and the
      one both must agree on. */
  currency: string | null | undefined;
}) {
  if (!rateCard) {
    return (
      <Card title="Rate card">
        <div className="flex items-start gap-2.5">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-orange-600 dark:text-orange-400"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="text-sm font-medium">No card resolved</div>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {resolvedReason ??
                "Nothing matched this deal's region and client inside an effective window, so there is no card price to generate from. Every line has to be priced by hand, and each one will reach an approver."}
            </p>
            {/* The case a picker is most needed in: resolution found nothing, and
                before this there was no way to say "use that one". */}
            {onChange ? (
              <Button variant="outline" size="sm" className="mt-3" onClick={onChange}>
                Choose a card
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Rate card"
      meta={rateCard.status ? humanise(rateCard.status) : undefined}
    >
      <div className="flex items-center gap-2.5">
        <CreditCard className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-sm font-medium">{rateCard.name ?? "Unnamed card"}</span>
        {/* The currency is stamped on the proposal FROM the card, once, at
            creation — one currency per proposal, and this is where it came from. */}
        <Chip tone="neutral" small>
          {currency ?? rateCard.currency ?? "—"}
        </Chip>
        {/* Quiet on purpose: resolution is right nearly always, and a prominent
            Change invites second-guessing a rule that explains itself. */}
        {onChange ? (
          <Button variant="ghost" size="sm" onClick={onChange}>
            Change
          </Button>
        ) : null}
      </div>

      {/* The resolution, in the server's words. This is the line spec §3 asks
          for, and the reason the whole card is on screen. */}
      {resolvedReason ? (
        <p className="text-muted-foreground bg-muted/40 mt-3 rounded-md px-3 py-2 text-xs">
          <span className="text-foreground font-medium">Why this card: </span>
          {resolvedReason}
        </p>
      ) : null}

      <div className="mt-4 border-t pt-4">
        <Facts
          items={[
            // Null means "all", not "none" — a card with no region priced
            // everywhere, and reading that as unscoped-by-mistake is how the
            // wrong card gets blamed.
            { label: "Region", value: rateCard.region ?? "All regions" },
            { label: "Client", value: rateCard.clientAccountId ? "This client only" : "All clients" },
            { label: "Priority", value: rateCard.priority ?? "—" },
            {
              label: "Effective",
              value: rateCard.effectiveFrom
                ? `${onDay(rateCard.effectiveFrom)} → ${
                    rateCard.effectiveTo ? onDay(rateCard.effectiveTo) : "open"
                  }`
                : null,
            },
          ]}
        />
      </div>

      <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">
        Each line copied its card price when it was drafted and holds it there — which is what makes
        a sent proposal immune to a later rate change.
      </p>
    </Card>
  );
}
