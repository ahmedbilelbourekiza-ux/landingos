import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

const Item = z.object({
  type: z.enum(["IMAGE", "VIDEO"]),
  url: z.string().trim().min(1).max(2000),
  altText: z.string().trim().max(300).optional().nullable(),
  placement: z.enum(["GALLERY", "DESCRIPTION"]).default("GALLERY"),
});
const Body = z.object({
  items: z.array(Item).max(100),
  /**
   * When present, ONLY this placement's rows are replaced and every item is
   * forced into it. The two editor sections each own one placement and save
   * independently — without this scope, saving the gallery would silently
   * delete the description images and vice versa (LB.2).
   */
  placement: z.enum(["GALLERY", "DESCRIPTION"]).optional(),
});

/**
 * Replace a page's media — wholesale, or one placement when scoped.
 *
 * displayOrder is assigned from array position and scoped PER PLACEMENT, so
 * the gallery and the description images each number from zero. That matters
 * because media[0] of the GALLERY is the hero image — mixing the two lists
 * would silently change which picture a customer sees first.
 */
export const PUT = tenantRoute<Params>("website-builder:pages:write", async ({ db, req, params, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  const page = await (db as any).landingPage.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");

  const scope = parsed.data.placement;
  const perPlacement: Record<string, number> = { GALLERY: 0, DESCRIPTION: 0 };
  const rows = parsed.data.items.map((item) => {
    const placement = scope ?? item.placement;
    return {
      ...item,
      placement,
      landingPageId: params.id,
      tenantId: session.auth!.tenantId,
      displayOrder: perPlacement[placement]++,
    };
  });

  // Replace inside ONE transaction: a delete that commits without its insert
  // would leave a live page with no images at all.
  // Sequential, NOT $transaction: withTenant already opened one, and the
  // client it hands back has no $transaction because Prisma does not nest
  // them. These statements are therefore already atomic — a failure here rolls
  // the whole request back.
  await (db as any).landingMedia.deleteMany({
    where: { landingPageId: params.id, ...(scope ? { placement: scope } : {}) },
  });
  if (rows.length) await (db as any).landingMedia.createMany({ data: rows });

  return apiOk({ id: params.id, count: rows.length });
});
