// Cache do app para uso offline. Troque VERSAO ao publicar mudanças.
const VERSAO = 'ql-v3.4';
const ARQUIVOS = ['./', './index.html', './style.css', './app.js', './core.js', './db.js', './templates.js', './modelos.js', './wizard.js', './passeio.js', './nuvem.js', './contestar.js', './fluxo.js', './imgworker.js', './push.js', './config.js', './export.js', './report.js', './zip.js', './voice.js',
  './vendor/supabase.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png', './img/logo-horizontal.png',
  './fonts/Poppins-Light.ttf', './fonts/Poppins-Regular.ttf', './fonts/Poppins-Medium.ttf',
  './fonts/lmroman17-regular.otf', './fonts/lmroman12-italic.otf'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // só os arquivos do próprio app entram no cache: respostas do servidor (Supabase) nunca são guardadas aqui
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const rede = fetch(e.request).then((r) => {
        if (r.ok) caches.open(VERSAO).then((c) => c.put(e.request, r.clone()));
        return r;
      }).catch(() => hit || caches.match('./index.html'));
      return hit || rede;
    }),
  );
});

// avisos no celular (push): mostra a notificação e abre o app no lugar certo ao tocar
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { texto: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Vistoria LiquiLar', {
    body: d.texto || '', icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: d.tag || undefined, data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) { if ('navigate' in c) c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});