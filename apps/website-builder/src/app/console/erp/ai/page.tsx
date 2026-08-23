import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { aiStrings } from "@/lib/console/erp-strings";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import { AgentCreatePanel, AgentRowActions } from "@/components/console/erp/ai-write";
import { ALL_AI_PERMISSIONS, ceilingFor } from "@/lib/erp/ai";
import { readAiUsage } from "@/lib/erp/ai-quota";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The AI screen — LP.17, restoring R10 and closing a LIVE 404.
 *
 * `packages/product-registry` ships an `ai` nav item for the ERP and no screen
 * existed at `/console/erp/ai`. Every user holding `erp:ai:use` — which is every
 * member, by role glob — saw a menu item that led to a 404. `screens.test.ts`
 * listed eight screens and omitted this one, so nothing caught it.
 *
 * WHAT IT HONESTLY OFFERS, which is not everything the legacy's screen does.
 *
 * The INSIGHTS half is real and works with no provider configured at all,
 * because it is counts rather than generation — the same figures
 * `GET /api/erp/ai/insights` returns, read here directly.
 *
 * The CHAT half is stated as unavailable rather than rendered as a box that
 * fails on submit. `POST /api/erp/ai/chat` answers **501 by design**: calling a
 * model needs a configured provider, a real key and an adapter layer, which is
 * deployment configuration rather than a port. A chat box that always errors is
 * worse than a sentence saying so — it is the same class of lie as the
 * fabricated tracking numbers D-LP.2 removed.
 *
 * TWO PERMISSIONS, TWO HALVES. Reading insights is `erp:ai:use`. Configuring
 * ASSISTANTS is `erp:settings:write`. The page checks both itself rather than
 * trusting the nav.
 *
 * NO PROVIDER CONFIGURATION, since PF.1: the model credential is the
 * OPERATOR's, one PlatformCredential row for the whole platform
 * (`lib/platform/platform-ai.ts`), installed by an attended script and never
 * by any tenant surface. The per-tenant provider panel and its five routes
 * are gone — a tenant neither sees nor supplies an AI key. The quota panel
 * stays: the ALLOWANCE is still per tenant (AQ.1) even though the credential
 * is not.
 * ========================================================================== */

const AGENT_ROLES = [
  "general", "manager", "sales", "confirmation", "delivery", "analytics", "support",
] as const;

export default async function ErpAiScreen() {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/ai");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  // The permission the AI routes check. Held by every member via the role glob,
  // but checked rather than assumed — an explicit grant can be revoked.
  if (!session.auth || !can(session.auth, "erp:ai:use")) notFound();

  const mayConfigure = can(session.auth, "erp:settings:write");
  const ceiling = ceilingFor(session);

  const { insights, agents, usage } = await withTenant(session.auth.tenantId, async (db) => {
    // The same three counts `GET /api/erp/ai/insights` returns, and the same
    // rule about the money line: absent rather than zero when the caller may not
    // see it, because a zero is a lie that reads like a fact.
    const [orders, pending, delivered, revenue] = await Promise.all([
      db.fulfillmentOrder.count(),
      db.fulfillmentOrder.count({ where: { status: "pending" } }),
      db.fulfillmentOrder.count({ where: { deliveryOutcome: "delivered" } }),
      ceiling.includes("read_analytics")
        ? db.fulfillmentOrder.aggregate({
            where: { deliveryOutcome: "delivered" },
            _sum: { price: true },
          })
        : null,
    ]);

    return {
      insights: { orders, pending, delivered, revenue },
      // AQ.1 — the same numbers the spend gate reads. Visible to every
      // `erp:ai:use` holder: an allowance you cannot see is one you discover
      // by being refused.
      usage: await readAiUsage(db),
      agents: mayConfigure
        ? await db.aiAgent.findMany({
            orderBy: { createdAt: "desc" },
            select: {
              id: true, name: true, description: true, role: true,
              providerId: true, enabled: true, permissions: true,
            },
          })
        : [],
    };
  });

  const errors = actionErrors(t);
  const s = aiStrings(t);
  const currency = session.tenant!.currency;

  const tiles = [
    { id: "orders", label: t("erp.analytics.orders"), value: String(insights.orders) },
    { id: "pending", label: t("erp.overview.pending"), value: String(insights.pending) },
    { id: "delivered", label: t("erp.overview.delivered"), value: String(insights.delivered) },
    ...(insights.revenue
      ? [{
          id: "delivered-value",
          label: t("erp.analytics.confirmedValue"),
          value: formatMoney((insights.revenue._sum.price ?? 0).toString(), locale, currency),
        }]
      : []),
  ];

  return (
    <>
      <PageBody>
      <PageHeader title={t("erp.ai.title")} description={t("erp.ai.subtitle")} />

      <h2 className="mt-6 text-sm font-semibold tracking-tight">{t("erp.ai.insights")}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="ai-insights">
        {tiles.map((tile) => (
          <div key={tile.id} data-tile={tile.id} className="rounded-lg border border-border bg-surface-raised p-4">
            <span className="block text-xs text-muted-foreground">{tile.label}</span>
            <span className="mt-1 block text-2xl font-semibold tabular-nums" dir="ltr">{tile.value}</span>
          </div>
        ))}
      </div>

      {/* AQ.1 — the month's AI spend, the same numbers the quota gate
          enforces. Counts only; no key, no cost figure the platform cannot
          honestly know. */}
      <section className="mt-6 rounded-lg border border-border bg-surface-raised p-4" data-testid="ai-usage">
        <h2 className="text-sm font-semibold tracking-tight">{t("erp.ai.usageTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground" dir="auto">
          {t("erp.ai.usageLine", { used: usage.used, limit: usage.limit, failed: usage.failed })}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("erp.ai.usageResets", { date: formatDate(usage.resetsAt, locale) })}
        </p>
      </section>

      {/* The absence, stated on the page rather than discovered by pressing a
          button. `ai/chat` and `ai/insights/deep` answer 501 by design. */}
      <section
        className="mt-6 rounded-lg border border-dashed border-border p-4"
        data-testid="ai-chat-unavailable"
      >
        <h2 className="text-sm font-semibold tracking-tight">{t("erp.ai.chat")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("erp.ai.chatUnavailable")}</p>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="ai-ceiling">
          {t("erp.ai.yourCeiling")}: {ceiling.length ? ceiling.join(", ") : t("common.empty")}
        </p>
      </section>

      {mayConfigure && (
        <>
          <h2 className="mt-8 text-sm font-semibold tracking-tight">{t("erp.ai.agents")}</h2>
          <AgentCreatePanel
            errors={errors}
            s={s}
            // The route's own vocabulary, so a permission it would refuse cannot
            // be offered and one it accepts cannot go missing.
            permissions={ALL_AI_PERMISSIONS.map((p) => ({ value: p, label: t(`erp.ai.perm.${p}`) }))}
            roles={AGENT_ROLES}
          />

          <DataTable
            testId="ai-agents-table"
            empty={t("erp.ai.noAgents")}
            rows={agents}
            rowKey={(a) => a.id}
            rowAttrs={(a) => ({ "data-agent-id": a.id })}
            columns={[
              {
                id: "name",
                header: t("erp.ai.agent"),
                cell: (a) => (
                  <>
                    <span className="font-medium">{a.name}</span>
                    {a.description && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">{a.description}</span>
                    )}
                  </>
                ),
              },
              { id: "role", header: t("erp.ai.role"), cell: (a) => a.role ?? "—" },
              {
                id: "permissions",
                header: t("erp.ai.permissions"),
                cell: (a) => (
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {Array.isArray(a.permissions) && a.permissions.length
                      ? (a.permissions as string[]).join(", ")
                      : t("erp.ai.allAllowed")}
                  </span>
                ),
              },
              {
                id: "enabled",
                header: t("erp.ai.enabled"),
                cell: (a) => (a.enabled ? "✓" : "—"),
              },
              {
                id: "actions", header: "", align: "end" as const,
                cell: (a) => (
                  <AgentRowActions agentId={a.id} enabled={a.enabled} errors={errors} s={s} />
                ),
              },
            ]}
          />
        </>
      )}
      </PageBody>
    </>
  );
}
