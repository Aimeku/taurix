/* ═══════════════════════════════════════════════════════
   TAURIX · sw.js — Service Worker PWA
   Cache-first para assets estáticos, network-first para
   datos de Supabase. Soporte offline básico.
   ═══════════════════════════════════════════════════════ */

const CACHE_NAME    = "taurix-v3";
const CACHE_STATIC  = "taurix-static-v3";

// Assets que se cachean al instalar
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/main.js",
  "/auth.js",
  "/supabase.js",
  "/utils.js",
  "/dashboard.js",
  "/facturas.js",
  "/fiscal.js",
  "/clientes.js",
  "/nueva-factura.js",
  "/presupuestos.js",
  "/productos.js",
  "/gastos.js",
  "/exports.js",
  "/pipeline.js",
  "/nominas.js",
  "/tesoreria.js",
  "/informes.js",
  "/contabilidad.js",
  "/otros-modelos.js",
  "/amortizaciones.js",
  "/validaciones.js",
  "/alertas.js",
  "/documentos.js",
  "/manifest.json",
  "/Logo_Sin_Texto_transparent.png",
  "/Logo_Sidebar.png",
  "/Logo_Taurix_transparent.png",
];

// ── INSTALL: cachear assets estáticos ──
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: "reload" })));
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar caches antiguas ──
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_STATIC && k !== CACHE_NAME)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia por tipo de request ──
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Supabase API — siempre network, sin cache (datos en tiempo real)
  if (url.hostname.includes("supabase.co")) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Offline: devolver respuesta de error legible
        return new Response(
          JSON.stringify({ error: "Sin conexión — los datos se cargarán cuando vuelva la conexión." }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      })
    );
    return;
  }

  // CDN externos (Chart.js, jsPDF, SheetJS) — network con fallback cache
  if (url.hostname.includes("cdnjs") || url.hostname.includes("jsdelivr") || url.hostname.includes("fonts.g")) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Assets estáticos de la app — cache first, network fallback
  if (STATIC_ASSETS.some(a => url.pathname === a || url.pathname.endsWith(a.replace("/",""))) ||
      url.pathname.match(/\.(js|css|png|svg|ico|json|woff2?)$/)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_STATIC).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Todo lo demás — network first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ── MENSAJE: forzar actualización ──
self.addEventListener("message", event => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
