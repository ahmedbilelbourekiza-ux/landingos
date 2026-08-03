"use client";

import { useEffect } from "react";

/**
 * Register the console's service worker — Phase 6.6e.
 *
 * A client component with no markup, mounted from the console layout, because
 * registration is a browser API and there is nothing to render.
 *
 * SCOPED TO `/console`, not to the origin. A worker at `/sw.js` may claim any
 * scope at or below its own path, and `/` would put it in front of the public
 * storefront too — a customer-facing surface that has nothing to do with
 * installability or with an agent's push notifications. It intercepts no
 * requests either way; the narrow scope is so that stays true if somebody later
 * adds a `fetch` handler without reading the file's header.
 *
 * Failure is logged and ignored. A browser with service workers disabled, or a
 * page served over plain HTTP, must still be a working console — this only ever
 * ADDS installability and push.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/console" })
      .catch((error) => {
        console.warn("[pwa] service worker registration failed", error);
      });
  }, []);

  return null;
}
