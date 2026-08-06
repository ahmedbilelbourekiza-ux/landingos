import { NextResponse, type NextRequest } from "next/server";

import { asPlatform, withTenant } from "@landingos/db";

import { ingestEvents, recordTrackingNumber } from "@/lib/erp/shipments";
import {
  mapCarrierStatus, parseCarrierWebhook, verifyCarrierWebhook, webhookIdentifiers,
} from "@/lib/erp/carriers";

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
 * THREE STEPS, AND THE ORDER IS THE DESIGN: identify, authenticate, interpret.
 *
 *  1. IDENTIFY. Which parcel is this about? Read from the payload, because the
 *     carrier — and therefore its adapter and its secret — is a column on the
 *     shipment, and the shipment is what we are looking for. Nothing is written
 *     on the strength of this step.
 *  2. AUTHENTICATE. Now the carrier is known, its own signature scheme is
 *     applied: Svix for ZR Express, the platform's HMAC otherwise. Fails closed.
 *  3. INTERPRET. Only now is the body read for what it says, by the adapter that
 *     understands the carrier's shape.
 *
 * The carrier is resolved from the SHIPMENT and never from the payload — a body
 * that could name its own carrier could name one whose secret the sender
 * happens to know.
 *
 * A PARCEL IS FOUND BY TRACKING NUMBER **OR** BY THE REFERENCE WE GAVE IT. ZR
 * Express books a parcel and assigns its tracking number afterwards, delivering
 * it on the first webhook — so a shipment findable only by tracking number
 * could never receive the event that gives it one. LP.5.
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

  // (1) Identify.
  const ids = webhookIdentifiers(body);
  if (!ids.trackingNumber && !ids.externalId) return NextResponse.json({ received: true });

  return withTenant(tenant.id, async (db) => {
    // An empty tracking number must never match: a ZR parcel is booked without
    // one, so `trackingNumber: ""` would otherwise find the first unnumbered
    // shipment in the tenant and file somebody else's delivery against it.
    //
    // `carrierReference` and not `orderId`, even though today they hold the same
    // value: the reference is what WE gave the carrier and what the carrier
    // echoes, and a carrier that issues its own reference instead would break a
    // lookup keyed on our primary key.
    const match = [
      ...(ids.trackingNumber ? [{ trackingNumber: ids.trackingNumber }] : []),
      ...(ids.externalId ? [{ carrierReference: ids.externalId }] : []),
    ];

    const shipment = await db.shipment.findFirst({
      where: { OR: match },
      select: {
        id: true, orderId: true, carrierId: true, crmStatus: true, trackingNumber: true,
        carrier: { select: { adapter: true, webhookSecret: true } },
      },
    });
    // An unknown tracking number is acknowledged and dropped. Saying "no such
    // parcel" would let anyone test whether a number belongs to this company.
    if (!shipment) return NextResponse.json({ received: true });

    const adapterKey = shipment.carrier?.adapter ?? null;

    // (2) Authenticate — the way THIS carrier signs.
    const verdict = verifyCarrierWebhook(
      adapterKey,
      shipment.carrier?.webhookSecret ?? null,
      raw,
      req.headers,
    );
    if (verdict === "missing" || verdict === "invalid") {
      console.warn(`[webhook] rejected delivery update for ${shipment.id}: signature ${verdict}`);
      return NextResponse.json({ received: true });
    }

    // (3) Interpret.
    const event = parseCarrierWebhook(adapterKey, body);
    if (!event) return NextResponse.json({ received: true });

    // The tracking number the carrier has finally issued, written once. Only
    // now — after the signature checked out — because it is the identifier the
    // next webhook will be matched on.
    await recordTrackingNumber(db, shipment, event.trackingNumber);

    // The CRM status is resolved here, never taken from the body. A payload
    // that could set `crmStatus: delivered` directly would be a way to settle
    // revenue without a delivery. The tenant's own mapping wins, then the
    // adapter's, then the shared keyword fallback — `mapCarrierStatus` keeps
    // that last one even for an unregistered adapter, because the carrier PUSHED
    // this event and dropping it would lose a real delivery outcome to a
    // configuration problem (D-LP.2).
    const mapping = shipment.carrierId
      ? await db.carrierStatusMapping.findFirst({
          where: { carrierId: shipment.carrierId, originalStatus: event.originalStatus },
          select: { crmStatus: true },
        })
      : null;

    await ingestEvents(db, tenant.id, shipment, [
      {
        originalStatus: event.originalStatus,
        crmStatus: mapping?.crmStatus || event.crmStatus || mapCarrierStatus(adapterKey, event.originalStatus),
        description: event.description,
        eventTime: event.eventTime,
      },
    ]);

    return NextResponse.json({ received: true });
  });
}
