/**
 * Theme: light, dark, or follow the system.
 *
 * The only thing this does is set `data-theme` on <html>. Every colour decision
 * lives in tokens.css, which is why "system" needs no listener — leaving the
 * attribute off hands the choice to the `prefers-color-scheme` block, and the OS
 * flipping at sunset repaints with no React involved.
 *
 * First paint is NOT handled here. `theme-boot.js` runs from <head> and stamps
 * the attribute before anything renders; React mounts long after the first paint,
 * so without it a user who chose dark would see a white flash every load. The
 * storage key is duplicated there — change both together.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const KEY = "frontline.theme";

export type ThemeMode = "light" | "dark" | "system";

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

function apply(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

type ThemeApi = { mode: ThemeMode; setMode: (m: ThemeMode) => void };

const ThemeContext = createContext<ThemeApi>({ mode: "system", setMode: () => {} });

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(storedMode);

  // Re-applying what theme-boot.js already stamped is deliberate: it costs
  // nothing, and it is the safety net for the case where that <script> tag goes
  // missing from index.html — a failure otherwise invisible to anyone whose
  // system theme happens to match their choice.
  useEffect(() => {
    apply(mode);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Unwritable storage costs persistence across reloads, not the theme.
    }
  }, []);

  return <ThemeContext.Provider value={{ mode, setMode }}>{children}</ThemeContext.Provider>;
}
