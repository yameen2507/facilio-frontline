/**
 * The templates sub-router — the only file in this feature the app shell imports.
 *
 * `/new` sits before `/:id` so a template can never be called "new".
 */

import { Route, Routes } from "react-router-dom";
import { TemplateBuilder } from "./pages/TemplateBuilder";
import { TemplateList } from "./pages/TemplateList";

export function TemplatesRouter() {
  return (
    <Routes>
      <Route index element={<TemplateList />} />
      <Route path="new" element={<TemplateBuilder />} />
      <Route path=":id" element={<TemplateBuilder />} />
    </Routes>
  );
}
