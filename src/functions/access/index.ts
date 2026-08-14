/**
 * Platform function `access` — users, roles and the permission matrix.
 *
 * Thin adapters only: read input, call src/modules/access, return the envelope.
 * One platform function per module (ARCHITECTURE.md §9 rule 4) — this exists so
 * the access module never widens `lead`.
 *
 * | handler          | args                              | returns                     |
 * |------------------|-----------------------------------|-----------------------------|
 * | seed             | actorEmail?                       | { created }                 |
 * | bootstrap        | email, name?                      | { me, roles, provisioned }  |
 * | user-list        | —                                 | { users }                   |
 * | user-save        | payload {user fields, actorEmail} | { user }                    |
 * | role-list        | —                                 | { roles }                   |
 * | role-save        | payload {id?, name, description?, active?, actorEmail} | { role } |
 * | role-set-active  | roleId, active, actorEmail        | { role }                    |
 * | permissions-put  | payload {changes, actorEmail}     | { updated }                 |
 *
 * `actorEmail` is client-asserted on every mutation — the runtime carries no
 * caller identity, so it is an audit label, not authentication.
 */

import StudioFunctions from "@facilio/studio-functions";
import { handle, oneOf, optStr, parsePayload, str } from "../../shared/envelope";
import {
  bootstrap,
  listRoles,
  listUsers,
  putPermissions,
  saveRole,
  saveUser,
  seedDefaultRoles,
  USER_STATUSES,
  setRoleActive,
} from "../../modules/access";

const S = (description: string) => ({ description, type: "string" as const });

/** Every handler accepts the envelope as an alternative to flat fields. */
const ENV = { payload: S("Optional: the whole input as a JSON object string") };
const ACTOR = S("Email of the user performing this action");

const server = new StudioFunctions({ name: "access" });

server.addHandler({
  name: "seed",
  description: "Insert the eight default roles from the spec if absent — idempotent",
  parameters: { ...ENV, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return seedDefaultRoles(optStr(p, "actorEmail"));
    }),
});

server.addHandler({
  name: "bootstrap",
  description:
    "Session bootstrap: the caller's user record and every role with its permission matrix. " +
    "Seeds default roles on first run; the first caller ever seen becomes the System Admin.",
  parameters: {
    ...ENV,
    email: S("Email of the signed-in user"),
    name: S("Optional display name, used only if this call auto-provisions the first user"),
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return bootstrap(str(p, "email"), optStr(p, "name"));
    }),
});

server.addHandler({
  name: "user-list",
  description: "All users with their role name, ordered by name",
  parameters: {},
  execute: async () => handle(() => ({ users: listUsers() })),
});

server.addHandler({
  name: "user-save",
  description:
    "Create (no id) or update (id) a user. Exactly one role per user; email must be unique.",
  parameters: { ...ENV, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return {
        user: saveUser(
          {
            id: optStr(p, "id"),
            name: str(p, "name"),
            email: str(p, "email"),
            roleId: str(p, "roleId"),
            team: optStr(p, "team"),
            region: optStr(p, "region"),
            department: optStr(p, "department"),
            managerEmail: optStr(p, "managerEmail"),
            status: oneOf(p, "status", USER_STATUSES),
            jobTitle: optStr(p, "jobTitle"),
            phone: optStr(p, "phone"),
          },
          str(p, "actorEmail")
        ),
      };
    }),
});

server.addHandler({
  name: "role-list",
  description: "All roles with their permission matrices, in display order",
  parameters: {},
  execute: async () => handle(() => ({ roles: listRoles() })),
});

server.addHandler({
  name: "role-save",
  description:
    "Create (no id) or update (id) a role. System roles keep their name and stay active.",
  parameters: { ...ENV, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return {
        role: saveRole(
          {
            id: optStr(p, "id"),
            name: str(p, "name"),
            description: optStr(p, "description"),
            active: optStr(p, "active"),
          },
          str(p, "actorEmail")
        ),
      };
    }),
});

server.addHandler({
  name: "role-set-active",
  description: "Activate or deactivate a role. System roles cannot be deactivated.",
  parameters: {
    ...ENV,
    roleId: S("Role id (uuid)"),
    active: S("'true' or 'false'"),
    actorEmail: ACTOR,
  },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      return {
        role: setRoleActive(
          str(p, "roleId"),
          oneOf(p, "active", ["true", "false"] as const),
          str(p, "actorEmail")
        ),
      };
    }),
});

server.addHandler({
  name: "permissions-put",
  description:
    "Replace the permission matrix for each role in `changes` ({ roleId: { module: [action] } }). " +
    "System roles are rejected — they are immutable full access.",
  parameters: { ...ENV, actorEmail: ACTOR },
  execute: async (args) =>
    handle(() => {
      const p = parsePayload(args);
      const changes = p.changes;
      if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
        throw new Error("changes must be an object of roleId → permission matrix");
      }
      return putPermissions(changes as Record<string, unknown>, str(p, "actorEmail"));
    }),
});

server.execute();
