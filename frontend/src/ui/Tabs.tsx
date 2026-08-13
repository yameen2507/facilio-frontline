/**
 * Filter tabs — shadcn's Tabs, controlled from outside.
 *
 * Rendered into the page shell's fixed strip, not into the scrolling body, so
 * they stay visible while rows move under them. Only the list renders here:
 * the "panel" is the page body below, which the owning page swaps on
 * `onChange`, so TabsContent has no role.
 */

import { Tabs as UITabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type Tab<Id extends string> = { id: Id; label: string; count?: number };

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
    <UITabs value={active} onValueChange={(v) => onChange(v as Id)}>
      <TabsList>
        {items.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
            <span className="text-muted-foreground text-xs tabular-nums">{t.count ?? 0}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </UITabs>
  );
}
