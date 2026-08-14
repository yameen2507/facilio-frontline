/**
 * One collapsible section of a record rail — sentence-case header with a
 * chevron, the way Attio panels a record ("Details ⌄"), not an uppercase card
 * band. Shared by the lead and account detail rails so the two records read
 * identically.
 *
 * Collapse animates via the 0fr/1fr grid-rows trick, which interpolates
 * height without measuring it (rule: never animate height:auto).
 */

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function RailSection({
  title,
  meta,
  children,
}: {
  title: string;
  /** The muted note on the header's right (a count, a state). */
  meta?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    // py-1.5 on the wrapper rather than on the header and the body: added to
    // the header's own py-2.5 and the body's pb-2.5 it puts a flat 16px between
    // the rule and the section's content at BOTH ends — the same inset the
    // identity block above uses — while the header's hover fill stays
    // vertically symmetric.
    <div className="border-t py-1.5 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="hover:bg-muted/40 flex w-full items-center gap-1.5 px-6 py-2.5 text-left transition-colors"
      >
        <ChevronDown
          className={cn(
            "text-muted-foreground size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
            !open && "-rotate-90"
          )}
          aria-hidden="true"
        />
        <span className="text-[13px] font-medium">{title}</span>
        <span className="flex-1" aria-hidden="true" />
        {meta ? <span className="text-muted-foreground text-xs">{meta}</span> : null}
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          {/* Content shares the header's px-6, aligned to the CHEVRON — not
              indented to the title. pt-2 keeps the body from sitting flush
              under the heading. */}
          <div className="px-6 pt-2 pb-2.5">{children}</div>
        </div>
      </div>
    </div>
  );
}
