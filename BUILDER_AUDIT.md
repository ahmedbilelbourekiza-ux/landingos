# BUILDER_AUDIT — the Landing Page Builder, measured before anything moved

**Date:** 7 August 2026 · **Measured from:** `ee1f442` (*PM: the product maturity pass*)
**Method:** every workflow driven through the RUNNING app as a real user — sign in,
create a page, edit it, publish it, open the storefront as a customer, attempt to
order — plus a read of every builder route, component, schema model and test.
Nothing below is inferred from code existing; each finding names how it was
observed. This is the builder's `UI_UX_AUDIT.md` §0b: the measurement the work is
planned from, taken **before** anything moved.

**The verdict in one sentence: the API layer is production-grade and the
browser-facing half is broken end to end** — the public landing page crashes on
load, the editor crashes on load, checkout would 422 if it could be reached,
no analytics event has ever fired, and no webhook has ever been delivered.
Every contract suite is green (builder-api 22 · builder-sections 45 ·
storefront 22), because the contract suites drive the API and the breakage
lives in the layer between the browser and that API. This is AUDIT.3's lesson
at product scale: **a green suite over the API proves nothing about the page.**

---

## §1 The broken commercial path — P0, each observed live

### B-01 · The public landing page crashes for every customer
**Observed:** `/acme/montre-elegante-pro` renders "This page couldn't load" with
`TypeError: M.find is not a function` in the console.
**Cause:** `purchase-form.tsx` loads destinations with `setWilayas(wJson.data)`,
but `/api/storefront/[tenant]/wilayas` returns the platform envelope
`{ success, data: { items: [...] } }`. `wilayas.find(...)` then throws inside
render and the error boundary replaces the page. The same fetch is issued
**twice** (lines 196–199) — the second was clearly meant to be a prices call and
both hit `/wilayas`.
**Consequence:** no customer can see a published landing page, so the product
sells nothing. Every page view is a lost sale.

### B-02 · Checkout posts a body the API refuses
`purchase-form.tsx` sends `landingId`, `baladiaId` (number), `variants`
(name/value pairs); `POST /api/storefront/[tenant]/orders` requires
`landingPageId`, `baladiaName` (string), `variantIds` (ids). Result: 422 on
every submission even once B-01 is fixed. The variant mismatch is also a
pricing hole in waiting: the API prices from `variantIds`, so a form that never
sends them sells every variant at base price.

### B-03 · The thank-you redirect is double-wrong
On success the form does `router.push(`/thank-you/${json.data.orderId}`)`. The
API returns `data.id`, not `data.orderId` (→ `/thank-you/undefined`), and the
storefront's thank-you page lives at `/[tenant]/thank-you/[orderId]` — the push
goes to the root namespace, which resolves `thank-you` as a reserved tenant slug
and 404s. A customer who somehow ordered would land on a 404 and order again.

### B-04 · Abandoned-lead capture has never captured a lead
`use-draft-capture.ts` posts `landingId` / `wilayaId` / `baladiaId` (numbers);
`/api/storefront/[tenant]/draft-orders` requires `landingPageId` and
`wilaya`/`baladia` as **names**. The route answers 204 to malformed input BY
DESIGN (it must never error at a customer), so every capture since the platform
port has been silently discarded. The `draft_order.created` webhook — the lead
event — has therefore never fired either.

### B-05 · The editor crashes on load
**Observed:** creating a page lands in the editor, which immediately replaces
itself with the error screen (`e.data.map is not a function`).
**Cause:** `general-section.tsx` does `json.data.map(...)` for categories and
`setThemes(json.data)`; the platform routes return `data.items`. The
delivery-price read in the shipping section has the same envelope mismatch.
**Consequence:** pages cannot be edited through the console at all. Every
section save, image upload and publish control is unreachable because the
workspace dies first.

### B-06 · The conversion columns nobody writes
`DraftOrder.convertedOrderId` / `convertedAt` exist so an abandoned lead stops
being chased once the customer converts; the form sends `draftToken` at
checkout — and the checkout route drops it (zod strips unknown keys), so no
draft is ever marked converted. A recovered customer stays in the abandoned
list forever. Same shape as PM's "column with a writer and no reader", in the
other direction.

---

## §2 Tracking and integrations — the state of each claim

The DEPLOY.md-era feature set ("Meta Pixel + CAPI, encrypted tokens") survived
the platform port as **disconnected pieces**. Current truth, verified:

| Piece | State |
|---|---|
| `MetaPixelLoader` (browser pixel) | **Mounted nowhere.** No storefront layout exists; no page renders it. PageView/fbc capture never run. |
| `MetaPixelLoader` internals | Broken twice over even if mounted: `fetch(api("/meta-pixels"))` references an undefined `api` (ReferenceError), and it reads `data.pixelId` where the route returns `data.pixelIds`. |
| `trackViewContent` | Calls the `useStorefrontApi` **hook inside a plain function** — invalid hook call, throws when invoked. `ViewContentTracker` is itself mounted nowhere. |
| `trackInitiateCheckout` | Called by the form; buffers forever because the pixel never initialises. |
| Meta CAPI (`lib/meta/capi.ts`) | `sendPurchaseEvent` references `tenantId` that is not in scope — a guaranteed ReferenceError swallowed by its own catch. Masked by `typescript.ignoreBuildErrors: true`. **And it has zero callers.** The comment in the pixel loader says "Purchase is sent server-side via CAPI, the source of truth for COD" — nothing sends it. |
| `fbc`/`fbp` attribution | The form reads the cookies and sends them; the checkout API's zod schema strips them. Attribution is lost server-side even after CAPI is fixed. |
| TikTok | Nothing exists. `StoreSettings.tiktok` is a social LINK for the footer, not tracking. |
| GA4 / GTM / Google Ads | Nothing exists. |
| Advanced matching | CAPI hashes ph/fn/ln/country only; no em/ct/st/zp; no event dedup with a browser event (there is no browser Purchase). |
| Event vocabulary | No AddToCart, no Lead, no custom events, no generic pipeline. Meta is hard-wired where anything exists at all. |

**Conclusion:** the tracking requirement is a green-field build with two
salvageable parts (token crypto, the CAPI payload shape) — not a review task.

## §3 Webhooks

The bones are genuinely good — HMAC-SHA256 over the exact body, retries with
backoff, 4xx-no-retry, per-delivery log rows, encrypted secrets, tenant-bound
dispatch, fire-and-forget on customer paths. And none of it has ever run:

- **W-01 · `subscribesTo` kills every delivery.** `WebhookEndpoint.events` is a
  Json column; Prisma returns the ARRAY, and `deliver.ts` calls
  `JSON.parse(endpoint.events)` on it, which throws (`JSON.parse` of an array
  coerces to `"a,b"`), is caught, and returns `false`. Every endpoint therefore
  "subscribes to nothing" and every event is skipped with "no subscribed
  endpoints". No outbound webhook has ever been delivered on the platform.
- **W-02 · Three declared events have no trigger.** `product.created/updated/
  deleted` are in `WEBHOOK_EVENTS`, offered to subscribers, and fired by
  nothing.
- **W-03 · `draft_order.updated` never fires** — only `.created` has a caller.
- **W-04 · No page lifecycle events.** `page.published` / `page.unpublished`
  (mission requirement) do not exist.
- **W-05 · No console surface.** The settings screen offers CRUD; the
  `WebhookDelivery` log has no reader, there is no "send test event", no
  redelivery, and the secret can never be seen again after typing it (not even
  once, at creation).
- **W-06 · No delivery-layer test.** The suites test CRUD and masking; nothing
  ever receives a webhook in a test. (The ZR stub-server pattern in
  `delivery.test.ts` is the worked example to copy.)

## §4 Standalone mode

- **S-01 · A builder-only tenant's console front door is a 404.**
  `app/console/page.tsx` redirects a single-product session to
  `session.products[0].basePath` — `/builder`, which is the **storefront tenant
  namespace**, not `/console/builder`. Observed live: `/builder` → 404. The
  multi-product picker cards have the same bare `basePath` hrefs. A customer
  who buys only the builder cannot reach their product by any navigation.
- **S-02 · Two nav items 404.** The manifest declares `templates` and
  `delivery-prices` under `/console/builder/...`; neither route exists
  (delivery prices actually live at `/console/settings/delivery-prices`).
  LP.17's defect shape, on the builder — and the manifest-drives-screens test
  that closed it for the ERP (`ai.test.ts`) was never generalised to this
  product.
- **S-03 · What already works:** checkout skips the ERP fulfilment record for
  an unentitled tenant via `hasProduct` inside the same transaction
  (`from-sale.ts`) — the right architecture; order management exists at
  `/console/builder/orders` with the status state machine; entitlement gating
  is tested. Standalone is close once S-01/S-02 and the browser layer are fixed.

## §5 Product maturity

- **M-01 · Four editor sections are "Coming Soon" stubs:** Benefits, FAQ, SEO,
  Integrations. Meanwhile `LandingFeature` and `LandingFAQ` tables exist WITH
  storefront renderers (`benefits-list.tsx`, `faq-section.tsx`) and no API; and
  `seoTitle`/`seoDescription` are READ by `generateMetadata` on the public page
  with no writer anywhere. Three instances of the platform's most-documented
  defect class in one screen.
- **M-02 · No duplicate page, no version history, no autosave, no undo.**
  Sections save explicitly (fine as a model), but a mis-save has no way back.
- **M-03 · SEO surface is title/description only.** No OG image, no canonical,
  no JSON-LD, no per-tenant sitemap/robots. For a product whose pages exist to
  be advertised, link previews (og:image) are commercially load-bearing.
- **M-04 · The editor speaks English in a French/Arabic console.** The 54
  editor components and the create screen are untranslated (legacy import);
  the storefront thank-you page is hardcoded English for an Arabic customer.
  **CLOSED 11 August 2026 by LB.13 (`EDITOR_I18N.md`) — and the measurement
  corrected this entry twice.** The create screen was already translated by
  then, and **ten of the "54 components" are unreachable from `app/`**: the
  legacy dashboard's page list, superseded by the server-rendered pages
  screen and imported only by each other. Real scope was 31 live components
  with hardcoded strings (of 48 reachable), 213 keys. The thank-you page had
  already closed in LB.10.
  It also contained a defect this entry did not describe: every section's save
  rendered the platform envelope's **developer-facing English message**, which
  `lib/console/action-errors.ts` states must never reach a screen.
- **M-05 · Money enters through `type="number"`** on the create screen —
  the exact input style D-06's rules refuse for `Decimal` columns.
- **M-06 · Dead per-page columns:** `LandingPage.facebookPixel` and
  `.webhookUrl` (legacy single-store fields) have no reader or writer.
- **M-07 · `LandingSetting.countdownEnabled`, `floatingWhatsapp`, `showReviews`,
  `showFAQ`, `showFeatures`, `shipping` — several toggles with no editor
  control and/or no template consumer; inventory them during the section work.

## §6 Performance

- **P-01 ·** Every storefront page is `force-dynamic` with 8 relation includes;
  no cache header, no ISR. For an ad-landing product the hot path is a cold
  query every time. (Bounded and indexed, so acceptable at launch scale —
  but decide and record the caching story.)
- **P-02 ·** The gallery renders through plain `<img>` (verify per-component);
  hero has no priority/preload; below-fold sections are not lazy.
- **P-03 ·** Uploaded images are stored at max 2000px q82 with immutable cache
  headers (good), but no responsive sizes/srcset are produced.
- **P-04 ·** `typescript.ignoreBuildErrors: true` hides real breaks (it hid the
  CAPI one). Cost of turning it off must be measured, but every hour it stays
  on is another B-class defect waiting.

## §7 Security

- **G-01 ·** No rate limiting on the two public writes (checkout, draft
  capture) — the platform-wide Tier-4 gap, but these two routes are where a
  competitor's script hurts a real store first (fake COD orders cost real
  courier fees). Needs at least a per-IP limiter now.
- **G-02 ·** Webhook URLs are validated https + tenant-scoped, but nothing
  stops `https://10.0.0.1/...` — SSRF via webhook receiver. Low severity
  (egress from the app host), worth a private-range refusal.
- **G-03 ·** Upload path is authed, sharp-reprocessed, extension-whitelisted,
  traversal-guarded per segment (PM.2) — good. R2 keys are tenant-prefixed.
- **G-04 ·** Storefront checkout recomputes every price server-side; forged
  totals tested. Draft capture stores no prices. Both remain sound.
- **G-05 ·** `data-tenant` / reserved-slug / suspended-tenant handling in
  `resolve-tenant.ts` is correct and tested (R-08).

## §8 What is genuinely good — do not trade any of it back

The unified schema (snapshots on `SalesOrder`, per-tenant slugs, Json variants,
the delivery-price model); RLS + tenant binding with zero `where:{tenantId}`;
`tenantRoute` + `afterCommit`; the checkout's server-side pricing; the M-05
same-transaction ERP handoff behind `hasProduct` (the exact architecture
standalone mode needs); token encryption at rest; the webhook signing/retry
design; 89 green contract tests over the API layer. The product's foundation is
better than most shipping SaaS builders — it is the last mile that is severed.

## §9 The plan — slices, in order

| # | Slice | Closes |
|---|---|---|
| **LB.1** | The storefront speaks to its own API again: shared checkout/draft contract module, form + capture + thank-you fixed, draft conversion written | B-01..04, B-06 |
| **LB.2** | The editor stops crashing: every section consumer on the platform envelope, verified live section by section | B-05 |
| **LB.3** | Webhooks become the first-class feature: W-01 fix, page/product/lead events, delivery log + test send in console, real delivery tests against a stub receiver | W-01..06 |
| **LB.4** | The console front door and the two nav 404s; a templates screen over the themes API; manifest-driven screen test for the builder | S-01, S-02 |
| **LB.5** | The tracking pipeline: generic event model + provider adapters (Meta pixel+CAPI rebuilt, TikTok pixel+Events API, GA4/GTM/Ads), storefront layout mounting one loader, checkout/draft/thank-you emitting, console integrations UI | §2 whole |
| **LB.6** | SEO + the stub sections: seo editor + OG/JSON-LD, benefits/FAQ API + editors, duplicate page | M-01..03 |
| **LB.7** | Hardening: public-route rate limiting, webhook private-IP refusal, money inputs, i18n of builder chrome | G-01, G-02, M-04, M-05 |
| **LB.8** | Validation end to end + `BUILDER_HANDOFF.md` | — |

Rules carried over: one slice per commit; every slice ends with a real action
through the running app; the contract suites stay green per file; every new
vocabulary lives in the module that validates it and is asserted both ways.
