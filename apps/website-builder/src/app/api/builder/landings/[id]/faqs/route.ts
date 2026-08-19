import { z } from "zod";
import { apiOk, apiError } from "@/lib/api/route";
import { landingWriteRoute } from "@/lib/api/landing-write";

export const dynamic = "force-dynamic";
type Params = { id: string };

/* FAQ — LB.12. Mirrors the reviews route exactly: replace-all PUT, array
 * order IS the display order. */
const Item = z.object({
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(2000),
});
const Body = z.object({ items: z.array(Item).max(50) });

export const PUT = landingWriteRoute<Params>("website-builder:pages:write", async ({ db, req, params, session }) => {
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
  await (db as any).landingFAQ.deleteMany({ where: { landingPageId: params.id } });
  if (rows.length) await (db as any).landingFAQ.createMany({ data: rows });

  return apiOk({ id: params.id, count: rows.length });
});
