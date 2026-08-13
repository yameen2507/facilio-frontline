/**
 * Builds the test console into `dist/` — the folder `vibe.json` publishes.
 *
 * The SDK is bundled rather than loaded from unpkg: the app is served with a CSP
 * whose `script-src` does not include a CDN, so a `<script src="https://unpkg…">`
 * would be blocked. Bundling keeps everything same-origin.
 */

import { build } from "esbuild";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "dist");
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: ["src/web/main.js"],
  outfile: join(OUT, "app.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: false, // keep it readable — this is a debugging tool
  logLevel: "warning",
});

// `index.html` MUST sit at the root of the publish folder or the URL serves nothing.
copyFileSync("src/web/index.html", join(OUT, "index.html"));

const sizes = readdirSync(OUT)
  .map((f) => `${f} ${(statSync(join(OUT, f)).size / 1024).toFixed(1)}kB`)
  .join(" · ");

console.log(`✓ built dist/ — ${sizes}`);
