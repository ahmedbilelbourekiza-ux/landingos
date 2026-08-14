import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";
import { getLocale } from "next-intl/server";

import { requireConsoleSession } from "@/lib/console/session";
import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import { WebhookCreatePanel, WebhookRowActions } from "@/components/console/platform/webhook-write";
import { TrackingCreatePanel, TrackingRowActions } from "@/components/console/platform/tracking-write";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS } from "@/lib/webhooks/events";
import { trackingProvider } from "@/lib/tracking/config";
import { actionErrors } from "@/lib/console/action-errors";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Integrations — outgoing webhooks and Meta pixels.
 *
 * A PLATFORM screen. Under S-10 the webhook machinery stopped being private
 * plumbing between the builder and the ERP and became the tenant-facing
 * integration feature, so it belongs to the workspace rather than to a product.
 * A tenant running ten products configures this once.
 *
 * Secrets are never rendered. The list shows that one is set and when it was
 * created; the value itself is write-only and lives only in the signing code.
 * ========================================================================== */

export default async function IntegrationsPage() {
  const t = await getTranslations();
  const session = await requireConsoleSession("/console/settings/integrations");
  if (!session.auth || !can(session.auth, "platform:integrations:read")) notFound();

  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const mayManage = can(session.auth, "platform:integrations:manage");
  const errors = actionErrors(t);
  // The event vocabulary the delivery layer filters on, offered as-is — a
  // second list here would go stale the day an event is added (D-LP.3's rule).
  const eventOptions = WEBHOOK_EVENTS.map((value) => ({
    value,
    label: WEBHOOK_EVENT_LABELS[value],
  }));

  const [webhooks, pixels, tracking] = await withTenant(session.auth.tenantId, async (db) => [
    await (db as any).webhookEndpoint.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { deliveries: true } } },
    }),
    await (db as any).metaPixelConfig.findMany({ orderBy: { createdAt: "desc" } }),
    await (db as any).trackingIntegration.findMany({
      orderBy: [{ provider: "asc" }, { createdAt: "desc" }],
      // The list never carries the credential, only whether one is set.
      select: {
        id: true, provider: true, label: true, publicId: true, managedBy: true,
        isActive: true, serverToken: true, createdAt: true,
      },
    }),
  ]);

  return (
    <>
      <PageBody>
      <PageHeader title={t("settings.integrations")} />
      <p className="mt-1 text-sm text-muted-foreground">
        {mayManage
          ? t("settings.integrationsLead")
          : t("settings.integrationsReadOnly")}
      </p>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {t("settings.sectionTracking")}
      </h2>
      <DataTable
        testId="tracking-table"
        empty={t("settings.integrationsEmpty")}
        rows={tracking}
        rowKey={(x: any) => x.id}
        rowAttrs={(x: any) => ({ "data-tracking-id": x.id, "data-provider": x.provider })}
        columns={[
          {
            id: "label",
            header: t("settings.colIntegration"),
            cell: (x: any) => (
              <>
                <span className="font-medium">{x.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {trackingProvider(x.provider)?.name ?? x.provider}
                  {" · "}
                  <span className="font-mono" dir="ltr">{x.publicId}</span>
                </span>
              </>
            ),
          },
          {
            id: "server",
            header: t("settings.colServerEvents"),
            cell: (x: any) => (
              <span className="text-xs text-muted-foreground">
                {x.serverToken ? t("settings.credentialSet") : t("settings.browserOnly")}
              </span>
            ),
          },
          {
            id: "managed",
            header: t("settings.colManagedBy"),
            cell: (x: any) => (
              <span className="text-xs text-muted-foreground">
                {x.managedBy === "platform"
                  ? t("settings.managedByPlatform")
                  : t("settings.managedByCompany")}
              </span>
            ),
          },
          {
            id: "state",
            header: t("settings.colStatus"),
            cell: (x: any) => (
              <span data-active={String(x.isActive)} className="text-xs text-muted-foreground">
                {x.isActive ? t("settings.statusActive") : t("settings.statusPaused")}
              </span>
            ),
          },
          ...(mayManage
            ? [
                {
                  id: "actions",
                  header: "",
                  cell: (x: any) => (
                    <TrackingRowActions id={x.id} isActive={x.isActive} errors={errors} />
                  ),
                },
              ]
            : []),
        ]}
      />
      {mayManage && <TrackingCreatePanel errors={errors} />}

      <h2 className="mt-10 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {t("settings.sectionWebhooks")}
      </h2>
      <DataTable
        testId="webhooks-table"
        empty={t("settings.webhooksEmpty")}
        rows={webhooks}
        rowKey={(w: any) => w.id}
        rowAttrs={(w: any) => ({ "data-webhook-id": w.id })}
        columns={[
          {
            id: "label",
            header: t("settings.colEndpoint"),
            cell: (w: any) => (
              <>
                <span className="font-medium">{w.label}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground" dir="ltr">
                  {w.url}
                </span>
              </>
            ),
          },
          {
            id: "events",
            header: t("settings.colEvents"),
            cell: (w: any) => (
              <span className="text-muted-foreground">
                {Array.isArray(w.events) && w.events.length ? w.events.join(", ") : "—"}
              </span>
            ),
          },
          {
            id: "deliveries",
            header: t("settings.colDeliveries"),
            numeric: true,
            cell: (w: any) => w._count.deliveries,
          },
          {
            id: "state",
            header: t("settings.colStatus"),
            cell: (w: any) => (
              <span
                data-active={String(w.isActive)}
                className="inline-block rounded-full border px-2 py-0.5 text-xs"
                style={
                  w.isActive
                    ? {
                        color: "var(--success-fg)",
                        backgroundColor: "var(--success-bg)",
                        borderColor: "var(--success-border)",
                      }
                    : {
                        color: "var(--neutral-fg)",
                        backgroundColor: "var(--neutral-bg)",
                        borderColor: "var(--neutral-border)",
                      }
                }
              >
                {w.isActive ? t("settings.statusActive") : t("settings.statusPaused")}
              </span>
            ),
          },
          // The controls exist only where the API would accept them (D-06.2):
          // the manage permission is what POST/PATCH/DELETE check.
          ...(mayManage
            ? [
                {
                  id: "actions",
                  header: "",
                  cell: (w: any) => (
                    <WebhookRowActions id={w.id} isActive={w.isActive} errors={errors} />
                  ),
                },
              ]
            : []),
        ]}
      />
      {mayManage && <WebhookCreatePanel events={eventOptions} errors={errors} />}

      <h2 className="mt-10 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {t("settings.sectionPixelsLegacy")}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("settings.pixelsLegacyNote")}
      </p>
      <DataTable
        testId="pixels-table"
        empty={t("settings.pixelsEmpty")}
        rows={pixels}
        rowKey={(p: any) => p.id}
        rowAttrs={(p: any) => ({ "data-pixel-id": p.id })}
        columns={[
          {
            id: "label",
            header: t("settings.colPixel"),
            cell: (p: any) => (
              <>
                <span className="font-medium">{p.label}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground" dir="ltr">
                  {p.pixelId}
                </span>
              </>
            ),
          },
          {
            id: "token",
            header: t("settings.colAccessToken"),
            // Never the value. Only that one exists.
            cell: () => <span className="text-muted-foreground">{t("settings.set")}</span>,
          },
          {
            id: "added",
            header: t("settings.colAdded"),
            cell: (p: any) => (
              <span className="text-xs text-muted-foreground">
                {formatDate(p.createdAt, locale)}
              </span>
            ),
          },
          {
            id: "state",
            header: t("settings.colStatus"),
            cell: (p: any) => (
              <span data-active={String(p.isActive)} className="text-xs text-muted-foreground">
                {p.isActive ? t("settings.statusActive") : t("settings.statusPaused")}
              </span>
            ),
          },
        ]}
      />
      </PageBody>
    </>
  );
}
