import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { triggerProductWebhook } from "@/lib/webhooks/tenant-triggers";

export const dynamic = "force-dynamic";
type Params = { id: string };

const Body = z.object({ archived: z.boolean().optional() });

/* =============================================================================
 * Archive a landing page, or bring it back (LB.33).
 *
 * WHY ARCHIVE IS THE DELETE. `SalesOrder.landingPage` is `onDelete: Cascade`,
 * and so are `SalesOrderStatusHistory` (through the order) and `DraftOrder`;
 * `FulfillmentOrder.salesOrder` is SetNull. So deleting the row a product was
 * sold from destroys that product's ENTIRE commercial history — every order,
 * every status transition, every captured lead — and orphans the ERP's
 * fulfilment records, silently and with no undo. A merchant retiring last
 * season's product is not asking for that, and the platform's stated posture
 * since LB.18 is that nothing is deleted: destruction must be a deliberate,
 * NAMED act (LB.27's argument for `deleteTenant`).
 *
 * There is a second, quieter reason. Since LB.30 the thank-you page reads
 * `order.landingPage.title` and its theme, so a past customer's confirmation
 * page needs the page row to still be there.
 *
 * NO MIGRATION: `LandingPageStatus.ARCHIVED` has existed since the port and
 * had no writer — `webhooks/payloads.ts` already maps it to "archived" for
 * subscribers. This gives the value its first one.
 *
 * Archiving UNPUBLISHES as well as marking status, because the storefront
 * filters on `published: true AND status: PUBLISHED` — setting one without the
 * other would leave a row that is archived in the console and still on sale.
 * ========================================================================== */
export const POST = tenantRoute<Params>(
  "website-builder:pages:publish",
  async ({ db, req, params, session, afterCommit }) => {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    const archived = parsed.success ? parsed.data.archived ?? true : true;

    const page = await (db as any).landingPage.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });
    if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");

    await (db as any).landingPage.updateMany({
      where: { id: params.id },
      data: archived
        ? { status: "ARCHIVED", published: false }
        : // Restoring returns a page to DRAFT, never straight to PUBLISHED:
          // putting a page back on sale is the publish decision, and it has
          // its own permission and its own publishability checks.
          { status: "DRAFT", published: false },
    });

    const tenantId = session.auth!.tenantId;
    afterCommit(() => {
      // `product.updated`, not `product.deleted` — the row is still there, and
      // the payload's status field already carries "archived" for the
      // subscriber that cares (payloads.ts `productStatus`).
      triggerProductWebhook("product.updated", tenantId, params.id);
    });

    return apiOk({ id: params.id, status: archived ? "ARCHIVED" : "DRAFT", published: false });
  },
);
