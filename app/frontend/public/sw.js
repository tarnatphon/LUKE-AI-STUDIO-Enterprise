/* LUKE AI STUDIO — offline app shell.
 *
 * The studio already runs without a network: the models, the chat history and
 * the outputs live on this machine. This worker only keeps the *interface*
 * available when the browser cannot reach the local server, so a phone on the
 * LAN sees the UI instead of a blank tab.
 *
 * /api/ responses are deliberately never cached. A cached status, a cached
 * chain answer or a cached egress ledger would be a lie, and this app's whole
 * point is that its state can be trusted.
 */

const CACHE = "luke-app-shell-v1";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/luke-icon-192.png", "/luke-icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/")) return;

  // Navigations: network first so a rebuilt bundle is picked up, falling back
  // to the cached shell when the host is unreachable.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  // Hashed static assets: cache first, then fetch and remember.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
