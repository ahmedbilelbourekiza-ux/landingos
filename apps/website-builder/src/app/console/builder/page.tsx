import Link from "next/link";

import { forTenant } from "@landingos/db";
import { formatMoney, formatNumber, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageBody } from "@/components/console/ui/primitives";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The builder's overview.
 *
 * A product may supply its own index; the generic [product] route remains the
 * fallback for any that does not — which is what keeps a tenth product working
 * with no code at all while letting a mature one say something useful.
 *
 * Every figure is scoped by the tenant binding, so these are this company's
 * numbers by construction rather than by a filter someone remembered to write.
 * ========================================================================== */

function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="mt-1 block text-2xl font-semibold tabular-nums">{value}</span>
      {hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
    </>
  );

  const className =
    "block rounded-lg border border-border bg-card p-4 transition-colors" +
    (href ? " hover:border-primary" : "");

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export default async function BuilderOverview() {
  const { session, locale: raw, t } = await requireProduct("website-builder", "/console/builder");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const db = forTenant(session.auth!.tenantId);

  const [pages, published, orders, delivered, abandoned, revenue] = await Promise.all([
    db.landingPage.count(),
    db.landingPage.count({ where: { published: true } }),
    db.salesOrder.count(),
    db.salesOrder.count({ where: { status: "DELIVERED" } }),
    db.draftOrder.count({ where: { convertedOrderId: null } }),
    // Revenue counts DELIVERED only. An order that was placed is not money;
    // an order that arrived is.
    db.salesOrder.aggregate({ _sum: { totalPrice: true }, where: { status: "DELIVERED" } }),
  ]);

  const earned = revenue._sum.totalPrice ?? 0;

  return (
    <ConsoleShell session={session} productId="website-builder">
      <PageBody>
      <h1 className="text-xl font-semibold">{session.tenant?.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("product.websiteBuilder.description")}</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="builder-overview">
        <Stat
          label={t("builder.nav.pages")}
          value={formatNumber(pages, locale)}
          hint={`${formatNumber(published, locale)} ${t("status.landingPage.published")}`}
          href="/console/builder/pages"
        />
        <Stat
          label={t("builder.nav.orders")}
          value={formatNumber(orders, locale)}
          hint={`${formatNumber(delivered, locale)} ${t("status.salesOrder.delivered")}`}
          href="/console/builder/orders"
        />
        <Stat
          label={t("builder.nav.abandoned")}
          value={formatNumber(abandoned, locale)}
          href="/console/builder/abandoned"
        />
        <Stat
          label={t("status.salesOrder.delivered")}
          value={formatMoney(String(earned), locale, session.tenant?.currency ?? "DZD")}
          hint={t("status.salesOrder.delivered")}
        />
      </div>
      </PageBody>
    </ConsoleShell>
  );
}
