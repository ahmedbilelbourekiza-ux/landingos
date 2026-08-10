import Link from "next/link";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { formatMoney, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { PageHeader, PageBody, Section, Stat, StatGrid } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import { orderFilters } from "@/lib/erp/orders";
import { scopedWhere, seesWholeBook } from "@/lib/erp/scope";
import {
  headline, breakdown, ANALYTICS_DIMENSIONS, SUPERVISION_DIMENSIONS, type Dimension,
} from "@/lib/erp/analytics";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The analytics screen — LP.13, restoring R6 and closing N18 / N20.
 *
 * One legacy screen with no platform equivalent at all, and the one that mattered
 * most: it is where a manager finds out WHICH product, WHICH wilaya, WHICH agent
 * and WHICH ad campaign is converting. The confirmation rate was computed nowhere
 * on this platform before this slice.
 *
 * **N20 — ad attribution becomes possible here for the first time.** `marketer`
 * and `source` are written by the channel webhooks and were read by nothing, so a
 * business that BUYS its orders could not tell which campaign paid for itself.
 *
 * It reads the database directly, so it applies the permission its API applies —
 * `erp:orders:read` plus `scopedWhere`, and `erp:agents:manage` for the by-agent
 * table. A nav item is a hint; the URL is typeable.
 *
 * The date window is the ORDER LIST'S query string, unchanged: `range=week`,
 * `since`/`until`, `status`, `wilaya`, and the rest. So this screen is the
 * analytics OF a filter somebody already applied, which is why the presets are
 * links carrying `range=` rather than a control of their own.
 * ========================================================================== */

const RANGES = ["today", "yesterday", "week", "month"] as const;

export default async function ErpAnalyticsScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/analytics");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    const one = Array.isArray(value) ? value[0] : value;
    if (one) params.set(key, one);
  }

  const supervisor = can(session.auth!, "erp:agents:manage");
  const offered = ANALYTICS_DIMENSIONS.filter(
    (d) => supervisor || !SUPERVISION_DIMENSIONS.has(d),
  );

  const filters = orderFilters(params);
  const settledFilters = orderFilters(params);
  // Same window, other column — orders are counted by creation and parcels by
  // settlement. See the route's own note.
  const created = (filters as { createdAt?: unknown }).createdAt;
  delete (settledFilters as { createdAt?: unknown }).createdAt;
  if (created) (settledFilters as Record<string, unknown>).deliveryOutcomeAt = created;

  const { totals, tables, members } = await withTenant(session.auth!.tenantId, async (db) => {
    const where = scopedWhere(session, filters);
    const settled = scopedWhere(session, settledFilters);

    const totals = await headline(db, where, settled);
    const tables: Record<string, Awaited<ReturnType<typeof breakdown>>> = {};
    for (const dimension of offered) {
      tables[dimension] = await breakdown(db, where, dimension as Dimension);
    }

    // Only to turn a user id into a name in the by-agent table. Read once, not
    // once per row.
    const members = supervisor
      ? await db.membership.findMany({ select: { userId: true, user: { select: { name: true, email: true } } } })
      : [];

    return { totals, tables, members };
  });

  const nameOf = new Map(members.map((m) => [m.userId, m.user.name || m.user.email]));
  const currency = session.tenant!.currency;
  const money = (v: string) => formatMoney(v, locale, currency);

  const activeRange = params.get("range") ?? "";
  const rangeHref = (range: string) => {
    const next = new URLSearchParams(params);
    if (range) next.set("range", range);
    else next.delete("range");
    return `/console/erp/analytics${next.toString() ? `?${next}` : ""}`;
  };

  const DIMENSION_LABEL: Record<string, string> = {
    status: t("erp.orders.status"),
    salesChannelName: t("erp.analytics.channel"),
    product: t("erp.orders.product"),
    wilaya: t("erp.orders.wilaya"),
    agentUserId: t("erp.orders.agent"),
    marketer: t("erp.analytics.marketer"),
    deliveryStatus: t("erp.analytics.deliveryStatus"),
  };

  const tiles = [
    { id: "orders", label: t("erp.analytics.orders"), value: String(totals.orders) },
    {
      id: "confirmation-rate",
      label: t("erp.analytics.confirmationRate"),
      value: `${totals.confirmationRate}%`,
      sub: `${totals.confirmed} ${t("erp.overview.confirmed")}`,
    },
    {
      id: "cancellation-rate",
      label: t("erp.analytics.cancellationRate"),
      value: `${totals.cancellationRate}%`,
      sub: `${totals.cancelled}`,
    },
    {
      id: "confirmed-value",
      label: t("erp.analytics.confirmedValue"),
      value: money(totals.confirmedValue),
    },
    {
      id: "average-order",
      label: t("erp.analytics.averageOrder"),
      value: money(totals.averageOrderValue),
    },
    {
      id: "delivered",
      label: t("erp.analytics.delivered"),
      value: String(totals.delivered),
      sub: money(totals.deliveredValue),
    },
    { id: "returned", label: t("erp.analytics.returned"), value: String(totals.returned) },
    {
      id: "delivery-rate",
      label: t("erp.analytics.deliveryRate"),
      value: `${totals.deliveryRate}%`,
    },
    {
      id: "never-called",
      label: t("erp.analytics.neverCalled"),
      value: String(totals.neverCalled),
    },
  ];

  return (
    <>
      <PageBody>
      <PageHeader
        title={t("erp.analytics.title")}
        description={
          <>
            {t("erp.analytics.subtitle")} ·{" "}
            <span data-testid="erp-scope">
              {seesWholeBook(session) ? t("erp.overview.wholeBook") : t("erp.overview.myQueue")}
            </span>
          </>
        }
      />

      {/* The window, as links carrying the ORDER LIST's own `range=` vocabulary
          — so a filter applied there survives arriving here, and vice versa.
          PM.6 gave it the same segmented control the dashboard uses: two
          screens offering the same four periods in two different shapes is how
          a console stops looking like one product. */}
      <nav
        className="inline-flex flex-wrap items-center rounded-md border border-border bg-surface-subtle p-0.5"
        data-testid="analytics-ranges"
      >
        {[{ value: "", label: t("erp.filters.any"), key: "all" }, ...RANGES.map((r) => ({
          value: r,
          label: t(`erp.filters.range.${r}` as "erp.filters.range.today"),
          key: r,
        }))].map((r) => {
          const current = activeRange === r.value;
          return (
            <Link
              key={r.key}
              href={rangeHref(r.value)}
              data-range={r.key}
              aria-current={current ? "page" : undefined}
              className={`tap rounded-[calc(var(--radius)-4px)] px-3 py-1.5 text-xs font-medium transition-colors duration-(--duration-fast) ${
                current
                  ? "bg-surface-raised text-foreground shadow-e1"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.label}
            </Link>
          );
        })}
      </nav>

      <StatGrid testId="analytics-tiles">
        {tiles.map((tile) => (
          <Stat
            key={tile.id}
            id={tile.id}
            label={tile.label}
            value={tile.value}
            sub={tile.sub}
          />
        ))}
      </StatGrid>

      {/* N19, said on the page rather than left for somebody to discover:
          the two revenue figures are both real and are not the same number. */}
      <p className="text-xs text-muted-foreground" data-testid="analytics-revenue-note">
        {t("erp.analytics.revenueNote")}
      </p>

      {offered.map((dimension) => (
        <Section
          key={dimension}
          title={DIMENSION_LABEL[dimension]}
          flush
          data-dimension={dimension}
        >
          <DataTable
            testId={`analytics-${dimension}`}
            empty={t("common.empty")}
            rows={tables[dimension]}
            rowKey={(b) => b.key || "—"}
            columns={[
              {
                id: "key",
                header: DIMENSION_LABEL[dimension],
                cell: (b) =>
                  dimension === "agentUserId"
                    ? (nameOf.get(b.key) ?? t("erp.orders.unassigned"))
                    : b.key || t("erp.analytics.unknown"),
              },
              {
                id: "orders", header: t("erp.analytics.orders"), numeric: true, align: "end",
                cell: (b) => b.orders,
              },
              {
                id: "confirmed", header: t("erp.overview.confirmed"), numeric: true, align: "end",
                cell: (b) => b.confirmed,
              },
              {
                id: "conf-rate", header: t("erp.analytics.confirmationRate"),
                numeric: true, align: "end",
                // The bar is the legacy's, and it earns its place: a column of
                // percentages is read one number at a time, a column of bars is
                // read at a glance, which is the whole job of this screen.
                cell: (b) => (
                  <span className="flex items-center justify-end gap-2" dir="ltr">
                    <span className="tabular-nums">{b.confirmationRate}%</span>
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full bg-primary"
                        style={{ width: `${Math.min(100, Number(b.confirmationRate))}%` }}
                      />
                    </span>
                  </span>
                ),
              },
              {
                id: "canc-rate", header: t("erp.analytics.cancellationRate"),
                numeric: true, align: "end",
                cell: (b) => <span dir="ltr">{b.cancellationRate}%</span>,
              },
              {
                id: "value", header: t("erp.analytics.confirmedValue"),
                numeric: true, align: "end",
                cell: (b) => money(b.confirmedValue),
              },
            ]}
          />
        </Section>
      ))}
      </PageBody>
    </>
  );
}
