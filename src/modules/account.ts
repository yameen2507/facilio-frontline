/**
 * The account aggregate — the company behind one or more converted leads.
 *
 * Read-only, deliberately. An account is created by `convert` (one per company,
 * never one per lead — see findAccount there) and touched afterwards only by the
 * outbox stamping `facilio_client_id`. An edit here would silently diverge from
 * the Facilio client this row mirrors, so `update` waits until there is an
 * `update_client` outbox action to push the change through.
 *
 * The detail view is what makes the lead → account link visible: every lead that
 * resolved to this company, and every deal those leads opened.
 */

import { count, manyWithTruncation, one } from "../shared/db";

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
