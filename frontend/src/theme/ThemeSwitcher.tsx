/**
 * The three-way theme control in the profile menu.
 *
 * Three explicit states rather than a two-state toggle: "follow the system" is a
 * real choice, and a plain light/dark switch silently takes it away from everyone
 * who never touches the control. Lucide has all three glyphs — the Facilio icon
 * CDN this replaced had no sun/moon/monitor, which is why they used to be inline.
 */

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type ThemeMode } from "./ThemeProvider";

const OPTIONS: { mode: ThemeMode; label: string; Glyph: LucideIcon }[] = [
  { mode: "light", label: "Light", Glyph: Sun },
  { mode: "dark", label: "Dark", Glyph: Moon },
  { mode: "system", label: "Match system", Glyph: Monitor },
];

export function ThemeSwitcher() {
  const { mode, setMode } = useTheme();

  return (
    <div role="group" aria-label="Colour theme" className="bg-muted flex items-center gap-0.5 rounded-md p-0.5">
      {OPTIONS.map((o) => (
        <button
          type="button"
          key={o.mode}
          onClick={() => setMode(o.mode)}
          title={o.label}
          aria-label={o.label}
          aria-pressed={mode === o.mode}
          className={cn(
            "text-muted-foreground hover:text-foreground rounded-sm p-1.5 transition-colors",
            mode === o.mode && "bg-background text-foreground shadow-sm",
          )}
        >
          <o.Glyph className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
