import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/** The access token is never returned once saved — only whether one is set. */
const mask = (row: any) => ({ ...row, accessToken: row.accessToken ? "••••••••" : null });

export const GET = tenantRoute("platform:integrations:read", async ({ db }) => {
  const items = await (db as any).metaPixelConfig.findMany({ orderBy: { createdAt: "desc" } });
  return apiOk({ items: items.map(mask) });
});

const Body = z.object({
  label: z.string().trim().min(1).max(120),
  pixelId: z.string().trim().regex(/^\d{5,25}$/, "a Meta pixel id is numeric"),
  accessToken: z.string().trim().min(10).max(500),
  isActive: z.boolean().default(false),
});

export const POST = tenantRoute("platform:integrations:manage", async ({ db, req, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  const created = await (db as any).metaPixelConfig.create({
    data: { ...parsed.data, tenantId: session.auth!.tenantId },
  });
  return apiOk(mask(created), { status: 201 });
});
