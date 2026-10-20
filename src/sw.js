// Service worker de la versión web. Plantilla: vite.config.js pone la versión y la lista de ficheros al compilar.
// Todo sale de la caché (también la página), así que abre al instante y sin conexión. Cuando se publica una
// versión nueva, el navegador ve que este fichero ha cambiado, la descarga entera y la usa al volver a abrir.
const CACHE = 'tobuy-__VERSION__';
const FILES = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tobuy-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // Firebase, fotos…: red
  e.respondWith(
    caches.open(CACHE).then(async (c) =>
      // ignoreVary: el script y el CSS se piden con cabecera Origin (crossorigin) y en caché están sin ella
      (await c.match(req, { ignoreSearch: true, ignoreVary: true })) ??
      (req.mode === 'navigate' ? await c.match('./', { ignoreVary: true }) : undefined) ??
      fetch(req)
    )
  );
});
