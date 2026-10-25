/* Simple service worker: cache the app shell so the app opens fast and
   works on a flaky track-side connection. API calls always go to the
   network (your log data is never served from cache). */
const CACHE = 'sprinter-app-v24';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/assets/sjc-logo-header.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // network only for data
  event.respondWith(
    caches.match(event.request).then((hit) => {
      const network = fetch(event.request).then((res) => {
        if (res.ok && event.request.method === 'GET') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
