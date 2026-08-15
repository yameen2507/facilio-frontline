/**
 * Which actions a lead allows, given its state.
 *
 * This is the only real domain logic in the lead view, and it lived as eight
 * separate inline conditionals inside the render — where it could not be read as a
 * whole and could not be tested at all. As a pure function it is both.
 *
 * The rules mirror the server's state machine (`src/domain/lead-state.ts`). This
 * does not enforce anything: the handler validates every transition, and an action
 * offered here that the server rejects surfaces as a toast. The point is to not
 * offer moves that are certain to fail.
 */

import type { LeadStatus } from "./types/lead";

export type LeadActionId =
  | "claim"
  | "log-call"
  | "assess"
  | "reassess"
  | "qualify"
  | "nurture"
  | "assign"
  | "convert"
  | "close";

/** Terminal leads accept no transitions — only reading and re-assessment. */
export const isTerminal = (status: LeadStatus): boolean => status === "converted" || status === "closed";

export function actionsFor(lead: { status: LeadStatus; ownerEmail?: string | null }, hasAnalysis: boolean): LeadActionId[] {
  const actions: LeadActionId[] = [];
  const terminal = isTerminal(lead.status);

  // An unclaimed lead is anyone's; a claimed one has an owner already.
  if (!lead.ownerEmail && !terminal) actions.push("claim");

  actions.push("log-call");
  actions.push(hasAnalysis ? "reassess" : "assess");

  // "nurture" is included because a parked lead can be qualified straight out of
  // nurture without passing back through contacted.
  if (["in_review", "contacted", "nurture"].includes(lead.status)) actions.push("qualify");
  if (["in_review", "contacted"].includes(lead.status)) actions.push("nurture");

  if (!terminal) actions.push("assign");
  if (lead.status === "qualified") actions.push("convert");
  if (!terminal) actions.push("close");

  return actions;
}

// ── Moves ─────────────────────────────────────────────────────────────────

/**
 * The actions that MOVE a lead — every one lands it in a named state, and the
 * control that offers it should say so. Kept as data so the button (`label`),
 * the menu item (`blurb` + `to`) and the hint sentence beside the primary
 * button (`hint`) all come from one record and cannot drift apart.
 *
 * `log-call` is here because it is secretly a transition: the server marks a
 * lead `contacted` the first time a call is logged on it (lead-state handler),
 * so for a lead in review "log the call" IS the way forward.
 */
export type LeadMoveId = Extract<
  LeadActionId,
  "claim" | "log-call" | "qualify" | "nurture" | "convert" | "close"
>;

export const MOVES: Record<LeadMoveId, { label: string; to: LeadStatus; blurb: string; hint: string }> = {
  claim: {
    label: "Claim & review",
    to: "in_review",
    blurb: "You take it and review starts",
    hint: "Claiming this lead makes it yours and moves it into review.",
  },
  "log-call": {
    label: "Add call notes",
    to: "contacted",
    blurb: "Noting the first call marks the contact made",
    hint: "Call the contact, then note what happened — the first call noted moves this lead to Contacted.",
  },
  qualify: {
    label: "Qualify",
    to: "qualified",
    blurb: "Fit confirmed — ready to become a deal",
    hint: "Happy with the fit? Qualifying moves it forward, ready to become a deal.",
  },
  nurture: {
    label: "Nurture",
    to: "nurture",
    blurb: "Parks it; it returns on a date you pick",
    hint: "Nurturing parks it until a date you pick.",
  },
  convert: {
    label: "Convert to deal",
    to: "converted",
    blurb: "Creates the deal and completes the flow",
    hint: "Converting creates the deal and completes this lead's flow.",
  },
  close: {
    label: "Close lead",
    to: "closed",
    blurb: "Ends it with a reason; can't be reopened",
    hint: "Closing ends the lead with a reason.",
  },
};

/**
 * The recommended way forward from where the lead stands, plus the other legal
 * moves. One `next` rather than a flat list, so the UI can present a single
 * unmissable "this is what advances it" control and tuck the rest behind it —
 * the shape Salesforce's Path and Pipedrive's stage bar settled on.
 */
export function movesFor(lead: { status: LeadStatus; ownerEmail?: string | null }): {
  next: LeadMoveId | null;
  others: LeadMoveId[];
} {
  switch (lead.status) {
    case "new":
      // An owned-but-new lead has no forward action in this UI (claim is what
      // starts review, and it is already claimed) — only the way out.
      return { next: lead.ownerEmail ? null : "claim", others: ["close"] };
    case "in_review":
      return { next: "log-call", others: ["qualify", "nurture", "close"] };
    case "contacted":
      return { next: "qualify", others: ["nurture", "close"] };
    case "qualified":
      return { next: "convert", others: ["close"] };
    case "nurture":
      // Straight to qualified is legal — a parked lead that warms up does not
      // pass back through contacted.
      return { next: "qualify", others: ["close"] };
    default:
      return { next: null, others: [] };
  }
}

// ── Permissions ─────────────────────────────────────────────────────────────

/**
 * Which catalog permission each lead action asks for (spec §9's vocabulary,
 * features/settings/data/permission-catalog.ts). Every gate goes through
 * `can("leads", PERMISSION_OF[action])` — no role name ever appears in this
 * feature, so the matrix in Settings stays the single authority.
 *
 * Mappings that are not one-to-one, and why:
 *   claim      → assign      claiming assigns the lead — to yourself
 *   log-call   → add_note    typing what happened on the call IS the note
 *   close      → disqualify  closing with a disposition reason IS this UI's
 *                            disqualify
 *   nurture    → edit        parking until a date is an ordinary field edit
 *
 * `send_email`, `delete` and `export` are in the catalog but have no buttons in
 * the leads UI yet — when one ships, it takes its check from this map.
 */
export const PERMISSION_OF: Record<LeadActionId, string> = {
  claim: "assign",
  "log-call": "add_note",
  assess: "edit",
  reassess: "edit",
  qualify: "qualify",
  nurture: "edit",
  assign: "assign",
  convert: "convert",
  close: "disqualify",
};

// ── What a hand-raised lead cannot be filed without ──────────────────────────

/**
 * The manual form used to demand a company name and nothing else, while the
 * website chat agent refused to file a lead without a contact name, an email, a
 * service and a city (`src/modules/intake.ts`, missingFields). The two doors into
 * the same queue required almost opposite things, so a typed-in lead routinely
 * arrived with no way to reach anyone and no idea what was wanted.
 *
 * These are now the agent's own three, so a lead is the same object whichever
 * door it came through. Phone is NOT among them: it was raised alongside the
 * others but an email is what the duplicate check matches on and what the
 * follow-up sequence runs on, and requiring both would block a genuine enquiry
 * that only ever gave one.
 *
 * These rules bring the manual door in line with the agent's. Deliberately NOT
 * enforced at the API: `create` also serves inbound integrations, and rejecting
 * their payloads is a separate decision with its own blast radius. This governs
 * what a person can file by hand, which is what was asked for.
 *
 * Pure and separate from the dialog for the usual reason — a validation rule
 * spread across a render's inline conditionals can be neither read as a whole
 * nor tested.
 */
/** `companyName` never blocks on its own — the company is optional — but the
    dialog raises one against it when "existing client" is chosen with nobody
    picked, so the field belongs in the union. */
export type NewLeadField =
  | "companyName"
  | "contactName"
  | "contactEmail"
  | "serviceType"
  | "estimatedValue";

export type NewLeadBlocker = { field: NewLeadField; message: string };

/** Deliberately loose. The job is to catch a typo or a phone number in the email
    box, not to adjudicate RFC 5322 — a real address that fails a clever regex is
    a worse outcome than a fake one that passes a simple one. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Everything standing between this form and a filed lead, in the order the
 * fields appear. The caller shows the first; the rest arrive as they are fixed.
 */
export function newLeadBlockers(input: {
  companyName: string;
  contactName: string;
  contactEmail: string;
  /** Already resolved from the picked service chips AND the free-text box. */
  serviceType: string;
  /** Raw, as typed — "" when not given, which is allowed. */
  estimatedValue: string;
}): NewLeadBlocker[] {
  const blockers: NewLeadBlocker[] = [];
  const contact = input.contactName.trim();
  const email = input.contactEmail.trim();

  // The contact, not the company. A household enquiry has no business name — the
  // intake brief says so — and demanding one turned every homeowner into a fake
  // company; a lead with no PERSON on it, by contrast, is one nobody can act on.
  // `companyName` is still accepted and still preferred for the row's title; it
  // falls back to this name, exactly as the chat agent does.
  if (!contact) {
    blockers.push({
      field: "contactName",
      message: "A lead needs someone's name — it is who the follow-up call asks for.",
    });
  }

  if (!email) {
    blockers.push({
      field: "contactEmail",
      message: "An email address is how a repeat enquiry is spotted and how the follow-up runs.",
    });
  } else if (!EMAIL_SHAPE.test(email)) {
    blockers.push({ field: "contactEmail", message: "That email address does not look right." });
  }

  if (!input.serviceType.trim()) {
    blockers.push({
      field: "serviceType",
      message: "Say which service they want — it is the main thing the assessment scores on.",
    });
  }

  // Kept here rather than beside the field so that ONE list decides whether the
  // form can be submitted at all.
  const value = input.estimatedValue.trim();
  if (value !== "" && !Number.isFinite(Number(value))) {
    blockers.push({
      field: "estimatedValue",
      message: "The value has to be a number — leave it blank if it is not known yet.",
    });
  }

  return blockers;
}

/** The disposition reasons the server accepts when closing. */
export const CLOSE_REASONS = [
  "spam",
  "outside_region",
  "wrong_service",
  "not_interested",
  "no_budget",
  "no_response",
  "lost_to_competitor",
] as const;
