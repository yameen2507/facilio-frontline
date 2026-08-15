/**
 * Applies the intake agent's brief and output schema to the platform.
 *
 * THIS IS THE ONLY THING THAT MAKES agent-schemas/ REAL. Nothing imports those
 * files — not the bundle, not push.mjs, not a test — so editing them changes
 * the agent's behaviour exactly as much as editing a README does until this
 * runs. A green typecheck and a green test suite say nothing about them.
 *
 * `role` and `instructions` are AGENT fields, not schema fields. They used to
 * live as extra top-level keys inside lead-intake.json, where they were passed
 * to --output-schema-file and rode into the provider's schema slot as
 * non-keywords: ignored at best, rejected as an invalid schema at worst. They
 * are separate CLI flags and separate files now.
 *
 * UPDATE, NEVER DELETE-THEN-CREATE. `agent delete` leaves the flow-ai record
 * behind, so recreating an agent under the same name fails on a duplicate link
 * name and burns the name for good (ARCHITECTURE.md § agents — this is why
 * `lead-intake` had to become `intake`). There is no --force here on purpose.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The logical name ON THE PLATFORM, which is not the schema's file name. */
const AGENTS = [
  {
    name: "intake",
    role: "agent-schemas/lead-intake.role.txt",
    instructions: "agent-schemas/lead-intake.instructions.md",
    schema: "agent-schemas/lead-intake.json",
  },
];

const read = (rel) => readFileSync(join(root, rel), "utf8").trim();

for (const agent of AGENTS) {
  const instructions = read(agent.instructions);

  // Passed as argv, never through a shell — the brief is ~19KB of prose with
  // quotes, newlines and apostrophes in it, and any shell interpolation of that
  // is a quoting bug waiting to truncate the agent's instructions silently.
  const args = [
    "vibe",
    "agent",
    "update",
    agent.name,
    "--role",
    read(agent.role),
    "--instructions",
    instructions,
    "--output-schema-file",
    join(root, agent.schema),
  ];

  process.stdout.write(`${agent.name}: ${instructions.length} chars of instructions… `);
  execFileSync("facilio", args, { stdio: ["ignore", "pipe", "inherit"] });
  console.log("updated");
}

console.log("\nVerify with:  facilio vibe agent get intake");
console.log("It prints role, instructions and output_schema verbatim — that is the only proof this landed.");
