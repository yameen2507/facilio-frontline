/**
 * Service-worker registration, in its own file for the same reason as
 * theme-boot.js: the CSP is documented to exclude CDNs but says nothing about
 * 'unsafe-inline', and a blocked inline script fails silently. Deferred — the
 * worker matters for the NEXT load, never this one.
 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {
      // Registration failing (private mode, unsupported) costs nothing — the
      // app is a normal website without it.
    });
  });
}
