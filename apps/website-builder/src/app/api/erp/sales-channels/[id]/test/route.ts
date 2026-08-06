import { withTenant } from "@landingos/db";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { getChannelAdapter } from "@/lib/erp/channel-adapters";
import { logIntegration } from "@/lib/erp/integration-log";

export const dynamic = "force-dynamic";

type Params = { id: string };

/* =============================================================================
 * Does this storefront connection actually work? — LP.15, restoring R8.
 *
 * `SalesChannel.lastTestAt` has existed since Phase 3.2 and had no writer, the
 * same shape of defect LP.14 found on `Carrier`. A tenant pasting a Shopify
 * access token had no way to find out whether it worked except by waiting for an
 * order that never arrived.
 *
 * -----------------------------------------------------------------------------
 * D-LP.5.1 APPLIES: THE CALL IS OUTSIDE THE TRANSACTION.
 *
 * `withTenant` opens an interactive transaction with a 15-second timeout and
 * this is a round trip to somebody else's server. Plan in the transaction, call
 * in none, record in a fresh one — through the same `afterCommit` the carrier
 * test uses.
 *
 * A STRUCTURAL RESULT SAYS SO, AND IS NOT A REFUSAL.
 *
 * Seven of the nine offered platforms have no adapter, and refusing them would
 * mean a tenant on JustSell cannot connect a store at all — which is the
 * opposite of what D-LP.2 protects. A channel adapter cannot INVENT anything (a
 * carrier one can invent a tracking number), so the fallback is safe. What is
 * not safe is a green tick meaning "we did not look", so `structural: true` is
 * in the response and the sentence is in the message.
 * ========================================================================== */

export const POST = tenantRoute<Params>("erp:settings:write", async ({ db, session, params, afterCommit }) => {
  const channel = await db.salesChannel.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, platform: true, apiEnabled: true,
      apiUrl: true, apiKey: true, apiSecret: true, webhookSecret: true,
    },
  });
  // 404 for another tenant's channel — confirming a row exists elsewhere is
  // itself information.
  if (!channel) return apiError(404, "NOT_FOUND", "No such sales channel.");

  const tenantId = session.auth!.tenantId;
  const adapter = getChannelAdapter(channel.platform);
  const cfg = {
    apiUrl: channel.apiUrl,
    apiKey: channel.apiKey,
    apiSecret: channel.apiSecret,
    webhookSecret: channel.webhookSecret,
  };

  afterCommit(async () => {
    let ok = false;
    let message = "";
    let structural = false;

    if (adapter?.testConnection) {
      try {
        const result = await adapter.testConnection(cfg);
        ok = result.ok;
        message = result.message;
      } catch (error) {
        ok = false;
        message = error instanceof Error ? error.message : String(error);
      }
    } else {
      structural = true;
      // "Enough configuration to be usable" — the legacy's own rule. A channel
      // that only ever RECEIVES webhooks needs no API credentials at all, which
      // is why a webhook secret alone counts.
      ok = Boolean(cfg.apiUrl || cfg.apiKey || cfg.apiSecret || cfg.webhookSecret);
      message = ok
        ? `${channel.platform ?? "This platform"} has no live integration on this deployment — the configuration is complete, but nothing was contacted.`
        : "No API URL, no credentials and no webhook secret are configured, so nothing could be contacted.";
    }

    const testedAt = new Date();
    await withTenant(tenantId, async (tx) => {
      await tx.salesChannel.update({ where: { id: params.id }, data: { lastTestAt: testedAt } });
      await logIntegration(tx, tenantId, {
        entity: "salesChannel",
        entityId: params.id,
        event: ok ? "test_connection" : "auth_error",
        result: ok ? "success" : "failure",
        message,
        // The URL and the platform, never a credential — `redact` enforces it.
        request: { url: cfg.apiUrl, platform: channel.platform, method: "test" },
        response: { ok, structural },
      });
    });

    return apiOk({
      ok,
      structural,
      message,
      platform: channel.platform,
      registered: Boolean(adapter),
      apiEnabled: channel.apiEnabled,
      testedAt: testedAt.toISOString(),
    });
  });

  // Replaced by `afterCommit`. Returned so the handler has a value either way,
  // and a test whose outcome is unknown must not read as one that passed.
  return apiError(502, "UNREACHABLE", "The platform could not be reached.");
});
