/**
 * Entry point.
 *
 * The CSS import is what makes esbuild emit `dist/app.css` beside `app.js`;
 * index.html links it. Remove this line and the app ships unstyled.
 */

import "./ui/app.css";

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
