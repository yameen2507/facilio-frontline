/**
 * The label/value grid used for record details.
 *
 * `value` is a node, not a string, because most of these are links — an email, a
 * phone number, a domain, a cross-reference to another record.
 */

import type { ReactNode } from "react";

export type Fact = { label: string; value: ReactNode };

export const Facts = ({ items }: { items: Fact[] }) => (
  <dl className="facts">
    {items.map((f) => (
      <div key={f.label}>
        <dt>{f.label}</dt>
        {/* An absent value is an em dash, never a blank cell — a blank reads as a
            rendering failure rather than as "we don't have this". */}
        <dd>{f.value ?? "—"}</dd>
      </div>
    ))}
  </dl>
);
