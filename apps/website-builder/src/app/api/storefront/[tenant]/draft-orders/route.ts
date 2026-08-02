import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@landingos/db";

import { tenantBySlug } from "@/lib/storefront/resolve-tenant";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Abandoned-checkout capture.
 *
 * Called repeatedly as a visitor types, so the token is the upsert key and one
 * visit produces one row rather than hundreds. Deliberately tolerant: this is
 * best-effort telemetry on a half-filled form, and a strict validator would
 * reject exactly the partial input it exists to capture.
 *
 * It records NO prices. A draft is a lead, not a quote — anything monetary is
 * computed at checkout from the tenant's own rows.
 *
 * Every failure is a silent 204. A customer must never see an error from a
 * background capture they did not ask for, and telling a caller why their
 * write was rejected would make this a probe for which pages exist.
 * ========================================================================== */

const Body = z.object({
  token: z.string().trim().min(8).max(120),
  landingPageId: z.string().min(1),
  customerName: z.string().trim().max(160).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  wilaya: z.string().trim().max(120).optional().nullable(),
  baladia: z.string().trim().max(160).optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(99).optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string }> },
) {
  const { tenant: slug } = await ctx.params;
  const tenant = await tenantBySlug(slug);
  if (!tenant) return new NextResponse(null, { status: 204 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return new NextResponse(null, { status: 204 });

  const { token, landingPageId, ...fields } = parsed.data;

  try {
    await withTenant(tenant.id, async (db) => {
      const page = await (db as any).landingPage.findFirst({
        where: { id: landingPageId, published: true },
        select: { id: true },
      });
      if (!page) return;

      await (db as any).draftOrder.upsert({
        where: { token },
        update: fields,
        create: { ...fields, token, landingPageId: page.id, tenantId: tenant.id },
      });
    });
  } catch (error) {
    console.error("[storefront] draft capture failed", error);
  }

  return new NextResponse(null, { status: 204 });
}
