import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { ALL_FIELD_KEYS } from "@/lib/landing/mock-order-form";

export const dynamic = "force-dynamic";
type Params = { id: string };

/* =============================================================================
 * The order-form section save.
 *
 * LB.2. The vocabulary here is `OrderFormConfig` from
 * `lib/landing/mock-order-form.ts` — the editor sends that WHOLE object and the
 * storefront renders from it, so this route accepts exactly that shape. The
 * first platform port invented a second shape (`{ fields: {...} }` with a
 * per-field order int) that no client ever sent: every save answered 200 while
 * storing nothing but the button text, and the storefront kept rendering
 * defaults (BUILDER_AUDIT B-05/B-07). The legacy `fields` record is still
 * accepted for any caller that adopted it.
 * ========================================================================== */

const Field = z.object({
  label: z.string().trim().max(120).optional(),
  placeholder: z.string().trim().max(160).optional(),
  visible: z.boolean().optional(),
  required: z.boolean().optional(),
});

const fieldKeys = Object.fromEntries(
  ALL_FIELD_KEYS.map((key) => [key, Field.optional()]),
) as Record<(typeof ALL_FIELD_KEYS)[number], z.ZodOptional<typeof Field>>;

const Body = z.object({
  buttonText: z.string().trim().max(120).optional(),
  countdownEnabled: z.boolean().optional(),
  stickyBuyButton: z.boolean().optional(),
  floatingWhatsapp: z.boolean().optional(),
  showReviews: z.boolean().optional(),
  showFAQ: z.boolean().optional(),
  showFeatures: z.boolean().optional(),
  /** The editor's shape: field configs at the top level plus a render order. */
  ...fieldKeys,
  order: z.array(z.string().trim().max(40)).max(20).optional(),
  /** The legacy record shape, still honoured. */
  fields: z.record(z.string(), Field).optional(),
});

/** Fields the checkout cannot function without, whatever the config says. */
const REQUIRED_FIELDS = ["customerName", "phone", "wilaya", "baladia"] as const;

export const PATCH = tenantRoute<Params>("website-builder:pages:write", async ({ db, req, params, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  const page = await (db as any).landingPage.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");

  const { buttonText, fields: legacyFields, order,
    countdownEnabled, stickyBuyButton, floatingWhatsapp,
    showReviews, showFAQ, showFeatures, ...topLevelFields } = parsed.data;

  // One merged field map whichever shape arrived.
  const fields: Record<string, z.infer<typeof Field>> = {};
  for (const key of ALL_FIELD_KEYS) {
    const fromTop = (topLevelFields as Record<string, z.infer<typeof Field> | undefined>)[key];
    const fromLegacy = legacyFields?.[key];
    if (fromTop || fromLegacy) fields[key] = { ...fromLegacy, ...fromTop };
  }

  // An order with no name, phone or address cannot be delivered, so these
  // cannot be hidden however the form is configured.
  for (const key of REQUIRED_FIELDS) {
    if (fields[key]?.visible === false) {
      return apiError(422, "FIELD_REQUIRED", `The ${key} field cannot be hidden — an order without it cannot be delivered.`);
    }
  }

  const flags = { countdownEnabled, stickyBuyButton, floatingWhatsapp, showReviews, showFAQ, showFeatures };
  // Stored as the VALUE `parseOrderFormConfig` reads: field configs by key
  // plus the order array. Never a serialized string — the column is Json.
  const config = Object.keys(fields).length > 0 || order
    ? { ...fields, ...(order ? { order } : {}) }
    : undefined;

  if (buttonText !== undefined) {
    await (db as any).landingPage.updateMany({ where: { id: params.id }, data: { buttonText } });
  }
  await (db as any).landingSetting.upsert({
    where: { landingPageId: params.id },
    update: { ...flags, ...(config ? { orderFormConfig: config } : {}) },
    create: {
      ...flags,
      ...(config ? { orderFormConfig: config } : {}),
      landingPageId: params.id,
      tenantId: session.auth!.tenantId,
    },
  });

  return apiOk({ id: params.id });
});
