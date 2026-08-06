import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Carrier wording ↔ CRM status.
 *
 * Carriers do not standardise their status strings, and the same company will
 * write "Livré", "Livré au client" and "LIVRE" across three years of API
 * versions. A mapping table is what lets a tenant teach the system their
 * carrier's dialect without a deploy.
 *
 * The ORIGINAL is always preserved on every ShipmentEvent, so a mapping added
 * today can be applied to history — which is only possible because the history
 * was never flattened on the way in.
 */
export const GET = tenantRoute<Params>("erp:shipments:write", async ({ db, params }) => {
  const items = await db.carrierStatusMapping.findMany({
    where: { carrierId: params.id },
    orderBy: { originalStatus: "asc" },
    select: { id: true, originalStatus: true, crmStatus: true },
  });
  return apiOk({ items: items.map(toJson) });
});

const Mapping = z.object({
  originalStatus: z.string().trim().min(1).max(200),
  crmStatus: z.string().trim().min(1).max(60),
});

export const POST = tenantRoute<Params>("erp:shipments:write", async ({ db, req, session, params }) => {
  const carrier = await db.carrier.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!carrier) return apiError(404, "NOT_FOUND", "No such carrier.");

  const parsed = Mapping.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const tenantId = session.auth!.tenantId;
  const saved = await db.carrierStatusMapping.upsert({
    where: {
      tenantId_carrierId_originalStatus: {
        tenantId, carrierId: params.id, originalStatus: parsed.data.originalStatus,
      },
    },
    create: { tenantId, carrierId: params.id, ...parsed.data },
    update: { crmStatus: parsed.data.crmStatus },
    select: { id: true, originalStatus: true, crmStatus: true },
  });

  return apiOk(toJson(saved), { status: 201 });
});

/**
 * Remove one mapping — LP.14, closing R20's second half.
 *
 * **A wrong status mapping was permanent.** `POST` upserts, so a mapping could
 * be corrected in place — but a mapping that should never have existed could
 * not be removed, and it goes on translating a carrier's wording into a CRM
 * status on every event that arrives. R20 rates it Medium for exactly that: the
 * cost is not the row, it is every future parcel it mistranslates.
 *
 * Keyed on `originalStatus` rather than on the row id, because that is the
 * natural key the upsert above already uses and it is what the screen shows.
 * Idempotent: removing one that is not there is a 200 with `removed: 0`, not a
 * 404 — the caller's intent ("this mapping should not exist") is satisfied
 * either way, and the same reasoning `revoke` uses on an invitation.
 *
 * HISTORY IS UNTOUCHED. `ShipmentEvent` keeps the carrier's original wording on
 * every row, so removing a mapping changes what happens NEXT and never rewrites
 * what a parcel was already recorded as doing.
 */
export const DELETE = tenantRoute<Params>("erp:shipments:write", async ({ db, req, session, params }) => {
  const carrier = await db.carrier.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!carrier) return apiError(404, "NOT_FOUND", "No such carrier.");

  const body = (await req.json().catch(() => ({}))) as { originalStatus?: unknown };
  const originalStatus = String(body.originalStatus ?? "").trim();
  if (!originalStatus) {
    return apiError(422, "INVALID_INPUT", "originalStatus is required.");
  }

  const { count } = await db.carrierStatusMapping.deleteMany({
    where: { tenantId: session.auth!.tenantId, carrierId: params.id, originalStatus },
  });
  return apiOk({ originalStatus, removed: count });
});
