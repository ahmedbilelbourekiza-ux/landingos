/* =============================================================================
 * Rate limiting for the PUBLIC storefront writes (LB.6, G-01).
 *
 * NO `server-only` directive, deliberately: the module holds no secret and the
 * sliding-window arithmetic is pure, so the test suite imports it directly
 * (the calc.ts rule). Only routes import it in production.
 *
 * Checkout and draft capture are the two unauthenticated writes on the
 * platform, and fake COD orders cost a real store real money — every accepted
 * junk order is a courier dispatched and a call agent's time. This is the
 * narrow, per-route bound the audit called for; the platform-wide limiter
 * (login throttling, API backstop) remains Tier-4 work.
 *
 * In-memory sliding window, per IP per bucket. HONEST ABOUT ITS SCOPE: state
 * is per process, so on a multi-instance deployment the effective limit is
 * N × the configured one — still a bound, just a looser one. A shared-store
 * limiter is the upgrade path and this module is the one place it would go.
 * Buckets are pruned on write so the map cannot grow unboundedly (the legacy
 * limiter's leak, fixed once already in its history).
 */

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

/** Prune + count + record in one pass. Returns true when ALLOWED. */
export function allowRequest(
  bucket: string,
  ip: string,
  limit: number,
  windowMs: number,
): boolean {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const cutoff = now - windowMs;

  const entry = buckets.get(key);
  const kept = entry ? entry.timestamps.filter((t) => t > cutoff) : [];

  if (kept.length >= limit) {
    // Still store the pruned list — otherwise a hammering client keeps stale
    // entries alive forever.
    buckets.set(key, { timestamps: kept });
    return false;
  }

  kept.push(now);
  buckets.set(key, { timestamps: kept });

  // Opportunistic global prune, amortised: every ~500th call sweeps dead keys
  // so thousands of one-visit IPs do not accumulate (the legacy leak).
  if (Math.random() < 0.002) {
    for (const [k, v] of buckets) {
      if (v.timestamps.every((t) => t <= cutoff)) buckets.delete(k);
    }
  }
  return true;
}

/** The caller's IP as the proxy reported it; "unknown" still gets a bucket so
 * a proxyless deployment is bounded rather than unlimited. */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Deploy-tunable limits, read at call time. The defaults are the product
 * decision; the env overrides exist for load tests and the contract suites,
 * which drive dozens of checkouts from one address in minutes and would
 * otherwise trip the very bound they verify around.
 */
export function checkoutLimit(): number {
  return Number(process.env.CHECKOUT_RATE_LIMIT ?? 10);
}
export function draftLimit(): number {
  return Number(process.env.DRAFT_RATE_LIMIT ?? 60);
}
