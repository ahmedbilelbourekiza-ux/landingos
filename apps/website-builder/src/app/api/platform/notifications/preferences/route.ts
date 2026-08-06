import { tenantRoute, apiOk } from "@/lib/api/route";
import { readNotifyPrefs, writeNotifyPrefs } from "@/lib/platform/notify-prefs";

export const dynamic = "force-dynamic";

/* =============================================================================
 * How this person wants to be told — LP.11, N4 and N5.
 *
 * THE CALLER'S OWN PREFERENCE AND NOBODY ELSE'S. There is no `userId` in the
 * query, in the body, or anywhere else: the session's own id is used. An
 * endpoint that accepted a target would let one operator silence another's
 * manipulation siren — the alert that exists to catch an agent marking orders
 * confirmed without dialling — which is the one notification a person has a
 * motive to turn off for somebody else.
 *
 * Gated on `platform:notifications:read` for both methods, deliberately. It is
 * the permission that says "you have a notification feed at all"; inventing a
 * `:write` for a person's own volume slider would be a permission nobody could
 * meaningfully grant or withhold, since anyone with a feed needs to configure
 * it.
 * ========================================================================== */

export const GET = tenantRoute("platform:notifications:read", async ({ db, session }) =>
  apiOk(await readNotifyPrefs(db, session.user.id)),
);

export const PUT = tenantRoute("platform:notifications:read", async ({ db, req, session }) => {
  const body = await req.json().catch(() => ({}));
  // Every field is coerced and the volume clamped in `writeNotifyPrefs`; a
  // stored 40 would be forty times the gain the envelopes were designed for.
  const saved = await writeNotifyPrefs(db, session.auth!.tenantId, session.user.id, body);
  return apiOk(saved);
});
