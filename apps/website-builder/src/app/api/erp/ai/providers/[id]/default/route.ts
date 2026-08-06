import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Make one provider the default — LP.17.
 *
 * EXACTLY ONE, and it is cleared before it is set rather than after. The same
 * shape `POST /carriers/[id]/default` uses, and for the same reason: two rows
 * flagged default is a state no reader can resolve, and every reader would then
 * need its own tie-break rule. Both statements run on the client `withTenant`
 * already opened, so they are atomic together — there is no window in which the
 * company has no default at all.
 */
export const POST = tenantRoute<Params>("erp:settings:write", async ({ db, params }) => {
  const existing = await db.aiProvider.findUnique({
    where: { id: params.id },
    select: { id: true, active: true },
  });
  if (!existing) return apiError(404, "NOT_FOUND", "No such provider.");
  if (!existing.active) {
    // A deactivated default is a default nothing would use, and the refusal
    // says which order to do it in rather than silently doing half.
    return apiError(422, "PROVIDER_INACTIVE", "Reactivate this provider before making it the default.");
  }

  await db.aiProvider.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  await db.aiProvider.update({ where: { id: params.id }, data: { isDefault: true } });

  return apiOk({ id: params.id, isDefault: true });
});
