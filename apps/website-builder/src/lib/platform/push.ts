import "server-only";

import webpush from "web-push";

import type { TenantDb } from "@landingos/db";

/* =============================================================================
 * Web Push — M-16, part 2.
 *
 * The other half of the transport, and the half that works when nobody has the
 * console open. SSE reaches a tab; this reaches a locked phone, which for a
 * confirmation agent between calls is the case that matters.
 *
 * -----------------------------------------------------------------------------
 * IT IS ALWAYS AN ADDITION, NEVER A REPLACEMENT.
 *
 * Every notification is stored first and pushed afterwards, and a push that
 * fails changes nothing about what the feed shows. A deployment with no VAPID
 * keys is fully functional: it simply does not ring anybody's phone.
 *
 * VAPID KEYS MUST BE STABLE ACROSS DEPLOYS. Generating a pair at boot — which
 * reads as convenient — invalidates every stored subscription on every restart,
 * silently: the browser keeps its subscription, the push service rejects the
 * request, and nobody's phone rings again. They are configuration.
 *
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   `npx web-push generate-vapid-keys`
 *   VAPID_SUBJECT                          mailto: or https:, for the push service
 *
 * -----------------------------------------------------------------------------
 * A SUBSCRIPTION THE PUSH SERVICE HAS DISOWNED IS DELETED.
 *
 * 404 and 410 mean the endpoint is gone — the app was uninstalled, the browser
 * profile was wiped. Keeping it means retrying forever against a dead endpoint
 * every time anything happens. Any other error is logged and the row kept: a
 * push service having a bad five minutes is not a reason to unsubscribe a
 * working device.
 * ========================================================================== */

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@landingos.app";

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  } catch (error) {
    // A malformed key is a configuration mistake and must be loud — otherwise
    // it presents as "push silently does nothing", which is also what an
    // unconfigured deployment looks like.
    console.error("[push] VAPID keys were rejected; push is disabled", error);
  }
}

/** The public half, which the browser needs to subscribe. Null when unconfigured. */
export const vapidPublicKey = (): string | null => (configured ? PUBLIC_KEY : null);

export const pushConfigured = (): boolean => configured;

export interface BrowserSubscription {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

/** Shape check on something a browser handed us, before it reaches the database. */
export function parseSubscription(input: unknown): BrowserSubscription | null {
  const sub = (input ?? {}) as Record<string, unknown>;
  const keys = (sub.keys ?? {}) as Record<string, unknown>;
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint.trim() : "";
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";

  // An endpoint is a URL issued by a push service. Refusing anything else stops
  // the table becoming somewhere to park arbitrary strings.
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 2000) return null;
  if (!p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/**
 * Record a device for this user.
 *
 * Keyed on the endpoint, which is unique BY CONSTRUCTION — the push service
 * issues it — and deliberately global rather than per tenant (see
 * `packages/db/CONSTRAINTS.md`): scoping it per tenant would let one physical
 * device register twice and receive every notification in duplicate.
 *
 * An upsert, so re-subscribing the same device moves it to whoever is signed in
 * on it now rather than failing. That is the correct behaviour on a shared
 * handset in a call centre.
 */
export async function saveSubscription(
  db: TenantDb,
  tenantId: string,
  userId: string,
  sub: BrowserSubscription,
): Promise<void> {
  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      tenantId, userId,
      endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
    },
    update: { tenantId, userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
}

export async function removeSubscription(db: TenantDb, endpoint: string): Promise<number> {
  const { count } = await db.pushSubscription.deleteMany({ where: { endpoint } });
  return count;
}

/**
 * Ring every device these people have registered.
 *
 * Never throws, and never awaited by anything that would be undone by a failure
 * — the notification is already stored, and this is the extra hop.
 */
export async function pushToUsers(
  db: TenantDb,
  userIds: readonly string[],
  payload: { readonly title: string; readonly body: string; readonly url?: string },
): Promise<number> {
  if (!configured || userIds.length === 0) return 0;

  const subs = await db.pushSubscription.findMany({
    where: { userId: { in: [...userIds] } },
    select: { endpoint: true, p256dh: true, auth: true },
  });
  if (subs.length === 0) return 0;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/console",
  });

  let sent = 0;
  const dead: string[] = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      );
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) dead.push(sub.endpoint);
      else console.error("[push] send failed", { status, error });
    }
  }

  if (dead.length) {
    await db.pushSubscription.deleteMany({ where: { endpoint: { in: dead } } });
  }
  return sent;
}
