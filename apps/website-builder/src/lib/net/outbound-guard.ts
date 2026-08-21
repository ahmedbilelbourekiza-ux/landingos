import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/* =============================================================================
 * Outbound destination guard (SEC.7) — the resolve-time half SSRF needs.
 *
 * TWO SURFACES let a tenant point THIS SERVER at an address of their choosing:
 * webhook endpoints (posted to on every order, with retries) and AI provider
 * base URLs (fetched with the tenant's credential attached). Both had an
 * as-written hostname check at best — `url-guard.ts` stated the limit in its
 * own header: "a public DNS name that later resolves to a private address (DNS
 * rebinding) is not caught here — that requires resolve-time pinning in the
 * delivery layer, recorded as hardening work." This module is that recorded
 * work, plus the half the AI surface never had at all.
 *
 * THREE GATES, applied at REQUEST time, not only at configuration:
 *
 *   1. As written — parse, protocol allow-list, and the hostname refusals.
 *      A literal-IP hostname is judged by `isPrivateIp` (one authority,
 *      every spelling); a NAME is judged by the block patterns.
 *   2. As resolved — `dns.lookup(host, { all })` and every returned address
 *      must be public. One private A/AAAA record among ten public ones is a
 *      refusal: the OS resolver decides which one the socket would use, so
 *      any private candidate is a candidate compromise.
 *   3. After redirects — `guardedFetch` never lets the runtime follow a
 *      Location header on its own. Each hop is re-checked through gates 1–2,
 *      and a cross-origin hop is refused outright (see below).
 *
 * WHY CROSS-ORIGIN REDIRECTS ARE REFUSED rather than followed clean: the AI
 * callers attach a credential (`authorization` / `x-api-key`). Node's fetch
 * strips `authorization` on a cross-origin hop but NOT `x-api-key`, so
 * "follow and hope" leaks Anthropic-style keys to whoever the redirect names.
 * A provider that answers 301-to-elsewhere without the credential would 401
 * anyway; refusing tells the operator the truth instead.
 *
 * HONEST LIMIT, restated for the next reader: gate 2 checks the resolution
 * THIS process observed, immediately before the request. A resolver serving a
 * 0-TTL answer that flips between our lookup and the socket's own can still
 * win the race (classic rebinding). Closing that fully needs the lookup to
 * happen INSIDE the connection (an undici Agent with a checking `lookup` in
 * its connect options); recorded as further hardening, not done here — this
 * module already reduces the attack from "any public name, any time" to
 * "a racing resolver with sub-second TTLs".
 *
 * THE TEST SEAM, and its rule: `OUTBOUND_PRIVATE_ALLOWLIST` is a
 * comma-separated list of EXACT hostnames (e.g. `127.0.0.1,localhost`) that
 * skip gates 1-and-2's privacy refusals. It exists because every delivery
 * suite stands its receiver up on 127.0.0.1 (the webhooks/tracking stub
 * convention), and a guard nothing can test is a guard nobody trusts. It is
 * an allow-LIST, never a boolean off-switch, and production leaves it unset.
 *
 * Bare-node clean on purpose (relative imports, node builtins only): the
 * suite imports this file directly, and it is imported by `ai-complete.ts`
 * and `url-guard.ts`, which already carry the same rule.
 * ========================================================================== */

/** Hostnames refused BY NAME (a literal IP never reaches these — it is judged
 * by `isPrivateIp` instead). The url-guard list, moved here so webhooks and
 * AI providers cannot drift apart — the D-LP.3 rule for refusals. */
export const BLOCKED_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  // RFC 8375 — the home-network special-use name.
  /\.home\.arpa$/i,
];

const privateIpv4 = (ip: string): boolean => {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0) return true; // 192.0.0/24 special + 192.0.2/24 TEST-NET
  if (a === 192 && b === 88) return true; // 192.88.99/24 6to4 relay (reserved)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast 224/4 + reserved 240/4 + broadcast
  return false;
};

/** `isIP(raw) === 6` must already hold — the caller's contract. Returns the
 * eight 16-bit groups, with any dotted-quad tail folded into the last two. */
function ipv6Words(raw: string): number[] {
  let ip = raw;
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.includes(".")) {
    const cut = ip.lastIndexOf(":");
    const quads = ip.slice(cut + 1).split(".").map(Number);
    const hi = ((quads[0] << 8) | quads[1]).toString(16);
    const lo = ((quads[2] << 8) | quads[3]).toString(16);
    ip = `${ip.slice(0, cut + 1)}${hi}:${lo}`;
  }
  const [headRaw, tailRaw] = ip.split("::");
  const head = headRaw ? headRaw.split(":").map((g) => parseInt(g, 16)) : [];
  const tail = tailRaw ? tailRaw.split(":").map((g) => parseInt(g, 16)) : [];
  const words = [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
  return words;
}

const privateIpv6 = (raw: string): boolean => {
  const w = ipv6Words(raw);
  const embedded = () => `${w[6] >> 8}.${w[6] & 0xff}.${w[7] >> 8}.${w[7] & 0xff}`;

  if (w.every((x) => x === 0)) return true; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true; // ::1
  if ((w[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((w[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (deprecated, still routable on LANs)
  if ((w[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((w[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true; // documentation 2001:db8::/32
  // Forms that EMBED an IPv4 address reach that IPv4 network — judge the
  // embedded address, so `::ffff:127.0.0.1` and NAT64 tricks cannot dodge
  // the IPv4 table by wearing IPv6 syntax.
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return privateIpv4(embedded()); // ::ffff:a.b.c.d
  if (w[0] === 0x0064 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return privateIpv4(embedded()); // 64:ff9b::/96
  if (w.slice(0, 6).every((x) => x === 0)) return privateIpv4(embedded()); // ::a.b.c.d (deprecated compat)
  if (w[0] === 0x2002) return privateIpv4(`${w[1] >> 8}.${w[1] & 0xff}.${w[2] >> 8}.${w[2] & 0xff}`); // 6to4 2002::/16
  return false;
};

/** Loopback, RFC1918, link-local (cloud metadata), CGNAT, multicast, reserved,
 * documentation ranges, and every IPv6 form that reaches one of those.
 * Anything that is not a parseable IP is "private" — refuse what cannot be
 * classified. */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return privateIpv4(ip);
  if (kind === 6) return privateIpv6(ip);
  return true;
}

/** `new URL("http://[::1]/").hostname` keeps the brackets; dns and isIP want
 * them gone. */
export const bareHostname = (url: URL): string =>
  url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;

/** The test seam. Exact-hostname matches only, comma-separated, unset in
 * production. Read at call time so a suite can flip it per test. */
export function isAllowlistedPrivateHost(host: string): boolean {
  const raw = process.env.OUTBOUND_PRIVATE_ALLOWLIST;
  if (!raw) return false;
  const needle = host.toLowerCase();
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .some((h) => h.length > 0 && h === needle);
}

export interface AsWrittenPolicy {
  /** e.g. ["https:"] for webhooks, ["https:", "http:"] for AI base URLs. */
  readonly protocols: readonly string[];
}

/**
 * Gate 1 — the URL as the tenant wrote it. Null when acceptable; a
 * human-readable refusal otherwise. Never touches the network, so it is safe
 * at configuration time (a DNS blip must not block saving a form).
 */
export function refuseOutboundUrl(raw: string, policy: AsWrittenPolicy): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That is not a valid URL.";
  }
  if (!policy.protocols.includes(url.protocol)) {
    const wanted = policy.protocols.map((p) => p.replace(/:$/, "")).join(" or ");
    return `The URL must use ${wanted}.`;
  }
  if (url.username || url.password) {
    // Credentials in a URL reach logs and error reports; also `https://x@y/`
    // is the oldest trick for making a URL read as one host and fetch another.
    return "The URL must not embed credentials.";
  }
  const host = bareHostname(url);
  if (isAllowlistedPrivateHost(host)) return null;
  if (isIP(host)) {
    // The WHATWG parser has already normalised decimal/hex/octal spellings
    // (`https://2130706433/`) to dotted-quad, so one authority judges every
    // literal address.
    if (isPrivateIp(host)) {
      return "The URL must point at a public host — private and internal addresses are refused.";
    }
    // IPv4-mapped IPv6 is refused WHOLESALE as written, even when the embedded
    // address is public — url-guard's original rule: a legitimate receiver has
    // no reason to be addressed through the mapped form, and it exists mainly
    // to wear IPv6 syntax past IPv4 checks. (The parser serialises every
    // mapped spelling to the `::ffff:` prefix asserted here.)
    if (/^::ffff:/i.test(host)) {
      return "The URL must point at a public host — private and internal addresses are refused.";
    }
    return null;
  }
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) {
      return "The URL must point at a public host — private and internal addresses are refused.";
    }
  }
  return null;
}

/** dns.lookup's shape, injectable so the resolve gate is assertable without
 * real DNS. */
export type LookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

const realLookup: LookupFn = (hostname, options) => dnsLookup(hostname, options);

/**
 * Gate 2 — what the name resolves to, RIGHT NOW. Null when every address is
 * public; a refusal string otherwise. A name that does not resolve at all is
 * NOT refused here — the fetch will fail on its own with a truthful network
 * error, and "refused as private" would be the wrong message for a typo.
 */
export async function refuseResolvedTarget(
  url: URL,
  lookupFn: LookupFn = realLookup,
): Promise<string | null> {
  const host = bareHostname(url);
  if (isAllowlistedPrivateHost(host)) return null;
  if (isIP(host)) {
    return isPrivateIp(host)
      ? "The URL must point at a public host — private and internal addresses are refused."
      : null;
  }
  let addresses: ReadonlyArray<{ address: string }>;
  try {
    addresses = await lookupFn(host, { all: true, verbatim: true });
  } catch {
    return null; // let fetch surface the real DNS error
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      return "The URL resolves to a private or internal address — refused.";
    }
  }
  return null;
}

/** Thrown by guardedFetch for refusals THIS module decided (never for the
 * destination's own errors). The message is operator-safe: it names the
 * refusal, never a credential and never a response body. */
export class OutboundRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundRefusedError";
  }
}

export interface GuardedFetchOptions {
  readonly protocols: readonly string[];
  /** 0 = never follow (the webhook rule: a 3xx is returned and the caller
   * records it as the failure it is). N > 0 = follow same-origin hops, each
   * re-checked through gates 1–2. */
  readonly maxRedirects: number;
  readonly lookupFn?: LookupFn;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Gate 3 — fetch with every hop checked. The runtime NEVER follows a
 * redirect on its own (`redirect: "manual"` always); when following is
 * allowed at all it happens here, where the next target is re-checked as
 * written AND as resolved before any connection is made.
 *
 *   - Cross-origin hops are refused (see the module header — `x-api-key`
 *     survives Node's own cross-origin stripping).
 *   - 307/308 re-send the same method and body. For GET/HEAD, 301/302/303
 *     are followed as the same GET. A 301/302/303 answering a POST is
 *     returned to the caller as the terminal response instead of silently
 *     mutating the request into a GET.
 */
export async function guardedFetch(
  rawUrl: string,
  init: RequestInit,
  options: GuardedFetchOptions,
): Promise<Response> {
  let current = rawUrl;
  const method = (init.method ?? "GET").toUpperCase();

  for (let hop = 0; ; hop++) {
    const asWritten = refuseOutboundUrl(current, { protocols: options.protocols });
    if (asWritten) throw new OutboundRefusedError(asWritten);

    const url = new URL(current);
    const resolved = await refuseResolvedTarget(url, options.lookupFn);
    if (resolved) throw new OutboundRefusedError(resolved);

    const res = await fetch(current, { ...init, redirect: "manual" });

    const location = res.headers.get("location");
    if (!REDIRECT_STATUSES.has(res.status) || !location) return res;
    if (options.maxRedirects === 0) return res; // the caller's rule: a 3xx is an answer
    if (hop >= options.maxRedirects) {
      throw new OutboundRefusedError("Too many redirects.");
    }
    if (res.status !== 307 && res.status !== 308 && method !== "GET" && method !== "HEAD") {
      return res; // refusing to quietly turn a POST into a GET
    }

    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new OutboundRefusedError("The destination answered with an unusable redirect.");
    }
    if (next.origin !== url.origin) {
      throw new OutboundRefusedError("The destination redirected to a different origin — refused.");
    }
    // The response body of a redirect hop is never read; cancel it so the
    // connection is not held open across the next request.
    await res.body?.cancel().catch(() => {});
    current = next.toString();
  }
}
