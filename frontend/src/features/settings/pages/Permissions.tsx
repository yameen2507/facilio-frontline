/**
 * Settings › Permissions — the matrix (spec §8–§9): action rows grouped by
 * module, one column per active role, a checkbox at each crossing. Nothing on
 * any screen hard-codes a role name; buttons ask `can(module, action)` and this
 * matrix is the answer.
 *
 * Edits accumulate in a `draft` seeded once from the fetch (the Service coverage
 * section's pattern) and land in ONE save that sends only the roles that
 * changed. The System Admin column renders checked and disabled — full access
 * is what `is_system` means, and the server rejects edits to it anyway.
 * Content only — the PageShell and side nav belong to SettingsLayout.
 */

import { useEffect, useMemo, useState } from "react";
import { useAccess, type AccessRole, type PermissionMatrix } from "../../../app/access";
import { useActor } from "../../../app/auth";
import { Card } from "../../../ui/Card";
import { HEADER_CELL } from "../../../ui/DataTable";
import { Empty, ErrorState } from "../../../ui/States";
import { SkeletonRows } from "../../../ui/Skeleton";
import { useToast } from "../../../ui/Toast";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { listRoles, putPermissions } from "../api/access-util";
import { ExplainedButton } from "../components/ExplainedButton";
import { SectionHeader } from "../components/SectionHeader";
import { PERMISSION_CATALOG } from "../data/permission-catalog";

type Draft = Record<string, PermissionMatrix>;

/** Sorted modules and actions, empty modules dropped — so two matrices that
    grant the same things compare equal regardless of click order. */
const canon = (m: PermissionMatrix): string =>
  JSON.stringify(
    Object.keys(m)
      .filter((k) => m[k]?.length)
      .sort()
      .map((k) => [k, [...m[k]].sort()])
  );

const draftFrom = (roles: AccessRole[]): Draft =>
  Object.fromEntries(roles.map((r) => [r.id, r.permissions]));

export function Permissions() {
  const toast = useToast();
  const actor = useActor();
  // The provider re-reads the bootstrap after a save, so the admin's own
  // buttons update without a full reload.
  const { refresh } = useAccess();

  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    listRoles().then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (data) {
        setRoles(data.roles);
        setDraft(draftFrom(data.roles));
      }
    });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  // Inactive roles keep their matrix but earn no column — granting permissions
  // to a role nobody can use would only look like it did something.
  const columns = useMemo(
    () =>
      roles
        .filter((r) => r.active === "true")
        .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)),
    [roles]
  );

  const has = (roleId: string, module: string, action: string): boolean =>
    draft?.[roleId]?.[module]?.includes(action) ?? false;

  const toggle = (roleId: string, module: string, action: string) => {
    if (!draft) return;
    const matrix = draft[roleId] ?? {};
    const actions = matrix[module] ?? [];
    const next = actions.includes(action)
      ? actions.filter((a) => a !== action)
      : [...actions, action];
    setDraft({ ...draft, [roleId]: { ...matrix, [module]: next } });
  };

  /** Only the roles whose canonical form moved — what the save sends. */
  const dirty = useMemo(() => {
    if (!draft) return [];
    return roles.filter(
      (r) => r.isSystem !== "true" && canon(draft[r.id] ?? {}) !== canon(r.permissions)
    );
  }, [draft, roles]);

  // The tab-close half of an unsaved draft — the browser at least asks first
  // (the TemplateBuilder's pattern). No route-change confirm: in-app moves
  // keep this page's state alive only until unmount, and that is visible.
  useEffect(() => {
    if (!dirty.length) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty.length]);

  const save = async () => {
    if (!draft || !dirty.length || saving) return;
    setSaving(true);
    const changes = Object.fromEntries(dirty.map((r) => [r.id, draft[r.id] ?? {}]));
    const { error: err } = await putPermissions(changes, actor);
    setSaving(false);
    if (err) {
      toast(err, true);
      return;
    }
    toast(`Saved ${dirty.length === 1 ? dirty[0].name : `${dirty.length} roles`}`);
    setReloadKey((k) => k + 1);
    refresh();
  };

  return (
    <>
      <SectionHeader
        title="Permissions"
        description="What each role can see and do, per action"
        actions={
          <ExplainedButton
            size="sm"
            onClick={() => void save()}
            disabled={!dirty.length || saving}
            title={!dirty.length ? "Nothing has changed yet" : undefined}
          >
            {saving ? "Saving…" : dirty.length ? `Save ${dirty.length} changed` : "Save changes"}
          </ExplainedButton>
        }
      />
      <Card pad={false} className="min-h-0 flex-1">
        {!loaded ? (
          <div className="p-4">
            <SkeletonRows count={8} />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : columns.length && draft ? (
          // The card is the matrix's ONE scroller, both axes — eight role
          // columns never fit a phone, and the header row can only be sticky
          // against the scroller it lives in (SettingsLayout caps this section
          // at the pane height to make that work).
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr>
                  {/* Sticky cells need their own OPAQUE paint — a translucent
                      wash would let scrolled content bleed through — so each
                      header cell mixes muted/40 over card explicitly, and the
                      header's bottom rule is an inset shadow because a
                      border-collapse border does not travel with a sticky
                      cell. The corner cell pins on BOTH axes, above the role
                      headers (z-30 vs z-20), which in turn clear the sticky
                      body label cells (z-10). */}
                  <th
                    className={cn(
                      "text-muted-foreground sticky top-0 left-0 z-30 min-w-44 px-4 py-2.5 text-left",
                      "bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]",
                      "shadow-[inset_0_-1px_0_var(--border)]",
                      HEADER_CELL
                    )}
                  >
                    Action
                  </th>
                  {columns.map((r) => (
                    <th
                      key={r.id}
                      className={cn(
                        "text-muted-foreground sticky top-0 z-20 min-w-28 px-3 py-2.5 text-center",
                        "bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]",
                        "shadow-[inset_0_-1px_0_var(--border)]",
                        HEADER_CELL
                      )}
                    >
                      {r.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_CATALOG.map((group) => (
                  <PermissionGroup
                    key={group.module}
                    group={group}
                    columns={columns}
                    has={has}
                    toggle={toggle}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No active roles"
            body="Activate a role under Roles and its column appears here."
          />
        )}
      </Card>

      {dirty.length ? (
        <p className="text-muted-foreground mt-3 text-xs">
          Unsaved changes to {dirty.map((r) => r.name).join(", ")}. Saving applies to everyone
          holding those roles the next time the app loads.
        </p>
      ) : null}
    </>
  );
}

/** One module's band: a labelled divider row, then its action rows. */
function PermissionGroup({
  group,
  columns,
  has,
  toggle,
}: {
  group: (typeof PERMISSION_CATALOG)[number];
  columns: AccessRole[];
  has: (roleId: string, module: string, action: string) => boolean;
  toggle: (roleId: string, module: string, action: string) => void;
}) {
  return (
    <>
      <tr className="border-t">
        <td colSpan={columns.length + 1} className="bg-muted/25 p-0">
          {/* Sticky INSIDE the full-width band cell, so the module name stays
              readable however far the role columns have scrolled. */}
          <div className="text-muted-foreground sticky left-0 w-fit px-4 py-1.5 text-[10px] font-medium tracking-[0.06em] uppercase">
            {group.label}
          </div>
        </td>
      </tr>
      {group.actions.map((action) => (
        <tr key={action.id} className="hover:bg-muted/30 border-t transition-colors">
          {/* bg-card, not transparent: a sticky cell must paint over what
              scrolls beneath it. It also opts out of the row hover wash —
              a translucent hover over moving checkboxes would bleed. */}
          <td className="bg-card sticky left-0 z-10 min-w-44 px-4 py-2">{action.label}</td>
          {columns.map((r) =>
            r.isSystem === "true" ? (
              <td key={r.id} className="min-w-28 px-3 py-2 text-center">
                {/* Full access is what a system role IS — shown, not editable. */}
                <Checkbox
                  checked
                  disabled
                  aria-label={`${r.name} always may ${action.label.toLowerCase()} ${group.label.toLowerCase()}`}
                  title={`${r.name} is a system role — always full access`}
                />
              </td>
            ) : (
              <td key={r.id} className="min-w-28 px-3 py-2 text-center">
                <Checkbox
                  checked={has(r.id, group.module, action.id)}
                  onCheckedChange={() => toggle(r.id, group.module, action.id)}
                  aria-label={`${r.name} may ${action.label.toLowerCase()} ${group.label.toLowerCase()}`}
                />
              </td>
            )
          )}
        </tr>
      ))}
    </>
  );
}

