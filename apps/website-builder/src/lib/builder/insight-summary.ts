import type { InsightSummary } from "../landing/ai-insight.ts";

/* =============================================================================
 * BH.3 — the numbers one page's analysis rests on, computed server-side.
 *
 * The single-page sibling of `storefrontAnalytics` (same predicates: a view
 * is windowed on createdAt, a MEASURED view is `activeMs` non-null), plus the
 * two inputs the Traffic screen does not show: the drafts funnel and the
 * per-question FAQ opens (unnested from `faqOpenedIds`). Everything is a
 * count by construction — this module is the privacy line's enforcement
 * point: nothing row-shaped leaves it.
 *
 * `db` must be a `withTenant` binding: the FAQ unnest is raw SQL and rides
 * the bound transaction connection where RLS applies (the analytics.ts
 * uniques rule). Queries are SEQUENTIAL on that one pinned connection.
 * ========================================================================== */

export interface InsightPage {
  readonly id: string;
  readonly title: string;
  readonly faqs: ReadonlyArray<{ readonly id: string; readonly question: string }>;
}

export async function buildInsightSummary(
  db: any,
  page: InsightPage,
  windowDays: number,
): Promise<InsightSummary> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const inWindow = { landingPageId: page.id, createdAt: { gte: since } };

  const views = await db.storefrontVisit.count({ where: inWindow });
  const orders = await db.salesOrder.count({ where: inWindow });

  const measuredWhere = { ...inWindow, activeMs: { not: null } };
  const measured = await db.storefrontVisit.count({ where: measuredWhere });

  let behavior: InsightSummary["behavior"] = null;
  if (measured > 0) {
    const sums = await db.storefrontVisit.aggregate({
      where: measuredWhere,
      _avg: { activeMs: true },
      _sum: { faqOpens: true, galleryChanges: true, variantChanges: true },
    });
    const boolCount = (field: "sawForm" | "stickyBuyClicked" | "whatsappClicked") =>
      db.storefrontVisit.count({ where: { ...measuredWhere, [field]: true } });
    const sawForm = await boolCount("sawForm");
    const stickyBuyClicks = await boolCount("stickyBuyClicked");
    const whatsappClicks = await boolCount("whatsappClicked");
    const furthestGroups = await db.storefrontVisit.groupBy({
      by: ["furthestSection"],
      where: { ...measuredWhere, furthestSection: { not: null } },
      _count: { _all: true },
    });

    behavior = {
      measured,
      sawForm,
      furthest: Object.fromEntries(
        furthestGroups.map((g: any) => [g.furthestSection, g._count._all]),
      ),
      faqOpens: sums._sum.faqOpens ?? 0,
      galleryChanges: sums._sum.galleryChanges ?? 0,
      variantChanges: sums._sum.variantChanges ?? 0,
      stickyBuyClicks,
      whatsappClicks,
      avgActiveMs: Math.round(sums._avg.activeMs ?? 0),
    };
  }

  /* WHICH questions get opened — the analysis's best signal (§BH.2's table).
   * Unnest is Postgres's job: shipping every faqOpenedIds array here to
   * count in JS is the shape the analytics module already declined. */
  const openRows =
    measured > 0
      ? ((await db.$queryRaw`
          SELECT elem AS "faqId", COUNT(*)::int AS "opens"
          FROM "StorefrontVisit",
               jsonb_array_elements_text("faqOpenedIds") AS elem
          WHERE "landingPageId" = ${page.id}
            AND "createdAt" >= ${since}
            AND "activeMs" IS NOT NULL
          GROUP BY elem
        `) as Array<{ faqId: string; opens: number }>)
      : [];
  const opensByFaq = new Map(openRows.map((r) => [r.faqId, r.opens]));

  // Every question, opened or not — "nobody opens the delivery question" is
  // as citable a fact as its opposite. Keys are positional and stable for
  // this summary (faq.q1..), bounded by the collector's own ≤20.
  const faqQuestions = page.faqs.slice(0, 20).map((faq, i) => ({
    key: `faq.q${i + 1}`,
    question: faq.question,
    opens: opensByFaq.get(faq.id) ?? 0,
  }));

  const started = await db.draftOrder.count({ where: inWindow });
  const withPhone = await db.draftOrder.count({
    where: { ...inWindow, phone: { not: null } },
  });

  return {
    windowDays,
    pageTitle: page.title,
    views,
    orders,
    behavior,
    faqQuestions,
    drafts: { started, withPhone },
  };
}
