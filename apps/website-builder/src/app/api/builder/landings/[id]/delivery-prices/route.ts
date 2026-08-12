import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

/* =============================================================================
 * This product's own delivery prices — LB.20.
 *
 * A tenant prices delivery once, per wilaya, in Settings. That is right for a
 * catalogue of similar things and wrong the moment one product is heavy,
 * fragile, or sold at a margin that cannot absorb the standard rate. These rows
 * override the company's for ONE page; a wilaya with no row here falls back, so
 * a merchant prices the two exceptions and leaves the other fifty-six alone.
 *
 * REPLACE-ALL, like `features`/`faqs`/`reviews` before it. The alternative is a
 * per-row PATCH plus a DELETE, and then the screen has to reconcile which rows
 * moved — the same reasoning LB.12 recorded for the sections that already work
 * this way. Sending `[]` clears every override and returns the page to the
 * company's prices, which is the only way to undo this that a merchant would
 * think to try.
 *
 * The money rule is the schema's: `Decimal` in, `Decimal` stored, never a float
 * (M-06). The strings arrive as strings and Prisma parses them; a `z.number()`
 * here would put every price through binary floating point on the way in.
 * ========================================================================== */

const Row = z.object({
  wilayaId: z.coerce.number().int().positive(),
  // Accepted as a string so the value never becomes a JS float. The regex is
  // what a price looks like; the column does the rest.
  homePrice: z.union([z.string(), z.number()]).transform(String)
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "A price must be a number."),
  deskPrice: z.union([z.string(), z.number()]).transform(String)
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "A price must be a number.")
    .nullable().optional(),
});

const Body = z.object({
  // 58 wilayas is the ceiling by construction; the bound is here so a bad
  // client cannot ask this route to write unbounded rows.
  items: z.array(Row).max(64),
});

export const PUT = tenantRoute<Params>(
  "website-builder:pages:write",
  async ({ db, req, params, session }) => {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
    }

    // Another tenant's page does not resolve under the binding, so this is a
    // 404 rather than a leak that the row exists elsewhere.
    const page = await db.landingPage.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");

    const items = parsed.data.items;

    // A wilaya named twice would make the last one win silently. Refused: the
    // merchant typed two prices for one place and needs to know which.
    const seen = new Set<number>();
    for (const row of items) {
      if (seen.has(row.wilayaId)) {
        return apiError(422, "DUPLICATE_WILAYA", "A wilaya can only be priced once.");
      }
      seen.add(row.wilayaId);
    }

    // Every id must be a real wilaya. Without this a typo writes a row that
    // matches no destination and silently never applies.
    if (items.length) {
      const known = await db.wilaya.count({ where: { id: { in: [...seen] } } });
      if (known !== seen.size) {
        return apiError(422, "UNKNOWN_DESTINATION", "That wilaya does not exist.");
      }
    }

    /* Replace-all. Sequential rather than `$transaction`, because `withTenant`
       has already opened one and the client it hands back has no `$transaction`
       — calling it throws at runtime. Statements issued on this client are
       already atomic together. */
    await db.landingDeliveryPrice.deleteMany({ where: { landingPageId: params.id } });
    for (const row of items) {
      await db.landingDeliveryPrice.create({
        data: {
          tenantId: session.auth!.tenantId,
          landingPageId: params.id,
          wilayaId: row.wilayaId,
          homePrice: row.homePrice,
          deskPrice: row.deskPrice ?? null,
        },
      });
    }

    return apiOk({ id: params.id, count: items.length });
  },
);

/** What this page overrides today, for the editor to render. */
export const GET = tenantRoute<Params>(
  "website-builder:read",
  async ({ db, params }) => {
    const items = await db.landingDeliveryPrice.findMany({
      where: { landingPageId: params.id },
      orderBy: { wilayaId: "asc" },
      select: { wilayaId: true, homePrice: true, deskPrice: true },
    });
    return apiOk({
      // Decimal as a STRING, so a price never passes through a JS float on its
      // way to the browser (M-06) — the same rule the storefront route follows.
      items: items.map((r) => ({
        wilayaId: r.wilayaId,
        homePrice: String(r.homePrice),
        deskPrice: r.deskPrice == null ? null : String(r.deskPrice),
      })),
    });
  },
);
