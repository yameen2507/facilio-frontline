/**
 * Who is signed in, what their role is, and what it may do.
 *
 * Lives in `app/` because the shell and any feature may ask — and `app/` never
 * imports from `features/`, so the bootstrap call goes straight to the `access`
 * function rather than through the settings module's api-util. The settings
 * pages import their types FROM here (feature → app is the allowed direction),
 * so the user/role shapes have one source of truth.
 *
 * `can()` FAILS OPEN, three ways, deliberately:
 *
 *   - while the bootstrap is loading — hiding controls for a beat and then
 *     revealing them reads as flicker, and this gate is UX, not security (the
 *     functions runtime carries no caller identity, so nothing server-side
 *     enforces it either way);
 *   - when the signed-in email has no user record — an admin who has not typed
 *     their colleagues in yet must not have access control block the whole team;
 *   - for a system role — an accidentally-emptied matrix can never lock the
 *     administrators out.
 *
 * An INACTIVE user or role fails closed instead (view only): those are explicit
 * admin decisions, not missing setup.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { requestFrom } from "../lib/request";
import { useUser } from "./auth";

/** `{ module: [action, ...] }` — an absent module means no access to it. */
export type PermissionMatrix = Record<string, string[]>;

/** Booleans are the strings "true"/"false" — no boolean column exists. */
export type AccessRole = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: string;
  isSystem: string;
  sortOrder: number;
  permissions: PermissionMatrix;
};

export type AccessUser = {
  id: string;
  name: string;
  email: string;
  roleId: string;
  /** Joined server-side on `user-list` only. */
  roleName?: string | null;
  team: string | null;
  region: string | null;
  department: string | null;
  managerEmail: string | null;
  status: string; // active | inactive
  jobTitle: string | null;
  phone: string | null;
};

type AccessApi = {
  /** The signed-in person's user record — null until loaded or when the admin
      has not added them yet. */
  me: AccessUser | null;
  /** `me`'s role, resolved from the bootstrap's role list. */
  role: AccessRole | null;
  loading: boolean;
  can: (module: string, action: string) => boolean;
  /** Re-runs the bootstrap — the permissions page calls this after a save so
      gates update without a reload. */
  refresh: () => void;
};

const AccessContext = createContext<AccessApi>({
  me: null,
  role: null,
  loading: true,
  can: () => true,
  refresh: () => {},
});

export const useAccess = () => useContext(AccessContext);

export function AccessProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const email = user?.email ?? "";
  const name = user?.name ?? "";

  const [me, setMe] = useState<AccessUser | null>(null);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // No email means the platform gave us no identity to look up; stay
    // fail-open rather than blocking the app on a session quirk.
    if (!email) {
      setLoading(false);
      return;
    }
    let live = true;
    requestFrom<{ me: AccessUser | null; roles: AccessRole[]; provisioned: boolean }>(
      "access",
      "bootstrap",
      // The name rides along so first-run auto-provisioning records a display
      // name instead of deriving one from the email.
      { email, ...(name ? { name } : {}) }
    ).then(({ data }) => {
      if (!live) return;
      setLoading(false);
      // A failed bootstrap leaves me null — fail-open, per the header.
      if (data) {
        setMe(data.me);
        setRoles(data.roles);
      }
    });
    return () => {
      live = false;
    };
  }, [email, name, reloadKey]);

  const role = useMemo(
    () => (me ? (roles.find((r) => r.id === me.roleId) ?? null) : null),
    [me, roles]
  );

  const can = useCallback(
    (module: string, action: string): boolean => {
      if (loading || !me || !role) return true; // fail-open — see the header
      // Deactivation is an explicit admin decision: read-only from here.
      if (me.status !== "active" || role.active !== "true") return action === "view";
      if (role.isSystem === "true") return true;
      return role.permissions[module]?.includes(action) ?? false;
    },
    [loading, me, role]
  );

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const value = useMemo(
    () => ({ me, role, loading, can, refresh }),
    [me, role, loading, can, refresh]
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}
