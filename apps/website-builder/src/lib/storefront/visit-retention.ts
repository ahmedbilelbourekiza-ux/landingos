/* =============================================================================
 * Raw visit-row retention (AN.2 — user-decided: one month, then delete).
 *
 * WHY THE PRUNE RUNS WHERE IT RUNS — measured against what this deployment
 * actually executes, not what a scheduler diagram would like:
 *
 *   - `services/worker` is NOT deployed in production (HANDOFF §3), and the
 *     tick it drives fails closed without WORKER_SECRET. A prune that lived
 *     only there would be dead code the day it shipped.
 *   - So the prune is AMORTISED onto the paths traffic actually takes: a 2%
 *     dice on every accepted beacon write (the rate-limiter's own pattern —
 *     an active store cleans itself in proportion to its traffic), and every
 *     Traffic-screen render (a merchant who looks at analytics sweeps their
 *     own expired rows first, so the screen never reports over data it
 *     should not have).
 *   - The worker tick ALSO calls it, beside `pruneNotifications`, so the day
 *     the worker deploys, retention stops depending on traffic at all.
 *
 * All three callers share THIS function; the constant lives here and nowhere
 * else. Deletes are tenant-bound (the caller hands a bound client), so RLS
 * makes a cross-tenant prune impossible even if a caller is buggy.
 *
 * The 30-day line and the analytics windows agree on purpose: the screen
 * offers 7 and 30 days, so no window can outlive the raw rows behind it.
 * "Returning visitor" detection survives the prune because it is decided
 * client-side from localStorage (see the schema comment) — deleting old rows
 * loses no identity the platform ever held.
 *
 * NO IMPORTS, deliberately — the contract suite calls this directly against
 * fixture rows (the calc.ts rule).
 * ========================================================================== */

export const VISIT_RETENTION_DAYS = 30;

export function visitRetentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - VISIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** Delete this tenant's expired visit rows. Returns how many went. */
export async function pruneExpiredVisits(db: any): Promise<number> {
  const { count } = await db.storefrontVisit.deleteMany({
    where: { createdAt: { lt: visitRetentionCutoff() } },
  });
  return count;
}

/** The beacon's amortised dice — 2%, i.e. an active store prunes roughly
 * every fifty views. Injectable for determinism in tests. */
export function shouldAmortisedPrune(random: number = Math.random()): boolean {
  return random < 0.02;
}
