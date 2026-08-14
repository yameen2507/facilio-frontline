/**
 * The prospect portfolio sub-router — the only file in this feature the app shell
 * imports.
 *
 * THREE ROUTES, not a tab set, and for the reason the proposal document is its own
 * route: the tree and the convert are used by different people at different points
 * in the pursuit. The RFP coordinator lives in the tree for weeks; the ops lead
 * opens the convert once, on the day the deal closes. A tab would make each of
 * them scroll past the other's work, and neither could send a link to theirs.
 *
 * The deal rides in `?deal=` on both, so a specific pursuit's portfolio is a URL —
 * which is what makes "look at Al Bayt Grill's tree" a link rather than a set of
 * directions. When the Deal detail surface lands (`F-14`), the tree becomes its
 * Portfolio tab and the picker on these pages goes away.
 */

import { Route, Routes } from "react-router-dom";
import { ConvertToFacilio } from "./pages/ConvertToFacilio";
import { LocationDetail } from "./pages/LocationDetail";
import { PortfolioTree } from "./pages/PortfolioTree";

export function ProspectsRouter() {
  return (
    <Routes>
      <Route index element={<PortfolioTree />} />
      <Route path="convert" element={<ConvertToFacilio />} />
      <Route path=":id" element={<LocationDetail />} />
    </Routes>
  );
}
