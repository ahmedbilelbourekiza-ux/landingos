import "server-only";

import type { ChannelAdapter, ChannelConfig, ExternalProduct } from "./channel-contract";

/* =============================================================================
 * The sales-channel adapter registry — LP.15, restoring R8.
 *
 * `GET /api/platforms` in the legacy publishes NINE selectable platform keys and
 * registers TWO live adapters; the platform had a single generic `parseOrder`
 * and no list at all, so the console could not offer a platform dropdown and a
 * tenant could not connect a Shopify store through any screen.
 *
 * -----------------------------------------------------------------------------
 * THE CATALOGUE AND THE REGISTRY ARE TWO DIFFERENT LISTS, AND THE SCREEN NEEDS
 * BOTH.
 *
 * `PLATFORMS` is what a tenant may CHOOSE. `ADAPTERS` is what this deployment
 * can actually DO. A key in the first and not the second still works — inbound
 * webhooks are parsed generically and the test is structural — and the screen
 * says which is which, because "connected" meaning "we have never spoken to
 * them" is the class of lie D-LP.2 removed from carriers.
 *
 * Adding a platform is one entry in `PLATFORMS`. Adding real behaviour for it is
 * one file and one entry in `ADAPTERS`. Nothing else in the product changes,
 * which is the property the legacy's own header claims and this keeps.
 * ========================================================================== */

/** Every platform a tenant may select. The legacy's nine, unchanged. */
export const PLATFORMS = [
  { key: "shopify", label: "Shopify" },
  { key: "lightfunnels", label: "LightFunnels" },
  { key: "justsell", label: "JustSell" },
  { key: "ayor", label: "Ayor" },
  { key: "woocommerce", label: "WooCommerce" },
  { key: "ecwid", label: "Ecwid" },
  { key: "magento", label: "Magento" },
  { key: "bigcommerce", label: "BigCommerce" },
  { key: "custom", label: "Custom / Other" },
] as const;

/* -----------------------------------------------------------------------------
 * Shopify
 * -------------------------------------------------------------------------- */

/** A timed fetch. A platform that never answers must not hold a request open. */
async function ask(url: string, init: RequestInit, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON. The status is still the answer.
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

const shopify: ChannelAdapter = {
  key: "shopify",
  label: "Shopify",
  canTest: true,

  /**
   * The Shop endpoint — the cheapest call that proves the access token.
   *
   * A READ, deliberately, for the reason LP.14 gave the carrier test: a test
   * that creates an order to find out whether the API works has created an
   * order, and somebody has to go and cancel it.
   */
  async testConnection(cfg: ChannelConfig) {
    if (!cfg.apiUrl) return { ok: false, message: "No store domain is configured." };
    if (!cfg.apiKey) return { ok: false, message: "No access token is configured." };
    const base = cfg.apiUrl.replace(/\/$/, "");
    try {
      const res = await ask(`${base}/admin/api/2024-04/shop.json`, {
        headers: { "X-Shopify-Access-Token": cfg.apiKey, "content-type": "application/json" },
      });
      const shop = (res.json as { shop?: { name?: string } } | null)?.shop;
      if (res.ok && shop) return { ok: true, message: `Connected to ${shop.name ?? "the store"}.` };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Shopify rejected the access token." };
      }
      return { ok: false, message: `Shopify answered ${res.status}.` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error && error.name === "AbortError"
          ? "Shopify did not answer in time."
          : "Shopify could not be reached.",
      };
    }
  },

  /**
   * Shopify's own order shape.
   *
   * `line_items`, `shipping_address` with `province`/`city`, `total_price` as a
   * decimal STRING — which is why it is passed through as a string rather than
   * parsed: M-06 moved 37 money columns to `numeric`, and the point of that is
   * lost the moment a total passes through a JS double.
   *
   * TOPIC-GATED, and the gate is about SHAPE rather than about meaning.
   *
   * Shopify sends dozens of topics down one endpoint. `orders/*`,
   * `draft_orders/*` and `checkouts/*` all carry the same order-ish shape —
   * `line_items`, `shipping_address`, `total_price` — and this reads all three.
   * Everything else (`products/*`, `customers/*`, `refunds/*`, `app/uninstalled`)
   * carries a different shape entirely and returns null.
   *
   * WHAT a parsed payload MEANS is the route's decision, not this function's:
   * `webhook-route.ts` reads the topic again and marks a checkout `abandoned`
   * and a draft `draft`. A parser that also decided the order type would be a
   * second place the topic is interpreted, and LP.20's first build proved that
   * splits: the adapter refused `checkouts/create` outright and the route's
   * abandoned-marking never ran, so the topic produced no row at all.
   */
  parseOrder(body, topic) {
    if (topic && !/^(orders|draft_orders|checkouts)\//.test(topic)) return null;

    const billing = (body.billing_address ?? {}) as Record<string, unknown>;
    const shipping = (body.shipping_address ?? {}) as Record<string, unknown>;
    const addr = shipping.address1 ? shipping : billing;
    const items = Array.isArray(body.line_items) ? (body.line_items as Record<string, unknown>[]) : [];
    const first = items[0] ?? {};

    const externalId = String(body.id ?? "").trim();
    if (!externalId) return null;

    return {
      externalId,
      externalName: String(body.name ?? "").trim(),
      client: String(addr.name ?? billing.name ?? body.email ?? "").trim(),
      phone: String(body.phone ?? billing.phone ?? shipping.phone ?? "").trim(),
      // `province` is Shopify's word for a wilaya; `city` doubles as the commune
      // because Algerian addresses have no separate Shopify field.
      wilaya: String(addr.province ?? "").trim(),
      commune: String(addr.city ?? "").trim(),
      product: String(first.name ?? first.title ?? "").trim(),
      quantity: Number(first.quantity) || 1,
      price: String(body.total_price ?? ""),
      lineItems: items,
    };
  },

  parseProduct(body): ExternalProduct | null {
    const product = ((body.product ?? body) ?? {}) as Record<string, unknown>;
    const externalId = String(product.id ?? "").trim();
    const name = String(product.title ?? "").trim();
    if (!externalId || !name) return null;

    const variants = Array.isArray(product.variants)
      ? (product.variants as Record<string, unknown>[])
      : [];
    const images = Array.isArray(product.images) ? (product.images as Record<string, unknown>[]) : [];

    return {
      externalId,
      name,
      price: variants[0]?.price != null ? String(variants[0].price) : null,
      sku: variants[0]?.sku != null ? String(variants[0].sku) : null,
      image: images[0]?.src != null ? String(images[0].src) : null,
      variants: variants.map((v) => ({
        name: String(v.title ?? "").trim(),
        sku: v.sku != null ? String(v.sku) : null,
        price: v.price != null ? String(v.price) : null,
      })),
    };
  },
};

/* -----------------------------------------------------------------------------
 * LightFunnels
 * -------------------------------------------------------------------------- */

const lightfunnels: ChannelAdapter = {
  key: "lightfunnels",
  label: "LightFunnels",
  canTest: true,

  /** The cheapest valid GraphQL call: ask for the account id. */
  async testConnection(cfg: ChannelConfig) {
    if (!cfg.apiKey) return { ok: false, message: "No access token is configured." };
    try {
      const res = await ask("https://services.lightfunnels.com/api/v2", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ query: "query { account { id } }" }),
      });
      const payload = res.json as { errors?: { message?: string }[] } | null;
      if (res.ok && payload && !payload.errors) {
        return { ok: true, message: "Connected to LightFunnels." };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "LightFunnels rejected the access token." };
      }
      if (payload?.errors?.length) {
        return { ok: false, message: `LightFunnels: ${payload.errors[0].message ?? "error"}.` };
      }
      return { ok: false, message: `LightFunnels answered ${res.status}.` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error && error.name === "AbortError"
          ? "LightFunnels did not answer in time."
          : "LightFunnels could not be reached.",
      };
    }
  },

  /**
   * LightFunnels' own shape, and the two things the legacy learned the hard way.
   *
   *   - The envelope is `{ node: {...} }`, and the line-item field is `items`,
   *     not Shopify's `line_items`.
   *   - **A checkout-stage stub fires with only an id**, prefixed `ch_` rather
   *     than `order_`, the instant a customer lands on the checkout page. Its id
   *     does not match the real order's id later, so there is nothing to update
   *     — creating from it produced an empty "Client / 0 DA" row every time.
   *     No phone means no order. This is ported verbatim because it was
   *     discovered against a live integration and cannot be re-derived from
   *     documentation.
   */
  parseOrder(body) {
    const order = ((body.node ?? body.data ?? body.order ?? body) ?? {}) as Record<string, unknown>;
    const externalId = String(order.id ?? order._id ?? "").trim();
    if (!externalId) return null;

    const customer = (order.customer ?? {}) as Record<string, unknown>;
    const shipping = (order.shipping_address ?? {}) as Record<string, unknown>;
    const phone = String(order.phone ?? customer.phone ?? shipping.phone ?? "").trim();
    // The checkout stub. See above.
    if (!phone) return null;

    const raw = order.items ?? order.line_items ?? [];
    const items = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
    const first = items[0] ?? {};

    const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim();

    return {
      externalId,
      externalName: String(order.name ?? order.number ?? "").trim(),
      client: name || String(shipping.name ?? order.email ?? "").trim(),
      phone,
      wilaya: String(shipping.province ?? shipping.state ?? customer.location ?? "").trim(),
      commune: String(shipping.city ?? "").trim(),
      product: String(first.title ?? first.name ?? "").trim(),
      quantity: Number(first.quantity) || 1,
      price: String(order.total ?? ""),
      lineItems: items,
    };
  },
};

/* -----------------------------------------------------------------------------
 * The registry
 * -------------------------------------------------------------------------- */

const ADAPTERS: Record<string, ChannelAdapter> = { shopify, lightfunnels };

/**
 * The adapter for a platform, or null.
 *
 * NULL, not a generic stub, and the difference matters at the call site: the
 * caller decides whether to fall back (parsing an inbound payload, testing
 * structurally) or to refuse. Returning a stub here would make "we have no
 * adapter" invisible, which is exactly what the carriers screen suffered from
 * before D-LP.2.
 */
export function getChannelAdapter(platform: string | null | undefined): ChannelAdapter | null {
  return ADAPTERS[(platform ?? "").toLowerCase()] ?? null;
}

/** What the console offers, and what this deployment can really do. */
export function listChannelPlatforms() {
  return PLATFORMS.map((p) => ({
    key: p.key,
    label: p.label,
    /** True when a real adapter is registered — the screen says so. */
    registered: Boolean(ADAPTERS[p.key]),
    canTest: Boolean(ADAPTERS[p.key]?.testConnection),
  }));
}
