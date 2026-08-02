import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@landingos/db";

import { tenantBySlug } from "@/lib/storefront/resolve-tenant";
import { triggerOrderWebhook } from "@/lib/webhooks/tenant-triggers";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Checkout — the one public write in the platform.
 *
 * Anonymous by necessity: a customer has no account. That makes this the most
 * carefully bounded route here, and the rules are worth stating.
 *
 * PRICES ARE NEVER TRUSTED FROM THE CLIENT. The body carries what was chosen,
 * not what it costs. Every figure is recomputed from the tenant's own rows —
 * the landing page's price, the variant extras, the wilaya's delivery price —
 * so a forged total buys nothing. The legacy route did the same and it is the
 * single most important property of this endpoint.
 *
 * The tenant comes from the URL and everything is bound to it, so a request
 * cannot reach across tenants to price against someone else's product or
 * deliver to a wilaya someone else priced.
 * ========================================================================== */

const Body = z.object({
  landingPageId: z.string().min(1),
  customerName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(6).max(40),
  wilayaId: z.coerce.number().int().positive(),
  baladiaName: z.string().trim().min(1).max(160),
  address: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(1000).optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(99),
  shippingMethod: z.enum(["HOME", "DESK"]).default("HOME"),
  /** Chosen option ids. What they COST is looked up, never sent. */
  variantIds: z.array(z.string()).max(20).default([]),
});

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ success: false, error: { code, message } }, { status });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string }> },
) {
  const { tenant: slug } = await ctx.params;
  const tenant = await tenantBySlug(slug);
  if (!tenant) return fail(404, "NOT_FOUND", "That store does not exist.");

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Check the form.");
  }
  const input = parsed.data;

  try {
    const result = await withTenant(tenant.id, async (db) => {
      const page = await (db as any).landingPage.findFirst({
        where: { id: input.landingPageId, published: true, status: "PUBLISHED" },
        include: { setting: true, variants: true },
      });
      // Unpublished, or another tenant's: the same answer either way.
      if (!page) return { error: fail(404, "NOT_FOUND", "That product is not available.") };

      const setting = page.setting;
      const homeOk = setting?.homeDeliveryEnabled ?? true;
      const deskOk = setting?.stopDeskEnabled ?? false;
      if (input.shippingMethod === "HOME" && !homeOk) {
        return { error: fail(422, "METHOD_UNAVAILABLE", "Home delivery is not offered for this product.") };
      }
      if (input.shippingMethod === "DESK" && !deskOk) {
        return { error: fail(422, "METHOD_UNAVAILABLE", "Stop desk is not offered for this product.") };
      }

      // Destination must be a real wilaya WITH a price set by this tenant.
      // An unpriced wilaya is undeliverable, not free.
      const wilaya = await (db as any).wilaya.findUnique({
        where: { id: input.wilayaId },
        select: { id: true, name: true },
      });
      if (!wilaya) return { error: fail(422, "UNKNOWN_DESTINATION", "Choose a wilaya.") };

      const price = await (db as any).tenantDeliveryPrice.findUnique({
        where: { tenantId_wilayaId: { tenantId: tenant.id, wilayaId: input.wilayaId } },
      });
      if (!price) {
        return { error: fail(422, "UNDELIVERABLE", "We do not deliver to that wilaya yet.") };
      }

      const shippingPrice =
        input.shippingMethod === "DESK"
          ? price.deskPrice ?? price.homePrice
          : price.homePrice;

      // Variant extras come from the tenant's own rows, never the request.
      const chosen = page.variants.filter((v: any) => input.variantIds.includes(v.id));
      const extras = chosen.reduce((sum: number, v: any) => sum + Number(v.extraPrice ?? 0), 0);

      const unitPrice = Number(page.price) + extras;
      const freeShipping = setting?.freeShipping ?? false;
      const shipping = freeShipping ? 0 : Number(shippingPrice);
      const total = unitPrice * input.quantity + shipping;

      const order = await (db as any).salesOrder.create({
        data: {
          tenantId: tenant.id,
          landingPageId: page.id,
          customerName: input.customerName,
          phone: input.phone,
          // Snapshots: the order must still read correctly if the product,
          // its price or the wilaya's rate change tomorrow.
          wilaya: wilaya.name,
          baladia: input.baladiaName,
          address: input.address,
          notes: input.notes ?? null,
          quantity: input.quantity,
          variants: chosen.map((v: any) => ({ name: v.name, value: v.value })),
          productPrice: unitPrice,
          shippingPrice: shipping,
          totalPrice: total,
          shippingMethod: input.shippingMethod,
          status: "NEW",
        },
        select: { id: true },
      });

      // The initial state belongs on the trail too, so history is complete
      // from the first row rather than starting at the first change.
      await (db as any).salesOrderStatusHistory.create({
        data: { tenantId: tenant.id, orderId: order.id, fromStatus: null, toStatus: "NEW" },
      });

      return { order, total };
    });

    if ("error" in result) return result.error;

    // Fire and forget, deliberately NOT awaited. This is what feeds the ERP,
    // and it must never be able to fail or slow down a customer's order — a
    // receiving CRM being down is the CRM's problem, and the delivery log
    // records it either way.
    triggerOrderWebhook("order.created", tenant.id, result.order.id);

    return NextResponse.json(
      { success: true, data: { id: result.order.id, total: String(result.total) } },
      { status: 201 },
    );
  } catch (error) {
    console.error("[storefront] checkout failed", error);
    return fail(500, "INTERNAL_ERROR", "We could not place that order. Please try again.");
  }
}
