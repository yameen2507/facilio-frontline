/**
 * Lets TypeScript accept a side-effect CSS import, should one ever return —
 * without a declaration it is an error (TS2882). Nothing imports CSS today
 * (globals.css is compiled by the Tailwind CLI, not bundled), but this file is
 * also the root tsconfig's one include, which keeps `npm run typecheck` at the
 * repo root the no-op it has always been. Delete it and that command starts
 * failing with TS18003 instead.
 */

declare module "*.css";
