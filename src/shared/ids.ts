/**
 * Human-facing reference numbers: LEAD-0001, DEAL-0001.
 *
 * There are no sequences or serial columns available (ARCHITECTURE.md §3a), so
 * the counter lives in `fl_sequence` and is bumped with a single
 * `UPDATE ... RETURNING` — one statement, therefore atomic, which matters
 * because there are no transactions either.
 */

import { nowIso, one } from "./db";

export function nextRef(sequence: string): string {
  const row = one<{ currentValue: number; data: { prefix?: string } | null }>(
    `update fl_sequence
        set current_value = current_value + 1,
            updated_at = $2
      where name = $1
      returning current_value, data_json`,
    [sequence, nowIso()]
  );

  if (!row) {
    throw new Error(`sequence "${sequence}" is missing — run \`migrate seed-config\` first`);
  }

  const prefix = row.data?.prefix ?? sequence.toUpperCase();
  return `${prefix}-${String(row.currentValue).padStart(4, "0")}`;
}
