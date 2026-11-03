/* Joart Core · funcionamiento sin conexión.
   Solo guarda la propia app y las tipografías. Las llamadas al backend nunca se interceptan ni se guardan. */
const VERSION = "joart-core-v1";
const FUENTES = "joart-fuentes-v1";
const BASE = [
  "panel.html", "joart-core.js", "jspdf.umd.min.js", "logo-joart.png", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png"
];
const rutasBase = BASE.map(u => new URL(u, self.registration.scope).pathname);

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(BASE.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== FUENTES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Primero la red (para ver siempre la última versión); si no hay conexión o tarda, lo guardado.
function redPrimero(req) {
  return new Promise((resolve) => {
    let listo = false;
    const usarCache = () => caches.match(req, { ignoreSearch: true }).then(r => { if (r && !listo) { listo = true; resolve(r); } return r; });
    const t = setTimeout(usarCache, 4000);
    fetch(new Request(req.url, { cache: "no-cache" })).then(r => {
      clearTimeout(t);
      if (r && r.ok) { const copia = r.clone(); caches.open(VERSION).then(c => c.put(req, copia)); }
      if (!listo) { listo = true; resolve(r); }
    }).catch(() => { clearTimeout(t); usarCache().then(r => { if (!r && !listo) { listo = true; resolve(Response.error()); } }); });
  });
}
// Lo guardado al instante y se actualiza por detrás.
function guardadoYActualiza(req) {
  return caches.open(FUENTES).then(c => c.match(req).then(previo => {
    const red = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone()); return r; }).catch(() => previo);
    return previo || red;
  }));
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && rutasBase.includes(url.pathname)) { e.respondWith(redPrimero(req)); return; }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") { e.respondWith(guardadoYActualiza(req)); }
});
