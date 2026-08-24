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

/* -----------------------------------------------------------------------------
 * TS.2 — the period vocabulary.
 *
 * `today`/`yesterday`/`week`/`month` are the ERP's own words (DATE_RANGES /
 * rangeBounds in lib/erp/orders.ts) with the SAME boundary semantics —
 * start-of-day in the server's zone, half-open windows — so "today" on the
 * Traffic screen can never disagree with "today" on the order list. This
 * module cannot import that one (no-imports suite-importability; orders.ts is
 * also server-only), so the storefront suite PINS the same boundary semantics
 * at a fixed clock instead — change one convention and that test names the
 * other.
 *
 * `3d` is traffic's own addition (ad buyers' "last three days"); `custom` is
 * a from/to pair CLAMPED to the last 30 days because the raw visit rows
 * behind every number here are pruned at 30 days (AN.2) — a wider window
 * would silently report over rows the retention rule already removed. The
 * screen's counting-basis line states the 30-day retention.
 * -------------------------------------------------------------------------- */
export const ANALYTICS_PERIODS = ["today", "yesterday", "3d", "week", "month"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number] | "custom";

export interface AnalyticsRange {
  period: AnalyticsPeriod;
  /** Whole days the window spans (≥1) — feeds labels and the spend refresh. */
  days: number;
  since: Date;
  /** EXCLUSIVE end. Open windows end at now+1ms (the ERP dashboard's rule:
   * comparing a partial today against a whole yesterday would report every
   * morning as a collapse, so the previous window is span-matched instead). */
  until: Date;
  /** Echoes for the custom form's inputs (YYYY-MM-DD, post-clamp). */
  from?: string;
  to?: string;
}

export interface AnalyticsRangeParams {
  /** The URL param is `range` — the ERP order list's own param name, so the
   * two screens' URLs speak one vocabulary (and PeriodTabs builds `?range=`). */
  range?: string;
  /** Legacy `?days=7|30` bookmarks keep working. */
  days?: string;
  from?: string;
  to?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30; // mirrors VISIT_RETENTION_DAYS; pinned by the suite

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dayString = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function analyticsRange(
  params: AnalyticsRangeParams | undefined,
  now = new Date(),
): AnalyticsRange {
  const today = startOfDay(now);
  const open = new Date(now.getTime() + 1);
  const daysBack = (n: number) => new Date(today.getTime() - n * DAY_MS);

  const period = params?.range;
  if (period === "today") {
    return { period, days: 1, since: today, until: open };
  }
  if (period === "yesterday") {
    return { period, days: 1, since: daysBack(1), until: today };
  }
  if (period === "3d") {
    return { period, days: 3, since: daysBack(2), until: open };
  }
  if (period === "month") {
    return { period, days: 30, since: daysBack(29), until: open };
  }
  if (period === "custom") {
    const fromDay = parseDay(params?.from);
    const toDay = parseDay(params?.to);
    if (fromDay && toDay) {
      // Inclusive picker days → half-open window; swapped inputs are read as
      // the range the person meant, not refused on a read screen.
      let since = fromDay <= toDay ? fromDay : toDay;
      let untilDay = fromDay <= toDay ? toDay : fromDay;
      // Nothing after today exists to count.
      if (untilDay > today) untilDay = today;
      // Day-granular exclusive end. A range ending today spans the whole
      // day; the hours still to come simply hold no rows yet.
      let until = new Date(untilDay.getTime() + DAY_MS);
      // The retention clamp, twice: the window may not START before the
      // retention floor, and may not SPAN more than the retention window.
      const floor = daysBack(RETENTION_DAYS - 1);
      if (since < floor) since = floor;
      if (until.getTime() - since.getTime() > RETENTION_DAYS * DAY_MS) {
        since = new Date(until.getTime() - RETENTION_DAYS * DAY_MS);
      }
      if (since < until) {
        return {
          period: "custom",
          days: Math.max(1, Math.round((until.getTime() - since.getTime()) / DAY_MS)),
          since,
          until,
          from: dayString(since),
          to: dayString(new Date(until.getTime() - DAY_MS)),
        };
      }
    }
    // Malformed custom input falls through to the default window — a stale
    // bookmark should render the screen, not an error (the rangeBounds rule).
  }
  // `week` (7 days), the default — and the legacy `?days=` bookmarks.
  if (params?.days === "30") {
    return { period: "month", days: 30, since: daysBack(29), until: open };
  }
  return { period: "week", days: 7, since: daysBack(6), until: open };
}

/** The same-length window immediately before this one — what every delta is
 * measured against. Derived, never named, so "the 7 days before these 7 days"
 * cannot drift into "last calendar week" (the ERP dashboard's rule). */
export function previousWindow(range: AnalyticsRange): { since: Date; until: Date } {
  const span = range.until.getTime() - range.since.getTime();
  return { since: new Date(range.since.getTime() - span), until: range.since };
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

/** BH.2 — per-page behavior aggregates, over MEASURED views only (a view is
 * measured when its exit flush landed: activeMs non-null; the collector
 * always sends it when armed). Pages with zero measured views are absent —
 * the screen renders that as "not tracked", never as zeros. */
export interface PageBehaviorRow {
  landingPageId: string;
  title: string | null;
  measured: number;
  sawForm: number;
  faqOpens: number;
  galleryChanges: number;
  variantChanges: number;
  stickyBuyClicks: number;
  whatsappClicks: number;
  avgActiveMs: number;
  /** How many measured views got EXACTLY as deep as each landmark. */
  furthest: Record<string, number>;
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
  behaviorByPage: PageBehaviorRow[];
  /* TS.3 — the drafts funnel per landing page (started / left a phone),
   * windowed like everything else. Until now this pair was computed only for
   * the AI's input (insight-summary) — the screen finally shows what the
   * model already saw. Keyed by landingPageId; pages without drafts are
   * absent, and absent must render as 0 here (a count, not a rate). */
  draftsByPage: Record<string, { started: number; withPhone: number }>;
  /* TS.3 — per-question FAQ opens per page, measured views only, sorted by
   * opens desc. The insight-summary's unnest, widened to every page in one
   * query instead of per-page on demand. */
  faqOpensByPage: Record<string, { question: string; opens: number }[]>;
}

/** `db` is a tenant-scoped Prisma client (forTenant / a withTenant binding).
 * Typed loosely for the same reason the routes type theirs loosely: the two
 * generated clients drift (the legacy schema note in zcode-dev-loop). */
export async function storefrontAnalytics(
  db: any,
  range: AnalyticsRange,
): Promise<StorefrontAnalytics> {
  // TS.2 — half-open on both ends: bounded periods (yesterday, custom) end
  // where the next window begins, so two adjacent windows cannot both claim
  // a row. Open periods carry until = now+1ms, which bounds nothing real.
  const inWindow = { createdAt: { gte: range.since, lt: range.until } };

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
    WHERE "createdAt" >= ${range.since} AND "createdAt" < ${range.until}
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

  /* BH.2 — behavior, still sequential on the one connection. `measured` is
   * the denominator for every rate the screen shows, so it is counted from
   * the same predicate every sum uses (activeMs non-null), never inferred. */
  const measuredWhere = { ...inWindow, activeMs: { not: null } };
  const behaviorGroups = await db.storefrontVisit.groupBy({
    by: ["landingPageId"],
    where: measuredWhere,
    _count: { _all: true },
    _avg: { activeMs: true },
    _sum: { faqOpens: true, galleryChanges: true, variantChanges: true },
  });
  const boolCount = async (field: "sawForm" | "stickyBuyClicked" | "whatsappClicked") =>
    db.storefrontVisit.groupBy({
      by: ["landingPageId"],
      where: { ...measuredWhere, [field]: true },
      _count: { _all: true },
    });
  const sawFormGroups = await boolCount("sawForm");
  const stickyGroups = await boolCount("stickyBuyClicked");
  const whatsappGroups = await boolCount("whatsappClicked");
  const furthestGroups = await db.storefrontVisit.groupBy({
    by: ["landingPageId", "furthestSection"],
    where: { ...measuredWhere, furthestSection: { not: null } },
    _count: { _all: true },
  });

  const countFor = (groups: any[], pageId: string | null): number =>
    groups.find((g) => g.landingPageId === pageId)?._count._all ?? 0;

  const behaviorByPage: PageBehaviorRow[] = behaviorGroups
    .filter((g: any) => g.landingPageId)
    .map((g: any) => ({
      landingPageId: g.landingPageId,
      title: titles.get(g.landingPageId) ?? null,
      measured: g._count._all,
      sawForm: countFor(sawFormGroups, g.landingPageId),
      faqOpens: g._sum.faqOpens ?? 0,
      galleryChanges: g._sum.galleryChanges ?? 0,
      variantChanges: g._sum.variantChanges ?? 0,
      stickyBuyClicks: countFor(stickyGroups, g.landingPageId),
      whatsappClicks: countFor(whatsappGroups, g.landingPageId),
      avgActiveMs: Math.round(g._avg.activeMs ?? 0),
      furthest: Object.fromEntries(
        furthestGroups
          .filter((f: any) => f.landingPageId === g.landingPageId)
          .map((f: any) => [f.furthestSection, f._count._all]),
      ),
    }));
  behaviorByPage.sort((a, b) => b.measured - a.measured);

  /* TS.3 — the drafts funnel, per page. Two groupBys; rows with no page id
   * (store-level drafts do not exist, but the column is nullable) drop out. */
  const draftGroups = await db.draftOrder.groupBy({
    by: ["landingPageId"],
    where: inWindow,
    _count: { _all: true },
  });
  const draftPhoneGroups = await db.draftOrder.groupBy({
    by: ["landingPageId"],
    where: { ...inWindow, phone: { not: null } },
    _count: { _all: true },
  });
  const draftsByPage: Record<string, { started: number; withPhone: number }> = {};
  for (const g of draftGroups) {
    if (!g.landingPageId) continue;
    draftsByPage[g.landingPageId] = { started: g._count._all, withPhone: 0 };
  }
  for (const g of draftPhoneGroups) {
    if (!g.landingPageId || !draftsByPage[g.landingPageId]) continue;
    draftsByPage[g.landingPageId]!.withPhone = g._count._all;
  }

  /* TS.3 — which questions get opened, per page: ONE unnest over the window
   * (insight-summary's per-page SQL, widened), joined to the question text.
   * Only pages with measured views can have opens, so the query is skipped
   * when nothing is measured. Sorted by opens desc; the screen shows the top
   * few. Raw SQL is safe here for the same reason the uniques aggregate is —
   * the withTenant binding pins RLS to this connection. */
  const faqOpensByPage: Record<string, { question: string; opens: number }[]> = {};
  if (behaviorByPage.length > 0) {
    const openRows = (await db.$queryRaw`
      SELECT "landingPageId", elem AS "faqId", COUNT(*)::int AS "opens"
      FROM "StorefrontVisit",
           jsonb_array_elements_text("faqOpenedIds") AS elem
      WHERE "createdAt" >= ${range.since}
        AND "createdAt" < ${range.until}
        AND "activeMs" IS NOT NULL
        AND "landingPageId" IS NOT NULL
      GROUP BY "landingPageId", elem
    `) as Array<{ landingPageId: string; faqId: string; opens: number }>;
    if (openRows.length > 0) {
      const questions = await db.landingFAQ.findMany({
        where: { id: { in: [...new Set(openRows.map((r) => r.faqId))] } },
        select: { id: true, question: true },
      });
      const questionById = new Map<string, string>(
        questions.map((q: any) => [q.id, q.question]),
      );
      for (const row of openRows) {
        const question = questionById.get(row.faqId);
        if (!question) continue; // a deleted question's old opens name nothing
        (faqOpensByPage[row.landingPageId] ??= []).push({ question, opens: row.opens });
      }
      for (const list of Object.values(faqOpensByPage)) {
        list.sort((a, b) => b.opens - a.opens);
      }
    }
  }

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
    behaviorByPage,
    draftsByPage,
    faqOpensByPage,
  };
}

/* -----------------------------------------------------------------------------
 * TS.2 — the previous window's totals, for the KPI deltas.
 *
 * Three cheap aggregates, NOT a second storefrontAnalytics call: the deltas
 * need totals only, and the full function runs a dozen queries for tables the
 * comparison never shows. Sequential on the same binding, like everything
 * else on this connection.
 * -------------------------------------------------------------------------- */
export interface AnalyticsComparison {
  views: number;
  orders: number;
  visitors: number;
}

export async function analyticsComparison(
  db: any,
  window: { since: Date; until: Date },
): Promise<AnalyticsComparison> {
  const where = { createdAt: { gte: window.since, lt: window.until } };
  const views = await db.storefrontVisit.count({ where });
  const orders = await db.salesOrder.count({ where });
  const [uniques] = (await db.$queryRaw`
    SELECT COUNT(DISTINCT "visitorToken")::int AS "visitors"
    FROM "StorefrontVisit"
    WHERE "createdAt" >= ${window.since} AND "createdAt" < ${window.until}
  `) as [{ visitors: number }];
  return { views, orders, visitors: uniques.visitors };
}

/** Percent change against the previous window; null when the previous window
 * held nothing — "+100% from zero" is arithmetic, not information (the ERP
 * dashboard's own rule, kept identical here). */
export function percentDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Conversion (orders per 100 views) and its POINTS delta. Rates compare by
 * difference, not ratio: "2.1% up from 1.6%" is +0.5 points. Null when a
 * window has no views to divide by. */
export function conversionRate(orders: number, views: number): number | null {
  if (views <= 0) return null;
  return (orders / views) * 100;
}
