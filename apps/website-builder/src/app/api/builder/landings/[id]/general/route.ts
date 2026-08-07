import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { triggerProductWebhook } from "@/lib/webhooks/tenant-triggers";

export const dynamic = "force-dynamic";
type Params = { id: string };

const Body = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, numbers and hyphens only").optional(),
  description: z.string().trim().max(20000).optional().nullable(),
  announcement: z.string().trim().max(500).optional().nullable(),
  ctaButtonText: z.string().trim().max(120).optional().nullable(),
  categoryId: z.string().optional().nullable(),
  themeId: z.string().optional().nullable(),
  // The SEO columns: read by the public page's generateMetadata since the
  // port, writable nowhere until LB.6. Length caps are storage bounds; the
  // editor advises on display budgets.
  seoTitle: z.string().trim().max(200).optional().nullable(),
  seoDescription: z.string().trim().max(500).optional().nullable(),
});

export const PATCH = tenantRoute<Params>("website-builder:pages:write", async ({ db, req, params, session, afterCommit }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  // A slug change has to stay unique WITHIN the tenant (M-04). Two tenants may
  // both own "winter-jacket"; one tenant may not own it twice.
  if (parsed.data.slug) {
    const clash = await (db as any).landingPage.findFirst({
      where: { slug: parsed.data.slug, NOT: { id: params.id } },
      select: { id: true },
    });
    if (clash) return apiError(409, "SLUG_TAKEN", "A page with that address already exists.");
  }

  // A referenced category or theme must belong to this tenant. The binding
  // makes another tenant's id unresolvable, so this rejects rather than
  // silently attaching to nothing.
  for (const [field, model] of [["categoryId", "category"], ["themeId", "landingTheme"]] as const) {
    const value = (parsed.data as any)[field];
    if (value) {
      const found = await (db as any)[model].findUnique({ where: { id: value }, select: { id: true } });
      if (!found) return apiError(422, "INVALID_REFERENCE", `That ${model === "category" ? "category" : "theme"} does not exist.`);
    }
  }

  const { count } = await (db as any).landingPage.updateMany({ where: { id: params.id }, data: parsed.data });
  if (count === 0) return apiError(404, "NOT_FOUND", "That page does not exist.");

  const tenantId = session.auth!.tenantId;
  afterCommit(async () => {
    triggerProductWebhook("product.updated", tenantId, params.id);
  });

  return apiOk({ id: params.id });
});
