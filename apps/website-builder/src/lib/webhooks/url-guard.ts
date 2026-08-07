/* =============================================================================
 * Webhook destination guard (LB.6, G-02).
 *
 * A webhook URL is a place THIS SERVER will POST tenant data to, with retries,
 * on every order. Letting a tenant point it at 10.0.0.x or 169.254.169.254
 * turns the delivery worker into a proxy for probing whatever network the app
 * runs in (SSRF). Refused at configuration, by name.
 *
 * HONEST LIMIT, stated: this checks the hostname as WRITTEN. A public DNS name
 * that later resolves to a private address (DNS rebinding) is not caught here —
 * that requires resolve-time pinning in the delivery layer, recorded as
 * hardening work in the handoff. What this closes is the direct, casual case.
 * ========================================================================== */

const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^0\.0\.0\.0$/,
  // IPv4 loopback and private ranges.
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  // Link-local, incl. every cloud metadata service.
  /^169\.254\./,
  // Carrier-grade NAT.
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  // IPv6 loopback, link-local, unique-local (bracketed or bare).
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?f[cd][0-9a-f]{2}:/i,
];

/** Null when acceptable; a human-readable refusal otherwise. */
export function refuseWebhookUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That is not a valid URL.";
  }
  if (url.protocol !== "https:") {
    return "A webhook endpoint must use https.";
  }
  const host = url.hostname;
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) {
      return "A webhook endpoint must be a public host — private and internal addresses are refused.";
    }
  }
  return null;
}
