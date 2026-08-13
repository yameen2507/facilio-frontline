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
  "text-muted-foreground hover:text-foreground data-[state=active]:text-foreground " +
  // Flat trigger: strip the pill chrome in both themes, keep only the bar.
  "-mb-px h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-2 pt-1 pb-2.5 shadow-none " +
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
    <UITabs value={active} onValueChange={(v) => onChange(v as Id)} className="gap-0">
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
              <span className="bg-muted rounded-full px-1.5 py-px text-[10px] font-normal tabular-nums">
                {t.count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </UITabs>
  );
}
