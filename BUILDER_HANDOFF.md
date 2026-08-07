# BUILDER_HANDOFF — the Landing Page Builder, as its own product

**Date:** 7 August 2026 · **State as of:** the LB.1–LB.6 series (see `git log`,
commits `6d44262..410d7c5`) · **Audience:** an engineer continuing THIS product
who has not read the ERP handoff and does not need to.

The companion documents: `BUILDER_AUDIT.md` is the *before* measurement — every
defect as it was found, with how it was observed. This file is the *after*: what
the product is now, how it is built, what was verified, and what remains. The
platform-wide rules (tenancy, RLS, sessions, the console shell) are summarised
here to the depth this product needs; their full treatment lives in
PROJECT_STATE, which you only need for platform work.

---

## 1. What this product is

A multi-tenant SaaS landing-page builder for cash-on-delivery e-commerce
(Algeria-first: wilaya/commune addressing, COD, Arabic-first storefronts). A
tenant builds one-product landing pages in a console editor, publishes them at
`/{tenant-slug}/{page-slug}` (or a verified custom domain), and receives orders
from an anonymous checkout. It sells **standalone** — a builder-only tenant has
pages, orders, tracking, and webhooks — and **integrated**, where a checkout
also creates the ERP's fulfilment record in the same transaction.

## 2. Architecture overview

One Next.js app (`apps/website-builder` — the name is historical; it hosts the
whole platform) with three surfaces this product owns:

| Surface | Where | Auth |
|---|---|---|
| Console screens | `src/app/console/builder/**` + `settings/integrations` | Platform session + entitlement + permission |
| Console API | `src/app/api/builder/**`, `api/platform/integrations/**` | `tenantRoute(permission, handler)` — session, tenant binding, permission, one wrapper |
| Public storefront | `src/app/(storefront)/[tenant]/**` + `api/storefront/[tenant]/**` | Anonymous; tenant from URL/domain; published rows only |

**Tenancy is three layers** (never weaken any): `tenantId` columns → the bound
client (`withTenant`/`forTenant` — application code never writes
`where: { tenantId }`) → Postgres RLS with `FORCE` + `WITH CHECK` on all 48
scoped tables. RLS denies by returning **zero rows**, not by erroring — the
most common way to lose an hour here.

**Schema** (in `packages/db/prisma/schema/builder.prisma`): `LandingPage` and
its relations (media with GALLERY/DESCRIPTION placements — gallery[0] is the
hero; variants; features; reviews; faqs; a 1:1 `LandingSetting` holding flags
and the order-form config), `SalesOrder` (immutable commercial snapshot) +
`SalesOrderStatusHistory`, `DraftOrder` (abandoned checkout), `Category`,
`LandingTheme`, `TenantDeliveryPrice` + platform-owned `Wilaya`/`Baladia`,
`WebhookEndpoint`/`WebhookDelivery`, `TrackingIntegration` (LB.5), and the
deprecated `MetaPixelConfig`.

## 3. The wire-contract rule — the one lesson above all others

The platform port broke this product **not in the API but between the browser
and the API**: nine independent client/server contract drifts shipped while
every contract test stayed green, because the tests post the route's own shape
(BUILDER_AUDIT B-01…B-07, W-01). The standing rule, applied throughout LB:

> **A vocabulary lives in ONE module, imported by both sides, and is asserted
> both ways.** `lib/storefront/contract.ts` (checkout/draft bodies),
> `lib/landing/mock-order-form.ts` (order-form config),
> `lib/webhooks/events.ts` (event catalogue), `lib/tracking/config.ts`
> (provider catalogue), `lib/tracking/events.ts` (event model).

Corollaries that bit and are now load-bearing:
- A Prisma **Json column returns the VALUE**; `JSON.parse` on it throws. Three
  separate features were dead because of this exact call.
- Anything that re-reads rows in its own binding (webhook triggers, tracking
  dispatch) must run **after the writing transaction commits** —
  `tenantRoute`'s `afterCommit`, or after `withTenant` returns.
- Modules meant for direct `node --test` import use **relative imports with
  `.ts` extensions** and no `@/` alias, no `server-only` (the calc.ts pattern).

## 4. Editor architecture

`/console/builder/pages/[id]/edit` mounts `EditWorkspace` (client) outside the
console shell — a full-bleed workspace. Sections (`components/landings/edit/
sections/*`) each own a `useSectionState` save cycle and PATCH/PUT their own
route: general (incl. SEO columns), pricing, gallery + description images
(placement-scoped media replace — saving one list cannot delete the other),
variants, shipping, order form (whole `OrderFormConfig`), reviews, SEO.
Two providers wrap it: `BuilderApiProvider` (`/api/builder`) for section saves,
`StorefrontApiProvider` (this tenant's real storefront API + page base) for the
live preview — the preview offers exactly what a customer sees. Benefits/FAQ
remain "Coming Soon" (see §13); Integrations is a signpost to the workspace
settings.

**Publishing** is its own permission (`website-builder:pages:publish`) and route;
it refuses a page with no title or price, fires `page.published`/`page.unpublished`,
and the storefront serves only `published: true, status: "PUBLISHED"` rows.
**Duplication** (`POST /landings/[id]/duplicate`) copies every relation into a
DRAFT under the next `-copy-n` slug; the pages list has Edit/Duplicate/View row
actions.

## 5. Rendering and the order flow

The public page (`(storefront)/[tenant]/[slug]/page.tsx`) loads the page with
all relations in one bound query and renders `LandingTemplate` — the same
component tree the editor previews. Head: seo title/description, OG + Twitter
cards (hero image), path-canonical, Product JSON-LD. `(storefront)/[tenant]/
layout.tsx` reads the tenant's active tracking integrations server-side and
mounts the one `TrackingScripts` loader.

**Checkout** (`POST /api/storefront/[tenant]/orders`) is the platform's one
public write and its most bounded route: prices are **never trusted from the
client** (base price, variant extras by id, wilaya delivery price all
recomputed from the tenant's rows); per-IP rate-limited; the draft token marks
the abandoned lead converted **in the same transaction**; when the tenant holds
the ERP, `fulfilmentFromSale` creates the operational record in the same
transaction (M-05 — either both exist or neither). After the transaction:
`order.created` webhook + server-side Purchase events, both fire-and-forget.
**Draft capture** posts progressively (debounced + pagehide beacon), silent-204
by design, fires `draft_order.created` once (then `.updated`) and a Lead event.

## 6. Tracking architecture (LB.5)

One canonical event model, provider adapters, nothing else knows providers
exist:

```
lib/tracking/
  events.ts      — vocabulary + ServerTrackingEvent + shared sha256 hashing
  config.ts      — provider catalogue (validation + console form, one source)
  providers/
    meta.ts      — CAPI: advanced matching (ph/fn/ln/country hashed), fbc/fbp,
                   event_id dedup, test_event_code   [META_GRAPH_BASE override]
    tiktok.ts    — Events API v1.3: hashed phone, ttclid/_ttp, its own event
                   names (Purchase→PlaceAnOrder, Lead→SubmitForm)  [TIKTOK_API_BASE]
    ga4.ts       — Measurement Protocol: transaction_id dedup, derived
                   client_id fallback                [GA4_API_BASE]
  dispatch.ts    — server-only fan-out over active TrackingIntegration rows;
                   per-destination isolation; never awaited on customer paths
components/landing/tracking-scripts.tsx
                 — browser loader: boots Meta/TikTok/gtag(GA4+Ads)/GTM from
                   server-passed props, captures fbclid/ttclid, buffers early
                   events, fans track() out per provider
```

**Events fired:** PageView (per nav) · ViewContent (public product page only —
never the editor preview) · InitiateCheckout (first form interaction) · Lead
(first draft capture with a phone, server-side) · Purchase (thank-you page
browser-side AND server-side, sharing the ORDER ID as the dedup key — for COD
the server event survives ad blockers; each platform counts the sale once).
AddToCart is in the vocabulary for future use; custom names pass through.

**Configuration** (`TrackingIntegration`): `provider`, `publicId` (validated
per provider by name), encrypted `serverToken`, `testCode` (Events-Manager
verification), `settings` (e.g. the Google Ads conversion label), `managedBy`
(`customer` | `platform` — the platform-managed vs customer-owned split as
data), `isActive`. CRUD at `/api/platform/integrations/tracking`; the
storefront reads public ids only via `/api/storefront/[tenant]/tracking` and
the layout's select. **Adding a provider:** one adapter module + one line in
`SENDERS` + one catalogue entry (+ a browser boot snippet if it has one).

## 7. Webhook architecture (LB.3)

Events: `order.created/updated/cancelled`, `draft_order.created/updated`
(leads), `product.created/updated/deleted`, `page.published/unpublished` —
declared in `lib/webhooks/events.ts`, every one with a live trigger. Payloads
are Shopify-shaped (`payloads.ts`) so existing CRM parsers work; wilaya/baladia
travel as real fields.

Delivery (`deliver.ts`): HMAC-SHA256 over the exact raw body
(`X-LandingOS-Hmac-SHA256`, base64), topic/resource/attempt headers, 3 attempts
with 1s/4s backoff, 4xx-no-retry (except 429), 10s timeout, per-delivery log
rows (no payloads stored — PII). Secrets encrypted at rest
(`lib/meta/crypto.ts`, key derived from AUTH_SECRET — **rotating AUTH_SECRET
invalidates every stored secret and token**); `revealStoredSecret` grandfathers
plaintext legacy rows. Destinations must be https on a public host
(`url-guard.ts`; DNS-rebinding is out of scope, see §13). Console: full CRUD,
event picker from the catalogue, send-test (single signed attempt through
`afterCommit`, real result returned), per-endpoint delivery log.

## 8. Standalone vs integrated deployment

There is **one build**; the difference is a subscription row's `entitlements`
array. A builder-only tenant (`['product.website-builder']`): console front
door redirects to `/console/builder`, every builder screen/API works, tracking
and webhooks are PLATFORM surfaces (not entitlement-gated) so integrations
work, checkout works, order management works — and `hasErp(db)` (read inside
the checkout transaction, through the registry) answers false, so **no ERP
record is created and no ERP surface exists** (404s). Verified end to end in
LB.7. Integrated tenants get the same checkout plus the M-05 same-transaction
fulfilment record. Nothing in this product enumerates products; the registry
decides.

## 9. Security posture

- Anonymous surface: checkout recomputes all money server-side; per-IP sliding
  window limits (checkout 10/5min → 429 by name; draft 60/5min → silent 204;
  env-tunable via `CHECKOUT_RATE_LIMIT`/`DRAFT_RATE_LIMIT`; **per-process** —
  multiply by instance count, upgrade path is a shared store).
- Uploads: authed, MIME + size validated, re-encoded via sharp, tenant-prefixed
  keys, per-segment traversal guard on the read path (PM.2).
- Secrets: webhook secrets + tracking tokens encrypted (AES-256-GCM), masked in
  every response, absent from every storefront select by shape.
- Reserved slugs, suspended-tenant storefront blackout, draft pages
  unreachable, cross-tenant everything asserted by suites.
- Outstanding (see §13): CSRF origin check and login throttling are platform
  Tier-4 work; the order-status route is gated by `orders:read` (B-08).

## 10. Testing performed

Suites (all green per file; run with the server up, `ERP_CONTRACT=strict`):

| Suite | Count | What it proves |
|---|---|---|
| `storefront.test.ts` | 27 | Publication/tenancy walls, priced-from-rows checkout, the LB.1 contract (draft conversion, fbc/fbp accepted, wilayas shape) |
| `builder-sections.test.ts` | 50 | Section rules, placement-scoped media, the editor's order-form shape, **manifest-driven screen coverage**, the front-door redirect |
| `builder-api.test.ts` | 22 | CRUD, entitlement, permissions, isolation |
| `webhooks.test.ts` | 9 | **Real deliveries to an in-process receiver**: HMAC verified over the raw body, subscription filtering, all event families, retry semantics, honest logs, encryption at rest |
| `tracking.test.ts` | 12 | Pure payload builders (hashing/mapping/dedup) + a real checkout fanning Purchase to Meta/TikTok/GA4 stubs with one dedup id; Lead on capture |
| `hardening.test.ts` | 10 | Limiter window (pure), URL guard (pure), SEO in the live page head, duplication relation-by-relation |
| `console-shell.test.ts` | 13 | Shell/nav |

To run the delivery-sensitive suites, start the server with the stub bases:
`META_GRAPH_BASE/TIKTOK_API_BASE/GA4_API_BASE=http://127.0.0.1:48790` and
raised rate limits (`CHECKOUT_RATE_LIMIT=1000 DRAFT_RATE_LIMIT=5000`).

**Live validation (LB.7), driven in a real browser:** page duplicated from the
list into its copy's editor; configured (title/slug/variants/pricing);
published through the UI dialog; the public page rendered with the discount
badge and both variant groups; a customer selected a +800 variant and ordered —
total 8,200 computed correctly; the draft capture fired a **Lead** and the
checkout a **Purchase** at Meta CAPI and GA4 (observed at a local receiver,
with the order id as dedup key); the thank-you page landed tenant-prefixed; the
order appeared in the console and was confirmed through the UI with a history
trail; the ERP fulfilment `ORD-0020` existed with the same money. The
standalone tenant walkthrough (§8) all passed, including zero ERP rows. Mobile
375px: no horizontal overflow.

## 11. Production readiness checklist

- [x] Public page renders; checkout works in a real browser (was: total outage, B-01/02/03)
- [x] Editor loads and every section saves what it claims (was: crash + silent no-ops)
- [x] Abandoned leads captured, converted on purchase, and delivered as events + webhooks
- [x] Webhooks: configurable, signed, retried, logged, testable from the console
- [x] Tracking: Meta pixel+CAPI, TikTok pixel+Events API, GA4, GTM, Google Ads — configurable per tenant, dedup-safe
- [x] Standalone tenant fully functional; integrated tenant creates the ERP record transactionally
- [x] SEO/OG/JSON-LD on public pages; sitemap-ready canonicals
- [x] Public writes rate-limited; secrets encrypted at rest; SSRF guard on webhook URLs
- [ ] Deployment env: set `AUTH_SECRET` (never rotate casually — it derives the secret-encryption key), `DATABASE_URL`, R2 vars for durable uploads (`/api/health` reports the storage backend)
- [ ] Real-credential smoke test: no request has crossed the REAL Meta/TikTok/GA4 endpoints — the adapters are spec-built and stub-verified (the ZR/Ecom precedent). Verify with a test pixel + `testCode` in Events Manager before first ad spend.
- [ ] CSRF origin check + login throttling (platform Tier 4)

## 12. Known limitations

1. **Benefits and FAQ**: tables, schema and storefront renderers exist;
   `toLandingPageData` hardcodes `features: []` / `faqs: []`, there are no
   routes and no editor sections. Building them is mechanical (copy the
   reviews section + route end to end, then unhardcode the mapper).
2. **The editor speaks English** (54 legacy components) in an ar/fr console;
   the storefront thank-you page is English (M-04). The chrome (create page,
   lists, templates) is translated; the editor body is not.
3. **No version history / undo**; sections save destructively. Autosave exists
   only as the draft-capture analogue on the customer side.
4. **Rate limiter is per-process**; webhook SSRF guard checks the hostname as
   written (no resolve-time pinning).
5. **`orders:read` gates the order-status WRITE** (audit B-08) — an
   authorization decision (N16's class): fix by adding
   `website-builder:orders:write` to the manifest and gating the status route
   + UI on it.
6. **Legacy `MetaPixelConfig`** rows are display-only; the pipeline reads
   `TrackingIntegration` exclusively. Migrate any real rows by recreation,
   then drop the model.
7. **Storefront pages are `force-dynamic`** — a cold query per view. Fine at
   launch scale (one bounded query); the caching story (ISR keyed off
   publish + delivery-price writes) is designed-but-not-built.
8. **`LandingPage.facebookPixel` / `webhookUrl`** are dead legacy columns
   (M-06); remove with a migration when convenient.
9. **Wilaya list on the storefront** is priced-wilayas-only by design; a shop
   with no delivery prices shows an empty destination list — the console
   should nudge new tenants to price wilayas first (onboarding gap).

## 13. Roadmap recommendations, in order

1. Benefits/FAQ end to end (§12.1) — small, closes the last "Coming Soon".
2. `website-builder:orders:write` (§12.5) — small, closes the auth gap.
3. Editor i18n (§12.2) — commercial for ar/fr merchants.
4. Real-credential verification pass for Meta/TikTok/GA4 (one afternoon with
   test pixels; the `testCode` field exists for exactly this).
5. Storefront caching (§12.7) + image `sizes` audit.
6. Version history: an append-only `LandingPageRevision` snapshot on publish
   is the cheap 80%.
7. Custom-domain management UI — the resolve path is already live and safe
   (`tenantByDomain` refuses unverified rows); only the console flow is
   missing.
8. Templates as real LAYOUTS (M-19), not only palettes.

## 14. For the next engineer

- Read `BUILDER_AUDIT.md` §1–3 first: every class of defect this product has
  ever shipped is one of two shapes — a vocabulary duplicated across the
  browser/API boundary, or a writer/reader that never met. The guards now in
  place (shared contract modules, manifest-driven screen tests, real-receiver
  delivery tests) each close a class, not an instance. Extend them, don't
  bypass them.
- **End every slice with a real action through the running app.** The three
  worst defects here were invisible to a green 89-test suite and obvious
  within one minute of using the product.
- Windows dev loop: **stop node → build → start**, every time; `next start`
  loses the port race silently and you will verify against a stale build.
  Judge suites per file (documented Neon connection limit).
- The DB is live and shared. `seed:demo` resets only the demo tenant.
