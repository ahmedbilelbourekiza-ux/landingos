import { tenantRoute, apiOk, pagination } from "@/lib/api/route";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * One conversation's history — YOURS.
 *
 * The identity comes from the session and nothing else. `actor` used to be a
 * query parameter, so naming somebody else read THEIR history; a `userId`
 * parameter is accepted here only to be ignored, which the contract test
 * asserts by passing another user's id and expecting an empty list.
 *
 * Append-only, like every other history in this product. The AI never edits
 * what was said, it adds to it.
 */
export const GET = tenantRoute<Params>("erp:ai:use", async ({ db, session, params, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams, 50);

  const where = { agentId: params.id === "general" ? null : params.id, userId: session.user.id };

  const [items, total] = await Promise.all([
    db.aiConversationMessage.findMany({
      where,
      orderBy: [{ ts: "asc" }, { id: "asc" }],
      skip,
      take,
      select: { id: true, role: true, content: true, tokenCount: true, ts: true },
    }),
    db.aiConversationMessage.count({ where }),
  ]);

  return apiOk({ items: items.map(toJson), page, pageSize, total });
});

/** Clear your own history. Nobody else's is reachable to clear. */
export const DELETE = tenantRoute<Params>("erp:ai:use", async ({ db, session, params }) => {
  const { count } = await db.aiConversationMessage.deleteMany({
    where: { agentId: params.id === "general" ? null : params.id, userId: session.user.id },
  });
  return apiOk({ cleared: count });
});
