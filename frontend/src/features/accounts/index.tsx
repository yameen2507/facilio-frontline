/**
 * The accounts sub-router — the only file in this feature the app shell imports.
 */

import { Route, Routes } from "react-router-dom";
import { AccountDetail } from "./pages/AccountDetail";
import { AccountList } from "./pages/AccountList";

export function AccountsRouter() {
  return (
    <Routes>
      <Route index element={<AccountList />} />
      <Route path=":id" element={<AccountDetail />} />
    </Routes>
  );
}
