/**
 * Lets TypeScript accept `import "./ui/app.css"`.
 *
 * esbuild resolves and bundles the stylesheet; tsc only needs to know the module
 * exists, or the side-effect import is an error (TS2882). The declaration is
 * intentionally empty — a CSS file exports nothing here, since these are plain
 * stylesheets rather than CSS modules.
 */

declare module "*.css";
