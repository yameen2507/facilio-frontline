/**
 * The activity timeline and realtime notification.
 *
 * `fl_event` is one append-only log for the whole app — the lead chase log, the
 * audit trail and (later) quote view tracking are all projections of it. Three
 * separate logs would be the least clean part of this design.
 */

import { VibeEvents } from "@facilio/studio-functions";
import { many, mutate, nowIso } from "./db";

export interface EventInput {
  entityType: string;
  entityId: string;
  kind: string;
  actor?: string | null;
  body?: string | null;
  meta?: unknown;
}

/** One statement, so an event can never be half-written. */
export function appendEvent(e: EventInput): void {
  const now = nowIso();
  mutate(
    `insert into fl_event
       (id, entity_type, entity_id, kind, actor, body, meta_json, occurred_at, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, '{}', $7, $7)`,
    [
      e.entityType,
      e.entityId,
      e.kind,
      e.actor ?? null,
      e.body ?? null,
      JSON.stringify(e.meta ?? {}),
      now,
    ]
  );
}

export interface TimelineEntry {
  id: string;
  kind: string;
  actor: string | null;
  body: string | null;
  meta: unknown;
  occurredAt: string;
}

export function timeline(entityType: string, entityId: string, max = 100): TimelineEntry[] {
  return many<TimelineEntry>(
    `select id, kind, actor, body, meta_json, occurred_at
       from fl_event
      where entity_type = $1 and entity_id = $2
      order by occurred_at desc
      limit ${Math.max(1, Math.min(500, Math.floor(max)))}`,
    [entityType, entityId]
  );
}

/**
 * Notify open pages. Publishing is best-effort by design: it happens after the
 * write has already committed, so a lost notification must never fail the
 * handler. `publish` does not throw, and `receivers: 0` is normal — it means
 * nobody has the app open.
 */
export async function publish(topic: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const events = new VibeEvents();
    const result = await events.publish(topic, payload);
    return { ok: Boolean(result?.ok), error: result?.error };
  } catch (e) {
    // Realtime is disabled outside a deployed app; that is not an error here.
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}
