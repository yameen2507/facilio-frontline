/**
 * The commercial shape — validity, payment terms, the programme, the contract
 * type and its liability threshold.
 *
 * These are the fields that print on the document but never touch the pricing
 * arithmetic, which is why they live in their own card rather than beside the
 * lines. The one with teeth is VALIDITY: expiry is computed at read time from
 * `valid_until` and never by a job, so a proposal with no date set can never
 * expire and will never appear on anyone's chase list.
 *
 * Editing is inline rather than a dialog: this is five fields on a record the
 * estimator already has open, and a modal to change a payment term is a modal
 * for its own sake. It goes through `update`, which is draft-only server-side —
 * after send the shape is frozen with everything else, and a change means a new
 * revision.
 */

import { useState } from "react";
import { SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "../../../ui/Card";
import { Facts } from "../../../ui/Facts";
import { DateField } from "../../../ui/DateField";
import { humanise, onDay } from "../../../lib/format";
import { updateProposal } from "../api/proposals-util";
import { money, moneyInput, parseMoney } from "../money";
import { ExpiryChip } from "./ProposalChips";
import { isLineEditable, type Proposal } from "../types/proposal";

const CONTRACT_TYPES = [
  { id: "comprehensive", label: "Comprehensive" },
  { id: "semi_comprehensive", label: "Semi-comprehensive" },
  { id: "non_comprehensive", label: "Non-comprehensive" },
];

export function TermsCard({
  proposal,
  actor,
  onSaved,
}: {
  proposal: Proposal;
  actor: string;
  onSaved: (proposal: Proposal) => void;
}) {
  const editable = isLineEditable(proposal.status);

  const [editing, setEditing] = useState(false);
  const [validUntil, setValidUntil] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [expectedProgramme, setExpectedProgramme] = useState("");
  const [contractType, setContractType] = useState("");
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    // Seeded from the record each time it opens, so a cancelled edit leaves
    // nothing behind and a reload never fights a stale form.
    setValidUntil(proposal.validUntil ? String(proposal.validUntil).slice(0, 10) : "");
    setPaymentTerms(proposal.paymentTerms ?? "");
    setExpectedProgramme(proposal.expectedProgramme ?? "");
    setContractType(String(proposal.contractType ?? ""));
    setThreshold(moneyInput(proposal.liabilityThresholdAmount));
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);

    // Every field is sent, including the empty ones — this form CLEARS as well
    // as sets, and only the payload envelope can carry an empty value at all
    // (a blank flat field is dropped upstream rather than arriving as "").
    const { data, error: err } = await updateProposal(proposal.id, actor, {
      validUntil,
      paymentTerms,
      expectedProgramme,
      contractType,
      liabilityThresholdAmount: parseMoney(threshold),
    });

    setBusy(false);
    if (err || !data?.proposal) {
      setError(err ?? "The terms were not saved");
      return;
    }
    setEditing(false);
    onSaved(data.proposal);
  };

  if (editing) {
    return (
      <Card title="Commercial terms">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="tc-valid">Valid until</Label>
              <DateField id="tc-valid" value={validUntil} onChange={setValidUntil} />
              <span className="text-muted-foreground text-xs">
                With no date the offer never lapses, and never reaches a chase list.
              </span>
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="tc-contract">Contract type</Label>
              <Select value={contractType} onValueChange={setContractType}>
                <SelectTrigger id="tc-contract" className="w-full">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Only semi-comprehensive carries one, and it PRINTS on the document
              (C14) — it is the number that says where our liability stops. */}
          {contractType === "semi_comprehensive" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tc-threshold">Liability threshold</Label>
              <Input
                id="tc-threshold"
                inputMode="decimal"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder={`${proposal.currency ?? "AED"} 0.00`}
              />
              <span className="text-muted-foreground text-xs">
                Prints on the proposal — repairs above this are quoted separately.
              </span>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tc-payment">Payment terms</Label>
            <Input
              id="tc-payment"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="30 days from invoice"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tc-programme">Expected programme</Label>
            <Textarea
              id="tc-programme"
              rows={2}
              value={expectedProgramme}
              onChange={(e) => setExpectedProgramme(e.target.value)}
              placeholder="Mobilisation within two weeks of acceptance"
            />
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save terms"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Commercial terms"
      meta={
        editable ? (
          <Button size="sm" variant="ghost" onClick={open}>
            <SquarePen className="size-3.5" />
            Edit
          </Button>
        ) : (
          "Frozen"
        )
      }
    >
      <Facts
        items={[
          {
            label: "Valid until",
            value: proposal.validUntil ? (
              <span className="flex flex-wrap items-center gap-2">
                {onDay(proposal.validUntil)}
                <ExpiryChip days={proposal.daysToExpiry} />
              </span>
            ) : (
              "Not set — this offer never lapses"
            ),
          },
          {
            label: "Contract type",
            value: proposal.contractType ? humanise(String(proposal.contractType)) : null,
          },
          {
            label: "Liability threshold",
            value:
              proposal.contractType === "semi_comprehensive"
                ? money(proposal.liabilityThresholdAmount, proposal.currency)
                : null,
          },
          { label: "Payment terms", value: proposal.paymentTerms },
          { label: "Programme", value: proposal.expectedProgramme },
          { label: "Currency", value: proposal.currency },
        ]}
      />
    </Card>
  );
}
