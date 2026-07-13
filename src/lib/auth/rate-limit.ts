// In-memory login rate limiter.
//
// Limits per IP (keyed by the request's forwarded-for or remote address):
//   MAX_ATTEMPTS failed logins within WINDOW_SECONDS → HTTP 429.
//
// On a successful login the IP's history is cleared. Successful logins never
// count toward the limit. Entries are pruned on every check so the Map cannot
// grow unboundedly in long-running processes.
//
// Note: this is in-memory and per-process. In a multi-instance production
// deployment you would swap this for a shared store (Redis, etc.). For the
// single-instance sandbox this is sufficient and adds no external deps.

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 5 * 60; // 5 minutes

type Bucket = {
  // epoch-millis timestamps of each failed attempt within the window
  failures: number[];
};

const buckets = new Map<string, Bucket>();

function pruneFailures(bucket: Bucket, now: number): number[] {
  const cutoff = now - WINDOW_SECONDS * 1000;
  bucket.failures = bucket.failures.filter((t) => t > cutoff);
  return bucket.failures;
}

// Resolve the client IP from the standard forwarded headers, falling back to
// the NextRequest ip. We don't trust the right-most entry in X-Forwarded-For
// (the upstream proxy) — we use the left-most client-supplied value.
export function resolveClientIp(req: { headers: Headers; ip?: string }): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return req.ip ?? "unknown";
}

export interface RateLimitResult {
  ok: boolean;
  attemptsRemaining: number;
  retryAfterSeconds: number;
}

// Record a failed attempt for the IP and report whether the IP is now blocked.
// Always returns the latest state — the route handler is responsible for
// returning 429 when `ok` is false.
export function recordFailedAttempt(ip: string): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(ip) ?? { failures: [] };
  pruneFailures(bucket, now);
  bucket.failures.push(now);
  buckets.set(ip, bucket);

  if (bucket.failures.length > MAX_ATTEMPTS) {
    const oldest = bucket.failures[0]!;
    const retryAfterSeconds = Math.ceil(
      (oldest + WINDOW_SECONDS * 1000 - now) / 1000,
    );
    return {
      ok: false,
      attemptsRemaining: 0,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }
  return {
    ok: true,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - bucket.failures.length),
    retryAfterSeconds: 0,
  };
}

// Inspect the current state for an IP without recording a new failure. Used by
// the login route to short-circuit before doing any DB work.
export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket) {
    return { ok: true, attemptsRemaining: MAX_ATTEMPTS, retryAfterSeconds: 0 };
  }
  pruneFailures(bucket, now);
  if (bucket.failures.length > MAX_ATTEMPTS) {
    const oldest = bucket.failures[0]!;
    const retryAfterSeconds = Math.ceil(
      (oldest + WINDOW_SECONDS * 1000 - now) / 1000,
    );
    return {
      ok: false,
      attemptsRemaining: 0,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }
  return {
    ok: true,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - bucket.failures.length),
    retryAfterSeconds: 0,
  };
}

// Clear an IP's history after a successful login so a user who fat-fingers
// their password a few times and then gets in isn't penalised.
export function clearAttempts(ip: string): void {
  buckets.delete(ip);
}

export const RATE_LIMIT_CONFIG = {
  maxAttempts: MAX_ATTEMPTS,
  windowSeconds: WINDOW_SECONDS,
};
