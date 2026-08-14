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
  // Ghost pill: no border of its own, no shadow at rest, in either theme.
  "h-7 flex-none gap-1.5 rounded-md border-0 bg-transparent px-2.5 text-[13px] font-medium shadow-none " +
  "data-[state=active]:bg-muted data-[state=active]:text-foreground " +
  "dark:data-[state=active]:bg-muted dark:data-[state=active]:border-0 " +
  // Active state is the muted fill plus a 1px hairline, drawn as an INSET
  // shadow rather than shadcn's stock drop shadow: these pills sit flush in a
  // flat header band, and a cast shadow made the active one look lifted off it.
  // Inset also keeps the outline off the box model, so the strip doesn't shift
  // a pixel each time the active tab moves — which a real border would do.
  //
  // The `!` is load-bearing. shadcn's own rule is
  // `[data-variant=default] &[data-state=active] { shadow-sm }` — four
  // selector parts against this class's two, so a plain `shadow-none` here
  // loses on specificity and the drop shadow survives.
  "data-[state=active]:shadow-[inset_0_0_0_1px_var(--border)]! " +
  // The base trigger carries an ::after underline for shadcn's `line` variant,
  // parked at bottom:-5px and opacity:0. These are pills, so it never shows —
  // but an invisible box is still box, and 5px of it hangs BELOW the trigger.
  // Inside the scroll container below that counts as scrollable overflow, which
  // is what made the strip drag vertically and clip its own pills.
  "after:hidden";

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
          and wrapping them would double the fixed header band's height.

          THREE THINGS KEEP THAT SCROLLER FROM EATING THE PILLS:

          `py-1 -my-1` — asking for overflow-x also makes the Y axis a scroll
          box (CSS forbids `visible` on one axis alone), so anything a pill
          paints outside its own border — the 3px focus ring — is clipped. The
          padding gives it room INSIDE the box; the negative margin hands the
          space back, so the header band's height is unchanged.

          Both scrollbar rules — `scrollbar-width` is Firefox and Safari 18+,
          the pseudo-element is every other WebKit/Blink build. With only the
          first, macOS set to "show scroll bars always" draws a bar INSIDE this
          box and takes ~15px of its height off the pills. */}
      <TabsList className="h-auto max-w-full justify-start gap-0.5 overflow-x-auto rounded-none bg-transparent px-0 py-1 -my-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
