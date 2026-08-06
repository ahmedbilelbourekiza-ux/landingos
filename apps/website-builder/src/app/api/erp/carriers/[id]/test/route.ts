import { withTenant } from "@landingos/db";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { getAdapter } from "@/lib/erp/carriers";
import { logIntegration } from "@/lib/erp/integration-log";

export const dynamic = "force-dynamic";

type Params = { id: string };

/* =============================================================================
 * Does this carrier integration actually work? — LP.14, restoring R3.
 *
 * `Carrier.lastTestAt` and `lastTestOk` are RENDERED BY THE CARRIERS SCREEN and
 * were **written by nothing**, so every carrier has shown "never tested"
 * forever. An operator configuring ZR Express had no way to find out whether the
 * key worked except by confirming a real order and watching whether a parcel
 * appeared.
 *
 * -----------------------------------------------------------------------------
 * D-LP.5.1 APPLIES HERE TOO: THE CALL IS OUTSIDE THE TRANSACTION
 *
 * `withTenant` opens an interactive transaction with a 15-second timeout, and
 * this is a round trip to somebody else's server. So: **plan** in the
 * transaction (read the config), **call** in none, **record** in a fresh one —
 * the same three phases booking uses, through the same `afterCommit`.
 *
 * -----------------------------------------------------------------------------
 * A STRUCTURAL RESULT SAYS SO IN ITS OWN MESSAGE
 *
 * An adapter with no `testConnection` has nothing to ask, and the honest answer
 * is "the configuration is complete, nobody was contacted". Reporting a plain
 * success would be a green tick meaning "we did not look", which is the same
 * defect as the fabricated tracking numbers D-LP.2 removed — on the screen an
 * operator checks BEFORE trusting the integration. `structural: true` is in the
 * response and the sentence is in the message.
 * ========================================================================== */

export const POST = tenantRoute<Params>("erp:shipments:write", async ({ db, session, params, afterCommit }) => {
  const carrier = await db.carrier.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, adapter: true, apiEnabled: true,
      apiUrl: true, apiKey: true, secretKey: true, webhookSecret: true,
    },
  });
  if (!carrier) return apiError(404, "NOT_FOUND", "No such carrier.");

  // Refused, never mocked — the LP.2 rule. A row can hold a key nothing is
  // registered under, and reporting that as a passing test would be worse than
  // the missing feature.
  const adapter = getAdapter(carrier.adapter);
  if (!adapter) {
    return apiError(
      422,
      "UNKNOWN_ADAPTER",
      "This carrier is configured with an integration this deployment does not have.",
    );
  }

  const tenantId = session.auth!.tenantId;
  const cfg = {
    apiUrl: carrier.apiUrl,
    apiKey: carrier.apiKey,
    secretKey: carrier.secretKey,
    webhookSecret: carrier.webhookSecret,
  };

  afterCommit(async () => {
    let ok = false;
    let message = "";
    let structural = false;

    if (adapter.testConnection) {
      try {
        const result = await adapter.testConnection(cfg);
        ok = result.ok;
        message = result.message;
      } catch (error) {
        ok = false;
        message = error instanceof Error ? error.message : String(error);
      }
    } else {
      // Structural only: enough configuration to be usable. Stated as such.
      structural = true;
      ok = Boolean(cfg.apiUrl || cfg.apiKey || cfg.secretKey || !adapter.canCreateOutbound);
      message = ok
        ? `${adapter.label} has no live test on this deployment — the configuration is complete, but nothing was contacted.`
        : "No API URL and no credentials are configured, so nothing could be contacted.";
    }

    const testedAt = new Date();
    await withTenant(tenantId, async (tx) => {
      await tx.carrier.update({
        where: { id: params.id },
        data: { lastTestAt: testedAt, lastTestOk: ok },
      });
      await logIntegration(tx, tenantId, {
        entity: "carrier",
        entityId: params.id,
        event: ok ? "test_connection" : "auth_error",
        result: ok ? "success" : "failure",
        message,
        // The URL and the method, never the key — `redact` enforces it anyway.
        request: { url: cfg.apiUrl, adapter: adapter.key, method: "test" },
        response: { ok, structural },
      });
    });

    return apiOk({
      ok,
      structural,
      message,
      adapter: adapter.key,
      apiEnabled: carrier.apiEnabled,
      testedAt: testedAt.toISOString(),
    });
  });

  // Replaced by `afterCommit`. Returned so the handler has a value either way.
  return apiOk({ ok: false, message: "" });
});
