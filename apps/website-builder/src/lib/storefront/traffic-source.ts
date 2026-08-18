/* =============================================================================
 * Traffic-source derivation (AN.1).
 *
 * ONE pure function turns the browser's raw evidence — utm_source, ad-click
 * ids, the referrer — into the small channel vocabulary the analytics screen
 * groups by. It runs SERVER-SIDE, on both write paths (the visit beacon and
 * the checkout), so a page view and the order it produced can never disagree
 * about what "came from TikTok" means — the quote=charge rule, applied to
 * attribution. The client captures evidence and forwards it; it never learns
 * the mapping, which also keeps the mapping out of the storefront bundle.
 *
 * NO IMPORTS, deliberately: the contract suite imports this file directly
 * (the calc.ts rule), and derivation that could only be checked through a
 * rendered page is how an attribution mistake survives review.
 *
 * Precedence, and why: explicit utm_source FIRST — it is the merchant's own
 * statement about the link they placed, and overriding a human's explicit tag
 * with an inferred one turns a deliberate label into a guess. Click ids
 * second — cryptographic-strength evidence a platform ad was clicked.
 * Referrer third — weakest: stripped by apps, missing on direct entry.
 * Nothing at all is DIRECT, and an unrecognised evidence string is OTHER with
 * the raw value kept in `detail`, never silently folded into a known channel.
 * ========================================================================== */

export const SOURCE_CHANNELS = [
  "facebook",
  "instagram",
  "tiktok",
  "google",
  "whatsapp",
  "telegram",
  "direct",
  "other",
] as const;

export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

export interface SourceEvidence {
  /** `utm_source` as it appeared in the landing URL. */
  utmSource?: string | null;
  /** Platform click ids from the landing URL. */
  fbclid?: string | null;
  ttclid?: string | null;
  gclid?: string | null;
  /** `document.referrer`, cross-origin only (the client filters same-site). */
  referrer?: string | null;
}

export interface DerivedSource {
  channel: SourceChannel;
  /** The evidence that decided it: the utm value or referrer host. Bounded. */
  detail: string | null;
}

/** What a merchant types into utm_source, mapped to the vocabulary. Aliases
 * are the ones ad platforms and link tools actually emit — an unknown value
 * stays OTHER rather than being guessed into a channel. */
const UTM_ALIASES: Record<string, SourceChannel> = {
  facebook: "facebook",
  fb: "facebook",
  meta: "facebook",
  messenger: "facebook",
  instagram: "instagram",
  ig: "instagram",
  tiktok: "tiktok",
  tt: "tiktok",
  google: "google",
  adwords: "google",
  youtube: "google",
  whatsapp: "whatsapp",
  wa: "whatsapp",
  telegram: "telegram",
  tg: "telegram",
};

/** Referrer hosts per channel. Suffix-matched per label (`l.facebook.com`,
 * `m.tiktok.com`), so platform subdomains do not need enumerating. */
const REFERRER_HOSTS: [string, SourceChannel][] = [
  ["facebook.com", "facebook"],
  ["fb.me", "facebook"],
  ["fb.com", "facebook"],
  ["messenger.com", "facebook"],
  ["instagram.com", "instagram"],
  ["tiktok.com", "tiktok"],
  ["google.com", "google"],
  ["google.dz", "google"],
  ["googlesyndication.com", "google"],
  ["youtube.com", "google"],
  ["whatsapp.com", "whatsapp"],
  ["wa.me", "whatsapp"],
  ["t.me", "telegram"],
  ["telegram.org", "telegram"],
  ["telegram.me", "telegram"],
];

const DETAIL_MAX = 120;

/** Printable, bounded, or null — this string came from an anonymous client
 * and ends up rendered in the merchant's console. */
function boundedDetail(value: string | null | undefined): string | null {
  if (!value) return null;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean ? clean.slice(0, DETAIL_MAX) : null;
}

function hostOf(referrer: string): string | null {
  try {
    return new URL(referrer).hostname.toLowerCase() || null;
  } catch {
    // A bare host is still evidence; a string that is neither URL nor
    // host-shaped is not.
    const bare = referrer.trim().toLowerCase();
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(bare) ? bare : null;
  }
}

/** `l.facebook.com` matches `facebook.com`; `notfacebook.com` must not. */
function hostMatches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

export function deriveSource(evidence: SourceEvidence): DerivedSource {
  const utm = boundedDetail(evidence.utmSource)?.toLowerCase() ?? null;
  if (utm) {
    return { channel: UTM_ALIASES[utm] ?? "other", detail: utm };
  }

  if (evidence.fbclid) return { channel: "facebook", detail: "fbclid" };
  if (evidence.ttclid) return { channel: "tiktok", detail: "ttclid" };
  if (evidence.gclid) return { channel: "google", detail: "gclid" };

  const host = evidence.referrer ? hostOf(evidence.referrer) : null;
  if (host) {
    for (const [candidate, channel] of REFERRER_HOSTS) {
      if (hostMatches(host, candidate)) {
        return { channel, detail: boundedDetail(host) };
      }
    }
    return { channel: "other", detail: boundedDetail(host) };
  }

  return { channel: "direct", detail: null };
}

/** For the routes: is this string one of ours? (A stored channel is grouped
 * by the console without normalisation, so only the vocabulary may land.) */
export function isSourceChannel(value: unknown): value is SourceChannel {
  return typeof value === "string" && (SOURCE_CHANNELS as readonly string[]).includes(value);
}
