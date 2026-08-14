/**
 * Users, roles and the permission matrix — roles&response spec §5–§9.
 *
 * The model is deliberately small (spec §11):
 *
 *   USER → ONE ROLE → ROLE PERMISSIONS → MODULE ACCESS → CRUD/ACTION PERMISSIONS
 *
 * A user has exactly one role (a single lookup, spec §12). Permissions are
 * configured per ROLE, never per user, and live WHOLE in
 * `fl_role.data_json.permissions` as `{ module: [action, ...] }` — no matrix
 * table, because the matrix is read whole, written whole, and enforcement is
 * client-side: the functions runtime carries no caller identity, so `actor` on
 * every mutation here is client-asserted and the matrix is UX policy, not
 * security. The catalog of module/action ids is owned by the frontend
 * (features/settings/data/permission-catalog.ts); this module validates only
 * the SHAPE of a matrix, since an unknown action string is simply never
 * matched by the UI's can().
 *
 * System Admin (ROLE-001) is immutable full access: `is_system = 'true'` in
 * data, and every mutator here rejects it, so no sequence of API calls can
 * lock the administrators out.
 *
 * `org_id` exists on both tables for the coming Organization module. It is
 * written null today: handlers receive no org context (see
 * src/types/studio-functions.d.ts), the schema is single-org, and a backfill
 * is one UPDATE when organizations land.
 */

import { many, mutate, nowIso, one } from "../shared/db";
import { appendEvent } from "../shared/events";
import { parseJson } from "../shared/row-map";
import { nextRef } from "../shared/ids";

// --- types --------------------------------------------------------------------

/** `{ module: [action, ...] }` — absent module means no access to it. */
export type PermissionMatrix = Record<string, string[]>;

/** Booleans are the strings 'true'/'false' — no boolean column exists (§3a). */
export interface RoleRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: string;
  isSystem: string;
  sortOrder: number;
  permissions: PermissionMatrix;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  roleId: string;
  /** Joined for lists; absent on save responses (the list is refetched). */
  roleName?: string | null;
  team: string | null;
  region: string | null;
  department: string | null;
  managerEmail: string | null;
  status: string; // active | inactive
  jobTitle: string | null;
  phone: string | null;
}

export interface SaveUserInput {
  id?: string | null;
  name: string;
  email: string;
  roleId: string;
  team?: string | null;
  region?: string | null;
  department?: string | null;
  managerEmail?: string | null;
  status: string;
  jobTitle?: string | null;
  phone?: string | null;
}

export interface SaveRoleInput {
  id?: string | null;
  name: string;
  description?: string | null;
  active?: string | null;
}

export const USER_STATUSES = ["active", "inactive"] as const;

// --- the eight default roles (spec §5 — the spec itself skips ROLE-006) --------

/**
 * Default matrices: Lead Actioner and Sales Manager follow the spec §9 example
 * columns verbatim; the rest follow §6's responsibility descriptions. All of it
 * is a starting point the admin edits in Settings — nothing reads these after
 * seeding.
 */
const DEFAULT_ROLES: Array<{
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  sortOrder: number;
  permissions: PermissionMatrix;
}> = [
  {
    code: "ROLE-001",
    name: "System Admin",
    description: "Full system administration",
    isSystem: true,
    sortOrder: 1,
    // Empty on purpose: can() short-circuits on isSystem, and the matrix UI
    // renders this column checked and disabled. Storing a copy of "everything"
    // would just go stale as the catalog grows.
    permissions: {},
  },
  {
    code: "ROLE-002",
    name: "Management",
    description: "Management visibility",
    isSystem: false,
    sortOrder: 2,
    permissions: {
      leads: ["view", "export"],
      accounts: ["view", "export"],
      surveys: ["view"],
      templates: ["view"],
      settings: ["view"],
    },
  },
  {
    code: "ROLE-003",
    name: "Sales Manager",
    description: "Manage sales team and pipeline",
    isSystem: false,
    sortOrder: 3,
    permissions: {
      leads: [
        "view",
        "create",
        "edit",
        "delete",
        "assign",
        "qualify",
        "disqualify",
        "convert",
        "send_email",
        "add_note",
        "export",
      ],
      accounts: ["view", "create", "edit", "export"],
      surveys: ["view", "create", "assign", "schedule"],
      templates: ["view"],
      // The commercial authority sits here rather than with the estimator:
      // approving a deviation from the rate card is a manager's call, and an
      // estimator who could approve their own discount is not a control.
      // Withdrawing a live offer is the same kind of decision.
      proposals: [
        "view",
        "create",
        "edit",
        "submit",
        "approve",
        "return",
        "send",
        "withdraw",
        "respond",
        "revise",
        "export",
      ],
      // View only. Changing the price list is an admin job — a manager who can
      // edit the card can grant themselves any discount without an approval
      // ever being asked for.
      rate_cards: ["view"],
      settings: ["view"],
    },
  },
  {
    code: "ROLE-004",
    name: "Lead Actioner",
    description: "Process and qualify leads",
    isSystem: false,
    sortOrder: 4,
    permissions: {
      leads: [
        "view",
        "create",
        "edit",
        "assign",
        "qualify",
        "disqualify",
        "convert",
        "send_email",
        "add_note",
      ],
      accounts: ["view", "create"],
      surveys: ["view"],
      templates: ["view"],
    },
  },
  {
    code: "ROLE-005",
    name: "Sales Executive",
    description: "Manage assigned sales opportunities",
    isSystem: false,
    sortOrder: 5,
    permissions: {
      leads: ["view", "edit", "send_email", "add_note"],
      accounts: ["view", "edit"],
      surveys: ["view", "create", "schedule"],
      templates: ["view"],
    },
  },
  {
    code: "ROLE-007",
    name: "Surveyor",
    description: "Conduct site surveys",
    isSystem: false,
    sortOrder: 6,
    permissions: {
      surveys: ["view", "edit", "submit"],
    },
  },
  {
    code: "ROLE-008",
    name: "Estimator / Commercial",
    description: "Pricing and proposals",
    isSystem: false,
    sortOrder: 7,
    permissions: {
      leads: ["view"],
      accounts: ["view"],
      surveys: ["view"],
      templates: ["view"],
      // This role owns the proposal end to end EXCEPT the two moves that check
      // it: `approve` and `return` belong to the Sales Manager, because a
      // deviation approved by the person who priced it is not an approval.
      proposals: [
        "view",
        "create",
        "edit",
        "submit",
        "send",
        "withdraw",
        "respond",
        "revise",
        "export",
      ],
      // The estimator maintains the price list — importing and re-cutting a
      // card is their day job — but activating one is not, for the same reason
      // as above: an active card is what every deviation is measured against.
      rate_cards: ["view", "create", "edit", "import"],
    },
  },
  {
    code: "ROLE-009",
    name: "Operations Manager",
    description: "Operational handover",
    isSystem: false,
    sortOrder: 8,
    permissions: {
      accounts: ["view"],
      surveys: ["view"],
    },
  },
];

// --- column lists -------------------------------------------------------------

const USER_COLS = `id, name, email, role_id, team, region, department,
  manager_email, status, job_title, phone, created_at, updated_at`;

/** Tolerates an empty/malformed data_json blob — same guard as configData(). */
const ROLE_PERMISSIONS_SQL = `(coalesce(nullif(data_json::text, ''), '{}'))::jsonb -> 'permissions' as permissions_json`;

const ROLE_COLS = `id, code, name, description, active, is_system, sort_order, ${ROLE_PERMISSIONS_SQL}`;

const normalizeRole = (r: RoleRecord): RoleRecord => ({
  ...r,
  permissions:
    r.permissions && typeof r.permissions === "object" && !Array.isArray(r.permissions)
      ? r.permissions
      : {},
});

// --- seeding --------------------------------------------------------------------

/** Idempotent — one INSERT…WHERE NOT EXISTS per role, safe to re-run forever. */
export function seedDefaultRoles(actor: string | null): { created: number } {
  const now = nowIso();
  let created = 0;

  for (const role of DEFAULT_ROLES) {
    created += mutate(
      `insert into fl_role
         (id, org_id, code, name, description, active, is_system, sort_order,
          created_by, updated_by, data_json, created_at, updated_at)
       select gen_random_uuid()::text, null, $1, $2, $3, 'true', $4, $5, $6, $6, $7, $8, $8
       where not exists (select 1 from fl_role where code = $1)`,
      [
        role.code,
        role.name,
        role.description,
        role.isSystem ? "true" : "false",
        role.sortOrder,
        actor,
        JSON.stringify({ permissions: role.permissions }),
        now,
      ]
    );
  }

  // Fixed codes end at ROLE-009, so user-created roles mint from 10 up.
  // `current_value < 9` keeps this from ever rewinding a busier counter.
  mutate(
    `update fl_sequence set current_value = 9, updated_at = $1
      where name = 'role' and current_value < 9`,
    [now]
  );

  if (created > 0) {
    appendEvent({
      entityType: "role",
      entityId: "defaults",
      kind: "role.seeded",
      actor,
      body: `Seeded ${created} default roles`,
      meta: { created },
    });
  }

  return { created };
}

// --- bootstrap ------------------------------------------------------------------

export interface BootstrapResult {
  me: UserRecord | null;
  roles: RoleRecord[];
  provisioned: boolean;
}

interface BootstrapData {
  me: UserRecord | null;
  roles: RoleRecord[];
  usersCount: number;
}

/** One statement for the whole session bootstrap — see shared/db.ts on why. */
function bootstrapData(email: string): BootstrapData {
  const row = one<{ me: UserRecord | null; roles: RoleRecord[]; usersCount: unknown }>(
    `select
       (select row_to_json(x) from (
          select ${USER_COLS} from fl_user where email_norm = $1 limit 1
        ) x) as me_obj,

       (select coalesce(json_agg(x order by x.sort_order, x.code), '[]'::json) from (
          select ${ROLE_COLS} from fl_role order by sort_order, code limit 200
        ) x) as roles_arr,

       (select count(*) from fl_user) as users_count`,
    [email.toLowerCase()]
  );

  return {
    me: row?.me ?? null,
    roles: (row?.roles ?? []).map(normalizeRole),
    // count(*) is a string on the wire and users_count is not a mapped column.
    usersCount: Number(row?.usersCount ?? 0),
  };
}

/**
 * Session bootstrap: who am I, and what may each role do.
 *
 * Two one-time branches make a fresh install work with zero manual steps:
 * roles seed themselves on the first call after import, and the first caller
 * ever seen becomes the System Admin — `usersCount === 0` is the guard, so it
 * can happen exactly once, and the audit event records who it was. The steady
 * state is one database call.
 */
export function bootstrap(email: string, name: string | null): BootstrapResult {
  let data = bootstrapData(email);
  let provisioned = false;

  if (data.roles.length === 0) {
    seedDefaultRoles(email);
    data = bootstrapData(email);
  }

  if (data.usersCount === 0) {
    const now = nowIso();
    // Selecting FROM fl_role while guarding on fl_user keeps this one atomic
    // statement — there are no transactions to lean on.
    const inserted = mutate(
      `insert into fl_user
         (id, org_id, name, email, email_norm, role_id, team, region, department,
          manager_email, status, job_title, phone, created_by, updated_by,
          data_json, created_at, updated_at)
       select gen_random_uuid()::text, null, $1, $2, $3, r.id, null, null, null,
              null, 'active', null, null, $2, $2, '{}', $4, $4
         from fl_role r
        where r.code = 'ROLE-001'
          and not exists (select 1 from fl_user)`,
      [name ?? email.split("@")[0], email, email.toLowerCase(), now]
    );

    if (inserted > 0) {
      provisioned = true;
      appendEvent({
        entityType: "user",
        entityId: email.toLowerCase(),
        kind: "user.provisioned",
        actor: email,
        body: "First sign-in auto-provisioned as System Admin",
      });
      data = bootstrapData(email);
    }
  }

  return { me: data.me, roles: data.roles, provisioned };
}

// --- users ----------------------------------------------------------------------

export function listUsers(): UserRecord[] {
  // Unqualified columns resolve against fl_user — the only relation in FROM.
  return many<UserRecord>(
    `select ${USER_COLS},
            (select r.name from fl_role r where r.id = fl_user.role_id limit 1) as role_name
       from fl_user
      order by name
      limit 500`
  );
}

export function saveUser(input: SaveUserInput, actor: string): UserRecord {
  const email = input.email.trim();
  const emailNorm = email.toLowerCase();
  const now = nowIso();

  if (input.id) {
    const updated = one<UserRecord>(
      `update fl_user set
         name = $2, email = $3, email_norm = $4, role_id = $5, team = $6,
         region = $7, department = $8, manager_email = $9, status = $10,
         job_title = $11, phone = $12, updated_by = $13, updated_at = $14
       where id = $1
         and exists (select 1 from fl_role where id = $5)
         and not exists (select 1 from fl_user where email_norm = $4 and id <> $1)
       returning ${USER_COLS}`,
      [
        input.id,
        input.name,
        email,
        emailNorm,
        input.roleId,
        input.team ?? null,
        input.region ?? null,
        input.department ?? null,
        input.managerEmail ?? null,
        input.status,
        input.jobTitle ?? null,
        input.phone ?? null,
        actor,
        now,
      ]
    );
    if (!updated) throw new Error(explainUserSaveFailure(input.id, input.roleId, emailNorm));

    appendEvent({
      entityType: "user",
      entityId: updated.id,
      kind: "user.updated",
      actor,
      body: `Updated user ${updated.name}`,
      meta: { email: updated.email, roleId: updated.roleId, status: updated.status },
    });
    return updated;
  }

  const created = one<UserRecord>(
    `insert into fl_user
       (id, org_id, name, email, email_norm, role_id, team, region, department,
        manager_email, status, job_title, phone, created_by, updated_by,
        data_json, created_at, updated_at)
     select gen_random_uuid()::text, null, $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $12, '{}', $13, $13
     where exists (select 1 from fl_role where id = $4)
       and not exists (select 1 from fl_user where email_norm = $3)
     returning ${USER_COLS}`,
    [
      input.name,
      email,
      emailNorm,
      input.roleId,
      input.team ?? null,
      input.region ?? null,
      input.department ?? null,
      input.managerEmail ?? null,
      input.status,
      input.jobTitle ?? null,
      input.phone ?? null,
      actor,
      now,
    ]
  );
  if (!created) throw new Error(explainUserSaveFailure(null, input.roleId, emailNorm));

  appendEvent({
    entityType: "user",
    entityId: created.id,
    kind: "user.created",
    actor,
    body: `Created user ${created.name}`,
    meta: { email: created.email, roleId: created.roleId, status: created.status },
  });
  return created;
}

/**
 * The guarded write is one atomic statement, so a zero-row result is ambiguous.
 * This runs only on the failure path, where a second call's latency is fine and
 * a precise message is worth it.
 */
function explainUserSaveFailure(id: string | null, roleId: string, emailNorm: string): string {
  // A SQL boolean's wire shape is not guaranteed here — accept every spelling.
  const truthy = (v: unknown) => v === true || v === "t" || v === "true";

  const probe = one<{ userGone: unknown; roleGone: unknown; dupe: unknown }>(
    `select
       ${id ? "not exists (select 1 from fl_user where id = $3)" : "false"} as user_gone,
       not exists (select 1 from fl_role where id = $1) as role_gone,
       exists (select 1 from fl_user where email_norm = $2 ${id ? "and id <> $3" : ""}) as dupe`,
    id ? [roleId, emailNorm, id] : [roleId, emailNorm]
  );
  if (truthy(probe?.userGone)) return "That user no longer exists.";
  if (truthy(probe?.roleGone)) return "The selected role no longer exists.";
  if (truthy(probe?.dupe)) return "A user with this email already exists.";
  return "The user could not be saved.";
}

// --- roles ------------------------------------------------------------------------

export function listRoles(): RoleRecord[] {
  return many<RoleRecord>(
    `select ${ROLE_COLS} from fl_role order by sort_order, code limit 200`
  ).map(normalizeRole);
}

function getRole(id: string): RoleRecord {
  const role = one<RoleRecord>(`select ${ROLE_COLS} from fl_role where id = $1 limit 1`, [id]);
  if (!role) throw new Error("That role no longer exists.");
  return normalizeRole(role);
}

export function saveRole(input: SaveRoleInput, actor: string): RoleRecord {
  const now = nowIso();
  const name = input.name.trim();

  if (input.id) {
    const existing = getRole(input.id);
    if (existing.isSystem === "true") {
      // The description may be reworded; identity and reachability may not.
      if (name !== existing.name) throw new Error(`${existing.name} is a system role — its name cannot change.`);
      if (input.active === "false") throw new Error(`${existing.name} is a system role — it cannot be deactivated.`);
    }

    const updated = one<RoleRecord>(
      `update fl_role set
         name = $2, description = $3, active = $4, updated_by = $5, updated_at = $6
       where id = $1
         and not exists (select 1 from fl_role where lower(name) = lower($2) and id <> $1)
       returning ${ROLE_COLS}`,
      [input.id, name, input.description ?? null, input.active ?? existing.active, actor, now]
    );
    if (!updated) throw new Error("A role with this name already exists.");

    const wasActive = existing.active;
    appendEvent({
      entityType: "role",
      entityId: updated.id,
      kind:
        wasActive !== updated.active
          ? updated.active === "true"
            ? "role.activated"
            : "role.deactivated"
          : "role.updated",
      actor,
      body: `Updated role ${updated.name}`,
      meta: { name: updated.name, active: updated.active },
    });
    return normalizeRole(updated);
  }

  // The sequence value doubles as sort_order, so new roles append after the
  // seeded 1–8 in a stable order without a max() read.
  const code = nextRef("role");
  const seqValue = Number(code.split("-")[1]);

  const created = one<RoleRecord>(
    `insert into fl_role
       (id, org_id, code, name, description, active, is_system, sort_order,
        created_by, updated_by, data_json, created_at, updated_at)
     select gen_random_uuid()::text, null, $1, $2, $3, $4, 'false', $5, $6, $6, $7, $8, $8
     where not exists (select 1 from fl_role where lower(name) = lower($2))
     returning ${ROLE_COLS}`,
    [
      code,
      name,
      input.description ?? null,
      input.active ?? "true",
      seqValue,
      actor,
      JSON.stringify({ permissions: {} }),
      now,
    ]
  );
  if (!created) throw new Error("A role with this name already exists.");

  appendEvent({
    entityType: "role",
    entityId: created.id,
    kind: "role.created",
    actor,
    body: `Created role ${created.name}`,
    meta: { code: created.code, name: created.name },
  });
  return normalizeRole(created);
}

export function setRoleActive(roleId: string, active: string, actor: string): RoleRecord {
  const existing = getRole(roleId);
  if (existing.isSystem === "true" && active === "false") {
    throw new Error(`${existing.name} is a system role — it cannot be deactivated.`);
  }

  const updated = one<RoleRecord>(
    `update fl_role set active = $2, updated_by = $3, updated_at = $4
      where id = $1
      returning ${ROLE_COLS}`,
    [roleId, active, actor, nowIso()]
  );
  if (!updated) throw new Error("That role no longer exists.");

  appendEvent({
    entityType: "role",
    entityId: updated.id,
    kind: active === "true" ? "role.activated" : "role.deactivated",
    actor,
    body: `${active === "true" ? "Activated" : "Deactivated"} role ${updated.name}`,
  });
  return normalizeRole(updated);
}

// --- permissions --------------------------------------------------------------------

/** Shape-only validation — see the module header for why not catalog membership. */
function assertMatrix(value: unknown, roleId: string): PermissionMatrix {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`permissions for role ${roleId} must be an object of module → actions`);
  }
  const matrix: PermissionMatrix = {};
  for (const module of Object.keys(value as Record<string, unknown>)) {
    const actions = (value as Record<string, unknown>)[module];
    if (!Array.isArray(actions) || actions.some((a) => typeof a !== "string")) {
      throw new Error(`permissions for role ${roleId}.${module} must be an array of action ids`);
    }
    matrix[module] = actions as string[];
  }
  return matrix;
}

/**
 * Writes whole matrices for the roles the caller changed. `data_json` is
 * read-modify-written so keys other than `permissions` survive; upsertJsonKey
 * is not used because it only carries string values, and the matrix is an
 * object.
 */
export function putPermissions(
  changes: Record<string, unknown>,
  actor: string
): { updated: number } {
  const roleIds = Object.keys(changes ?? {});
  if (roleIds.length === 0) return { updated: 0 };

  let updated = 0;
  for (const roleId of roleIds) {
    const matrix = assertMatrix(changes[roleId], roleId);

    const row = one<{ id: string; name: string; isSystem: string; dataRaw: unknown }>(
      `select id, name, is_system, data_json as data_raw from fl_role where id = $1 limit 1`,
      [roleId]
    );
    if (!row) throw new Error("That role no longer exists.");
    if (row.isSystem === "true") {
      throw new Error(`${row.name} is a system role — its permissions cannot be edited.`);
    }

    const data = parseJson<Record<string, unknown>>(row.dataRaw, {});
    const blob = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    blob.permissions = matrix;

    updated += mutate(
      `update fl_role set data_json = $2, updated_by = $3, updated_at = $4 where id = $1`,
      [roleId, JSON.stringify(blob), actor, nowIso()]
    );

    appendEvent({
      entityType: "role",
      entityId: roleId,
      kind: "role.permissions_updated",
      actor,
      body: `Updated permissions for ${row.name}`,
      meta: { permissions: matrix },
    });
  }

  return { updated };
}
