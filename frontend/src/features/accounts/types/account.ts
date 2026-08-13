/**
 * Account domain types.
 *
 * `isPrimary` is a STRING. There is no boolean column type in the app database, so
 * flags travel as `"true"` / `"false"` — comparing the raw value to `true` is
 * always false and is the bug this type exists to prevent.
 */

export type Address = { street?: string | null; city?: string | null; state?: string | null };

export type Account = {
  id: string;
  name?: string | null;
  websiteDomain?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: Address | null;
  /** Null until the outbox has written the client to Facilio — normal for a minute. */
  facilioClientId?: string | null;
  createdAt?: string | null;
  leadCount: number;
  dealCount: number;
};

export type Contact = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: string | null;
};

export type DealStage = "open" | "won" | "lost" | string;

export type Deal = {
  id: string;
  refNo: string;
  title?: string | null;
  stage: DealStage;
  estimatedValue?: number | string | null;
  currency?: string | null;
  salesOwnerEmail?: string | null;
};

/** The lead rows shown on a company page — a subset of the full lead. */
export type AccountLead = {
  id: string;
  refNo: string;
  source: string;
  serviceType?: string | null;
  status: string;
  score?: number | null;
  createdAt: string;
};

export type AccountListResponse = {
  accounts: Account[];
  total: number;
  truncated?: boolean;
};

export type AccountDetailResponse = {
  account: Account;
  contacts: Contact[];
  deals: Deal[];
  leads: AccountLead[];
};
