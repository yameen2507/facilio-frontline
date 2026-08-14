/**
 * Draining the outbox into Facilio.
 *
 * One action per task, one Facilio call per task. Fetches are serialised at ~10s
 * each, so batches stay small and the drain is resumable — the browser calls it
 * after a conversion for immediate feedback, and a 15-minute scheduled job picks
 * up stragglers once the app is promoted to production.
 */

import { mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";
import { executeAction } from "../shared/facilio";
import {
  claim,
  defer,
  recentFailures,
  retryOrFail,
  statusCounts,
  type SyncTask,
} from "../shared/outbox";

const CMMS = "facilio-cmms";

export interface DrainResult {
  claimed: number;
  succeeded: number;
  deferred: number;
  failed: number;
  results: Array<{ action: string; idempotencyKey: string; outcome: string; detail?: string }>;
}

export async function drain(batchSize = 5): Promise<DrainResult> {
  const tasks = claim(batchSize);
  const out: DrainResult = {
    claimed: tasks.length,
    succeeded: 0,
    deferred: 0,
    failed: 0,
    results: [],
  };

  for (const task of tasks) {
    try {
      const outcome = await runTask(task);

      if (outcome.deferred) {
        defer(task, outcome.reason ?? "waiting on a dependency");
        out.deferred++;
        out.results.push({
          action: task.action,
          idempotencyKey: task.idempotencyKey,
          outcome: "deferred",
          detail: outcome.reason,
        });
        continue;
      }

      out.succeeded++;
      out.results.push({
        action: task.action,
        idempotencyKey: task.idempotencyKey,
        outcome: "done",
        detail: outcome.facilioId ?? undefined,
      });
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      const state = retryOrFail(task, message);
      if (state === "failed") out.failed++;
      out.results.push({
        action: task.action,
        idempotencyKey: task.idempotencyKey,
        outcome: state === "failed" ? "failed" : "retry",
        detail: message.slice(0, 200),
      });
    }
  }

  return out;
}

interface TaskOutcome {
  facilioId?: string | null;
  deferred?: boolean;
  reason?: string;
}

async function runTask(task: SyncTask): Promise<TaskOutcome> {
  switch (task.action) {
    case "create_client":
      return createClient(task);
    case "create_client_contact":
      return createClientContact(task);
    default:
      throw new Error(`unknown sync action: ${task.action}`);
  }
}

/** Mark a task done and record the Facilio id both on the task and the row. */
function complete(task: SyncTask, facilioId: string | null, table: string, entityLabel: string): TaskOutcome {
  const now = nowIso();

  mutate(
    `update fl_sync_task set status = 'done', facilio_id = $2, last_error = null, updated_at = $3 where id = $1`,
    [task.id, facilioId, now]
  );

  const column = table === "fl_account" ? "facilio_client_id" : "facilio_contact_id";
  mutate(
    `update ${table} set ${column} = $2, sync_status = 'synced', updated_at = $3 where id = $1`,
    [task.aggregateId, facilioId, now]
  );

  appendEvent({
    entityType: task.aggregateType,
    entityId: task.aggregateId,
    kind: "synced",
    actor: "sync",
    body: `${entityLabel} created in Facilio (id ${facilioId ?? "unknown"})`,
    meta: { action: task.action, facilioId },
  });

  return { facilioId };
}

async function createClient(task: SyncTask): Promise<TaskOutcome> {
  // Already synced? Nothing to do — makes a replay harmless.
  const account = one<{ facilioClientId: string | null }>(
    "select facilio_client_id from fl_account where id = $1 limit 1",
    [task.aggregateId]
  );
  if (!account) throw new Error(`account ${task.aggregateId} no longer exists`);
  if (account.facilioClientId) return complete(task, account.facilioClientId, "fl_account", "Client");

  const p = (task.payload ?? {}) as Record<string, unknown>;
  const client: Record<string, unknown> = {
    name: p.name,
    primaryContactEmail: p.primaryContactEmail,
  };
  if (p.primaryContactName) client.primaryContactName = p.primaryContactName;
  if (p.primaryContactPhone) client.primaryContactPhone = p.primaryContactPhone;
  if (p.address && typeof p.address === "object") {
    const address = Object.fromEntries(
      Object.entries(p.address as Record<string, unknown>).filter(([, v]) => v)
    );
    if (Object.keys(address).length) client.address = address;
  }

  if (!client.name || !client.primaryContactEmail) {
    throw new Error("facilio create-client needs both name and primaryContactEmail");
  }

  const result = await executeAction(CMMS, "create-client", { client });
  return complete(task, result.recordId, "fl_account", "Client");
}

async function createClientContact(task: SyncTask): Promise<TaskOutcome> {
  const contact = one<{ facilioContactId: string | null; accountId: string }>(
    "select facilio_contact_id, account_id from fl_account_contact where id = $1 limit 1",
    [task.aggregateId]
  );
  if (!contact) throw new Error(`contact ${task.aggregateId} no longer exists`);
  if (contact.facilioContactId) {
    return complete(task, contact.facilioContactId, "fl_account_contact", "Contact");
  }

  // The contact needs its client's Facilio id. If the client has not synced yet,
  // put the task back without consuming an attempt — self-healing ordering.
  const account = one<{ facilioClientId: string | null }>(
    "select facilio_client_id from fl_account where id = $1 limit 1",
    [contact.accountId]
  );
  if (!account?.facilioClientId) {
    return { deferred: true, reason: "client not synced to Facilio yet" };
  }

  const p = (task.payload ?? {}) as Record<string, unknown>;
  if (!p.name || !p.email) {
    throw new Error("facilio create-client-contact needs both name and email");
  }

  // The wrapper key is `clientcontact`, all lowercase — confirmed from the
  // action schema, not guessed. `clientContact` returns a 400.
  const result = await executeAction(CMMS, "create-client-contact", {
    clientcontact: {
      name: p.name,
      email: p.email,
      phone: p.phone ?? undefined,
      client: { id: Number(account.facilioClientId) },
      isPrimaryContact: true,
    },
  });

  return complete(task, result.recordId, "fl_account_contact", "Contact");
}

export function syncStatus(): {
  counts: Record<string, number>;
  failures: SyncTask[];
} {
  // `SyncTask[]`, not `Record<string, unknown>[]`: the rows really are tasks, and
  // an interface without an index signature is not assignable to a Record — the
  // first error the backend typecheck found once it started running at all (G11).
  return { counts: statusCounts(), failures: recentFailures(10) };
}

/** Put a failed task back in the queue for another go. */
export function retry(taskId: string): { ok: boolean } {
  const now = nowIso();
  const updated = mutate(
    `update fl_sync_task
        set status = 'pending', attempts = 0, next_attempt_at = $2, last_error = null, updated_at = $2
      where id = $1 and status = 'failed'`,
    [taskId, now]
  );
  if (!updated) throw new Error(`no failed task with id ${taskId}`);
  return { ok: true };
}
