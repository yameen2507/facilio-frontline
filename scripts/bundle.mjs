/**
 * Bundles each src/functions/<name>/index.ts into a single build/functions/<name>.js.
 *
 * The platform uploads ONE file per function, so anything shared (src/shared,
 * src/domain) has to be inlined here — relative imports would not resolve on the
 * far side. `@facilio/studio-functions` stays external: it is unavailable locally
 * (404 on repo.facilio.in) and is provided by the platform build.
 *
 * No minify on purpose — platform build errors quote source, and readable output
 * is worth more than a few kB.
 */

import { build } from "esbuild";
import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src", "functions");
const OUT = join(process.cwd(), "build", "functions");

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const names = readdirSync(SRC, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((n) => existsSync(join(SRC, n, "index.ts")))
  .filter((n) => (only.length ? only.includes(n) : true));

if (!names.length) {
  console.error(only.length ? `No such function: ${only.join(", ")}` : "No functions found");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

for (const name of names) {
  await build({
    entryPoints: [join(SRC, name, "index.ts")],
    outfile: join(OUT, `${name}.js`),
    bundle: true,
    format: "esm",
    target: "es2020",
    platform: "neutral",
    external: ["@facilio/studio-functions"],
    minify: false,
    logLevel: "warning",
  });
  console.log(`✓ bundled ${name} → build/functions/${name}.js`);
}
