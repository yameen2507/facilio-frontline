/**
 * What a visitor sees on the company website.
 *
 * The design constraint that shapes this page: THERE IS NO SUBMIT BUTTON and no
 * "captured so far" panel. A visitor on a website does not press submit, and must
 * not be shown the extraction. The conversation IS the enquiry — the lead is
 * created the moment the agent has enough, without asking the visitor for anything.
 *
 * The agent is called from HERE, not from a handler: a function aborts at the ~10s
 * fetch timeout and a model turn is slower. The reply then travels to
 * `intake-turn`, which parses and stores it.
 *
 * The agent is stateless, so the whole conversation is resent on every turn.
 */

import { useEffect, useRef, useState } from "react";
import { PageShell } from "../../../app/shell/PageShell";
import { errMessage } from "../../../lib/request";
import { vibe } from "../../../lib/vibe";
import { Button } from "../../../ui/Button";
import { Chip } from "../../../ui/Chip";
import { ChatSkeleton } from "../../../ui/Skeleton";
import { useToast } from "../../../ui/Toast";
import { intakeStart, intakeSubmit, intakeTurn } from "../api/chat-util";

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

export function Chat() {
  const toast = useToast();

  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);

  const mounted = useRef(true);
  const scroller = useRef<HTMLDivElement | null>(null);
  // Guards the one-shot lead creation against a second turn racing it.
  const submitting = useRef(false);

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
      messages: [{ role: "agent", content: data.greeting }],
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

  return (
    <PageShell title="Website chat" subtitle="What a visitor sees on the company site">
      <div className="chat-shell">
        <div className="card chat">
          <div className="site">
            <Chip tone="blue">albaytgrill.ae</Chip>
            <span>Chat with us — commercial kitchen extract cleaning</span>
          </div>

          {session ? (
            <div className="msgs" ref={scroller}>
              {session.messages.map((m, i) =>
                m.role === "system" ? (
                  <div className="sys" key={i}>
                    {m.content}
                  </div>
                ) : (
                  <div className={`msg ${m.role === "agent" ? "a" : "v"}`} key={i}>
                    {m.content}
                  </div>
                )
              )}
              {thinking ? (
                <div className="typing">
                  <i />
                  <i />
                  <i />
                </div>
              ) : null}
            </div>
          ) : (
            // The greeting is a round trip away, so the transcript area holds
            // bubble-shaped placeholders rather than the word "Starting…".
            <ChatSkeleton />
          )}

          <div className="composer">
            <input
              type="text"
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
        </div>

        <div className="chat-foot">
          <span>The assistant never quotes a price — a surveyor confirms that on site.</span>
          <Button small onClick={() => void start()}>
            Start a new conversation
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
