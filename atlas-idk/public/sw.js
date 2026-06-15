const CACHE = "axiom-v4";
const STATIC_PRECACHE = ["/manifest.json", "/axiom-logo.svg", "/favicon.svg", "/opengraph.jpg"];

// On install: precache known static assets and take control immediately
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC_PRECACHE))
  );
  self.skipWaiting();
});

// On activate: clear old caches and claim all clients
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests (e.g. API calls, fonts CDN)
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // OAuth broker paths MUST always hit the network — never cache or intercept.
  // The Lovable proxy worker handles /~oauth/initiate and /~oauth/callback.
  if (url.pathname.startsWith("/~oauth")) return;

  // API calls: always network, never cache
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests (HTML pages): network first, fall back to cached shell
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match("/") ?? caches.match(request))
    );
    return;
  }

  // Vite-hashed assets (/assets/*.js, /assets/*.css): cache first, then network
  // These are immutable — hash changes when content changes
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
          return res;
        });
      })
    );
    return;
  }

  // Everything else (images, svg, manifest): stale-while-revalidate
  e.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(request, clone));
        return res;
      });
      return cached || networkFetch;
    })
  );
});
