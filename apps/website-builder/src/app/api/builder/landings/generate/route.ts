import { can } from "@landingos/auth";
import { withTenant } from "@landingos/db";
import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { triggerProductWebhook } from "@/lib/webhooks/tenant-triggers";
import { isSafeUploadFilename } from "@/lib/uploads";
import { completeWithProvider, AiCallError } from "@/lib/erp/ai-complete";
import { reserveAiCall, settleAiCall, releaseAiCall } from "@/lib/erp/ai-quota";
import {
  buildGenerationMessages,
  parseGeneratedCopy,
  GenerationParseError,
} from "@/lib/landing/ai-generate";
import { slugify, slugHasLetter, SLUG_HAS_LETTER, SLUG_NEEDS_LETTER } from "@/lib/landing/create";
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
 * THE THREE PHASES, D-LP.5.1, the provider-test route's own shape:
 *   plan   — validate the body, prove photo ownership, load the provider,
 *            INSIDE the wrapper's transaction; write nothing.
 *   call   — read the hero's bytes, ask the model, extract the palette, in
 *            NO transaction, through `afterCommit` — a generation is allowed
 *            up to 120s and the tenant transaction lives 15; holding a pooled
 *            connection open across somebody else's latency is the exact
 *            anti-pattern the TX_OPTIONS comment records.
 *   record — slug de-clash + theme + page in ONE fresh short transaction, so
 *            "a malformed answer writes nothing" stays literally true.
 *
 * `apiKey` is loaded here (this route and the provider test route are the
 * TWO places in the AI surface that load it) and never reaches a response,
 * a log line, or the client.
 *
 * Spend note, deliberate: this route bills the tenant's own key and is gated
 * on `website-builder:pages:write` — NOT `erp:ai:use` — because builder-only
 * tenants have no ERP permission surface at all. Whether AI spend deserves
 * its own permission on the builder side is an open product question,
 * recorded in NEXT_STEPS §LB.24.
 * ========================================================================== */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const Body = z.object({
  productName: z.string().trim().min(2).max(200),
  price: z.coerce.number().nonnegative(),
  oldPrice: z.coerce.number().positive().optional().nullable(),
  currency: z.string().trim().length(3).optional(),
  sellingPoints: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  category: z.string().trim().max(120).optional().nullable(),
  /* Charset AND the letter rule — LB.54's gate, which this route was the one
     write path never to carry. A merchant-supplied `"0"` used to publish a
     page at `/0` here while the create form refused the identical value. */
  slug: z.string().trim().max(100).regex(SLUG_RE).regex(SLUG_HAS_LETTER, SLUG_NEEDS_LETTER).optional(),
  imageUrls: z.array(z.string().trim().min(1).max(2000)).max(12).optional(),
});

/** The real ownership rule — readTenantImage's, not a looser prefix copy:
 * exactly `/uploads/tenants/<tenantId>/<safe-filename>`, applied to EVERY
 * photo, so a `..` segment can never ride a later gallery slot into the
 * page. */
function ownsUpload(url: string, tenantId: string): boolean {
  const segments = url.split("/").filter(Boolean);
  return (
    segments.length === 4 &&
    segments[0] === "uploads" &&
    segments[1] === "tenants" &&
    segments[2] === tenantId &&
    isSafeUploadFilename(segments[3])
  );
}

export const POST = tenantRoute("website-builder:pages:write", async ({ db, req, session, afterCommit }) => {
  /* SEC.8 — the SECOND permission, checked by hand because the wrapper takes
   * one. pages:write says the caller may create the draft this route writes;
   * ai:spend says they may bill the tenant's provider key to do it. The 16 Aug
   * header note below ("whether AI spend deserves its own permission is an
   * open product question") is closed: it does, because the SENSITIVE list's
   * own rule — spending money is never implied by a glob — already applied. */
  if (!can(session.auth!, "website-builder:ai:spend")) {
    return apiError(403, "AI_SPEND_FORBIDDEN", "Spending on AI needs its own permission on this company.");
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const body = parsed.data;
  const tenantId = session.auth!.tenantId;

  if (body.oldPrice != null && body.oldPrice <= body.price) {
    return apiError(422, "INVALID_INPUT", "The old price must be higher than the price.");
  }

  const imageUrls = body.imageUrls ?? [];
  if (imageUrls.some((u) => !ownsUpload(u, tenantId))) {
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

  /* AQ.1 — the quota gate, INSIDE the wrapper's transaction so the count and
   * the reservation land together. Refusing here means the model is never
   * contacted and the tenant's key is never billed. */
  const reservation = await reserveAiCall(db, tenantId, "landing_generation", {
    provider: provider.type,
    model: provider.defaultModel,
  });
  if (!reservation.ok) {
    const { used, limit, resetsAt } = reservation.usage;
    return apiError(
      429,
      "AI_QUOTA_EXCEEDED",
      `This store's monthly AI allowance is used up (${used} of ${limit} calls). It resets on ${resetsAt.toISOString().slice(0, 10)}.`,
      { used, limit, resetsAt: resetsAt.toISOString() },
    );
  }
  const usageEventId = reservation.eventId;

  const facts = {
    productName: body.productName,
    price: body.price,
    oldPrice: body.oldPrice ?? null,
    currency: body.currency ?? "DZD",
    sellingPoints: body.sellingPoints,
    category: body.category ?? null,
  };

  /* Phases two and three — after the wrapper's transaction has committed and
   * released its connection. The closure's response REPLACES the placeholder
   * below; a throw is logged by the wrapper and the placeholder stands. */
  afterCommit(async () => {
    // The hero's bytes first: a photo that cannot be read refuses for free,
    // BEFORE the tenant's key is billed for an answer that would be thrown
    // away.
    let heroBytes: Buffer | null = null;
    if (imageUrls[0]) {
      heroBytes = await readTenantImage(imageUrls[0], tenantId);
      if (!heroBytes) {
        // The provider was never contacted, so this reservation un-counts —
        // the ONE refusal after the gate that is provably pre-call.
        await releaseAiCall(tenantId, usageEventId);
        return apiError(422, "IMAGE_NOT_OWNED", "The first photo could not be read from this store's uploads.");
      }
    }

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
      await settleAiCall(tenantId, usageEventId, {
        ok: true,
        promptTokens: answer.usage.promptTokens,
        completionTokens: answer.usage.completionTokens,
      });
      copy = parseGeneratedCopy(answer.text);
    } catch (error) {
      if (error instanceof GenerationParseError) {
        // The call happened and was billed; only the parse failed. The ledger
        // row was already settled `ok` above, honestly: the spend is real.
        return apiError(502, "AI_INVALID_OUTPUT", error.message);
      }
      if (error instanceof AiCallError) {
        // The provider was contacted (or contact was attempted); the spend
        // may be real, so this settles `failed` rather than releasing.
        await settleAiCall(tenantId, usageEventId, { ok: false });
        return apiError(502, error.code, error.message);
      }
      throw error;
    }

    // LB.22's palette. `null` is a real answer (colourless image) and simply
    // means the default theme.
    const palette = heroBytes ? await themeFromImage(heroBytes) : null;

    /* Slug: the merchant's word wins, then the latin product name, then the
     * model's transliteration. Bases are capped so the longest de-clash
     * suffix stays inside the 120 every other slug writer enforces. */
    /* The MODEL's suggestion is checked for the letter rule too, and IGNORED
       rather than refused when it fails. The merchant never typed it, so there
       is nothing to ask them about — and throwing away a generation they paid
       for because the model answered "2024" would be the worse trade. It falls
       through to "page", which is letter-bearing, lands on a DRAFT, and is the
       first thing the editor shows them. Measured before this: a model slug of
       "0" produced /0-2 and "2024" produced /2024. */
    const modelSlug =
      copy.slug && SLUG_RE.test(copy.slug) && slugHasLetter(copy.slug) ? copy.slug : "";
    const base =
      body.slug ||
      slugify(body.productName).slice(0, 100).replace(/-+$/, "") ||
      modelSlug ||
      "page";

    try {
      const created = await withTenant(tenantId, async (tx) => {
        let slug = "";
        for (let n = 1; n <= 50; n++) {
          const candidate = n === 1 ? base : `${base}-${n}`;
          const clash = await (tx as any).landingPage.findFirst({
            where: { slug: candidate },
            select: { id: true },
          });
          if (!clash) { slug = candidate; break; }
        }
        if (!slug) return null;

        const theme = palette
          ? await (tx as any).landingTheme.create({
              data: { tenantId, name: copy.title.slice(0, 120), ...palette, isBuiltIn: false, sortOrder: 100 },
              select: { id: true },
            })
          : null;

        return (tx as any).landingPage.create({
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
                // The photo shows the product; its name is the honest alt
                // text until the merchant writes a better one in the editor.
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
      });

      if (!created) {
        return apiError(409, "SLUG_TAKEN", "That address is taken — choose another.");
      }

      // Already post-commit here; the fresh transaction above has closed.
      triggerProductWebhook("product.created", tenantId, created.id);
      return apiOk(created, { status: 201 });
    } catch (error: any) {
      // Two generations racing the same slug: the loser's unique-constraint
      // failure is a 409 with a retry, not an anonymous 500 after a billed
      // model call.
      if (error?.code === "P2002") {
        return apiError(409, "SLUG_TAKEN", "That address was just taken — try again.");
      }
      throw error;
    }
  });

  // Replaced by `afterCommit`. Returned so the handler has a value either
  // way; if the closure throws, the wrapper logs it and this stands.
  return apiError(500, "INTERNAL_ERROR", "Generation did not complete.");
});
