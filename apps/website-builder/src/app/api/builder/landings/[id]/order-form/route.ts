import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

const Field = z.object({
  label: z.string().trim().max(120).optional(),
  placeholder: z.string().trim().max(160).optional(),
  visible: z.boolean().optional(),
  required: z.boolean().optional(),
  order: z.coerce.number().int().optional(),
});

const Body = z.object({
  buttonText: z.string().trim().max(120).optional(),
  countdownEnabled: z.boolean().optional(),
  stickyBuyButton: z.boolean().optional(),
  floatingWhatsapp: z.boolean().optional(),
  showReviews: z.boolean().optional(),
  showFAQ: z.boolean().optional(),
  showFeatures: z.boolean().optional(),
  fields: z.record(z.string(), Field).optional(),
});

/** Fields the checkout cannot function without, whatever the config says. */
const REQUIRED_FIELDS = ["customerName", "phone", "wilaya", "baladia"] as const;

export const PATCH = tenantRoute<Params>("website-builder:pages:write", async ({ db, req, params, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  const page = await (db as any).landingPage.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");

  // An order with no name, phone or address cannot be delivered, so these
  // cannot be hidden however the form is configured.
  const fields = parsed.data.fields ?? {};
  for (const key of REQUIRED_FIELDS) {
    if (fields[key]?.visible === false) {
      return apiError(422, "FIELD_REQUIRED", `The ${key} field cannot be hidden — an order without it cannot be delivered.`);
    }
  }

  const { buttonText, fields: formFields, ...flags } = parsed.data;

  if (buttonText !== undefined) {
    await (db as any).landingPage.updateMany({ where: { id: params.id }, data: { buttonText } });
  }
  await (db as any).landingSetting.upsert({
      where: { landingPageId: params.id },
    update: { ...flags, ...(formFields ? { orderFormConfig: formFields } : {}) },
    create: {
      ...flags,
      ...(formFields ? { orderFormConfig: formFields } : {}),
      landingPageId: params.id,
      tenantId: session.auth!.tenantId,
    },
  });

  return apiOk({ id: params.id });
});
