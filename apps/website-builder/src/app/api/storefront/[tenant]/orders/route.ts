import { NextResponse, type NextRequest } from "next/server";

import { Prisma, withTenant } from "@landingos/db";

import { tenantBySlug, currentOrigin, storefrontHref } from "@/lib/storefront/resolve-tenant";
import { allowRequest, clientIp, endUserIp, checkoutLimit } from "@/lib/storefront/rate-limit";
import { CheckoutBody } from "@/lib/storefront/contract";
import { deriveSource } from "@/lib/storefront/traffic-source";
import { deliveryPricesFor, priceForMethod } from "@/lib/storefront/delivery";
import { triggerOrderWebhook } from "@/lib/webhooks/tenant-triggers";
import { dispatchTrackingEvent } from "@/lib/tracking/dispatch";
import { hasErp, fulfilmentFromSale } from "@/lib/erp/from-sale";
// SEC.11 — the same folding the ERP applies, so "0555 12 34 56" and
// "0555123456" are one customer to the idempotency guard too.
import { normalizePhone } from "@/lib/erp/phone";
import { readSettings } from "@/lib/erp/settings";
import {
  evaluateOrderAbuse,
  hashClientIp,
  anyRuleArmed,
  NO_ABUSE,
  type AbuseVerdict,
} from "@/lib/erp/order-abuse";
import { checkoutMessage, type CheckoutErrorCode } from "@/lib/storefront/checkout-messages";

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

/**
 * A refusal, in the SHOP's language.
 *
 * Every message here used to be hardcoded English arriving on a right-to-left
 * Arabic page whose own form already spoke Arabic — found by the readiness
 * audit, fixed here because a refusal is the worst place to leave a customer
 * reading a language they did not choose. The code is unchanged and still the
 * contract; only the prose is now the tenant's.
 *
 * `locale` is omitted by the two refusals that happen BEFORE the tenant is
 * known — the rate-limit bound (deliberately ahead of all database work) and
 * the unknown-store 404. Those fall back to Arabic, the platform default.
 */
const fail = (status: number, code: CheckoutErrorCode, locale?: string | null) =>
  NextResponse.json(
    { success: false, error: { code, message: checkoutMessage(locale, code) } },
    { status },
  );

/**
 * SEC.11 — the answer to a purchase that was already placed.
 *
 * Deliberately a SUCCESS, and 200 rather than 201: the customer did place this
 * order, they simply did not hear us say so the first time, and the right
 * outcome for them is the thank-you page and not an apology. The existing
 * purchase form needs no change to do that — it reads `data.id` and navigates,
 * exactly as it does for a fresh order.
 *
 * `duplicate: true` rides along so a log, an agent screen or a future client
 * can tell the two apart. Nothing today branches on it, which is the point: a
 * retry should be indistinguishable from success to the person buying, and
 * distinguishable to anyone investigating.
 */
const alreadyPlaced = (order: { id: string; total: string }) =>
  NextResponse.json(
    { success: true, data: { ...order, duplicate: true } },
    { status: 200 },
  );

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string }> },
) {
  // Per-IP bound BEFORE any database work: a fake COD order costs the store a
  // courier and an agent's call, so a script must run out of budget fast. Ten
  // orders in five minutes from one address is nobody's real buying pattern.
  if (!allowRequest("checkout", clientIp(req), checkoutLimit(), 5 * 60 * 1000)) {
    return fail(429, "RATE_LIMITED");
  }

  const { tenant: slug } = await ctx.params;
  const tenant = await tenantBySlug(slug);
  if (!tenant) return fail(404, "NOT_FOUND");

  const parsed = CheckoutBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    /* The zod issue text is developer prose in English and would be a second
     * untranslated string on the same page. The form validates every field
     * client-side anyway, so this is a backstop: one clear sentence, the code
     * unchanged for anything reading it programmatically. */
    return fail(422, "INVALID_INPUT", tenant.locale);
  }
  const input = parsed.data;

  /* SEC.12 — the two identities, resolved once outside the transaction.
   *
   * `endUserIp` rather than `trustedClientIp`: the network key must count a
   * CUSTOMER's connection, and that function is null unless SEC.10 is
   * confident the address is the end user's rather than a proxy's. Hashing a
   * shared proxy address would put every customer in one bucket — the failure
   * SEC.10 exists to have fixed — so "not confident" correctly means "do not
   * count", and the key simply sits out. */
  const deviceToken = input.deviceToken ?? null;
  const ipHash = hashClientIp(endUserIp(req));

  try {
    const result = await withTenant(tenant.id, async (db) => {
      /* SEC.11 — has this exact purchase already been placed?
       *
       * The customer's connection dropping after the transaction committed is
       * the ordinary case here, not an exotic one: this route takes seconds
       * under load, the customers are on Algerian mobile networks, and the
       * form's own client-side guard cannot survive a page reload. Without
       * this, the retry is a second COD parcel and a second courier fee that
       * nobody refunds.
       *
       * Read inside the caller's transaction rather than before it, so the
       * common path costs one statement on the already-pinned connection
       * instead of a whole extra round trip. The race — two submissions in
       * flight at once, both seeing nothing here — is closed by the unique
       * index, and recovered from where the write actually fails, below. */
      const existing = input.draftToken
        ? await (db as any).salesOrder.findFirst({
            where: { requestKey: input.draftToken },
            select: { id: true, totalPrice: true, phone: true },
          })
        : null;

      /* MATCHING THE KEY IS NECESSARY BUT NOT SUFFICIENT.
       *
       * The token is `Math.random()`-derived with a guessable timestamp
       * prefix — adequate for addressing a draft row, nowhere near secret. An
       * order id, by contrast, IS a bearer handle: the thank-you page renders
       * a customer's name, wilaya and total for anyone holding one. So a
       * guessed token must not be enough to be handed one back, and the
       * phone number — which a genuine retry resends verbatim and a guesser
       * does not know — is the second factor.
       *
       * A key that matches with a DIFFERENT phone is either a collision or a
       * probe. Either way the answer is the same and it is not an error: drop
       * the key and let the sale through unguarded. Refusing would lose a real
       * order to protect a value that was never load-bearing. */
      const keyForInsert =
        existing && normalizePhone(existing.phone) !== normalizePhone(input.phone)
          ? null
          : (input.draftToken ?? null);

      if (existing && keyForInsert !== null) {
        return { duplicate: { id: existing.id as string, total: String(existing.totalPrice) } };
      }
      const page = await (db as any).landingPage.findFirst({
        where: { id: input.landingPageId, published: true, status: "PUBLISHED" },
        include: { setting: true, variants: true },
      });
      // Unpublished, or another tenant's: the same answer either way.
      if (!page) return { error: fail(404, "NOT_FOUND", tenant.locale) };

      const setting = page.setting;
      const homeOk = setting?.homeDeliveryEnabled ?? true;
      const deskOk = setting?.stopDeskEnabled ?? false;
      if (input.shippingMethod === "HOME" && !homeOk) {
        return { error: fail(422, "METHOD_UNAVAILABLE", tenant.locale) };
      }
      if (input.shippingMethod === "DESK" && !deskOk) {
        return { error: fail(422, "METHOD_UNAVAILABLE", tenant.locale) };
      }

      // Destination must be a real wilaya WITH a price set by this tenant.
      // An unpriced wilaya is undeliverable, not free.
      const wilaya = await (db as any).wilaya.findUnique({
        where: { id: input.wilayaId },
        select: { id: true, name: true },
      });
      if (!wilaya) return { error: fail(422, "UNKNOWN_DESTINATION", tenant.locale) };

      /* LB.20 — the SAME resolver `/wilayas` quotes from, so the price the
         customer was shown and the price they are charged cannot differ. A
         per-product override wins; absence means the company's rate. */
      const prices = await deliveryPricesFor(db as never, page.id);
      const price = prices.get(input.wilayaId);
      if (!price) {
        return { error: fail(422, "UNDELIVERABLE", tenant.locale) };
      }

      const shippingPrice = priceForMethod(price, input.shippingMethod);

      /* SEC.12 — the order-abuse rules, AFTER the idempotency check above and
       * BEFORE anything is written.
       *
       * The ordering is load-bearing in both directions. After idempotency,
       * because without it six retries of one purchase are six rows and a
       * threshold of three would refuse a customer for a network problem we
       * caused. Before the write, because a blocking rule has to be able to
       * stop the sale rather than annotate it afterwards.
       *
       * ERP-ONLY, and `hasErp` is read once here and reused for the fulfilment
       * bridge below rather than asked twice. The rules live in the ERP's
       * settings and their whole output is a flag on an ERP row, so a tenant
       * without the product has nowhere to configure them and nowhere to see
       * them — half-building it for those tenants would be worse than saying
       * plainly that it is an ERP feature. */
      const tenantHasErp = await hasErp(db);
      let abuse: AbuseVerdict = NO_ABUSE;

      if (tenantHasErp) {
        const settings = await readSettings(db);
        // Every key off is the ordinary case and must stay free: no counting
        // query is issued at all.
        if (anyRuleArmed(settings)) {
          abuse = await evaluateOrderAbuse(
            db,
            { deviceToken, ipHash, phoneNormalized: normalizePhone(input.phone) || null },
            settings,
          );
          if (abuse.blocked) {
            /* Logged with the counts because the customer is told none of
             * them: naming the limit in the response would hand a saboteur
             * the shape of the rule he has to stay under. */
            console.warn(
              `[order-abuse] refused checkout for ${tenant.slug}: ${abuse.reason}`,
              abuse.counts,
            );
            return { error: fail(403, "ORDER_REFUSED", tenant.locale) };
          }
        }
      }

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
      /* Free shipping is applied by `deliveryPricesFor` now, not here. It used
         to be a second step taken on this side only, which made the comment
         above it false: the dropdown quoted the company's rate and this line
         charged nothing. One resolver, one answer — D-LB.20.1. */
      const shipping = new Prisma.Decimal(shippingPrice);
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
          // SEC.11 — written in the SAME statement as the order, so the
          // uniqueness of an intended purchase and the purchase itself commit
          // or roll back together. Null when the caller sent no token, or when
          // the key resolved to somebody else's order (see above).
          requestKey: keyForInsert,
          // SEC.12 — the identities the rules count on, stored so the NEXT
          // order can be judged against this one, and so "every order from
          // this device" is answerable later. `ipHash` is a keyed hash; the
          // address itself is never written anywhere.
          deviceToken,
          ipHash,
          // AN.1 — attribution snapshot, derived server-side from the
          // session's evidence with the SAME function the visit beacon uses,
          // so an order and the views that led to it cannot name different
          // channels. Absent evidence stores null (unattributed), never a
          // guessed channel.
          ...(input.visitSource
            ? (() => {
                const derived = deriveSource(input.visitSource);
                return {
                  sourceChannel: derived.channel,
                  sourceDetail: derived.detail,
                  /* BH.4 — the campaign snapshot rides the same bundle the
                     views were attributed with, so an order can never name a
                     campaign its session did not carry. */
                  utmCampaign: input.visitSource.utmCampaign ?? null,
                };
              })()
            : {}),
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
      //
      // LB.57 — the read before the write exists because `updateMany` returns
      // a COUNT and not the row, and the row is where the abandoned cart's ERP
      // id lives. The update itself stays `updateMany` so it keeps its atomic
      // `convertedOrderId: null` guard; the read only supplies the id.
      let promoteDraftFulfilmentId: string | null = null;
      if (input.draftToken) {
        const draft = await (db as any).draftOrder.findUnique({
          where: { token: input.draftToken },
          select: { fulfillment: { select: { id: true, salesOrderId: true } } },
        });

        const { count } = await (db as any).draftOrder.updateMany({
          where: { token: input.draftToken, landingPageId: page.id, convertedOrderId: null },
          data: { convertedOrderId: order.id, convertedAt: new Date() },
        });

        // Promote only the lead THIS checkout converted. The update matching
        // exactly one row is the proof — it carries the same-page and
        // not-already-converted guards — and a fulfilment row that already
        // holds a sale belongs to another order and is left alone.
        if (count === 1 && draft?.fulfillment && !draft.fulfillment.salesOrderId) {
          promoteDraftFulfilmentId = draft.fulfillment.id as string;
        }
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
      if (tenantHasErp) {
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
        }, promoteDraftFulfilmentId, abuse.reason ? { reason: abuse.reason, flaggedAt: new Date() } : null);
      }

      return {
        order,
        total,
        currency: page.currency as string,
        pageTitle: page.title as string,
        pageSlug: page.slug as string,
      };
    });

    if ("error" in result) return result.error;
    if ("duplicate" in result && result.duplicate) return alreadyPlaced(result.duplicate);

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
    //
    // The page URL is REBUILT server-side (the vetted request origin + the
    // page's slug) rather than accepted from the body: Meta requires
    // event_source_url for action_source "website", and a client-sent URL
    // would be a second spoofable input alongside the headers currentOrigin
    // already vets (LB.43).
    const origin = await currentOrigin();
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
        // SEC.10 — the END USER's address or nothing. Meta and TikTok match on
        // this field, so a proxy's address is a confident wrong answer rather
        // than a missing one; between 21 and 23 Aug this sent a private Render
        // address on every order.
        ip: endUserIp(req),
        userAgent: req.headers.get("user-agent"),
        fbc: input.fbc ?? null,
        fbp: input.fbp ?? null,
        ttclid: input.ttclid ?? null,
        ttp: input.ttp ?? null,
        gaClientId: input.gaClientId ?? null,
        url: origin ? `${origin}${storefrontHref(tenant, result.pageSlug)}` : null,
      },
    });

    return NextResponse.json(
      { success: true, data: { id: result.order.id, total: String(result.total) } },
      { status: 201 },
    );
  } catch (error) {
    /* SEC.11 — the race the fast path above cannot see.
     *
     * Two submissions of the same purchase in flight together both read no
     * existing order and both try to insert. One wins; the other's unique
     * violation aborts its whole Postgres transaction, which is why the
     * recovery has to live out here rather than inside it — the same
     * constraint `nextReference` documents for its own P2002.
     *
     * The loser's rollback is total, so there is no half-order to clean up and
     * no `ORD-` number burned: the SalesOrder insert carrying the key runs
     * BEFORE the sequence is touched. It re-reads the winner's row and answers
     * as though it had been the duplicate all along. */
    /* THE ERROR DOES NOT SAY WHICH CONSTRAINT, SO DO NOT ASK IT.
     *
     * Measured against this exact stack (Prisma 6.19.3 on Postgres 17, through
     * the standalone bundle): a unique violation arrives as P2002 with
     * `meta.target: null` and the message "Unique constraint failed on the
     * (not available)". A first version of this branch keyed off
     * `meta.target` containing "requestKey" and therefore never fired — the
     * duplicate fell through to a 500, which is the very thing this slice
     * exists to stop. The concurrent test caught it.
     *
     * So the re-read IS the discriminator. If a row now holds this key, the
     * violation was ours and we can answer for it; if none does, it came from
     * somewhere else and belongs in the generic failure below. That is also
     * robust to `instanceof` failing across bundled copies of the client,
     * which is why the code is read structurally rather than by class. */
    if ((error as { code?: string } | null)?.code === "P2002" && input.draftToken) {
      /* Annotated because `salesOrder` is reached through `as any` — the
       * tenant client's generated types do not carry the builder models, so
       * the awaited value widens to `{}` and every field read below becomes a
       * type error rather than a lookup. Same note as the ERP suites. */
      const winner = (await withTenant(tenant.id, (db) =>
        (db as any).salesOrder.findFirst({
          where: { requestKey: input.draftToken },
          select: { id: true, totalPrice: true, phone: true },
        }),
      ).catch(() => null)) as { id: string; totalPrice: unknown; phone: string } | null;

      if (winner) {
        // Same second factor as the fast path.
        if (normalizePhone(winner.phone) === normalizePhone(input.phone)) {
          return alreadyPlaced({ id: winner.id as string, total: String(winner.totalPrice) });
        }
        // Someone else's order got the key between our read and our write. We
        // cannot hand it back, and we cannot re-run the transaction from here,
        // so this is the one genuinely conflicting case — and it is a retry
        // the customer can win, not a dead end.
        return fail(409, "CHECKOUT_CONFLICT", tenant.locale);
      }
      // Not our constraint. Fall through.
    }

    console.error("[storefront] checkout failed", error);
    return fail(500, "INTERNAL_ERROR", tenant.locale);
  }
}
