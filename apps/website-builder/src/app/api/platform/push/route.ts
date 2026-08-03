import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import {
  parseSubscription, saveSubscription, removeSubscription, vapidPublicKey,
} from "@/lib/platform/push";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Web Push device registration — M-16, part 2.
 *
 * Gated on `platform:notifications:read`, for the same reason the feed is: every
 * signed-in member may register their own device, and the real boundary is that
 * a subscription is stored against the CALLER — never against a user id in the
 * body. The ERP's version took `{ agent, subscription }` from the request, so
 * anybody could register a device to receive another person's notifications.
 * ========================================================================== */

/**
 * The public key the browser needs before it can subscribe.
 *
 * Public by definition — it is handed to every client and travels in the
 * subscription request. `null` when the deployment has not configured VAPID, so
 * a console can say "push is unavailable" rather than failing at `subscribe()`
 * with a browser error nobody can read.
 */
export const GET = tenantRoute("platform:notifications:read", async () =>
  apiOk({ publicKey: vapidPublicKey() }),
);

export const POST = tenantRoute("platform:notifications:read", async ({ db, req, session }) => {
  const body = (await req.json().catch(() => ({}))) as { subscription?: unknown };
  const sub = parseSubscription(body.subscription ?? body);
  if (!sub) {
    return apiError(422, "INVALID_SUBSCRIPTION", "A push subscription with an endpoint and keys is required.");
  }

  // The user comes from the SESSION, never from the body.
  await saveSubscription(db, session.auth!.tenantId, session.user.id, sub);
  return apiOk({ subscribed: true });
});

/**
 * Unregister a device.
 *
 * By endpoint, which is what the browser has to hand when it unsubscribes. The
 * endpoint is unguessable and issued by the push service, and the row is
 * tenant-scoped, so a caller cannot delete a subscription belonging to another
 * company: the binding sees to that and RLS enforces it.
 */
export const DELETE = tenantRoute("platform:notifications:read", async ({ db, req }) => {
  const body = (await req.json().catch(() => ({}))) as { endpoint?: unknown };
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) return apiError(422, "INVALID_INPUT", "An endpoint is required.");

  return apiOk({ removed: await removeSubscription(db, endpoint) });
});
