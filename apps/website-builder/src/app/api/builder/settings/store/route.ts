import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/**
 * Store profile.
 *
 * Was a single row keyed by the literal id "singleton" — one store, because
 * there was only ever one. It is now keyed by tenantId, so every company has
 * its own and the word "singleton" no longer appears anywhere.
 */
export const GET = tenantRoute("website-builder:read", async ({ db, session }) => {
  const settings = await (db as any).storeSettings.findUnique({
    where: { tenantId: session.auth!.tenantId },
  });
  // A tenant that has never opened this screen has no row yet. Returning
  // defaults beats a 404 the client would have to special-case.
  return apiOk(settings ?? { tenantId: session.auth!.tenantId, storeName: session.tenant?.name ?? "LandingOS" });
});

const Body = z.object({
  storeName: z.string().trim().min(1).max(160).optional(),
  storeDescription: z.string().trim().max(1000).optional().nullable(),
  logo: z.string().trim().max(2000).optional().nullable(),
  favicon: z.string().trim().max(2000).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal("")),
  address: z.string().trim().max(500).optional().nullable(),
  facebook: z.string().trim().max(500).optional().nullable(),
  instagram: z.string().trim().max(500).optional().nullable(),
  tiktok: z.string().trim().max(500).optional().nullable(),
  whatsapp: z.string().trim().max(500).optional().nullable(),
  telegram: z.string().trim().max(500).optional().nullable(),
  metaBrowserPixelId: z.string().trim().max(64).optional().nullable(),
});

export const PUT = tenantRoute("website-builder:settings:write", async ({ db, req, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  const tenantId = session.auth!.tenantId;
  const saved = await (db as any).storeSettings.upsert({
    where: { tenantId },
    update: parsed.data,
    create: { ...parsed.data, tenantId },
  });
  return apiOk(saved);
});
