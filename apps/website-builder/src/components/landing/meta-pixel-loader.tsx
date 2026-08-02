"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useStorefrontApi } from "@/lib/storefront/api-base";

// Storefront browser-side Meta Pixel.
//
// This is a STANDALONE system, fully independent of the server-side
// Conversions API integration (src/lib/meta/capi.ts). It reads its pixel ID
// from StoreSettings.metaBrowserPixelId, never from MetaPixelConfig. If every
// CAPI config is disabled or deleted, this keeps firing normally — and if
// this pixel ID is blank, CAPI keeps working normally. Neither depends on
// the other.
//
// Responsibilities:
//   1. Capture fbclid -> _fbc cookie on every page load, unconditionally
//      (even with no pixel configured), so a click's attribution is never
//      lost while the store owner is still setting things up.
//   2. Load the standard Meta Pixel base script and fire PageView on every
//      storefront page.
//   3. Expose trackViewContent() / trackInitiateCheckout() for product pages
//      and the purchase form.
//
// Note: the Purchase event is intentionally NOT fired here — it is sent
// server-side via the Conversions API, which is the source of truth for COD
// orders (a browser Purchase event can be lost, blocked, or duplicated).

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function captureFbc() {
  const params = new URLSearchParams(window.location.search);
  const fbclid = params.get("fbclid");
  if (!fbclid) return;
  // Meta's own format: fb.<subdomain_index>.<creation_time_ms>.<fbclid>
  setCookie("_fbc", `fb.1.${Date.now()}.${fbclid}`, 90);
}

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[] };
    _fbq?: unknown;
  }
}

// Injects the standard Meta Pixel bootstrap. Safe to call more than once —
// it no-ops if fbq already exists.
function injectBaseCode() {
  if (window.fbq) return;
  /* eslint-disable */
  (function (f: any, b: any, e: any, v: any) {
    if (f.fbq) return;
    const n: any = (f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    });
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    const t = b.createElement(e);
    t.async = true;
    t.src = v;
    const s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  /* eslint-enable */
}

// Events requested before the pixel finished initialising are buffered here
// and flushed once init completes. Without this, a ViewContent fired by a
// product page that renders faster than the settings fetch would be dropped.
let pixelReady = false;
const pendingEvents: { name: string; params?: Record<string, unknown> }[] = [];

function track(name: string, params?: Record<string, unknown>) {
  if (!pixelReady || !window.fbq) {
    pendingEvents.push({ name, params });
    return;
  }
  window.fbq("track", name, params);
}

function flushPending() {
  while (pendingEvents.length > 0) {
    const evt = pendingEvents.shift()!;
    window.fbq?.("track", evt.name, evt.params);
  }
}

export function trackViewContent(params: {
  content_ids: string[];
  content_name: string;
  content_type?: string;
  value: number;
  currency: string;
}) {
  // Bound to this storefront tenant by StorefrontApiProvider.
  const api = useStorefrontApi();
  track("ViewContent", { content_type: "product", ...params });
}

export function trackInitiateCheckout(params: {
  content_ids: string[];
  content_name: string;
  value: number;
  currency: string;
  num_items: number;
}) {
  track("InitiateCheckout", { content_type: "product", ...params });
}

export function MetaPixelLoader() {
  const pathname = usePathname();

  // Init: runs once for the lifetime of the storefront layout.
  React.useEffect(() => {
    // Runs regardless of whether a pixel is configured.
    captureFbc();

    let cancelled = false;

    fetch(api("/meta-pixels"))
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const pixelId: string | null = json?.data?.pixelId ?? null;
        if (!pixelId) return;

        injectBaseCode();
        window.fbq?.("init", pixelId);
        pixelReady = true;
        // Flushes the PageView queued by the pathname effect below (and any
        // ViewContent a product page fired before init finished).
        flushPending();
      })
      .catch(() => {
        // No pixel configured or a network hiccup. fbc capture above already
        // ran independently, so this is a silent no-op, not an error state.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // PageView per page. The storefront layout stays mounted across client-side
  // navigations, so the init effect alone would only ever fire once — this
  // fires on every route change too. On first render the pixel is not ready
  // yet, so track() buffers it and the init effect flushes it; there is no
  // double-fire because init deliberately does not send PageView itself.
  React.useEffect(() => {
    track("PageView");
  }, [pathname]);

  return null;
}

// Read by the purchase form at submit time, so the server-side CAPI Purchase
// event can include Meta's click/browser identifiers.
export function readMetaCookies(): { fbc: string | null; fbp: string | null } {
  return {
    fbc: getCookie("_fbc"),
    fbp: getCookie("_fbp"),
  };
}
