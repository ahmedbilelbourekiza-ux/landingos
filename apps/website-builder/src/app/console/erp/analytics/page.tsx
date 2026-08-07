import Link from "next/link";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { formatMoney, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
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
      lead: true,
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
    <ConsoleShell session={session} productId="erp">
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
          — so a filter applied there survives arriving here, and vice versa. */}
      <nav className="flex flex-wrap gap-2" data-testid="analytics-ranges">
        <Link
          href={rangeHref("")}
          data-range="all"
          aria-current={activeRange === "" ? "page" : undefined}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            activeRange === "" ? "border-primary font-medium" : "border-input"
          }`}
        >
          {t("erp.filters.any")}
        </Link>
        {RANGES.map((r) => (
          <Link
            key={r}
            href={rangeHref(r)}
            data-range={r}
            aria-current={activeRange === r ? "page" : undefined}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              activeRange === r ? "border-primary font-medium" : "border-input"
            }`}
          >
            {t(`erp.filters.range.${r}`)}
          </Link>
        ))}
      </nav>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="analytics-tiles">
        {tiles.map((tile) => (
          <div
            key={tile.id}
            data-tile={tile.id}
            className={`rounded-lg border p-4 ${
              tile.lead ? "border-primary" : "border-border"
            }`}
          >
            <span className="block text-xs text-muted-foreground">{tile.label}</span>
            <span className="mt-1 block text-2xl font-semibold tabular-nums" dir="ltr">
              {tile.value}
            </span>
            {tile.sub && (
              <span className="mt-0.5 block text-xs text-muted-foreground" dir="ltr">
                {tile.sub}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* N19, said on the page rather than left for somebody to discover:
          the two revenue figures are both real and are not the same number. */}
      <p className="mt-3 text-xs text-muted-foreground" data-testid="analytics-revenue-note">
        {t("erp.analytics.revenueNote")}
      </p>

      {offered.map((dimension) => (
        <section key={dimension} className="mt-8" data-dimension={dimension}>
          <h2 className="text-sm font-semibold tracking-tight">{DIMENSION_LABEL[dimension]}</h2>
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
        </section>
      ))}
      </PageBody>
    </ConsoleShell>
  );
}
