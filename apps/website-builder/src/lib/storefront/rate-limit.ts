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
 * WHOSE IP THIS IS — SEC.6's RULE, AND THE HALF IT GOT WRONG (SEC.10)
 *
 * `X-Forwarded-For` accumulates left to right: a client may send any prefix it
 * likes and each proxy APPENDS the address it actually saw. So the LAST entry
 * is the hop nearest us and the only one with any claim to trust; the FIRST is
 * precisely the value an attacker controls.
 *
 * This module used to read the first. Measured against the deployed build:
 * sending a different `X-Forwarded-For` on each request produced a fresh
 * bucket every time, so the limiter counted to one forever — a COMPLETE
 * bypass of checkout, draft-capture and visit limits, reachable by anyone on
 * the internet with no account and no inside knowledge. SEC.6 moved to the
 * last entry, which closed that hole and still does.
 *
 * WHAT SEC.6 COULD NOT SEE. "The nearest hop" is only the customer when we are
 * the FIRST thing behind the edge. Production is Cloudflare → Render → us, and
 * on 23 August the chain was read straight out of `Session.ip` (login stores
 * the whole header verbatim). Every session, three hops:
 *
 *     <customer, public>, <Cloudflare egress, public>, <Render router, PRIVATE>
 *
 * So the last entry — the value this module keyed everything on — was an
 * RFC1918 address inside Render's own network, identical for every customer on
 * earth. The limiter had one global bucket per endpoint (~30 checkouts per
 * five minutes for the entire internet), and the same value was being handed
 * to Meta CAPI as `client_ip_address`, where a private address matches nobody.
 * That second half was a REGRESSION SEC.6 introduced: the pre-SEC.6 first-entry
 * read was attacker-spoofable, but for honest traffic it was the right address.
 *
 * THE FIX, IN TWO PARTS.
 *
 * 1. `CF-Connecting-IP` when we are configured to sit behind Cloudflare.
 *    Cloudflare SETS and OVERWRITES that header on every proxied request, so
 *    behind Cloudflare it is both unspoofable and the true end user — exactly
 *    the two properties nothing else here has at once.
 *
 * 2. Otherwise, walk the forwarded chain from the RIGHT and skip hops that are
 *    OUR OWN PLUMBING (loopback, RFC1918, CGNAT, link-local, IPv6 ULA). The
 *    first public entry from the right is the nearest hop we can actually
 *    name. An attacker can only PREPEND, never append, so this stays as
 *    unforgeable as SEC.6's rule while no longer collapsing on a private hop.
 *
 * WHY PART 1 IS CONFIGURATION AND NOT A HEADER SNIFF. There is no way to
 * authenticate a proxy from headers, because headers are the thing being
 * authenticated: `CF-Connecting-IP`, `CF-RAY` and any corroboration between
 * them are all forgeable by whoever can reach us without Cloudflare in front.
 * Trust in a front layer is a fact about the DEPLOYMENT, so it is stated by
 * the deployment — `TRUST_CLOUDFLARE_CLIENT_IP`, unset meaning "do not trust",
 * the same fail-closed default `OUTBOUND_PRIVATE_ALLOWLIST` uses (SEC.7).
 *
 * Measured while writing this, and the reason the flag is safe to turn on
 * here: BOTH `selliora1.com` AND `landingos.onrender.com` answer with
 * `Server: cloudflare` and a `CF-RAY`, so on this deployment there is no
 * Cloudflare-free route to the app for the header to be forged over. That is
 * a fact about today's hosting, not a permanent property, which is why it is
 * a flag rather than an assumption baked into the code.
 *
 * WHAT SURVIVES UNCHANGED FROM SEC.6. Every value is VALIDATED as an IP
 * literal; garbage collapses to the shared `unknown` bucket, bounded rather
 * than unlimited; a present-but-unreadable `X-Forwarded-For` does NOT fall
 * through to `X-Real-IP`, because that header is client-settable too and
 * falling through would re-open the bypass through the back door.
 * -------------------------------------------------------------------------- */

/** Exported for the modules that resolve identity from the same headers
 *  (GEO.0's probe today) — a request-shaped bag, never the whole request. */
export type HeaderBag = { headers: { get(name: string): string | null } };

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
 * Addresses that belong to INFRASTRUCTURE rather than to a person on the
 * internet: loopback, the three RFC1918 private blocks, CGNAT, link-local,
 * IPv6 unique-local. A trailing run of these in a forwarded chain is our own
 * plumbing describing itself.
 *
 * Deliberately NOT included: documentation ranges (`2001:db8::/32`,
 * `198.51.100.0/24`, `203.0.113.0/24`). Those are reserved for prose and test
 * fixtures, not used by real infrastructure, and treating them as internal
 * would make every test in this suite describe a topology nobody runs.
 */
function isInternalIp(ip: string): boolean {
  // An IPv4-mapped IPv6 address is judged by the v4 address it carries.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  const v = mapped ? mapped[1] : ip;

  if (IPV4.test(v)) {
    const [a, b] = v.split(".").map(Number);
    if (a === 0) return true; // "this network"
    if (a === 10) return true; // 10/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    return false;
  }

  if (v === "::1" || v === "::") return true; // loopback, unspecified
  // fe80::/10 link-local — the first hextet runs fe80…febf.
  if (/^fe[89ab]/.test(v)) return true;
  // fc00::/7 unique-local.
  const first = Number.parseInt(v.slice(0, 2), 16);
  return !Number.isNaN(first) && (first & 0xfe) === 0xfc;
}

/** Does this deployment sit behind Cloudflare? A fact about the deployment,
 * stated by the deployment. Unset means "no", which is fail-closed. */
function trustsCloudflare(): boolean {
  const v = process.env.TRUST_CLOUDFLARE_CLIENT_IP;
  return v === "1" || v?.toLowerCase() === "true";
}

/** How an address was arrived at — which is what says how much it means. */
export type ClientIpSource = "cloudflare" | "forwarded" | "real-ip";

export interface ClientIdentity {
  /** The best address available for the caller, or null when none can be named. */
  readonly ip: string | null;
  /** Where it came from. Null exactly when `ip` is null. */
  readonly source: ClientIpSource | null;
  /**
   * True when `ip` is the END USER's own address rather than some proxy's.
   *
   * Only this may be reported to an ad platform as the customer: Meta and
   * TikTok match on `client_ip_address`, and handing them a Cloudflare egress
   * address is not merely useless, it is a confident wrong answer. The
   * limiter, by contrast, is happy with a coarse-but-stable key and uses `ip`
   * whatever this says.
   */
  readonly isEndUser: boolean;
}

const NOBODY: ClientIdentity = { ip: null, source: null, isEndUser: false };

/**
 * Work out who is calling, and how confident we are that it is really them.
 * The single definition every reader here goes through.
 */
export function resolveClientIdentity(req: HeaderBag): ClientIdentity {
  if (trustsCloudflare()) {
    const cf = parseIp(req.headers.get("cf-connecting-ip"));
    // A real end user is always publicly routable. Requiring that costs
    // nothing and means a private value — forged, or a misconfigured front
    // layer talking to itself — can never become a bucket key or a CAPI field.
    if (cf && !isInternalIp(cf)) {
      return { ip: cf, source: "cloudflare", isEndUser: true };
    }
  }

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded && forwarded.trim()) {
    const parts = forwarded.split(",");
    /** The rightmost entry that parsed at all — the coarse fallback key. */
    let nearest: string | null = null;

    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const candidate = parseIp(parts[i]);
      // Garbage stops the walk. We cannot reason about what sits to the LEFT
      // of a value we could not read, and guessing past it is how the first
      // bypass happened.
      if (!candidate) break;
      if (nearest === null) nearest = candidate;
      if (!isInternalIp(candidate)) {
        // Nothing skipped means we are the first hop behind the edge, so this
        // IS the end user. Anything skipped means at least one proxy stood
        // between us and them, so it is that proxy's address.
        return { ip: candidate, source: "forwarded", isEndUser: i === parts.length - 1 };
      }
    }

    // Every readable hop was infrastructure (or the walk hit garbage before
    // finding a public one). Keep the nearest as a bounded, stable bucket key,
    // but never claim it is a customer.
    return nearest
      ? { ip: nearest, source: "forwarded", isEndUser: false }
      : NOBODY;
  }

  // No `X-Forwarded-For` at all: a single-proxy or direct deployment, where
  // `X-Real-IP` is the best signal there is. Unchanged from SEC.6, including
  // the rule that a present-but-unreadable forwarded header never reaches here.
  const real = parseIp(req.headers.get("x-real-ip"));
  return real ? { ip: real, source: "real-ip", isEndUser: true } : NOBODY;
}

/**
 * The caller's address as the edge reported it, or null when it cannot be
 * known. Null rather than a placeholder, so an audit row can record
 * "not known" honestly instead of the string "unknown".
 */
export function trustedClientIp(req: HeaderBag): string | null {
  return resolveClientIdentity(req).ip;
}

/**
 * The END USER's own address, or null. For anything reported to a third party
 * as the customer — Meta CAPI, the TikTok Events API — where a proxy's address
 * is worse than no address at all.
 */
export function endUserIp(req: HeaderBag): string | null {
  const identity = resolveClientIdentity(req);
  return identity.isEndUser ? identity.ip : null;
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
