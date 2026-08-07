import { z } from "zod";
import { tenantRoute, apiOk, apiError, pagination } from "@/lib/api/route";
import { triggerProductWebhook } from "@/lib/webhooks/tenant-triggers";

export const dynamic = "force-dynamic";

/**
 * Landing pages for the active tenant.
 *
 * No `where: { tenantId }` anywhere below. The tenant is bound by the route
 * wrapper and enforced by the database, and adding a second filter here would
 * be a weaker copy of a rule that already holds — one that could drift.
 */
export const GET = tenantRoute("website-builder:read", async ({ db, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams);
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status")?.trim();

  const where = {
    ...(status ? { status: status as never } : {}),
    // Postgres LIKE is case-SENSITIVE where SQLite's was not, so `contains`
    // needs an explicit mode or search silently stops matching.
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" as const } },
            { slug: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    (db as any).landingPage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true, title: true, slug: true, status: true, published: true,
        price: true, currency: true, createdAt: true, updatedAt: true,
        category: { select: { id: true, name: true } },
        _count: { select: { salesOrders: true } },
      },
    }),
    (db as any).landingPage.count({ where }),
  ]);

  return apiOk({ items, page, pageSize, total });
});

const CreateLanding = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, numbers and hyphens only"),
  price: z.coerce.number().nonnegative(),
  categoryId: z.string().optional().nullable(),
});

export const POST = tenantRoute("website-builder:pages:write", async ({ db, req, session, afterCommit }) => {
  const parsed = CreateLanding.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  // Slug uniqueness is per-tenant now (M-04), so two tenants may both own
  // "winter-jacket". The clash we still have to report is within this tenant.
  const clash = await (db as any).landingPage.findFirst({
    where: { slug: parsed.data.slug },
    select: { id: true },
  });
  if (clash) {
    return apiError(409, "SLUG_TAKEN", "A page with that address already exists.");
  }

  const created = await (db as any).landingPage.create({
    data: { ...parsed.data, tenantId: session.auth!.tenantId },
    select: { id: true, title: true, slug: true, status: true },
  });

  // After commit, or the trigger's own binding would race this transaction
  // and find no row. Fire-and-forget beyond that point (LB.3).
  const tenantId = session.auth!.tenantId;
  afterCommit(async () => {
    triggerProductWebhook("product.created", tenantId, created.id);
  });

  return apiOk(created, { status: 201 });
});
