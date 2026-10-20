/**
 * DeepSea Dashboard — Service Worker v2.0.4
 * Wallet-scoped snapshot caching with explicit stale data, cache-first static
 * assets, bounded eviction, and an offline navigation fallback.
 */

const CACHE_VERSION = 'deepsea-v2.0.4-freshness-1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

// All known cache names for this version
const ACTIVE_CACHES = [STATIC_CACHE, API_CACHE];

// Max cache entries (LRU eviction)
const MAX_API_ENTRIES = 50;
const MAX_STATIC_ENTRIES = 100;

// Network timeout for API and navigation requests (ms)
const NETWORK_TIMEOUT_MS = 5000;
const SCOPED_API_PATHS = new Set(['/api/metrics', '/api/workers']);
const PUBLIC_API_PATHS = new Set(['/api/exchange-rates', '/api/pool-blocks']);
let apiCacheGeneration = 0;

// SPA shell routes to precache on install
const SHELL_URLS = [
  '/',
  '/workers',
  '/blocks',
  '/earnings',
  '/notifications',
];

// Offline fallback HTML
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="deepsea">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DeepSea — Offline</title>
  <style>
    :root { --bg: #0a0e14; --accent: #00d4ff; --text: #a0d4f5; --dim: #8ba8c0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Share Tech Mono', 'Courier New', monospace;
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; min-height: 100vh; gap: 1.5rem; padding: 2rem;
      text-align: center;
    }
    .icon { font-size: 4rem; opacity: 0.6; }
    h1 { color: var(--accent); font-size: 1.5rem; letter-spacing: 3px; text-transform: uppercase; }
    p { color: var(--dim); font-size: 0.9rem; line-height: 1.6; max-width: 360px; }
    .pulse {
      width: 12px; height: 12px; background: var(--accent);
      border-radius: 50%; animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 0.2; transform: scale(0.8); }
      50% { opacity: 1; transform: scale(1.2); }
    }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
    button {
      background: transparent; border: 1px solid var(--accent); color: var(--accent);
      padding: 0.6rem 1.5rem; font-family: inherit; font-size: 0.85rem;
      letter-spacing: 2px; text-transform: uppercase; cursor: pointer;
      border-radius: 2px; transition: background 0.2s;
    }
    button:hover { background: rgba(0, 212, 255, 0.1); }
  </style>
</head>
<body>
  <div class="icon">⚓</div>
  <h1>Signal Lost</h1>
  <div class="pulse"></div>
  <p>DeepSea Dashboard is offline. Check your connection and try again.</p>
  <button onclick="window.location.reload()">Retry Connection</button>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Install — precache SPA shell
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);

      // Precache shell routes — don't fail install if some miss
      await Promise.allSettled(
        SHELL_URLS.map((url) =>
          cache.add(url).catch((err) =>
            console.warn(`[SW] Failed to precache ${url}:`, err)
          )
        )
      );

      console.log(`[SW] Installed ${CACHE_VERSION}`);
    })()
  );
  // Don't call skipWaiting here — let the client trigger it via message
});

// ---------------------------------------------------------------------------
// Activate — prune old cache versions
// ---------------------------------------------------------------------------

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Enable navigation preload if supported — eliminates the SW boot latency
      // on navigation requests by fetching in parallel with SW startup.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }

      const keys = await caches.keys();
      const stale = keys.filter((k) => !ACTIVE_CACHES.includes(k));

      if (stale.length > 0) {
        console.log(`[SW] Pruning ${stale.length} old cache(s):`, stale);
        await Promise.all(stale.map((k) => caches.delete(k)));
      }

      // Take control of all open clients immediately
      await self.clients.claim();
      console.log(`[SW] Activated ${CACHE_VERSION}`);
    })()
  );
});

// ---------------------------------------------------------------------------
// Fetch — routing strategies
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin and known external (fonts, etc.)
  if (url.origin !== self.location.origin &&
      url.hostname !== 'fonts.googleapis.com' &&
      url.hostname !== 'fonts.gstatic.com') {
    return;
  }

  // --- NEVER cache SSE streams ---
  if (url.pathname === '/api/stream' ||
      url.pathname === '/api/metrics/stream' ||
      url.pathname.endsWith('/stream')) {
    return; // let browser handle natively
  }

  // Writes and editable settings must reach the server. A successful config
  // update invalidates snapshots, including writes started before that update.
  if (request.method !== 'GET') {
    if (url.pathname === '/api/config' && request.method === 'POST') {
      event.respondWith(updateConfigAndClearSnapshots(request));
    }
    return;
  }

  // --- API endpoints: network-first with timeout, fallback to cache ---
  if (url.pathname.startsWith('/api/')) {
    // Wallet-specific snapshots are reusable only after a live config read has
    // established the requested wallet. Never cache settings or alert state.
    if (PUBLIC_API_PATHS.has(url.pathname) ||
        (SCOPED_API_PATHS.has(url.pathname) && request.headers.get('X-DeepSea-Wallet'))) {
      event.respondWith(networkFirstWithTimeout(request, API_CACHE, NETWORK_TIMEOUT_MS, MAX_API_ENTRIES));
    }
    return;
  }

  // --- Static assets: cache-first + stale-while-revalidate ---
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirstSWR(request, STATIC_CACHE, MAX_STATIC_ENTRIES));
    return;
  }

  // --- Navigation requests: network-first, SPA shell fallback ---
  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request, event));
    return;
  }

  // Default: pass through
});

// ---------------------------------------------------------------------------
// Strategy: Network-first with timeout
// ---------------------------------------------------------------------------

async function networkFirstWithTimeout(request, cacheName, timeoutMs, maxEntries) {
  const cache = await caches.open(cacheName);
  const generation = apiCacheGeneration;
  const scoped = SCOPED_API_PATHS.has(new URL(request.url).pathname);
  const wallet = request.headers.get('X-DeepSea-Wallet');

  try {
    const networkResponse = await fetchWithTimeout(request.clone(), timeoutMs);

    if (networkResponse.ok) {
      let canCache = true;
      if (scoped) {
        const data = await networkResponse.clone().json().catch(() => null);
        canCache = data?.wallet === wallet && data?.data_status === 'fresh';
      }
      if (canCache && generation === apiCacheGeneration) {
        try {
          const headers = new Headers(networkResponse.headers);
          headers.set('X-DeepSea-Cached-At', String(Date.now()));
          // CacheStorage must distinguish two requests with different wallets.
          if (scoped) headers.append('Vary', 'X-DeepSea-Wallet');
          const responseToCache = new Response(await networkResponse.clone().arrayBuffer(), {
            status: networkResponse.status, statusText: networkResponse.statusText, headers,
          });
          if (generation === apiCacheGeneration) {
            await cache.put(request, responseToCache);
            await trimCache(cache, maxEntries);
          }
        } catch (error) {
          // A full/disabled cache must not turn a successful read into an error.
          console.warn('[SW] Could not save snapshot:', error);
        }
      }
    }

    return networkResponse;
  } catch (err) {
    // Network failed or timed out — serve from cache
    const cached = await cache.match(request);
    if (cached && generation === apiCacheGeneration) {
      const data = await cached.clone().json().catch(() => null);
      if (!scoped || data?.wallet === wallet) {
        const headers = new Headers(cached.headers);
        headers.set('X-DeepSea-Cache', 'stale');
        headers.delete('Content-Length');
        headers.delete('Content-Encoding');
        let body = await cached.clone().text();
        if (scoped && data) {
          body = JSON.stringify({
            ...data,
            data_status: 'stale',
            data_error: 'Server unavailable. Showing the last saved snapshot.',
            // Preserve the server's data timestamp, never the fallback time.
            data_updated_at: data.data_updated_at ?? Number(headers.get('X-DeepSea-Cached-At')) / 1000,
          });
        }
        if (generation === apiCacheGeneration) {
          return new Response(body, { status: cached.status, statusText: cached.statusText, headers });
        }
      }
    }
    // No cache — return 503
    return new Response(JSON.stringify({ error: 'offline', cached: false }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'X-SW-Offline': '1' },
    });
  }
}

async function updateConfigAndClearSnapshots(request) {
  const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
  if (response.ok) {
    apiCacheGeneration++;
    await caches.delete(API_CACHE).catch((error) => console.warn('[SW] Could not clear snapshots:', error));
  }
  return response;
}

// ---------------------------------------------------------------------------
// Strategy: Cache-first + stale-while-revalidate
// ---------------------------------------------------------------------------

async function cacheFirstSWR(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Trigger background revalidation
  const revalidate = fetch(request.clone())
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone()).then(() =>
          trimCache(cache, maxEntries)
        );
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached; // Return cached immediately, revalidate in background
  }

  // No cache — wait for network
  const fresh = await revalidate;
  if (fresh) return fresh;

  return new Response('Asset unavailable offline', { status: 503 });
}

// ---------------------------------------------------------------------------
// Strategy: Navigation handler (SPA shell)
// ---------------------------------------------------------------------------

async function navigationHandler(request, fetchEvent) {
  try {
    // Use navigation preload response when available (set up in activate).
    // This allows the browser to begin the fetch in parallel with SW startup,
    // avoiding an extra round-trip on navigations.
    const preloadResponse = await fetchEvent?.preloadResponse;
    const response = preloadResponse || await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response.ok) {
      // Cache the shell for offline
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Network failed — try cached shell
    const cache = await caches.open(STATIC_CACHE);

    // Try exact URL first
    const exactMatch = await cache.match(request);
    if (exactMatch) return exactMatch;

    // Fall back to cached /
    const shellMatch = await cache.match('/');
    if (shellMatch) return shellMatch;

    // Last resort: offline page
    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-SW-Offline': '1' },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(request, { signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function isStaticAsset(pathname) {
  return /\.(js|css|woff2?|ttf|eot|otf|png|jpg|jpeg|gif|webp|svg|ico|mp3|wav|ogg|aac)(\?.*)?$/.test(pathname);
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;

  // LRU eviction: delete oldest entries (FIFO approximation via insertion order)
  const toDelete = keys.slice(0, keys.length - maxEntries);
  await Promise.all(toDelete.map((k) => cache.delete(k)));
}

// ---------------------------------------------------------------------------
// Message handler — SKIP_WAITING + future commands
// ---------------------------------------------------------------------------

self.addEventListener('message', (event) => {
  if (!event.data) return;

  switch (event.data.type) {
    case 'SKIP_WAITING':
      console.log('[SW] SKIP_WAITING received — activating new SW');
      self.skipWaiting();
      break;

    case 'GET_VERSION':
      event.source?.postMessage({ type: 'SW_VERSION', version: CACHE_VERSION });
      break;

    default:
      break;
  }
});

// ---------------------------------------------------------------------------
// Background sync — stub (ready for future use)
// ---------------------------------------------------------------------------

self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync event:', event.tag);
  // TODO: implement background sync for queued API writes
  // event.waitUntil(processSyncQueue(event.tag));
});

// ---------------------------------------------------------------------------
// Push notifications — stub (ready for future use)
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  if (!event.data) return;
  // TODO: implement push notification display
  // const data = event.data.json();
  // event.waitUntil(self.registration.showNotification(data.title, data));
});
