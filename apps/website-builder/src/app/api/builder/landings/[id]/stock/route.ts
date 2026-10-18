import { z } from "zod";
import { can } from "@landingos/auth";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { applyMovement } from "@/lib/erp/inventory";
import { LANDING_PLATFORM } from "@/lib/erp/from-landing";
import { STOCK_REASON, groupCount, levelsFromMatrix, stockKey } from "@/lib/landing/variant-stock";

export const dynamic = "force-dynamic";
type Params = { id: string };

/* =============================================================================
 * VS.1 — set a ONE-group page's stock levels from the variant editor.
 *
 * `tenantRoute`, not `landingWriteRoute`: a stock level is the Manager's data,
 * not the page's, so a stock edit must not checkpoint a page version. The
 * permission is the Manager's own (`erp:inventory:write`, which `can()` also
 * refuses for a shop without the Manager); page-write access is checked too,
 * because this door is opened from the page editor.
 *
 * LEVELS IN, MOVEMENTS OUT. Each typed level becomes a delta against the level
 * STORED NOW, inside this request's transaction — not against what the browser
 * last saw — and goes through `applyMovement` with reason `page_editor`. That
 * is the Manager variant editor's own conversion (D-LP.18.1). A level equal to
 * the stored one records nothing.
 *
 * SCOPED TO THIS PAGE. Only the product linked to this page can move, only
 * through options this page actually has, and only when the page has ONE
 * option group: with two, stock is per combination and belongs in the
 * Manager's matrix, which is where the editor links instead.
 * ========================================================================== */

const Body = z.object({
  levels: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(120),
        level: z.number().int().min(0).max(9_999_999),
      }),
    )
    .min(1)
    .max(50),
});

export const PUT = tenantRoute<Params>("erp:inventory:write", async ({ db, req, session, params }) => {
  if (!can(session.auth!, "website-builder:pages:write")) {
    return apiError(403, "FORBIDDEN", "You do not have access to this.");
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const page = await (db as any).landingPage.findUnique({
    where: { id: params.id },
    select: { id: true, variants: { select: { name: true, value: true } } },
  });
  if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");

  const rows = page.variants as { name: string; value: string }[];
  if (groupCount(rows) !== 1) {
    return apiError(
      422,
      "STOCK_PER_COMBINATION",
      "This page's stock is kept per combination. Set it in the Manager's variant editor.",
    );
  }
  const group = rows[0].name;
  const fold = (s: string) => s.trim().toLowerCase();
  const byValue = new Map(rows.map((r) => [fold(r.value), r.value]));

  const link = (await db.catalogProductLink.findFirst({
    where: { platform: LANDING_PLATFORM, externalProductId: page.id },
    select: { product: { select: { id: true, variants: true } } },
  })) as { product: { id: string; variants: unknown } | null } | null;
  if (!link?.product) {
    return apiError(409, "NOT_IN_MANAGER", "Send this page to the Manager before setting its stock.");
  }

  const stored = levelsFromMatrix(link.product.variants);
  const moves: { name: string; delta: number }[] = [];
  const missing: string[] = [];
  for (const item of parsed.data.levels) {
    const value = byValue.get(fold(item.value));
    if (!value) return apiError(422, "INVALID_INPUT", `"${item.value}" is not an option of this page.`);
    const name = stockKey(group, value);
    if (!(name in stored)) {
      missing.push(value);
      continue;
    }
    const delta = item.level - stored[name];
    if (delta !== 0) moves.push({ name, delta });
  }
  // All or nothing: a half-applied batch would leave the merchant guessing
  // which numbers took.
  if (missing.length) {
    return apiError(
      409,
      "NOT_IN_MANAGER",
      `Not in the Manager yet: ${missing.join(", ")}. Send the page to the Manager again first.`,
    );
  }

  for (const move of moves) {
    const moved = await applyMovement(db, session.auth!.tenantId, {
      productId: link.product.id,
      variantName: move.name,
      delta: move.delta,
      reason: STOCK_REASON,
      actorUserId: session.user.id,
    });
    // Checked above, inside this same transaction; a refusal here means the
    // matrix changed underneath us, and throwing rolls every earlier move back.
    if (!moved.ok) throw new Error(`stock move refused: ${moved.refusal}`);
  }

  const after = await db.catalogProduct.findUnique({
    where: { id: link.product.id },
    select: { variants: true },
  });
  return apiOk({ moved: moves.length, levels: levelsFromMatrix(after?.variants) });
});
