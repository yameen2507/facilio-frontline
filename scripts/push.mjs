/**
 * Uploads and builds bundled functions on the platform.
 *
 * `create` fails if the function already exists and `update` fails if it does
 * not, so this tries create first and falls back to update. Build is always
 * required afterwards — an un-rebuilt function keeps serving its old WASM.
 *
 * Usage: node scripts/push.mjs [name ...] [--no-build]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "build", "functions");

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const skipBuild = process.argv.includes("--no-build");

if (!existsSync(OUT)) {
  console.error("No build/functions — run `node scripts/bundle.mjs` first");
  process.exit(1);
}

const names = readdirSync(OUT)
  .filter((f) => f.endsWith(".js"))
  .map((f) => f.replace(/\.js$/, ""))
  .filter((n) => (only.length ? only.includes(n) : true));

if (!names.length) {
  console.error("Nothing to push");
  process.exit(1);
}

const run = (args) =>
  execFileSync("facilio", args, { stdio: "pipe", encoding: "utf8" });

const lastLine = (e) =>
  `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").filter(Boolean).pop() ?? String(e);

let failed = 0;

for (const name of names) {
  const file = join(OUT, `${name}.js`);

  try {
    run(["vibe", "function", "create", name, "--code", file, "--description", `${name} handlers`]);
    console.log(`✓ created ${name}`);
  } catch {
    try {
      run(["vibe", "function", "update", name, "--code", file]);
      console.log(`✓ updated ${name}`);
    } catch (e) {
      console.error(`✗ upload ${name}: ${lastLine(e)}`);
      failed++;
      continue;
    }
  }

  if (skipBuild) continue;

  try {
    const out = run(["vibe", "function", "build", name]);
    const handlers = out.match(/Handlers:\s*(.+)/)?.[1]?.trim();
    console.log(`✓ built ${name}${handlers ? ` — handlers: ${handlers}` : ""}`);
  } catch (e) {
    console.error(`✗ build ${name}: ${lastLine(e)}`);
    failed++;
  }
}

if (failed) process.exitCode = 1;
