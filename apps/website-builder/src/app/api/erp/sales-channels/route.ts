import { z } from "zod";

import { tenantRoute, apiOk, apiError, pagination } from "@/lib/api/route";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

export const CHANNEL_SELECT = {
  id: true, name: true, platform: true, brand: true,
  apiUrl: true, apiKey: true, apiSecret: true, webhookSecret: true, webhookEndpoint: true,
  apiEnabled: true, webhookEnabled: true, lastTestAt: true, active: true, createdAt: true,
} as const;

const MASK = "••••";

/**
 * Mask the credentials and say whether there are any.
 *
 * `webhookSecret` is the one that matters most: it is what proves an inbound
 * payload really came from the platform, so disclosing it would let anyone
 * forge orders into this tenant.
 */
export function maskChannel(channel: Record<string, unknown>) {
  const out = { ...channel };
  let has = false;
  for (const field of ["apiKey", "apiSecret", "webhookSecret"]) {
    if (out[field]) { has = true; out[field] = MASK; }
  }
  return { ...out, _hasCredentials: has };
}

/** An external storefront this tenant sells through. Was the ERP's `stores`. */
export const GET = tenantRoute("erp:settings:write", async ({ db, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams);
  const [items, total] = await Promise.all([
    db.salesChannel.findMany({ orderBy: { createdAt: "desc" }, skip, take, select: CHANNEL_SELECT }),
    db.salesChannel.count(),
  ]);
  return apiOk({
    items: items.map((c) => maskChannel(toJson(c) as Record<string, unknown>)),
    page, pageSize, total,
  });
});

const CreateChannel = z.object({
  name: z.string().trim().min(1).max(200),
  platform: z.string().trim().max(60).optional(),
  brand: z.string().trim().max(120).optional(),
  apiUrl: z.string().trim().max(500).optional(),
  apiKey: z.string().trim().max(500).optional(),
  apiSecret: z.string().trim().max(500).optional(),
  webhookSecret: z.string().trim().max(500).optional(),
});

export const POST = tenantRoute("erp:settings:write", async ({ db, req, session }) => {
  const parsed = CreateChannel.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const tenantId = session.auth!.tenantId;
  const created = await db.salesChannel.create({
    data: { ...parsed.data, tenantId },
    select: CHANNEL_SELECT,
  });

  // The endpoint the tenant pastes into Shopify or LightFunnels. It carries the
  // tenant slug because an inbound webhook has no session and `SalesChannel` is
  // RLS-scoped — a channel id alone cannot be resolved before a tenant is
  // bound. See D-05.5 in lib/erp/webhooks.ts.
  const endpoint = `/api/erp/webhooks/${session.tenant!.slug}/channel/${created.id}`;
  await db.salesChannel.update({ where: { id: created.id }, data: { webhookEndpoint: endpoint } });

  return apiOk(
    maskChannel({ ...(toJson(created) as Record<string, unknown>), webhookEndpoint: endpoint }),
    { status: 201 },
  );
});
