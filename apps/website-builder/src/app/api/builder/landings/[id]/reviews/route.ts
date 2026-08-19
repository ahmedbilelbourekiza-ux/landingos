import { z } from "zod";
import { apiOk, apiError } from "@/lib/api/route";
import { landingWriteRoute } from "@/lib/api/landing-write";

export const dynamic = "force-dynamic";
type Params = { id: string };

const Item = z.object({
  customerName: z.string().trim().min(1).max(120),
  // 1..5 is enforced here because Prisma has no portable CHECK constraint, so
  // the validation layer is the only thing standing between a typo and a
  // six-star review.
  rating: z.coerce.number().int().min(1).max(5),
  reviewText: z.string().trim().min(1).max(2000),
  customerAvatar: z.string().trim().max(2000).optional().nullable(),
});
const Body = z.object({ items: z.array(Item).max(200) });

export const PUT = landingWriteRoute<Params>("website-builder:pages:write", async ({ db, req, params, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  const page = await (db as any).landingPage.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");

  const rows = parsed.data.items.map((r, i) => ({
    ...r,
    landingPageId: params.id,
    tenantId: session.auth!.tenantId,
    displayOrder: i,
  }));

  // Sequential, NOT $transaction: withTenant already opened one, and the
  // client it hands back has no $transaction because Prisma does not nest
  // them. These statements are therefore already atomic — a failure here rolls
  // the whole request back.
  await (db as any).landingReview.deleteMany({ where: { landingPageId: params.id } });
  if (rows.length) await (db as any).landingReview.createMany({ data: rows });

  return apiOk({ id: params.id, count: rows.length });
});
