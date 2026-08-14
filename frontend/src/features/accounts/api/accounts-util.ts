/**
 * The accounts data layer. Every endpoint is LIVE — no seam here.
 *
 * | handler                | returns                                     |
 * | ---------------------- | ------------------------------------------- |
 * | `account-list`         | `{ accounts[], total, truncated }`          |
 * | `account-get`          | `{ account, contacts[], deals[], leads[] }` |
 * | `account-create`       | `{ account }`                               |
 * | `account-update`       | `{ account }` — LOCAL edit, see F-19        |
 * | `account-contact-save` | `{ contact }`                               |
 */

import { request, requestFrom } from "../../../lib/request";
import type {
  Account,
  AccountDetailResponse,
  AccountListResponse,
  Contact,
} from "../types/account";

/** A survey as this page lists it — the slim view, not the survey module's full shape. */
export type AccountSurvey = {
  id: string;
  refNo: string;
  title: string | null;
  status: string;
  templateName?: string | null;
  visitCount?: number;
  createdAt?: string | null;
};

/**
 * Surveys raised on this account's deals — served by the `survey` function
 * (its list already filters by account). Called directly rather than importing
 * the surveys feature's api-util: features do not import each other's internals.
 */
export const listAccountSurveys = (accountId: string) =>
  requestFrom<{ surveys: AccountSurvey[] }>("survey", "list", { accountId, limit: 50 });

export const LIST_LIMIT = 100;

export const listAccounts = (search: string) =>
  request<AccountListResponse>("account-list", {
    limit: LIST_LIMIT,
    // Sent only when non-empty: a blank flat field is dropped upstream as an
    // unresolved connection-action template rather than arriving as "".
    ...(search ? { search } : {}),
  });

export const getAccount = (accountId: string) => request<AccountDetailResponse>("account-get", { accountId });

// ── The write path (F-18, F-19, D-37) ────────────────────────────────────────

export type AccountFields = {
  name?: string;
  email?: string;
  phone?: string;
  websiteDomain?: string;
  street?: string;
  city?: string;
  state?: string;
};

/** `account-create` — F-18: an account raised by hand, no lead required.
    Dedupes server-side and names the existing record when it matches. */
export const createAccount = (fields: AccountFields & { name: string }, actorEmail: string) =>
  request<{ account: Account }>("account-create", {
    ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== "")),
    actorEmail,
  });

/** `account-update` — F-19. LOCAL only: the connection has no update-client
    action, so a client already in Facilio is not changed by this. */
export const updateAccount = (accountId: string, fields: AccountFields, actorEmail: string) =>
  request<{ account: Account }>("account-update", { accountId, ...fields, actorEmail });

/** `account-contact-save` — D-37: add or edit a contact; one primary per
    account, enforced server-side. */
export const saveContact = (
  accountId: string,
  contact: { contactId?: string; name: string; email?: string; phone?: string; isPrimary?: boolean },
  actorEmail: string
) =>
  request<{ contact: Contact }>("account-contact-save", {
    accountId,
    ...Object.fromEntries(
      Object.entries(contact).filter(([, v]) => v !== undefined && v !== "")
    ),
    ...(contact.isPrimary ? { isPrimary: "true" } : {}),
    actorEmail,
  });
