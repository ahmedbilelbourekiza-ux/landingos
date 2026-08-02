import { tenantRoute, apiOk, pagination } from "@/lib/api/route";
import { seesWholeBook } from "@/lib/erp/scope";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

/**
 * The follow-up (Suivi) queue.
 *
 * Record-scoped the same way orders are, and for the same reason: a follow-up
 * agent works their own queue. `hardening.test.js §7` exists because the ERP
 * accepted `?agent=` here and honoured it — so an agent could list a
 * colleague's tasks by asking. The parameter is accepted and IGNORED for anyone
 * who cannot see the whole book, which is what the contract test asserts.
 */
export const GET = tenantRoute("erp:orders:read", async ({ db, session, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams);

  const requested = searchParams.get("agentUserId")?.trim();
  const scope = seesWholeBook(session)
    ? (requested ? { agentUserId: requested } : {})
    : { agentUserId: session.user.id };

  const status = searchParams.get("status")?.trim();
  const where = { ...scope, ...(status ? { status } : {}) };

  const [items, total] = await Promise.all([
    db.followupTask.findMany({
      where,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      skip,
      take,
      select: {
        id: true, orderId: true, type: true, status: true, dueAt: true,
        agentUserId: true, reason: true, createdAt: true, resolvedAt: true,
      },
    }),
    db.followupTask.count({ where }),
  ]);

  return apiOk({ items: items.map(toJson), page, pageSize, total });
});
