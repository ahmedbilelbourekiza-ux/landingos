import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { ensureRenderDomain } from "@/lib/platform/render-domains";

export const dynamic = "force-dynamic";
type Params = { id: string };

/* Delete and set-primary for a linked domain — B5. Both operate through the
 * tenant binding, so another tenant's id matches nothing and answers 404. */

export const DELETE = tenantRoute<Params>("platform:domains:manage", async ({ db, params }) => {
  const { count } = await (db as any).tenantDomain.deleteMany({ where: { id: params.id } });
  if (count === 0) return apiError(404, "NOT_FOUND", "That domain is not linked here.");
  return apiOk({ id: params.id });
});

export const PATCH = tenantRoute<Params>("platform:domains:manage", async ({ db, params, session, afterCommit }) => {
  const row = await (db as any).tenantDomain.findUnique({
    where: { id: params.id },
    select: { id: true, domain: true, verifiedAt: true },
  });
  if (!row) return apiError(404, "NOT_FOUND", "That domain is not linked here.");
  // Primary means "the hostname canonical links use" — an unverified one
  // serves nothing, so making it canonical would be nonsense.
  if (!row.verifiedAt) {
    return apiError(422, "NOT_VERIFIED", "Verify the domain before making it primary.");
  }

  // One primary per tenant; the binding scopes the sweep to this tenant.
  await (db as any).tenantDomain.updateMany({ data: { isPrimary: false }, where: {} });
  await (db as any).tenantDomain.updateMany({ where: { id: params.id }, data: { isPrimary: true } });

  /* LB.14c option (b) — VERIFIED (checked above) + now PRIMARY: the hosting
   * automation's transition. Post-commit; silent when unconfigured. */
  const tenantId = session.auth!.tenantId;
  afterCommit(async () => {
    await ensureRenderDomain(tenantId, { id: row.id, domain: row.domain });
  });

  return apiOk({ id: params.id, isPrimary: true });
});
