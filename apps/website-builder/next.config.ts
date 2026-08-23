import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

/* LB.45 — which hosts get the custom-domain path shape.
 *
 * Anchored regex over the request's Host header (Next strips the port before
 * matching): every host that is NOT one of the platform's own surfaces. The
 * list mirrors `isPlatformHost` in lib/storefront/resolve-tenant.ts — the two
 * must agree, or a host could be rewritten into the storefront tree here and
 * then refused a tenant there (a 404), or vice versa (the platform shape on a
 * merchant's domain). `has` sees only the REAL Host header, never
 * X-Forwarded-Host — so a forged forwarded header cannot move a platform
 * request into the rewritten space. */
const CUSTOM_DOMAIN_HOST = [
  "(?!localhost$)",
  "(?!.*\\.localhost$)",
  "(?!127\\.0\\.0\\.1$)",
  "(?!0\\.0\\.0\\.0$)",
  "(?!onrender\\.com$)",
  "(?!.*\\.onrender\\.com$)",
  ...[process.env.PUBLIC_HOST, process.env.RENDER_EXTERNAL_HOSTNAME]
    .filter((h): h is string => Boolean(h))
    .map((h) => `(?!${h.toLowerCase().replace(/\./g, "\\.")}$)`),
  ".+",
].join("");

const nextConfig: NextConfig = {
  /* LB.50 — CSS ships inside the document, not as render-blocking links.
   * ADOPTED ON MEASUREMENT, same page, same method: perf 81→88 and LCP
   * 3.7s→2.0s, because the hero can start painting without waiting on two
   * stylesheet round-trips. The honest costs, also measured: the document
   * grows (~28KB→106KB gz — the CSS rides in EVERY page view instead of
   * caching once; FCP +0.3s, TBT +80ms). For an ad-driven COD funnel the
   * first view is the one that converts, so first-view LCP wins. The flag
   * is EXPERIMENTAL: if a Next upgrade misbehaves, the symptom is unstyled
   * pages and the revert is deleting this block. */
  experimental: {
    inlineCss: true,
  },
  output: "standalone",
  // Pin the tracing root to the workspace root rather than letting Next infer
  // it. Inference works today, but it is a heuristic over lockfile location —
  // and it decides the SHAPE of .next/standalone: with a workspace root the
  // server lands at standalone/apps/website-builder/server.js with node_modules
  // hoisted beside it, without one it lands at standalone/server.js. The
  // Dockerfile and the entrypoint both hard-code that path, so an inference
  // that changes silently relocates the server and the container starts
  // failing with MODULE_NOT_FOUND.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Allow remote placeholder/sample images used by the demo-data seed. The
  // public storefront and dashboard render these via next/image, which
  // requires every remote hostname to be explicitly allow-listed.
  images: {
    /* PM.3 — STOP ASKING FOR WIDTHS THAT PRODUCE THE SAME BYTES.
     *
     * Every image this platform serves has been through `storeImage`, which
     * does `.resize(2000, 2000, { fit: "inside", withoutEnlargement: true })`,
     * so no source is wider than 2000px. And the optimizer CLAMPS to the
     * source rather than enlarging it — measured, not assumed: a 768px-wide
     * source requested at `w=1920` comes back 768px, byte for byte the whole
     * image.
     *
     * So on this platform the tail of Next's default `deviceSizes`
     * ([… 1920, 2048, 3840]) is not three sizes, it is ONE result behind three
     * cache keys: 1920 already delivers the full source, and 2048 and 3840 can
     * only re-encode the identical output again. Each of those is a separate
     * cold transform at full source resolution — the most expensive kind — for
     * a file the 1920 entry already produced.
     *
     * Measured on the live storefront before the change: 68 optimizer URLs on
     * one page load, of which **20 were w=2048 or w=3840** — 29% of the work,
     * duplicating results. A cold transform costs ~560ms of server CPU (the
     * readiness audit's figure, twelve page renders each), the disk cache
     * holding them is per-instance, and a deploy wipes it. This is the cheapest
     * available cut to that problem: no CDN, no DNS, no bucket, no new failure
     * mode.
     *
     * WHAT A BROWSER LOSES: nothing it could have used. The widest `sizes` in
     * the templates is `1152px` (description images) and `50vw` elsewhere, so
     * the largest honest requirement is 1920 — a retina laptop at 50vw of a
     * 1920px viewport — and that entry still returns the full source.
     *
     * 1920 STAYS even though 2000 is the cap, because the cap is a ceiling and
     * not every source reaches it: on a 1500px image, 1200 and 1920 give
     * genuinely different results and 1920 is the one that delivers all of it.
     *
     * `imageSizes` (16…384) is deliberately LEFT ALONE. Those serve fixed-size
     * thumbnails and avatars, they are the cheapest transforms in the set, and
     * trimming them trades a real risk of blurry thumbnails on high-DPR phones
     * for almost no CPU. The cost here is concentrated in the big widths.
     *
     * If `storeImage`'s 2000px cap ever rises, raise this list to match — the
     * two numbers are the same decision stated twice, which is the one thing
     * to watch. */
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "plus.unsplash.com" },
      { protocol: "https", hostname: "i.pravatar.cc" },
      { protocol: "https", hostname: "localhost" },
    ],
  },
  // Runtime-uploaded images cannot live in public/ — Next.js only serves
  // public/ files that existed at BUILD time, so a file written there after
  // deploy is saved but never served (it silently 404s). Uploads are stored
  // outside public/ and streamed back by the /api/uploads route instead.
  //
  // This is an `afterFiles` rewrite deliberately: it runs AFTER the static
  // file check, so the sample images committed under public/uploads are still
  // served statically exactly as before, and only URLs with no matching build
  // -time file fall through to the route handler. Existing /uploads/<file>
  // URLs already stored in the database keep working either way.
  async rewrites() {
    return {
      /* LB.45 — a custom domain's paths are the shop's own.
       *
       * The link layer has spoken the bare shape since LB.31
       * (`storefrontHref` drops the tenant prefix on a custom domain), but no
       * route ever SERVED that shape: `/robe` matched `[tenant]` and rendered
       * the store home, `/category/x` matched `[tenant]/[slug]` and 404'd,
       * and the root redirected to `/<slug>` — the platform's internal shape
       * leaking onto a merchant's hostname (measured live on the first real
       * custom domain). These rewrites re-insert a sentinel tenant segment so
       * bare paths land on the same routes the platform shape uses; the
       * sentinel's VALUE is never read, because every storefront surface
       * resolves the tenant domain-first (`resolveStorefrontTenant`), and on
       * a platform host `__domain__` resolves to no tenant — a plain 404.
       *
       * The root rule must be beforeFiles (`/` is a filesystem page and would
       * win first); the path rule is afterFiles ON PURPOSE — public/ files
       * (logo.svg, sw.js, icons/…) and static-path pages are already served
       * by then, so only would-be dynamic matches are re-shaped. `api`,
       * `console` and `_next` are excluded because their DYNAMIC routes
       * (`/_next/image`, `/api/storefront/...`, editor screens) resolve after
       * afterFiles and must keep their real paths on any host. */
      beforeFiles: [
        {
          source: "/",
          has: [{ type: "host", value: CUSTOM_DOMAIN_HOST }],
          destination: "/__domain__",
        },
      ],
      afterFiles: [
        { source: "/uploads/:path*", destination: "/api/uploads/:path*" },
        {
          // `__domain__` is excluded from its own rule: the root rewrite above
          // lands here as `/__domain__`, and afterFiles rules run against the
          // REWRITTEN path too — without the exclusion it became
          // `/__domain__/__domain__`, a landing-page lookup for a slug that
          // cannot exist (measured: the custom-domain root 404'd).
          source: "/:path((?!api(?:/|$)|console(?:/|$)|_next(?:/|$)|uploads(?:/|$)|robots\\.txt$|__domain__(?:/|$)).+)",
          has: [{ type: "host", value: CUSTOM_DOMAIN_HOST }],
          destination: "/__domain__/:path",
        },
      ],
      fallback: [],
    };
  },

  /* The storefront caching story — LB.14a. The ARGUMENT lives in
   * `src/lib/storefront/cache-policy.ts`; these rules are the half a page
   * cannot state for itself, because an App Router page has no way to set a
   * response header and `force-dynamic` otherwise makes Next send
   * `private, no-cache, no-store, max-age=0, must-revalidate` (measured).
   *
   * TWO THINGS HERE WERE MEASURED RATHER THAN ASSUMED, and the first one was
   * wrong on the first attempt:
   *
   * 1. NEXT DOES NOT STOP AT THE FIRST MATCHING RULE. It applies EVERY match
   *    and a later rule overrides an earlier one for the same header key. The
   *    thank-you rule was written first, on the assumption that first match
   *    wins, and the broad rule below silently overrode it — the customer's
   *    order page was answering `max-age=60` while the config said `no-store`,
   *    which is the exact "declared and inert" shape this project keeps
   *    catching. It is now BOTH last AND excluded from the broad rule, so it
   *    does not depend on ordering semantics at all. The storefront suite
   *    asserts the served header rather than the config.
   *
   * 2. A `Cache-Control` from this config DOES override what Next sends for a
   *    dynamic App Router page — checked against the running build, because
   *    Next's own documentation warns that it overwrites `Cache-Control` for
   *    some routes, and a rule that loses silently is worse than none.
   *
   * The `:tenant` exclusions keep all of this on the storefront namespace: the
   * pattern would otherwise match `/console/…` and `/api/…`, and a console
   * screen is emphatically not something to hand a browser a minute of
   * freshness on. Verified: `/console/builder/pages` still answers
   * `no-store`, and `/_next/static/*` still answers `immutable`. */
  async headers() {
    const NEVER_CACHE = "private, no-store, max-age=0, must-revalidate";
    const BROWSER_ONLY_SHORT = "private, max-age=60, must-revalidate";
    /* `.+`, not `.*` — MEASURED. With `.*` the segment also matches the EMPTY
     * string, so the bare root `/` fell into the first rule and its 307 to
     * `/console` started being cached for a minute. The root is the one path
     * whose meaning depends on the Host (a platform root redirects to the
     * console; a verified custom domain's root serves that tenant's
     * storefront — `acbc96a`), and a `Cache-Control` chosen by PATH cannot
     * tell those apart. It keeps the framework default, deliberately. */
    const tenant = ":tenant((?!api$|api/|console$|console/|_next|uploads).+)";
    return [
      {
        // The public pages. Every one renders a price the checkout recomputes
        // server-side, and an archived page (LB.34) must stop selling — so the
        // visitor's own browser may redisplay them briefly and no shared cache
        // may hold them at all.
        source: `/${tenant}`,
        headers: [{ key: "Cache-Control", value: BROWSER_ONLY_SHORT }],
      },
      {
        // Everything under a tenant EXCEPT the thank-you page, which is the
        // next rule's and must not be reached by this one.
        source: `/${tenant}/:path((?!thank-you$|thank-you/).*)`,
        headers: [{ key: "Cache-Control", value: BROWSER_ONLY_SHORT }],
      },
      {
        // A customer's name, wilaya and order total. Nothing keeps this —
        // declared LAST so it also wins on override order, not only on the
        // exclusion above.
        source: `/${tenant}/thank-you/:rest*`,
        headers: [{ key: "Cache-Control", value: NEVER_CACHE }],
      },
    ];
  },
};

// The plugin is what makes src/i18n/request.ts reachable. Without it every
// server component using a next-intl API throws at runtime while the build
// still reports success.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
