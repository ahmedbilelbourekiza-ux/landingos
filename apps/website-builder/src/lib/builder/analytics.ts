/* =============================================================================
 * Storefront analytics aggregates (AN.1) — the read side of StorefrontVisit.
 *
 * ONE module builds every number the analytics screen shows, and it takes the
 * SCOPED client as a parameter: the screen hands it `forTenant(...)`, and the
 * contract suite hands it a `withTenant` binding over fixture rows — the same
 * function is what both exercise (D-LB.19.1's rule: one query builder, so the
 * screen and the test cannot disagree about what a window contains).
 *
 * Views and orders are both windowed on createdAt over the SAME `days`, and
 * the by-page/by-channel tables carry both counts side by side because either
 * alone invites the wrong conclusion: a page with 500 views and 0 orders is a
 * creative problem, 5 views and 4 orders is a scaling opportunity, and only
 * the pair says which.
 *
 * NO IMPORTS beyond types, deliberately — direct suite importability (the
 * calc.ts rule).
 * ========================================================================== */

export interface AnalyticsRange {
  /** Window in days, counted back from now. The screen offers 7 and 30. */
  days: number;
  since: Date;
}

export function analyticsRange(daysParam: string | undefined): AnalyticsRange {
  // Two fixed windows rather than a free number: every extra choice here is
  // an index shape someone has to keep fast, and 7/30 are the two questions
  // merchants actually ask ("this week", "this month").
  const days = daysParam === "30" ? 30 : 7;
  return { days, since: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
}

export interface PageTrafficRow {
  /** Null for the store-level rows (home, category listings). */
  landingPageId: string | null;
  pageKind: string;
  title: string | null;
  views: number;
  orders: number;
}

export interface ChannelRow {
  channel: string;
  views: number;
  orders: number;
}

export interface StorefrontAnalytics {
  totals: {
    views: number;
    orders: number;
    /** AN.2 — distinct visitor ids in the window. */
    visitors: number;
    /** Visitors seen in the window whose id predates their session — decided
     * client-side against localStorage, so it stays honest past the 30-day
     * row retention. */
    returningVisitors: number;
    /** visitors − returningVisitors: first-ever visitors, no overlap. */
    newVisitors: number;
  };
  byPage: PageTrafficRow[];
  byChannel: ChannelRow[];
}

/** `db` is a tenant-scoped Prisma client (forTenant / a withTenant binding).
 * Typed loosely for the same reason the routes type theirs loosely: the two
 * generated clients drift (the legacy schema note in zcode-dev-loop). */
export async function storefrontAnalytics(
  db: any,
  range: AnalyticsRange,
): Promise<StorefrontAnalytics> {
  const inWindow = { createdAt: { gte: range.since } };

  // SEQUENTIAL, not Promise.all — the caller is a `withTenant` binding, so
  // every query here rides ONE pinned transaction connection (the ERP
  // analytics route's stated rule; parallel dispatch at a single connection
  // is how P2028 timeouts start).
  const viewGroups = await db.storefrontVisit.groupBy({
    by: ["pageKind", "landingPageId"],
    where: inWindow,
    _count: { _all: true },
  });
  const orderGroups = await db.salesOrder.groupBy({
    by: ["landingPageId"],
    where: inWindow,
    _count: { _all: true },
  });
  const channelViewGroups = await db.storefrontVisit.groupBy({
    by: ["sourceChannel"],
    where: inWindow,
    _count: { _all: true },
  });
  const channelOrderGroups = await db.salesOrder.groupBy({
    by: ["sourceChannel"],
    where: inWindow,
    _count: { _all: true },
  });

  /* AN.2 — unique visitors, as ONE aggregate rather than a groupBy whose
   * group list this process would have to hold and count: a busy month is
   * tens of thousands of distinct ids, and shipping them across the wire to
   * measure their length is the wrong shape. Raw SQL is safe HERE because
   * the binding contract puts this on the transaction connection whose
   * app.tenant_id is set — RLS applies to raw exactly as to the builder.
   * (This is also why the caller must be `withTenant`, not the `forTenant`
   * proxy — the proxy cannot carry a tagged template.) A returning visitor
   * is counted from any isReturning row in the window; new is the
   * remainder, so the two halves sum to the total by construction. */
  const [uniques] = (await db.$queryRaw`
    SELECT
      COUNT(DISTINCT "visitorToken")::int AS "visitors",
      COUNT(DISTINCT "visitorToken") FILTER (WHERE "isReturning")::int AS "returningVisitors"
    FROM "StorefrontVisit"
    WHERE "createdAt" >= ${range.since}
  `) as [{ visitors: number; returningVisitors: number }];

  // Titles for the landing rows — including archived/unpublished pages, whose
  // historical views are still real events that happened.
  const pageIds = viewGroups
    .map((g: any) => g.landingPageId)
    .filter((id: string | null): id is string => Boolean(id));
  const orderPageIds = orderGroups.map((g: any) => g.landingPageId);
  const titles = new Map<string, string>(
    (
      await db.landingPage.findMany({
        where: { id: { in: [...new Set([...pageIds, ...orderPageIds])] } },
        select: { id: true, title: true },
      })
    ).map((p: any) => [p.id, p.title]),
  );

  const ordersByPage = new Map<string, number>(
    orderGroups.map((g: any) => [g.landingPageId, g._count._all]),
  );

  const byPage: PageTrafficRow[] = viewGroups.map((g: any) => ({
    landingPageId: g.landingPageId,
    pageKind: g.pageKind,
    title: g.landingPageId ? (titles.get(g.landingPageId) ?? null) : null,
    views: g._count._all,
    orders: g.landingPageId ? (ordersByPage.get(g.landingPageId) ?? 0) : 0,
  }));

  // A page that sold in the window without a single counted view (a direct
  // console order, or traffic older than the window) still belongs in the
  // table — orders are the column that matters most, and dropping the row
  // would make the screen disagree with the orders list.
  for (const g of orderGroups) {
    if (!byPage.some((row) => row.landingPageId === g.landingPageId)) {
      byPage.push({
        landingPageId: g.landingPageId,
        pageKind: "landing",
        title: titles.get(g.landingPageId) ?? null,
        views: 0,
        orders: g._count._all,
      });
    }
  }
  byPage.sort((a, b) => b.views - a.views || b.orders - a.orders);

  // Null on an order means "no browser session to derive from" (console,
  // import, webhook). That is NOT direct traffic and must not be counted as
  // any channel — it gets its own honest bucket the screen labels as such.
  const orderChannel = (g: any): string => g.sourceChannel ?? "unattributed";
  const ordersByChannel = new Map<string, number>(
    channelOrderGroups.map((g: any) => [orderChannel(g), g._count._all]),
  );
  const channels = new Set<string>([
    ...channelViewGroups.map((g: any) => g.sourceChannel),
    ...channelOrderGroups.map(orderChannel),
  ]);
  const byChannel: ChannelRow[] = [...channels].map((channel) => ({
    channel,
    views: channelViewGroups.find((g: any) => g.sourceChannel === channel)?._count._all ?? 0,
    orders: ordersByChannel.get(channel) ?? 0,
  }));
  byChannel.sort((a, b) => b.views - a.views || b.orders - a.orders);

  return {
    totals: {
      views: byPage.reduce((sum, row) => sum + row.views, 0),
      orders: orderGroups.reduce((sum: number, g: any) => sum + g._count._all, 0),
      visitors: uniques.visitors,
      returningVisitors: uniques.returningVisitors,
      newVisitors: uniques.visitors - uniques.returningVisitors,
    },
    byPage,
    byChannel,
  };
}
