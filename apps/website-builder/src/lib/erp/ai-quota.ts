import { withTenant, type TenantDb } from "@landingos/db";

/* =============================================================================
 * The AI spend quota (AQ.1) — the piece LB.24 §open-1 and BH §6.4 both wait on.
 *
 * Every feature that spends a tenant's AI key goes through ONE lifecycle:
 *
 *   reserve — count this month's ledger + insert a `pending` AiUsageEvent,
 *             inside the route wrapper's tenant transaction (plan phase).
 *             Over the limit → the caller refuses with 429 AI_QUOTA_EXCEEDED
 *             and the model is never contacted.
 *   settle  — after the call, mark the row ok/failed and record the token
 *             counts the provider reported (record phase).
 *   release — delete the row iff the call was never attempted (a pre-call
 *             refusal, e.g. an unreadable photo). Releasing after a call
 *             fired would un-count real spend, so callers may only release
 *             on paths the provider was provably never reached from.
 *
 * THE UNIT IS CALLS, NOT TOKENS OR MONEY, and the reason is enforcement
 * order: the quota must refuse BEFORE the spend, and before the call neither
 * the token count nor the bill exists to be measured. A call's cost is
 * already bounded by the existing machinery (the prompt builders bound the
 * input; `maxTokens` floors/caps the output), so N calls IS a spend ceiling
 * — not a proxy for one. Token counts are recorded opportunistically for the
 * usage display; they are never what the gate reads.
 *
 * THE WINDOW IS THE UTC CALENDAR MONTH. Predictable for the merchant ("it
 * resets on the 1st"), cheap to compute, and immune to the sliding-window
 * bookkeeping a rolling 30 days would need.
 *
 * THE LIMIT: `DEFAULT_MONTHLY_AI_CALLS`, overridable PER TENANT by a
 * ProductSetting row (product "platform-ai", key "monthlyCallLimit").
 * Deliberately NOT part of the ERP settings vocabulary in
 * `lib/erp/settings.ts` — that schema feeds a merchant-editable screen, and
 * a ceiling the spender can raise is not a ceiling. Nothing writes this row
 * from the console today; it is platform-set (0 is valid and means "AI off
 * for this tenant").
 *
 * Failed calls COUNT. An upstream 500, an empty answer or a timeout may all
 * have billed the tenant's key, and counting attempts also stops a client
 * loop from hammering a failing provider 200 times for free. The usage
 * surfaces show the failed share so a merchant can see the difference.
 *
 * Connection tests (`/api/erp/ai/providers/[id]/test`) do NOT go through
 * this ledger, deliberately: two of the three adapters call a free
 * models-list endpoint and the third is a max_tokens:1 ping; the route is
 * gated `erp:settings:write` and human-paced. Metering it would charge
 * merchants quota for checking their own credential.
 *
 * Concurrency, stated honestly: two reservations racing the last slot can
 * both pass the count and overshoot the limit by the burst width. The
 * ceiling still holds within one call of itself per concurrent request, and
 * the next reservation refuses. Serializing on a lock was considered and
 * declined — a quota is a spend bound, not an accounting invariant.
 *
 * No `server-only`, the ai-complete.ts rule: nothing here holds a secret,
 * and the window math must be assertable from a node test. Nothing here may
 * be imported by a client component.
 * ========================================================================== */

export const DEFAULT_MONTHLY_AI_CALLS = 200;

/** The ProductSetting address of the per-tenant override. */
export const AI_QUOTA_PRODUCT = "platform-ai";
export const AI_QUOTA_LIMIT_KEY = "monthlyCallLimit";

export type AiCallKind = "landing_generation" | "behavior_insight";

export interface AiUsage {
  readonly limit: number;
  /** Every attempt this month: ok + failed + still-pending. */
  readonly used: number;
  readonly failed: number;
  readonly remaining: number;
  /** First instant of the next UTC month — when `used` returns to 0. */
  readonly resetsAt: Date;
}

export type AiReservation =
  | { readonly ok: true; readonly eventId: string; readonly usage: AiUsage }
  | { readonly ok: false; readonly usage: AiUsage };

export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextMonthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** A stored override must be a non-negative integer to count; anything else
 * falls back to the default rather than becoming an accidental 0 or NaN gate. */
export function parseLimitOverride(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

async function limitFor(db: TenantDb): Promise<number> {
  const row = await db.productSetting.findFirst({
    where: { product: AI_QUOTA_PRODUCT, key: AI_QUOTA_LIMIT_KEY },
    select: { value: true },
  });
  return parseLimitOverride(row?.value) ?? DEFAULT_MONTHLY_AI_CALLS;
}

/** The month's numbers, for the gate and for every usage surface. */
export async function readAiUsage(db: TenantDb, now: Date = new Date()): Promise<AiUsage> {
  const since = monthStartUtc(now);
  const [limit, used, failed] = await Promise.all([
    limitFor(db),
    (db as any).aiUsageEvent.count({ where: { createdAt: { gte: since } } }),
    (db as any).aiUsageEvent.count({ where: { createdAt: { gte: since }, status: "failed" } }),
  ]);
  return { limit, used, failed, remaining: Math.max(0, limit - used), resetsAt: nextMonthStartUtc(now) };
}

/**
 * Claim one call against the month, or refuse. Call INSIDE the route
 * wrapper's tenant transaction, before the provider is contacted.
 */
export async function reserveAiCall(
  db: TenantDb,
  tenantId: string,
  kind: AiCallKind,
  snapshot?: { readonly provider?: string | null; readonly model?: string | null },
): Promise<AiReservation> {
  const usage = await readAiUsage(db);
  if (usage.used >= usage.limit) {
    return { ok: false, usage };
  }
  const event = await (db as any).aiUsageEvent.create({
    data: {
      tenantId,
      kind,
      provider: snapshot?.provider ?? null,
      model: snapshot?.model ?? null,
      status: "pending",
    },
    select: { id: true },
  });
  return { ok: true, eventId: event.id, usage };
}

/**
 * Record how the call ended. Runs in its own short transaction because its
 * callers sit in the post-commit phase with no transaction open. Never
 * throws: the ledger is bookkeeping beside the merchant's real result, and
 * a bookkeeping failure must not turn a created page into a 500.
 */
export async function settleAiCall(
  tenantId: string,
  eventId: string,
  outcome: {
    readonly ok: boolean;
    readonly promptTokens?: number | null;
    readonly completionTokens?: number | null;
  },
): Promise<void> {
  try {
    await withTenant(tenantId, (tx) =>
      (tx as any).aiUsageEvent.update({
        where: { id: eventId },
        data: {
          status: outcome.ok ? "ok" : "failed",
          promptTokens: outcome.promptTokens ?? null,
          completionTokens: outcome.completionTokens ?? null,
        },
      }),
    );
  } catch (error) {
    console.error(`[ai-quota] settle ${eventId}`, error);
  }
}

/**
 * Un-count a reservation whose call was NEVER attempted. Only legal on paths
 * that provably return before the provider is contacted. Never throws, same
 * reasoning as settle.
 */
export async function releaseAiCall(tenantId: string, eventId: string): Promise<void> {
  try {
    await withTenant(tenantId, (tx) =>
      (tx as any).aiUsageEvent.delete({ where: { id: eventId } }),
    );
  } catch (error) {
    console.error(`[ai-quota] release ${eventId}`, error);
  }
}
