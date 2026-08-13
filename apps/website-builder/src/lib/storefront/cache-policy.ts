/* =============================================================================
 * THE STOREFRONT CACHING STORY — LB.14a.
 *
 * `BUILDER_AUDIT.md` P-01 asked for a decision, not a change: "every storefront
 * page is force-dynamic with 8 relation includes; no cache header, no ISR …
 * bounded and indexed, so acceptable at launch scale — but decide and record
 * the caching story." This module is the decision, in the one place every
 * storefront response can read it from, and the reasoning is here rather than
 * in a document because a header nobody can trace back to an argument gets
 * loosened by the next person in a hurry.
 *
 * ---------------------------------------------------------------------------
 * ONE RULE, FROM WHICH EVERYTHING BELOW FOLLOWS
 *
 *   A response may be reused by a SHARED cache only if a stale copy of it
 *   cannot cost somebody money or expose somebody's order.
 *
 * That is stricter than "changes rarely", and deliberately so. The platform
 * cannot purge a cache it does not own — see the custom-domain note below —
 * so every second of shared freshness granted here is a promise that cannot
 * be taken back once a merchant edits a price.
 *
 * ---------------------------------------------------------------------------
 * WHAT MUST NEVER BE STALE, AND WHY — each one measured, not assumed
 *
 * THE DELIVERY QUOTE (`/api/storefront/[tenant]/wilayas`). D-LB.20.1 is that
 * the function answering the quote and the function computing the charge are
 * the SAME function, because a copy is a promise nobody enforces. A cache in
 * the middle re-opens exactly that gap from outside the code: the customer is
 * shown yesterday's shipping price and charged today's. **Measured before this
 * module existed: this route sent no `Cache-Control` header at all**, and RFC
 * 9111 §4.2.2 lets a shared cache assign its own heuristic freshness to a 200
 * GET with no freshness information. The one response that must never be
 * stale was the one response with no instruction.
 *
 * THE ORDER (`/[tenant]/thank-you/[orderId]`). A customer's name, wilaya and
 * total. Never shared, never stored.
 *
 * THE PIXEL CONFIGURATION (`/tracking`, `/meta-pixels`). A pixel the merchant
 * removed would go on firing, and a new one would not start; it also names a
 * tenant's advertising setup to anyone who can read a shared cache.
 *
 * THE PUBLIC PAGES (`/[tenant]`, `/[tenant]/[slug]`, `/[tenant]/category/…`).
 * These are the ones the audit had in mind, and they are still not shareable —
 * for two reasons that are easy to miss because the pages look like static
 * marketing content:
 *
 *   1. EVERY ONE OF THEM RENDERS A PRICE — the product page in its hero and
 *      its JSON-LD, the home and category listings in each card — and the
 *      checkout recomputes the price server-side from the row (the storefront
 *      suite asserts the server ignores what the browser submits). A stale
 *      page therefore does not merely look wrong: it takes an order at a
 *      number the customer never agreed to.
 *   2. LB.34 made ARCHIVE the delete. A shared copy of an archived page keeps
 *      selling a product the merchant retired, which is the one thing that
 *      slice existed to make possible.
 *
 * They ARE reusable by the visitor's own browser for a short window, and that
 * is the one real win available here: `no-store` — what Next.js sends by
 * default for a `force-dynamic` route, measured — forbids even a back-button
 * redisplay, so returning to a product from the checkout costs a full
 * server render on a phone on a mobile network. A minute of private freshness
 * adds no hazard that was not already there: a page left open in a tab is
 * already unboundedly stale, and this window is shorter than any of them.
 *
 * ---------------------------------------------------------------------------
 * WHY `s-maxage` APPEARS NOWHERE, AND WHY THAT IS ABOUT CUSTOM DOMAINS
 *
 * The platform runs on Render with no CDN in front of it, so a shared-cache
 * directive would buy the platform's own traffic nothing today. But it would
 * not be harmless, because a storefront can be reached through a MERCHANT's
 * own hostname (`shop.acme.dz`), and a merchant is free to put Cloudflare or
 * any other proxy in front of that name. The platform has no way to purge it.
 * `public`/`s-maxage` here would hand a third-party cache permission to serve
 * a price after the merchant changed it, with no mechanism to stop it. That is
 * the difference between a cache we can be wrong about for a minute and one we
 * can be wrong about until someone notices.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO ISR, AND WHY IT IS NOT A CONFIGURATION CHOICE
 *
 * MEASURED, because "just add revalidate" is the obvious suggestion and it is
 * wrong: `export const revalidate = 60` was put on the category route with
 * `force-dynamic` removed, and the build still emitted
 * `ƒ /[tenant]/category/[slug]  (Dynamic) server-rendered on demand`, with no
 * warning and no error. At runtime the route still sent `no-store` and still
 * cost a database round trip per request.
 *
 * The cause is structural rather than a missing flag. `resolveStorefrontTenant`
 * asks `tenantByDomain` first — a custom domain WINS over a path prefix, which
 * is the whole of decision D2 — and that reads the `Host` header. `headers()`
 * is a Dynamic API, so every storefront render is dynamic by construction, and
 * a `revalidate` export on one is INERT WHILE LOOKING DELIBERATE. This project
 * has been caught by that shape before (a Tailwind `calc()` that compiled to
 * nothing, `--theme-background` with a writer and no reader, an `rtl:` variant
 * assumed dead), which is why the failed probe is written down here instead of
 * quietly reverted.
 *
 * Making these pages genuinely cacheable means separating the two front doors
 * so a path-prefix storefront never reads a header — a real slice with real
 * consequences for D2, scoped in `NEXT_STEPS.md` under LB.14a rather than
 * attempted here.
 * ========================================================================== */

/**
 * For anything whose staleness costs money or exposes an order.
 *
 * `no-store` rather than `no-cache`: `no-cache` permits storing and demands
 * revalidation, which still leaves a copy on disk in a shared proxy and still
 * serves it if the revalidation fails. There is no acceptable failure mode
 * here where a delivery price is concerned.
 */
export const NEVER_CACHE = "private, no-store, max-age=0, must-revalidate";

/**
 * For the public storefront HTML: the visitor's own browser may redisplay it
 * for a minute; nothing shared may keep it at all.
 */
export const BROWSER_ONLY_SHORT = `private, max-age=${60}, must-revalidate`;

/** Applied to a `Response` on its way out. Returns the same response. */
export function withCachePolicy<T extends Response>(res: T, policy: string): T {
  res.headers.set("Cache-Control", policy);
  return res;
}
