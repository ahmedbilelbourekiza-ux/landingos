import "server-only";

import { withTenant, type TenantDb } from "@landingos/db";

import { apiError } from "@/lib/api/route";
import { readSettings } from "./settings";

/* =============================================================================
 * Is this company's finance module switched on? — LB.18.
 *
 * ONE reader, used by three kinds of caller, because the alternative is three
 * copies of `settings.financeEnabled !== false` that eventually disagree:
 *
 *   1. The ERP's segment layout, to decide which nav items the shell hides.
 *   2. The finance and calculator SCREENS, which 404 when it is off — a nav
 *      item is a hint and the URL is typeable, the same rule that put explicit
 *      checks in the clients, finance and agents pages.
 *   3. The finance ROUTES, which refuse when it is off. Without this a module
 *      the merchant switched off still accepts writes from anything holding a
 *      session, and "removed" would mean "the link is gone".
 *
 * WHY IT READS `!== false` AND NOT `=== true`. `readSettings` overlays stored
 * rows onto `DEFAULT_SETTINGS`, so a tenant with no row reads the default
 * `true`. Testing for an explicit `false` means a corrupt or half-written row
 * fails OPEN — the module stays visible — which is the right direction for a
 * switch that only hides things. Failing closed would hide a company's books
 * because one settings row went strange, and the books are still behind
 * `erp:finance:read` either way.
 * ========================================================================== */

/** Decides the question from already-loaded settings. */
export function financeEnabled(settings: { financeEnabled?: unknown }): boolean {
  return settings.financeEnabled !== false;
}

/**
 * The same answer, for a caller that has a tenant but no settings in hand.
 *
 * Opens its own binding, so it is one extra indexed read on the paths that use
 * it. Deliberately NOT cached: a merchant who switches the module off expects
 * the next screen to reflect it, and a stale cache would make the control look
 * broken.
 */
export async function financeEnabledFor(tenantId: string): Promise<boolean> {
  try {
    return await withTenant(tenantId, async (db) => financeEnabled(await readSettings(db)));
  } catch {
    // Same reasoning as the shell's unread badge: this is chrome, and a
    // database blip is not worth a 500 on every ERP screen. Failing open shows
    // a module that is still permission-gated.
    return true;
  }
}

/**
 * The route-side guard.
 *
 * Takes the binding the handler already has rather than opening a second one —
 * `tenantRoute` hands every handler a bound `db`, and a nested `withTenant`
 * would be a second connection inside an open transaction.
 *
 * Returns a Response to return, or null to carry on. Written that way so the
 * call site reads as one line and cannot forget to return:
 *
 *     const off = await refuseIfFinanceOff(db);
 *     if (off) return off;
 *
 * 404 rather than 403, matching the screens' `notFound()`: for this tenant the
 * module is not there. A distinct CODE rather than the generic NOT_FOUND
 * because this refusal names its own fix, which is the reason
 * `action-errors.ts` gives NO_CARRIER a message of its own.
 */
export async function refuseIfFinanceOff(db: TenantDb): Promise<Response | null> {
  if (financeEnabled(await readSettings(db))) return null;
  return apiError(
    404,
    "FINANCE_DISABLED",
    "The finance module is switched off for this company.",
  );
}
