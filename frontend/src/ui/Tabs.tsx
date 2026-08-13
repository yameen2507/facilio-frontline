/**
 * Filter tabs — shadcn's Tabs, controlled from outside, restyled from the
 * stock boxed pill group into UNDERLINE triggers.
 *
 * Rendered into the page shell's fixed strip, not into the scrolling body, so
 * they stay visible while rows move under them. Only the list renders here:
 * the "panel" is the page body below, which the owning page swaps on
 * `onChange`, so TabsContent has no role.
 *
 * The underline shape is load-bearing, not taste: PageShell draws one border
 * under the whole header band, and these triggers end in a 2px bar pulled onto
 * that border with -mb-px — tabs read as part of the band instead of a second
 * band floating under it, which is where the old header's height went.
 */

import { Tabs as UITabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type Tab<Id extends string> = { id: Id; label: string; count?: number };

const TRIGGER =
  // `group` so the count badge can read the trigger's active state.
  "group text-muted-foreground hover:text-foreground data-[state=active]:text-foreground " +
  // Flat trigger: strip the pill chrome in both themes, keep only the bar.
  "-mb-px h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 pt-1 pb-3 shadow-none " +
  "data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none " +
  "dark:data-[state=active]:border-primary dark:data-[state=active]:bg-transparent";

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
      <TabsList className="h-auto max-w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0 [scrollbar-width:none]">
        {items.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className={TRIGGER}>
            {t.label}
            {/* Only when the owner supplied one: a real 0 is information on a
                filter tab ("Completed 0"), but a tab with no count concept —
                Overview, Activity while loading — must not invent one. */}
            {typeof t.count === "number" ? (
              // The badge carries the active state too, so the selected tab is
              // marked twice — underline and a lit pill — instead of once.
              <span
                className="bg-muted text-muted-foreground group-data-[state=active]:bg-foreground/10 group-data-[state=active]:text-foreground rounded-full px-1.5 py-px text-[10px] font-normal tabular-nums transition-colors"
              >
                {t.count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </UITabs>
  );
}
