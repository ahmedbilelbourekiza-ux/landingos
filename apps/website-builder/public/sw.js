/* =============================================================================
 * The console's service worker — Phase 6.6e.
 *
 * IT CACHES NOTHING, AND THAT IS THE MOST IMPORTANT LINE IN THIS FILE.
 *
 * A service worker's usual job is an offline shell. This one deliberately does
 * not have one, and does not intercept `fetch` at all, because every page under
 * `/console` is server-rendered from a database read scoped to whoever is signed
 * in. A cache entry keyed by URL is keyed by NOTHING ELSE: the same
 * `/console/erp/orders` is a different page for a manager and for an agent, and
 * a different page again for the next person to use a shared handset in a call
 * centre. Serving a cached copy would hand one tenant's customer list to
 * another person — through a mechanism that survives signing out, because a
 * cache is not a session.
 *
 * The three things a stale cache would additionally break are all real here:
 * a suspended member must lose access on their very next request (M-09), an
 * order's status is money, and RLS cannot enforce anything against a response
 * the browser never asks for.
 *
 * So what this worker is FOR is the two things that need no cache:
 *
 *   1. Installability. A manifest plus a registered service worker is what makes
 *      the console installable to a home screen — which is how a confirmation
 *      agent opens it between calls.
 *   2. Web Push. A browser can only RECEIVE a push through a service worker.
 *      Without this file, 6.6d's `pushToUsers` sends into nothing.
 *
 * If an offline shell is ever wanted, it belongs on PUBLIC assets only, and the
 * rule must be an allow-list of paths that carry no session — never a
 * catch-all.
 * ========================================================================== */

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close. There is
  // no cache to migrate, so an old worker has nothing worth preserving.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * A push arrived.
 *
 * The payload is what `pushToUsers` sent: `{ title, body, url }`. It is parsed
 * defensively because a push service may deliver an empty payload — some do, to
 * wake the client — and a worker that throws here shows nothing at all.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "LandingOS";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // The URL travels on the notification so `notificationclick` knows where to
    // go without keeping state in the worker, which does not survive being
    // stopped between events.
    data: { url: payload.url || "/console" },
    // Collapse repeats of the same kind rather than stacking a screen of them.
    tag: payload.tag || "landingos",
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * The notification was tapped.
 *
 * Focus a tab that is already on the console rather than opening a second one —
 * an agent working a queue does not want a new window per alert.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/console";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/console") && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
