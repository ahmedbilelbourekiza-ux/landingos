import { z } from "zod";
import { apiOk, apiError } from "@/lib/api/route";
import { landingWriteRoute } from "@/lib/api/landing-write";

export const dynamic = "force-dynamic";
type Params = { id: string };

const Body = z.object({
  homeDeliveryEnabled: z.boolean().optional(),
  stopDeskEnabled: z.boolean().optional(),
  shipping: z.coerce.number().nonnegative().optional(),
  freeShipping: z.boolean().optional(),
});

export const PATCH = landingWriteRoute<Params>("website-builder:pages:write", async ({ db, req, params, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  const page = await (db as any).landingPage.findUnique({
    where: { id: params.id },
    select: { id: true, setting: { select: { homeDeliveryEnabled: true, stopDeskEnabled: true } } },
  });
  if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");

  // Resolve against what is already stored, so turning one method off in a
  // partial update cannot leave a product with no way to be delivered.
  const home = parsed.data.homeDeliveryEnabled ?? page.setting?.homeDeliveryEnabled ?? true;
  const desk = parsed.data.stopDeskEnabled ?? page.setting?.stopDeskEnabled ?? false;
  if (!home && !desk) {
    return apiError(422, "NO_SHIPPING_METHOD", "A product needs at least one delivery method.");
  }

  await (db as any).landingSetting.upsert({
    where: { landingPageId: params.id },
    update: parsed.data,
    create: { ...parsed.data, landingPageId: params.id, tenantId: session.auth!.tenantId },
  });

  return apiOk({ id: params.id, homeDeliveryEnabled: home, stopDeskEnabled: desk });
});
