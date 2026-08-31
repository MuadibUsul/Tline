// Compatibility kill switch for clients that registered a legacy service worker.
// Tline does not cache application chunks in a service worker; Next.js owns them.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    self.registration.unregister(),
    caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name)))),
  ]));
});
