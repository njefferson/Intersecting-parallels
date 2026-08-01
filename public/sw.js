// sw.js — offline support (§7). Precache the app shell, cache-first for
// static assets. There is nothing to fetch at runtime: the app is entirely
// on-device.
//
// D10 / Doctrine §7: the cache name carries the release triplet
// version.capability.iteration, bumped together with the changelog.
//
// D10: a service-worker update NEVER touches IndexedDB. Only caches are
// deleted here — the user's drawings live in IndexedDB and an update that
// cleared them would be destroying the work the app exists to hold.

const CACHE = "intersecting-parallels-1.15.0";

const SHELL = [
  "/",
  "/index.html",
  "/app.css",
  "/app/ui.mjs",
  "/app/solver.mjs",
  "/app/snap.mjs",
  "/app/render.mjs",
  "/app/state.mjs",
  "/app/export.mjs",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key); // caches only — never IndexedDB
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === "basic") {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      // Offline and not in the cache. For a navigation, serve the app shell —
      // NEVER an error page over the top of a working app (hub LESSONS 7d).
      if (req.mode === "navigate") {
        const shell = await caches.match("/index.html");
        if (shell) return shell;
      }
      return new Response("", { status: 504, statusText: "offline" });
    }
  })());
});
