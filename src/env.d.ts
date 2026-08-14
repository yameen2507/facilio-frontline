/**
 * The sliver of the host environment the backend actually touches.
 *
 * WHY THIS EXISTS instead of `@types/node`: the backend compiles to WASM through
 * `scripts/bundle.mjs` and runs inside the Vibe function host, not Node. Pulling
 * the whole Node typings surface in would declare thousands of APIs — `fs`,
 * `net`, `child_process` — that are unavailable at runtime, so the typecheck
 * would cheerfully approve code the platform cannot execute. Declaring only what
 * is really reachable keeps the typecheck honest about the platform (§3a).
 *
 * `fetch` is declared by the DOM lib in `tsconfig.json` rather than here; the
 * host provides it and `shared/facilio.ts` is its only caller.
 */

declare const process: {
  readonly env: Record<string, string | undefined>;
};
