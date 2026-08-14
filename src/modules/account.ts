/**
 * The account aggregate — the company behind one or more converted leads, or
 * one added by hand (F-18: a client-to-be does not have to enquire first).
 *
 * The write path is deliberately narrow. Creates come from `convert` (one per
 * company, never one per lead — see findAccount there) or `createAccount`
 * here; edits are LOCAL (F-19) because the facilio-cmms connection has
 * create-client but no update action — a change here does not travel to a
 * client already in Facilio, and the UI says so rather than letting the two
 * quietly diverge. Contacts (D-37) grow through `saveContact`, with new ones
 * queued through the same outbox convert uses.
 *
 * The detail view is what makes the lead → account link visible: every lead that
 * resolved to this company, and every deal those leads opened.
 */

import { count, manyWithTruncation, mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";
import { enqueue } from "../shared/outbox";

export interface Account {
  id: string;
  /** The lead that first created it. Later leads link via fl_lead.account_id. */
  leadId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  websiteDomain: string | null;
  address: { street: string | null; city: string | null; state: string | null } | null;
  facilioClientId: string | null;
  syncStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: unknown;
  facilioContactId: string | null;
  syncStatus: string | null;
  createdAt: string;
}

export interface AccountDeal {
  id: string;
  refNo: string;
  leadId: string | null;
  contactId: string | null;
  title: string | null;
  stage: string;
  estimatedValue: number | null;
  currency: string | null;
  salesOwnerEmail: string | null;
  source: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  createdAt: string;
}

export interface AccountLead {
  id: string;
  refNo: string;
  status: string;
  source: string;
  serviceType: string | null;
  score: number | null;
  dealId: string | null;
  createdAt: string;
}

export interface AccountDetail {
  account: Account;
  contacts: AccountContact[];
  deals: AccountDeal[];
  leads: AccountLead[];
}

const COLUMNS = `id, lead_id, name, email, phone, website_domain, address_json,
  facilio_client_id, sync_status, created_at, updated_at`;

/**
 * Account, contacts, deals and originating leads in ONE statement. Four separate
 * reads would cost four times ~194ms of fixed bridge overhead (see shared/db.ts);
 * batched as `_obj` / `_arr` subqueries they cost one, and row-map.ts unpacks
 * them back into nested camelCase.
 */
export function accountDetail(id: string): AccountDetail {
  const row = one<{
    account: Account | null;
    contacts: AccountContact[];
    deals: AccountDeal[];
    leads: AccountLead[];
  }>(
    `select
       (select row_to_json(x) from (
          select ${COLUMNS} from fl_account where id = $1
        ) x) as account_obj,

       (select coalesce(json_agg(x order by x.is_primary desc, x.created_at), '[]'::json) from (
          select id, name, email, phone, is_primary, facilio_contact_id, sync_status, created_at
            from fl_account_contact
           where account_id = $1
        ) x) as contacts_arr,

       (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
          select id, ref_no, lead_id, contact_id, title, stage, estimated_value,
                 currency, sales_owner_email, source, won_at, lost_at, lost_reason,
                 created_at
            from fl_deal
           where account_id = $1
           order by created_at desc
           limit 100
        ) x) as deals_arr,

       (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
          select id, ref_no, status, source, service_type, score, deal_id, created_at
            from fl_lead
           where account_id = $1
           order by created_at desc
           limit 100
        ) x) as leads_arr`,
    [id]
  );

  const account = row?.account;
  if (!account) throw new Error(`account ${id} not found`);

  return {
    account,
    contacts: row.contacts,
    deals: row.deals,
    leads: row.leads,
  };
}

export interface AccountListFilters {
  search?: string | null;
  syncStatus?: string | null;
  limit: number;
  offset: number;
}

export interface AccountListRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  websiteDomain: string | null;
  facilioClientId: string | null;
  syncStatus: string | null;
  createdAt: string;
  dealCount: number;
  leadCount: number;
}

/** Counts arrive as strings on the wire and are not in row-map's numeric list. */
type RawAccountListRow = Omit<AccountListRow, "dealCount" | "leadCount"> & {
  dealCount: unknown;
  leadCount: unknown;
  totalCount: unknown;
};

/**
 * A page of accounts with the counts a list needs to be worth reading — how many
 * leads resolved here and how many deals came out of them.
 *
 * The per-row counts are scalar subqueries and the unpaged total rides along as
 * `count(*) over ()`, so the whole thing is one query rather than one per row
 * plus a separate count.
 */
export function listAccounts(filters: AccountListFilters): {
  accounts: AccountListRow[];
  total: number;
  truncated: boolean;
} {
  const where: string[] = [];
  const params: unknown[] = [];

  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };

  if (filters.syncStatus) add("a.sync_status = ?", filters.syncStatus);
  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    where.push(
      `(lower(coalesce(a.name,'')) like $${params.length}
        or lower(coalesce(a.email,'')) like $${params.length}
        or lower(coalesce(a.website_domain,'')) like $${params.length})`
    );
  }

  const clause = where.length ? `where ${where.join(" and ")}` : "";

  const { rows, truncated } = manyWithTruncation<RawAccountListRow>(
    `select a.id, a.name, a.email, a.phone, a.website_domain,
            a.facilio_client_id, a.sync_status, a.created_at,
            (select count(*) from fl_deal d where d.account_id = a.id) as deal_count,
            (select count(*) from fl_lead l where l.account_id = a.id) as lead_count,
            count(*) over () as total_count
       from fl_account a
       ${clause}
      order by a.created_at desc
      limit ${filters.limit} offset ${filters.offset}`,
    params
  );

  const accounts: AccountListRow[] = rows.map(({ totalCount: _total, ...row }) => ({
    ...row,
    dealCount: Number(row.dealCount ?? 0),
    leadCount: Number(row.leadCount ?? 0),
  }));

  // The window total rides on every row, so a page and its count are one query.
  // It disappears when the page is past the end — a pager showing "0 results" on
  // page 3 would be a lie, and that is the only case worth a second query.
  const total = rows.length
    ? Number(rows[0].totalCount ?? 0)
    : filters.offset > 0
      ? count(`select count(*) as c from fl_account a ${clause}`, params)
      : 0;

  return { accounts, total, truncated };
}

// ── The write path (F-18, F-19, D-37) ────────────────────────────────────────

export interface AccountFields {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  websiteDomain?: string | null;
  address?: { street?: string | null; city?: string | null; state?: string | null } | null;
}

/**
 * F-18: an account no longer has to be born from a lead. A company can be a
 * client-to-be before anyone enquires — the BD team works accounts, not
 * inboxes. Dedup at the door mirrors convert's findAccount: the same domain or
 * email is the same company, and the error NAMES the existing record instead
 * of quietly making a twin.
 *
 * No Facilio enqueue here, deliberately: a hand-raised account is a CRM
 * record, and the client write belongs to the deal's Won moment — not to
 * typing a company in.
 */
export function createAccount(input: AccountFields & { actor: string | null }): { account: Account } {
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("an account needs the company name");

  const domain = (input.websiteDomain ?? "").trim().toLowerCase() || null;
  const email = (input.email ?? "").trim().toLowerCase() || null;

  const existing = one<{ id: string; name: string | null }>(
    `select id, name from fl_account
      where (lower(coalesce(website_domain, '')) = coalesce($1, '') and coalesce($1, '') <> '')
         or (lower(coalesce(email, '')) = coalesce($2, '') and coalesce($2, '') <> '')
         or lower(coalesce(name, '')) = lower($3)
      limit 1`,
    [domain, email, name]
  );
  if (existing) {
    throw new Error(
      `${existing.name ?? "an account"} already covers this company — work it there instead of creating a twin`
    );
  }

  const now = nowIso();
  const row = one<{ id: string }>(
    `insert into fl_account
       (id, lead_id, name, email, phone, website_domain, address_json,
        facilio_client_id, sync_status, data_json, created_at, updated_at)
     values (gen_random_uuid()::text, null, $1, $2, $3, $4, $5, null, 'pending', '{}', $6, $6)
     returning id`,
    [
      name,
      email,
      (input.phone ?? "").trim() || null,
      domain,
      JSON.stringify(input.address ?? {}),
      now,
    ]
  );
  if (!row) throw new Error("could not create account");

  appendEvent({
    entityType: "account",
    entityId: row.id,
    kind: "created",
    actor: input.actor,
    body: `${name} added by hand`,
  });

  const account = one<Account>(`select ${COLUMNS} from fl_account where id = $1 limit 1`, [row.id]);
  return { account: account as Account };
}

/**
 * F-19: the account page stops being read-only. LOCAL only, and honestly so:
 * the facilio-cmms connection has create-client but no update action (see
 * docs/connections.md), so a change here does not travel to a client already
 * in Facilio — the UI says that next to the button rather than letting the
 * two quietly diverge unannounced.
 */
export function updateAccount(
  accountId: string,
  fields: AccountFields,
  actor: string | null
): { account: Account } {
  const current = one<Account>(`select ${COLUMNS} from fl_account where id = $1 limit 1`, [accountId]);
  if (!current) throw new Error(`account ${accountId} not found`);

  const sets: string[] = [];
  const params: unknown[] = [accountId];
  const set = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };

  if (fields.name !== undefined) {
    const name = (fields.name ?? "").trim();
    if (!name) throw new Error("the company name cannot be blanked");
    set("name", name);
  }
  if (fields.email !== undefined) set("email", (fields.email ?? "").trim().toLowerCase() || null);
  if (fields.phone !== undefined) set("phone", (fields.phone ?? "").trim() || null);
  if (fields.websiteDomain !== undefined) {
    set("website_domain", (fields.websiteDomain ?? "").trim().toLowerCase() || null);
  }
  if (fields.address !== undefined) set("address_json", JSON.stringify(fields.address ?? {}));

  if (!sets.length) throw new Error("no editable fields supplied");

  params.push(nowIso());
  sets.push(`updated_at = $${params.length}`);
  mutate(`update fl_account set ${sets.join(", ")} where id = $1`, params);

  appendEvent({
    entityType: "account",
    entityId: accountId,
    kind: "updated",
    actor,
    body: `Updated ${Object.keys(fields).join(", ")}`,
    meta: current.facilioClientId
      ? { note: "local edit only — no update-client action exists on the connection yet" }
      : {},
  });

  const account = one<Account>(`select ${COLUMNS} from fl_account where id = $1 limit 1`, [accountId]);
  return { account: account as Account };
}

/**
 * D-37: contacts are a list you can grow, not a single frozen row from the
 * converting lead. One primary per account, enforced in the write: promoting a
 * contact demotes the rest in the same statement, so two primaries cannot
 * coexist even under concurrent clicks.
 *
 * A NEW contact is queued for Facilio through the same outbox convert uses —
 * the drain defers it until the client itself has synced, so ordering heals
 * itself. Edits stay local (no update action on the connection).
 */
export function saveContact(
  accountId: string,
  input: { id?: string | null; name: string; email?: string | null; phone?: string | null; isPrimary?: boolean },
  actor: string | null
): { contact: AccountContact } {
  const account = one<{ id: string }>(`select id from fl_account where id = $1 limit 1`, [accountId]);
  if (!account) throw new Error(`account ${accountId} not found`);

  const name = input.name.trim();
  if (!name) throw new Error("a contact needs a name");
  const email = (input.email ?? "").trim().toLowerCase() || null;
  const phone = (input.phone ?? "").trim() || null;
  const now = nowIso();

  let contactId = input.id ?? null;

  if (contactId) {
    const updated = mutate(
      `update fl_account_contact
          set name = $2, email = $3, phone = $4, updated_at = $5
        where id = $1 and account_id = $6`,
      [contactId, name, email, phone, now, accountId]
    );
    if (!updated) throw new Error(`contact ${contactId} not found on this account`);
  } else {
    const row = one<{ id: string }>(
      `insert into fl_account_contact
         (id, account_id, lead_id, name, email, phone, is_primary,
          facilio_contact_id, sync_status, data_json, created_at, updated_at)
       values (gen_random_uuid()::text, $1, null, $2, $3, $4, 'false', null, 'pending', '{}', $5, $5)
       returning id`,
      [accountId, name, email, phone, now]
    );
    if (!row) throw new Error("could not create contact");
    contactId = row.id;

    // Same key shape and dependency convert.ts uses — the drain resolves the
    // client id from the account row and defers until it exists.
    if (email) {
      enqueue({
        aggregateType: "contact",
        aggregateId: contactId,
        action: "create_client_contact",
        idempotencyKey: `contact:${contactId}:create_client_contact`,
        dependsOnId: accountId,
        payload: { accountId, name, email, phone },
      });
    }
  }

  if (input.isPrimary) {
    // Both sides in one statement each, promote last — a crash between the two
    // leaves zero primaries (recoverable), never two.
    mutate(`update fl_account_contact set is_primary = 'false', updated_at = $2 where account_id = $1`, [accountId, now]);
    mutate(`update fl_account_contact set is_primary = 'true', updated_at = $3 where id = $1 and account_id = $2`, [contactId, accountId, now]);
  }

  appendEvent({
    entityType: "account",
    entityId: accountId,
    kind: input.id ? "contact_updated" : "contact_added",
    actor,
    body: name,
  });

  const contact = one<AccountContact>(
    `select id, name, email, phone, is_primary, facilio_contact_id, sync_status, created_at
       from fl_account_contact where id = $1 limit 1`,
    [contactId]
  );
  return { contact: contact as AccountContact };
}

/**
 * F-08: queue the Facilio client (and its contacts) for an account — called
 * from the deal's WON transition, which is when a company becomes a client in
 * fact. Convert used to do this, which minted Facilio clients for deals that
 * then died; the local account row still appears at convert, only the outward
 * write moved.
 *
 * Idempotent end to end: the same deterministic keys convert used, plus the
 * facilio_client_id short-circuit, so a repeat win (reopen → won again) or a
 * legacy account that synced under the old convert-time rule never gets a
 * second client.
 */
export function queueClientSync(accountId: string, _actor: string | null): { queued: string[] } {
  const account = one<Account>(`select ${COLUMNS} from fl_account where id = $1 limit 1`, [accountId]);
  if (!account) throw new Error(`account ${accountId} not found`);

  const queued: string[] = [];

  const clientKey = `account:${accountId}:create_client`;
  if (!account.facilioClientId) {
    const contactRow = one<{ name: string | null; email: string | null; phone: string | null }>(
      `select name, email, phone from fl_account_contact
        where account_id = $1
        order by is_primary desc, created_at
        limit 1`,
      [accountId]
    );
    if (
      enqueue({
        aggregateType: "account",
        aggregateId: accountId,
        action: "create_client",
        idempotencyKey: clientKey,
        payload: {
          name: account.name,
          primaryContactEmail: contactRow?.email ?? account.email,
          primaryContactName: contactRow?.name ?? account.name,
          primaryContactPhone: contactRow?.phone ?? account.phone,
          address: {
            street: account.address?.street ?? undefined,
            city: account.address?.city ?? undefined,
            state: account.address?.state ?? undefined,
          },
        },
      }).created
    ) {
      queued.push(clientKey);
    }
  }

  // Every contact with an email and no Facilio id yet. The drain defers each
  // until the client itself has synced — ordering heals itself.
  const contacts = manyWithTruncation<{ id: string; name: string | null; email: string | null; phone: string | null }>(
    `select id, name, email, phone from fl_account_contact
      where account_id = $1 and facilio_contact_id is null
        and coalesce(email, '') <> ''
      order by is_primary desc, created_at
      limit 50`,
    [accountId]
  ).rows;

  for (const c of contacts) {
    const key = `contact:${c.id}:create_client_contact`;
    if (
      enqueue({
        aggregateType: "contact",
        aggregateId: c.id,
        action: "create_client_contact",
        idempotencyKey: key,
        dependsOnId: accountId,
        payload: { accountId, name: c.name ?? account.name, email: c.email, phone: c.phone },
      }).created
    ) {
      queued.push(key);
    }
  }

  return { queued };
}
