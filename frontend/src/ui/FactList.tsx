/**
 * The record-rail fact list — one field per row, an icon and a muted label on
 * the left, the value taking the rest. Shared by the lead and account rails.
 * Single column on purpose: the rail is narrow, and a two-column grid broke
 * long values in half there.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type FactRow = { icon: LucideIcon; label: string; value: ReactNode };

export const FactList = ({ rows }: { rows: FactRow[] }) => (
  <dl className="flex flex-col gap-2.5">
    {rows.map(({ icon: Icon, label, value }) => (
      <div key={label} className="flex items-start gap-2.5">
        {/* pt nudges the 12px label and 16px icon onto the value's first
            line — three different line boxes, one optical baseline. */}
        <dt className="text-muted-foreground flex w-[104px] shrink-0 items-center gap-2 pt-0.5 text-xs">
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          {label}
        </dt>
        {/* An absent value is an em dash, never a blank cell — a blank reads
            as a rendering failure rather than as "we don't have this". */}
        <dd className="min-w-0 flex-1 text-sm break-words [&_a]:font-medium [&_a]:underline-offset-4 [&_a:hover]:underline">
          {value ?? "—"}
        </dd>
      </div>
    ))}
  </dl>
);
