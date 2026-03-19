// DeepSea Dashboard v2 Service Worker
const CACHE_NAME = 'deepsea-v2';

const STATIC_ASSETS = [
  '/',
  '/workers',
  '/blocks',
  '/earnings',
  '/notifications',
];

// API endpoints to cache with network-first strategy
const API_CACHE_PATTERNS = [
  '/api/metrics',
  '/api/workers',
  '/api/blocks',
  '/api/earnings',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache SPA shell routes — best-effort (don't fail install if some miss)
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Network-first for API endpoints (fresh data preferred)
  const isApi = API_CACHE_PATTERNS.some((p) => url.pathname.startsWith(p));
  if (isApi) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for static assets + SPA shell
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Revalidate in background
        fetch(event.request)
          .then((response) => {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response));
          })
          .catch(() => {});
        return cached;
      }
      return fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => cached);
    })
  );
});
