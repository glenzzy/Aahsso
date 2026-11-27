/* Aahsso service worker (SaaS version): the app opens without network; data writes are queued by the app itself. */
const CACHE = 'aahsso-v139';
const MEDIA = 'aahsso-media'; // photos and the font: kept across app updates, so they still show offline
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'compute.js', 'data.js', 'app-core.js', 'v-sell.js', 'v-stock.js', 'v-flow.js', 'v-tour.js', 'v-promo.js', 'v-other.js', 'charts.js', 'charts.css', 'v-insights.js', 'v-reports.js', 'v-team.js', 'v-money.js', 'v-loss.js', 'v-count.js', 'v-claims.js', 'v-assets.js', 'v-capital.js', 'v-finance.js', 'v-staff.js', 'v-account.js', 'v-activity.js', 'bell.js', 'bell.mp3', 'drinks.js', 'drinks-catalog.json', 'ingredients.js', 'flyer.js', 'v-resto.js', 'print.js', 'v-pos.js', 'boot.js', 'manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== MEDIA).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin && url.pathname.startsWith('/api/images/')) { // uploaded photos never change: kept forever
    e.respondWith(caches.open(MEDIA).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  // the font and the drinks' photos (other sites that allow it): from the phone first, refreshed in the background
  if (/(^|\.)(wikimedia\.org|gstatic\.com|googleapis\.com)$/.test(url.hostname) && !url.hostname.startsWith('commons.')) {
    const key = new Request(url.href);
    e.respondWith(caches.open(MEDIA).then(async (c) => {
      const hit = await c.match(key);
      const net = fetch(url.href, { mode: 'cors', credentials: 'omit' }).then((r) => { if (r.ok) c.put(key, r.clone()); return r; });
      if (hit) { net.catch(() => {}); return hit; }
      return net.catch(() => fetch(e.request));
    }));
    return;
  }
  if (url.pathname === '/healthz') return; // the connection check must really reach the server
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return; // the platform admin is never cached or served by the app
  if (url.pathname.startsWith('/api/')) return; // live data goes to the network; the app keeps its own offline copy
  // app files: always ask the server (no stale browser-cache copy after an update); offline → cached copy
  const fresh = url.origin === location.origin && e.request.mode !== 'navigate' ? fetch(e.request, { cache: 'no-cache' }) : fetch(e.request);
  e.respondWith(fresh.then((r) => { if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('index.html'))));
});
