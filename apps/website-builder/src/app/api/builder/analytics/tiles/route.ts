import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import {
  TILES_PRODUCT,
  TILES_KEY,
  parseTilePreferences,
  validateTilePreferences,
  mergeTilePreferences,
  clearedThresholdKeys,
} from "@/lib/builder/traffic-tiles";

export const dynamic = "force-dynamic";

/* =============================================================================
 * TR.2 — the Traffic screen's tile preferences.
 *
 * ONE ProductSetting ROW per tenant, `(tenant, "website-builder",
 * "trafficTiles")`, on the ERP's own settings pattern and for its reasons: no
 * new table, no migration, keyed so no company sees another's, and one
 * validated shape so a typo cannot become a setting.
 *
 * READ is open to anyone the screen admits; WRITE is `settings:write`, the
 * same permission that guards the delivery-price table — a store-wide
 * preference is a setting, not a page edit.
 *
 * AN INVALID BATCH CHANGES NOTHING. The whole body is validated first and the
 * write happens only if every key passed — half-applying a rejected request
 * is worse than refusing it, because the caller is told it failed and half of
 * it happened anyway.
 * ========================================================================== */

async function readStored(db: any) {
  const row = await db.productSetting.findFirst({
    where: { product: TILES_PRODUCT, key: TILES_KEY },
    select: { value: true },
  });
  return parseTilePreferences(row?.value);
}

export const GET = tenantRoute("website-builder:read", async ({ db }) => {
  return apiOk(await readStored(db));
});

export const PUT = tenantRoute("website-builder:settings:write", async ({ db, req, session }) => {
  const body = await req.json().catch(() => ({}));
  const { clean, errors } = validateTilePreferences(body);
  if (!clean) {
    return apiError(422, "INVALID_TILES", errors[0] ?? "Invalid tile preferences.", { details: errors });
  }

  const tenantId = session.auth!.tenantId;
  const stored = await readStored(db);
  const merged = mergeTilePreferences(stored, clean, clearedThresholdKeys(body));

  await (db as any).productSetting.upsert({
    where: { tenantId_product_key: { tenantId, product: TILES_PRODUCT, key: TILES_KEY } },
    create: { tenantId, product: TILES_PRODUCT, key: TILES_KEY, value: merged as never },
    update: { value: merged as never },
  });

  await (db as any).auditEvent.create({
    data: {
      tenantId,
      userId: session.user.id,
      product: TILES_PRODUCT,
      entity: "trafficTiles",
      entityId: "trafficTiles",
      action: "update",
      // The shape of the change, never the merchant's numbers: which tiles are
      // hidden and which have a scale. The cut points themselves are
      // configuration, and configuration does not belong in an append-only
      // table that can never be corrected.
      payload: { hidden: merged.hidden, thresholdKeys: Object.keys(merged.thresholds) },
    },
  });

  return apiOk(merged);
});
