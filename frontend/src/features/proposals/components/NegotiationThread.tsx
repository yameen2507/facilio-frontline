/**
 * The negotiation thread — a CONVERSATION LOG, and visibly not a status change.
 *
 * Spec §5 R2: a client saying "do it for 40k" is a thing that happened, not a
 * state the proposal is in. A revision exists only when we deliberately
 * re-price. Without that split you get v7 where nothing changed, and a good part
 * of the measured rework is exactly that.
 *
 * So this reads as messages — speech bubbles, a name, a time, a composer at the
 * bottom — and never as a timeline of events. The Activity tab next door is the
 * timeline, and the two looking different is the whole design: one is what the
 * client said, the other is what the record did. Recording a counter-offer here
 * moves nothing, and the notice above the composer says so in words.
 */

import { useState } from "react";
import { MessageSquareQuote, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "../../../ui/Card";
import { Empty } from "../../../ui/States";
import { when } from "../../../lib/format";
import { addNegotiationEvent } from "../api/proposals-util";
import {
  NEGOTIATION_KINDS,
  NEGOTIATION_LABEL,
  canRecordNegotiation,
  type NegotiationKind,
  type Proposal,
} from "../types/proposal";

/** The tone each kind carries in the thread. A counter-offer and an objection
    are pressure; a question and a note are not, and colouring them the same
    would make every thread look like a crisis. */
const KIND_ACCENT: Record<NegotiationKind, string> = {
  counter_offer: "border-l-orange-500",
  objection: "border-l-red-500",
  scope_change_request: "border-l-blue-500",
  question: "border-l-border",
  client_note: "border-l-border",
};

export function NegotiationThread({
  proposal,
  actor,
  onAdded,
}: {
  proposal: Proposal;
  actor: string;
  onAdded: (proposal: Proposal) => void;
}) {
  const [kind, setKind] = useState<NegotiationKind>("counter_offer");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = canRecordNegotiation(proposal.status);
  const thread = proposal.negotiation ?? [];

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);

    const { data, error: err } = await addNegotiationEvent(proposal.id, kind, body.trim(), actor);
    setBusy(false);

    if (err || !data?.proposal) {
      // The server's message, verbatim. Until `event-add` is registered this is
      // where the seam shows itself, and that is the honest place for it.
      setError(err ?? "The note was not recorded");
      return;
    }

    setBody("");
    onAdded(data.proposal);
  };

  return (
    <Card
      title="Negotiation"
      meta={thread.length ? `${thread.length} on the thread` : undefined}
      pad={false}
    >
      {thread.length ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          {thread.map((e) => (
            <div
              key={e.id}
              className={cn(
                // A bubble with a coloured left edge: this is somebody talking,
                // not a row in a log.
                "bg-muted/40 rounded-lg border-l-2 px-3 py-2.5",
                KIND_ACCENT[e.kind as NegotiationKind] ?? "border-l-border"
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium">
                  {NEGOTIATION_LABEL[e.kind as NegotiationKind] ?? e.kind.replace(/_/g, " ")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {e.actor ? `${e.actor.split("@")[0]} · ` : ""}
                  {when(e.occurredAt)}
                </span>
              </div>
              {e.body ? <p className="mt-1 text-sm whitespace-pre-wrap">{e.body}</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title="Nothing on the thread"
          tight
          body="Counter-offers, questions and objections are recorded here as things that happened. None of them changes the proposal's state — only deliberately re-pricing does, and that is what raising a revision is for."
        />
      )}

      {open ? (
        <div className="flex flex-col gap-2.5 border-t px-4 py-3">
          {/* The load-bearing sentence. Without it, a composer under a proposal
              reads as an action that moves it. */}
          <div className="text-muted-foreground flex items-start gap-2 text-xs">
            <MessageSquareQuote className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>
              This records what was said. It does not change the price, the status or the version —
              re-pricing is a revision, and it is a separate decision.
            </span>
          </div>

          <div className="flex flex-wrap items-start gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as NegotiationKind)}>
              <SelectTrigger className="w-full sm:w-52" aria-label="What kind of message">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NEGOTIATION_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {NEGOTIATION_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What the client said, in their words where you have them"
          />

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div>
            <Button size="sm" onClick={submit} disabled={!body.trim() || busy}>
              <Send className="size-4" />
              {busy ? "Recording…" : "Record it"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground border-t px-4 py-3 text-xs">
          A thread opens once the proposal has been sent — and stays open if it is rejected or
          lapses, because that is usually where the conversation producing the next revision
          happens.
        </p>
      )}
    </Card>
  );
}
