const CACHE_NAME = 'ds-cache-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/dashboard',
    '/workers',
    '/blocks',
    '/earnings',
    '/notifications',
    '/static/css/common.css',
    '/static/css/theme-toggle.css',
    '/static/css/easter-egg.css',
    '/static/js/main.js',
    '/static/js/workers.js',
    '/static/js/blocks.js',
    '/static/js/notifications.js',
    '/static/js/BitcoinProgressBar.js',
    '/static/js/theme.js',
    '/static/js/logger.js',
    '/static/js/batchFetch.js',
    '/static/js/audio.js',
    '/static/js/easterEgg.js',
    '/static/vendor/jquery-3.7.0.min.js',
    '/static/vendor/chart.min.js',
    '/static/js/chartjs-plugin-annotation-lite.js',
    '/static/js/service-worker.js',
    'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=VT323&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.map(key => (key !== CACHE_NAME ? caches.delete(key) : null)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) {
                return cached;
            }
            return fetch(event.request)
                .then(response => {
                    const respClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, respClone);
                    });
                    return response;
                })
                .catch(() => cached);
        })
    );
});
