import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { revealStoredSecret } from "@/lib/meta/crypto";
import { endUserIp } from "@/lib/storefront/rate-limit";
import { currentOrigin } from "@/lib/storefront/resolve-tenant";
import { buildMetaPayload, postMetaEvents } from "@/lib/tracking/providers/meta";
import type { ServerTrackingEvent } from "@/lib/tracking/events";

export const dynamic = "force-dynamic";
type Params = { id: string };

/* =============================================================================
 * "Send test event" for a Meta integration (CAPI.1).
 *
 * Sends ONE synthetic event through the exact production payload builder and
 * sender, tagged with a test_event_code so it lands in Events Manager → Test
 * events, and answers with what Meta said (events_received, fbtrace_id, or
 * Meta's own error text — which names an expired token or a wrong dataset id
 * precisely). Synchronous on purpose, unlike the storefront dispatcher: the
 * person clicking the button is waiting for exactly this answer.
 *
 * A test code is REQUIRED. Without one the "test" would be a real event in the
 * merchant's live data, which is the thing a test exists to avoid.
 *
 * The Meta call runs in afterCommit — after the tenant transaction released
 * its connection — so a slow Graph API never holds a database connection.
 * ========================================================================== */

const Body = z.object({
  eventName: z.enum(["ViewContent", "AddToCart", "InitiateCheckout", "Purchase"]).default("ViewContent"),
  /** Overrides the saved code for this one send. */
  testCode: z.string().trim().min(1).max(80).optional(),
});

export const POST = tenantRoute<Params>(
  "platform:integrations:manage",
  async ({ db, req, params, afterCommit }) => {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

    const row = await (db as any).trackingIntegration.findUnique({
      where: { id: params.id },
      select: { provider: true, publicId: true, serverToken: true, testCode: true },
    });
    if (!row) return apiError(404, "NOT_FOUND", "That integration does not exist.");
    if (row.provider !== "meta") {
      return apiError(422, "TEST_UNSUPPORTED", "Test sending is available for Meta integrations.");
    }
    if (!row.serverToken) {
      return apiError(422, "NO_SERVER_TOKEN", "Add the Conversions API access token first.");
    }
    const testCode = parsed.data.testCode ?? row.testCode;
    if (!testCode) {
      return apiError(
        422,
        "NO_TEST_CODE",
        "Copy the test code from Events Manager → your dataset → Test events, and save it first.",
      );
    }

    // The vetted public host (the checkout's rule, LB.43) — `req.url` behind
    // the standalone server reads as the bind address, e.g. http://0.0.0.0.
    const origin = (await currentOrigin()) ?? new URL(req.url).origin;
    const eventId = `test_${Date.now().toString(36)}`;
    const isPurchase = parsed.data.eventName === "Purchase";

    // Recognisable test data, hashed exactly as a real order would be, so the
    // Test events tab shows which match keys arrive (phone, name, city, state,
    // country, IP, user agent).
    const event: ServerTrackingEvent = {
      name: parsed.data.eventName,
      eventId,
      value: 1000,
      currency: "DZD",
      contentId: "landingos-test",
      contentName: "LandingOS test event",
      quantity: 1,
      customer: isPurchase || parsed.data.eventName === "InitiateCheckout"
        ? { name: "Test Customer", phone: "0555000000", city: "Alger Centre", state: "Alger" }
        : undefined,
      context: {
        ip: endUserIp(req),
        userAgent: req.headers.get("user-agent"),
        url: `${origin}/`,
      },
    };

    let token: string;
    try {
      token = revealStoredSecret(row.serverToken);
    } catch {
      return apiError(422, "TOKEN_UNREADABLE", "The saved token cannot be decrypted — paste it again.");
    }

    afterCommit(async () => {
      try {
        const reply = await postMetaEvents(row.publicId, token, buildMetaPayload(event, testCode));
        return apiOk({
          eventId,
          eventName: event.name,
          testCode,
          eventsReceived: reply.events_received ?? null,
          fbtraceId: reply.fbtrace_id ?? null,
          messages: reply.messages ?? [],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return apiError(502, "META_REJECTED", message.slice(0, 400));
      }
    });

    // Replaced by the afterCommit response; returned only if that never runs.
    return apiError(500, "INTERNAL_ERROR", "Something went wrong.");
  },
);
