/**
 * The chat sub-router — the only file in this feature the app shell imports.
 *
 * `Embed` is re-exported beside it rather than routed: it is the widget alone
 * for a host page's iframe, and it renders ABOVE the auth gate (see app/App),
 * so the shell needs it as a component, not as a route under this segment.
 */

import { Route, Routes } from "react-router-dom";
import { Playground } from "./pages/Playground";

export { Embed } from "./pages/Embed";

export function ChatRouter() {
  return (
    <Routes>
      <Route index element={<Playground />} />
    </Routes>
  );
}
