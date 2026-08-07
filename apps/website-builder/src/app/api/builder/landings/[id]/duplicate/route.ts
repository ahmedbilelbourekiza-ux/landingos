import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { triggerProductWebhook } from "@/lib/webhooks/tenant-triggers";

export const dynamic = "force-dynamic";
type Params = { id: string };

/**
 * Duplicate a landing page — every section, variant, review, image reference
 * and setting, as a fresh DRAFT (LB.6).
 *
 * This is how a COD store actually iterates: the next product's page starts
 * from the last one that converted. Without it the workflow is re-entering
 * fifteen variants by hand.
 *
 * Always a draft, whatever the source was: a duplicate goes live when someone
 * DECIDES it does, not because its original happened to be live. Media rows
 * copy their URLs — the underlying files are shared, immutable and
 * content-addressed, so a copy is a reference, not a re-upload.
 */
export const POST = tenantRoute<Params>("website-builder:pages:write", async ({ db, params, session, afterCommit }) => {
  const source = await (db as any).landingPage.findUnique({
    where: { id: params.id },
    include: {
      media: { orderBy: { displayOrder: "asc" } },
      variants: { orderBy: { displayOrder: "asc" } },
      features: { orderBy: { displayOrder: "asc" } },
      reviews: { orderBy: { displayOrder: "asc" } },
      faqs: { orderBy: { displayOrder: "asc" } },
      setting: true,
    },
  });
  if (!source) return apiError(404, "NOT_FOUND", "That page does not exist.");

  const tenantId = session.auth!.tenantId;

  // First free `-copy`, `-copy-2`, … slug inside the tenant. Bounded: fifty
  // copies of one page is a data problem, not a use case.
  let slug = "";
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? `${source.slug}-copy` : `${source.slug}-copy-${n}`;
    const clash = await (db as any).landingPage.findFirst({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash) { slug = candidate; break; }
  }
  if (!slug) return apiError(409, "SLUG_TAKEN", "Too many copies of this page — rename some first.");

  const copyRows = (rows: any[], fields: string[]) =>
    rows.map((row) => ({
      tenantId,
      ...Object.fromEntries(fields.map((f) => [f, row[f]])),
    }));

  const created = await (db as any).landingPage.create({
    data: {
      tenantId,
      title: `${source.title} (copy)`,
      slug,
      status: "DRAFT",
      published: false,
      description: source.description,
      price: source.price,
      oldPrice: source.oldPrice,
      currency: source.currency,
      buttonText: source.buttonText,
      ctaButtonText: source.ctaButtonText,
      announcement: source.announcement,
      seoTitle: source.seoTitle,
      seoDescription: source.seoDescription,
      categoryId: source.categoryId,
      themeId: source.themeId,
      media: { create: copyRows(source.media, ["type", "url", "altText", "displayOrder", "placement"]) },
      variants: { create: copyRows(source.variants, ["name", "value", "extraPrice", "displayOrder"]) },
      features: { create: copyRows(source.features, ["icon", "title", "description", "displayOrder"]) },
      reviews: { create: copyRows(source.reviews, ["customerName", "customerAvatar", "rating", "reviewText", "displayOrder"]) },
      faqs: { create: copyRows(source.faqs, ["question", "answer", "displayOrder"]) },
      ...(source.setting
        ? {
            setting: {
              create: {
                tenantId,
                countdownEnabled: source.setting.countdownEnabled,
                stickyBuyButton: source.setting.stickyBuyButton,
                floatingWhatsapp: source.setting.floatingWhatsapp,
                showReviews: source.setting.showReviews,
                showFAQ: source.setting.showFAQ,
                showFeatures: source.setting.showFeatures,
                shipping: source.setting.shipping,
                freeShipping: source.setting.freeShipping,
                orderFormConfig: source.setting.orderFormConfig ?? undefined,
                homeDeliveryEnabled: source.setting.homeDeliveryEnabled,
                stopDeskEnabled: source.setting.stopDeskEnabled,
              },
            },
          }
        : {}),
    },
    select: { id: true, title: true, slug: true, status: true },
  });

  afterCommit(async () => {
    triggerProductWebhook("product.created", tenantId, created.id);
  });

  return apiOk(created, { status: 201 });
});
