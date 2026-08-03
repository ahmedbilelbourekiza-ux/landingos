import { tenantRoute, apiOk } from "@/lib/api/route";
import { listNotifications, unreadCount } from "@/lib/platform/notifications";

export const dynamic = "force-dynamic";

/* =============================================================================
 * This account's notification feed — M-16.
 *
 * A PLATFORM route, under `/api/platform`, because notifications are a platform
 * service: one feed per person spanning every product they use, one badge, and a
 * `product` field on each row so the console can label where it came from. A
 * product shipping its own would be N feeds and N badges for one person, which is
 * the same mistake `packages/product-registry` refuses for a Settings nav item.
 *
 * WHY `platform:notifications:read` GATES BOTH VERBS.
 *
 * It is not the authorization. `productOf("platform:…")` is null, so this is not
 * entitlement-gated, and every role from VIEWER up reaches it through the
 * `*:*:read` glob — which is exactly right: everybody may use their own
 * notifications. The real boundary is `targetUserId = me`, applied inside the
 * query, and no parameter on either verb can influence it.
 *
 * Marking your own notifications read is therefore not a privileged act, and
 * gating the POST on a `:write` permission would lock a MEMBER — the agent this
 * feature is mostly for — out of their own badge.
 * ========================================================================== */

export const GET = tenantRoute("platform:notifications:read", async ({ db, session, searchParams }) => {
  const [items, unread] = await Promise.all([
    listNotifications(db, session.user.id, {
      limit: Number(searchParams.get("limit")) || 50,
      beforeId: searchParams.get("beforeId"),
    }),
    unreadCount(db, session.user.id),
  ]);

  return apiOk({ items, unread });
});
