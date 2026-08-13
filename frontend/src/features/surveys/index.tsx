/**
 * The surveys sub-router — the only file in this feature the app shell imports.
 *
 * The walk is a route under the survey rather than a tab on it: it is a
 * different person, on a phone, on site, and it should be linkable on its own.
 */

import { Route, Routes } from "react-router-dom";
import { SurveyDetail } from "./pages/SurveyDetail";
import { SurveyList } from "./pages/SurveyList";
import { SurveyWalk } from "./pages/SurveyWalk";

export function SurveysRouter() {
  return (
    <Routes>
      <Route index element={<SurveyList />} />
      <Route path=":id" element={<SurveyDetail />} />
      <Route path=":id/walk" element={<SurveyWalk />} />
    </Routes>
  );
}
