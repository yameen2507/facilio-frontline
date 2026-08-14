/**
 * Draining the outbox into Facilio.
 *
 * One action per task, one Facilio call per task. Fetches are serialised at ~10s
 * each, so batches stay small and the drain is resumable — the browser calls it
 * after a conversion for immediate feedback, and a 15-minute scheduled job picks
 * up stragglers once the app is promoted to production.
 */

import { many, mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";
import { executeAction } from "../shared/facilio";
import {
  claim,
  defer,
  enqueue,
  recentFailures,
  retryOrFail,
  statusCounts,
  type SyncTask,
} from "../shared/outbox";
import { upsertJsonKey } from "../shared/row-map";

const CMMS = "facilio-cmms";

/**
 * The client contract does not live in the CMMS connection — it is an FSM-app
 * module, reachable only through `/fsm/api/v3/modules/...`. `facilio-fsm-client-contracts`
 * is our org's own connection over that surface; see docs/connections.md for why
 * v3 accepts the service token here (the `x-org-id` + `x-device-type: Web` headers)
 * and refused every attempt without them.
 */
const FSM = "facilio-fsm-client-contracts";

/**
 * Facilio sends integers, not strings, and a wrong one fails silently — the
 * contract saves and PPM never generates. Every value below was read from
 * `list-module-fields` on org #2944 and is mirrored in docs/enums.md.
 */
const CONTRACT_TYPE_ONE_TIME = 2;
const CONTRACT_TYPE_PLANNED = 1;
const SOW_TYPE_CLIENT_CONTRACT = 2;
const SOW_ASSIGNMENT_INTERNAL = 2;
const SOW_SCHEDULE_SINGLE = 1;
const SOW_SCOPE_ALL_SITES = 1;
const SOW_SERVICING_ENTITY_SPACE = 1;
const SOW_DURATION_TOTAL_MAN_HOURS = 1;
const SOW_INVOICE_FLAT_RATE_PER_CYCLE = 1;
const SOW_CREDIT_NOTE_RATE_PER_SERVICE = 2;
const SOW_UNIT_TYPE_NONE = -1;

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
    case "create_client_contract":
      return createClientContract(task);
    case "create_contract_service_line":
      return createContractServiceLine(task);
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

/**
 * Stash a Facilio id on the deal.
 *
 * `fl_deal` has no `facilio_contract_id` column and never will: the app DB role
 * cannot ALTER, so a table's shape is permanent (ARCHITECTURE.md §3a). That is
 * exactly what the `data_json` overflow column is for. Read-modify-write is safe
 * enough here because one contract task owns the key and the outbox never runs
 * two tasks for the same deal concurrently.
 */
function stampDeal(dealId: string, key: string, value: string | null): void {
  // `::text` alias, or the row-mapper parses the bag and hands back an object
  // under `data` — a read through `dataJson` silently sees {} and a write built
  // on that clobbers every other key in the bag.
  const row = one<{ dataRaw: string | null }>(
    "select data_json::text as data_raw from fl_deal where id = $1 limit 1",
    [dealId]
  );

  let bag: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row?.dataRaw ?? "{}");
    if (parsed && typeof parsed === "object") bag = parsed as Record<string, unknown>;
  } catch {
    // A corrupt bag must not strand the promotion — start a fresh one.
  }

  bag[key] = value;
  mutate("update fl_deal set data_json = $2, updated_at = $3 where id = $1", [
    dealId,
    JSON.stringify(bag),
    nowIso(),
  ]);
}

/** Finish a task whose record has no typed `facilio_*` column to write back to. */
function completeTask(task: SyncTask, facilioId: string | null): TaskOutcome {
  mutate(
    `update fl_sync_task set status = 'done', facilio_id = $2, last_error = null, updated_at = $3 where id = $1`,
    [task.id, facilioId, nowIso()]
  );
  return { facilioId };
}

/**
 * F-08's second half: queue the CONTRACT (and its service lines) for a won
 * deal, from its accepted proposal. Called from the deal's won transition,
 * right after `queueClientSync` — same idempotent-key discipline, so a repeat
 * win re-queues nothing.
 *
 * No accepted proposal → no contract, by design: the chat doc's gate is "Won +
 * contract signed", and the accepted proposal IS the signature we hold. The
 * client and portfolio still promote; the contract simply waits for a deal
 * that closed the paper trail.
 *
 * MONEY: no conversion. fl_proposal_line's money columns hold MAJOR units
 * (applied_price 2.5, line_total 2375 — verified raw on 15 Aug); the minor-unit
 * integers seen at the API edge are the proposal module's wire format, which a
 * raw SQL read here never passes through. Facilio's rates are major units too,
 * so the number goes straight across. (A /100 here once shipped 23.75 for a
 * 2,375.00 line.)
 */
export function queueContractSync(dealId: string): { queued: string[]; reason?: string } {
  const deal = one<{ title: string | null; refNo: string; dataRaw: string | null }>(
    "select title, ref_no, data_json::text as data_raw from fl_deal where id = $1 limit 1",
    [dealId]
  );
  if (!deal) throw new Error(`deal ${dealId} not found`);

  const proposal = one<{ id: string; refNo: string; dataRaw: string | null }>(
    `select id, ref_no, data_json::text as data_raw from fl_proposal
      where deal_id = $1 and decision = 'accepted' and is_active = 'true'
      order by accepted_at desc limit 1`,
    [dealId]
  );
  if (!proposal) return { queued: [], reason: "no accepted proposal — the contract waits for one" };

  // Optional lines the client did not take stay out of the contract.
  let acceptedLineIds: string[] | null = null;
  try {
    const bag = JSON.parse(proposal.dataRaw ?? "{}") as Record<string, unknown>;
    if (typeof bag.accepted_line_ids === "string") acceptedLineIds = JSON.parse(bag.accepted_line_ids);
    else if (Array.isArray(bag.accepted_line_ids)) acceptedLineIds = bag.accepted_line_ids as string[];
  } catch {
    acceptedLineIds = null;
  }

  const lines = many<{
    id: string;
    description: string | null;
    serviceCode: string | null;
    frequency: string | null;
    lineTotal: number | null;
    monthlyEquivalentAmount: number | null;
    oneTimeAmount: number | null;
    isOptional: string | null;
  }>(
    `select id, description, service_code, frequency, line_total,
            monthly_equivalent_amount, one_time_amount, is_optional
       from fl_proposal_line
      where proposal_id = $1 and is_active = 'true'
      order by sequence_no`,
    [proposal.id]
  ).filter((l) => l.isOptional !== "true" || (acceptedLineIds ?? []).includes(l.id));

  const recurring = lines.some((l) => l.frequency && l.frequency !== "one_time");

  // The won capture carries the agreed start date as an ISO date string.
  let startDateMs: number | null = null;
  try {
    const bag = JSON.parse(deal.dataRaw ?? "{}") as Record<string, unknown>;
    const won = (bag.won ?? {}) as Record<string, unknown>;
    const raw = typeof won.contractStartDate === "string" ? won.contractStartDate : null;
    if (raw) {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) startDateMs = parsed;
    }
  } catch {
    startDateMs = null;
  }

  const queued: string[] = [];

  const contractKey = `deal:${dealId}:create_client_contract`;
  if (
    enqueue({
      aggregateType: "deal",
      aggregateId: dealId,
      action: "create_client_contract",
      idempotencyKey: contractKey,
      payload: {
        name: `${deal.title ?? deal.refNo} — ${proposal.refNo}`,
        recurring,
        generatePPM: recurring,
        ...(startDateMs !== null ? { startDate: startDateMs } : {}),
      },
    }).created
  ) {
    queued.push(contractKey);
  }

  for (const line of lines) {
    const key = `proposal_line:${line.id}:create_contract_service_line`;
    const amount = Number(line.monthlyEquivalentAmount ?? line.oneTimeAmount ?? line.lineTotal ?? 0);
    if (
      enqueue({
        aggregateType: "deal",
        aggregateId: dealId,
        action: "create_contract_service_line",
        idempotencyKey: key,
        dependsOnId: dealId,
        payload: {
          proposalLineId: line.id,
          serviceCode: line.serviceCode,
          serviceName: line.description ?? `Line from ${proposal.refNo}`,
          invoiceRate: Math.round(amount * 100) / 100,
          ...(startDateMs !== null ? { startDate: startDateMs } : {}),
        },
      }).created
    ) {
      queued.push(key);
    }
  }

  return { queued };
}

/**
 * The contract — §4's boundary made real. Runs at Won, never before.
 *
 * Two ordering rules are enforced by deferral rather than by hope, because the
 * outbox re-runs a deferred task without burning an attempt:
 *
 *  1. The client must already exist in Facilio (the contract's `client` lookup).
 *  2. At least one site must have been promoted. Facilio rejects a contract with
 *     no contractual sites outright — "Contractual sites cannot be empty" — so a
 *     contract raced ahead of the portfolio would fail, not merely look odd.
 *
 * Service lines are NOT passed here. `services` is a multi-lookup to the separate
 * `scopeOfWorkServices` module and rejects inline objects ("Invalid ID in lookup
 * object for multi lookup insert"); each line is its own task, enqueued after.
 */
async function createClientContract(task: SyncTask): Promise<TaskOutcome> {
  const deal = one<{ accountId: string | null; dataRaw: string | null }>(
    "select account_id, data_json::text as data_raw from fl_deal where id = $1 limit 1",
    [task.aggregateId]
  );
  if (!deal) throw new Error(`deal ${task.aggregateId} no longer exists`);

  // Idempotency: a re-run must never mint a second contract. Facilio has no
  // delete action for one, so a duplicate is permanent.
  try {
    const existing = JSON.parse(deal.dataRaw ?? "{}") as Record<string, unknown>;
    const already = existing.facilioContractId;
    if (typeof already === "string" && already) return completeTask(task, already);
  } catch {
    // Unparseable bag: fall through and create, then overwrite it cleanly.
  }

  if (!deal.accountId) return { deferred: true, reason: "deal has no account yet" };

  const account = one<{ facilioClientId: string | null }>(
    "select facilio_client_id from fl_account where id = $1 limit 1",
    [deal.accountId]
  );
  if (!account?.facilioClientId) {
    return { deferred: true, reason: "client not synced to Facilio yet" };
  }

  const sites = many<{ facilioId: string }>(
    `select facilio_id from fl_portfolio_location
      where deal_id = $1 and type = 'site' and is_active = 'true'
        and coalesce(facilio_id, '') not in ('', 'none')`,
    [task.aggregateId]
  );
  if (!sites.length) {
    return { deferred: true, reason: "no promoted site yet — Facilio rejects a contract without one" };
  }

  const p = (task.payload ?? {}) as Record<string, unknown>;
  if (!p.name) throw new Error("facilio create-client-contract needs a name");

  // Facilio: "Contract start date cannot be empty" — startDate is MANDATORY.
  // The payload's value wins, then the won capture read FRESH from the deal
  // (a task queued before the capture landed self-heals on retry), then the
  // day the task runs — a contract that starts today beats one that never
  // exists, and the date is editable in Facilio afterwards.
  let startDate: number | null = typeof p.startDate === "number" ? p.startDate : null;
  if (startDate === null) {
    try {
      const bag = JSON.parse(deal.dataRaw ?? "{}") as Record<string, unknown>;
      const won = (bag.won ?? {}) as Record<string, unknown>;
      const raw = typeof won.contractStartDate === "string" ? won.contractStartDate : null;
      if (raw) {
        const parsed = Date.parse(raw);
        if (Number.isFinite(parsed)) startDate = parsed;
      }
    } catch {
      startDate = null;
    }
  }
  if (startDate === null) startDate = Date.parse(nowIso());

  const data: Record<string, unknown> = {
    name: p.name,
    // Dates are epoch milliseconds, not ISO strings — the rest of the app speaks
    // ISO 8601, so the caller converts and this layer stays dumb about it.
    type: p.recurring ? CONTRACT_TYPE_PLANNED : CONTRACT_TYPE_ONE_TIME,
    client: { id: Number(account.facilioClientId) },
    sites: sites.map((s) => ({ id: Number(s.facilioId) })),
    startDate,
  };
  if (typeof p.endDate === "number") data.endDate = p.endDate;
  if (p.generatePPM === true) data.generatePPM = true;

  const result = await executeAction(FSM, "create-client-contract", { data });
  // No id means the contract does NOT exist — completing the task with a null
  // stamp would strand every service line behind a contract nobody created.
  if (!result.recordId) throw new Error("facilio create-client-contract returned no record id");

  stampDeal(task.aggregateId, "facilioContractId", result.recordId);
  appendEvent({
    entityType: "deal",
    entityId: task.aggregateId,
    kind: "promoted",
    actor: null,
    body: `Client contract created in Facilio${result.recordId ? ` (#${result.recordId})` : ""}`,
    meta: { facilioContractId: result.recordId, module: "clientContract" },
  });

  return completeTask(task, result.recordId);
}

/**
 * A contract line needs a Facilio Services record id, and the catalogue is
 * local-first (the 15 Aug reversal of C23) — so the id is resolved lazily,
 * find-or-create, at the promotion boundary:
 *
 *  - A line with a `serviceCode` maps to its fl_service_line row. If that row
 *    already carries a `facilio_service_id` in data_json, reuse it; otherwise
 *    create the service in Facilio ONCE and cache the id back on the row, so
 *    every future contract line for the same code reuses one Facilio record.
 *  - A line with no code (a hand-priced one-off) creates a Facilio service
 *    named after the line. Rare by design; a retry that crashed between the
 *    two creates can leave one orphan service — visible, inert, acceptable.
 */
async function resolveFacilioServiceId(p: Record<string, unknown>): Promise<string> {
  if (p.facilioServiceId) return String(p.facilioServiceId);

  const code = typeof p.serviceCode === "string" ? p.serviceCode.trim() : "";
  const fallbackName =
    typeof p.serviceName === "string" && p.serviceName.trim()
      ? p.serviceName.trim()
      : "Frontline service";

  if (code) {
    const row = one<{ name: string | null; dataRaw: string | null }>(
      "select name, data_json::text as data_raw from fl_service_line where upper(code) = $1 limit 1",
      [code.toUpperCase()]
    );
    if (row) {
      try {
        const bag = JSON.parse(row.dataRaw ?? "{}") as Record<string, unknown>;
        if (typeof bag.facilio_service_id === "string" && bag.facilio_service_id) {
          return bag.facilio_service_id;
        }
      } catch {
        // Unreadable bag: create fresh and overwrite the key below.
      }

      const created = await executeAction(CMMS, "create-service", {
        service: { name: row.name ?? fallbackName, paymentType: "Fixed", status: "Active" },
      });
      if (!created.recordId) throw new Error("facilio create-service returned no id");

      mutate(
        `update fl_service_line set data_json = $2, updated_at = $3 where upper(code) = $1`,
        [code.toUpperCase(), upsertJsonKey(row.dataRaw, "facilio_service_id", created.recordId), nowIso()]
      );
      return created.recordId;
    }
  }

  const created = await executeAction(CMMS, "create-service", {
    service: { name: fallbackName, paymentType: "Fixed", status: "Active" },
  });
  if (!created.recordId) throw new Error("facilio create-service returned no id");
  return created.recordId;
}

/**
 * One priced line of the contract's scope of work.
 *
 * `create-scope-of-work-service` went live on 15 Aug (the connection was
 * published) — verified by executing it through the normal path against
 * contract 9778. The line's `code` is server-generated (CC-SOW1, CC-SOW2 …);
 * anything we send is ignored, so we do not send one.
 */
async function createContractServiceLine(task: SyncTask): Promise<TaskOutcome> {
  const deal = one<{ dataRaw: string | null }>(
    "select data_json::text as data_raw from fl_deal where id = $1 limit 1",
    [task.aggregateId]
  );
  if (!deal) throw new Error(`deal ${task.aggregateId} no longer exists`);

  let contractId = "";
  try {
    const bag = JSON.parse(deal.dataRaw ?? "{}") as Record<string, unknown>;
    if (typeof bag.facilioContractId === "string") contractId = bag.facilioContractId;
  } catch {
    // Fall through to the deferral below.
  }
  if (!contractId) return { deferred: true, reason: "contract not created in Facilio yet" };

  const p = (task.payload ?? {}) as Record<string, unknown>;
  const facilioServiceId = await resolveFacilioServiceId(p);

  const data: Record<string, unknown> = {
    clientContract: { id: Number(contractId) },
    service: { id: Number(facilioServiceId) },
    type: SOW_TYPE_CLIENT_CONTRACT,
    assignmentType: SOW_ASSIGNMENT_INTERNAL,
    scheduleType: SOW_SCHEDULE_SINGLE,
    scope: SOW_SCOPE_ALL_SITES,
    servicingEntity: SOW_SERVICING_ENTITY_SPACE,
    durationType: SOW_DURATION_TOTAL_MAN_HOURS,
    invoiceBasedOn: SOW_INVOICE_FLAT_RATE_PER_CYCLE,
    creditNoteBasedOn: SOW_CREDIT_NOTE_RATE_PER_SERVICE,
    unitType: SOW_UNIT_TYPE_NONE,
    invoiceRate: typeof p.invoiceRate === "number" ? p.invoiceRate : 0,
    creditNoteRate: typeof p.creditNoteRate === "number" ? p.creditNoteRate : 1,
  };
  // Same self-healing rule as the contract: a line queued before the capture
  // landed still runs, dated the day it lands.
  data.startDate = typeof p.startDate === "number" ? p.startDate : Date.parse(nowIso());
  // "Please provide valid estimated duration for all services" — mandatory.
  // One hour (in seconds) when the proposal carried none; editable in Facilio.
  data.estimatedDuration = typeof p.estimatedDuration === "number" ? p.estimatedDuration : 3600;

  const result = await executeAction(FSM, "create-scope-of-work-service", { data });
  if (!result.recordId) throw new Error("facilio create-scope-of-work-service returned no record id");
  return completeTask(task, result.recordId);
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
