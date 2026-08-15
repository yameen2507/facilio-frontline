/**
 * The live widget — what a visitor sees on the company website, driven by the
 * page's draft config. Styled as GLASS: translucent panels blurring whatever
 * the host page puts behind them, which is what makes an embedded widget feel
 * native to someone else's site rather than a pasted-on box. (That is also why
 * the surfaces here wear white-alpha literals instead of console theme tokens
 * — every one carries its dark: pair.)
 *
 * The design constraint that shapes it: THERE IS NO SUBMIT BUTTON and no
 * "captured so far" panel. A visitor on a website does not press submit, and must
 * not be shown the extraction. The conversation IS the enquiry — the lead is
 * created the moment the agent has enough, without asking the visitor for anything.
 *
 * The agent is called from HERE, not from a handler: a function aborts at the ~10s
 * fetch timeout and a model turn is slower. The reply then travels to
 * `intake-turn`, which parses and stores it. The agent is stateless, so the whole
 * conversation is resent on every turn — with the operator's `guidance` in front,
 * which is how a published instruction reaches an agent whose own instructions
 * are fixed at creation.
 *
 * Config is applied live where that is honest (branding, accent) and at
 * conversation start where it must be (the greeting — the agent has to see the
 * same first message the visitor saw, so an override cannot be patched into a
 * running transcript).
 */

import { useEffect, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { errMessage } from "../../../lib/request";
import { vibe } from "../../../lib/vibe";
import { MSG, MSGS, MSG_VISITOR } from "../../../ui/bubbles";
import { Button } from "../../../ui/Button";
import { ChatSkeleton } from "../../../ui/Skeleton";
import { useToast } from "../../../ui/Toast";
import { intakeStart, intakeSubmit, intakeTurn } from "../api/chat-util";
import type { WidgetConfig } from "../api/widget-config";

type Message = { role: "agent" | "visitor" | "system"; content: string };

type Session = {
  token: string;
  messages: Message[];
  leadRef: string | null;
};

/**
 * The LOGICAL agent name, not the flow-ai link name. The browser resolves an agent
 * by (app, name) from the request host; passing `intake_<appuuid>` here returns 404
 * — that form is only for the server-side ai-studio actions.
 */
const INTAKE_AGENT = "intake";

/** The glass recipe, shared with the loading placeholder so the real widget
    lands on exactly the surface the skeleton held. Edges are BLACK-alpha in
    light and WHITE-alpha in dark — a white/50 border on a white page is no
    border at all, which made the whole widget wash out in light mode. */
export const GLASS_PANEL =
  "border-black/10 bg-white/60 shadow-xl shadow-black/5 backdrop-blur-2xl " +
  "dark:border-white/10 dark:bg-white/[0.08]";

/** The widget's outer seat and its panel geometry — exported beside the glass
    recipe for the same reason: the skeleton must hold the identical frame. */
export const WIDGET_WRAP = "relative mx-auto w-full max-w-[400px]";
/** Taller on lg, where the canvas fills the viewport and centres it — the
    60vh phone height floated in that frame with too much air around it. */
export const WIDGET_FRAME =
  "flex h-[60vh] max-h-[620px] min-h-[420px] flex-col overflow-hidden rounded-2xl border lg:h-[66vh] lg:max-h-[720px]";

/** EMBEDDED geometry — the widget as the whole of a host page's iframe.
    The console sizes the widget inside a page that has other things in it; an
    embed does not. There the IFRAME is what carries the width and the rounded
    corner, so the wrap gives up its max-width and the frame takes the full
    height it is given. Keeping `60vh` here would have been wrong twice over:
    inside a 600px frame it clamps to the 420px minimum and then overflows. */
export const WIDGET_FILL_WRAP = "relative h-full w-full";
export const WIDGET_FILL_FRAME = "flex h-full flex-col overflow-hidden rounded-2xl border";

/** Inner glass edges (header, composer, bubbles) — same light/dark logic as
    the panel border, one step softer. */
const GLASS_EDGE = "border-black/10 dark:border-white/10";

/** The agent's bubble — a lighter pane of the same glass, anchored left.
    Geometry comes from bubbles.ts so it matches ChatSkeleton by construction. */
const MSG_AGENT_GLASS = `${MSG} self-start rounded-bl-sm border shadow-sm shadow-black/5 backdrop-blur-md ${GLASS_EDGE} bg-white/70 dark:bg-white/10`;

const HEADER_ROW = "flex items-center gap-3 border-b px-4 py-3";
const COMPOSER_ROW = "flex items-center gap-2 border-t p-3";

/**
 * `embedded` is the same widget on a REAL host page rather than in the console.
 * Two things change and both are about audience: it fills the frame it was
 * given (see WIDGET_FILL_*), and it drops the footer — the price disclaimer and
 * "Start a new conversation" are an operator's reassurances while they test,
 * and a visitor who is handed a restart button treats the conversation as
 * disposable.
 */
export function WidgetPreview({ config, embedded = false }: { config: WidgetConfig; embedded?: boolean }) {
  const toast = useToast();

  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);

  const mounted = useRef(true);
  const scroller = useRef<HTMLDivElement | null>(null);
  // Guards the one-shot lead creation against a second turn racing it.
  const submitting = useRef(false);
  // Bumped by every restart. A turn that was in flight when the conversation
  // was restarted must NOT land its result: its closure holds the old session,
  // and writing it back would resurrect the dead token over the new one.
  const generation = useRef(0);

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

  /** True when an awaited result belongs to a conversation that is gone —
      the component unmounted, or someone started a new chat meanwhile. */
  const stale = (gen: number) => !mounted.current || gen !== generation.current;

  const start = async () => {
    const gen = ++generation.current;
    setSession(null);
    setThinking(false);
    submitting.current = false;
    const { data, error } = await intakeStart();
    if (stale(gen)) return;
    if (error || !data) {
      toast(error ?? "Could not start the conversation", true);
      return;
    }
    setSession({
      token: data.sessionToken,
      messages: [{ role: "agent", content: greeting.current.trim() || data.greeting }],
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
    const gen = generation.current;

    setDraft("");
    const withVisitor: Message[] = [...session.messages, { role: "visitor", content: text }];
    setSession({ ...session, messages: withVisitor });
    setThinking(true);

    try {
      const history = withVisitor
        .filter((m) => m.role !== "system")
        .map((m) => `${m.role === "agent" ? "AGENT" : "VISITOR"}: ${m.content}`)
        .join("\n");

      // The published guidance leads the prompt — the one channel an operator
      // has into an agent whose own instructions are fixed at creation.
      const guidance = config.guidance.trim();
      const reply = await vibe.executeAgent<{ response?: { content?: string } }>(
        INTAKE_AGENT,
        `${guidance ? `OPERATOR GUIDANCE — follow this in every reply:\n${guidance}\n\n` : ""}` +
          `CONVERSATION SO FAR:\n${history}\n\nReply to the visitor's last message.`
      );
      if (stale(gen)) return;

      const turn = await intakeTurn(session.token, text, reply?.response?.content);
      if (stale(gen)) return;
      if (turn.error || !turn.data) {
        toast(turn.error ?? "The assistant did not respond", true);
        return;
      }

      const withAgent: Message[] = [...withVisitor, { role: "agent", content: turn.data.reply }];
      setSession({ ...session, messages: withAgent });

      // Enough captured: create the lead silently. Guarded so a later turn cannot
      // create a second one.
      if (!session.leadRef && !submitting.current && turn.data.missing.length === 0) {
        submitting.current = true;
        const created = await intakeSubmit(session.token);
        if (stale(gen)) return;
        if (created.data) {
          setSession({
            ...session,
            messages: [
              ...withAgent,
              { role: "system", content: `Your enquiry is with our team — reference ${created.data.refNo}.` },
            ],
            leadRef: created.data.refNo,
          });
        } else {
          // Let a later turn retry rather than losing the enquiry entirely.
          submitting.current = false;
          if (created.error) toast(created.error, true);
        }
      }
    } catch (err) {
      if (!stale(gen)) toast(errMessage(err, "The assistant could not be reached"), true);
    } finally {
      if (!stale(gen)) setThinking(false);
    }
  }

  // Inline overrides, not classes: the accent is picked at runtime, and white
  // text is the widget convention for a brand-coloured surface.
  const accentFill = config.accent ? { background: config.accent, color: "#fff" } : undefined;
  const companyName = config.companyName.trim() || "Your company";
  const initial = (companyName[0] ?? "•").toUpperCase();

  return (
    <div className={embedded ? WIDGET_FILL_WRAP : WIDGET_WRAP}>
      <div className={cn(embedded ? WIDGET_FILL_FRAME : WIDGET_FRAME, GLASS_PANEL)}>
        {/* The brand header: logo (or initial), name, the online dot + tagline. */}
        <div className={cn(HEADER_ROW, GLASS_EDGE)}>
          {config.logo ? (
            <img src={config.logo} alt="" className={cn("size-9 shrink-0 rounded-full border object-cover", GLASS_EDGE)} />
          ) : (
            <div
              aria-hidden="true"
              className="bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold"
              style={accentFill}
            >
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{companyName}</div>
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span className="size-1.5 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
              <span className="truncate">{config.tagline.trim() || "We're online"}</span>
            </div>
          </div>
        </div>

        {session ? (
          // role="log": replies arrive on their own schedule, so assistive tech
          // is told about them the way the Toast and AI panels already do.
          <div className={MSGS} ref={scroller} role="log" aria-live="polite">
            {session.messages.map((m, i) =>
              m.role === "system" ? (
                <div
                  className="self-center rounded-full border border-green-500/25 bg-green-500/15 px-4 py-1.5 text-center text-xs text-green-700 backdrop-blur-md dark:text-green-300"
                  key={i}
                >
                  {m.content}
                </div>
              ) : (
                <div
                  className={m.role === "agent" ? MSG_AGENT_GLASS : MSG_VISITOR}
                  style={m.role === "visitor" ? accentFill : undefined}
                  key={i}
                >
                  {m.content}
                </div>
              )
            )}
            {thinking ? (
              <div className={cn(MSG_AGENT_GLASS, "flex gap-1")} aria-label="The assistant is replying">
                <span className="bg-muted-foreground size-1.5 rounded-full motion-safe:animate-bounce" />
                <span className="bg-muted-foreground size-1.5 rounded-full motion-safe:animate-bounce [animation-delay:150ms]" />
                <span className="bg-muted-foreground size-1.5 rounded-full motion-safe:animate-bounce [animation-delay:300ms]" />
              </div>
            ) : null}
          </div>
        ) : (
          // The greeting is a round trip away, so the transcript area holds
          // bubble-shaped placeholders rather than the word "Starting…".
          <ChatSkeleton />
        )}

        {/* The composer — a glass field and a round brand-coloured send. */}
        <div className={cn(COMPOSER_ROW, GLASS_EDGE)}>
          <input
            type="text"
            className={cn(
              "placeholder:text-muted-foreground/70 h-10 min-w-0 flex-1 rounded-full border px-4 text-sm outline-none backdrop-blur-md",
              "focus-visible:border-black/25 dark:focus-visible:border-white/25",
              GLASS_EDGE,
              "bg-white/60 dark:bg-white/10"
            )}
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
          <button
            type="button"
            onClick={() => void send()}
            disabled={!session || thinking}
            aria-label="Send"
            className="bg-primary text-primary-foreground grid size-10 shrink-0 cursor-pointer place-items-center rounded-full transition-opacity disabled:opacity-50 motion-reduce:transition-none"
            style={accentFill}
          >
            <SendHorizontal className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Stacked, not a row: the widget is 400px wide and the note beside the
          button broke into three ragged lines against it. The note stays above
          the control it qualifies. */}
      {embedded ? null : (
        <div className="text-muted-foreground mt-3 flex flex-col items-center gap-2 text-center text-xs">
          <span>The assistant never quotes a price — a surveyor confirms that on site.</span>
          <Button small onClick={() => void start()}>
            Start a new conversation
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The widget before its config has loaded — the SAME frame, header row and
 * composer the real one renders (skeleton rule 1: reuse the real structure),
 * so nothing drops when the config lands and WidgetPreview takes over.
 */
export function WidgetSkeleton({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className={embedded ? WIDGET_FILL_WRAP : WIDGET_WRAP} aria-busy="true" aria-label="Loading widget">
      <div className={cn(embedded ? WIDGET_FILL_FRAME : WIDGET_FRAME, GLASS_PANEL)} aria-hidden="true">
        <div className={cn(HEADER_ROW, GLASS_EDGE)}>
          <Skeleton className="bg-border size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="bg-border h-[0.72em] w-32 rounded-sm text-sm" />
            <Skeleton className="bg-border mt-1.5 h-[0.72em] w-44 rounded-sm text-xs" />
          </div>
        </div>
        <ChatSkeleton />
        <div className={cn(COMPOSER_ROW, GLASS_EDGE)}>
          <Skeleton className="bg-border h-10 min-w-0 flex-1 rounded-full" />
          <Skeleton className="bg-border size-10 shrink-0 rounded-full" />
        </div>
      </div>
    </div>
  );
}
