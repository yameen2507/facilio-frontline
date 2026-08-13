/**
 * Stamps the saved theme on <html> before the page paints.
 *
 * This is a separate file loaded synchronously from <head> rather than an inline
 * <script>, on purpose: the app is served with a CSP whose `script-src` is not
 * documented to include `'unsafe-inline'` (llm.md only promises no CDN), and a
 * blocked inline script would fail silently on every load. A same-origin file is
 * the same guarantee as `app.js` already relies on.
 *
 * It cannot be part of the bundle either: `app.js` is loaded at the end of
 * <body>, so the browser has already painted the light default by the time it
 * runs, and a user who chose dark would see a white flash on every navigation.
 *
 * Deliberately dependency-free and un-bundled — `scripts/build-web.mjs` copies
 * it verbatim. Keep it tiny; it blocks the parser.
 *
 * The storage key is duplicated in `ui/theme.js`. Change both together.
 */
(function () {
  try {
    var saved = localStorage.getItem("frontline.theme");
    // "system" (and anything unrecognised) leaves the attribute off, which is
    // what hands control back to the prefers-color-scheme block in tokens.css.
    if (saved === "dark" || saved === "light") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  } catch (e) {
    // Storage throws in some private-browsing modes. The system preference is
    // still honoured, so there is nothing to recover from.
  }
})();
