/**
 * The outbox. Every write to Facilio goes through here, never inline on the
 * request path.
 *
 * Why: `fetch` calls are serialised at ~10s each and there are no transactions,
 * so a handler that tried to create a client, a contact and four assets inline
 * would time out half-done with no way to recover. Enqueue, return, drain.
 */

import { many, mutate, nowIso } from "./db";

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";

export interface SyncTask {
  id: string;
  aggregateType: string;
  aggregateId: string;
  action: string;
  payload: Record<string, unknown> | null;
  idempotencyKey: string;
  dependsOnId: string | null;
  status: TaskStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  facilioId: string | null;
}

export interface EnqueueInput {
  aggregateType: string;
  aggregateId: string;
  action: string;
  payload: unknown;
  /** Deterministic, e.g. `lead:{id}:create_client`. Makes retries free. */
  idempotencyKey: string;
  dependsOnId?: string | null;
}

/**
 * Insert unless the idempotency key already exists. There are no UNIQUE
 * constraints available, so this leans on `INSERT ... SELECT ... WHERE NOT
 * EXISTS` being a single statement and therefore atomic.
 *
 * Returns whether a row was created — false means the work was already queued.
 */
export function enqueue(input: EnqueueInput): { created: boolean; idempotencyKey: string } {
  const now = nowIso();
  const inserted = mutate(
    `insert into fl_sync_task
       (id, aggregate_type, aggregate_id, action, payload_json, idempotency_key,
        depends_on_id, status, attempts, next_attempt_at, last_error, facilio_id,
        data_json, created_at, updated_at)
     select gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, 'pending', 0, $7, null, null, '{}', $7, $7
      where not exists (select 1 from fl_sync_task where idempotency_key = $5)`,
    [
      input.aggregateType,
      input.aggregateId,
      input.action,
      JSON.stringify(input.payload ?? {}),
      input.idempotencyKey,
      input.dependsOnId ?? null,
      now,
    ]
  );

  return { created: inserted > 0, idempotencyKey: input.idempotencyKey };
}

/**
 * Claim a batch in one statement. `FOR UPDATE SKIP LOCKED` means several
 * concurrent drains never pick the same row — SELECT-then-UPDATE would.
 */
export function claim(batchSize = 5): SyncTask[] {
  const now = nowIso();
  const size = Math.max(1, Math.min(25, Math.floor(batchSize)));

  return many<SyncTask>(
    `update fl_sync_task
        set status = 'in_progress',
            attempts = attempts + 1,
            updated_at = $1
      where id in (
        select id from fl_sync_task
         where status = 'pending'
           and (next_attempt_at is null or next_attempt_at <= $1)
         order by created_at
         for update skip locked
         limit ${size}
      )
      returning id, aggregate_type, aggregate_id, action, payload_json,
                idempotency_key, depends_on_id, status, attempts,
                next_attempt_at, last_error, facilio_id`,
    [now]
  );
}

const MAX_ATTEMPTS = 5;

/** Exponential-ish backoff: 1, 4, 9, 16 minutes. */
function backoffMinutes(attempts: number): number {
  return Math.min(60, attempts * attempts);
}

export function succeed(id: string, facilioId?: string | null): void {
  mutate(
    `update fl_sync_task
        set status = 'done', facilio_id = $2, last_error = null, updated_at = $3
      where id = $1`,
    [id, facilioId ?? null, nowIso()]
  );
}

/**
 * Record a failure. Re-queues with backoff until MAX_ATTEMPTS, then parks the
 * task as `failed` for a human to inspect — no infinite retry loops.
 */
export function retryOrFail(task: SyncTask, error: string): "pending" | "failed" {
  const now = nowIso();
  const message = error.slice(0, 500);

  if (task.attempts >= MAX_ATTEMPTS) {
    mutate(`update fl_sync_task set status = 'failed', last_error = $2, updated_at = $3 where id = $1`, [
      task.id,
      message,
      now,
    ]);
    return "failed";
  }

  const next = new Date(Date.parse(now) + backoffMinutes(task.attempts) * 60_000).toISOString();
  mutate(
    `update fl_sync_task
        set status = 'pending', last_error = $2, next_attempt_at = $3, updated_at = $4
      where id = $1`,
    [task.id, message, next, now]
  );
  return "pending";
}

/**
 * Put a claimed task back without consuming an attempt — used when a dependency
 * has not produced its Facilio id yet. Self-healing ordering, no orchestrator.
 */
export function defer(task: SyncTask, reason: string, delayMinutes = 1): void {
  const now = nowIso();
  const next = new Date(Date.parse(now) + delayMinutes * 60_000).toISOString();
  mutate(
    `update fl_sync_task
        set status = 'pending', attempts = greatest(attempts - 1, 0),
            last_error = $2, next_attempt_at = $3, updated_at = $4
      where id = $1`,
    [task.id, `deferred: ${reason}`.slice(0, 500), next, now]
  );
}

export function statusCounts(): Record<string, number> {
  const rows = many<{ status: string; c: unknown }>(
    `select status, count(*) as c from fl_sync_task group by status limit 10`
  );
  const out: Record<string, number> = { pending: 0, in_progress: 0, done: 0, failed: 0 };
  for (const r of rows) out[r.status] = Number(r.c);
  return out;
}

export function recentFailures(max = 10): SyncTask[] {
  return many<SyncTask>(
    `select id, aggregate_type, aggregate_id, action, idempotency_key, status,
            attempts, last_error, next_attempt_at
       from fl_sync_task
      where status = 'failed'
      order by updated_at desc
      limit ${Math.max(1, Math.min(50, Math.floor(max)))}`
  );
}
