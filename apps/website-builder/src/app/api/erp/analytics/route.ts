import { can } from "@landingos/auth";
import type { Prisma } from "@landingos/db";

import { tenantRoute, apiOk } from "@/lib/api/route";
import { orderFilters } from "@/lib/erp/orders";
import { scopedWhere } from "@/lib/erp/scope";
import {
  headline, breakdown, ANALYTICS_DIMENSIONS, SUPERVISION_DIMENSIONS, type Dimension,
} from "@/lib/erp/analytics";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The analytics surface — LP.13, restoring R6 / K1 / N18 / N20.
 *
 * THE CONFIRMATION RATE WAS COMPUTED NOWHERE ON THIS PLATFORM. It is the number
 * a COD call centre is managed by, the legacy leads its dashboard with it, and
 * its analytics screen recomputes it across seven dimensions. Two agents with a
 * 40% and a 75% rate looked identical on every screen that existed.
 *
 * -----------------------------------------------------------------------------
 * IT TAKES THE ORDER LIST'S OWN QUERY STRING
 *
 * The same `orderFilters` and the same `scopedWhere` the list, the queue and the
 * export use (D-LP.3, D-LP.6.2). So "the confirmation rate for Alger last week"
 * is the analytics view of a filter somebody already applied on the list, and
 * the two cannot disagree about what that window contained. One vocabulary.
 *
 * -----------------------------------------------------------------------------
 * WHO SEES WHAT — two gates, and they are different questions
 *
 * The route is `erp:orders:read` and the rows are RECORD-SCOPED, so an agent
 * gets the analytics of their own queue — which is exactly what they already
 * read on screen, and is genuinely useful to them: their own confirmation rate.
 *
 * The BY-AGENT breakdown is withheld without `erp:agents:manage`, because a
 * league table of colleagues' confirmation rates is supervision data. LP.6
 * applies the same rule to its `agents` export format, and `notifySuspiciousCall`
 * withholds the same class of fact from the agent it is about.
 * ========================================================================== */

/**
 * The settlement-date twin of the caller's window.
 *
 * Orders are counted by `createdAt` and parcels by `deliveryOutcomeAt`, because
 * a parcel ordered in March and delivered in April belongs to March's order
 * count and April's delivered count. Folding either into the other produces a
 * month whose figures cannot be reconciled against anything — so the SAME window
 * is applied to the other column rather than reusing one filter for both.
 */
function bySettlementDate(
  where: Prisma.FulfillmentOrderWhereInput,
): Prisma.FulfillmentOrderWhereInput {
  const { createdAt, ...rest } = where as { createdAt?: unknown } & Prisma.FulfillmentOrderWhereInput;
  return createdAt
    ? { ...rest, deliveryOutcomeAt: createdAt as Prisma.DateTimeFilter }
    : rest;
}

export const GET = tenantRoute("erp:orders:read", async ({ db, session, searchParams }) => {
  const where = scopedWhere(session, orderFilters(searchParams));
  const settled = scopedWhere(session, bySettlementDate(orderFilters(searchParams)));

  const supervisor = can(session.auth!, "erp:agents:manage");
  const offered = ANALYTICS_DIMENSIONS.filter(
    (d) => supervisor || !SUPERVISION_DIMENSIONS.has(d),
  );

  // Sequentially, not `Promise.all`: every one of these is three aggregates on
  // the ONE interactive transaction `withTenant` opened, and firing twenty-one
  // at a single pinned connection is how P2028 timeouts start. The same reason
  // the payroll roster loop is sequential.
  const totals = await headline(db, where, settled);
  const dimensions: Record<string, unknown> = {};
  for (const dimension of offered) {
    dimensions[dimension] = await breakdown(db, where, dimension as Dimension);
  }

  return apiOk({
    headline: totals,
    dimensions,
    // Which dimensions this caller was given, so a screen renders what it was
    // actually sent rather than a table it has to guess is empty or withheld.
    offered,
  });
});
