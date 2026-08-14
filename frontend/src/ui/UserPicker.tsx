/**
 * The person picker (D-19): a Combobox over user records, so assignment can
 * only ever name someone who exists. Presentation-only — the caller brings the
 * users (from app/users.tsx or a module's own richer list) and this maps them
 * onto the one searchable lookup. Search finds people by name OR email, since
 * the meta line rides in the match string.
 *
 * `badge` per user is how the survey lane shows that week's visit load without
 * this component knowing what a visit is.
 */

import { Combobox, type ComboboxOption } from "./Combobox";

export type PickableUser = {
  email: string;
  name: string;
  roleName?: string | null;
  team?: string | null;
  region?: string | null;
  /** Right-aligned addendum — "3 visits this wk". */
  badge?: string | null;
};

export function UserPicker({
  id,
  users,
  value,
  onChange,
  placeholder = "Pick a person",
  disabled,
  loading,
}: {
  id?: string;
  users: PickableUser[];
  /** The selected user's email — the stable key every table already stores. */
  value: string | null;
  onChange: (email: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const options: ComboboxOption[] = users.map((u) => ({
    id: u.email,
    label: u.name,
    meta: [u.roleName, u.team, u.region].filter(Boolean).join(" · ") || u.email,
    badge: u.badge ?? null,
  }));

  return (
    <Combobox
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Search by name or email…"
      emptyText="Nobody matches — users are added under Settings → Users."
      disabled={disabled}
      loading={loading}
    />
  );
}
