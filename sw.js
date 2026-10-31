// Guarda o app no aparelho para abrir sem internet. Os DADOS ficam no IndexedDB, não aqui.
const CACHE = "economist-v2";
const FILES = [
  "./", "index.html", "local.js", "mobile.css", "manifest.webmanifest",
  "icon.svg", "icon-180.png", "icon-512.png",
  "assets/index-DzUa1fhy.js", "assets/charts-DIMd8OrP.js", "assets/index-C7ZS6Hca.css",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match("index.html"));
    })
  );
});
