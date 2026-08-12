import { NextResponse, type NextRequest } from "next/server";

import { Prisma, withTenant } from "@landingos/db";

import { tenantBySlug } from "@/lib/storefront/resolve-tenant";
import { allowRequest, clientIp, checkoutLimit } from "@/lib/storefront/rate-limit";
import { CheckoutBody } from "@/lib/storefront/contract";
import { deliveryPricesFor, priceForMethod } from "@/lib/storefront/delivery";
import { triggerOrderWebhook } from "@/lib/webhooks/tenant-triggers";
import { dispatchTrackingEvent } from "@/lib/tracking/dispatch";
import { hasErp, fulfilmentFromSale } from "@/lib/erp/from-sale";

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

// The body schema lives in `lib/storefront/contract.ts`, shared with the
// purchase form — see that module for why it may not be re-declared here.

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ success: false, error: { code, message } }, { status });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string }> },
) {
  // Per-IP bound BEFORE any database work: a fake COD order costs the store a
  // courier and an agent's call, so a script must run out of budget fast. Ten
  // orders in five minutes from one address is nobody's real buying pattern.
  if (!allowRequest("checkout", clientIp(req), checkoutLimit(), 5 * 60 * 1000)) {
    return fail(429, "RATE_LIMITED", "Too many orders from this connection — wait a few minutes.");
  }

  const { tenant: slug } = await ctx.params;
  const tenant = await tenantBySlug(slug);
  if (!tenant) return fail(404, "NOT_FOUND", "That store does not exist.");

  const parsed = CheckoutBody.safeParse(await req.json().catch(() => ({})));
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

      /* LB.20 — the SAME resolver `/wilayas` quotes from, so the price the
         customer was shown and the price they are charged cannot differ. A
         per-product override wins; absence means the company's rate. */
      const prices = await deliveryPricesFor(db as never, page.id);
      const price = prices.get(input.wilayaId);
      if (!price) {
        return { error: fail(422, "UNDELIVERABLE", "We do not deliver to that wilaya yet.") };
      }

      const shippingPrice = priceForMethod(price, input.shippingMethod);

      // Variant extras come from the tenant's own rows, never the request.
      // ALL money stays Decimal end to end (M-06): these columns are Decimal,
      // and float arithmetic here would store dust (19.99 × 3 = 59.9700…006)
      // into the permanent commercial snapshot.
      const chosen = page.variants.filter((v: any) => input.variantIds.includes(v.id));
      const extras = chosen.reduce(
        (sum: Prisma.Decimal, v: any) => sum.plus(v.extraPrice ?? 0),
        new Prisma.Decimal(0),
      );

      const unitPrice = new Prisma.Decimal(page.price).plus(extras);
      const freeShipping = setting?.freeShipping ?? false;
      const shipping = freeShipping ? new Prisma.Decimal(0) : new Prisma.Decimal(shippingPrice);
      const total = unitPrice.times(input.quantity).plus(shipping);

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

      // A customer who converts stops being an abandoned lead. Written in the
      // SAME transaction as the order: `convertedOrderId` had a column and no
      // writer since the port (B-06), so every recovered customer stayed in
      // the abandoned list forever. `updateMany` because the token may not
      // resolve (cleared storage, another device) and that must not fail the
      // sale — matching zero rows is the correct outcome then. Constrained to
      // the same page so a token cannot mark someone else's lead converted.
      if (input.draftToken) {
        await (db as any).draftOrder.updateMany({
          where: { token: input.draftToken, landingPageId: page.id, convertedOrderId: null },
          data: { convertedOrderId: order.id, convertedAt: new Date() },
        });
      }

      // M-05. The ERP's operational record, in THIS transaction — not over a
      // webhook. Both live in the same database now, and a network hop between
      // them means the sale can be recorded while the thing the call-centre
      // works from is not, with nothing to reconcile the two and no error
      // anybody sees. Either the customer has an order and there is something
      // to confirm, or neither happened.
      //
      // Skipped for a tenant that does not hold the ERP, checked through the
      // registry so nothing here enumerates products.
      if (await hasErp(db)) {
        await fulfilmentFromSale(db, tenant.id, {
          id: order.id,
          customerName: input.customerName,
          phone: input.phone,
          wilaya: wilaya.name,
          baladia: input.baladiaName,
          address: input.address,
          notes: input.notes ?? null,
          quantity: input.quantity,
          productPrice: unitPrice,
          shippingPrice: shipping,
          totalPrice: total,
          shippingMethod: input.shippingMethod,
          productTitle: page.title,
          variants: chosen.map((v: any) => ({ name: v.name, value: v.value })),
        });
      }

      return { order, total, currency: page.currency as string, pageTitle: page.title as string };
    });

    if ("error" in result) return result.error;

    // Fire and forget, deliberately NOT awaited.
    //
    // This no longer feeds the ERP — that happens inside the transaction above
    // (M-05). What is left is purely the TENANT-FACING integration: a company
    // subscribing their own endpoint to their own events. It stays unawaited
    // for the original reason, which still holds for a third party: somebody
    // else's server being down is not a reason to fail a customer's checkout,
    // and the delivery log records the attempt either way.
    triggerOrderWebhook("order.created", tenant.id, result.order.id);

    // The server-side Purchase conversion — Meta CAPI, TikTok Events API,
    // GA4 MP — with the ORDER ID as the dedup key the thank-you page's
    // browser event shares. Fired AFTER the transaction returned (its read
    // opens its own binding) and never awaited: an ad platform being down is
    // not a reason to slow a customer's checkout (LB.5).
    dispatchTrackingEvent(tenant.id, {
      name: "Purchase",
      eventId: result.order.id,
      value: result.total.toNumber(),
      currency: result.currency,
      contentId: input.landingPageId,
      contentName: result.pageTitle,
      quantity: input.quantity,
      customer: { name: input.customerName, phone: input.phone },
      context: {
        ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: req.headers.get("user-agent"),
        fbc: input.fbc ?? null,
        fbp: input.fbp ?? null,
        ttclid: input.ttclid ?? null,
        ttp: input.ttp ?? null,
        gaClientId: input.gaClientId ?? null,
      },
    });

    return NextResponse.json(
      { success: true, data: { id: result.order.id, total: String(result.total) } },
      { status: 201 },
    );
  } catch (error) {
    console.error("[storefront] checkout failed", error);
    return fail(500, "INTERNAL_ERROR", "We could not place that order. Please try again.");
  }
}
