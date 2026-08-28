self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
    requireInteraction: kind === 'fill' || kind === 'fail' || kind === 'dex',
    silent: false,
  };

  async function showWhenAllowed() {
    const openClients = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    const appClients = openClients.filter((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });

    // Tell every open tab to draw its unread favicon dot. This works even when
    // the page is background-throttled because the service worker owns push.
    for (const client of appClients) {
      client.postMessage({
        type: 'claim-sniper-notification',
        kind,
        title,
        body: options.body,
        url: options.data.url,
        tag: options.tag,
      });
    }

    // Suppress only a chat alert that the user is genuinely looking at. A
    // hidden/background tab must not silence the desktop notification.
    if (kind === 'chat' || options.tag === 'claim-sniper-chat') {
      const activelyViewed = appClients.some(
        (client) => client.visibilityState === 'visible' && client.focused,
      );
      if (activelyViewed) return;
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
          client.postMessage({ type: 'claim-sniper-notification-opened' });
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    }),
  );
});
