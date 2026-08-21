/* =============================================================================
 * Webhook destination guard (LB.6, G-02; refusals shared with SEC.7).
 *
 * A webhook URL is a place THIS SERVER will POST tenant data to, with retries,
 * on every order. Letting a tenant point it at 10.0.0.x or 169.254.169.254
 * turns the delivery worker into a proxy for probing whatever network the app
 * runs in (SSRF). Refused at configuration, by name.
 *
 * THE OLD HONEST LIMIT IS CLOSED: this file used to state that "a public DNS
 * name that later resolves to a private address (DNS rebinding) is not caught
 * here — that requires resolve-time pinning in the delivery layer, recorded
 * as hardening work." That work is SEC.7: `deliver.ts` now re-checks every
 * destination AS RESOLVED immediately before every attempt (see
 * `../net/outbound-guard.ts`, which also owns the refusal vocabulary this
 * gate applies). What THIS gate still closes is the direct, casual case — at
 * the moment of configuration, with a message a person can act on.
 *
 * Decimal/hex/octal IPv4 spellings (`https://2130706433/`) need no special
 * case — the WHATWG URL parser normalises them to dotted-quad before the
 * hostname is read, which the pure suite asserts.
 * ========================================================================== */

import { refuseOutboundUrl } from "../net/outbound-guard.ts";

/** Null when acceptable; a human-readable refusal otherwise. */
export function refuseWebhookUrl(raw: string): string | null {
  const reason = refuseOutboundUrl(raw, { protocols: ["https:"] });
  if (reason === null) return null;
  // The shared guard speaks about URLs in general; this surface owes the
  // operator webhook-specific wording (the strings the console maps today).
  if (reason === "That is not a valid URL.") return reason;
  if (reason.startsWith("The URL must use ")) return "A webhook endpoint must use https.";
  return "A webhook endpoint must be a public host — private and internal addresses are refused.";
}
