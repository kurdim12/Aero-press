/* AeroPress Lab service worker.
 * vite.config.ts fills in the version and the app-shell files at build time. The shell is
 * precached so the app, and the brew timer, open with no connection. API calls are never
 * cached here; the app keeps its own offline copy of the data it needs. */
const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const CACHE = `aeropress-lab-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('aeropress-lab-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Newest app when online, the cached shell when offline.
    event.respondWith(
      fetch(request).catch(() => caches.match('/', { cacheName: CACHE }).then((cached) => cached || Response.error())),
    );
    return;
  }
  event.respondWith(caches.match(request, { cacheName: CACHE }).then((cached) => cached || fetch(request)));
});
