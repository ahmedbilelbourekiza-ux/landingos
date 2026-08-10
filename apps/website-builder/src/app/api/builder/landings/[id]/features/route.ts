import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

/* Benefits ("features" in the schema's vocabulary) — LB.12. Mirrors the
 * reviews route exactly: replace-all PUT, array order IS the display order.
 * `icon` is a key the storefront maps to a component, never a URL or markup —
 * the length cap plus the charset keeps it that way. */
const Item = z.object({
  icon: z.string().trim().regex(/^[a-z0-9-]{1,40}$/, "Icon must be an icon key."),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
});
const Body = z.object({ items: z.array(Item).max(24) });

export const PUT = tenantRoute<Params>("website-builder:pages:write", async ({ db, req, params, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  const page = await (db as any).landingPage.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");

  const rows = parsed.data.items.map((f, i) => ({
    ...f,
    landingPageId: params.id,
    tenantId: session.auth!.tenantId,
    displayOrder: i,
  }));

  // Sequential, NOT $transaction: withTenant already opened one — see the
  // reviews route for the full reasoning.
  await (db as any).landingFeature.deleteMany({ where: { landingPageId: params.id } });
  if (rows.length) await (db as any).landingFeature.createMany({ data: rows });

  return apiOk({ id: params.id, count: rows.length });
});
