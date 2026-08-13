/**
 * The app shell: sidebar beside the routed page.
 *
 * `.app` owns the viewport and hides its own overflow, which is what makes the
 * page body the only scroll region — the sidebar and page header cannot scroll
 * away, and a long list moves under them.
 *
 * The shell mounts `<Outlet />` and knows nothing about any feature.
 */

import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

const KEY = "frontline.sidebar";

const storedCollapsed = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "collapsed";
  } catch {
    return false;
  }
};

export function AppShell() {
  const [collapsed, setCollapsed] = useState(storedCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, collapsed ? "collapsed" : "expanded");
    } catch {
      // Unwritable storage costs the preference across reloads, not the toggle.
    }
  }, [collapsed]);

  return (
    // `undefined` rather than "false" removes the attribute entirely — the CSS
    // selector is [data-collapsed="true"], and data-collapsed="false" would still
    // be present in the DOM and read as a state that means nothing.
    <div className="app" data-collapsed={collapsed ? "true" : undefined}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <main>
        <Outlet />
      </main>
    </div>
  );
}
