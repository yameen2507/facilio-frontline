/**
 * The live widget — what a visitor sees on the company website, driven by the
 * playground's config.
 *
 * The design constraint that shapes it: THERE IS NO SUBMIT BUTTON and no
 * "captured so far" panel. A visitor on a website does not press submit, and must
 * not be shown the extraction. The conversation IS the enquiry — the lead is
 * created the moment the agent has enough, without asking the visitor for anything.
 *
 * The agent is called from HERE, not from a handler: a function aborts at the ~10s
 * fetch timeout and a model turn is slower. The reply then travels to
 * `intake-turn`, which parses and stores it.
 *
 * The agent is stateless, so the whole conversation is resent on every turn.
 *
 * Config is applied live where that is honest (header, accent) and at
 * conversation start where it must be (the greeting — the agent has to see the
 * same first message the visitor saw, so an override cannot be patched into a
 * running transcript).
 */

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { errMessage } from "../../../lib/request";
import { vibe } from "../../../lib/vibe";
import { MSGS, MSG_AGENT, MSG_VISITOR } from "../../../ui/bubbles";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { ChatSkeleton } from "../../../ui/Skeleton";
import { useToast } from "../../../ui/Toast";
import { intakeStart, intakeSubmit, intakeTurn } from "../api/chat-util";
import type { WidgetConfig } from "../api/widget-config";

type Message = { role: "agent" | "visitor" | "system"; content: string };

type Session = {
  token: string;
  messages: Message[];
  missing: string[];
  leadRef: string | null;
};

/**
 * The LOGICAL agent name, not the flow-ai link name. The browser resolves an agent
 * by (app, name) from the request host; passing `intake_<appuuid>` here returns 404
 * — that form is only for the server-side ai-studio actions.
 */
const INTAKE_AGENT = "intake";

export function WidgetPreview({ config }: { config: WidgetConfig }) {
  const toast = useToast();

  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);

  const mounted = useRef(true);
  const scroller = useRef<HTMLDivElement | null>(null);
  // Guards the one-shot lead creation against a second turn racing it.
  const submitting = useRef(false);

  // The greeting override is read when a conversation STARTS; a ref keeps the
  // start closure seeing the latest config without restarting on every keystroke.
  const greeting = useRef(config.greeting);
  greeting.current = config.greeting;

  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const start = async () => {
    setSession(null);
    submitting.current = false;
    const { data, error } = await intakeStart();
    if (!mounted.current) return;
    if (error || !data) {
      toast(error ?? "Could not start the conversation", true);
      return;
    }
    setSession({
      token: data.sessionToken,
      messages: [{ role: "agent", content: greeting.current.trim() || data.greeting }],
      missing: ["companyName"],
      leadRef: null,
    });
  };

  // Opens a conversation on first view. The empty dependency list is deliberate:
  // `start` is redefined every render, so depending on it would restart the
  // conversation continuously. This must run once per mount.
  useEffect(() => {
    void start();
  }, []);

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.messages.length, thinking]);

  async function send() {
    const text = draft.trim();
    if (!text || !session || thinking) return;

    setDraft("");
    const withVisitor: Message[] = [...session.messages, { role: "visitor", content: text }];
    setSession({ ...session, messages: withVisitor });
    setThinking(true);

    try {
      const history = withVisitor
        .filter((m) => m.role !== "system")
        .map((m) => `${m.role === "agent" ? "AGENT" : "VISITOR"}: ${m.content}`)
        .join("\n");

      const reply = await vibe.executeAgent<{ response?: { content?: string } }>(
        INTAKE_AGENT,
        `CONVERSATION SO FAR:\n${history}\n\nReply to the visitor's last message.`
      );

      const turn = await intakeTurn(session.token, text, reply?.response?.content);
      if (!mounted.current) return;
      if (turn.error || !turn.data) {
        toast(turn.error ?? "The assistant did not respond", true);
        return;
      }

      const withAgent: Message[] = [...withVisitor, { role: "agent", content: turn.data.reply }];
      setSession({ ...session, messages: withAgent, missing: turn.data.missing });

      // Enough captured: create the lead silently. Guarded so a later turn cannot
      // create a second one.
      if (!session.leadRef && !submitting.current && turn.data.missing.length === 0) {
        submitting.current = true;
        const created = await intakeSubmit(session.token);
        if (!mounted.current) return;
        if (created.data) {
          setSession({
            ...session,
            messages: [
              ...withAgent,
              { role: "system", content: `Your enquiry is with our team — reference ${created.data.refNo}.` },
            ],
            missing: [],
            leadRef: created.data.refNo,
          });
        } else {
          // Let a later turn retry rather than losing the enquiry entirely.
          submitting.current = false;
          if (created.error) toast(created.error, true);
        }
      }
    } catch (err) {
      toast(errMessage(err, "The assistant could not be reached"), true);
    } finally {
      if (mounted.current) setThinking(false);
    }
  }

  // An inline override, not a class: the accent is arbitrary user input, and
  // white text is the widget convention for a brand-coloured bubble.
  const accentStyle = config.accent ? { background: config.accent, color: "#fff" } : undefined;

  return (
    <div className="mx-auto w-full max-w-[400px]">
      <Card pad={false} className="flex h-[68vh] min-h-[420px] flex-col">
        <div className="text-muted-foreground flex items-center gap-2 border-b px-4 py-2.5 text-xs">
          <Chip tone="blue">{config.siteLabel.trim() || "your-site.com"}</Chip>
          <span className="truncate">{config.introLine}</span>
        </div>

        {session ? (
          <div className={MSGS} ref={scroller}>
            {session.messages.map((m, i) =>
              m.role === "system" ? (
                <div
                  className="self-center rounded-full bg-green-100 px-4 py-1.5 text-center text-xs text-green-700 dark:bg-green-950 dark:text-green-400"
                  key={i}
                >
                  {m.content}
                </div>
              ) : (
                <div
                  className={m.role === "agent" ? MSG_AGENT : MSG_VISITOR}
                  style={m.role === "visitor" ? accentStyle : undefined}
                  key={i}
                >
                  {m.content}
                </div>
              )
            )}
            {thinking ? (
              <div className="flex gap-1 self-start px-4 py-2.5">
                <span className="bg-muted-foreground size-1.5 animate-bounce rounded-full" />
                <span className="bg-muted-foreground size-1.5 animate-bounce rounded-full [animation-delay:150ms]" />
                <span className="bg-muted-foreground size-1.5 animate-bounce rounded-full [animation-delay:300ms]" />
              </div>
            ) : null}
          </div>
        ) : (
          // The greeting is a round trip away, so the transcript area holds
          // bubble-shaped placeholders rather than the word "Starting…".
          <ChatSkeleton />
        )}

        <div className="flex gap-2 border-t p-4">
          <Input
            type="text"
            className="flex-1 rounded-full"
            placeholder="Type your message…"
            autoComplete="off"
            value={draft}
            disabled={!session}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
            aria-label="Your message"
          />
          <Button variant="primary" onClick={() => void send()} disabled={!session || thinking}>
            Send
          </Button>
        </div>
      </Card>

      {/* Stacked, not a row: the widget is 400px wide and the note beside the
          button broke into three ragged lines against it. The note stays above
          the control it qualifies. */}
      <div className="text-muted-foreground mt-3 flex flex-col items-center gap-2 text-center text-xs">
        <span>The assistant never quotes a price — a surveyor confirms that on site.</span>
        <Button small onClick={() => void start()}>
          Start a new conversation
        </Button>
      </div>
    </div>
  );
}
