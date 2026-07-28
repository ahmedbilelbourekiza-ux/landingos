import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { getAuthenticatedAdmin } from "@/lib/auth/require-auth";
import { resolveClientIp } from "@/lib/auth/rate-limit";
import { checkDraftRateLimit } from "@/lib/draft-rate-limit";
import { triggerDraftOrderWebhook } from "@/lib/webhooks/triggers";

// Abandoned-checkout capture.
//
// POST is PUBLIC (the storefront calls it while the customer types) and is
// rate-limited per IP. GET is admin-only — it returns customer phone numbers,
// so the middleware keeps it behind auth and we re-check here.

const variantItemSchema = z.object({ name: z.string(), value: z.string() });

const upsertSchema = z.object({
  // Client-generated per-visit id, kept in sessionStorage. Upsert key, so a
  // visitor editing the form updates one row instead of creating many.
  token: z.string().min(8).max(100),
  landingId: z.string(),
  customerName: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  wilayaId: z.number().int().optional().nullable(),
  baladiaId: z.number().int().optional().nullable(),
  quantity: z.number().int().min(1).max(999).optional(),
  variants: z.array(variantItemSchema).max(20).optional(),
});

// A phone is "callable" once it has enough digits to actually dial. Algerian
// mobiles are 10 digits (0X XX XX XX XX); we accept 9+ so a number that is
// one keystroke from complete still counts, while half-typed input does not
// trigger a webhook. The storefront also debounces, so in practice the value
// has settled before it reaches here.
function isCallable(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return phone.replace(/\D/g, "").length >= 9;
}

export async function POST(req: NextRequest) {
  try {
    const ip = resolveClientIp(req);
    if (!checkDraftRateLimit(ip)) {
      return fail("RATE_LIMITED", "Too many requests", 429);
    }

    const body = await req.json();
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const { token, landingId, customerName, phone, wilayaId, baladiaId, quantity, variants } =
      parsed.data;

    const landing = await db.landingPage.findUnique({
      where: { id: landingId },
      include: { variants: { orderBy: { displayOrder: "asc" } } },
    });
    if (!landing) return fail("NOT_FOUND", "Landing page not found", 404);
    if (!landing.published || landing.status !== "PUBLISHED") {
      return fail("NOT_PUBLISHED", "This landing page is not available", 403);
    }

    // Resolve wilaya/baladia names + shipping, but only as far as the customer
    // has actually got. Everything here is optional by design — the whole
    // point is capturing an INCOMPLETE form.
    let wilayaName: string | null = null;
    let baladiaName: string | null = null;
    let shippingPrice: number | null = null;

    if (wilayaId) {
      const wilaya = await db.wilaya.findUnique({ where: { id: wilayaId } });
      if (wilaya) {
        wilayaName = wilaya.nameAr ?? wilaya.name;
        const delivery = await db.globalDeliveryPrice.findUnique({ where: { wilayaId } });
        shippingPrice = delivery?.homePrice.toNumber() ?? null;
      }
    }
    if (baladiaId) {
      const baladia = await db.baladia.findUnique({ where: { id: baladiaId } });
      baladiaName = baladia?.nameAr ?? baladia?.name ?? null;
    }

    const safeVariants = (variants ?? []).filter((submitted) =>
      landing.variants.some((lv) => lv.name === submitted.name && lv.value === submitted.value),
    );
    const variantExtra = safeVariants.reduce((sum, v) => {
      const match = landing.variants.find((lv) => lv.name === v.name && lv.value === v.value);
      return sum + (match?.extraPrice.toNumber() ?? 0);
    }, 0);

    const qty = quantity ?? 1;
    const productPrice = landing.price.toNumber() + variantExtra;
    const totalPrice = productPrice * qty + (shippingPrice ?? 0);

    const existing = await db.draftOrder.findUnique({
      where: { token },
      select: { id: true, notifiedAt: true, convertedOrderId: true },
    });

    // Once the visitor has actually placed the order, stop mutating the draft
    // — it is a historical record at that point.
    if (existing?.convertedOrderId) {
      return ok({ draftId: existing.id, converted: true });
    }

    const data = {
      landingPageId: landingId,
      customerName: customerName?.trim() || null,
      phone: phone?.trim() || null,
      wilaya: wilayaName,
      baladia: baladiaName,
      quantity: qty,
      variants: JSON.stringify(safeVariants),
      productPrice,
      shippingPrice,
      totalPrice,
    };

    const draft = await db.draftOrder.upsert({
      where: { token },
      create: { token, ...data },
      update: data,
      select: { id: true, notifiedAt: true },
    });

    // Fire the lead webhook exactly once, the first time we have a number the
    // sales team can actually ring. Subsequent edits send draft_order.updated
    // instead, so a CRM is not spammed with duplicate leads.
    if (isCallable(phone)) {
      if (!draft.notifiedAt) {
        await db.draftOrder.update({
          where: { id: draft.id },
          data: { notifiedAt: new Date() },
        });
        triggerDraftOrderWebhook("draft_order.created", draft.id);
      } else {
        triggerDraftOrderWebhook("draft_order.updated", draft.id);
      }
    }

    return ok({ draftId: draft.id });
  } catch (error) {
    console.error("[api/draft-orders] POST error:", error);
    return serverError("Failed to save draft order");
  }
}

// GET /api/draft-orders — admin list for the Abandoned dashboard page.
// Contains customer PII; auth enforced by middleware and re-checked here.
export async function GET(req: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return fail("UNAUTHORIZED", "Not authenticated", 401);

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 25)));
    const filter = searchParams.get("filter") ?? "abandoned";

    const where = {
      // Only rows where we actually captured something worth calling.
      phone: { not: null },
      ...(filter === "abandoned" ? { convertedOrderId: null } : {}),
      ...(filter === "converted" ? { convertedOrderId: { not: null } } : {}),
    };

    const [drafts, total] = await Promise.all([
      db.draftOrder.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { landingPage: { select: { title: true, slug: true } } },
      }),
      db.draftOrder.count({ where }),
    ]);

    const data = drafts.map((d) => ({
      id: d.id,
      customerName: d.customerName,
      phone: d.phone,
      wilaya: d.wilaya,
      baladia: d.baladia,
      quantity: d.quantity,
      totalPrice: d.totalPrice?.toNumber() ?? null,
      productTitle: d.landingPage?.title ?? "Unknown",
      productSlug: d.landingPage?.slug ?? null,
      converted: Boolean(d.convertedOrderId),
      convertedOrderId: d.convertedOrderId,
      notified: Boolean(d.notifiedAt),
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    }));

    return ok({ drafts: data, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("[api/draft-orders] GET error:", error);
    return serverError("Failed to fetch draft orders");
  }
}
