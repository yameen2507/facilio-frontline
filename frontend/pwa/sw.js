/**
 * The service worker — deliberately MINIMAL.
 *
 * Runtime caching only, network-first, static shell only. This app is
 * auth-gated and data-live: caching API responses would show one surveyor
 * another's stale walk, and precaching at install would race the platform's
 * login redirect (a 302 to id.facilio.com during `cache.addAll` fails the
 * whole install). So nothing is cached until it has been served ONCE,
 * successfully, to this signed-in user — and API traffic is never touched.
 *
 * What this buys: installability (Chrome requires a fetch handler), instant
 * shell loads from cache when the network is slow, and a working app frame
 * offline — pages then show their real error states for data, which is the
 * honest offline story until offline capture is designed properly (the known
 * two-day trap the survey plan explicitly deferred).
 */

const CACHE = "frontline-shell-v1";

/** Only these exact same-origin paths are ever cached. */
const SHELL = new Set([
  "/",
  "/index.html",
  "/app.css",
  "/app.js",
  "/theme-boot.js",
  "/pwa-boot.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
]);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations resolve to the shell; anything not in the shell list — every
  // /api call included — goes straight to the network, untouched.
  const isNavigation = request.mode === "navigate";
  const path = isNavigation ? "/index.html" : url.pathname;
  if (!isNavigation && !SHELL.has(path)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache only clean same-origin 200s — a login redirect must never
        // become the cached copy of the app shell.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(path, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(path).then(
          (cached) =>
            cached ??
            new Response("Offline — and this page has not been visited yet.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
        )
      )
  );
});
