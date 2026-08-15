/**
 * The provider stack and the route table.
 *
 * PROVIDERS NEST WIDEST-SCOPE FIRST, because each inner one may read the outer:
 *
 *   ToastProvider    anything, at any depth, may need to report
 *     ThemeProvider  so the sign-in screen is themed too, not just the app
 *       AuthGate     nothing below here renders until the session check passes
 *         Access     who the signed-in user is and what their role permits —
 *                    reads the gate's identity, so it sits inside it
 *           Counts   app-level state the sidebar reads and a feature feeds
 *             Router
 *
 * `AuthGate` is a GATE, not a wrapper: the authenticated route tree does not exist
 * until it passes, rather than rendering behind a prompt.
 *
 * HashRouter, not BrowserRouter. The platform serves a static folder with no
 * rewrite rules, so a real path would 404 on reload. Note this makes URLs
 * `#/leads/<id>`, where the legacy console used `#lead/<id>` — bookmarks do not
 * carry across.
 *
 * Each feature is mounted as a splat route and owns everything under its segment.
 * The shell imports one file per feature and knows nothing else about them.
 */

import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import Layout from "../layout";
import { AccountsRouter } from "../features/accounts";
import { ChatRouter, Embed } from "../features/chat";
import { DealsRouter } from "../features/deals";
import { LeadsRouter } from "../features/leads";
import { ProposalsRouter } from "../features/proposals";
import { ProspectsRouter } from "../features/prospects";
import { SettingsRouter } from "../features/settings";
import { SurveysRouter } from "../features/surveys";
import { TemplatesRouter } from "../features/templates";
import { ThemeProvider } from "../theme/ThemeProvider";
import { LinkButton } from "../ui/Button";
import { Empty } from "../ui/States";
import { ToastProvider } from "../ui/Toast";
import { AccessProvider } from "./access";
import { AuthGate } from "./auth";
import { CountsProvider } from "./counts";
import { DEFAULT_ROUTE } from "../layout/sidebar/nav-config";
import { PageShell } from "./shell/PageShell";

/**
 * The ported layout takes `children`, while the router hands its nested routes to
 * an `<Outlet />`. This adapter is the join, and it is what keeps the shell — and
 * therefore the sidebar's scroll position and the rail's collapse animation —
 * mounted across navigations instead of remounting per route.
 *
 * It is also where a page change is made to READ as a change: the routed pane
 * fades in on arrival (`.page-enter`, globals.css) while the sidebar beside it
 * stays put, so navigation is one thing moving rather than the whole window
 * repainting.
 */
function Shell() {
  const { pathname } = useLocation();
  // Settings is ONE pane with an internal side nav: its section routes swap the
  // pane's body themselves (SettingsLayout keys and fades just the routed
  // section), so collapsing them to one key here keeps the Settings header and
  // rail mounted across section clicks instead of fading the whole pane.
  const paneKey = pathname.startsWith("/settings") ? "/settings" : pathname;
  return (
    <Layout>
      {/* The key is what makes this a transition at all: React would otherwise
          reuse this DOM node across a navigation and a CSS animation, once
          finished, does not re-run on a node that never left. Remounting is
          also what hands each page a fresh scroll region, so a list you had
          scrolled halfway down opens at the top rather than mid-page.

          Keyed on the PATH alone, not the whole location — the survey list
          keeps its active tab in the query string, and including `search`
          would replay the fade, and throw away the list, on every tab click.

          h-full so the definite height passes straight through to each page's
          own `h-full` PageShell; a pane that panels itself into fixed columns
          (LeadDetail, AccountDetail) collapses without it. */}
      <div key={paneKey} className="page-enter h-full">
        <Outlet />
      </div>
    </Layout>
  )
}

function NotFound() {
  return (
    <PageShell title="Not found">
      <Empty
        title="No such page"
        body="The link may be from an older version of this console."
        action={<LinkButton to={DEFAULT_ROUTE}>Go to the lead inbox</LinkButton>}
      />
    </PageShell>
  );
}

/**
 * `#/embed` is the widget alone, for a host page's iframe — and it is answered
 * HERE, above the router, because the router is not reachable from outside the
 * gate. `AuthGate` wraps `HashRouter`, so a route declared in the table below
 * would still be behind a sign-in prompt, and a sign-in prompt is not what
 * belongs in a 400px frame on a company website.
 *
 * Read from `location.hash` rather than a route: HashRouter has not mounted yet
 * at this point. The query string is stripped so `#/embed?x=1` still matches.
 *
 * ToastProvider stays — the widget reports failures through it.
 */
const isEmbed = () => window.location.hash.replace(/^#/, "").split("?")[0] === "/embed";

export function App() {
  if (isEmbed()) {
    return (
      <ToastProvider>
        <Embed />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <ThemeProvider>
        <AuthGate>
          {/* Inside the gate — the bootstrap needs the signed-in email. */}
          <AccessProvider>
            <CountsProvider>
              <HashRouter>
                <Routes>
                  {/* A pathless layout route: the shell renders once and stays
                      mounted across navigations, so the sidebar never remounts. */}
                  <Route element={<Shell />}>
                    <Route index element={<Navigate to={DEFAULT_ROUTE} replace />} />
                    <Route path="leads/*" element={<LeadsRouter />} />
                    <Route path="accounts/*" element={<AccountsRouter />} />
                    <Route path="surveys/*" element={<SurveysRouter />} />
                    <Route path="templates/*" element={<TemplatesRouter />} />
                    <Route path="deals/*" element={<DealsRouter />} />
                    <Route path="portfolio/*" element={<ProspectsRouter />} />
                    <Route path="proposals/*" element={<ProposalsRouter />} />
                    <Route path="settings/*" element={<SettingsRouter />} />
                    <Route path="chat/*" element={<ChatRouter />} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Routes>
              </HashRouter>
            </CountsProvider>
          </AccessProvider>
        </AuthGate>
      </ThemeProvider>
    </ToastProvider>
  );
}
