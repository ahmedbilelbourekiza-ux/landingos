import { z } from "zod";

import { tenantRoute, apiOk, apiError, pagination } from "@/lib/api/route";
import { maskCarrier, listAdapters } from "@/lib/erp/carriers";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

export const CARRIER_SELECT = {
  id: true, name: true, code: true, adapter: true,
  apiUrl: true, apiKey: true, secretKey: true, webhookUrl: true, webhookSecret: true,
  trackingEndpoint: true, shipmentEndpoint: true, statusEndpoint: true,
  apiEnabled: true, webhookEnabled: true,
  lastSyncAt: true, lastTestAt: true, lastTestOk: true,
  isDefault: true, active: true, createdAt: true,
} as const;

export const GET = tenantRoute("erp:shipments:write", async ({ db, searchParams }) => {
  if (searchParams.get("adapters") === "true") return apiOk({ items: listAdapters() });

  const { skip, take, page, pageSize } = pagination(searchParams);
  const [items, total] = await Promise.all([
    db.carrier.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }], skip, take, select: CARRIER_SELECT,
    }),
    db.carrier.count(),
  ]);

  // Masked on the way out, always. A carrier's API key is a credential that can
  // book real parcels at the tenant's expense.
  return apiOk({ items: items.map((c) => maskCarrier(toJson(c) as Record<string, unknown>)), page, pageSize, total });
});

const CreateCarrier = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(60),
  adapter: z.string().trim().max(60).optional(),
  apiUrl: z.string().trim().max(500).optional(),
  apiKey: z.string().trim().max(500).optional(),
  secretKey: z.string().trim().max(500).optional(),
  webhookSecret: z.string().trim().max(500).optional(),
  apiEnabled: z.coerce.boolean().optional(),
});

export const POST = tenantRoute("erp:shipments:write", async ({ db, req, session }) => {
  const parsed = CreateCarrier.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  // Per tenant (M-04). Every company configures their own carriers and will all
  // reuse the same well-known codes — "zr", "yalidine", "ecom" — so the clash
  // that matters is inside one tenant, not across the platform.
  const clash = await db.carrier.findFirst({
    where: { code: parsed.data.code }, select: { id: true },
  });
  if (clash) return apiError(409, "CODE_TAKEN", "A carrier with that code already exists.");

  const created = await db.carrier.create({
    data: { ...parsed.data, tenantId: session.auth!.tenantId, adapter: parsed.data.adapter ?? "mock" },
    select: CARRIER_SELECT,
  });

  return apiOk(maskCarrier(toJson(created) as Record<string, unknown>), { status: 201 });
});
