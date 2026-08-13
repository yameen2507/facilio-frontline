/**
 * Icons — Facilio's own set where it has one, hand-drawn SVG where it doesn't.
 *
 * `<fc-icon>` from `@facilio/icons` fetches each SVG from icons.facilio.com at
 * render time. Everything below follows from that one fact:
 *
 * HOW TO USE IT AT ALL. The import is `@facilio/icons/dist/bundle.js`, not
 * `@facilio/icons` and not `@facilio/icons/dist/loader`. The published version
 * (1.8.0-beta-lit-1.0) is a Lit rewrite whose tarball contains only `bundle.js`,
 * while its package.json still advertises a `main`, `types` and Stencil-era
 * `loader` that were never published — all three of those import paths fail to
 * resolve. The bundle self-registers `fc-icon` at module scope, so there is no
 * `defineCustomElements(window)` step.
 *
 * WHY NAMES LIVE IN A MAP HERE. A wrong group/name fetches a URL that 403s, and
 * the component swallows the error and renders nothing — an absent icon, no
 * warning. Every pair below was verified against the CDN with a real request
 * before being written down; none were guessed. The CDN has no listing endpoint,
 * so this map IS the index.
 *
 * WHY FIVE ARE STILL INLINE. The Facilio set has no equivalent — probed, not
 * assumed. There is a single `default/theme` glyph, but the theme control needs
 * three DISTINCT icons for light / dark / follow-system, and one glyph cannot
 * distinguish three states. Sidebar-collapse and back-arrow have no match at all.
 *
 * WHY EVERY INLINE GLYPH IS KEPT even where a Facilio icon is used: emptying
 * `FACILIO` below reverts the whole app to inline SVGs with no other edit. If the
 * app's CSP turns out to block `connect-src` to icons.facilio.com, every fc-icon
 * goes blank — and that one-line revert is the fix.
 *
 * `color="currentColor"` is what makes these behave like the inline ones: the
 * component injects it as `fill` on the fetched SVG, so an icon inherits its
 * parent's colour and an active nav item recolours its icon for free.
 */

import "@facilio/icons/dist/bundle.js";

import type { ReactElement } from "react";

/** group/name pairs, each confirmed to return 200 from the CDN. */
const FACILIO: Partial<Record<IconName, { group: string; name: string }>> = {
  inbox: { group: "default", name: "workorder" },
  building: { group: "default", name: "building" },
  sliders: { group: "default", name: "settings" },
  chat: { group: "default", name: "comment" },
  logOut: { group: "action", name: "sign-out" },
  refresh: { group: "action", name: "refresh" },
};

const GLYPHS = {
  inbox: (
    <>
      <path d="M1.8 8.6 3.4 3.2A1.4 1.4 0 0 1 4.7 2.2h6.6a1.4 1.4 0 0 1 1.3 1l1.6 5.4" />
      <path d="M1.8 8.6h3.1l.9 1.8h4.4l.9-1.8h3.1v3.6a1.4 1.4 0 0 1-1.4 1.4H3.2a1.4 1.4 0 0 1-1.4-1.4Z" />
    </>
  ),
  building: (
    <>
      <path d="M2.6 14V3.1a.9.9 0 0 1 .9-.9h6a.9.9 0 0 1 .9.9V14" />
      <path d="M10.4 6.4h2.2a.9.9 0 0 1 .9.9V14" />
      <path d="M1.4 14h13.2" />
      <path d="M5.1 5.2h2.6M5.1 8h2.6M5.1 10.8h2.6" />
    </>
  ),
  sliders: (
    <>
      <path d="M2.4 4.6h11.2M2.4 11.4h11.2" />
      <circle cx="6" cy="4.6" r="1.7" />
      <circle cx="10.4" cy="11.4" r="1.7" />
    </>
  ),
  chat: <path d="M13.8 8.1c0 2.7-2.6 4.9-5.8 4.9-.7 0-1.4-.1-2-.3L2.2 14l1.1-2.7A4.6 4.6 0 0 1 2.2 8.1c0-2.7 2.6-4.9 5.8-4.9s5.8 2.2 5.8 4.9Z" />,
  panelLeft: (
    <>
      <rect x="2" y="2.6" width="12" height="10.8" rx="1.5" />
      <path d="M6.4 2.6v10.8" />
    </>
  ),
  logOut: (
    <>
      <path d="M6.2 14H3.4A1.4 1.4 0 0 1 2 12.6V3.4A1.4 1.4 0 0 1 3.4 2h2.8" />
      <path d="M10.4 11.2 13.6 8l-3.2-3.2" />
      <path d="M13.6 8H6" />
    </>
  ),
  refresh: (
    <>
      <path d="M13.7 6.7A5.8 5.8 0 0 0 3.4 4.5L2 6" />
      <path d="M2.3 9.3a5.8 5.8 0 0 0 10.3 2.2L14 10" />
      <path d="M2 2.6V6h3.4M14 13.4V10h-3.4" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1v1.7M8 13.3V15M1 8h1.7M13.3 8H15M3.05 3.05l1.2 1.2M11.75 11.75l1.2 1.2M12.95 3.05l-1.2 1.2M4.25 11.75l-1.2 1.2" />
    </>
  ),
  moon: <path d="M13.4 9.9A5.7 5.7 0 0 1 6.1 2.6a5.7 5.7 0 1 0 7.3 7.3Z" />,
  monitor: (
    <>
      <rect x="1.6" y="2.6" width="12.8" height="8.6" rx="1.4" />
      <path d="M5.6 13.8h4.8M8 11.2v2.6" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M13 8H3" />
      <path d="M6.8 3.8 2.6 8l4.2 4.2" />
    </>
  ),
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof GLYPHS;

export function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const facilio = FACILIO[name];

  if (facilio) {
    return (
      // No className: the `fc-icon` element selector in app.css already carries
      // the layout the `.ic` class provides for the inline SVGs.
      <fc-icon
        group={facilio.group}
        // A bare number: the component interpolates it into `${size}px`, so
        // passing "15px" would produce "15pxpx" and size nothing.
        size={String(size)}
        name={facilio.name}
        color="currentColor"
        // Reserves the box before the fetch resolves. Without it the host is
        // zero-width until the SVG arrives, and every row holding an icon
        // visibly reflows a moment after paint.
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  return (
    <svg
      className="ic"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}
