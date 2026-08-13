/**
 * Entry point.
 *
 * IMPORT ORDER MATTERS. `dsm-core.css` is the real design system — it defines
 * every `--colors-*` / `--spacing-*` / `--text-*` token and the
 * `:root[data-theme='dark']` block that themes them. It must land before
 * `app.css`, so our own rules can override rather than be overridden. esbuild
 * emits the bundled stylesheet in import order, so this order is the cascade.
 */

import "@facilio/dsm-core/dist/dsm-core/dsm-core.css";
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
