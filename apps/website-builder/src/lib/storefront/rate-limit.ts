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

/* -----------------------------------------------------------------------------
 * WHOSE IP THIS IS, AND WHY THE LAST ENTRY IS THE ONLY ONE WORTH READING
 *
 * `X-Forwarded-For` accumulates left to right: a client may send any prefix it
 * likes and the edge APPENDS the address it actually saw. So the LAST entry is
 * the hop nearest us and the only one with any claim to trust; the FIRST is
 * precisely the value an attacker controls.
 *
 * This module used to read the first. Measured against the deployed build:
 * sending a different `X-Forwarded-For` on each request produced a fresh
 * bucket every time, so the limiter counted to one forever — a COMPLETE
 * bypass of checkout, draft-capture and visit limits, reachable by anyone on
 * the internet with no account and no inside knowledge.
 *
 * `resolve-tenant.ts`'s `normalizeHost` already states this rule, on this same
 * header, for this same reason — it takes the last entry and says why. The
 * limiter disagreed with it. One rule now, in the direction the codebase had
 * already reasoned its way to.
 *
 * The value is VALIDATED as an IP literal. Anything else — garbage, a
 * hostname, an injected list — collapses to the shared `unknown` bucket,
 * which is bounded rather than unlimited: the fail-closed direction, where a
 * caller who mangles the header shares one budget with every other such
 * caller instead of being handed a private unlimited one. And when
 * `X-Forwarded-For` is present but unreadable we do NOT fall through to
 * `X-Real-IP`, because that header is client-settable too and falling
 * through would re-open the bypass through the back door.
 * -------------------------------------------------------------------------- */

type HeaderBag = { headers: { get(name: string): string | null } };

const IPV4 = /^(?:\d{1,3})(?:\.\d{1,3}){3}$/;

/** One IP literal, or null. Tolerates a trailing port and bracketed IPv6. */
function parseIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim().toLowerCase();
  if (!v) return null;

  // `[::1]:443` / `[::1]` — the bracketed form, with or without a port.
  const bracketed = /^\[([0-9a-f:.]+)\](?::\d+)?$/.exec(v);
  if (bracketed) v = bracketed[1];
  // `1.2.3.4:5678` — a port on a v4 address. Never strip a bare `::1`'s colons.
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(v)) v = v.replace(/:\d+$/, "");

  if (IPV4.test(v)) {
    return v.split(".").every((o) => o.length <= 3 && Number(o) <= 255) ? v : null;
  }
  // IPv6, including the v4-mapped `::ffff:1.2.3.4` shape.
  if (v.includes(":") && /^[0-9a-f:.]+$/.test(v)) return v;
  return null;
}

/**
 * The caller's address as the EDGE reported it, or null when it cannot be
 * known. Null rather than a placeholder, so an audit column can record
 * "not known" honestly instead of the string "unknown".
 */
export function trustedClientIp(req: HeaderBag): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded && forwarded.trim()) {
    // Nearest hop only, and no fall-through if it does not parse.
    const parts = forwarded.split(",");
    return parseIp(parts[parts.length - 1]);
  }
  return parseIp(req.headers.get("x-real-ip"));
}

/** The rate limiter's key. `unknown` still gets a bucket, so a proxyless or
 * header-mangling caller is bounded rather than unlimited. */
export function clientIp(req: HeaderBag): string {
  return trustedClientIp(req) ?? "unknown";
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
/** AN.1 — the page-view beacon. Looser than drafts: a real visitor bouncing
 * around a store is many views in minutes, and each accepted row is one
 * narrow insert with no third-party fan-out behind it. */
export function visitLimit(): number {
  return Number(process.env.VISIT_RATE_LIMIT ?? 120);
}
