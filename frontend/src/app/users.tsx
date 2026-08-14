/**
 * The user directory, for every feature that shows a person (X-05) or picks
 * one (D-19). Lives in `app/` for the same reason access.tsx does: the shell
 * and any feature may ask, features never import each other, and the call
 * goes straight to the `access` function — features/settings' api-util is that
 * module's own data layer, not a shared client.
 *
 * Loaded LAZILY and cached at module level: the first surface that needs
 * people pays for one `user-list`, every later mount reads the settled
 * promise. Nothing here is security — this is display data, and the list is
 * the same one Settings → Users shows. The cache lives for the session; a
 * user added mid-session appears after a reload, which is the same freshness
 * every other list in the app has.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { requestFrom } from "../lib/request";

export type DirectoryUser = {
  id: string;
  name: string;
  email: string;
  roleName?: string | null;
  team: string | null;
  region: string | null;
  status: string;
};

type Directory = { users: DirectoryUser[]; error: string | null };

let settled: Directory | null = null;
let inflight: Promise<Directory> | null = null;

function load(): Promise<Directory> {
  if (settled) return Promise.resolve(settled);
  inflight ??= requestFrom<{ users: DirectoryUser[] }>("access", "user-list").then(
    ({ data, error }) => {
      settled = { users: data?.users ?? [], error };
      // A failed load is NOT cached as final — the next mount retries.
      if (error) settled = null;
      return { users: data?.users ?? [], error };
    }
  );
  return inflight.finally(() => {
    inflight = null;
  });
}

export function useUserDirectory(): {
  users: DirectoryUser[];
  loading: boolean;
  error: string | null;
  /** The person's name for an email, or the email itself when unknown —
      never blank, so a legacy row still identifies somebody. */
  nameOf: (email: string | null | undefined) => string;
} {
  const [dir, setDir] = useState<Directory | null>(settled);

  useEffect(() => {
    let alive = true;
    if (!dir) load().then((d) => alive && setDir(d));
    return () => {
      alive = false;
    };
  }, [dir]);

  const users = dir?.users ?? [];
  // Memoised: list pages call nameOf once per row, and rebuilding the map per
  // row would make the directory quadratic on exactly the surfaces it serves.
  const byEmail = useMemo(
    () => new Map(users.map((u) => [u.email.toLowerCase(), u.name])),
    [users]
  );
  const nameOf = useCallback(
    (email: string | null | undefined) =>
      email ? (byEmail.get(email.toLowerCase()) ?? email) : "",
    [byEmail]
  );

  return { users, loading: dir === null, error: dir?.error ?? null, nameOf };
}
