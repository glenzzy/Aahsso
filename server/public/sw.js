/* Kargo service worker (SaaS version): the app opens without network; data writes are queued by the app itself. */
const CACHE = 'kargo-v39';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'compute.js', 'data.js', 'app-core.js', 'v-sell.js', 'v-stock.js', 'v-flow.js', 'v-tour.js', 'v-promo.js', 'v-other.js', 'v-reports.js', 'v-team.js', 'v-money.js', 'v-activity.js', 'boot.js', 'manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/images/')) { // photos: cache forever
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // live data goes to the network; the app keeps its own offline copy
  // app files: always ask the server (no stale browser-cache copy after an update); offline → cached copy
  const fresh = url.origin === location.origin && e.request.mode !== 'navigate' ? fetch(e.request, { cache: 'no-cache' }) : fetch(e.request);
  e.respondWith(fresh.then((r) => { if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('index.html'))));
});
