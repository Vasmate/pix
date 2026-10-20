const CACHE_NAME = 'pix-cache-v4';
const urlsToCache = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  // Only handle same-origin GET requests for header injection
  if (request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      // Try cache first for same-origin
      if (request.url.startsWith(self.location.origin)) {
        const cached = await caches.match(request);
        if (cached) {
          return addCOIHeaders(cached);
        }
      }

      // Fetch from network
      const response = await fetch(request);

      // Add COOP/COEP headers to same-origin responses
      if (request.url.startsWith(self.location.origin)) {
        return addCOIHeaders(response);
      }

      return response;
    })()
  );
});

function addCOIHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
