import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { asPlatform, withTenant } from "@landingos/db";

import { nextReference } from "./ids";
import { verifySignature, parseOrder, ingestOrder } from "./webhooks";
import { getChannelAdapter } from "./channel-adapters";
import { logIntegration } from "./integration-log";

/* =============================================================================
 * The wrapper every inbound channel webhook uses.
 *
 * Written once for the same reason `tenantRoute` was: three endpoints need the
 * identical sequence — resolve the tenant, bind to it, find the channel, verify
 * the signature, ingest — and writing it three times is three chances to get
 * the second step wrong on the one surface a stranger can reach.
 *
 * WHY EVERYTHING RETURNS 200.
 *
 * A rejected payload is acknowledged, not refused. Shopify and LightFunnels
 * retry non-2xx responses with backoff and eventually disable the endpoint, so
 * answering 401 to a forged payload punishes the tenant whose integration then
 * stops working — while telling the forger exactly which of their guesses was
 * wrong. A flat 200 with nothing written is the response that gives an attacker
 * no signal and a real integration no reason to retry.
 *
 * The exception is a body that is not JSON at all, which no real platform
 * sends and which is worth a 400 so a misconfigured endpoint is visible.
 * ========================================================================== */

type Params = { tenant: string; id: string };

export function channelWebhook(kind: "order" | "checkout" | "contact") {
  return async (req: NextRequest, ctx: { params: Promise<Params> }) => {
    const { tenant: slug, id: channelId } = await ctx.params;

    // The raw bytes, before any parsing. The HMAC is over exactly these — a
    // re-serialised body changes key order and whitespace and fails a genuine
    // signature, and the usual "fix" for that is to stop verifying.
    const raw = await req.text();

    // `Tenant` is one of the five unscoped tables (identity resolved before a
    // tenant is known), so this read is legal without a binding. Nothing else
    // in this file is.
    const tenant = await asPlatform().tenant.findUnique({
      where: { slug: slug.toLowerCase() },
      select: { id: true, status: true, deletedAt: true },
    });
    // Identical answer for an unknown tenant, a suspended one and a bad
    // signature: a webhook endpoint must not be usable to enumerate customers.
    if (!tenant || tenant.deletedAt || tenant.status !== "ACTIVE") {
      return NextResponse.json({ received: true });
    }

    return withTenant(tenant.id, async (db) => {
      const channel = await db.salesChannel.findUnique({
        where: { id: channelId },
        select: { id: true, name: true, platform: true, webhookSecret: true, webhookEnabled: true, active: true },
      });
      if (!channel || !channel.active || !channel.webhookEnabled) {
        return NextResponse.json({ received: true });
      }

      const verdict = verifySignature(channel.platform, channel.webhookSecret, raw, req.headers);
      if (verdict === "missing" || verdict === "invalid") {
        // Logged, because a run of these is somebody probing and the operator
        // should be able to see it. The payload is NOT logged: it is customer
        // data of unknown provenance.
        console.warn(
          `[webhook] rejected ${kind} for channel ${channel.id}: signature ${verdict}`,
        );
        /* LP.15 — AND RECORDED, which is the whole point of R8's log half.
         * A run of these is somebody probing, or a secret that was rotated on
         * one side only, and until this slice the ONLY evidence either way was
         * "orders stopped arriving" — reported by the tenant three days later.
         * The payload is still not logged: it is customer data of unknown
         * provenance, and the whole reason we are here is that we cannot say
         * who sent it. */
        await logIntegration(db, tenant.id, {
          entity: "salesChannel",
          entityId: channel.id,
          event: "webhook_rejected",
          result: "failure",
          message: `Signature ${verdict}.`,
          request: { kind, platform: channel.platform },
        });
        return NextResponse.json({ received: true });
      }

      let body: Record<string, unknown>;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
      }

      /* LP.15 / R8 — THE PLATFORM'S OWN SHAPE FIRST, THE GENERIC ONE AFTER.
       *
       * Shopify puts the total in `total_price` and the items in `line_items`;
       * LightFunnels wraps the order in `{ node: … }` and calls them `items`.
       * One generic parser reads Shopify tolerably and LightFunnels not at all
       * — which is how a tenant on LightFunnels received orders with no product
       * and no total.
       *
       * The generic parser is the FALLBACK rather than the replacement, because
       * seven of the nine offered platforms have no adapter and their payloads
       * are still mostly Shopify-shaped. Refusing them would lose real orders to
       * a missing integration.
       *
       * `x-shopify-topic` is passed through because Shopify sends dozens of
       * topics down one endpoint and only some of them are orders. An adapter
       * returning null for a topic it does not handle is not an error. */
      const adapter = getChannelAdapter(channel.platform);
      const topic = req.headers.get("x-shopify-topic");

      /* A REGISTERED ADAPTER'S `null` IS AN ANSWER, NOT A MISS.
       *
       * The first build wrote `adapter?.parseOrder?.(…) ?? parseOrder(body)`,
       * and a test caught it: a Shopify `products/update` topic — which the
       * adapter correctly refuses — fell through to the generic parser, which
       * happily turned `{id, title}` into an order with no customer and no
       * total. LightFunnels' checkout stub would have done the same.
       *
       * It is D-LP.2's rule in a new place: a registered integration's refusal
       * must be honoured, never routed around. The generic parser applies only
       * where there is NO adapter at all. */
      const parsed = adapter?.parseOrder
        ? (adapter.parseOrder(body, topic) as ReturnType<typeof parseOrder>)
        : parseOrder(body);

      if (!parsed) {
        await logIntegration(db, tenant.id, {
          entity: "salesChannel",
          entityId: channel.id,
          event: "webhook_unparsed",
          result: "failure",
          // Not "failed": a Shopify `products/update` topic arriving on the
          // order endpoint is ordinary traffic, and so is LightFunnels'
          // checkout-stage stub with no phone number.
          message: "The payload carried no order this adapter recognises.",
          request: { kind, platform: channel.platform, topic },
        });
        return NextResponse.json({ received: true });
      }

      const result = await ingestOrder(db, tenant.id, channel, parsed, () =>
        nextReference(db, tenant.id, "order"),
      );

      // A checkout or contact webhook is an ABANDONED order, not a placed one —
      // the customer filled the form and did not finish. Marking it keeps it
      // out of the confirmation queue while leaving it callable.
      if (result.created && kind !== "order") {
        await db.fulfillmentOrder.update({
          where: { id: result.id! },
          data: { orderType: "abandoned" },
        });
      }

      /* Recorded either way. "It arrived and we already had it" is the answer
       * to most of the questions this log gets opened for — platforms retry,
       * and they replay backlogs. */
      await logIntegration(db, tenant.id, {
        entity: "salesChannel",
        entityId: channel.id,
        event: "webhook_received",
        result: "success",
        message: result.created ? "Order created." : "Already seen; nothing written.",
        request: { kind, platform: channel.platform, externalId: parsed.externalId },
      });

      return NextResponse.json({ received: true, created: result.created });
    });
  };
}
