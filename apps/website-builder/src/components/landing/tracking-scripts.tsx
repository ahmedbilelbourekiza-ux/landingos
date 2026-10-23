"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/* =============================================================================
 * The storefront's ONE tracking loader (LB.5).
 *
 * Replaces meta-pixel-loader.tsx, which was mounted by nothing, fetched
 * through an undefined identifier, and read a response key the API did not
 * return (BUILDER_AUDIT §2). The lessons are structural here:
 *
 *   - The configuration arrives as PROPS from the server layout — there is no
 *     client fetch to drift from an API shape, and a page renders its pixels
 *     in the same pass that renders its content.
 *   - One canonical `track(name, params, eventId)`; each provider's wire
 *     vocabulary lives in this file's small mapping tables, mirroring the
 *     server adapters. The PAGE never learns which providers exist.
 *   - Events fired before a provider's script is ready are buffered and
 *     flushed, so a fast render never loses a ViewContent.
 *
 * Purchase dedup: the browser fires Purchase with the ORDER ID as the event
 * id, and the server (dispatch.ts) sends the same id through Meta CAPI /
 * TikTok Events API / GA4 MP — each platform then counts the conversion once
 * however many of the two sides got through. That redundancy is deliberate:
 * for COD, the server event is the one that survives ad blockers, and the
 * browser event is the one that carries the richest session identity.
 *
 * Funnel dedup (CAPI.1): ViewContent, AddToCart and InitiateCheckout get a
 * browser-minted event id. fbq fires with it, and the SAME id is posted to the
 * storefront's /events relay, which sends the server copy through Meta CAPI
 * and TikTok Events API. Only product pages pass a relay, so the store home,
 * category listings, the thank-you page and the editor preview never post.
 * ========================================================================== */

export interface BrowserIntegration {
  provider: string;
  publicId: string;
  settings: Record<string, unknown> | null;
}

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[] };
    _fbq?: unknown;
    ttq?: any;
    TiktokAnalyticsObject?: string;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

// ---------------------------------------------------------------------------
// Cookies — click-id capture and identity readback.
// ---------------------------------------------------------------------------

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

/** Runs unconditionally, even with no pixel configured — a click's
 * attribution must survive the store owner still setting things up. */
function captureClickIds() {
  const params = new URLSearchParams(window.location.search);
  const fbclid = params.get("fbclid");
  // Meta's own cookie format: fb.<subdomain_index>.<creation_time_ms>.<fbclid>
  if (fbclid) setCookie("_fbc", `fb.1.${Date.now()}.${fbclid}`, 90);
  const ttclid = params.get("ttclid");
  if (ttclid) setCookie("_landingos_ttclid", ttclid, 90);
}

/** GA4's client id lives in `_ga` as GA1.1.<client>.<ts>. */
function gaClientId(): string | null {
  const raw = getCookie("_ga");
  if (!raw) return null;
  const parts = raw.split(".");
  return parts.length >= 4 ? `${parts[2]}.${parts[3]}` : null;
}

/** Read by the purchase form at submit time, forwarded for server events. */
export function readTrackingCookies(): {
  fbc: string | null;
  fbp: string | null;
  ttclid: string | null;
  ttp: string | null;
  gaClientId: string | null;
} {
  return {
    fbc: getCookie("_fbc"),
    fbp: getCookie("_fbp"),
    ttclid: getCookie("_landingos_ttclid"),
    ttp: getCookie("_ttp"),
    gaClientId: gaClientId(),
  };
}

// ---------------------------------------------------------------------------
// Provider bootstrap snippets.
// ---------------------------------------------------------------------------

function injectScript(src: string) {
  const el = document.createElement("script");
  el.async = true;
  el.src = src;
  document.head.appendChild(el);
}

function bootMeta(ids: string[]) {
  if (!window.fbq) {
    /* eslint-disable */
    (function (f: any, b: any, e: any, v: any) {
      if (f.fbq) return;
      const n: any = (f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      });
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
      const t = b.createElement(e); t.async = true; t.src = v;
      const s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */
  }
  for (const id of ids) window.fbq?.("init", id);
}

function bootTiktok(codes: string[]) {
  if (!window.ttq) {
    /* The official shim: an array whose named methods queue until the script
       arrives. Only the methods this loader uses are stubbed. */
    window.TiktokAnalyticsObject = "ttq";
    const ttq: any = (window.ttq = window.ttq || []);
    ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
    ttq.setAndDefer = function (t: any, e: string) {
      t[e] = function (...args: unknown[]) { t.push([e, ...args]); };
    };
    for (const method of ttq.methods) ttq.setAndDefer(ttq, method);
    ttq.instance = function (t: string) {
      const inst = ttq._i?.[t] || [];
      for (const method of ttq.methods) ttq.setAndDefer(inst, method);
      return inst;
    };
    ttq.load = function (code: string, options?: unknown) {
      ttq._i = ttq._i || {};
      ttq._i[code] = [];
      ttq._i[code]._u = "https://analytics.tiktok.com/i18n/pixel/events.js";
      ttq._t = ttq._t || {};
      ttq._t[code] = +new Date();
      ttq._o = ttq._o || {};
      ttq._o[code] = options || {};
      injectScript(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${code}&lib=ttq`);
    };
  }
  for (const code of codes) window.ttq.load(code);
}

function bootGtag(ids: string[]) {
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag("js", new Date());
    injectScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids[0])}`);
  }
  for (const id of ids) window.gtag("config", id);
}

function bootGtm(containers: string[]) {
  window.dataLayer = window.dataLayer || [];
  for (const id of containers) {
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    injectScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`);
  }
}

// ---------------------------------------------------------------------------
// The canonical client event, fanned out per provider.
// ---------------------------------------------------------------------------

const TIKTOK_NAMES: Record<string, string> = {
  PageView: "Pageview",
  ViewContent: "ViewContent",
  AddToCart: "AddToCart",
  InitiateCheckout: "InitiateCheckout",
  Lead: "SubmitForm",
  Purchase: "PlaceAnOrder",
};

const GA4_NAMES: Record<string, string> = {
  ViewContent: "view_item",
  AddToCart: "add_to_cart",
  InitiateCheckout: "begin_checkout",
  Lead: "generate_lead",
  Purchase: "purchase",
};

export interface TrackParams {
  value?: number;
  currency?: string;
  contentId?: string;
  contentName?: string;
  quantity?: number;
}

/* PX.1 — THIS PAGE's destinations, by id, reset on every mount.
 *
 * Pixel scripts are global and outlive a client-side navigation: once product
 * A has run `fbq("init", A_PIXEL)`, a plain `fbq("track")` on product B would
 * still report to A's pixel. So every event names its destinations explicitly
 * (fbq `trackSingle`, a TikTok instance per code, GA4 `send_to`) from the ids
 * the CURRENT page was rendered with — never "whatever has been initialised". */
interface LoaderState {
  ready: boolean;
  metaIds: string[];
  tiktokCodes: string[];
  ga4Ids: string[];
  hasGtm: boolean;
  /** `AW-xxxx/label` targets that receive a conversion on Purchase. */
  adsTargets: string[];
}

const state: LoaderState = {
  ready: false, metaIds: [], tiktokCodes: [], ga4Ids: [], hasGtm: false, adsTargets: [],
};
const pending: { name: string; params?: TrackParams; eventId?: string }[] = [];

/** The events whose server half goes through the storefront relay. Purchase
 * and Lead are NOT here: the checkout and draft routes already send those
 * from data the server owns. Mirrors FUNNEL_RELAY_EVENTS in contract.ts. */
const RELAYED = new Set(["ViewContent", "AddToCart", "InitiateCheckout"]);

export interface TrackingRelay {
  /** `/api/storefront/<tenant>/events` */
  endpoint: string;
}

let relay: TrackingRelay | null = null;

/** Unique enough for dedup within Meta's 48h window; no PII, no order. */
function newEventId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** The server half. keepalive so an AddToCart tapped just before navigating
 * still leaves; errors are swallowed — tracking never surfaces to a shopper. */
function relayToServer(name: string, eventId: string, params?: TrackParams) {
  // The product comes from the EVENT, not from the relay: module state
  // outlives a client-side navigation, and the event's contentId is always
  // the page it happened on.
  if (!relay || !RELAYED.has(name) || !params?.contentId) return;
  // Only Meta and TikTok take the server copy; with neither on the page the
  // relay would be a request that dispatches to nobody.
  if (state.metaIds.length === 0 && state.tiktokCodes.length === 0) return;
  const endpoint = relay.endpoint;
  const contentId = params.contentId;

  const send = () => {
    const cookies = readTrackingCookies();
    const body = {
      name,
      eventId,
      landingPageId: contentId,
      ...(params?.quantity != null ? { quantity: params.quantity } : {}),
      ...(cookies.fbc ? { fbc: cookies.fbc } : {}),
      ...(cookies.fbp ? { fbp: cookies.fbp } : {}),
      ...(cookies.ttclid ? { ttclid: cookies.ttclid } : {}),
      ...(cookies.ttp ? { ttp: cookies.ttp } : {}),
    };
    try {
      void fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* never surfaces */
    }
  };

  // `_fbp` is written by fbevents.js once it loads, so the page's FIRST event
  // usually fires before it exists. Wait briefly for it — it is one of Meta's
  // strongest match keys — then send regardless (a blocked script never
  // writes it). Dedup does not depend on it: event_id + event_name do that.
  if (state.metaIds.length > 0 && !getCookie("_fbp")) setTimeout(send, 1500);
  else send();
}

function dispatchToProviders(name: string, params?: TrackParams, eventId?: string) {
  if (state.metaIds.length > 0 && window.fbq) {
    const meta: Record<string, unknown> = {};
    if (params?.currency) meta.currency = params.currency;
    if (params?.value != null) meta.value = params.value;
    if (params?.contentId) { meta.content_ids = [params.contentId]; meta.content_type = "product"; }
    if (params?.contentName) meta.content_name = params.contentName;
    if (params?.quantity != null) meta.num_items = params.quantity;
    for (const id of state.metaIds) {
      window.fbq("trackSingle", id, name, meta, eventId ? { eventID: eventId } : undefined);
    }
  }

  if (state.tiktokCodes.length > 0 && window.ttq) {
    const props: Record<string, unknown> = {};
    if (params?.currency) props.currency = params.currency;
    if (params?.value != null) props.value = params.value;
    if (params?.contentId) {
      props.contents = [{ content_id: params.contentId, content_type: "product", content_name: params.contentName, quantity: params.quantity }];
    }
    for (const code of state.tiktokCodes) {
      const pixel = window.ttq.instance(code);
      if (name === "PageView") pixel.page();
      else pixel.track(TIKTOK_NAMES[name] ?? name, props, eventId ? { event_id: eventId } : undefined);
    }
  }

  const hasGtag = state.ga4Ids.length > 0 || state.adsTargets.length > 0;
  if (hasGtag && window.gtag && state.ga4Ids.length > 0) {
    if (name === "PageView") {
      window.gtag("event", "page_view", { send_to: state.ga4Ids });
    } else {
      const ga: Record<string, unknown> = {};
      if (params?.currency) ga.currency = params.currency;
      if (params?.value != null) ga.value = params.value;
      if (name === "Purchase" && eventId) ga.transaction_id = eventId;
      if (params?.contentId) {
        ga.items = [{ item_id: params.contentId, item_name: params.contentName, quantity: params.quantity }];
      }
      window.gtag("event", GA4_NAMES[name] ?? name, { ...ga, send_to: state.ga4Ids });
    }
  }
  if (hasGtag && window.gtag) {
    // Google Ads: the Purchase conversion, once per configured target.
    if (name === "Purchase") {
      for (const target of state.adsTargets) {
        window.gtag("event", "conversion", {
          send_to: target,
          ...(params?.value != null ? { value: params.value } : {}),
          ...(params?.currency ? { currency: params.currency } : {}),
          ...(eventId ? { transaction_id: eventId } : {}),
        });
      }
    }
  }

  if (state.hasGtm && window.dataLayer && !hasGtag) {
    // With gtag present the event already reached the dataLayer through it;
    // this branch serves GTM-only setups.
    window.dataLayer.push({ event: name, ...params, event_id: eventId });
  }

  // After the browser calls, so fbq is never delayed by the relay. Runs even
  // when fbevents.js was blocked — that is the case the server copy is for.
  if (eventId) relayToServer(name, eventId, params);
}

/** The one function pages and forms call. Safe before init: buffered. */
export function track(name: string, params?: TrackParams, eventId?: string) {
  // A relayed event without a caller-given id gets one HERE, before buffering,
  // so the browser and server copies cannot end up with different ids.
  if (!eventId && RELAYED.has(name)) eventId = newEventId();
  if (!state.ready) {
    pending.push({ name, params, eventId });
    return;
  }
  dispatchToProviders(name, params, eventId);
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Once-per-product-view events.
// ---------------------------------------------------------------------------

const firedThisView = new Set<string>();

/** Fire `name` at most once for this product view. ViewContentTracker resets
 * the guard when a product page mounts, so a later visit counts again. */
export function trackOncePerView(name: string, params: TrackParams & { contentId: string }) {
  const key = `${name}:${params.contentId}`;
  if (firedThisView.has(key)) return;
  firedThisView.add(key);
  track(name, params);
}

function beginProductView(contentId: string) {
  for (const key of [...firedThisView]) {
    if (key.endsWith(`:${contentId}`)) firedThisView.delete(key);
  }
}

export function TrackingScripts({
  integrations,
  relay: relayConfig,
}: {
  integrations: BrowserIntegration[];
  /** Product pages only — see the header note on funnel dedup. */
  relay?: TrackingRelay;
}) {
  const pathname = usePathname();

  React.useEffect(() => {
    captureClickIds();
    relay = relayConfig ?? null;

    const metas = integrations.filter((i) => i.provider === "meta").map((i) => i.publicId);
    const tiktoks = integrations.filter((i) => i.provider === "tiktok").map((i) => i.publicId);
    const ga4s = integrations.filter((i) => i.provider === "ga4").map((i) => i.publicId);
    const ads = integrations.filter((i) => i.provider === "google-ads");
    const gtms = integrations.filter((i) => i.provider === "gtm").map((i) => i.publicId);

    // PX.1 — replace, never accumulate: this page's ids and only those.
    state.metaIds = metas;
    state.tiktokCodes = tiktoks;
    state.ga4Ids = ga4s;
    state.hasGtm = gtms.length > 0;
    state.adsTargets = [];

    if (metas.length) bootMeta(metas);
    if (tiktoks.length) bootTiktok(tiktoks);
    if (ga4s.length || ads.length) {
      bootGtag([...ga4s, ...ads.map((a) => a.publicId)]);
      state.adsTargets = ads
        .map((a) => {
          const label = (a.settings as any)?.conversionLabel;
          return label ? `${a.publicId}/${label}` : null;
        })
        .filter((t): t is string => Boolean(t));
    }
    if (gtms.length) bootGtm(gtms);

    state.ready = true;
    while (pending.length > 0) {
      const evt = pending.shift()!;
      dispatchToProviders(evt.name, evt.params, evt.eventId);
    }
    // The integration list is server-rendered per storefront and does not
    // change within a page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PageView per client-side navigation. The first render's PageView is
  // buffered by the effect ordering above; there is no double fire because
  // none of the boot functions send one themselves.
  React.useEffect(() => {
    track("PageView");
  }, [pathname]);

  return null;
}

/** Fires ViewContent once for a product page. Mounted by the PUBLIC route
 * only — previewing your own page must not look like a customer visit. */
export function ViewContentTracker({
  contentId,
  contentName,
  value,
  currency,
}: {
  contentId: string;
  contentName: string;
  value: number;
  currency: string;
}) {
  React.useEffect(() => {
    beginProductView(contentId);
    track("ViewContent", { contentId, contentName, value, currency, quantity: 1 });
  }, [contentId, contentName, value, currency]);
  return null;
}

/** Fires the browser-side Purchase on the thank-you page, with the ORDER ID
 * as the dedup key the server event shares. A reload re-fires; the id is
 * exactly what makes that harmless on every platform. */
export function PurchaseTracker({
  orderId,
  value,
  currency,
  contentId,
  contentName,
  quantity,
}: {
  orderId: string;
  value: number;
  currency: string;
  contentId?: string;
  contentName?: string;
  quantity?: number;
}) {
  React.useEffect(() => {
    track("Purchase", { value, currency, contentId, contentName, quantity }, orderId);
  }, [orderId, value, currency, contentId, contentName, quantity]);
  return null;
}
