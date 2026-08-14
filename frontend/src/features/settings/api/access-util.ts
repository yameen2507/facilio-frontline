/**
 * Users, roles and permissions data layer. Every handler is LIVE — no seam.
 *
 * | handler           | args                                        | returns       |
 * | ----------------- | ------------------------------------------- | ------------- |
 * | `user-list`       | —                                           | `{ users[] }` |
 * | `user-save`       | payload: user fields + actorEmail           | `{ user }`    |
 * | `role-list`       | —                                           | `{ roles[] }` |
 * | `role-save`       | payload: {id?, name, description?, active?, actorEmail} | `{ role }` |
 * | `role-set-active` | roleId, active ("true"/"false"), actorEmail | `{ role }`    |
 * | `permissions-put` | payload: {changes: {roleId: matrix}, actorEmail} | `{ updated }` |
 *
 * `bootstrap` is deliberately not wrapped here: the app-level AccessProvider
 * (app/access.tsx) owns that call, and app/ never imports from features/.
 * The user/role types live there too — one source of truth, imported in the
 * allowed direction.
 */

import { requestFrom, type Result } from "../../../lib/request";
import type { AccessRole, AccessUser, PermissionMatrix } from "../../../app/access";

/** Its own platform function — never widen `lead` for a different module. */
const FN = "access";

const call = <T>(handler: string, args: Record<string, unknown> = {}): Promise<Result<T>> =>
  requestFrom<T>(FN, handler, args);

/** Arrays and objects cannot be flat fields — they ride in `payload`. */
const payload = (body: Record<string, unknown>) => ({ payload: JSON.stringify(body) });

/** What the user dialog collects. Blank optionals are dropped before the wire. */
export type SaveUserInput = {
  id?: string;
  name: string;
  email: string;
  roleId: string;
  team?: string;
  region?: string;
  department?: string;
  managerEmail?: string;
  status: string;
  jobTitle?: string;
  phone?: string;
};

// ── Users ────────────────────────────────────────────────────────────────────

/** `access.user-list` — every user with their role name, ordered by name. */
export const listUsers = () => call<{ users: AccessUser[] }>("user-list");

/** `access.user-save` — create (no id) or update (id). One role per user; the
    email must be unique, and the server says so verbatim when it is not. */
export const saveUser = (input: SaveUserInput, actorEmail: string) =>
  call<{ user: AccessUser }>("user-save", payload({ ...input, actorEmail }));

// ── Roles ────────────────────────────────────────────────────────────────────

/** `access.role-list` — all roles with their permission matrices, display order. */
export const listRoles = () => call<{ roles: AccessRole[] }>("role-list");

/** `access.role-save` — create (no id) or update. System roles keep their name
    and stay active; the server rejects anything else. */
export const saveRole = (
  input: { id?: string; name: string; description?: string; active?: string },
  actorEmail: string
) => call<{ role: AccessRole }>("role-save", payload({ ...input, actorEmail }));

/** `access.role-set-active` — flip a role on or off. Its users keep view-only
    access while it is off. No page calls this today (RoleDialog saves status
    through `role-save`); it is kept for parity with the handler table, where
    the flat-field shape serves the CLI and published connection actions. */
export const setRoleActive = (roleId: string, active: "true" | "false", actorEmail: string) =>
  call<{ role: AccessRole }>("role-set-active", { roleId, active, actorEmail });

// ── Permissions ──────────────────────────────────────────────────────────────

/** `access.permissions-put` — replaces the whole matrix of each role in
    `changes`; only send the roles the admin actually edited. */
export const putPermissions = (changes: Record<string, PermissionMatrix>, actorEmail: string) =>
  call<{ updated: number }>("permissions-put", payload({ changes, actorEmail }));
