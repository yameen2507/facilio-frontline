/**
 * Raise a proposal. Three questions, and only the first is mandatory.
 *
 * A proposal is raised AGAINST A DEAL — that is what carries the account, and
 * what the currency and the rate card are resolved for. The deal picker is
 * therefore the whole dialog; the title and the contract type are conveniences
 * the estimator can fix later on the record.
 *
 * THE SURVEY REVISION is the fourth question, and it only appears when there
 * is an answer to it. `create` accepts one, and having one is what lets
 * `line-generate` draft the lines from what the surveyor actually found —
 * without it the proposal is priced by hand, which is the C22 path the spec
 * also calls for, so this is a choice rather than a requirement.
 *
 * The picker offers only what `survey.revision-list` returns for the chosen
 * deal, which is completed surveys only. It stays hidden when that list is
 * empty: an empty menu reads as "something is broken here", where no menu at
 * all correctly says this deal has no frozen survey to price from yet.
 *
 * (This dialog used to say it deliberately asked no such question, because the
 * survey lane exposed no reader for it. That reader now exists.)
 */

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActor } from "../../../app/auth";
import {
  createProposal,
  listDeals,
  listSurveyRevisions,
  type DealOption,
  type SurveyRevisionOption,
} from "../api/proposals-util";

/** Spec §2.1 — the shape of the contract, which the document prints. */
const CONTRACT_TYPES = [
  { id: "comprehensive", label: "Comprehensive" },
  { id: "semi_comprehensive", label: "Semi-comprehensive" },
  { id: "non_comprehensive", label: "Non-comprehensive" },
];

export function NewProposalDialog({
  open,
  onOpenChange,
  initialDealId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselects the deal, for the `/proposals?new=<dealId>` deep link. */
  initialDealId?: string;
}) {
  const navigate = useNavigate();
  const actor = useActor();

  const [deals, setDeals] = useState<DealOption[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);
  const [dealsError, setDealsError] = useState<string | null>(null);

  const [dealId, setDealId] = useState(initialDealId ?? "");
  const [title, setTitle] = useState("");
  const [contractType, setContractType] = useState("");
  const [revisions, setRevisions] = useState<SurveyRevisionOption[]>([]);
  const [revisionId, setRevisionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetched when the dialog opens rather than with the list behind it: the
  // page costs one request, and this one is only paid by someone creating.
  useEffect(() => {
    if (!open) return;
    setDealId(initialDealId ?? "");
    setTitle("");
    setContractType("");
    setRevisionId("");
    setError(null);

    let live = true;
    setLoadingDeals(true);
    listDeals().then(({ data, error: err }) => {
      if (!live) return;
      setLoadingDeals(false);
      setDealsError(err);
      if (data) setDeals(data.deals);
    });
    return () => {
      live = false;
    };
  }, [open, initialDealId]);

  // Re-read whenever the deal changes: revisions belong to the deal, and
  // carrying the previous deal's choice forward would price this proposal from
  // a survey of somebody else's building.
  useEffect(() => {
    setRevisionId("");
    setRevisions([]);
    if (!open || !dealId) return;

    let live = true;
    listSurveyRevisions(dealId).then(({ data }) => {
      if (!live) return;
      // A failure here is deliberately quiet: the revision is optional, and a
      // red line under an optional control would read as a blocked create.
      if (data) setRevisions(data.revisions);
    });
    return () => {
      live = false;
    };
  }, [open, dealId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dealId || busy) return;
    setBusy(true);
    setError(null);

    const { data, error: err } = await createProposal(dealId, actor, {
      // Spread conditionally: a blank flat field is dropped upstream rather
      // than arriving as "", so sending an empty title is not the same as
      // sending nothing — see api/proposals-util.ts.
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(contractType ? { contractType } : {}),
      ...(revisionId ? { surveyRevisionId: revisionId } : {}),
    });

    setBusy(false);
    if (err || !data?.proposal) {
      setError(err ?? "The proposal was not created");
      return;
    }

    onOpenChange(false);
    navigate(`/proposals/${data.proposal.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New proposal</DialogTitle>
            <DialogDescription>
              Creating it resolves the rate card for the deal's region and client, and stamps the
              currency. Both are shown on the record, with the reason that card won.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-deal">Deal</Label>
              <Select value={dealId} onValueChange={setDealId}>
                <SelectTrigger id="np-deal" className="w-full">
                  <SelectValue placeholder={loadingDeals ? "Loading deals…" : "Pick a deal"} />
                </SelectTrigger>
                <SelectContent>
                  {deals.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.refNo} — {d.title ?? "Untitled deal"}
                      {d.accountName ? ` · ${d.accountName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* The deal reader's failure is shown here, verbatim, rather than
                  leaving an empty menu that reads as "there are no deals". */}
              {dealsError ? <p className="text-destructive text-xs">{dealsError}</p> : null}
              {!loadingDeals && !dealsError && !deals.length ? (
                <p className="text-muted-foreground text-xs">
                  No deals yet — a proposal is raised against one, so convert a lead first.
                </p>
              ) : null}
            </div>

            {revisions.length ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="np-revision">Price from a survey</Label>
                <Select value={revisionId} onValueChange={setRevisionId}>
                  <SelectTrigger id="np-revision" className="w-full">
                    <SelectValue placeholder="Price by hand instead" />
                  </SelectTrigger>
                  <SelectContent>
                    {revisions.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.surveyRefNo ?? "Survey"} v{r.revisionNo}
                        {r.surveyTitle ? ` — ${r.surveyTitle}` : ""}
                        {typeof r.completenessPct === "number" ? ` · ${r.completenessPct}%` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Picking one lets the lines be drafted from what the surveyor found. Leave it and
                  every line is priced by hand.
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-title">Title</Label>
              <Input
                id="np-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Defaults to the deal's title"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-contract">Contract type</Label>
              <Select value={contractType} onValueChange={setContractType}>
                <SelectTrigger id="np-contract" className="w-full">
                  <SelectValue placeholder="Set it later" />
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

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!dealId || busy}>
              {busy ? "Creating…" : "Create proposal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
