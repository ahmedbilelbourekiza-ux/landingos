import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import {
  readSettings, writeSettings, validateSettings, crossFieldError, ERP_PRODUCT,
} from "@/lib/erp/settings";

export const dynamic = "force-dynamic";

export const GET = tenantRoute("erp:read", async ({ db }) => {
  return apiOk(await readSettings(db));
});

/**
 * Replace the named settings.
 *
 * Three rules, each of which cost something to learn — see lib/erp/settings.ts.
 * The one worth repeating here: an invalid batch changes NOTHING. Validation
 * runs over the whole body and the write only happens if every key passed, so a
 * request carrying one good key and one typo leaves the good key unapplied.
 * Half-applying a rejected request is worse than refusing it, because the
 * caller is told it failed and half of it happened anyway.
 */
export const PUT = tenantRoute("erp:settings:write", async ({ db, req, session }) => {
  const { clean, errors } = validateSettings(await req.json().catch(() => ({})));
  if (errors.length) {
    return apiError(422, "INVALID_SETTINGS", errors[0], { details: errors });
  }

  // Checked against the MERGED result, not the submitted keys: sending
  // workHoursStart alone is only invalid in combination with what is stored.
  const merged = { ...(await readSettings(db)), ...clean };
  const crossField = crossFieldError(merged);
  if (crossField) {
    return apiError(422, "INVALID_SETTINGS", crossField, { details: [crossField] });
  }

  const tenantId = session.auth!.tenantId;
  const updated = await writeSettings(db, tenantId, clean);

  await db.auditEvent.create({
    data: {
      tenantId,
      userId: session.user.id,
      product: ERP_PRODUCT,
      entity: "settings",
      entityId: "settings",
      action: "update",
      // The KEYS, never the values. A settings change is worth an audit trail;
      // copying the values into it would duplicate configuration into an
      // append-only table that can never be corrected.
      payload: { keys: Object.keys(clean) },
    },
  });

  return apiOk(updated);
});
