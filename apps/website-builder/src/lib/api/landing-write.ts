import "server-only";

import { tenantRoute, type RouteContext } from "@/lib/api/route";
import { ensureSessionCheckpoint, type VersionActor } from "@/lib/landing/versions";
import type { ConsoleSession } from "@/lib/console/session";

/* =============================================================================
 * LB.14b — the ONE place a landing-page write is checkpointed.
 *
 * The scoping note for version history called this the hard part, and it was
 * right: the editor saves through eleven separate section routes and there is
 * no single write path to hang a snapshot on. "Hook all eleven" is the design
 * that fails, and it fails in a specific, already-observed way — `duplicate`
 * is the other piece of code that knows what a whole page is, and it silently
 * fell behind the schema FOUR times (LB.20, LB.35, LB.36, BH.1). A twelfth
 * save route added next month would inherit exactly that.
 *
 * So the checkpoint lives here, in one function, and the routes opt in by
 * being written with `landingWriteRoute` instead of `tenantRoute` — a
 * one-word difference at each call site with the whole rule behind it. What
 * makes that hold is not discipline: `builder-versions.test.ts` walks every
 * route file under `landings/[id]/`, and a mutating export that uses neither
 * this wrapper nor a NAMED exemption fails the suite. The twelfth route
 * cannot be forgotten quietly; it can only be exempted on purpose.
 *
 * WHAT IS DELIBERATELY NOT WRAPPED, and why — the same list the suite holds:
 *
 *   `duplicate` — writes a NEW page and does not touch this one. There is
 *   nothing here to undo, and the copy starts its own history.
 *
 *   `analyze` — writes a `LandingInsight`. Advice about the page is not a
 *   change to it.
 *
 *   `[id]` DELETE — versions cascade from the page, so a checkpoint taken
 *   here would be deleted by the very request that took it. The protection
 *   that matters for deletion already exists and is stronger: LB.33 refuses
 *   outright to delete a page that has ever been ordered from.
 *
 * The checkpoint runs INSIDE the request's tenant transaction, before the
 * handler. Two consequences worth stating: a handler that throws rolls its own
 * checkpoint back, and a handler that returns 422 keeps one. The second is
 * harmless and slightly useful — the snapshot is of the state before the
 * sitting's first attempted edit, which is the same state as before its first
 * successful one.
 * ========================================================================== */

/** Who to record against a version. Names are snapshotted, not joined. */
export function versionActor(session: ConsoleSession): VersionActor {
  return {
    sessionId: session.sessionId ?? null,
    userId: session.user?.id ?? null,
    userName: session.user?.name ?? null,
  };
}

/**
 * `tenantRoute`, plus decision 1: before the first write of an editing
 * session, store what the page looked like when that session began.
 *
 * The page id comes from `params.id`, which every route under
 * `landings/[id]/` already has. A page that does not resolve for this tenant
 * produces no version at all — the handler below it is about to 404, and a
 * checkpoint of nothing would be a row describing a page the caller cannot
 * see.
 */
export function landingWriteRoute<P extends { id: string }>(
  permission: string,
  handler: (ctx: RouteContext<P>) => Promise<Response> | Response,
) {
  return tenantRoute<P>(permission, async (ctx) => {
    await ensureSessionCheckpoint(
      ctx.db as any,
      ctx.params.id,
      versionActor(ctx.session),
      ctx.session.auth!.tenantId,
    );
    return handler(ctx);
  });
}
