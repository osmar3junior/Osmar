// ===== Carteira Viva — Service Worker =====
// Faz o app abrir e funcionar mesmo sem internet (uso "na estrada").
// Suba este arquivo JUNTO com o index.html, na mesma pasta/raiz do deploy.
//
// IMPORTANTE: ao publicar uma versão nova do app, troque o número do CACHE
// abaixo (ex: -v2, -v3). Isso descarta o cache antigo e força a atualização.
const CACHE = 'carteira-viva-v1';

// App shell + libs essenciais — pré-cacheadas já na instalação.
const SHELL = [
  './',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;700;800&display=swap'
];

// Libs estáticas (CDN/fontes) → cache-first / stale-while-revalidate
const STATIC_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
// APIs dinâmicas → sempre rede, nunca cacheia (dados frescos do rep)
const API_HOSTS = ['supabase.co', 'brasilapi.com.br', 'nominatim.openstreetmap.org'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cacheia item a item: um CDN fora do ar não quebra a instalação inteira.
    await Promise.allSettled(SHELL.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // APIs dinâmicas: deixa passar direto pra rede (não intercepta).
  if (API_HOSTS.some(h => url.hostname.includes(h))) return;

  // HTML do app (navegação): network-first com fallback pro cache.
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(req)) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Libs estáticas (CDN/fontes): stale-while-revalidate.
  if (STATIC_HOSTS.some(h => url.hostname.includes(h))) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then(res => {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
    return;
  }

  // Demais GET da mesma origem (ícones, etc): cache-first.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      } catch {
        return Response.error();
      }
    })());
  }
});

// Permite que o app force a ativação de uma versão nova sem fechar o app.
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
