/**
 * Settings › Users — who can sign in and which role they carry (spec §7, §10).
 *
 * One fetch, filtered client-side, like every list page: search slices a small
 * result rather than paying a round trip per keystroke. Rows open the edit
 * dialog directly — a user is a settings record, not a workspace, so there is
 * no detail page to navigate to. Content only — the PageShell and side nav
 * belong to SettingsLayout, so this section's states can never take them down.
 */

import { useEffect, useMemo, useState } from "react";
import { AtSign, MapPin, Plus, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { useAccess, type AccessUser } from "../../../app/access";
import { Card } from "../../../ui/Card";
import { Chip } from "../../../ui/Chip";
import { CompanyLogo } from "../../../ui/CompanyLogo";
import { ClickRow, ListTable, ListTableSkeleton, type Col } from "../../../ui/DataTable";
import { Empty, ErrorState } from "../../../ui/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell } from "@/components/ui/table";
import { listUsers } from "../api/access-util";
import { SectionHeader } from "../components/SectionHeader";
import { UserDialog } from "../components/UserDialog";

const COLS: Col[] = [
  { label: "User", icon: UserRound, skel: "entity" },
  { label: "Email", icon: AtSign, className: "max-md:hidden", skel: "text" },
  { label: "Role", icon: ShieldCheck, className: "w-40", skel: "chip" },
  { label: "Team", icon: UsersRound, className: "max-lg:hidden w-32", skel: "text" },
  { label: "Region", icon: MapPin, className: "max-lg:hidden w-28", skel: "text" },
  { label: "Status", className: "w-28", skel: "chip" },
];

export function Users() {
  // Re-reads the bootstrap after a save — an admin editing their own record
  // should see the app's gates update without a reload.
  const { refresh } = useAccess();
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");

  // Visibility and the record are one state: null closed, {user: null} creates,
  // {user} edits. The dialog stays mounted so the radix exit animation plays.
  const [dialog, setDialog] = useState<{ user: AccessUser | null } | null>(null);

  useEffect(() => {
    let live = true;
    listUsers().then(({ data, error: err }) => {
      if (!live) return;
      setLoaded(true);
      setError(err);
      if (data) setUsers(data.users);
    });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.roleName ?? "").toLowerCase().includes(q) ||
        (u.team ?? "").toLowerCase().includes(q) ||
        (u.region ?? "").toLowerCase().includes(q)
    );
  }, [users, search]);

  return (
    <>
      <SectionHeader
        title="Users"
        description="People who can sign in, and the one role each carries"
        actions={
          <>
            <Input
              type="text"
              placeholder="Search by name, email, role or team"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 sm:w-72"
              aria-label="Search users"
            />
            <Button size="sm" onClick={() => setDialog({ user: null })}>
              <Plus className="size-4" />
              New user
            </Button>
          </>
        }
      />
      <Card pad={false}>
        {!loaded ? (
          <ListTableSkeleton cols={COLS} rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : rows.length ? (
          <ListTable cols={COLS}>
            {rows.map((u) => (
              <ClickRow key={u.id} onClick={() => setDialog({ user: u })}>
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <CompanyLogo name={u.name} email={u.email} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{u.name}</div>
                      {/* The email repeats here so it survives the hidden
                          column on a phone. */}
                      <div className="text-muted-foreground truncate text-xs">
                        {u.email}
                        {u.department ? ` · ${u.department}` : ""}
                        {u.managerEmail ? ` · reports to ${u.managerEmail.split("@")[0]}` : ""}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground px-4 py-3 text-xs max-md:hidden">
                  <span className="block truncate">{u.email}</span>
                </TableCell>
                <TableCell className="w-40 px-4 py-3">
                  {u.roleName ? <Chip tone="blue">{u.roleName}</Chip> : <Chip>no role</Chip>}
                </TableCell>
                <TableCell className="text-muted-foreground w-32 px-4 py-3 text-xs max-lg:hidden">
                  {u.team ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground w-28 px-4 py-3 text-xs max-lg:hidden">
                  {u.region ?? "—"}
                </TableCell>
                <TableCell className="w-28 px-4 py-3">
                  {u.status === "active" ? (
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
        ) : users.length ? (
          <Empty title="Nothing matches" body="No user matches the search." />
        ) : (
          <Empty
            title="No users yet"
            body="The first person to open the app becomes the System Admin automatically. Everyone else is added here, with exactly one role each."
            action={
              <Button variant="outline" onClick={() => setDialog({ user: null })}>
                <Plus className="size-4" />
                Add a user
              </Button>
            }
          />
        )}
      </Card>

      <UserDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        user={dialog?.user ?? null}
        users={users}
        onSaved={() => {
          setReloadKey((k) => k + 1);
          refresh();
        }}
      />
    </>
  );
}
