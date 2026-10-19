// Notifications of the waiter screen when the phone is locked or the app is closed (see server/push.js).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Kalimenu', {
    body: m.body || '', tag: m.tag, renotify: !!m.tag, icon: '/brand/icon-192.png', badge: '/brand/badge-96.png',
    vibrate: [200, 100, 200], timestamp: m.at || Date.now(), data: { url: m.url || '/staff/waiter' },
  }));
});

// A tap opens the waiter screen, or brings it forward if it is already open.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/staff/waiter', self.location.origin).href;
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const screen = open.find((c) => new URL(c.url).pathname.startsWith('/staff/'));
    if (screen) return screen.focus();
    return self.clients.openWindow(url);
  })());
});
