/**
 * The proposals sub-router — the only file in this feature the app shell imports.
 *
 * The document is a route under the proposal rather than a tab on it, for the
 * same reason the survey walk is: it is a different artifact for a different
 * audience, it is what gets printed, and it has to be linkable on its own so
 * "send me the PDF" is a URL rather than a set of instructions.
 */

import { Route, Routes } from "react-router-dom";
import { ProposalDetail } from "./pages/ProposalDetail";
import { ProposalDocument } from "./pages/ProposalDocument";
import { ProposalList } from "./pages/ProposalList";

export function ProposalsRouter() {
  return (
    <Routes>
      <Route index element={<ProposalList />} />
      <Route path=":id" element={<ProposalDetail />} />
      <Route path=":id/document" element={<ProposalDocument />} />
    </Routes>
  );
}
