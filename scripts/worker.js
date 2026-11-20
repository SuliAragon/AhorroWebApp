const scope = new URL(self.registration.scope);
const prefix = 'ahorro:' + scope.pathname + ':';
const cacheName = prefix + __VERSION__;
const assets = __ASSETS__.map((asset) => new URL(asset, scope).href);
const assetURLs = new Set(assets);
const assetPath = new URL('_astro/', scope).pathname;
const previousCaches = async () => (await caches.keys()).filter((name) => name.startsWith(prefix) && name !== cacheName);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(assets.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // The previous page can still be loading its scripts when this worker takes over.
    const olderCaches = (await previousCaches()).slice(0, -1);
    await Promise.all(olderCaches.map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function loadEntry(request) {
  const response = await fetch(request, { cache: 'no-cache' }).catch(() => null);
  if (response?.ok) return response;
  const cache = await caches.open(cacheName);
  return (await cache.match(scope.href)) ?? response ?? Response.error();
}

async function loadAsset(request) {
  const current = await caches.open(cacheName);
  const cached = await current.match(request);
  if (cached) return cached;
  if (new URL(request.url).pathname.startsWith(assetPath)) {
    for (const name of (await previousCaches()).reverse()) {
      const previous = await caches.match(request, { cacheName: name });
      if (previous) return previous;
    }
  }
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== scope.origin) return;
  const isEntry = [scope.pathname, scope.pathname + 'index.html'].includes(url.pathname);
  if (event.request.mode === 'navigate' && isEntry) {
    event.respondWith(loadEntry(event.request));
  } else if (assetURLs.has(url.href) || url.pathname.startsWith(assetPath)) {
    event.respondWith(loadAsset(event.request));
  }
});
