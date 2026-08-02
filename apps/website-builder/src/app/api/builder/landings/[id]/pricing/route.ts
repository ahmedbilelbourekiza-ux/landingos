import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

const Body = z.object({
  price: z.coerce.number().nonnegative().optional(),
  oldPrice: z.coerce.number().nonnegative().nullable().optional(),
  currency: z.string().trim().length(3).optional(),
  buttonText: z.string().trim().max(120).optional(),
});

export const PATCH = tenantRoute<Params>("website-builder:pages:write", async ({ db, req, params }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  // A "was" price below the current one advertises a discount that is not one.
  const { price, oldPrice } = parsed.data;
  if (price != null && oldPrice != null && oldPrice <= price) {
    return apiError(422, "INVALID_INPUT", "The old price must be higher than the current price.");
  }

  const { count } = await (db as any).landingPage.updateMany({ where: { id: params.id }, data: parsed.data });
  if (count === 0) return apiError(404, "NOT_FOUND", "That page does not exist.");
  return apiOk({ id: params.id });
});
