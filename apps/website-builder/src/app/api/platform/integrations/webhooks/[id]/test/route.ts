import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { sendTestDelivery } from "@/lib/webhooks/deliver";

export const dynamic = "force-dynamic";
type Params = { id: string };

/**
 * Send a signed test event to one endpoint and report what came back.
 *
 * The call happens in `afterCommit` — outside the tenant transaction — because
 * it is a request to somebody else's server and D-LP.5.1 applies: a receiver
 * that takes nine seconds to answer must not hold a database transaction open
 * for nine seconds. The response is replaced with the real result, because the
 * operator pressing the button is owed the answer, not an acknowledgement.
 */
export const POST = tenantRoute<Params>("platform:integrations:manage", async ({ db, params, session, afterCommit }) => {
  const endpoint = await (db as any).webhookEndpoint.findUnique({
    where: { id: params.id },
    select: { id: true, label: true, url: true, secret: true },
  });
  if (!endpoint) return apiError(404, "NOT_FOUND", "That endpoint does not exist.");

  const tenantId = session.auth!.tenantId;
  afterCommit(async () => {
    const result = await sendTestDelivery(tenantId, endpoint);
    return apiOk(result);
  });

  // Replaced by the afterCommit result above; kept as the fallback shape if
  // the deferred work itself throws (which is logged, never rethrown).
  return apiOk({ ok: false, statusCode: null, error: "Test did not run." });
});
