// ===== Carteira Viva — Service Worker =====
// Faz o app abrir e funcionar mesmo sem internet (uso "na estrada").
// Suba este arquivo JUNTO com o index.html, na mesma pasta/raiz do deploy.
//
// IMPORTANTE: ao publicar uma versão nova do app, troque o número do CACHE
// abaixo (ex: -v3, -v4). Isso descarta o cache antigo e força a atualização.
const CACHE = 'carteira-viva-v19';

// App shell + libs essenciais — pré-cacheadas na instalação.
// O rep abre o app offline mesmo na primeira vez após instalado.
const SHELL = [
  './',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.mini.min.js',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;700;800&display=swap'
];

// CDN/fontes — cache-first, atualiza em background
const STATIC_HOSTS = [
  'unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com',
  'fonts.gstatic.com', 'cdn.sheetjs.com', 'cdnjs.cloudflare.com',
  'esm.sh', 'unpkg.com'
];

// Tiles do mapa — cache-first para áreas já visitadas funcionarem offline
const MAP_HOSTS = ['tile.openstreetmap.org', 'tiles.stadiamaps.com'];

// APIs dinâmicas — sempre rede, nunca cacheia
const API_HOSTS = [
  'supabase.co', 'brasilapi.com.br', 'nominatim.openstreetmap.org',
  'generativelanguage.googleapis.com', 'viacep.com.br'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cacheia item a item — um CDN fora do ar não quebra a instalação.
    await Promise.allSettled(SHELL.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE && k !== 'carteira-notif-data').map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // APIs dinâmicas: passa direto para a rede, sem interceptar.
  if (API_HOSTS.some(h => url.hostname.includes(h))) return;

  // HTML do app — cache-first com atualização em background (stale-while-revalidate).
  // Garante abertura instantânea offline. Quando online, atualiza silenciosamente.
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('./');
      // Atualiza em background sem bloquear a resposta
      const networkUpdate = fetch('./').then(res => {
        if (res && res.status === 200) cache.put('./', res.clone());
        return res;
      }).catch(() => null);
      // Serve do cache imediatamente se disponível; caso contrário aguarda rede
      return cached || (await networkUpdate) || Response.error();
    })());
    return;
  }

  // Tiles do mapa — cache-first para funcionar offline em áreas já visitadas.
  if (MAP_HOSTS.some(h => url.hostname.includes(h))) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      } catch { return Response.error(); }
    })());
    return;
  }

  // CDN/fontes estáticas — stale-while-revalidate.
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

  // Mesma origem (ícones, etc) — cache-first.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      } catch { return Response.error(); }
    })());
  }
});

// Mensagens do app
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data?.tipo === 'salvarDadosNotif') _salvarDadosNotif(e.data.dados);
});

// ===== NOTIFICAÇÕES LOCAIS =====
async function _salvarDadosNotif(dados) {
  const cache = await caches.open('carteira-notif-data');
  await cache.put('summary', new Response(JSON.stringify(dados), {
    headers: { 'Content-Type': 'application/json' }
  }));
}

async function _getDadosNotif() {
  try {
    const cache = await caches.open('carteira-notif-data');
    const res = await cache.match('summary');
    if (res) return await res.json();
  } catch {}
  return null;
}

async function _dispararNotificacaoDiaria() {
  const dados = await _getDadosNotif();
  if (!dados) return;
  const linhas = [];
  if (dados.clientesHoje > 0) linhas.push(`📍 ${dados.clientesHoje} cliente${dados.clientesHoje > 1 ? 's' : ''} para visitar hoje`);
  if (dados.prospectos > 0)   linhas.push(`🔭 ${dados.prospectos} prospecto${dados.prospectos > 1 ? 's' : ''} com retorno hoje`);
  if (dados.metaLabel)        linhas.push(`🎯 Meta ${dados.metaLabel}`);
  if (!linhas.length) linhas.push('Abra o app para ver sua rota de hoje.');
  await self.registration.showNotification('📊 Carteira Viva — Bom dia!', {
    body: linhas.join('\n'),
    icon: 'https://img.icons8.com/color/96/combo-chart--v1.png',
    tag: 'carteira-daily',
    requireInteraction: false,
    data: { url: './' }
  });
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const acao = e.notification.data?.acao || '';
  e.waitUntil((async () => {
    const cs = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (cs.length) {
      cs[0].focus();
      cs[0].postMessage({ tipo: 'notifClick', acao });
      return;
    }
    const base = e.notification.data?.url || './';
    return clients.openWindow(acao ? `${base}?acao=${acao}` : base);
  })());
});
