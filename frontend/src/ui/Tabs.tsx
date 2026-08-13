/**
 * Filter tabs — shadcn's Tabs, controlled from outside, restyled as the
 * COMPACT GHOST PILLS Linear's list headers use (verified against real
 * screens on Mobbin): inactive triggers are muted text, hover washes them,
 * and the active one earns a quiet `muted` fill. Counts render as plain
 * tabular numbers — a number is data, and boxing it in a pill made every tab
 * carry two shapes.
 *
 * Rendered into the page shell's fixed strip, not into the scrolling body, so
 * they stay visible while rows move under them. Only the list renders here:
 * the "panel" is the page body below, which the owning page swaps on
 * `onChange`, so TabsContent has no role. (The previous underline restyle
 * needed the shell's border to lean on; pills stand on their own, which is
 * what lets the whole header band stay slim.)
 */

import { Tabs as UITabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type Tab<Id extends string> = { id: Id; label: string; count?: number };

const TRIGGER =
  // `group` so the count can read the trigger's active state.
  "group text-muted-foreground hover:text-foreground hover:bg-muted/60 " +
  // Ghost pill: no border, no shadow, in either theme — the muted fill IS the
  // active state.
  "h-7 flex-none gap-1.5 rounded-md border-0 bg-transparent px-2.5 text-[13px] font-medium shadow-none " +
  "data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none " +
  "dark:data-[state=active]:bg-muted dark:data-[state=active]:border-0";

export function Tabs<Id extends string>({
  items,
  active,
  onChange,
}: {
  items: Tab<Id>[];
  active: Id;
  onChange: (id: Id) => void;
}) {
  return (
    // min-w-0: the strip lays tabs beside a search field, and without this the
    // list's max-content width wins and pushes the field onto its own line.
    <UITabs value={active} onValueChange={(v) => onChange(v as Id)} className="min-w-0 gap-0">
      {/* Scrolls sideways on a phone — the survey detail carries seven tabs,
          and wrapping them would double the fixed header band's height. */}
      <TabsList className="h-auto max-w-full justify-start gap-0.5 overflow-x-auto rounded-none bg-transparent p-0 [scrollbar-width:none]">
        {items.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className={TRIGGER}>
            {t.label}
            {/* Only when the owner supplied one: a real 0 is information on a
                filter tab ("Completed 0"), but a tab with no count concept —
                Overview, Activity while loading — must not invent one. */}
            {typeof t.count === "number" ? (
              <span className="text-muted-foreground group-data-[state=active]:text-foreground/60 text-[11px] font-normal tabular-nums">
                {t.count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </UITabs>
  );
}
