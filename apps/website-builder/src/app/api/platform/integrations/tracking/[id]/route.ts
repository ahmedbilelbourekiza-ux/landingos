import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { encryptToken } from "@/lib/meta/crypto";
import { trackingProvider } from "@/lib/tracking/config";

export const dynamic = "force-dynamic";
type Params = { id: string };

const Body = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  publicId: z.string().trim().min(1).max(120).optional(),
  serverToken: z.string().trim().min(4).max(500).optional(),
  testCode: z.string().trim().max(80).nullable().optional(),
  settings: z.record(z.string(), z.string().trim().max(200)).optional(),
  managedBy: z.enum(["customer", "platform"]).optional(),
  isActive: z.boolean().optional(),
  // `provider` is deliberately NOT editable: it decides which adapter
  // interprets every other field, so changing it in place would reinterpret a
  // stored credential under a different protocol. Delete and recreate.
});

export const PATCH = tenantRoute<Params>("platform:integrations:manage", async ({ db, req, params }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  const existing = await (db as any).trackingIntegration.findUnique({
    where: { id: params.id },
    select: { provider: true },
  });
  if (!existing) return apiError(404, "NOT_FOUND", "That integration does not exist.");

  if (parsed.data.publicId) {
    const spec = trackingProvider(existing.provider);
    if (spec && !spec.publicIdPattern.test(parsed.data.publicId)) {
      return apiError(
        422,
        "INVALID_PUBLIC_ID",
        `${spec.publicIdLabel} for ${spec.name} should look like: ${spec.publicIdHint}.`,
      );
    }
  }

  const data = {
    ...parsed.data,
    ...(parsed.data.serverToken ? { serverToken: encryptToken(parsed.data.serverToken) } : {}),
  };
  await (db as any).trackingIntegration.updateMany({ where: { id: params.id }, data });
  return apiOk({ id: params.id });
});

export const DELETE = tenantRoute<Params>("platform:integrations:manage", async ({ db, params }) => {
  const { count } = await (db as any).trackingIntegration.deleteMany({ where: { id: params.id } });
  if (count === 0) return apiError(404, "NOT_FOUND", "That integration does not exist.");
  return apiOk({ id: params.id });
});
