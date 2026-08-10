import Link from "next/link";
import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { PageBody } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import { inventoryView } from "@/lib/erp/inventory";

export const dynamic = "force-dynamic";

/* =============================================================================
 * One catalogue product — the audit's finding.
 *
 * Three things were written and read by nothing, and the audit found all three
 * on the same record:
 *
 *   1. `CatalogProduct`'s LIFETIME COUNTERS. The schema said "maintained by the
 *      order pipeline" since M-06 and nothing maintained them; the port brought
 *      `syncClientFromOrder` across and left `upsertProductStatsFromOrder`
 *      behind. `product-stats.ts` is the writer; this screen is the reader.
 *
 *   2. `CatalogProductEvent`. LP.1 writes a row per changed field
 *      (`price_change`, `cost_change`, `packaging_cost_change`,
 *      `brand_changed`) and LP.18 adds `variants_changed`;
 *      `GET /products/[id]/history` serves them and **no screen rendered one**.
 *      It is the permanent record of what a cost basis used to be, which is the
 *      only way to answer "why is last quarter's margin different".
 *
 *   3. `CatalogProductLink`. LP.16a matches revenue on it FIRST and
 *      EXCLUSIVELY, LP.20 creates it from a product webhook, and nothing showed
 *      which channels a product is linked to — so a mis-linked product was
 *      invisible until its revenue went to the wrong row.
 *
 * The legacy shows all three in one modal, which is the right shape: they are
 * the same question asked three ways.
 *
 * `erp:products:read` is what `GET /products/[id]` checks, and the page checks
 * it rather than relying on the nav — the URL is typeable.
 * ========================================================================== */

export default async function ErpProductDetailScreen({
  params: routeParams,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await routeParams;
  const { session, locale: raw, t } = await requireProduct("erp", `/console/erp/products/${id}`);
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  if (!session.auth || !can(session.auth, "erp:products:read")) notFound();

  const data = await withTenant(session.auth.tenantId, async (db) => {
    const product = await db.catalogProduct.findUnique({
      where: { id },
      select: {
        id: true, reference: true, name: true, sku: true, brand: true,
        niche: true, category: true, supplier: true, description: true,
        price: true, costPrice: true, packagingCost: true,
        stock: true, threshold: true, variants: true, archived: true,
        totalOrders: true, confirmedOrders: true, cancelledOrders: true,
        deliveredOrders: true, totalRevenue: true,
        firstOrderAt: true, lastOrderAt: true,
      },
    });
    if (!product) return null;

    return {
      product,
      // Newest first: the question is "what changed", and a timeline that opens
      // on the oldest entry answers one nobody asked.
      events: await db.catalogProductEvent.findMany({
        where: { productId: id },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true, eventType: true, field: true,
          oldValue: true, newValue: true, createdAt: true, actorUserId: true,
        },
      }),
      links: await db.catalogProductLink.findMany({
        where: { productId: id },
        select: {
          id: true, platform: true, externalProductId: true,
          salesChannel: { select: { id: true, name: true } },
        },
      }),
    };
  });

  // 404, not 403, for another tenant's product — RLS produces the same answer
  // without this page filtering anything.
  if (!data) notFound();

  const { product, events, links } = data;
  const currency = session.tenant!.currency;
  const money = (v: { toString(): string } | null) => formatMoney((v ?? 0).toString(), locale, currency);
  const view = inventoryView(product);

  const tile = (key: string, label: string, value: string) => (
    <div key={key} data-tile={key} className="rounded-lg border border-border bg-surface-raised p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );

  return (
    <>
      <PageBody>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{product.name || product.reference || product.id}</h1>
        {product.archived && (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            {t("erp.products.archived")}
          </span>
        )}
        <Link
          href="/console/erp/products"
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          {t("erp.products.title")}
        </Link>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {[product.sku, product.brand, product.niche, product.category, product.supplier]
          .filter(Boolean)
          .join(" · ") || "—"}
      </p>

      {/* LIFETIME EVENT counts, and the label says so. Rendering them as live
          figures invites somebody to "fix" the arithmetic that produces them. */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="product-stats">
        {tile("orders", t("erp.clients.orders"), String(product.totalOrders))}
        {tile("confirmed", t("erp.overview.confirmed"), String(product.confirmedOrders))}
        {tile("cancelled", t("erp.clients.cancelled"), String(product.cancelledOrders))}
        {tile("delivered", t("erp.clients.delivered"), String(product.deliveredOrders))}
        {tile("revenue", t("erp.overview.revenue"), money(product.totalRevenue))}
        {tile("stock", t("erp.products.stock"), String(view.stock))}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {product.firstOrderAt ? formatDate(product.firstOrderAt, locale) : "—"}
        {" — "}
        {product.lastOrderAt ? formatDate(product.lastOrderAt, locale) : "—"}
      </p>

      {/* WHICH CHANNELS SELL IT. LP.16a matches revenue on these links FIRST
          and exclusively, so a link pointing at the wrong product sends money to
          the wrong row — and nothing showed them until now. */}
      <h2 className="mt-8 text-sm font-semibold tracking-tight">{t("erp.products.channels")}</h2>
      {links.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="product-links-empty">
          {t("erp.products.noChannels")}
        </p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2" data-testid="product-links">
          {links.map((l) => (
            <li
              key={l.id}
              data-link-platform={l.platform}
              className="rounded-full border border-border px-2 py-0.5 text-xs"
            >
              {l.salesChannel?.name ?? l.platform}
              <span className="ms-1 font-mono text-muted-foreground" dir="ltr">
                {l.externalProductId}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* THE PERMANENT TIMELINE. `CatalogProductEvent` is append-only: it is
          the record of what a cost basis USED to be, which is the only way to
          answer "why is last quarter's margin different from this one's". */}
      <h2 className="mt-8 text-sm font-semibold tracking-tight">{t("erp.products.timeline")}</h2>
      <DataTable
        testId="product-timeline"
        empty={t("erp.products.noEvents")}
        rows={events}
        rowKey={(e) => String(e.id)}
        rowAttrs={(e) => ({ "data-event-type": e.eventType ?? "" })}
        columns={[
          {
            id: "when",
            header: t("erp.orders.placed"),
            cell: (e) => (
              <span className="text-muted-foreground">{formatDate(e.createdAt, locale)}</span>
            ),
          },
          {
            id: "what",
            header: t("erp.inventory.reason"),
            cell: (e) => <span>{e.eventType ?? "—"}</span>,
          },
          {
            id: "field",
            header: t("erp.inventory.change"),
            /* The old value and the new one, side by side. That IS the record:
               "cost 1,200 → 1,450" is what somebody needs, and "cost changed"
               is not. */
            cell: (e) => (
              <span className="text-muted-foreground">
                {e.field ? `${e.field}: ` : ""}
                {e.oldValue ?? "—"} → {e.newValue ?? "—"}
              </span>
            ),
          },
        ]}
      />
      </PageBody>
    </>
  );
}
