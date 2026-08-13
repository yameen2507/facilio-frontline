/**
 * The accounts data layer. Both endpoints are LIVE — no seam here.
 *
 * | handler        | returns                                     |
 * | -------------- | ------------------------------------------- |
 * | `account-list` | `{ accounts[], total, truncated }`           |
 * | `account-get`  | `{ account, contacts[], deals[], leads[] }`  |
 */

import { request } from "../../../lib/request";
import type { AccountDetailResponse, AccountListResponse } from "../types/account";

export const LIST_LIMIT = 100;

export const listAccounts = (search: string) =>
  request<AccountListResponse>("account-list", {
    limit: LIST_LIMIT,
    // Sent only when non-empty: a blank flat field is dropped upstream as an
    // unresolved connection-action template rather than arriving as "".
    ...(search ? { search } : {}),
  });

export const getAccount = (accountId: string) => request<AccountDetailResponse>("account-get", { accountId });
