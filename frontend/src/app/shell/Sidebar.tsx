/**
 * The sidebar, built from `NAV`.
 *
 * Nothing here knows what a lead is. It renders entries, marks one active from the
 * current path, and shows a badge whose number arrives through the app-level
 * counts context — so no feature is imported, and any feature stays deletable.
 */

import { Link, useLocation } from "react-router-dom";
import { useCounts } from "../counts";
import { useUser } from "../auth";
import { vibe } from "../../lib/vibe";
import { Icon } from "../../ui/Icon";
import { ThemeSwitcher } from "../../theme/ThemeSwitcher";
import { segmentOf, visibleNav } from "../nav";

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { pathname } = useLocation();
  const active = segmentOf(pathname);
  const { openLeads } = useCounts();
  const me = useUser();

  return (
    <aside>
      <div className="brand">
        <span className="mark" aria-hidden="true">
          F
        </span>
        <b className="lbl">Frontline</b>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          <Icon name="panelLeft" />
        </button>
      </div>

      <nav>
        {visibleNav().map((entry, i) =>
          entry.kind === "section" ? (
            // Index in the key because two sections could share a label; the array
            // is static, so the index is stable.
            <span className="nav-label" key={`s${i}`}>
              {entry.label}
            </span>
          ) : (
            <Link
              key={entry.segment}
              to={`/${entry.segment}`}
              className={entry.segment === active ? "on" : ""}
              // Carries the label for the collapsed rail, where the text is hidden.
              title={entry.label}
              aria-current={entry.segment === active ? "page" : undefined}
            >
              <Icon name={entry.glyph} />
              <span className="lbl">{entry.label}</span>
              {/* Nothing until the count is known — a zero would claim an empty
                  inbox before anything has been fetched. */}
              {entry.badge && openLeads ? <span className="ct">{openLeads}</span> : null}
            </Link>
          )
        )}
      </nav>

      <div className="foot">
        <div id="me">
          <b>{me.user?.name ?? me.user?.email ?? "…"}</b>
          <br />
          org {String(me.org?.orgId ?? "")}
        </div>
        <div className="foot-row">
          <ThemeSwitcher />
          <button
            type="button"
            className="icon-btn"
            onClick={() => vibe.logout()}
            title="Sign out"
            aria-label="Sign out"
          >
            <Icon name="logOut" />
          </button>
        </div>
      </div>
    </aside>
  );
}
