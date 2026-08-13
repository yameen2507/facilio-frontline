/**
 * Builds the frontend into `dist/` — the folder `vibe.json` publishes.
 *
 * This is the only frontend build. The vanilla console that used to live in
 * `src/web/` was removed once the React app replaced it, along with its
 * `build-web.mjs`; outputting here rather than to a second folder is what keeps
 * `vibe.json` correct and preserves the convention that `dist/` is what ships.
 *
 * Minified, unlike the old vanilla build. React and the router are ~700kB
 * unminified and ~230kB minified (~90kB over the wire), and nobody debugs a React
 * bundle by reading it — a sourcemap is emitted instead. The `.map` files are
 * gitignored; they are ~1.5MB and rebuildable.
 *
 * Usage: node scripts/build-frontend.mjs   (npm run build:frontend)
 */

import { build } from "esbuild";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "dist");
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: ["frontend/src/main.tsx"],
  outfile: join(OUT, "app.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  minify: true,
  sourcemap: true,
  // React reads this to strip development-only warnings and checks. Without it the
  // bundle keeps the dev build, which is both larger and slower.
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

// `index.html` MUST sit at the root of the publish folder or the URL serves nothing.
copyFileSync("frontend/index.html", join(OUT, "index.html"));

// Copied rather than bundled: it runs from <head> before the bundle, to stamp the
// saved theme before the first paint. React mounts long after that, so bundling it
// would defeat its only purpose.
copyFileSync("frontend/theme-boot.js", join(OUT, "theme-boot.js"));

const sizes = readdirSync(OUT)
  .map((f) => `${f} ${(statSync(join(OUT, f)).size / 1024).toFixed(1)}kB`)
  .join(" · ");

console.log(`✓ built dist/ — ${sizes}`);
