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
