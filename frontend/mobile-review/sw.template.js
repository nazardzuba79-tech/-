/* Only emitted by the isolated mobile review build, never the production build. */
const VERSION = '__BUILD_VERSION__';
const CACHE = `voltex-mobile-static-${VERSION}`;
const ASSETS = [...__STATIC_ASSETS__, '/mobile/offline.html', '/mobile/brand.svg',
  '/mobile/manifest.webmanifest', '/mobile/icon-180.png', '/mobile/icon-192.png',
  '/mobile/icon-512.png', '/mobile/icon-maskable-512.png'];
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);
if (LOCAL) {
  self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
    // Never skipWaiting: an open ticket must not be replaced mid-session.
  });
  self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys
      .filter(key => key.startsWith('voltex-mobile-static-') && key !== CACHE)
      .map(key => caches.delete(key)))));
    // No clients.claim; the next navigation adopts the installed version.
  });
  self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (request.mode === 'navigate' && ['/pwa', '/pwa/', '/telegram', '/telegram/', '/mobile-review.html'].includes(url.pathname)) {
      event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match('/mobile/offline.html')));
      return;
    }
    // Strict immutable allowlist; query-bearing requests and all APIs bypass cache.
    if (!url.search && ASSETS.includes(url.pathname)) {
      event.respondWith(caches.match(url.pathname).then(cached => cached || fetch(request)));
    }
  });
}
