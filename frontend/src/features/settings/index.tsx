/**
 * The settings sub-router — the only file in this feature the app shell imports.
 * One page today; the splat route means adding a second needs no shell change.
 */

import { Route, Routes } from "react-router-dom";
import { Settings } from "./pages/Settings";

export function SettingsRouter() {
  return (
    <Routes>
      <Route index element={<Settings />} />
    </Routes>
  );
}
