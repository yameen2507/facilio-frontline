/**
 * The website conversation that produced this lead.
 *
 * It belongs HERE — internal, where it is useful — rather than in front of the
 * visitor who just had it.
 *
 * Owns its own request, which is the point: it is a second round trip, and if the
 * page waited for it the whole lead view would be a second slower. While it is in
 * flight the slot holds a skeleton card, so the right-hand column does not lurch
 * downward when the transcript lands.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { MSG_AGENT, MSG_VISITOR, MSGS } from "../../../ui/bubbles";
import { Card } from "../../../ui/Card";
import { TranscriptSkeleton } from "../../../ui/Skeleton";
import { getTranscript } from "../api/leads-util";
import type { TranscriptMessage } from "../types/lead";

export function TranscriptCard({ token }: { token: string }) {
  const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let live = true;
    setMessages(null);
    setUnavailable(false);

    getTranscript(token).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) {
        setUnavailable(true);
        return;
      }
      setMessages(data.messages);
    });

    return () => {
      live = false;
    };
  }, [token]);

  // A missing transcript is not a page failure — the lead is entirely usable
  // without it — so the slot disappears rather than showing an error the reader
  // can do nothing about.
  if (unavailable) return null;

  if (!messages) return <TranscriptSkeleton />;

  return (
    <Card title="Website conversation" meta={`${messages.length} messages`}>
      {/* The card body already pads, so the column drops its own gutter — MSGS
          carries the chat page's — and caps its height instead of filling one. */}
      <div className={cn(MSGS, "max-h-[340px] overflow-y-auto p-0")}>
        {messages.map((m, i) => (
          <div className={m.role === "agent" ? MSG_AGENT : MSG_VISITOR} key={i}>
            {m.content}
          </div>
        ))}
      </div>
    </Card>
  );
}
