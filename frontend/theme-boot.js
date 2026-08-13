/**
 * Stamps the resolved theme on <html> before the page paints.
 *
 * A separate file loaded synchronously from <head> rather than an inline
 * <script>: the app is served with a CSP whose `script-src` is not documented to
 * include `'unsafe-inline'`, and a blocked inline script would fail silently on
 * every load. A same-origin file is the same guarantee `app.js` already relies on.
 *
 * It cannot be part of the bundle either — React mounts long after the first
 * paint, so a dark-mode user would see a white flash on every load.
 *
 * ALWAYS SETS AN EXPLICIT light/dark VALUE. The real DSM stylesheet defines its
 * dark palette only under `:root[data-theme='dark']` and ships no
 * `prefers-color-scheme` block, so an absent attribute pins light rather than
 * following the OS. "System" therefore has to be resolved here too.
 *
 * The storage key and this resolution are duplicated in `src/theme/ThemeProvider.tsx`.
 * Change both together.
 */
(function () {
  var mode = "system";
  try {
    var saved = localStorage.getItem("frontline.theme");
    if (saved === "dark" || saved === "light" || saved === "system") mode = saved;
  } catch (e) {
    // Storage throws in some private-browsing modes; fall through to system.
  }

  var resolved = mode;
  if (mode === "system") {
    resolved =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  document.documentElement.setAttribute("data-theme", resolved);
})();
