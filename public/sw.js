self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const kind = data.kind || data.type || 'info';
  const title = data.title || 'Claim Sniper';
  const options = {
    body: data.body || 'New Claim Sniper alert.',
    tag: data.tag || 'claim-sniper-alert',
    data: {
      url: data.url || '/',
      kind,
    },
    icon: '/sniper.png',
    badge: '/sniper.png',
    requireInteraction: kind === 'fill' || kind === 'fail',
    silent: false,
  };

  async function showWhenAllowed() {
    // Chat push notifications are only useful when the app is not already open.
    // If any Claim Sniper window/PWA client exists, skip the OS notification.
    if (kind === 'chat' || options.tag === 'claim-sniper-chat') {
      const openClients = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const appOpen = openClients.some((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      if (appOpen) return;
    }

    await self.registration.showNotification(title, options);
  }

  event.waitUntil(showWhenAllowed());
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
