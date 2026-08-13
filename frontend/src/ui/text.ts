/**
 * The type scale, as style objects.
 *
 * READ THIS BEFORE USING IT. Typography normally comes from a class in
 * `app.css`, which carries the `font:` shorthand token — that is the default and
 * covers almost everything. These objects exist for the case the shorthand cannot
 * serve: styling text inline, or overriding a size or line-height.
 *
 * THE RULE: never both in one style object. A `font:` shorthand beside a
 * `fontSize` warns on every render, and it is easy to hit precisely because the
 * shorthand arrives invisibly from a token while the override is added later by
 * someone who cannot see it. The shorthand also bakes in line-height, so it
 * cannot be overridden alongside. Pick a lane per element: either a class, or one
 * of these spread objects — never a class plus a font override.
 *
 * Longhand on purpose, for the same reason. Colour is set at the call site: the
 * scale is size and weight, colour is semantic and varies per use.
 *
 * Values mirror the `--text-*` tokens in tokens.css. If you change one there,
 * change it here — a stylesheet variable cannot be spread into a style object.
 */

import type { CSSProperties } from "react";

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif';
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** --text-heading-smb-20 */
export const headingSmb20: CSSProperties = {
  fontFamily: SANS,
  fontSize: "20px",
  fontWeight: 600,
  lineHeight: 1.3,
};

/** --text-heading-med-16 */
export const headingMed16: CSSProperties = {
  fontFamily: SANS,
  fontSize: "16px",
  fontWeight: 500,
  lineHeight: 1.45,
};

/** --text-heading-med-14 — the label / emphasis step */
export const headingMed14: CSSProperties = {
  fontFamily: SANS,
  fontSize: "14px",
  fontWeight: 500,
  lineHeight: 1.5,
};

/** --text-body-reg-14 — the body default */
export const bodyReg14: CSSProperties = {
  fontFamily: SANS,
  fontSize: "14px",
  fontWeight: 400,
  lineHeight: 1.55,
};

/** --text-caption-reg-12 */
export const captionReg12: CSSProperties = {
  fontFamily: SANS,
  fontSize: "12px",
  fontWeight: 400,
  lineHeight: 1.45,
};

/** --text-caption-med-ll-12 */
export const captionMed12: CSSProperties = {
  fontFamily: SANS,
  fontSize: "12px",
  fontWeight: 500,
  lineHeight: 1.5,
};

/** --text-caption-med-10 — uppercase micro-labels */
export const captionMed10: CSSProperties = {
  fontFamily: SANS,
  fontSize: "10px",
  fontWeight: 500,
  lineHeight: 1.4,
};

/** Reference numbers and ids. Mono runs optically large, hence 11px beside 12px. */
export const mono11: CSSProperties = {
  fontFamily: MONO,
  fontSize: "11px",
  fontWeight: 400,
  lineHeight: 1.45,
};
