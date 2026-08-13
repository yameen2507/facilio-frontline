/**
 * Entry point.
 *
 * NO CSS IMPORT HERE. The stylesheet is Tailwind (globals.css → dist/app.css),
 * compiled by @tailwindcss/cli in scripts/build-frontend.mjs — esbuild cannot
 * expand Tailwind's @import or scan sources for classes, so bundling it here
 * would ship the directives verbatim. index.html links the compiled file.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";

const container = document.getElementById("root");

// Throwing beats a silent blank page: if the mount point is missing, the HTML and
// the bundle have gone out of step and that is worth failing loudly.
if (!container) throw new Error("index.html is missing its #root element");

createRoot(container).render(
  // A no-op in the production build; in a development build it double-invokes
  // effects, which is what surfaces an effect that is not safe to run twice.
  <StrictMode>
    <App />
  </StrictMode>
);
