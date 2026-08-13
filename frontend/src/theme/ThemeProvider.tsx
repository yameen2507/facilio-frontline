/**
 * Theme: light, dark, or follow the system.
 *
 * `data-theme` on <html> is the switch, which is the attribute the real DSM keys
 * its own dark palette on (`:root[data-theme='dark']` in dsm-core.css). Setting it
 * themes DSM's components and our stylesheet together.
 *
 * WHY "SYSTEM" IS RESOLVED IN JS. The DSM stylesheet has NO
 * `@media (prefers-color-scheme)` block — its dark values only exist under the
 * attribute. So leaving the attribute off does not fall back to the OS
 * preference, it just pins light. "System" therefore has to read the media query
 * here, stamp an explicit value, and keep listening for changes.
 *
 * First paint is handled by `theme-boot.js` in <head>, which does the same
 * resolution before anything renders. The storage key is duplicated there —
 * change both together.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const KEY = "frontline.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export type ThemeMode = "light" | "dark" | "system";
type Resolved = "light" | "dark";

const MODES: ThemeMode[] = ["light", "dark", "system"];

const isMode = (v: unknown): v is ThemeMode => MODES.includes(v as ThemeMode);

/** Anything unrecognised — or unreadable storage — means "system". */
function storedMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(KEY);
    return isMode(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

const systemPrefers = (): Resolved =>
  typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches ? "dark" : "light";

const resolve = (mode: ThemeMode): Resolved => (mode === "system" ? systemPrefers() : mode);

/**
 * Always an explicit value — never remove the attribute, see the note above.
 *
 * The switch CROSSFADES rather than snapping: browsers with the View
 * Transitions API get a true whole-page fade (the engine screenshots old and
 * new and blends them — no per-property transition weirdness); everything else
 * gets a brief `.theme-fade` class that transitions the colour properties, cut
 * loose after the fade so hover states don't animate forever. theme-boot.js
 * still stamps first paint directly — a fade from nothing is a flash.
 */
function apply(mode: ThemeMode) {
  const next = resolve(mode);
  const root = document.documentElement;
  if (root.getAttribute("data-theme") === next) return;

  const doc = document as Document & { startViewTransition?: (update: () => void) => void };
  if (typeof doc.startViewTransition === "function") {
    doc.startViewTransition(() => root.setAttribute("data-theme", next));
    return;
  }
  root.classList.add("theme-fade");
  root.setAttribute("data-theme", next);
  window.setTimeout(() => root.classList.remove("theme-fade"), 300);
}

type ThemeApi = { mode: ThemeMode; resolved: Resolved; setMode: (m: ThemeMode) => void };

const ThemeContext = createContext<ThemeApi>({
  mode: "system",
  resolved: "light",
  setMode: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(storedMode);
  const [resolved, setResolved] = useState<Resolved>(() => resolve(storedMode()));

  useEffect(() => {
    apply(mode);
    setResolved(resolve(mode));

    // Only "system" tracks the OS. An explicit choice must not be overridden when
    // the machine flips at sunset.
    if (mode !== "system" || typeof window.matchMedia !== "function") return;

    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      apply("system");
      setResolved(systemPrefers());
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Unwritable storage costs persistence across reloads, not the theme.
    }
  }, []);

  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>;
}
