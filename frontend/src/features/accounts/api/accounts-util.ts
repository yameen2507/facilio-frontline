/**
 * The accounts data layer. Both endpoints are LIVE — no seam here.
 *
 * | handler        | returns                                     |
 * | -------------- | ------------------------------------------- |
 * | `account-list` | `{ accounts[], total, truncated }`           |
 * | `account-get`  | `{ account, contacts[], deals[], leads[] }`  |
 */

import { request, requestFrom } from "../../../lib/request";
import type { AccountDetailResponse, AccountListResponse } from "../types/account";

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
