import { NextResponse, type NextRequest } from "next/server";

import { asPlatform, withTenant } from "@landingos/db";

import { verifySignature } from "@/lib/erp/webhooks";
import { ingestEvents } from "@/lib/erp/shipments";
import { getAdapter } from "@/lib/erp/carriers";

export const dynamic = "force-dynamic";

type Params = { tenant: string };

/**
 * A carrier pushing a status update.
 *
 * `deliveryOutcome` is the single most valuable field on this platform to be
 * able to write from outside: customer lifetime spend, product revenue,
 * delivered pay and the profit calculator are all computed from it. So this
 * endpoint settles nothing that is not signed by the carrier whose shipment it
 * names.
 *
 * The parcel is found by TRACKING NUMBER, which is the only identifier a
 * carrier knows. That is also why the carrier is resolved from the shipment
 * rather than from the payload — a body that could name its own carrier could
 * name one whose secret the sender happens to know.
 *
 * Carriers are never rate-limited and never given a retryable error: they
 * replay backlogs, and an endpoint that pushes back gets switched off.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { tenant: slug } = await ctx.params;
  const raw = await req.text();

  const tenant = await asPlatform().tenant.findUnique({
    where: { slug: slug.toLowerCase() },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!tenant || tenant.deletedAt || tenant.status !== "ACTIVE") {
    return NextResponse.json({ received: true });
  }

  let body: Record<string, unknown>;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const trackingNumber = String(body.trackingNumber ?? body.tracking ?? "").trim();
  if (!trackingNumber) return NextResponse.json({ received: true });

  return withTenant(tenant.id, async (db) => {
    const shipment = await db.shipment.findFirst({
      where: { trackingNumber },
      select: {
        id: true, orderId: true, carrierId: true, crmStatus: true,
        carrier: { select: { adapter: true, webhookSecret: true } },
      },
    });
    // An unknown tracking number is acknowledged and dropped. Saying "no such
    // parcel" would let anyone test whether a number belongs to this company.
    if (!shipment) return NextResponse.json({ received: true });

    const verdict = verifySignature(
      shipment.carrier?.adapter ?? null,
      shipment.carrier?.webhookSecret ?? null,
      raw,
      req.headers,
    );
    if (verdict === "missing" || verdict === "invalid") {
      console.warn(`[webhook] rejected delivery update for ${shipment.id}: signature ${verdict}`);
      return NextResponse.json({ received: true });
    }

    const originalStatus = String(body.status ?? body.originalStatus ?? "").trim();
    if (!originalStatus) return NextResponse.json({ received: true });

    // The CRM status is resolved here, never taken from the body. A payload
    // that could set `crmStatus: delivered` directly would be a way to settle
    // revenue without a delivery.
    const adapter = getAdapter(shipment.carrier?.adapter ?? null);
    const mapping = shipment.carrierId
      ? await db.carrierStatusMapping.findFirst({
          where: { carrierId: shipment.carrierId, originalStatus },
          select: { crmStatus: true },
        })
      : null;

    await ingestEvents(db, tenant.id, shipment, [
      {
        originalStatus,
        crmStatus: mapping?.crmStatus ?? adapter.mapStatus(originalStatus),
        description: String(body.description ?? ""),
        // The carrier's own moment when it sends one. Stamping "now" would
        // book a replayed backlog into the wrong period.
        eventTime: body.eventTime ? new Date(Number(body.eventTime) || String(body.eventTime)) : new Date(),
      },
    ]);

    return NextResponse.json({ received: true });
  });
}
