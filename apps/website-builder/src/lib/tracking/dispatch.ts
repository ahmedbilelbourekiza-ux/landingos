import "server-only";

import { withTenant } from "@landingos/db";
import { revealStoredSecret } from "@/lib/meta/crypto";

import type { ServerTrackingEvent, TrackingDestination } from "./events.ts";
import { sendMetaEvent } from "./providers/meta.ts";
import { sendTiktokEvent } from "./providers/tiktok.ts";
import { sendGa4Event } from "./providers/ga4.ts";

/* =============================================================================
 * The server-side tracking dispatcher (LB.5).
 *
 * One entry point: `dispatchTrackingEvent(tenantId, event)`. It reads the
 * tenant's active integrations, decrypts each server token, and fans the ONE
 * canonical event out to every provider adapter that has a server side.
 * Adding a provider = one adapter module + one line in SENDERS. Nothing else
 * in the platform learns the provider exists.
 *
 * FIRE AND FORGET. Never awaited on a customer-facing path, never throws:
 * an ad platform being down is not a reason to slow down — let alone fail —
 * a customer's checkout. Per-destination failures are logged and isolated, so
 * one bad token does not stop the other destinations receiving the event.
 *
 * CALL AFTER COMMIT (or after withTenant returns): the read below opens its
 * own binding, which is its own transaction — called from inside the caller's
 * it would race the commit, the same trap the webhook triggers fell into.
 * ========================================================================== */

const SENDERS: Record<
  string,
  (destination: TrackingDestination, event: ServerTrackingEvent) => Promise<void>
> = {
  meta: sendMetaEvent,
  tiktok: sendTiktokEvent,
  ga4: sendGa4Event,
  // 'gtm' and 'google-ads' are browser-side only; the dispatcher skips them
  // by not listing them, which is the point of this map.
};

export function dispatchTrackingEvent(tenantId: string, event: ServerTrackingEvent): void {
  void (async () => {
    try {
      const rows = await withTenant(tenantId, (db) =>
        (db as any).trackingIntegration.findMany({
          where: { isActive: true, provider: { in: Object.keys(SENDERS) } },
          select: {
            id: true, provider: true, label: true, publicId: true,
            serverToken: true, testCode: true, settings: true,
          },
        }),
      );
      if (rows.length === 0) return;

      await Promise.all(
        rows.map(async (row: any) => {
          const sender = SENDERS[row.provider];
          if (!sender) return;
          try {
            const destination: TrackingDestination = {
              provider: row.provider,
              publicId: row.publicId,
              serverToken: row.serverToken ? revealStoredSecret(row.serverToken) : null,
              testCode: row.testCode ?? null,
              settings: (row.settings ?? {}) as Record<string, unknown>,
            };
            await sender(destination, event);
          } catch (error) {
            // Named per destination so an operator can tell WHICH pixel is
            // rejecting events from the server log.
            console.error(
              `[tracking] ${row.provider} "${row.label}" failed ${event.name} ${event.eventId}:`,
              error,
            );
          }
        }),
      );
    } catch (error) {
      console.error(`[tracking] dispatch failed for ${event.name} ${event.eventId}:`, error);
    }
  })();
}
