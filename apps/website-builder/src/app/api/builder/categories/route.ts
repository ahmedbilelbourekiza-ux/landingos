import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { SLUG_HAS_LETTER, SLUG_NEEDS_LETTER } from "@/lib/landing/create";

export const dynamic = "force-dynamic";

export const GET = tenantRoute("website-builder:read", async ({ db }) => {
  const items = await (db as any).category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, slug: true, description: true, icon: true,
      coverImage: true, sortOrder: true, isVisible: true,
      _count: { select: { landingPages: true } },
    },
  });
  return apiOk({ items });
});

const CreateCategory = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, numbers and hyphens only")
    // At least one letter — the digit-only-slug rule; see the landings
    // create route. «ساعات 2024» must not become /category/2024.
    .regex(SLUG_HAS_LETTER, SLUG_NEEDS_LETTER),
  description: z.string().trim().max(500).optional().nullable(),
  icon: z.string().trim().max(80).optional().nullable(),
  sortOrder: z.coerce.number().int().optional(),
  isVisible: z.coerce.boolean().optional(),
});

export const POST = tenantRoute("website-builder:pages:write", async ({ db, req, session }) => {
  const parsed = CreateCategory.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const clash = await (db as any).category.findFirst({
    where: { slug: parsed.data.slug },
    select: { id: true },
  });
  if (clash) return apiError(409, "SLUG_TAKEN", "A category with that address already exists.");

  const created = await (db as any).category.create({
    data: { ...parsed.data, tenantId: session.auth!.tenantId },
    select: { id: true, name: true, slug: true },
  });
  return apiOk(created, { status: 201 });
});
