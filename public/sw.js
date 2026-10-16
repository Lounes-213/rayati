/* Rayati service worker -----------------------------------------------------------------
   Strategy, in one paragraph:
   - app shell (HTML, JS, CSS, icons, fonts): cache-first, filled at install and by
     runtime caching as the app requests them. Offline after the first load.
   - data files (seats.json, show.json, chunks, corrections.json): stale-while-revalidate.
     The event always reads from cache, and a fresh copy is fetched in the background
     when the network is still there — so a new show file silently replaces the old one.
   - /api/* (time sync): never cached, the offset must be measured live.
   The page asks us to keep big payloads through postMessage (see PRECACHE below).
   -------------------------------------------------------------------------------------- */
const VERSION = 'v1';
const SHELL_CACHE = `rayati-shell-${VERSION}`;
const DATA_CACHE = `rayati-data-${VERSION}`;
const SHELL_URLS = [
  './',
  './index.html',
  './simulation.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './seats.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll fails atomically: cache what exists, one by one.
      await Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
      // A new show file must be usable as soon as possible, so we never block.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('rayati-') && name !== SHELL_CACHE && name !== DATA_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

const isDataRequest = (url) => url.pathname.endsWith('.json') && !url.pathname.startsWith('/api/');

/**
 * Only real JSON is cached under a .json URL. Some hosts answer unknown paths with
 * index.html (SPA fallback); caching that would poison the show cache.
 */
const isJsonResponse = (response) =>
  String(response.headers.get('content-type') || '').includes('json');

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return; // live only

  if (isDataRequest(url)) {
    event.respondWith(dataStrategy(event, request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigateStrategy(request));
    return;
  }
  event.respondWith(assetStrategy(request));
});

async function dataStrategy(event, request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    event.waitUntil(revalidate(cache, request));
    return markHit(cached);
  }
  try {
    const response = await fetch(request);
    if (response.ok && isJsonResponse(response)) event.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (error) {
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
}

async function revalidate(cache, request) {
  try {
    const fresh = await fetch(request);
    if (fresh.ok && isJsonResponse(fresh)) await cache.put(request, fresh.clone());
  } catch {
    /* offline: the cached copy stays */
  }
}

async function navigateStrategy(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./')) ||
      new Response('<h1>Rayati</h1><p>Hors ligne / Offline</p>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    );
  }
}

async function assetStrategy(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
    return response;
  } catch (error) {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

/** Tell the page that this response came from the cache (used by the UI). */
async function markHit(response) {
  const headers = new Headers(response.headers);
  headers.set('x-rayati-cache', 'hit');
  const body = await response.blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/* ------------------------------------------------------------------ messages */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];

  if (data.type === 'rayati.skip-waiting') {
    void self.skipWaiting();
    return;
  }

  if (data.type === 'rayati.precache' && Array.isArray(data.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(DATA_CACHE);
        const urls = data.urls.filter((url) => typeof url === 'string');
        let done = 0;
        for (const url of urls) {
          let ok = false;
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (response.ok && isJsonResponse(response)) {
              await cache.put(url, response.clone());
              ok = true;
            }
          } catch {
            ok = false;
          }
          done++;
          port &&
            port.postMessage({ type: 'rayati.progress', url, done, total: urls.length, ok });
        }
        port && port.postMessage({ type: 'rayati.done', total: urls.length });
      })(),
    );
    return;
  }

  if (data.type === 'rayati.status' && Array.isArray(data.urls)) {
    event.waitUntil(
      (async () => {
        const results = {};
        const caches_ = await caches.open(DATA_CACHE);
        const shell = await caches.open(SHELL_CACHE);
        for (const url of data.urls) {
          const request = new Request(url);
          results[url] = Boolean((await caches_.match(request)) || (await shell.match(request)));
        }
        port && port.postMessage({ type: 'rayati.results', results });
      })(),
    );
    return;
  }

  if (data.type === 'rayati.clear') {
    event.waitUntil(
      (async () => {
        await caches.delete(DATA_CACHE);
        port && port.postMessage({ type: 'rayati.done', total: 0 });
      })(),
    );
  }
});
