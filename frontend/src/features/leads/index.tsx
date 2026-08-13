/**
 * The leads sub-router — the only file in this feature the app shell imports.
 *
 * The feature owns its path namespace: `/leads` is the inbox, `/leads/:id` is one
 * lead. Because a detail page stays under the same first path segment, the sidebar
 * highlight needs no special case for it.
 */

import { Route, Routes } from "react-router-dom";
import { Inbox } from "./pages/Inbox";
import { LeadDetail } from "./pages/LeadDetail";

export function LeadsRouter() {
  return (
    <Routes>
      <Route index element={<Inbox />} />
      <Route path=":id" element={<LeadDetail />} />
    </Routes>
  );
}
