/**
 * The three-way theme control in the sidebar footer.
 *
 * Three explicit states rather than a two-state toggle: "follow the system" is a
 * real choice, and a plain light/dark switch silently takes it away from everyone
 * who never touches the control.
 */

import { Icon, type IconName } from "../ui/Icon";
import { useTheme, type ThemeMode } from "./ThemeProvider";

const OPTIONS: { mode: ThemeMode; label: string; glyph: IconName }[] = [
  { mode: "light", label: "Light", glyph: "sun" },
  { mode: "dark", label: "Dark", glyph: "moon" },
  { mode: "system", label: "Match system", glyph: "monitor" },
];

export function ThemeSwitcher() {
  const { mode, setMode } = useTheme();

  return (
    <div className="theme-switch" role="group" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button
          type="button"
          key={o.mode}
          className={mode === o.mode ? "on" : ""}
          onClick={() => setMode(o.mode)}
          title={o.label}
          aria-label={o.label}
          aria-pressed={mode === o.mode}
        >
          <Icon name={o.glyph} size={14} />
        </button>
      ))}
    </div>
  );
}
