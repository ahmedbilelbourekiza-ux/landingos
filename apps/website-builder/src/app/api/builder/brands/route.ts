import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { SLUG_HAS_LETTER, SLUG_NEEDS_LETTER } from "@/lib/landing/create";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Brands (LB.36) — the categories routes' exact shape, plus the join.
 *
 * `categoryIds` is SET semantics on create and on patch: the stored links
 * become exactly the submitted list (validated tenant-owned first — the
 * binding makes a foreign id unresolvable, and this turns "silently linked to
 * nothing" into a refusal the merchant can see, the general route's own
 * argument for categoryId/themeId).
 * ========================================================================== */

export const GET = tenantRoute("website-builder:read", async ({ db }) => {
  const items = await (db as any).brand.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, slug: true, logo: true, description: true, isVisible: true,
      categories: { select: { categoryId: true } },
      _count: { select: { landingPages: true } },
    },
  });
  return apiOk({
    items: items.map((b: any) => ({
      ...b,
      categories: undefined,
      categoryIds: b.categories.map((c: any) => c.categoryId),
    })),
  });
});

const CreateBrand = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, numbers and hyphens only")
    // The digit-only-slug rule, carried from day one: the slug is reserved
    // for a public listing, and /brand/2024 is the LB.54 defect pre-ordered.
    .regex(SLUG_HAS_LETTER, SLUG_NEEDS_LETTER),
  logo: z.string().trim().max(2000).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  isVisible: z.coerce.boolean().optional(),
  categoryIds: z.array(z.string()).max(50).optional(),
});

/** Every referenced category must resolve under this tenant's binding. */
async function categoriesAllExist(db: any, ids: readonly string[]): Promise<boolean> {
  if (!ids.length) return true;
  const found = await db.category.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true },
  });
  return found.length === new Set(ids).size;
}

export const POST = tenantRoute("website-builder:pages:write", async ({ db, req, session }) => {
  const parsed = CreateBrand.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { categoryIds = [], ...data } = parsed.data;
  const tenantId = session.auth!.tenantId;

  const clash = await (db as any).brand.findFirst({
    where: { slug: data.slug },
    select: { id: true },
  });
  if (clash) return apiError(409, "SLUG_TAKEN", "A brand with that address already exists.");

  if (!(await categoriesAllExist(db, categoryIds))) {
    return apiError(422, "INVALID_REFERENCE", "One of those categories does not exist.");
  }

  const created = await (db as any).brand.create({
    data: {
      ...data,
      tenantId,
      categories: {
        create: [...new Set(categoryIds)].map((categoryId) => ({ tenantId, categoryId })),
      },
    },
    select: { id: true, name: true, slug: true },
  });
  return apiOk(created, { status: 201 });
});
