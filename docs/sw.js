const CACHE_PREFIX = 'm-tradingnote-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v0.4.0-pwa1`;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const scopeUrl = self.registration.scope;
    await cache.addAll([
      new URL('index.html', scopeUrl).href,
      new URL('manifest.webmanifest', scopeUrl).href,
      new URL('icons/app-icon.svg', scopeUrl).href,
      new URL('icons/icon-180.png', scopeUrl).href,
      new URL('icons/icon-192.png', scopeUrl).href,
      new URL('icons/icon-512.png', scopeUrl).href,
      new URL('icons/icon-512-maskable.png', scopeUrl).href,
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(new URL('index.html', self.registration.scope), response.clone());
          return response;
        }
      } catch {
        // Use the cached app shell when the device is offline.
      }
      return (await caches.match(new URL('index.html', self.registration.scope))) || Response.error();
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
