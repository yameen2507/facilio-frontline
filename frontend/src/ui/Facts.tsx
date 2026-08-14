/**
 * The label/value grid used for record details.
 *
 * `value` is a node, not a string, because most of these are links — an email, a
 * phone number, a domain, a cross-reference to another record. The dd styles
 * any anchor inside it, so call sites keep passing plain <a>/<Link> nodes.
 */

import type { ReactNode } from "react";

export type Fact = { label: string; value: ReactNode };

export const Facts = ({ items }: { items: Fact[] }) => (
  <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
    {items.map((f) => (
      // min-w-0 + break-words: in a narrow column a grid cell's min-content
      // width is its longest word, and an unbroken email address would widen
      // the whole card past its container.
      <div key={f.label} className="min-w-0">
        <dt className="text-muted-foreground mb-px text-xs">{f.label}</dt>
        {/* An absent value is an em dash, never a blank cell — a blank reads as a
            rendering failure rather than as "we don't have this". */}
        <dd className="text-sm break-words [&_a]:font-medium [&_a]:underline-offset-4 [&_a:hover]:underline">
          {f.value ?? "—"}
        </dd>
      </div>
    ))}
  </dl>
);
