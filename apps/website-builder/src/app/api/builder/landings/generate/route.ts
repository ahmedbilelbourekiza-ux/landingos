import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { triggerProductWebhook } from "@/lib/webhooks/tenant-triggers";
import { completeWithProvider, AiCallError } from "@/lib/erp/ai-complete";
import {
  buildGenerationMessages,
  parseGeneratedCopy,
  GenerationParseError,
} from "@/lib/landing/ai-generate";
import { slugify } from "@/lib/landing/create";
import { readTenantImage } from "@/lib/landing/image-bytes";
import { themeFromImage } from "@/lib/landing/palette";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Generate a landing page from merchant facts (LB.24).
 *
 * The merchant gives the FACTS — name, price, selling points, their own
 * product photos (already uploaded through POST /api/builder/upload). The
 * model writes the WORDS — Algerian-dialect copy per lib/landing/ai-generate.
 * The theme comes from LB.22's deterministic palette pipeline on the first
 * photo, not from the model. Reviews are never generated (see ai-generate's
 * header), variants are the merchant's own SKU facts, and the result is a
 * DRAFT the merchant reviews in the ordinary editor — publishing stays a
 * separate, separately-permissioned human act.
 *
 * ORDER OF OPERATIONS IS THE ATOMICITY: the model is asked FIRST, with no
 * rows written; only a fully validated answer reaches the one nested create
 * (the duplicate route's shape). A failed or malformed generation leaves
 * nothing behind — no half-page for the merchant to discover and delete.
 *
 * Provider-missing answers 501 NO_AI_PROVIDER, the same statement the chat
 * route has made since SEC-03: the route exists, the gate holds, the missing
 * half is deployment configuration.
 * ========================================================================== */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const Body = z.object({
  productName: z.string().trim().min(2).max(200),
  price: z.coerce.number().nonnegative(),
  oldPrice: z.coerce.number().positive().optional().nullable(),
  currency: z.string().trim().length(3).optional(),
  sellingPoints: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  category: z.string().trim().max(120).optional().nullable(),
  slug: z.string().trim().max(120).regex(SLUG_RE).optional(),
  imageUrls: z.array(z.string().trim().min(1).max(2000)).max(12).optional(),
});

export const POST = tenantRoute("website-builder:pages:write", async ({ db, req, session, afterCommit }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const body = parsed.data;
  const tenantId = session.auth!.tenantId;

  if (body.oldPrice != null && body.oldPrice <= body.price) {
    return apiError(422, "INVALID_INPUT", "The old price must be higher than the price.");
  }

  /* Photos must be the tenant's own uploads. The prefix check mirrors
   * readTenantImage's ownership rule for every photo; the hero additionally
   * has its bytes read below, which re-proves ownership through storage. */
  const imageUrls = body.imageUrls ?? [];
  const ownPrefix = `/uploads/tenants/${tenantId}/`;
  if (imageUrls.some((u) => !u.startsWith(ownPrefix))) {
    return apiError(422, "IMAGE_NOT_OWNED", "Every photo must be one of this store's own uploads.");
  }

  const provider = await (db as any).aiProvider.findFirst({
    where: { active: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      type: true, baseUrl: true, apiKey: true, defaultModel: true,
      temperature: true, maxTokens: true, timeoutMs: true,
    },
  });
  if (!provider) {
    return apiError(501, "NO_AI_PROVIDER", "No model provider is configured for this company.");
  }

  /* Ask the model BEFORE touching the database. */
  const facts = {
    productName: body.productName,
    price: body.price,
    oldPrice: body.oldPrice ?? null,
    currency: body.currency ?? "DZD",
    sellingPoints: body.sellingPoints,
    category: body.category ?? null,
  };
  let copy;
  try {
    const answer = await completeWithProvider(
      {
        type: provider.type,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        defaultModel: provider.defaultModel,
        temperature: provider.temperature == null ? null : Number(provider.temperature),
        maxTokens: provider.maxTokens,
        timeoutMs: provider.timeoutMs,
      },
      buildGenerationMessages(facts),
    );
    copy = parseGeneratedCopy(answer);
  } catch (error) {
    if (error instanceof GenerationParseError) {
      return apiError(502, "AI_INVALID_OUTPUT", error.message);
    }
    if (error instanceof AiCallError) {
      return apiError(502, error.code, error.message);
    }
    throw error;
  }

  /* Theme: LB.22's pipeline on the first photo. `null` is a real answer
   * (colourless image) and simply means the default theme. */
  let palette = null;
  if (imageUrls[0]) {
    const bytes = await readTenantImage(imageUrls[0], tenantId);
    if (!bytes) {
      return apiError(422, "IMAGE_NOT_OWNED", "The first photo could not be read from this store's uploads.");
    }
    palette = await themeFromImage(bytes);
  }

  /* Slug: the merchant's word wins, then the latin product name, then the
   * model's transliteration. De-clash with suffixes, the duplicate rule. */
  const base =
    body.slug ||
    slugify(body.productName) ||
    (copy.slug && SLUG_RE.test(copy.slug) ? copy.slug : "") ||
    "page";
  let slug = "";
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const clash = await (db as any).landingPage.findFirst({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash) { slug = candidate; break; }
  }
  if (!slug) return apiError(409, "SLUG_TAKEN", "That address is taken — choose another.");

  const theme = palette
    ? await (db as any).landingTheme.create({
        data: { tenantId, name: copy.title.slice(0, 120), ...palette, isBuiltIn: false, sortOrder: 100 },
        select: { id: true },
      })
    : null;

  const created = await (db as any).landingPage.create({
    data: {
      tenantId,
      title: copy.title,
      slug,
      status: "DRAFT",
      published: false,
      price: body.price,
      oldPrice: body.oldPrice ?? null,
      currency: facts.currency,
      description: copy.description,
      announcement: copy.announcement ?? null,
      ctaButtonText: copy.ctaButtonText ?? null,
      seoTitle: copy.seoTitle ?? null,
      seoDescription: copy.seoDescription ?? null,
      themeId: theme?.id ?? null,
      media: {
        create: imageUrls.map((url, i) => ({
          tenantId,
          type: "IMAGE",
          url,
          // The photo shows the product; its name is the honest alt text
          // until the merchant writes a better one in the editor.
          altText: body.productName.slice(0, 300),
          placement: "GALLERY",
          displayOrder: i,
        })),
      },
      features: {
        create: copy.benefits.map((b, i) => ({
          tenantId,
          icon: b.icon!,
          title: b.title,
          description: b.description ?? null,
          displayOrder: i,
        })),
      },
      faqs: {
        create: copy.faqs.map((f, i) => ({
          tenantId,
          question: f.question,
          answer: f.answer,
          displayOrder: i,
        })),
      },
    },
    select: { id: true, title: true, slug: true, status: true },
  });

  afterCommit(async () => {
    triggerProductWebhook("product.created", tenantId, created.id);
  });

  return apiOk(created, { status: 201 });
});
