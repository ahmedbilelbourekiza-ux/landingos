import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

/**
 * The delivery log for one endpoint — the answer to "did my CRM actually get
 * that order?". `WebhookDelivery` had rows and no reader anywhere (W-05): a
 * tenant debugging a silent integration had nothing to look at.
 *
 * No payloads are stored or returned — a delivery row is metadata (event,
 * status, attempts, error), never the customer data it carried.
 */
export const GET = tenantRoute<Params>("platform:integrations:read", async ({ db, params }) => {
  const endpoint = await (db as any).webhookEndpoint.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!endpoint) return apiError(404, "NOT_FOUND", "That endpoint does not exist.");

  const items = await (db as any).webhookDelivery.findMany({
    where: { endpointId: params.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, event: true, resourceId: true, success: true,
      statusCode: true, attempts: true, error: true, createdAt: true,
    },
  });

  return apiOk({ items });
});
