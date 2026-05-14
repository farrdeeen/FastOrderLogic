self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data ? event.data.json() : {};
      } catch {
        data = { body: event.data?.text?.() || "New WhatsApp message" };
      }

      const title = data.title || "New WhatsApp message";
      const options = {
        body: data.body || "New WhatsApp message",
        tag: data.tag || `chat-${data.session_id || "new"}`,
        renotify: true,
        data: {
          url: data.url || self.location.origin,
          session_id: data.session_id,
          message_id: data.message_id,
        },
      };

      await self.registration.showNotification(title, options);
      if ("setAppBadge" in self.navigator) {
        try {
          await self.navigator.setAppBadge();
        } catch {
          // Badge support varies; notification itself is enough.
        }
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification?.data?.url || self.location.origin,
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.postMessage({
              type: "chat_notification_click",
              session_id: event.notification?.data?.session_id,
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        return undefined;
      }),
  );
});
