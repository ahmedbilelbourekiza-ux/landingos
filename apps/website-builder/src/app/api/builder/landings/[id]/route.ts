import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { triggerProductDeletedWebhook } from "@/lib/webhooks/tenant-triggers";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * A single landing page.
 *
 * Fetching by id needs no tenant check in the query: the binding means another
 * tenant's id simply does not resolve, so this returns 404 rather than leaking
 * that the row exists elsewhere.
 */
export const GET = tenantRoute<Params>("website-builder:read", async ({ db, params }) => {
  const page = await (db as any).landingPage.findUnique({
    where: { id: params.id },
    include: {
      category: { select: { id: true, name: true } },
      media: { orderBy: { displayOrder: "asc" } },
      variants: { orderBy: { displayOrder: "asc" } },
      features: { orderBy: { displayOrder: "asc" } },
      reviews: { orderBy: { displayOrder: "asc" } },
      faqs: { orderBy: { displayOrder: "asc" } },
      setting: true,
    },
  });

  if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");
  return apiOk(page);
});

/**
 * Hard delete — and it REFUSES when there is commercial history to lose.
 *
 * `SalesOrder.landingPage` is `onDelete: Cascade`. So is the order's status
 * history, and so is `DraftOrder`; `FulfillmentOrder.salesOrder` is SetNull.
 * Before LB.33 this route would happily take a page that had sold a hundred
 * orders and take the orders with it — no warning, no undo, and the console
 * offered no button so nobody had noticed. The guard below is the fix: a page
 * that has ever been ordered from cannot be deleted, only archived
 * (`POST /archive`), which is what the console now offers.
 *
 * A page with NO orders is still genuinely deletable, because a mistyped draft
 * should be able to actually go away rather than clutter an archive forever.
 */
export const DELETE = tenantRoute<Params>("website-builder:pages:write", async ({ db, params, session, afterCommit }) => {
  // The webhook payload is built from a snapshot taken BEFORE the delete —
  // there is no row to re-read afterwards (LB.3).
  const snapshot = await (db as any).landingPage.findUnique({
    where: { id: params.id },
    include: {
      media: { orderBy: { displayOrder: "asc" } },
      variants: { orderBy: { displayOrder: "asc" } },
      category: { select: { name: true } },
      _count: { select: { salesOrders: true, draftOrders: true } },
    },
  });
  if (!snapshot) return apiError(404, "NOT_FOUND", "That page does not exist.");

  if (snapshot._count.salesOrders > 0) {
    return apiError(
      409,
      "HAS_ORDERS",
      "This page has orders, and deleting it would delete them too. Archive it instead — it stays out of the catalogue and off the storefront, and its orders keep working.",
    );
  }

  const { count } = await (db as any).landingPage.deleteMany({ where: { id: params.id } });
  if (count === 0) return apiError(404, "NOT_FOUND", "That page does not exist.");

  const tenantId = session.auth!.tenantId;
  afterCommit(async () => {
    if (snapshot) triggerProductDeletedWebhook(tenantId, snapshot);
  });

  return apiOk({ id: params.id });
});
