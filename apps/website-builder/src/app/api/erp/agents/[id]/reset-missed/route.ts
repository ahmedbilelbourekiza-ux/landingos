import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { readAgentConfig, writeAgentConfig } from "@/lib/erp/agents";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Put an agent's missed-order counter back to zero — LP.12, restoring R14.
 *
 * **THE COUNTER ONLY EVER ROSE.** The overdue sweep increments `missedOrders`
 * every time an order sits with an agent past `reassignMinutes` with no call
 * logged, and `autoSuspend` locks the account out at `suspendThreshold`.
 * Nothing could reset it — so every agent eventually trips auto-suspension with
 * no way back except editing a `ProductSetting` row by hand, and the trap gets
 * worse the longer the deployment runs. R14 rates it Medium–High for exactly
 * that reason: it is latent, and uptime is what triggers it.
 *
 * IT DOES NOT REACTIVATE. Clearing the counter and lifting a suspension are two
 * different decisions — a supervisor may want the count forgiven and the account
 * still locked while they talk to somebody — so reactivation stays where it is,
 * on `POST /agents/[id]/suspend`'s counterpart. The response says what the
 * suspension state still is, so the screen can offer the second step.
 *
 * `erp:agents:manage`, and an AUDIT ROW, because forgiving an accountability
 * counter is exactly the kind of act somebody should be able to ask about later.
 */
export const POST = tenantRoute<Params>("erp:agents:manage", async ({ db, session, params }) => {
  const membership = await db.membership.findFirst({
    where: { userId: params.id },
    select: { userId: true, suspended: true },
  });
  // 404 for somebody who is not on this team — confirming a row exists
  // elsewhere is itself information.
  if (!membership) return apiError(404, "NOT_FOUND", "No such team member.");

  const tenantId = session.auth!.tenantId;
  const before = await readAgentConfig(db, tenantId, params.id);

  const config = await writeAgentConfig(db, tenantId, params.id, { missedOrders: 0 });

  await db.auditEvent.create({
    data: {
      tenantId,
      product: "erp",
      entity: "agent",
      entityId: params.id,
      action: "reset-missed",
      userId: session.user.id,
      payload: { from: before.missedOrders, to: 0 },
    },
  });

  return apiOk({
    userId: params.id,
    missedOrders: config.missedOrders,
    was: before.missedOrders,
    // Stated rather than assumed: clearing the counter is not the same decision
    // as lifting the lockout, and a screen that conflated them would reactivate
    // somebody a supervisor deliberately left suspended.
    suspended: membership.suspended,
  });
});
