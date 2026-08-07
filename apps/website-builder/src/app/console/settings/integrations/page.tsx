import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";
import { getLocale } from "next-intl/server";

import { requireConsoleSession } from "@/lib/console/session";
import { getTranslations } from "next-intl/server";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";

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

  const [webhooks, pixels] = await withTenant(session.auth.tenantId, async (db) => [
    await (db as any).webhookEndpoint.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { deliveries: true } } },
    }),
    await (db as any).metaPixelConfig.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <ConsoleShell session={session} productId={null}>
      <PageBody>
      <PageHeader title={t("settings.integrations")} />
      <p className="mt-1 text-sm text-muted-foreground">
        {mayManage
          ? "Push your events to your own tools."
          : "Read-only. Changing an integration needs administrator access."}
      </p>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Webhooks
      </h2>
      <DataTable
        testId="webhooks-table"
        empty="No webhook endpoints yet."
        rows={webhooks}
        rowKey={(w: any) => w.id}
        rowAttrs={(w: any) => ({ "data-webhook-id": w.id })}
        columns={[
          {
            id: "label",
            header: "Endpoint",
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
            header: "Events",
            cell: (w: any) => (
              <span className="text-muted-foreground">
                {Array.isArray(w.events) && w.events.length ? w.events.join(", ") : "—"}
              </span>
            ),
          },
          {
            id: "deliveries",
            header: "Deliveries",
            numeric: true,
            cell: (w: any) => w._count.deliveries,
          },
          {
            id: "state",
            header: "Status",
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
                {w.isActive ? "Active" : "Paused"}
              </span>
            ),
          },
        ]}
      />

      <h2 className="mt-10 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Meta pixels
      </h2>
      <DataTable
        testId="pixels-table"
        empty="No pixels connected yet."
        rows={pixels}
        rowKey={(p: any) => p.id}
        rowAttrs={(p: any) => ({ "data-pixel-id": p.id })}
        columns={[
          {
            id: "label",
            header: "Pixel",
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
            header: "Access token",
            // Never the value. Only that one exists.
            cell: () => <span className="text-muted-foreground">{t("settings.set")}</span>,
          },
          {
            id: "added",
            header: "Added",
            cell: (p: any) => (
              <span className="text-xs text-muted-foreground">
                {formatDate(p.createdAt, locale)}
              </span>
            ),
          },
          {
            id: "state",
            header: "Status",
            cell: (p: any) => (
              <span data-active={String(p.isActive)} className="text-xs text-muted-foreground">
                {p.isActive ? "Active" : "Paused"}
              </span>
            ),
          },
        ]}
      />
      </PageBody>
    </ConsoleShell>
  );
}
