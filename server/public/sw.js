// Service worker: only exists to receive Web Push events while the app tab
// isn't open/focused and turn them into an OS notification, and to focus/open
// the app when that notification is tapped. No caching/offline support —
// this tool needs a live connection to the server anyway (realtime board),
// so an offline app shell would be misleading.

self.addEventListener('push', (event) => {
  let data = { title: 'Respawn', body: '' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // Ignore malformed payloads rather than crashing the service worker.
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Respawn', {
      body: data.body || '',
      icon: '/img/logo-192.png',
      badge: '/img/logo-badge-96.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  // The url's hash names the SPA view the push wants to land on (e.g.
  // "/#votes"). An already-open window gets focused and told to switch views
  // via postMessage (see app.js) — client.navigate() would reload the whole
  // app just to change tabs. Only when no window exists does a fresh one
  // open on the deep link, which app.js resolves on boot.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          const hashIndex = url.indexOf('#');
          if (hashIndex !== -1) client.postMessage({ type: 'navigate', view: url.slice(hashIndex + 1) });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
