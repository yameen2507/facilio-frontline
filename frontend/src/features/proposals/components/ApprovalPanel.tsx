/**
 * The approval panel — THE EXCEPTION LIST, and deliberately nothing else.
 *
 * Spec §4: "the approver's screen is the exception list — which lines deviated,
 * by how much, with the stated reason. Not the document. Showing them the whole
 * proposal is the same as showing them nothing." So this component renders the
 * exceptions and refuses to grow: no pricing table, no totals, no document
 * preview, no link that quietly reintroduces one as the obvious next click.
 *
 * It sits on the estimator's screen too, and that is the point. The decision is
 * computed on every read, so the person about to submit sees exactly what the
 * approver will see — including the line whose reason they forgot to type.
 *
 * Two approvals exist in this system and must never be conflated: the rate card
 * has its own `Approved By`, which approves a PRICE LIST. This approves a
 * DEVIATION from one.
 */

import { ShieldCheck, TriangleAlert } from "lucide-react";
import { Card } from "../../../ui/Card";
import { percent } from "../money";
import { PricingModeChip } from "./ProposalChips";
import type { Approval } from "../types/proposal";

export function ApprovalPanel({ approval }: { approval: Approval | undefined }) {
  // A proposal read before the approval slice landed carries no decision at
  // all. Saying so is better than rendering a clean panel that implies one.
  if (!approval) {
    return (
      <Card title="Approval">
        <p className="text-muted-foreground text-sm">
          The approval decision could not be read for this proposal.
        </p>
      </Card>
    );
  }

  if (!approval.needsApproval) {
    return (
      <Card title="Approval">
        <div className="flex items-start gap-2.5">
          <ShieldCheck
            className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-500"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="text-sm font-medium">No approval needed</div>
            {/* The server's own sentence, verbatim — it names the threshold that
                was applied, which is a setting an admin can change. */}
            <p className="text-muted-foreground mt-0.5 text-sm">{approval.reason}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Approval needed"
      meta={`${approval.exceptions.length} ${approval.exceptions.length === 1 ? "exception" : "exceptions"}`}
      pad={false}
    >
      <div className="flex items-start gap-2.5 border-b px-4 py-3">
        <TriangleAlert
          className="mt-0.5 size-4 shrink-0 text-orange-600 dark:text-orange-400"
          aria-hidden="true"
        />
        <p className="text-sm">{approval.reason}</p>
      </div>

      {approval.exceptions.map((e, i) => (
        // Keyed by description AND index: two lines can legitimately carry the
        // same wording, and the exception list has no ids of its own.
        <div key={`${e.description}-${i}`} className="flex flex-col gap-1.5 border-b px-4 py-3 last:border-b-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 basis-48 text-sm font-medium">{e.description}</span>
            <PricingModeChip mode={e.mode} />
            {/* The authoritative deviation, computed server-side from the card
                and applied prices. The page never derives this itself. */}
            <span className="text-sm font-medium tabular-nums">{percent(e.deviationPct)}</span>
          </div>

          <span className="text-muted-foreground text-xs">{e.why}</span>

          {/* The reason IS the exception list's payload — it is the one thing an
              approver has to rule on. Its absence is stated loudly, because an
              unexplained deviation is the thing that should never reach them. */}
          {e.reason ? (
            <span className="text-sm italic">“{e.reason}”</span>
          ) : (
            <span className="text-destructive text-xs">
              No reason recorded — there is nothing here for an approver to judge.
            </span>
          )}
        </div>
      ))}
    </Card>
  );
}
