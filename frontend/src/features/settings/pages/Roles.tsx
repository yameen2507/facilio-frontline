/**
 * Settings › Roles — the job titles permissions hang off (spec §5, §10).
 *
 * Rows open the edit dialog; there is no hard delete, only deactivation, since
 * users keep pointing at a role for as long as they hold it. What each role
 * PERMITS lives in the Permissions section, where roles can be read side by
 * side. Content only — the PageShell and side nav belong to SettingsLayout.
 */

import { useEffect, useMemo, useState } from "react";
import { Hash, Lock, Plus, ShieldCheck } from "lucide-react";
import { useAccess, type AccessRole } from "../../../app/access";
import { Card } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { ClickRow, ListTable, ListTableSkeleton, type Col } from "../../../ui/DataTable";
import { Empty, ErrorState } from "../../../ui/States";
import { Button } from "@/components/ui/button";
import { TableCell } from "@/components/ui/table";
import { listRoles } from "../api/access-util";
import { RoleDialog } from "../components/RoleDialog";
import { SectionHeader } from "../components/SectionHeader";

const COLS: Col[] = [
  { label: "Code", icon: Hash, className: "w-28", skel: "text" },
  { label: "Role", icon: ShieldCheck, skel: "entity" },
  { label: "Status", className: "w-28", skel: "chip" },
];

export function Roles() {
  // Re-reads the bootstrap after a save — deactivating your own role should
  // flip the app's gates without a reload.
  const { refresh } = useAccess();
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Visibility and the record are one state: null closed, {role: null} creates.
  const [dialog, setDialog] = useState<{ role: AccessRole | null } | null>(null);

  useEffect(() => {
    let live = true;
    listRoles().then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (data) setRoles(data.roles);
    });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const rows = useMemo(
    () => [...roles].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)),
    [roles]
  );

  return (
    <>
      <SectionHeader
        title="Roles"
        description="Each bundles permissions; every user carries exactly one"
        actions={
          <Button size="sm" onClick={() => setDialog({ role: null })}>
            <Plus className="size-4" />
            New role
          </Button>
        }
      />
      <Card pad={false}>
        {!loaded ? (
          <ListTableSkeleton cols={COLS} rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : rows.length ? (
          <ListTable cols={COLS}>
            {rows.map((r) => (
              <ClickRow key={r.id} onClick={() => setDialog({ role: r })}>
                <TableCell className="w-28 px-4 py-3">
                  <code className="font-mono text-xs">{r.code}</code>
                </TableCell>
                <TableCell className="px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{r.name}</span>
                      {r.isSystem === "true" ? (
                        // The lock says "fixed", the tooltip says why.
                        <Lock
                          className="text-muted-foreground size-3.5 shrink-0"
                          aria-label="System role — always active, full access"
                        />
                      ) : null}
                    </div>
                    <div className="text-muted-foreground truncate text-xs">
                      {r.description ?? "No description"}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="w-28 px-4 py-3">
                  {r.active === "true" ? (
                    <Chip tone="green" dot>
                      Active
                    </Chip>
                  ) : (
                    <Chip dot>Inactive</Chip>
                  )}
                </TableCell>
              </ClickRow>
            ))}
          </ListTable>
        ) : (
          <Empty
            title="No roles yet"
            body="The eight standard roles seed themselves the first time the app loads. New ones are created here."
            action={
              <Button variant="outline" onClick={() => setDialog({ role: null })}>
                <Plus className="size-4" />
                Create a role
              </Button>
            }
          />
        )}
      </Card>

      <RoleDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        role={dialog?.role ?? null}
        onSaved={() => {
          setReloadKey((k) => k + 1);
          refresh();
        }}
      />
    </>
  );
}
