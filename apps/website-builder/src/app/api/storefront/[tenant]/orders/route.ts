import { NextResponse, type NextRequest } from "next/server";

import { Prisma, withTenant } from "@landingos/db";

import { tenantBySlug } from "@/lib/storefront/resolve-tenant";
import { CheckoutBody } from "@/lib/storefront/contract";
import { triggerOrderWebhook } from "@/lib/webhooks/tenant-triggers";
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
          productPrice: new Prisma.Decimal(unitPrice),
          shippingPrice: new Prisma.Decimal(shipping),
          totalPrice: new Prisma.Decimal(total),
          shippingMethod: input.shippingMethod,
          productTitle: page.title,
          variants: chosen.map((v: any) => ({ name: v.name, value: v.value })),
        });
      }

      return { order, total };
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

    return NextResponse.json(
      { success: true, data: { id: result.order.id, total: String(result.total) } },
      { status: 201 },
    );
  } catch (error) {
    console.error("[storefront] checkout failed", error);
    return fail(500, "INTERNAL_ERROR", "We could not place that order. Please try again.");
  }
}
