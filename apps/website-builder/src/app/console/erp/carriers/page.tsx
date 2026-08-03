import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { DELIVERY_STATUS } from "@landingos/ui";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { carrierStrings } from "@/lib/console/erp-strings";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable } from "@/components/console/data-table";
import { CarrierCreatePanel, CarrierRowActions } from "@/components/console/erp/carrier-write";
import { listAdapters } from "@/lib/erp/carriers";

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

  /* Phase 6.3d found a gap here.
   *
   * `erp:shipments:write` gates EVERY carrier route, including the GET — the
   * whole surface is manager-only, because a carrier record is delivery
   * configuration. The nav has always hidden this item without it. The PAGE did
   * not check, and it reads the database directly rather than through the API,
   * so an agent who typed the URL got a full list of carrier names, codes,
   * adapters and which ones hold credentials — configuration they have no route
   * to read.
   *
   * Same reasoning as the three screens gated in 6.2: a nav item is a hint, the
   * URL is typeable, and the gate belongs on the page. 404 rather than 403,
   * matching the API and the shell.
   */
  if (!session.auth || !can(session.auth, "erp:shipments:write")) notFound();

  // The taught wording, per carrier. Everyone who reaches this page may edit it,
  // so there is no narrower gate below — the check above is the whole of it.
  const mappings = await withTenant(session.auth.tenantId, async (db) => {
    const rows = await db.carrierStatusMapping.findMany({
      orderBy: { originalStatus: "asc" },
      select: { id: true, carrierId: true, originalStatus: true, crmStatus: true },
    });
    const byCarrier = new Map<string, { id: string; originalStatus: string; crmStatus: string }[]>();
    for (const row of rows) {
      const list = byCarrier.get(row.carrierId) ?? [];
      // `crmStatus` is nullable in the schema. A mapping that points at nothing
      // is a row the picker cannot represent, so it renders as the empty value
      // rather than as `null` reaching a select.
      list.push({
        id: String(row.id),
        originalStatus: row.originalStatus,
        crmStatus: row.crmStatus ?? "",
      });
      byCarrier.set(row.carrierId, list);
    }
    return byCarrier;
  });

  const errors = actionErrors(t);
  const s = carrierStrings(t);

  // The CRM side of a mapping has a fixed vocabulary — the delivery registry —
  // so the picker offers exactly those and nothing else can be written.
  const crmStatuses = Object.entries(DELIVERY_STATUS).map(([value, d]) => ({
    value,
    label: t(d.labelKey),
  }));

  const adapters = listAdapters().map((a) => ({ value: a.key, label: a.label }));

  return (
    <ConsoleShell session={session} productId="erp">
      <h1 className="text-xl font-semibold">{t("erp.carriers.title")}</h1>

      <CarrierCreatePanel errors={errors} s={s} adapters={adapters} />

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
          {
            id: "actions",
            header: "",
            align: "end" as const,
            cell: (c) => (
              <CarrierRowActions
                // Keyed on what the server holds, so a save remounts the panel
                // on the stored answer rather than on what was typed.
                key={`${c.isDefault}/${c.active}/${configured.has(c.id)}`}
                carrierId={c.id}
                isDefault={Boolean(c.isDefault)}
                active={c.active !== false}
                // Whether, never what. The value is still not selected.
                hasCredentials={configured.has(c.id)}
                mappings={mappings.get(c.id) ?? []}
                crmStatuses={crmStatuses}
                errors={errors}
                s={s}
              />
            ),
          },
        ]}
      />
    </ConsoleShell>
  );
}
