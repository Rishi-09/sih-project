// Service Worker for Rotax 915 iS Digital Twin Console
const CACHE_NAME = "twin-console-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle push notifications received in background
self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const title = data.title || "Rotax 915 iS Alert";
    const options = {
      body: data.message || data.body || "Engine state notification",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag || "engine-alert",
      renotify: true,
      vibrate: [200, 100, 200, 100, 200],
      data: {
        url: data.url || "/",
      },
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    const text = event.data.text();
    event.waitUntil(
      self.registration.showNotification("Rotax 915 iS Alert", {
        body: text,
        icon: "/icon.svg",
        vibrate: [200, 100, 200],
      })
    );
  }
});

// Clicking a notification brings the window/tab to the front
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
