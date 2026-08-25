import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import {
  triggerProductWebhook,
  triggerProductDeletedWebhook,
} from "@/lib/webhooks/tenant-triggers";

export const dynamic = "force-dynamic";

/* =============================================================================
 * BULK.1 — archive, restore or delete several landing pages at once.
 *
 * WHY A PARTIAL RESULT IS THE CONTRACT, and not an all-or-nothing transaction.
 * `DELETE /landings/[id]` refuses a page that has ever been ordered from
 * (LB.33/LB.34) — because deleting one cascades into its `SalesOrder` rows and
 * takes the revenue history with it. A merchant selecting twenty drafts and one
 * page that quietly sold something last month must not be told "that did not
 * work" and left to find the one; nineteen should go and the twentieth should
 * be NAMED. That is `OrderBulkBar`'s rule already: *"forty-nine of fifty is a
 * result, not a failure, and the one that did not move is exactly what a
 * person needs to know."*
 *
 * SO EACH ID IS ITS OWN DECISION, and the response reports per outcome. The
 * whole request still runs inside the wrapper's one transaction, so a thrown
 * error rolls everything back — but a REFUSAL is not an error, it is an
 * outcome, and it does not take its nineteen neighbours down with it.
 *
 * IDS ARE NOT TRUSTED. They arrive straight from a request, and every read and
 * write below goes through the tenant binding — a page belonging to another
 * company simply does not resolve, and is reported `not_found` rather than
 * denied, which tells a prober nothing they did not already supply.
 * ========================================================================== */

const MAX_IDS = 100;

const Body = z.object({
  action: z.enum(["archive", "restore", "delete"]),
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(MAX_IDS),
});

type Outcome = "done" | "not_found" | "has_orders" | "unchanged";

export const POST = tenantRoute("website-builder:pages:write", async ({ db, req, session, afterCommit }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { action, ids } = parsed.data;
  const tenantId = session.auth!.tenantId;

  // One read for the whole selection, not one per id — PERF-02's rule, and
  // the reason the bound `findMany` is also the tenant check.
  const unique = [...new Set(ids)];
  /* One read for the whole selection. For DELETE it has to be the full
     webhook shape: `product.deleted` cannot re-read a row that no longer
     exists, so the payload is built from a snapshot taken BEFORE the delete —
     LB.3's rule, which the single-page route follows too. */
  const rows = (await (db as any).landingPage.findMany({
    where: { id: { in: unique } },
    ...(action === "delete"
      ? {
          include: {
            media: { orderBy: { displayOrder: "asc" } },
            variants: { orderBy: { displayOrder: "asc" } },
            category: { select: { name: true } },
            _count: { select: { salesOrders: true, draftOrders: true } },
          },
        }
      : {
          select: { id: true, status: true, _count: { select: { salesOrders: true } } },
        }),
  })) as any[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const results: { id: string; outcome: Outcome }[] = [];
  const changed: string[] = [];
  const deleted: any[] = [];

  for (const id of unique) {
    const row = byId.get(id);
    if (!row) {
      results.push({ id, outcome: "not_found" });
      continue;
    }

    if (action === "delete") {
      /* LB.33's refusal, per id. A page that has ever been ordered from is
       * never deleted: the cascade would take the orders with it. Archive is
       * the door that IS open, and the bar says so. */
      if (row._count.salesOrders > 0) {
        results.push({ id, outcome: "has_orders" });
        continue;
      }
      await (db as any).landingPage.delete({ where: { id } });
      results.push({ id, outcome: "done" });
      deleted.push(row);
      continue;
    }

    const wantArchived = action === "archive";
    if ((row.status === "ARCHIVED") === wantArchived) {
      // Already where it is being sent. Not an error, and not a write.
      results.push({ id, outcome: "unchanged" });
      continue;
    }

    await (db as any).landingPage.update({
      where: { id },
      /* Archiving UNPUBLISHES too (LB.34), and restoring lands on DRAFT rather
       * than back on the storefront — putting a page on sale is its own
       * decision with its own permission, and a bulk restore must not make it
       * silently for twenty pages at once. */
      data: wantArchived
        ? { status: "ARCHIVED", published: false }
        : { status: "DRAFT", published: false },
    });
    results.push({ id, outcome: "done" });
    changed.push(id);
  }

  afterCommit(async () => {
    // Fired only after the transaction commits: a trigger re-reads through its
    // own binding, so from inside it would race the commit and find no row.
    for (const id of changed) triggerProductWebhook("product.updated", tenantId, id);
    for (const snapshot of deleted) triggerProductDeletedWebhook(tenantId, snapshot);
  });

  const count = (outcome: Outcome) => results.filter((r) => r.outcome === outcome).length;
  return apiOk({
    action,
    done: count("done"),
    unchanged: count("unchanged"),
    notFound: count("not_found"),
    // Named, not merely counted: these are the ones the merchant has to decide
    // about, and "3 could not be deleted" without saying WHICH is a dead end.
    hasOrders: results.filter((r) => r.outcome === "has_orders").map((r) => r.id),
    items: results,
  });
});
