/* Service worker MoneyTrack — app shell offline, tanpa pernah meng-cache data keuangan (/api). */
const SHELL_CACHE = 'moneytrack-shell-v1';
const ASSET_CACHE = 'moneytrack-assets-v1';
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
const MAX_ASSETS = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL_CACHE, ASSET_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Batasi jumlah aset ter-cache (aset lama dari versi sebelumnya ikut terbuang). */
async function trimAssets() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Data keuangan & struk privat tidak pernah disimpan di cache perangkat.
  if (url.pathname.startsWith('/api/')) return;

  // Halaman: network-first agar selalu versi terbaru; saat offline pakai app shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Aset ber-hash Vite & font: cache-first (nama file berubah tiap build).
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches
                .open(ASSET_CACHE)
                .then((cache) => cache.put(request, copy))
                .then(trimAssets);
            }
            return response;
          })
      )
    );
    return;
  }

  // Ikon & manifest: stale-while-revalidate.
  if (SHELL_URLS.includes(url.pathname) || url.pathname.endsWith('.png')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
