import { withTenant } from "@landingos/db";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable } from "@/components/console/data-table";

export const dynamic = "force-dynamic";

/**
 * Delivery companies.
 *
 * NO CREDENTIAL IS SELECTED. Not masked afterwards — not loaded at all. A key
 * that never leaves the database cannot be leaked by a logger, by a spread, or
 * by a field somebody adds to this table in a year, and these keys book real
 * parcels at the tenant's expense.
 *
 * What the screen shows instead is whether credentials EXIST, which is the
 * thing a person actually needs to know: an empty field and a hidden field look
 * identical otherwise.
 */
export default async function ErpCarriersScreen() {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/carriers");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const carriers = await withTenant(session.auth!.tenantId, (db) =>
    db.carrier.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: {
        id: true, name: true, code: true, adapter: true,
        isDefault: true, active: true, apiEnabled: true,
        lastTestAt: true, lastTestOk: true,
        // Booleans derived in SQL rather than the values themselves.
        apiKey: false, secretKey: false, webhookSecret: false,
        _count: { select: { shipments: true, statusMappings: true } },
      },
    }),
  );

  // Whether a credential exists is asked separately, so the value never enters
  // this process at all.
  const configured = await withTenant(session.auth!.tenantId, async (db) => {
    const rows = await db.carrier.findMany({
      where: { OR: [{ apiKey: { not: null } }, { secretKey: { not: null } }] },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  });

  return (
    <ConsoleShell session={session} productId="erp">
      <h1 className="text-xl font-semibold">{t("erp.carriers.title")}</h1>

      <DataTable
        testId="erp-carriers-table"
        empty={t("erp.carriers.none")}
        rows={carriers}
        rowKey={(c) => c.id}
        rowAttrs={(c) => ({ "data-carrier-id": c.id })}
        columns={[
          {
            id: "carrier",
            header: t("erp.carriers.title"),
            cell: (c) => (
              <>
                <span className="font-medium">{c.name}</span>
                {c.isDefault && (
                  <span
                    data-testid="carrier-default"
                    className="ms-2 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {t("erp.carriers.default")}
                  </span>
                )}
                {!c.active && (
                  <span className="ms-2 text-xs text-muted-foreground">
                    {t("erp.carriers.inactive")}
                  </span>
                )}
              </>
            ),
          },
          {
            id: "code",
            header: t("erp.carriers.code"),
            cell: (c) => (
              <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                {c.code ?? "—"}
              </span>
            ),
          },
          {
            id: "adapter",
            header: t("erp.carriers.adapter"),
            cell: (c) => <span className="text-muted-foreground">{c.adapter ?? "—"}</span>,
          },
          {
            id: "credentials",
            header: t("erp.carriers.credentials"),
            cell: (c) => (
              <span className="text-muted-foreground" data-configured={configured.has(c.id)}>
                {configured.has(c.id)
                  ? t("erp.carriers.credentials")
                  : t("erp.carriers.noCredentials")}
              </span>
            ),
          },
          {
            id: "shipments",
            header: t("erp.shipments.title"),
            numeric: true,
            align: "end",
            cell: (c) => c._count.shipments,
          },
          {
            id: "tested",
            header: t("erp.shipments.updated"),
            cell: (c) => (
              <span className="text-muted-foreground">
                {c.lastTestAt ? formatDate(c.lastTestAt, locale) : "—"}
              </span>
            ),
          },
        ]}
      />
    </ConsoleShell>
  );
}
