/**
 * The provider stack and the route table.
 *
 * PROVIDERS NEST WIDEST-SCOPE FIRST, because each inner one may read the outer:
 *
 *   ToastProvider    anything, at any depth, may need to report
 *     ThemeProvider  so the sign-in screen is themed too, not just the app
 *       AuthGate     nothing below here renders until the session check passes
 *         Counts     app-level state the sidebar reads and a feature feeds
 *           Router
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

import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AccountsRouter } from "../features/accounts";
import { ChatRouter } from "../features/chat";
import { LeadsRouter } from "../features/leads";
import { SettingsRouter } from "../features/settings";
import { ThemeProvider } from "../theme/ThemeProvider";
import { LinkButton } from "../ui/Button";
import { Empty } from "../ui/States";
import { ToastProvider } from "../ui/Toast";
import { AuthGate } from "./auth";
import { CountsProvider } from "./counts";
import { DEFAULT_ROUTE } from "./nav";
import { AppShell } from "./shell/AppShell";
import { PageShell } from "./shell/PageShell";

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

export function App() {
  return (
    <ToastProvider>
      <ThemeProvider>
        <AuthGate>
          <CountsProvider>
            <HashRouter>
              <Routes>
                {/* A pathless layout route: the shell renders once and stays
                    mounted across navigations, so the sidebar never remounts. */}
                <Route element={<AppShell />}>
                  <Route index element={<Navigate to={DEFAULT_ROUTE} replace />} />
                  <Route path="leads/*" element={<LeadsRouter />} />
                  <Route path="accounts/*" element={<AccountsRouter />} />
                  <Route path="settings/*" element={<SettingsRouter />} />
                  <Route path="chat/*" element={<ChatRouter />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </HashRouter>
          </CountsProvider>
        </AuthGate>
      </ThemeProvider>
    </ToastProvider>
  );
}
