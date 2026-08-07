import { z } from "zod";

import { tenantRoute, apiOk, apiError, pagination } from "@/lib/api/route";
import { nextReference } from "@/lib/erp/ids";
import { rollUp, type Variant } from "@/lib/erp/inventory";
import { toJson, toDecimal } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

export const PRODUCT_SELECT = {
  id: true, reference: true, name: true, sku: true, description: true, brand: true,
  niche: true, category: true, supplier: true,
  price: true, costPrice: true, packagingCost: true,
  variants: true, optionDefs: true, image: true,
  stock: true, threshold: true, archived: true,
  totalOrders: true, confirmedOrders: true, cancelledOrders: true,
  deliveredOrders: true, totalRevenue: true, firstOrderAt: true, lastOrderAt: true,
  createdAt: true,
} as const;

/**
 * The catalogue.
 *
 * `archived=true` is a separate view rather than a filter that widens the
 * default one: archiving is how the ERP removes a product without destroying
 * the history that references it, so the active list must never show archived
 * rows and the archived list must never be reachable by accident.
 */
export const GET = tenantRoute("erp:products:read", async ({ db, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams);
  const archived = searchParams.get("archived") === "true";
  const search = searchParams.get("search")?.trim();

  const where = {
    archived,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { sku: { contains: search, mode: "insensitive" as const } },
            { reference: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.catalogProduct.findMany({
      where, orderBy: [{ name: "asc" }, { id: "asc" }], skip, take, select: PRODUCT_SELECT,
    }),
    db.catalogProduct.count({ where }),
  ]);

  return apiOk({ items: items.map(toJson), page, pageSize, total });
});

const VariantInput = z.object({
  name: z.string().trim().min(1).max(120),
  stock: z.coerce.number().int().min(0).optional(),
  threshold: z.coerce.number().int().min(0).optional(),
  sku: z.string().trim().max(80).optional(),
  image: z.string().trim().max(2000).optional(),
});

const CreateProduct = z.object({
  name: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(80).optional(),
  description: z.string().trim().max(5000).optional(),
  brand: z.string().trim().max(120).optional(),
  // LP.18 / R12 — the three classification fields the ERP's create carried.
  niche: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  supplier: z.string().trim().max(160).optional(),
  price: z.union([z.string(), z.number()]).optional(),
  costPrice: z.union([z.string(), z.number()]).optional(),
  packagingCost: z.union([z.string(), z.number()]).optional(),
  threshold: z.coerce.number().int().min(0).optional(),
  stock: z.coerce.number().int().min(0).optional(),
  image: z.string().trim().max(2000).optional(),
  variants: z.array(VariantInput).max(200).optional(),
});

export const POST = tenantRoute("erp:products:write", async ({ db, req, session }) => {
  const parsed = CreateProduct.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const input = parsed.data;
  const tenantId = session.auth!.tenantId;

  // costPrice and packagingCost were each dropped by an earlier version of this
  // path. Nothing failed — the product simply appeared with a zero cost basis,
  // which makes every profit figure that uses it wrong rather than absent.
  const variants = (input.variants ?? []) as Variant[];

  const created = await db.catalogProduct.create({
    data: {
      tenantId,
      reference: await nextReference(db, tenantId, "product"),
      name: input.name,
      sku: input.sku ?? "",
      description: input.description ?? "",
      brand: input.brand ?? "",
      niche: input.niche ?? "",
      category: input.category ?? "",
      supplier: input.supplier ?? "",
      price: toDecimal(input.price),
      costPrice: toDecimal(input.costPrice) ?? undefined,
      packagingCost: toDecimal(input.packagingCost) ?? undefined,
      threshold: input.threshold ?? 0,
      image: input.image ?? "",
      variants: variants as unknown as never,
      stock: rollUp(variants, input.stock ?? 0),
    },
    select: PRODUCT_SELECT,
  });

  await db.catalogProductEvent.create({
    data: {
      tenantId, productId: created.id, eventType: "created", actorUserId: session.user.id,
    },
  });

  return apiOk(toJson(created), { status: 201 });
});
