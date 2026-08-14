/**
 * The web-chat intake channel.
 *
 * The model call happens in the BROWSER, not here — a function aborts at the
 * ~10s fetch timeout, and a conversational turn needs a model. So the browser
 * calls `vibe.executeAgent`, and these handlers persist the turn and accumulate
 * what has been extracted. That also means the extracted fields are
 * client-asserted: acceptable for a lead form (the visitor is describing their
 * own kitchen either way) and every lead still lands in a human queue, but the
 * agent's output must never be trusted for anything privileged.
 *
 * Sessions are addressed by an unguessable token rather than by id, so the same
 * handlers work unchanged when the app is made public.
 */

import { many, mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";
import { createLead, type CreateLeadResult } from "./lead";
import { getSetting, setSetting } from "./settings";

/** A public chat is a spend-attack surface — every turn is a model call. */
const MAX_TURNS = 30;

const GREETING =
  "Hello — I can help with kitchen extract and ductwork cleaning. What do you need looking at?";

// --- widget presentation ------------------------------------------------------

/**
 * The widget's presentation and per-turn agent guidance, stored as ONE setting
 * row. It used to live in the browser's localStorage, which could only ever
 * style the playground — the embed on the company site has to read the same
 * values this console publishes, so the server owns them now.
 *
 * Everything here ships to the VISITOR'S browser (the agent runs client-side,
 * so even `guidance` travels with the page). Nothing secret can live in it.
 */
export const WIDGET_SETTING = "widget.config";

export interface WidgetSettings {
  /** Shown in the widget header. */
  companyName: string;
  /** The line under the company name. */
  tagline: string;
  /** A small data-URL image; empty shows the company initial instead. */
  logo: string;
  /** A hex like #2563eb from the console's swatch row; empty follows the theme. */
  accent: string;
  /** First agent message; empty uses the shipped greeting. */
  greeting: string;
  /** Operator instructions the intake agent is handed on every turn. */
  guidance: string;
}

export const WIDGET_DEFAULTS: WidgetSettings = {
  companyName: "Frontline",
  tagline: "Kitchen extract & ductwork cleaning",
  logo: "",
  accent: "",
  greeting: "",
  guidance: "",
};

const WIDGET_KEYS = Object.keys(WIDGET_DEFAULTS) as (keyof WidgetSettings)[];

/** Longest value each field accepts — the logo cap (~120KB of image) is what
    keeps one settings row from growing past what a handler round-trip carries. */
const WIDGET_LIMITS: Record<keyof WidgetSettings, number> = {
  companyName: 80,
  tagline: 140,
  logo: 160_000,
  accent: 7,
  greeting: 400,
  guidance: 2000,
};

export function widgetSettings(): WidgetSettings {
  const raw = getSetting<unknown>(WIDGET_SETTING, null);
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  // Field by field over the defaults, so a key added later is never undefined
  // for a row saved under the older shape.
  const out = { ...WIDGET_DEFAULTS };
  for (const key of WIDGET_KEYS) {
    const v = stored[key];
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

/**
 * Merge a partial update over what is stored. `""` clears a field back to its
 * fallback behaviour (theme accent, shipped greeting, initial-only logo);
 * an absent key leaves the stored value alone.
 */
export function saveWidgetSettings(patch: Record<string, unknown>): WidgetSettings {
  const next = widgetSettings();

  for (const key of WIDGET_KEYS) {
    const v = patch[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") throw new Error(`${key} must be a string`);

    const value = v.trim();
    if (value.length > WIDGET_LIMITS[key]) {
      throw new Error(
        key === "logo"
          ? "the logo image is too large — use one under ~100KB"
          : `${key} must be ${WIDGET_LIMITS[key]} characters or fewer`
      );
    }
    if (key === "accent" && value && !/^#[0-9a-f]{6}$/i.test(value)) {
      throw new Error("accent must be a hex colour like #2563eb");
    }
    if (key === "logo" && value && !value.startsWith("data:image/")) {
      throw new Error("logo must be a data:image/… URL");
    }
    next[key] = value;
  }

  setSetting(WIDGET_SETTING, next);
  return next;
}

export interface IntakeSession {
  id: string;
  sessionToken: string;
  status: string;
  turnCount: number;
  leadId: string | null;
  extracted: Record<string, unknown> | null;
  sourceUrl: string | null;
}

/** Fields the agent may contribute. Anything else it invents is ignored. */
const EXTRACTABLE = [
  "companyName",
  "contactName",
  "contactEmail",
  "contactPhone",
  "serviceType",
  "siteCity",
  "description",
] as const;

function sessionByToken(token: string): IntakeSession {
  const row = one<IntakeSession>(
    `select id, session_token, status, turn_count, lead_id, extracted_json, source_url
       from fl_intake_session where session_token = $1 limit 1`,
    [token]
  );
  if (!row) throw new Error("session not found");
  return row;
}

export function startSession(input: { sourceUrl?: string | null; userAgent?: string | null }): {
  sessionToken: string;
  greeting: string;
} {
  const now = nowIso();

  // The published greeting, resolved HERE so the transcript stores the words
  // the visitor actually saw — a client-side override could drift from what a
  // later reader of fl_intake_message believes opened the conversation.
  const greeting = widgetSettings().greeting.trim() || GREETING;

  // Token from Postgres, never Math.random() — the sandbox has no crypto, and a
  // guessable token would let anyone read another visitor's conversation.
  const row = one<{ sessionToken: string }>(
    `insert into fl_intake_session
       (id, session_token, source_url, ip_hash, user_agent, turn_count, status,
        lead_id, extracted_json, last_seen_at, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, gen_random_uuid()::text, $1, null, $2, 0, 'active',
             null, '{}', $3, '{}', $3, $3)
     returning session_token`,
    [input.sourceUrl ?? null, input.userAgent ?? null, now]
  );
  if (!row) throw new Error("could not start a session");

  mutate(
    `insert into fl_intake_message
       (id, session_id, role, content, turn_index, data_json, created_at, updated_at)
     select gen_random_uuid()::text, id, 'agent', $2, 0, '{}', $3, $3
       from fl_intake_session where session_token = $1`,
    [row.sessionToken, greeting, now]
  );

  return { sessionToken: row.sessionToken, greeting };
}

export interface TurnResult {
  turnCount: number;
  reply: string;
  complete: boolean;
  extracted: Record<string, unknown>;
  missing: string[];
}

/**
 * Record one exchange. `reply` and the extracted fields come from the agent call
 * the browser already made.
 */
export function recordTurn(input: {
  sessionToken: string;
  message: string;
  agentReply: unknown;
}): TurnResult {
  const session = sessionByToken(input.sessionToken);

  if (session.status === "blocked") throw new Error("this conversation was closed");
  if (session.turnCount >= MAX_TURNS) {
    mutate("update fl_intake_session set status = 'blocked', updated_at = $2 where id = $1", [
      session.id,
      nowIso(),
    ]);
    throw new Error("conversation limit reached — someone will be in touch");
  }

  const parsed = coerceReply(input.agentReply);
  const now = nowIso();
  const turn = session.turnCount + 1;

  // Two rows in one statement so a turn can never be half-recorded.
  mutate(
    `insert into fl_intake_message
       (id, session_id, role, content, turn_index, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, 'visitor', $2, $3, '{}', $5, $5),
            (gen_random_uuid()::text, $1, 'agent', $4, $3, '{}', $5, $5)`,
    [session.id, input.message, turn, parsed.reply, now]
  );

  // Later turns win: the agent repeats everything it knows each time, so this
  // accumulates rather than overwrites when a field stops being mentioned.
  const extracted = { ...(session.extracted ?? {}), ...parsed.fields };

  mutate(
    `update fl_intake_session
        set turn_count = $2, extracted_json = $3, last_seen_at = $4, updated_at = $4
      where id = $1`,
    [session.id, turn, JSON.stringify(extracted), now]
  );

  return {
    turnCount: turn,
    reply: parsed.reply,
    complete: parsed.complete,
    extracted,
    missing: missingFields(extracted),
  };
}

/** Which of the four required details are still unknown. */
export function missingFields(extracted: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!extracted.companyName) missing.push("companyName");
  if (!extracted.contactEmail && !extracted.contactPhone) missing.push("contactEmail or contactPhone");
  if (!extracted.serviceType) missing.push("serviceType");
  if (!extracted.siteCity) missing.push("siteCity");
  return missing;
}

/**
 * A structured-output agent returns JSON as a *string*, and models sometimes
 * wrap it in prose or a fence. Nulls mean "not said" and are dropped rather than
 * stored, so a later turn cannot blank a known value.
 */
function coerceReply(raw: unknown): {
  reply: string;
  complete: boolean;
  fields: Record<string, unknown>;
} {
  let obj: Record<string, unknown> = {};

  if (typeof raw === "string") {
    obj = tolerantJson(raw);
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }

  const fields: Record<string, unknown> = {};
  for (const key of EXTRACTABLE) {
    const value = obj[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string" && value.trim() === "") continue;
    fields[key] = typeof value === "string" ? value.trim() : value;
  }

  const complete = obj.complete === true || obj.complete === "true";
  const reply =
    typeof obj.reply === "string" && obj.reply.trim()
      ? obj.reply.trim()
      : "Thanks — could you tell me a little more?";

  return { reply, complete, fields };
}

function tolerantJson(text: string): Record<string, unknown> {
  const attempts = [text];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) attempts.push(fenced[1]);

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) attempts.push(text.slice(start, end + 1));

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try the next shape
    }
  }

  // No JSON at all — treat the whole thing as the reply so the chat still works.
  return { reply: text };
}

export interface TranscriptEntry {
  role: string;
  content: string;
  turnIndex: number;
  createdAt: string;
}

export function transcript(sessionToken: string): {
  session: IntakeSession;
  messages: TranscriptEntry[];
  missing: string[];
} {
  const session = sessionByToken(sessionToken);
  const messages = many<TranscriptEntry>(
    `select role, content, turn_index, created_at
       from fl_intake_message where session_id = $1
      order by turn_index, created_at limit 200`,
    [session.id]
  );
  return { session, messages, missing: missingFields(session.extracted ?? {}) };
}

/**
 * Turn the conversation into a lead. Idempotent — a session that already
 * produced one returns the same lead rather than creating a second.
 */
export function submitSession(sessionToken: string): CreateLeadResult & { sessionToken: string } {
  const session = sessionByToken(sessionToken);
  const extracted = session.extracted ?? {};

  if (session.leadId) {
    const existing = one<{ refNo: string; status: string }>(
      "select ref_no, status from fl_lead where id = $1 limit 1",
      [session.leadId]
    );
    return {
      sessionToken,
      leadId: session.leadId,
      refNo: existing?.refNo ?? "",
      status: (existing?.status ?? "new") as CreateLeadResult["status"],
      duplicateOf: null,
    };
  }

  const companyName = typeof extracted.companyName === "string" ? extracted.companyName.trim() : "";
  if (!companyName) throw new Error("a business name is needed before this can be submitted");

  const str = (key: string): string | null => {
    const v = extracted[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  const result = createLead({
    source: "widget",
    sourceDetail: "web chat",
    companyName,
    contactName: str("contactName"),
    contactEmail: str("contactEmail"),
    contactPhone: str("contactPhone"),
    serviceType: str("serviceType"),
    siteCity: str("siteCity"),
    siteRegion: str("siteCity"),
    description: str("description"),
    actor: "web chat",
    extra: { intakeSessionToken: sessionToken, sourceUrl: session.sourceUrl ?? null },
  });

  const now = nowIso();
  mutate(
    `update fl_intake_session
        set lead_id = $2, status = 'completed', updated_at = $3
      where id = $1`,
    [session.id, result.leadId, now]
  );

  appendEvent({
    entityType: "lead",
    entityId: result.leadId,
    kind: "intake.submitted",
    actor: "web chat",
    body: `Captured from the website chat after ${session.turnCount} exchanges`,
    meta: { sessionToken, turnCount: session.turnCount },
  });

  return { ...result, sessionToken };
}
