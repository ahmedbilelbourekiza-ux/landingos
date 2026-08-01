// Sliding-window rate limiter for the PUBLIC draft-order capture endpoint.
//
// That endpoint is unauthenticated and writes to the database, so without a
// limit anyone could hammer it. The storefront debounces updates to roughly
// one request every couple of seconds per visitor, so a ceiling of 40 per
// minute per IP is far above legitimate use while still capping abuse.
//
// Same trade-off as src/lib/auth/rate-limit.ts: in-memory and per-process,
// which is sufficient for a single-instance deployment. A multi-instance
// setup would need a shared store (Redis).

const MAX_REQUESTS = 40;
const WINDOW_MS = 60 * 1000;

const hits = new Map<string, number[]>();

export function checkDraftRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  const recent = (hits.get(ip) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  hits.set(ip, recent);

  // Opportunistically prune other IPs so the Map cannot grow without bound
  // in a long-running process.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      const live = times.filter((t) => t > cutoff);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  }

  return recent.length <= MAX_REQUESTS;
}
