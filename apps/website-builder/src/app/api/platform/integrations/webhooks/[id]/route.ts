import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { encryptToken } from "@/lib/meta/crypto";

export const dynamic = "force-dynamic";
type Params = { id: string };

const Body = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().url().max(2000).optional(),
  secret: z.string().trim().min(8).max(200).optional(),
  events: z.array(z.string().trim().max(80)).max(50).optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = tenantRoute<Params>("platform:integrations:manage", async ({ db, req, params }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  if (parsed.data.url && !parsed.data.url.startsWith("https://")) {
    return apiError(422, "INSECURE_URL", "A webhook endpoint must use https.");
  }

  // A replaced secret is encrypted like a created one; an omitted secret
  // leaves the stored one untouched.
  const data = {
    ...parsed.data,
    ...(parsed.data.secret ? { secret: encryptToken(parsed.data.secret) } : {}),
  };
  const { count } = await (db as any).webhookEndpoint.updateMany({ where: { id: params.id }, data });
  if (count === 0) return apiError(404, "NOT_FOUND", "That endpoint does not exist.");
  return apiOk({ id: params.id });
});

export const DELETE = tenantRoute<Params>("platform:integrations:manage", async ({ db, params }) => {
  const { count } = await (db as any).webhookEndpoint.deleteMany({ where: { id: params.id } });
  if (count === 0) return apiError(404, "NOT_FOUND", "That endpoint does not exist.");
  return apiOk({ id: params.id });
});
