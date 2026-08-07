import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { channelStrings } from "@/lib/console/erp-strings";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import { ChannelCreatePanel, ChannelRowActions } from "@/components/console/erp/channel-write";
import { listChannelPlatforms, getChannelAdapter } from "@/lib/erp/channel-adapters";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Connected storefronts — LP.15, restoring R8.
 *
 * The channel API has had full CRUD since Phase 5.3c and there was **no screen
 * and no nav item**. A tenant could not connect a Shopify store through the
 * console at all: the routes existed and nothing in the product reached them,
 * and the webhook URL — generated once on create — was never shown again by
 * anything, so even a channel created by hand through the API was unusable.
 *
 * WHAT THIS SCREEN IS FOR, in one line: producing the webhook URL and telling
 * an operator whether orders are actually arriving through it.
 *
 * NO CREDENTIAL IS SELECTED. Not masked afterwards — not loaded. That is the
 * carriers screen's rule and it applies with more force here, because
 * `webhookSecret` is what proves an inbound payload really came from the
 * platform: anyone holding it can forge orders into this tenant's book. What is
 * shown instead is whether credentials EXIST, which is what a person needs to
 * know — an empty field and a hidden field look identical otherwise.
 *
 * Gated on `erp:settings:write`, which is what every channel route checks. The
 * page reads the database directly rather than through the API, so the gate
 * belongs here too — 6.3d found exactly this hole on the carriers page. A nav
 * item is a hint; the URL is typeable.
 * ========================================================================== */

export default async function ErpChannelsScreen() {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/sales-channels");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  if (!session.auth || !can(session.auth, "erp:settings:write")) notFound();

  const { channels, configured, orderCounts } = await withTenant(session.auth.tenantId, async (db) => {
    const channels = await db.salesChannel.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, name: true, platform: true, brand: true,
        apiUrl: true, webhookEndpoint: true,
        apiEnabled: true, webhookEnabled: true, active: true,
        lastTestAt: true, createdAt: true,
        // Never the values.
        apiKey: false, apiSecret: false, webhookSecret: false,
      },
    });

    // Asked separately, so no secret enters this process at all.
    const withSecret = await db.salesChannel.findMany({
      where: {
        OR: [{ apiKey: { not: null } }, { apiSecret: { not: null } }, { webhookSecret: { not: null } }],
      },
      select: { id: true },
    });

    // How many orders have actually arrived through each channel — the number
    // that answers "is this connection working", which is what somebody opens
    // this screen to find out.
    const counts = await db.fulfillmentOrder.groupBy({
      by: ["salesChannelId"],
      _count: { _all: true },
    });

    return {
      channels,
      configured: new Set(withSecret.map((c) => c.id)),
      orderCounts: new Map(counts.map((c) => [c.salesChannelId ?? "", c._count._all])),
    };
  });

  const platforms = listChannelPlatforms();
  const s = channelStrings(t);
  const errors = actionErrors(t);

  return (
    <ConsoleShell session={session} productId="erp">
      <PageBody>
      <PageHeader title={t("erp.channels.title")} />

      <ChannelCreatePanel
        errors={errors}
        s={s}
        platforms={platforms.map((p) => ({
          value: p.key,
          label: p.label,
          registered: p.registered,
        }))}
      />

      <DataTable
        testId="erp-channels-table"
        empty={t("erp.channels.none")}
        rows={channels}
        rowKey={(c) => c.id}
        rowAttrs={(c) => ({ "data-channel-id": c.id, "data-flash-id": c.id })}
        columns={[
          {
            id: "name",
            header: t("erp.channels.title"),
            cell: (c) => (
              <div className="min-w-[10rem]">
                <span className="font-medium">{c.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {[c.platform, c.brand].filter(Boolean).join(" · ") || "—"}
                </span>
                {/* Said on the row, because it changes what "tested" means and
                    what the inbound parser will do with a payload. */}
                {c.platform && !getChannelAdapter(c.platform) && (
                  <span
                    data-badge="no-adapter"
                    className="mt-1 inline-block rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {s.noAdapter}
                  </span>
                )}
              </div>
            ),
          },
          {
            id: "webhook",
            header: t("erp.channels.webhookUrl"),
            /* THE PRODUCT OF THIS SCREEN. Never truncated: a URL shortened with
               an ellipsis and then copied is a URL that silently does not work,
               and this one is pasted into somebody else's admin panel. */
            cell: (c) => (
              <code
                data-testid="channel-webhook-url"
                dir="ltr"
                className="block break-all text-xs text-muted-foreground"
              >
                {c.webhookEndpoint ?? "—"}
              </code>
            ),
          },
          {
            id: "credentials",
            header: t("erp.channels.credentials"),
            cell: (c) => (
              <span
                data-configured={configured.has(c.id) ? "true" : "false"}
                className="text-xs text-muted-foreground"
              >
                {configured.has(c.id) ? s.maskKeeps : "—"}
              </span>
            ),
          },
          {
            id: "orders",
            header: t("erp.channels.ordersReceived"),
            numeric: true,
            align: "end",
            cell: (c) => orderCounts.get(c.id) ?? 0,
          },
          {
            id: "tested",
            header: t("erp.carriers.lastTest"),
            cell: (c) => (
              <span className="text-xs text-muted-foreground">
                {c.lastTestAt ? formatDate(c.lastTestAt, locale) : t("erp.carriers.neverTested")}
              </span>
            ),
          },
          {
            id: "state",
            header: t("erp.orders.status"),
            cell: (c) => (
              <span data-active={c.active ? "true" : "false"} className="text-xs">
                {c.active ? t("erp.write.activate") : t("erp.write.deactivate")}
              </span>
            ),
          },
          {
            id: "actions",
            header: t("erp.row.quickActions"),
            cell: (c) => (
              <ChannelRowActions
                channel={{
                  id: c.id,
                  active: c.active,
                  platform: c.platform,
                  webhookEndpoint: c.webhookEndpoint,
                  registered: Boolean(getChannelAdapter(c.platform)),
                }}
                errors={errors}
                s={s}
              />
            ),
          },
        ]}
      />

      <p className="mt-4 text-xs text-muted-foreground">{s.webhookHint}</p>
      </PageBody>
    </ConsoleShell>
  );
}
