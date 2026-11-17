/* Driftboard service worker: 自分のファイルはキャッシュして高速起動（裏で更新） */
const CACHE = "driftboard-v2";
const CORE = ["./", "index.html", "config.js", "style.css", "app.js", "data.js", "setup.js", "flights.js", "radio.js", "space.js", "sky.js", "clock.js",
  "ambient.js", "lib/leaflet.js", "lib/leaflet.css", "lib/satellite.min.js", "lib/astronomy.browser.min.js",
  "data/sky.json", "img/day.jpg", "img/night.jpg", "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // 外部APIは常にネットから
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
