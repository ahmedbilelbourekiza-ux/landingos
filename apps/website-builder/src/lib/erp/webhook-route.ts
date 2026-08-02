import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { asPlatform, withTenant } from "@landingos/db";

import { nextReference } from "./ids";
import { verifySignature, parseOrder, ingestOrder } from "./webhooks";

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
        return NextResponse.json({ received: true });
      }

      let body: Record<string, unknown>;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
      }

      const parsed = parseOrder(body);
      if (!parsed) return NextResponse.json({ received: true });

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

      return NextResponse.json({ received: true, created: result.created });
    });
  };
}
