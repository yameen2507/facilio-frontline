/**
 * Every deal belonging to this lead's CLIENT, with this lead's own deal marked.
 *
 * Why the account and not the lead: `fl_lead.deal_id` is singular, so "the deals
 * of this lead" is at most one row — a link, which the fact rail already has.
 * The question actually being asked when a lead is open is what else this client
 * has in flight, and that is an account-level question. A repeat enquiry from a
 * company with three deals already running is a different object from a first
 * approach, and nothing on this page used to say so.
 *
 * Presentational, like SurveysPane beside it: the page owns the fetch because
 * the count also feeds the tab label.
 */

import { Handshake } from "lucide-react";
import { Link } from "react-router-dom";
import { Chip, type Tone } from "../../../ui/Chip";
import { humanise, onDay, typedMoney } from "../../../lib/format";
import type { LeadAccountDeal } from "../types/lead";

/**
 * This module's own copy of the deal-stage colouring — the vocabulary belongs to
 * the deals module and features do not import each other's internals. An unknown
 * stage renders neutral rather than breaking, which is what lets the deals module
 * add a stage without this file shipping alongside it.
 */
const STAGE_TONE: Record<string, Tone> = {
  opportunity: "neutral",
  discovery: "blue",
  survey_required: "blue",
  survey_completed: "blue",
  estimation: "orange",
  proposal_submitted: "orange",
  negotiation: "orange",
  decision_pending: "orange",
  won: "green",
  lost: "red",
};

export function DealsPane({
  deals,
  error,
  thisLeadId,
}: {
  deals: LeadAccountDeal[] | null;
  error: string | null;
  /** Which row came from the lead being viewed, so it can say so. */
  thisLeadId: string;
}) {
  if (error) {
    return <div className="py-2 text-sm text-red-600 dark:text-red-400">{error}</div>;
  }

  if (!deals) {
    return <div className="text-muted-foreground py-2 text-sm">Loading deals…</div>;
  }

  if (!deals.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
          <Handshake className="size-4.5" aria-hidden="true" />
        </span>
        <div>
          <div className="text-sm font-medium">No deals for this client yet</div>
          {/* No button: converting is a lifecycle move with its own guards, and
              it lives in the Move-to menu. A second door to it here would be a
              shortcut past the checks that door performs. */}
          <div className="text-muted-foreground mt-0.5 text-xs">
            Converting a qualified lead is what opens the first one.
          </div>
        </div>
      </div>
    );
  }

  const mine = deals.filter((d) => d.leadId === thisLeadId).length;

  return (
    <div>
      <div className="text-muted-foreground mb-1 text-xs">
        {deals.length === 1
          ? "1 deal for this client"
          : `${deals.length} deals for this client`}
        {mine ? " — this lead's is marked" : ""}
      </div>
      <ul className="list-none">
        {deals.map((d) => {
          const fromHere = d.leadId === thisLeadId;
          return (
            <li
              key={d.id}
              className="flex gap-2.5 border-b border-dashed py-2.5 last:border-b-0 last:pb-0"
            >
              <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
                <Handshake className="size-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <Link
                    to={`/deals/${d.id}`}
                    className="truncate text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {d.title || d.refNo}
                  </Link>
                  <span className="flex-1" aria-hidden="true" />
                  <Chip tone={STAGE_TONE[d.stage] ?? "neutral"} dot>
                    {humanise(d.stage)}
                  </Chip>
                </div>
                <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
                  <code className="font-mono">{d.refNo}</code>
                  {d.estimatedValue != null ? (
                    <>
                      <span aria-hidden="true" className="opacity-40">
                        ·
                      </span>
                      {/* One-off and recurring are not carried on a list row, so
                          this states the amount without claiming which it is. */}
                      <span>{typedMoney(d.estimatedValue, d.currency ?? "AED", null, null)}</span>
                    </>
                  ) : null}
                  <span aria-hidden="true" className="opacity-40">
                    ·
                  </span>
                  <span>{onDay(d.createdAt)}</span>
                  {fromHere ? (
                    <>
                      <span aria-hidden="true" className="opacity-40">
                        ·
                      </span>
                      <span className="font-medium">from this lead</span>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
