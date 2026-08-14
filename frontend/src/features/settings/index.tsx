/**
 * The settings sub-router — the only file in this feature the app shell imports.
 * One layout route carries the PageShell and the side nav; the sections
 * (spec §10's Users & Access, the two service sections and the rate cards)
 * render into its outlet, so each deep-links and survives a reload under the
 * HashRouter.
 */

import { Route, Routes } from "react-router-dom";
import { SettingsLayout } from "./components/SettingsLayout";
import { RateCards } from "./pages/RateCards";
import { ServiceCoverage } from "./pages/ServiceCoverage";
import { ServiceLinks } from "./pages/ServiceLinks";
import { Permissions } from "./pages/Permissions";
import { Roles } from "./pages/Roles";
import { Users } from "./pages/Users";

export function SettingsRouter() {
  return (
    <Routes>
      <Route element={<SettingsLayout />}>
        <Route index element={<ServiceCoverage />} />
        <Route path="service-links" element={<ServiceLinks />} />
        {/* One route, not `rate-cards/:cardId`: which card is being edited is
            component state, so the nav's exact match keeps this entry lit and
            the layout does not re-fade the pane on every card click. */}
        <Route path="rate-cards" element={<RateCards />} />
        <Route path="users" element={<Users />} />
        <Route path="roles" element={<Roles />} />
        <Route path="permissions" element={<Permissions />} />
      </Route>
    </Routes>
  );
}
