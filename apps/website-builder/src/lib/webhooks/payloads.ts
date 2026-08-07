import { createHash } from "crypto";

import { withTenant } from "@landingos/db";

// Builds Shopify-shaped webhook payloads from landingos data.
//
// The receiving CRM was written against Shopify's orders/create and
// products/create webhook formats, so field names and shapes mirror those
// wherever the data model allows. Where landingos genuinely differs, the
// difference is documented inline rather than faked.
//
// Structured address: wilaya/baladia are sent as REAL fields — mapped onto
// Shopify's province/city (so existing CRM parsing picks them up unchanged)
// AND repeated under explicit `wilaya`/`baladia` keys. They are never
// stuffed into note_attributes.

// Shopify order/product ids are big integers; landingos uses cuid strings.
// We send the native string id as `id` and a stable derived integer as
// `id_numeric` so a CRM with a numeric column has something to store.
// 13 hex chars = up to 2^52, safely inside Number.MAX_SAFE_INTEGER.
export function toNumericId(cuid: string): number {
  const hash = createHash("sha256").update(cuid).digest("hex");
  return parseInt(hash.slice(0, 13), 16);
}

function money(value: number): string {
  return value.toFixed(2);
}

// COD: money is collected at delivery, not at checkout. So an order is only
// "paid" once it is DELIVERED, and "voided" if it is cancelled.
function financialStatus(status: string): string {
  if (status === "DELIVERED") return "paid";
  if (status === "CANCELLED") return "voided";
  return "pending";
}

function fulfillmentStatus(status: string): string | null {
  if (status === "DELIVERED") return "fulfilled";
  if (status === "SHIPPED") return "partial";
  return null;
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  return {
    first: parts[0] ?? "",
    last: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

interface VariantSnapshot {
  name: string;
  value: string;
}

/**
 * `variants` is a Json column, so Prisma returns the ARRAY; only legacy rows
 * hold a serialized string. JSON.parse-ing the array threw and silently
 * emptied every payload's variant list (same class as W-01).
 */
function parseVariants(value: unknown): VariantSnapshot[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed)
    ? parsed.filter((v): v is VariantSnapshot => Boolean(v && typeof v === "object"))
    : [];
}

export interface OrderWithLanding {
  id: string;
  tenantId: string;
  customerName: string;
  phone: string;
  wilaya: string;
  baladia: string;
  address: string;
  notes: string | null;
  quantity: number;
  variants: unknown;
  productPrice: { toNumber(): number };
  shippingPrice: { toNumber(): number };
  totalPrice: { toNumber(): number };
  status: string;
  createdAt: Date;
  updatedAt: Date;
  landingPage: {
    id: string;
    title: string;
    slug: string;
    currency: string;
  } | null;
}

export async function buildOrderPayload(order: OrderWithLanding) {
  const landing = order.landingPage;
  const currency = landing?.currency ?? "DZD";
  const { first, last } = splitName(order.customerName);

  const variants = parseVariants(order.variants);

  const productPrice = order.productPrice.toNumber();
  const shippingPrice = order.shippingPrice.toNumber();
  const totalPrice = order.totalPrice.toNumber();
  const lineTotal = productPrice * order.quantity;

  // The order stores wilaya/baladia as Arabic name snapshots (so an order
  // never changes if the reference data is later edited). Look the official
  // 01–58 wilaya code back up for the CRM's benefit; degrade to null rather
  // than failing the webhook if the name no longer resolves.
  let wilayaCode: string | null = null;
  try {
    const wilaya = await withTenant(order.tenantId, (db: any) =>
      db.wilaya.findFirst({
        where: { OR: [{ nameAr: order.wilaya }, { name: order.wilaya }] },
        select: { code: true },
      }),
    );
    wilayaCode = wilaya?.code ?? null;
  } catch {
    wilayaCode = null;
  }

  // If this order grew out of a captured abandoned checkout, surface that
  // draft's id so the CRM can match the earlier lead to this order and close
  // it out automatically instead of chasing a customer who already bought.
  let draftOrderId: string | null = null;
  try {
    const draft = await withTenant(order.tenantId, (db: any) =>
      db.draftOrder.findFirst({
        where: { convertedOrderId: order.id },
        select: { id: true },
      }),
    );
    draftOrderId = draft?.id ?? null;
  } catch {
    draftOrderId = null;
  }

  const orderNumber = order.id.slice(-8).toUpperCase();
  const cancelled = order.status === "CANCELLED";

  return {
    id: order.id,
    id_numeric: toNumericId(order.id),
    name: `#${orderNumber}`,
    order_number: orderNumber,
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
    currency,
    financial_status: financialStatus(order.status),
    fulfillment_status: fulfillmentStatus(order.status),
    cancelled_at: cancelled ? order.updatedAt.toISOString() : null,
    cancel_reason: cancelled ? "other" : null,

    // Not collected by the COD order form — always null/empty. Sent
    // explicitly so the CRM sees a consistent schema rather than a missing key.
    email: null,
    phone: order.phone,
    note: order.notes,
    note_attributes: [] as { name: string; value: string }[],

    subtotal_price: money(lineTotal),
    total_line_items_price: money(lineTotal),
    total_shipping_price_set: {
      shop_money: { amount: money(shippingPrice), currency_code: currency },
    },
    total_tax: "0.00",
    total_discounts: "0.00",
    total_price: money(totalPrice),
    taxes_included: false,
    tax_lines: [] as unknown[],

    line_items: [
      {
        id: `${order.id}-1`,
        product_id: landing?.id ?? null,
        product_id_numeric: landing ? toNumericId(landing.id) : null,
        variant_id: null,
        title: landing?.title ?? "Unknown product",
        name: landing?.title ?? "Unknown product",
        variant_title:
          variants.length > 0
            ? variants.map((v) => `${v.name}: ${v.value}`).join(" / ")
            : null,
        sku: landing?.slug ?? null,
        quantity: order.quantity,
        price: money(productPrice),
        total_discount: "0.00",
        requires_shipping: true,
        taxable: false,
        product_exists: Boolean(landing),
        properties: variants.map((v) => ({ name: v.name, value: v.value })),
      },
    ],

    customer: {
      id: null,
      email: null,
      phone: order.phone,
      first_name: first,
      last_name: last,
    },

    shipping_address: {
      first_name: first,
      last_name: last,
      name: order.customerName,
      phone: order.phone,
      // The form does not collect a street address; wilaya + baladia are the
      // real delivery address in this market.
      address1: order.address ?? "",
      address2: null,
      city: order.baladia,
      province: order.wilaya,
      province_code: wilayaCode,
      zip: null,
      country: "Algeria",
      country_code: "DZ",
      // Explicit structured fields — never packed into note_attributes.
      wilaya: order.wilaya,
      wilaya_code: wilayaCode,
      baladia: order.baladia,
    },

    shipping_lines: [
      { title: "Home delivery", price: money(shippingPrice), code: "home" },
    ],

    // landingos-specific extras that have no Shopify equivalent.
    landingos: {
      order_id: order.id,
      status: order.status,
      landing_page_id: landing?.id ?? null,
      landing_page_slug: landing?.slug ?? null,
      product_price: money(productPrice),
      shipping_price: money(shippingPrice),
      payment_method: "cod",
      // Null unless this order came from a previously-captured abandoned lead.
      draft_order_id: draftOrderId,
    },
  };
}

export interface DraftWithLanding {
  id: string;
  tenantId: string;
  token: string;
  customerName: string | null;
  phone: string | null;
  wilaya: string | null;
  baladia: string | null;
  quantity: number;
  variants: unknown;
  productPrice: { toNumber(): number } | null;
  shippingPrice: { toNumber(): number } | null;
  totalPrice: { toNumber(): number } | null;
  convertedOrderId: string | null;
  convertedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  landingPage: {
    id: string;
    title: string;
    slug: string;
    currency: string;
  } | null;
}

// Abandoned checkout, shaped like Shopify's draft_orders webhook.
//
// One deliberate difference from Shopify: `status` is "open" until the
// customer actually places the order, then "completed" with `order_id` set.
// Shopify also has "invoice_sent", which has no meaning here — COD has no
// invoice step.
//
// Fields the customer had not filled in yet are sent as null rather than
// omitted, so the CRM always sees the same schema and can tell "not provided"
// apart from "key missing".
export async function buildDraftOrderPayload(draft: DraftWithLanding) {
  const landing = draft.landingPage;
  const currency = landing?.currency ?? "DZD";
  const { first, last } = draft.customerName
    ? splitName(draft.customerName)
    : { first: "", last: "" };

  const variants = parseVariants(draft.variants);

  const productPrice = draft.productPrice?.toNumber() ?? 0;
  const shippingPrice = draft.shippingPrice?.toNumber() ?? 0;
  const totalPrice = draft.totalPrice?.toNumber() ?? productPrice * draft.quantity;
  const lineTotal = productPrice * draft.quantity;

  let wilayaCode: string | null = null;
  if (draft.wilaya) {
    try {
      // draft.tenantId, not order — this builder receives a DraftOrder.
      const wilaya = await withTenant(draft.tenantId, (db: any) =>
        db.wilaya.findFirst({
          where: { OR: [{ nameAr: draft.wilaya }, { name: draft.wilaya }] },
          select: { code: true },
        }),
      );
      wilayaCode = wilaya?.code ?? null;
    } catch {
      wilayaCode = null;
    }
  }

  const draftNumber = draft.id.slice(-8).toUpperCase();

  return {
    id: draft.id,
    id_numeric: toNumericId(draft.id),
    name: `#D${draftNumber}`,
    status: draft.convertedOrderId ? "completed" : "open",
    order_id: draft.convertedOrderId,
    order_id_numeric: draft.convertedOrderId ? toNumericId(draft.convertedOrderId) : null,
    completed_at: draft.convertedAt ? draft.convertedAt.toISOString() : null,
    created_at: draft.createdAt.toISOString(),
    updated_at: draft.updatedAt.toISOString(),
    currency,

    email: null,
    phone: draft.phone,
    note: null,
    note_attributes: [] as { name: string; value: string }[],

    subtotal_price: money(lineTotal),
    total_tax: "0.00",
    total_price: money(totalPrice),
    taxes_included: false,
    tax_lines: [] as unknown[],

    line_items: [
      {
        id: `${draft.id}-1`,
        product_id: landing?.id ?? null,
        product_id_numeric: landing ? toNumericId(landing.id) : null,
        variant_id: null,
        title: landing?.title ?? "Unknown product",
        name: landing?.title ?? "Unknown product",
        variant_title:
          variants.length > 0
            ? variants.map((v) => `${v.name}: ${v.value}`).join(" / ")
            : null,
        sku: landing?.slug ?? null,
        quantity: draft.quantity,
        price: money(productPrice),
        requires_shipping: true,
        taxable: false,
        properties: variants.map((v) => ({ name: v.name, value: v.value })),
      },
    ],

    customer: {
      id: null,
      email: null,
      phone: draft.phone,
      first_name: first || null,
      last_name: last || null,
    },

    // Same structured-address treatment as a real order: wilaya/baladia are
    // mapped onto province/city AND repeated explicitly. Null until the
    // customer gets that far in the form.
    shipping_address: {
      first_name: first || null,
      last_name: last || null,
      name: draft.customerName,
      phone: draft.phone,
      address1: "",
      address2: null,
      city: draft.baladia,
      province: draft.wilaya,
      province_code: wilayaCode,
      zip: null,
      country: "Algeria",
      country_code: "DZ",
      wilaya: draft.wilaya,
      wilaya_code: wilayaCode,
      baladia: draft.baladia,
    },

    shipping_line: draft.shippingPrice
      ? { title: "Home delivery", price: money(shippingPrice), code: "home" }
      : null,

    landingos: {
      draft_order_id: draft.id,
      abandoned: !draft.convertedOrderId,
      converted_order_id: draft.convertedOrderId,
      landing_page_id: landing?.id ?? null,
      landing_page_slug: landing?.slug ?? null,
      product_price: money(productPrice),
      shipping_price: money(shippingPrice),
      payment_method: "cod",
      // How complete the form was when they left — lets the CRM prioritise
      // the warmest leads first.
      captured_fields: {
        name: Boolean(draft.customerName),
        phone: Boolean(draft.phone),
        wilaya: Boolean(draft.wilaya),
        baladia: Boolean(draft.baladia),
      },
    },
  };
}

export interface ProductWithRelations {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  price: { toNumber(): number };
  oldPrice: { toNumber(): number } | null;
  currency: string;
  status: string;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
  media?: { url: string; type: string; altText: string | null; displayOrder: number }[];
  variants?: { name: string; value: string; extraPrice: { toNumber(): number } }[];
  category?: { name: string } | null;
}

function productStatus(status: string): string {
  if (status === "PUBLISHED") return "active";
  if (status === "ARCHIVED") return "archived";
  return "draft";
}

export function buildProductPayload(product: ProductWithRelations) {
  const price = product.price.toNumber();

  // landingos variants are OPTION rows (name/value with an optional extra
  // price), not distinct purchasable SKUs the way Shopify variants are.
  // We therefore map them to Shopify's `options` array — which is a faithful
  // match — and emit a single synthetic default variant carrying the base
  // price, rather than inventing per-combination SKUs that do not exist.
  const optionMap = new Map<string, string[]>();
  for (const v of product.variants ?? []) {
    if (!optionMap.has(v.name)) optionMap.set(v.name, []);
    optionMap.get(v.name)!.push(v.value);
  }
  const options = Array.from(optionMap.entries()).map(([name, values], i) => ({
    id: `${product.id}-opt-${i + 1}`,
    product_id: product.id,
    name,
    position: i + 1,
    values,
  }));

  const images = (product.media ?? [])
    .filter((m) => m.type === "IMAGE")
    .map((m, i) => ({
      id: `${product.id}-img-${i + 1}`,
      product_id: product.id,
      position: m.displayOrder ?? i,
      src: m.url,
      alt: m.altText,
    }));

  return {
    id: product.id,
    id_numeric: toNumericId(product.id),
    title: product.title,
    handle: product.slug,
    body_html: product.description,
    vendor: null,
    product_type: product.category?.name ?? null,
    status: productStatus(product.status),
    published_at: product.published ? product.createdAt.toISOString() : null,
    created_at: product.createdAt.toISOString(),
    updated_at: product.updatedAt.toISOString(),

    variants: [
      {
        id: `${product.id}-default`,
        product_id: product.id,
        title: "Default Title",
        price: String(price.toFixed(2)),
        compare_at_price: product.oldPrice ? product.oldPrice.toNumber().toFixed(2) : null,
        sku: product.slug,
        position: 1,
        requires_shipping: true,
        taxable: false,
        // landingos has no inventory/stock tracking. Shopify's convention for
        // an untracked product is inventory_management: null — so this
        // explicitly says "not tracked" rather than falsely reporting 0.
        inventory_management: null,
        inventory_quantity: null,
      },
    ],
    options,
    images,
    image: images[0] ?? null,

    landingos: {
      landing_page_id: product.id,
      slug: product.slug,
      currency: product.currency,
      price: price.toFixed(2),
      old_price: product.oldPrice ? product.oldPrice.toNumber().toFixed(2) : null,
      status: product.status,
      published: product.published,
      category: product.category?.name ?? null,
    },
  };
}
