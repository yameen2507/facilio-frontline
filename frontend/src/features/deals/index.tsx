/**
 * The deals sub-router — the only file in this feature the app shell imports.
 */

import { Route, Routes } from "react-router-dom";
import { DealDetail } from "./pages/DealDetail";
import { DealList } from "./pages/DealList";

export function DealsRouter() {
  return (
    <Routes>
      <Route index element={<DealList />} />
      <Route path=":id" element={<DealDetail />} />
    </Routes>
  );
}
