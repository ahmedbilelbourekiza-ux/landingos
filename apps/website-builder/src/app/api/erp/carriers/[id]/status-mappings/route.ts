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
