/**
 * The deals data layer. Every endpoint is LIVE against the `deal` function —
 * no seam here.
 *
 * | handler      | returns                                              |
 * | ------------ | ---------------------------------------------------- |
 * | `list`       | `{ deals[], total }` with account name + lead ref     |
 * | `get`        | deal + account + contact + lead + surveys + proposals + timeline + allowedNext |
 * | `update`     | descriptive fields only — stage is rejected           |
 * | `capture`    | merges a per-stage tracking sheet into data_json      |
 * | `transition` | the only stage writer; lost requires a reason         |
 * | `reopen`     | the deliberate door out of won/lost                   |
 *
 * Mutations come back `withDetail` — the refreshed `deal.get` view rides on the
 * response so no page pays a second round trip after acting.
 */

import { requestFrom } from "../../../lib/request";
import type { DealDetailResponse, DealListResponse, DealStage } from "../types/deal";

const call = <T>(handler: string, args: Record<string, unknown> = {}) =>
  requestFrom<T>("deal", handler, args);

export const LIST_LIMIT = 200;

export const listDeals = (search?: string) =>
  call<DealListResponse>("list", {
    limit: LIST_LIMIT,
    // Sent only when non-empty: a blank flat field is dropped upstream as an
    // unresolved connection-action template rather than arriving as "".
    ...(search ? { search } : {}),
  });

export const getDeal = (dealId: string) => call<DealDetailResponse>("get", { dealId });

/** A mutation's payload with the refreshed detail attached (see file header). */
export type Acted = { detail: DealDetailResponse };

export const updateDeal = (
  dealId: string,
  fields: { title?: string; estimatedValue?: number; currency?: string; salesOwnerEmail?: string },
  actorEmail: string | null
) => call<Acted>("update", { dealId, ...fields, ...(actorEmail ? { actorEmail } : {}) });

export const captureDeal = (
  dealId: string,
  section: "discovery" | "negotiation" | "decision" | "won" | "lost",
  values: Record<string, unknown>,
  actorEmail: string | null
) =>
  call<Acted>("capture", {
    dealId,
    section,
    // Nested input travels in the payload envelope — flat fields can only be scalars.
    payload: JSON.stringify({ values }),
    ...(actorEmail ? { actorEmail } : {}),
  });

export const transitionDeal = (input: {
  dealId: string;
  toStage: DealStage;
  lostReason?: string;
  capture?: Record<string, unknown>;
  note?: string;
  actorEmail: string | null;
}) =>
  call<Acted>("transition", {
    dealId: input.dealId,
    toStage: input.toStage,
    ...(input.lostReason ? { lostReason: input.lostReason } : {}),
    ...(input.capture ? { payload: JSON.stringify({ capture: input.capture }) } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.actorEmail ? { actorEmail: input.actorEmail } : {}),
  });

export const reopenDeal = (dealId: string, note: string, actorEmail: string) =>
  call<Acted>("reopen", { dealId, actorEmail, ...(note ? { note } : {}) });

/**
 * `lead.sync-drain`, kicked right after a win. Winning QUEUES the Facilio
 * client/contact/contract writes (F-08); on preview nothing else processes the
 * queue (scheduled jobs fire only on production), so without this nudge the
 * "client appears in Facilio" moment would wait for someone to visit Settings.
 * Fire-and-forget: a drain failure is retried by the next drain, never surfaced
 * as if the win itself failed.
 */
export const drainAfterWin = () =>
  requestFrom<{ claimed: number; succeeded: number }>("lead", "sync-drain", { batch: 10 });
