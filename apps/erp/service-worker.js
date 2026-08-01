/* =============================================================================
 * service-worker.js — makes agent.html installable (Add to Home Screen) and
 * gives it basic offline resilience. Also includes a `push` handler ready
 * for when real push notifications are wired up server-side (a separate,
 * later step — this alone does nothing until a push subscription exists).
 * ========================================================================== */

const CACHE_NAME = 'crm-agent-shell-v1';
const APP_SHELL = [
  './agent.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './cash-register.mp3',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for everything (this app is live-data-driven — orders must
// always be fresh), falling back to the cached app shell ONLY when there is
// genuinely no connection, so the agent at least sees the interface itself
// rather than a browser error page.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Ready for Phase 2 (server-side push notifications) — currently inert
// until a real push subscription + VAPID setup exists on the backend.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'CRM', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'CRM — إشعار جديد';
  const options = {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: data.url || './agent.html' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './agent.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes('agent.html'));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
