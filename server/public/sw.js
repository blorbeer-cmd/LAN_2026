// Service worker: only exists to receive Web Push events while the app tab
// isn't open/focused and turn them into an OS notification, and to focus/open
// the app when that notification is tapped. No caching/offline support —
// this tool needs a live connection to the server anyway (realtime board),
// so an offline app shell would be misleading.

self.addEventListener('push', (event) => {
  let data = { title: 'RespawnHQ', body: '' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // Ignore malformed payloads rather than crashing the service worker.
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'RespawnHQ', {
      body: data.body || '',
      icon: '/img/logo.svg',
      badge: '/img/logo.svg',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
