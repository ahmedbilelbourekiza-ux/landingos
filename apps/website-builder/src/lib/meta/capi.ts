import { createHash } from "crypto";

import { withTenant } from "@landingos/db";
import { decryptToken } from "./crypto";

// Server-side Meta Conversions API sender. Sends a "Purchase" event to every
// currently-active MetaPixelConfig, using the order id as the shared
// event_id (there is no browser-side Purchase event in this app to
// deduplicate against — see the pixel-loader component for what the client
// side actually does: base pixel init only, for _fbp/fbc capture).
//
// This module never throws in a way that could block an order: every
// failure (missing configs, network error, Meta API error) is caught and
// logged. A customer's order always completes regardless of Meta delivery.

const GRAPH_API_VERSION = "v25.0"; // confirmed current stable as of 2026-07

function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// Meta expects hashed fields to be normalized: lowercase, trimmed, and for
// phone numbers, digits only (no spaces, dashes, or leading '+').
function sha256Phone(phone: string): string {
  return sha256(phone.replace(/[^\d]/g, ""));
}

export interface PurchaseEventInput {
  orderId: string;
  customerName: string;
  phone: string;
  totalPrice: number;
  currency: string;
  fbc?: string | null;
  fbp?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  return {
    first: parts[0] ?? "",
    last: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

function buildPayload(input: PurchaseEventInput) {
  const { first, last } = splitName(input.customerName);

  const userData: Record<string, string> = {
    ph: sha256Phone(input.phone),
    fn: sha256(first),
    country: sha256("dz"),
  };
  if (last) userData.ln = sha256(last);
  if (input.fbc) userData.fbc = input.fbc;
  if (input.fbp) userData.fbp = input.fbp;
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.userAgent) userData.client_user_agent = input.userAgent;

  return {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.orderId,
        action_source: "website",
        user_data: userData,
        custom_data: {
          currency: input.currency,
          value: String(input.totalPrice),
        },
      },
    ],
  };
}

async function sendToConfig(
  config: { id: string; label: string; pixelId: string; accessToken: string },
  payload: ReturnType<typeof buildPayload>,
): Promise<void> {
  const token = decryptToken(config.accessToken);
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${config.pixelId}/events?access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[meta-capi] pixel "${config.label}" (${config.pixelId}) rejected event: ${res.status} ${body}`,
      );
    }
  } catch (error) {
    console.error(`[meta-capi] pixel "${config.label}" (${config.pixelId}) request failed:`, error);
  }
}

// Fire-and-forget entry point. Callers should NOT await this on the
// customer-facing request path — call it, let it run, and return the
// response to the customer immediately.
export async function sendPurchaseEvent(input: PurchaseEventInput): Promise<void> {
  try {
    // Tenant-bound: a server-side conversion event must be sent with the
    // pixel belonging to the shop that made the sale, never every active
    // pixel on the platform.
    const activeConfigs = await withTenant(tenantId, (db: any) =>
      db.metaPixelConfig.findMany({
      where: { isActive: true },
      select: { id: true, label: true, pixelId: true, accessToken: true },
      }),
    );

    if (activeConfigs.length === 0) {
      console.log(`[meta-capi] order ${input.orderId}: no active pixel configs, skipping`);
      return;
    }

    const payload = buildPayload(input);
    await Promise.all(activeConfigs.map((config) => sendToConfig(config, payload)));
  } catch (error) {
    console.error(`[meta-capi] order ${input.orderId}: failed to send Purchase event:`, error);
  }
}
