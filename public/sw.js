self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || 'Claim Sniper';
  const options = {
    body: data.body || 'New Claim Sniper alert.',
    tag: data.tag || 'claim-sniper-alert',
    data: {
      url: data.url || '/',
      kind: data.kind || 'info',
    },
    icon: '/sniper.png',
    badge: '/sniper.png',
    requireInteraction: data.kind === 'fill' || data.kind === 'fail',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin) {
          if ('navigate' in client) client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    }),
  );
});
