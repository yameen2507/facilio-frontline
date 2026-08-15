/**
 * The widget as a host page embeds it — `#/embed`, the whole document, no
 * console around it.
 *
 * WHY A ROUTE AND NOT A SECOND APP. Agents and functions are app-scoped: a
 * widget served from another Vibe app resolves `intake` against THAT app and
 * 404s, and pointing the SDK back at frontline cross-origin is refused (the
 * preflight answers 204 with no `Access-Control-Allow-Origin`). An iframe has
 * neither problem — the framed document IS frontline, so the SDK, the session
 * cookie, the agent and the `fl_lead` write all work untouched. The host page
 * supplies the launcher and the frame; this supplies the widget.
 *
 * Two deliberate departures from the console:
 *
 *   THE PAGE IS TRANSPARENT (`body.embed`). Glass cannot blur across a document
 *   boundary — `backdrop-filter` sees only this document — so the nearest
 *   honest thing is to let the host page show through the panel's alpha rather
 *   than paint `--background` behind it and land a grey card on someone's
 *   website.
 *
 *   THE THEME IS PINNED LIGHT. `theme-boot.js` stamps whatever the OPERATOR
 *   last chose in the console, and that choice has nothing to do with the
 *   visitor's website — a dark widget on a white page reads as broken. There is
 *   no ThemeProvider above this for the same reason.
 *
 * A failed config read does NOT become an error state. The visitor came to ask
 * a question, and the branding is the only thing that was lost — so the widget
 * opens on the shipped defaults and the conversation still happens.
 */

import { useEffect, useState } from "react";
import { withDefaults } from "../../../lib/request";
import { getWidgetConfig, WIDGET_DEFAULTS, type WidgetConfig } from "../api/widget-config";
import { WidgetPreview, WidgetSkeleton } from "../components/WidgetPreview";

export function Embed() {
  const [config, setConfig] = useState<WidgetConfig | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", "light");
    document.body.classList.add("embed");
    return () => document.body.classList.remove("embed");
  }, []);

  useEffect(() => {
    let live = true;
    getWidgetConfig().then(({ data }) => {
      if (live) setConfig(withDefaults(WIDGET_DEFAULTS, data?.config));
    });
    return () => {
      live = false;
    };
  }, []);

  // `h-svh`, not `h-full`: #root is an auto-height div, so a percentage height
  // here would collapse to nothing. Inside an iframe the small viewport IS the
  // frame the host sized.
  return (
    <div className="h-svh w-full">
      {config ? <WidgetPreview config={config} embedded /> : <WidgetSkeleton embedded />}
    </div>
  );
}
