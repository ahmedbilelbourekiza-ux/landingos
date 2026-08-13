import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

const nextConfig: NextConfig = {
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
      beforeFiles: [],
      afterFiles: [{ source: "/uploads/:path*", destination: "/api/uploads/:path*" }],
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
