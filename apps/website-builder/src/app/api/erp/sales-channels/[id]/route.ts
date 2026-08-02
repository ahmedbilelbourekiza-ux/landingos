import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { CHANNEL_SELECT, maskChannel } from "../route";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = tenantRoute<Params>("erp:settings:write", async ({ db, params }) => {
  const channel = await db.salesChannel.findUnique({ where: { id: params.id }, select: CHANNEL_SELECT });
  if (!channel) return apiError(404, "NOT_FOUND", "No such sales channel.");
  return apiOk(maskChannel(toJson(channel) as Record<string, unknown>));
});

const MASK = "••••";

/**
 * Update a channel.
 *
 * A credential that comes back as the mask is DROPPED, not written. The console
 * reads the masked channel, the user edits the name, the console sends the whole
 * object back — and without this the webhook secret becomes four bullet
 * characters. Nothing errors; every subsequent genuine webhook simply fails its
 * signature check and the tenant silently stops receiving orders.
 */
export const PUT = tenantRoute<Params>("erp:settings:write", async ({ db, req, params }) => {
  const channel = await db.salesChannel.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!channel) return apiError(404, "NOT_FOUND", "No such sales channel.");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const secrets: Record<string, string> = {};
  for (const field of ["apiKey", "apiSecret", "webhookSecret"]) {
    const value = body[field];
    if (value === undefined || value === MASK || value === "") continue;
    secrets[field] = String(value);
  }

  const updated = await db.salesChannel.update({
    where: { id: params.id },
    data: {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.platform === "string" ? { platform: body.platform } : {}),
      ...(typeof body.apiUrl === "string" ? { apiUrl: body.apiUrl } : {}),
      ...(body.apiEnabled !== undefined ? { apiEnabled: Boolean(body.apiEnabled) } : {}),
      ...(body.webhookEnabled !== undefined ? { webhookEnabled: Boolean(body.webhookEnabled) } : {}),
      ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
      ...secrets,
    },
    select: CHANNEL_SELECT,
  });

  return apiOk(maskChannel(toJson(updated) as Record<string, unknown>));
});

/**
 * Deactivate, not delete.
 *
 * Orders carry `salesChannelId`, and the relation is SetNull — deleting the row
 * would strip the provenance from every order that ever arrived through it, and
 * "where did this sale come from" is the question the channel exists to answer.
 * Deactivating also stops its webhook, which is what the button means.
 */
export const DELETE = tenantRoute<Params>("erp:settings:write", async ({ db, params }) => {
  const channel = await db.salesChannel.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!channel) return apiError(404, "NOT_FOUND", "No such sales channel.");

  await db.salesChannel.update({
    where: { id: params.id },
    data: { active: false, webhookEnabled: false },
  });
  return apiOk({ id: params.id, active: false });
});
