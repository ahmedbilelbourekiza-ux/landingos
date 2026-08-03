import { tenantRoute, apiOk } from "@/lib/api/route";
import { markRead, unreadCount } from "@/lib/platform/notifications";

export const dynamic = "force-dynamic";

/**
 * Advance this account's read state.
 *
 * `upToId` is the newest id the client has actually DISPLAYED, so a notification
 * arriving between render and click stays unread rather than being swallowed.
 * Anything unparseable means "everything I can currently see", which is what the
 * button says — a junk value must not be able to break somebody's badge, and the
 * ERP's version could: `{"upToId": 999999999}` parked its watermark in the future
 * and suppressed that account's badge until a million notifications had passed.
 *
 * See `markRead` for why no such state exists here to park.
 */
export const POST = tenantRoute("platform:notifications:read", async ({ db, req, session }) => {
  const body = (await req.json().catch(() => ({}))) as { upToId?: unknown };
  const marked = await markRead(db, session.user.id, body.upToId);
  return apiOk({ marked, unread: await unreadCount(db, session.user.id) });
});
