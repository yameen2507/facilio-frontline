/**
 * The widget's presentation config — what the playground panel edits and the
 * preview renders.
 *
 * SEAM — STORED IN localStorage, PER BROWSER. The real home is a
 * `settings-widget` get/put pair beside `settings-get`/`settings-put`, because
 * an embedded widget on the company site has to read the same values this
 * console saves; a per-browser copy can only ever style the preview. The shape
 * below is the contract that endpoint should serve. Until it exists, the
 * playground is honest about it in its footer copy.
 *
 * The greeting is an OVERRIDE: empty means "use whatever `intake-start`
 * returns", which is also why it is applied when a conversation starts rather
 * than patched into an existing transcript — the agent must see the same first
 * message the visitor saw.
 */

export type WidgetConfig = {
  /** The chip in the widget header — the site the visitor is on. */
  siteLabel: string;
  /** The line beside the chip. */
  introLine: string;
  /** First agent message; empty falls back to the server's greeting. */
  greeting: string;
  /** Visitor-bubble colour; empty follows the console theme's primary. */
  accent: string;
};

export const WIDGET_DEFAULTS: WidgetConfig = {
  siteLabel: "albaytgrill.ae",
  introLine: "Chat with us — commercial kitchen extract cleaning",
  greeting: "",
  accent: "",
};

const KEY = "frontline.widget";

export function loadWidgetConfig(): WidgetConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return WIDGET_DEFAULTS;
    // Merged over the defaults so a field added later is never undefined for
    // a browser that saved the older shape.
    return { ...WIDGET_DEFAULTS, ...(JSON.parse(raw) as Partial<WidgetConfig>) };
  } catch {
    return WIDGET_DEFAULTS;
  }
}

export function saveWidgetConfig(config: WidgetConfig): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
    return true;
  } catch {
    // Unwritable storage (private mode, quota) costs persistence, not the
    // preview — the in-memory config keeps driving it.
    return false;
  }
}
