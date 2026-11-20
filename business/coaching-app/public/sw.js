/* Service worker: network-first for app navigations so a deployed
   shell reaches open and installed apps promptly, with the cache as
   the offline fallback. Static assets use stale-while-revalidate.
   API calls always go to the network — log data is never cached. */
const CACHE = '__BRAND_CACHE__';
/* The stylesheet and script carry the release version, matching the
   URLs index.html asks for, so a release never pairs new markup with
   an older cached stylesheet or script. */
const SHELL_ASSETS = ['/styles.css?v=__APP_VERSION__', '/app.js?v=__APP_VERSION__'];
const SHELL = ['/', '/index.html', ...SHELL_ASSETS, '/manifest.json', '/assets/ayg-lab-logo-256.webp'];

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

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      const cache = await caches.open(CACHE);
      await cache.put('/index.html', copy);
    }
    return response;
  } catch (_) {
    return (await caches.match(request)) || (await caches.match('/index.html'));
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // network only for data

  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  // The page's own stylesheet and script: network first, cache only offline.
  if (url.pathname === '/styles.css' || url.pathname === '/app.js') {
    event.respondWith(fetch(event.request).then((res) => {
      if (res.ok && event.request.method === 'GET') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request)));
    return;
  }

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
