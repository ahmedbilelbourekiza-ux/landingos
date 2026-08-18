# LandingOS — Project State

**Last updated:** 16 August 2026 (deploy session, afternoon) — everything
through **LB.53** is **DEPLOYED**: LB.51–LB.53 (the TTFB query-census fix,
the gallery-warming trade, the price-contrast fix) went live as
`831c48d..d915c77`, pushed 13:28 UTC — a pure fast-forward of the
`claude/perf-ttfb-images-2otrah` branch, no migration (generator preview
flag only, re-verified on the range before pushing). All nine suites
re-ran green at recorded counts on the exact deployed tree in a fresh
harness. **The live PSI after-numbers are still owed** — the deploy
session's egress policy also blocked production, and the PageSpeed API
answered 429 (shared-IP anonymous quota) for the entire session window;
HANDOFF_PRODUCTION's top block records exactly what was and was not
verified. **Same session, night — user-approved: LB.24 (the AI landing
generator, Darija-first) AND LB.54 (the digit-only-slug fix for the real
`selliora1.com/0` 404) are DEPLOYED as `1dbe119..c722050`, pushed 23:36
UTC — LB.24 fast-forwarded, LB.54 rebased on top (doc conflicts resolved
keep-both), no migration re-proven with `prisma migrate diff` on both
schemas. The FULL battery ran green on the exact merged tree: sixteen
suites, 475 tests, every count at its recorded value. Live verification
of both markers is owed (egress unchanged): the create screen showing
the AI panel/notice, and an Arabic+digit title refusing instead of
minting a digit slug.** **The first real custom domain
(`selliora1.com`) serves end to end and the console links it**
**17–18 Aug 2026 — SEC.1–SEC.5 + SA.1 ARE DEPLOYED and the record is
finally written.** `origin/main` = **`d26074c`**, live at Render
14:35:35 UTC on 17 Aug (`c3d911d..d26074c`, six commits, 25 files,
rollback `c3d911d`, no migration). SA.1 is a REAL REGRESSION closed: LB.54's
letter rule had reached three write paths and the AI generate route was the
fourth, so `slug:"0"` was refused at three doors and **accepted at the
fourth** — the rule now lives once, in `lib/landing/create.ts`, imported by
all four. **Liveness was confirmed read-only at the Render API, not from the
outside: this range has NO public marker** (every commit is server-only or
console-only, and `/api/health` carries no SHA), which is why it sat six
commits deep with no doc for a day. **THREE checks are CLOSED-UNVERIFIED,
not pending** — the SEC.1 two-order phone-dedup (unit-tested only), the
SEC.4 create-screen notice, and the SA.1 Arabic-title refusal all need
`landingos_prod`, which is inside the quota-suspended Neon project the user
placed off-limits on 17 Aug. **Dev now runs on a separate Neon project
(`ep-gentle-sky-b1rahhl0`) — see "Two Neon PROJECTS" below; both databases
are named `neondb`, so identify by HOST.**

**Branch:** `main`, tracking `origin/main` at `d26074c` (the local branch was
renamed from `master` on 17 Aug so a plain `git pull` works) · **Everything
through LB.44 is deployed:** LB.31–LB.36 + LB.15 + LB.14a/b/c as `d6a56b1`,
**LB.37** (`fcbd1e5`) the storefront `<head>` fix, **LB.38** (`a70f588`)
the Delete door, **LB.39** (`dbe1cf0`) the per-tenant sitemap, **LB.35b**
(`dd4edac`) the per-page pixel control, **LB.40** (`f1e38bf`) `robots.txt`,
**LB.41** (`94b6a40`) the settings-screen locale fix, and — 15 Aug evening,
`3fc1ade..4742554` — **LB.42** write-panel i18n, **LB.43**
`event_source_url`, **LB.44** the storefront LCP fix (real Lighthouse
before/after on the live page: 50→75, LCP 5.8→3.4s, Render Delay
2,479→34ms). **Nothing is queued; no migration is pending.** Also 15 Aug:
**LB.11 closed** with no code — the user's real pixel + CAPI token on the
real store, Purchase ×2/Lead ×2 confirmed received by Meta (CHANGELOG
§LB.11); the **image upload pipeline confirmed correct** by live probe (8MB
refusal before processing, 2000px cap verified at 2000×2000, one shared
pipeline for gallery/description, WebP at serve time); one user action open —
the pixel's Traffic Permissions must allow `landingos.onrender.com`. **LB.35's missing per-page pixel control
was built and deployed as LB.35b.** The one deliberate open decision left in
this area is `robots.txt` (§LB.39). LB.35's column was applied to
`landingos_prod` earlier the same night; the app code followed as
`bd6d664..d6a56b1`. See `HANDOFF_PRODUCTION.md` §1 first.

---

## PHASE LB — THE LANDING PAGE BUILDER BECOMES A COMMERCIAL PRODUCT: COMPLETE

The ERP is deliberately paused (its PM work was committed as `ee1f442`). This
phase treated the builder as its own commercial SaaS product, per the
launch-readiness mission: audit first, then repair, then the integration
platform, then validation as a real customer.

**Two documents own this phase and are deliberately separate from the ERP's:**

- **`BUILDER_AUDIT.md`** — the before-measurement. Its headline: the API layer
  was production-grade and the BROWSER half was broken end to end — the public
  page crashed for every customer, the editor crashed on load, checkout could
  not post a body the API accepted, no analytics event had ever fired, no
  webhook had ever been delivered (three independent kills in one pipeline),
  and a builder-only tenant's console front door was a 404. Every finding was
  observed in the running app, not inferred; every contract suite was green
  throughout, because the breakage lived between the browser and the API the
  suites drive directly.
- **`BUILDER_HANDOFF.md`** — the after: architecture, the tracking and webhook
  platforms, standalone vs integrated deployment, testing performed, readiness
  checklist, known limitations, roadmap. It stands alone from the ERP handoff.

| Slice | What it closed |
|---|---|
| **LB.1** | The storefront client speaks the API's vocabulary again — `lib/storefront/contract.ts` shared by both sides; checkout, wilayas, thank-you redirect, draft capture and draft CONVERSION all work in a real browser |
| **LB.2** | The editor stops crashing and its saves stop lying — every consumer on the platform envelope, placement-scoped media, the order-form route accepts the editor's own shape, Copy Link stops handing out dead `/l/` URLs |
| **LB.3** | Webhooks become first-class — the Json-array/plaintext-secret/in-transaction-trigger kills fixed, page/product/lead/order events all fire, console write surface + delivery log + signed send-test, 9 delivery tests against a real receiver |
| **LB.4** | Standalone mode's front door and the two manifest nav 404s; the templates screen; the manifest-driven screen test (LP.17's guard, generalised to this product) |
| **LB.5** | The tracking pipeline — one canonical event model, adapters for Meta (pixel+CAPI), TikTok (pixel+Events API), GA4/GTM/Google Ads, a storefront layout mounting one loader, server events after commit, `TrackingIntegration` (RLS 48/48), console surface, 12 tests incl. a real checkout fanning Purchase to three stubbed platforms with one dedup id |
| **LB.6** | SEO writer + OG/JSON-LD, page duplication + the pages list's first row actions, per-IP rate limits on the two public writes, webhook SSRF guard, the Decimal-safe money input |
| **LB.7** | Validation as a real customer, in a real browser: duplicate → configure → publish → variant-priced checkout (8 200 DA computed correctly) → Lead + Purchase observed at Meta/GA4 receivers → order confirmed through the UI → ERP record in the same transaction; the standalone tenant walkthrough end to end with zero ERP rows |
| **LB.9** | Docker/production packaging: every workspace manifest in the deps stage, both Prisma clients generated in-image at the path the standalone bundle searches, a DDL-free entrypoint that verifies instead of mutating, schema/roles/RLS/reference-seed as deliberate repo-side steps (DEPLOY.md rewritten) |
| **LB.10** | The pre-production readiness audit, the night before first deploy — six defects found by reading the shipped pipeline and driving it in a browser, each fixed with a regression test: the Lead that fired only when the FIRST capture had a phone; attribution ids dropped at both public doors; phone hashes that never matched local numbers; console status/create writes bypassing permission + webhooks (B-08); webhook delivery following redirects past the SSRF guard; the login `next` open redirect. Plus Decimal money end to end, the Arabic thank-you page, and the entrypoint's stub-override warning. Suites: 151 green across seven files against the rebuilt server; the full journey re-driven live (CHANGELOG §LB.10) |

**The rule Phase LB adds to the method:** *a green contract suite proves the
API, never the page* — every LB.1/LB.2 defect was a vocabulary duplicated
across the browser/API boundary, drifted, with the suite posting the route's
own shape. The fix that closes the CLASS is a shared contract module imported
by both sides, plus suites that exercise the consumer's exact shape (the
webhook receiver tests, the tracking stub tests, the manifest-driven screen
test). And its corollary, three times over: **a Prisma Json column returns the
value — `JSON.parse` on it throws**, which alone had silently killed webhook
subscriptions, order-form configs and payload variants.

**Suite totals for this product (after LB.10):** storefront 28 ·
builder-sections 50 · builder-api 23 · webhooks 10 · tracking 15 ·
hardening 11 · console-shell 14 — per file, against the running server, with
the delivery suites driving real HTTP receivers. ERP suites untouched.

### After the phase was declared complete — LB.12 onward

The table above is the phase as planned. Everything below was done AFTER Phase
LB was closed, under the same numbering because the queue in `NEXT_STEPS.md`
continued from it. Three of these slices (LB.17–LB.19) touch the ERP rather
than the builder: the numbering follows the queue, not the product.

**All of it is DEPLOYED as of 12 Aug 2026 (evening), user-approved** — the
range `b767928..e3939e9` was pushed to `origin/main` after the LB.20
production migration ran (49/49 RLS), and the deploy was verified live with a
throwaway tenant on the real domain. See `HANDOFF_PRODUCTION.md` §1.

| Slice | What it closed |
|---|---|
| **LB.12** | Benefits + FAQ end to end (`CAPABILITY_AUDIT.md` B1). Deeper than recorded: the storefront FAQ **and Reviews** renderers were mounted by nothing — saved reviews reached the browser in the payload and produced no markup — and `BenefitsList` hardcoded four badges. `features`/`faqs` PUT routes, both editor sections replacing "Coming Soon", mappers unhardcoded, sections mounted with `show*` gating, benefits data-driven with the four COD badges as the empty-state fallback. builder-sections 50→54 |
| **LB.13** | Editor i18n — 213 `builder.editor.*` keys in en/fr/ar across 31 live components plus four shared modules. Closed `BUILDER_AUDIT.md` M-04 and **corrected it twice**: the create screen was already translated, and 10 of the "54 components" were unreachable dead code. Also closed a class the audit never named — every section's save rendered the API's ENGLISH developer message. i18n 20→22 (a new guard that fails on any hardcoded editor string), builder-sections 54→58. Full record: `EDITOR_I18N.md` |
| **LB.16** | The ten dead legacy components deleted, after re-confirming unreachability three ways (filenames, exported SYMBOLS, a fresh import-graph walk). The i18n guard's exemption went with the file rather than into an empty set. `components/landings/` now holds exactly one thing: `edit/` |
| **LB.17** | Back-navigation on the ERP client and product detail screens. `PageHeader`'s breadcrumb was built by UI.22 **to replace these two links** and only the order detail was migrated; both screens rendered a raw `<h1>` with a 44×20px muted word after the title where navigation does not read as navigation. erp/screens 173/173 |
| **LB.18** | The finance module becomes optional per tenant. Nav loses Finance **and** the Calculator, both screens 404 on a typed URL, all nine finance handlers refuse with `FINANCE_DISABLED`, and **nothing is deleted** — `FinancialRecord` is append-only by design. The shell is handed ids, never knowledge. erp/finance 38→44 |
| **LB.19** | Product categories in the ERP catalogue, WITHOUT converting free text to a relation — the schema states a reasoned decision against that. Closed the gap it left: the field was unguided, so values already in use are now offered wherever it appears. Also closed a real duplication — the screen and `GET /api/erp/products` each built their `where` by hand. erp/catalog 72→75 |
| **LB.20** | Per-product delivery pricing. **Schema change:** `LandingDeliveryPrice`, a second table rather than a nullable column (Postgres NULLs are not equal, so a nullable key would stop preventing duplicate defaults). The load-bearing part is that ONE function answers both the quote (`/wilayas`) and the charge (`/orders`) — divergence would bill customers something other than what they saw. builder-sections 62→67, storefront 32/32, packages/db 33/33. **The production migration RAN 12 Aug 2026 (user-approved): `LandingDeliveryPrice` pushed to `landingos_prod`, RLS 49/49, quote=charge verified with a real production order (3,800 both sides).** See `HANDOFF_PRODUCTION.md` §1 |
| **LB.21** | Landing pages publish into the ERP catalogue, all or one. `CatalogProductLink` is the idempotency key; **adoption** protects an existing catalogue, because two rows answering to one normalised name make every order naming it attributable to neither. The Manager's own columns (`costPrice`, stock, supplier) survive an import. builder-sections 67→72 |
| **LB.22** | A storefront theme extracted from a product photograph. The hard part is readability, not colour-finding: the two colours that carry text are chosen by WCAG contrast and the test asserts ≥ 4.5 independently of the implementation. An image with nothing to take is refused rather than guessed at. builder-sections 58→62 |
| **LB.25** | The Finances screen merges into the Calculator. Measured first: both save buttons POST the same `/api/erp/financial-records` into the same append-only record, both nav items sit behind `erp:finance:read`, LB.18's toggle hid both as one unit — so the hand-typed duplicate went. The one-off expense form + list and the current/superseded marker moved onto `/console/erp/calculator`, now titled **Finances**; the URL deliberately stays (the Automation precedent). No route or schema change. erp/screens 173→172 (a removed walkthrough row), erp/finance 44/44, erp/ai 31/31, access 205/205 |
| **LB.26** | A landing page wears its OWN theme, never the viewer's dark mode. next-themes stamps `.dark` on `<html>` for every route (the storefront follows the VISITOR's OS), the template's structure is console tokens, and `--theme-background` had a writer and no reader. The landing `ThemeProvider` now paints its canvas AND redefines the console token names in its own scope (`@theme inline` resolves utilities at the styled element, so the nearest declaration beats `.dark`); the editor's miniature preview wraps in the same scope; `GeneralPreviewValues.themeId` — declared and never sent — now flows, so an unsaved theme selection previews. The scope element is a PLAIN div: framer-motion held the first theme's background after a switch. storefront 32→33, builder-sections 72→73 |
| **LB.27** | A deleted tenant actually goes away. `tenant.delete` cascades platform rows only — product tables carry `tenantId` as an RLS column, not an FK — and `neondb` held **73,267 orphaned rows from 4,149 dead test tenants**. `deleteTenant()` (packages/db) sweeps every DMMF-enumerated scoped model under `withTenant` with UNFILTERED `deleteMany` — RLS decides what "everything" is, so the helper cannot touch another tenant. Chosen over FK cascades deliberately: a cascade makes an accidental delete silently total, and destruction here must be a named act. Harness + 11 suite hooks swapped; backlog bulk-swept to **0** orphans and STILL 0 after suite runs. packages/db 33→35 |
| **LB.28** | The "dead `rtl:` variant" was never dead — the RECORD was. Measured on Tailwind 4.3.3: `rtl:` is native and `:lang()`-keyed; the data-table chevron had been mirroring correctly in Arabic all along, and `ui/calendar.tsx` is imported by nothing. What was wrong: the editor back arrow carried no flip (its comment cited the false premise) — fixed with `rtl:-scale-x-100`, verified ar/fr. Rule recorded in globals.css: the variant matches by LANGUAGE, so it still fires inside `dir="ltr"` islands — never use `rtl:` there; an `@custom-variant` override of the built-in name is silently ignored by Tailwind 4.3. i18n 22/22, builder-sections 73/73 |
| **LB.29** | The Sheet close button moves to the logical edge (`right-4` → `end-4`), closing LB.13's recorded note. Scope corrected by measurement: the mobile nav drawer was NEVER affected (it is custom and logical-first), and `ui/sidebar.tsx` is unmounted — the editor's preview drawer is the only live Sheet. Verified at 375×812 emulation: ar close moved x 343→17 (inline end), fr unchanged at the right. Caveat recorded: no physical device reachable from this environment. builder-sections 73/73 |
| **LB.30** | The rest of the storefront wears the store's theme — LB.26's recorded remainder. Home, category and thank-you rendered console tokens with no scope and followed the visitor's OS (measured near-black under emulated dark). The thank-you inherits the ORDER's landing-page theme via `toThemeData` — the checkout's last step looks like the page the customer bought on; home/category wear `DEFAULT_THEME`, because a store-level theme field on `StoreSettings` is a schema migration + merchant control, deliberately left as a decision with both call sites marked. Mechanism is LB.26's plain-div scope, no new machinery. Verified live both ways (bound theme on the order's page + default), plus the stale-`.dark`-on-light-OS case. storefront 33→36 |

| **LB.14c** | The custom-domain console flow, asked for as something to build — **the premise measured false, for the third time in this queue.** B5 shipped the whole thing on 10 Aug and it is deployed: claim, per-row token, **real DNS TXT proof** via `resolveTxt`, primary, unlink, i18n'd screen, tests. What driving it live DID find: the verify route distinguishes "no TXT record yet" (keep waiting) from "records exist but none match" (you published the wrong string) — the opposite instruction to a merchant mid-setup, and its own comment calls that essential — and **both arrived as "that didn't work"**, because one code carried both meanings in an English developer message the console is forbidden to render, and B5 had mapped **none** of its five refusal codes. Split into `DNS_NO_RECORD`/`DNS_TOKEN_MISMATCH` + six messages ×3 locales; the same shape `action-errors.ts` already records for `UNKNOWN_ADAPTER`. **⚠ The remainder is infrastructure and was NOT built:** a verified row does not make a hostname serve — Render must be told the hostname and issue its certificate, proven by an earlier probe's `x-render-routing` 403, and no Render credential exists on this machine. **So custom domains are complete in the app and inert in production.** `isPrimary` is a writer with no functional reader (Copy Link still uses the console's origin) and must stay that way until the operator question is answered, because a link to a 403 is worse than one to the platform host. platform/domains 13→14 |
| **LB.14b** | Page version history — **SCOPED, NOT BUILT** (needs a table → a production migration → the user's call), plus the defect the measurement found and that DID get fixed. Confirmed nothing exists: the entire schema holds one history table and it is `SalesOrderStatusHistory`. Eleven separate section-save routes means no single write path to hook a snapshot on — which is exactly the drift that had already bitten `duplicate`, the only "way back" a merchant has while M-02 stays open: it had silently stopped copying `deliveryPrices` (LB.20) and `trackingIntegrationIds` (LB.35), so a duplicated HEAVY product under-charged shipping on every order and reported to MORE ad accounts than its original. Both fixed, no migration; a lossy copy is worse than no copy because it looks like a backup. Snapshots measured at 0.6–3.6 KB, so storage is not the argument — the open questions are what restore does to a page that has SOLD (orders point at it, and LB.30's thank-you reads its theme) and whether restore may republish. hardening 12→13 |
| **LB.14a** | The storefront caching story, and the finding inverted the premise. P-01 expected pages that cache too little; measurement found the pages sending `no-store` (the strictest header there is) while **the delivery quote sent no `Cache-Control` at all** — and RFC 9111 lets a shared cache invent freshness for exactly that, so the one response whose staleness costs a customer money was the one with no instruction. The rule: *a response may be reused by a SHARED cache only if a stale copy cannot cost somebody money or expose somebody's order* — stricter than "changes rarely", because a storefront is reachable at a MERCHANT's hostname and this platform cannot purge their CDN. Public pages `private, max-age=60` (the win: `no-store` forbade even a back-button redisplay); quote, pixel configs and thank-you `private, no-store`. **ISR measured UNAVAILABLE rather than declined** — `revalidate = 60` still built `ƒ (Dynamic)` with no warning, because a custom domain wins over a path prefix so every render reads the Host header. Two config rules were silently inert before the response was read (later rules override earlier; `.*` matches the empty root) — which is why the tests assert the SERVED header. storefront 40→48 |
| **LB.15** | A price spinner was rounding the centimes away. Asked for as D-06 style residue; measured as silent data loss. Three boxes were `type="number" step="1"` — `price`, `oldPrice`, and every variant option's supplement, all `Decimal` columns. Two ArrowUp presses on **2990.50 stored 2992**, and any sub-unit price left the box `stepMismatch: true` while `aria-invalid` said it was fine — two verdicts on one control. Now text + `inputMode="decimal"` + `dir="ltr"`, the money island the ERP panels and LB.20's overrides already are. The rule it adds: when a box stops being a number input, ONE function must say what the characters mean — `lib/landing/money-field.ts` serves the schema, the preview strip and the save body, because two readings let a section refuse a price it then sends. A comma is a decimal separator; `1,000` is REFUSED rather than guessed (a 1000× error either way), while a dot with three places is allowed on purpose — it is what a stored `Decimal` returns, and refusing it would redden an untouched form (LB.33). calc 20→28, builder-sections 73→74 |
| **LB.36** | Brands — **SCOPED, NOT BUILT** (no code). `CatalogProduct.brand` already exists as ERP free text, unread by the storefront; `LandingPage` already has a real `Category` relation but no brand of any kind. LB.19's precedent argues for free text, but a brand is RENDERED and owns a public surface, so it needs a stable slug/logo/identity that free text cannot give — recommendation is a `Brand` row, `SetNull` both ways (LB.34: nothing that can reach a page may delete one). Lands on LB.31's seam with no component change: one step before `resolveStoreName`. M–L, one additive table (RLS 49→50). Open questions left to the user in `NEXT_STEPS.md` §LB.36 |
| **LB.35** | A landing page links to its own Meta pixels. **CARRIES A MIGRATION** (one nullable JSONB column; apply to `landingos_prod` before deploying, LB.20 order; no RLS re-run — no new table, still 49). Half the premise measured false: multiple pixels per TENANT already fired, confirmed by Meta's own `fbevents.js` fetching a `signals/config` for both ids. The real gap was per-PAGE selection, blocked structurally — LB.5 mounted the loader in the layout, and an App Router layout cannot see its child segment's params, so "this pixel belongs to this product" was unexpressible. The mount moved down to the four storefront routes and **LB.5's guarantee moved into a test** asserting all four still emit it. `trackingIntegrationIds Json?`: NULL = inherit the tenant's set (every existing row), array = subset, empty = none. Thank-you keeps the whole set on purpose — the Purchase is what every ad account is waiting for. builder-api 29→35 |
| **LB.54** | **A slug must contain a letter — the `selliora1.com/0` 404, traced and closed at the source. DEPLOYED 16 Aug (night), `1dbe119..c722050` (rebased as `0f372bc`); no migration.** `slugify` strips everything outside `[a-z0-9]` — every Arabic letter — so an Arabic title carrying a digit derived a slug of just that digit («ساعة برو 0» → "0") and the create form submitted it SILENTLY; the page published at /0, the home card + category card + domain SITEMAP linked it (reproduced end to end on the local prod build behind a fixture domain), and renaming the slug 404'd every distributed link. General rule, not a zero-guard: a slug without a latin letter is refused — `slugify` derives "" (form asks instead of inventing), `slugCharset` split out for keystrokes so digit-FIRST addresses stay typable, the category form's second slugify copy deleted (D-LP.3), three server write paths gate with 422, editor schema + messages ×3 locales state the rule. Existing digit-slug rows keep serving. NOT done, deliberately: no redirect for already-distributed /0 links (slug-history territory — LB.14b adjacency; decision is the user's). builder-api **42→49** · neighbours green |
| **LB.24** | **The AI landing generator — merchant facts in, an Algerian-Darija draft out. FIRST SLICE DEPLOYED 16 Aug (night), `1dbe119..c722050`; no migration. Production has NO AiProvider row, so the create screen shows the configure-first notice and the route answers NO_AI_PROVIDER — zero API spend possible until a key is configured.** The FEATURE_PASS §5 shape, built: provider-agnostic completion on the existing `AiProvider` rows (`lib/erp/ai-complete.ts` — the new platform's FIRST inference call, legacy trio ported), a Darija-by-design prompt + zod contract (`lib/landing/ai-generate.ts`, bounds inside BOTH the section routes' and the editor's client schemas), `POST /api/builder/landings/generate` in D-LP.5.1's three phases, and a Generate-with-AI panel on the create screen (22 keys ×3 locales). Merchant photos are the images (first = hero, LB.22 palette = the suggested theme); reviews are NEVER generated; a malformed answer writes nothing. Adversarial review (5 lenses) caught the model call holding the 15s tenant transaction across a 30–120s generation — restructured, pinned by a 16.5s slow-model test. Open questions (AI-spend permission/quota; provider setup for builder-only tenants) in NEXT_STEPS §LB.24. builder-ai **19** (new) · neighbours green |
| **LB.53** | **The old price becomes readable — surface colours stop being used as ink.** The general Lighthouse pass found the contrast audit failing on exactly two PriceBlock elements: the crossed-out old price painted in `--theme-muted` (a SURFACE colour — order-summary uses the same variable as a backgroundColor), measured **~1.05:1** on a light theme; and the discount badge's hardcoded `text-white` on an arbitrary accent. Fixed theme-derived, for every theme a merchant picks: `--theme-text-muted` (78% oklab mix of theme text into background) and `--theme-accent-foreground` (black/white chosen by WCAG contrast — LB.22's readable-foreground rule). The WCAG maths moved to client-safe `lib/landing/color-math.ts` (palette.ts is server-only + sharp); ONE definition kept. Local Lighthouse: **accessibility 97 → 100**; the rest of the pass clean or known (JS diet stays the scoped backlog). **DEPLOYED 16 Aug (afternoon), `831c48d..d915c77`. No migration.** storefront 76, builder-sections 74 |
| **LB.52** | **The dedima ~226KiB image finding was LB.48's own lookahead — the trade re-made, measured.** The warm layer mounted BOTH gallery neighbours full-size in a 1×1px hidden container; Lighthouse counts those ~100% wasted (2 × ~113KiB webp on dedima's 882KB source ≈ the report). Reproduced locally on a dedima-shaped fixture — the flagged URLs were exactly `active±1`. Now warms **forward only** (the dominant first gesture; a backward first-swipe pays one on-demand fetch, once), and both warmers (gallery neighbour + description eager-flip) sit behind `useWarmupAllowed()`, which honours the visitor's `Save-Data` — the speculative bet is declinable. Local Lighthouse: the finding halves (one deliberate forward warm remains, documented). **DEPLOYED 16 Aug (afternoon), `831c48d..d915c77`. No migration.** storefront 76, builder-sections 74 |
| **LB.51** | **The TTFB census — 34 statements per product-page render, cut to 10.** LB.14a.2's measurement, done locally (this session's environment could not reach production or Neon): the production build against local Postgres with `log_statement=all` showed `load()` running TWICE (metadata + page), a third transaction for StoreSettings in the layout, a fourth for tracking serialized after the page — 4 pinned connections, ~18 serial round trips. Fixed in two revertable commits: React `cache()` + shared StoreSettings reader + tracking folded into the page's transaction (34→17, connections 4→2), then Prisma **relationJoins** on the one page query — seven relations in ONE statement (17→**10**, serial path ~**6**). Per-request dedup only; LB.14a's cross-request rule untouched; the front-door split (LB.14a.2 proper) stays scoped. Production impact = ~12 round trips × Render↔Neon RTT + halved pool churn; **the live before/after and the three hosting questions (Render spin-down, Neon autosuspend, region) are the user's — NEXT_STEPS §LB.51**. Found on the way: two platform/domains tests still pinned pre-LB.45 root shapes (suite wasn't in LB.45's re-run list) — re-pinned to the live-verified behaviour, 14/14. **DEPLOYED 16 Aug (afternoon), `831c48d..d915c77`. No migration** (generator preview flag only — re-verified as the range's ONLY schema diff before the push). Suites all green: storefront 76 · builder-sections 74 · tracking 15 · builder-api 42 · console-shell 20 · hardening 13 · platform/domains 14 · platform/team 63 · packages/db 35 |
| **LB.50** | **CSS ships inside the document — `experimental.inlineCss`, measured then adopted.** LB.47's flagged candidate got its dedicated pass on the framer-free build: stylesheet links 2→0, Lighthouse **81→88, LCP 3.7s→2.0s**, SI 3.9→3.1s — the hero stops waiting on two render-blocking CSS round-trips. Honest costs measured: the document grows ~28→106KB gz per view (no cross-view CSS caching; FCP +0.3s, TBT +80ms). Adopted because the funnel is ad-driven and first-view LCP is the converting metric; revert = one config block, and a future flag regression shows up as loudly unstyled pages. Scoped follow-up: the 144KB CSS bundle carries ALL surfaces — console styles ride into storefront documents; splitting is the next CSS win. **No migration.** storefront 76, console-shell 20 |
| **LB.49** | **The storefront drops framer-motion, because it kept taking content hostage.** The JS-diet measurement: 15 chunks / 378.6KB gz on the live product page, the biggest carrying the full framer import for four below-fold interactions. LazyMotion tried in both documented forms — async features wedged AnimatePresence (hero stuck on the old image, FAQ exit holding a closed answer visible, reviews at opacity 0, sticky absent), static features left `m` still inert here. Unattended-default chosen: **no animation runtime at all** — CSS on keyed/conditional mounts (`.landing-fade`, `.landing-slide-up`), reviews render plainly, gallery swaps INSTANTLY. **−45.4KB gz (−12%)** critical path, page chunk 140.6→95.2KB gz; local Lighthouse 75→**81**, TBT 500→**320ms**. All four interactions re-verified in the browser; editor keeps its own framer. **No migration.** storefront 76, builder-sections 74 |
| **LB.48** | **The images a customer is about to ask for are already there.** Real-phone report, measured live: only the ACTIVE gallery image mounts full-size (the swipe's w=1080 request fired only AFTER the arrow press — the lag); the description image waits for scroll proximity (native lazy). Fix: warm AFTER `load` (use-after-load.ts) — the gallery mounts `active±1` neighbours hidden with the hero's own `sizes`, the first description image flips lazy→eager; nothing ever competes with the hero (LB.44's lesson by construction). Verified: neighbour fetched with zero interaction; below-fold description `complete` at scrollY 0. **Found on the way:** the brand link rendered `/__domain__` on custom domains (built from the raw param, seen in the accessibility tree) — through `storefrontHref` now, pinned by test. **No migration.** storefront 76 |
| **LB.47** | **Metadata URLs become absolute — and the missing social-share image is found.** A PSI report on the real `selliora1.com/dedima` (66/LCP 6.5s, relative canonical, no meta description) unpacked into one bug, one report, one data gap. **The bug:** no `metadataBase` anywhere, so Next absolutised relative metadata against `http://localhost:${PORT}` — production served `og:image` as `localhost:10000/uploads/...` since LB.37: every social-share preview imageless, and the canonical a relative path PSI flags invalid. Fixed at the storefront layout with `currentOrigin()` (the one vetted Host reader). **The report:** same page, controlled method — dedima 69/3.0s, robe 69/3.6s, pages equivalent, LB.44 intact, TTFB identical across hosts (LB.45's rewrite costs nothing); PSI's number is its harsher harness + a cold single run. Real residuals are the JS-diet backlog (unused JS 179KiB, TBT 0.8–1.4s) and `force-dynamic` TTFB (LB.14a.2); cache lifetimes measured already-max; image delivery ~20KiB noise. **The data gap:** the description chain (seo → page → store) is complete and all three fields are null on dedima — merchant data, nothing to build. **No migration.** storefront 75 |
| **LB.46** | **The console's View and Copy Link speak the tenant's own domain.** The handoff's own prediction closed: `TenantDomain.isPrimary` was "a writer with no functional reader", deferred while no hostname could serve — LB.45 expired that premise. Both links came from a hard-built `publicPath` prop (`/${tenantSlug}/${slug}`) in the editor page and the pages list, plus `window.location.origin` in the copy handler. Fix: `lib/console/public-page-url.ts` — the tenant→origin READ direction of the domain story: verified AND primary → `https://<domain>/<slug>` (LB.45's bare shape), else the platform path (the common case — most tenants have no domain). One bound query per screen; verified-without-primary deliberately changes nothing. **Measurement the first test version missed:** the View door only exists on PUBLISHED rows — the suite's shared fixtures are drafts, so the test asserted an anchor no draft ever renders; the pipeline itself worked first try with published fixtures. **No migration.** builder-api 42, builder-sections 74, console-shell 20 |
| **LB.45** | **A custom domain's paths are the shop's own.** Found the day the FIRST real domain went live (`selliora1.com`): `/robe` rendered the store home with a self-linking card, `/category/watches` 404'd, and the root 307'd to `/bebezzouar` — the platform's internal shape on the merchant's hostname. One cause: `storefrontHref` has emitted the bare custom-domain shape since LB.31, and **no route ever served it** — unreachable before a hostname actually passed Render's edge (LB.14c's gap). Fix: a host-conditioned rewrite pair in `next.config.ts` re-inserts a sentinel tenant segment (`/robe` → `/__domain__/robe`) whose value is never read (every surface resolves domain-first; on a platform host the sentinel 404s). Keys on the REAL Host only — a forged `X-Forwarded-Host` can't re-shape a platform request (pinned). Trap kept for the record: afterFiles rules run on REWRITTEN paths too, so the sentinel had to be excluded from its own rule or the root became `/__domain__/__domain__`. Sitemap `<loc>`s and robots' Sitemap line now speak the same bare shape via `storefrontHref`; the prefixed URLs still serve (canonicals point bare). Eight new raw-Host tests. **No migration.** storefront 74, console-shell 20, hardening 13, tracking 15, builder-sections 74 |
| **LB.44** | **The storefront paints before it hydrates — the LCP fix.** PageSpeed on a real published page: Performance 75, LCP **5.0s** with FCP 1.3s. The audit's suspects (no hero priority, no srcset) both measured **already fixed** — the hero was preloaded with a nine-width srcset and the served webp weighed 19KB. Lighthouse named the real mechanism: the hero image downloaded early and then sat **unpainted for 2.5s (43% of LCP)**, because `ThemeProvider` wrapped the ENTIRE page in a framer-motion fade whose `initial={{opacity:0}}` server-renders as inline `opacity:0` — the whole storefront invisible until 1.3MB of JS hydrated on a throttled phone. Same pattern on the product-info column. Fixes, all template-level: the page wrapper is a plain div (nothing between server HTML and first paint may depend on JS); the info column enters via a CSS animation that starts at paint (`landing-fade-up`, reduced-motion-guarded); the hero gets `fetchPriority="high"` (priority alone preloads but shares bandwidth); description images are ALL lazy — the first was `eager` **and preloaded**, competing with the hero for a phone's bandwidth. Real-browser LCP on the rebuilt page: **LCP = FCP = 1.3s** (was: paint held hostage to hydration). Reviews keep their scroll-triggered reveal on purpose — below the fold, not the LCP. **The production before/after PSI run awaits the deploy.** TTFB ~850ms (Render + `force-dynamic`) and the 1.3MB bundle remain the open perf items — LB.14a.2 and the JS diet. **No migration.** storefront 66, builder-sections 74, tracking 15 |
| **LB.43** | **Server-side conversion events carry the page URL.** Found while closing LB.11: Purchase and Lead dispatched with `action_source: "website"` and no `event_source_url` — the two call sites never set `context.url`, while all three provider adapters were already built to forward it. Meta accepted the events anyway (LB.11 proved delivery), so this is data-quality completion, not a delivery fix. The URL is REBUILT server-side — `currentOrigin()` (the one header-trust rule) + `storefrontHref(tenant, page.slug)` — never read from the body, which would be a second spoofable input. Pinned by four new e2e assertions through the running build: the same URL arrived in Meta's `event_source_url`, TikTok's `page.url` and GA4's `page_location`, on Purchase and Lead both. **No migration.** tracking 15, storefront 66, webhooks 10, builder-api 41 |
| **LB.42** | **The write-panels stop speaking English, and the guard stops missing them.** Asked for as "the six write-panel strings"; there were **37**, and finding that out is most of the slice. Six was a rough-grep number — pointing LB.13's guard at `components/console/platform` found 22 at once (ternaries and `pendingLabel` the grep never looked at). Panels now take words as a **prop**, the console's stated convention for client write controls. **The guard had two holes, both found by reading the rendered page after it reported clean:** it scanned LINE BY LINE, so text on the line *after* its `>` was invisible — 14 more strings, plus a third screen nobody had counted (`settings/delivery-prices`); and the new whole-file pass still missed one, because the code-shape filter rejects semicolons and **`&apos;` ends in one**. Entities are decoded before that test now. Six ternaries elsewhere (`"danger"`/`"ghost"`, `"suspend"`/`"reactivate"`) are **not** translated — machinery, not prose; the ternary branch now skips lowercase single words as jsx-text already did. **Left English deliberately:** `Pixel ID` and `Conversions API access token` in `lib/tracking/config.ts` — Meta's own dashboard terms. **No migration.** i18n 22 |
| **LB.41** | **DEPLOYED 14 Aug.** **The store settings screen answered in a fourth language.** Investigated as a production error on `/console/settings/store` (digest `2216248186`) — **it does not reproduce**: against a fixture shaped exactly like the real tenants (no `StoreSettings` row, OWNER, TRIALING, `ar`), production returns 200, a text save persists, and an image upload reaches R2 and serves back. Every path on that screen is healthy; the strongest remaining candidate is a Neon `P1001` transient, unverifiable without Render logs. **What WAS found is real and on that screen:** it was the only console screen still rendering user-facing English — 12 field labels, both errors, the saved banner, Remove and Save — so an Arabic account met a translated frame around an English RTL form. It escaped LB.13's guard, which covers only the EDITOR dirs. Guard extended to `app/console/settings`, which immediately found 13 more on `settings/integrations`; **both screens fixed** rather than narrowing the guard. **No migration.** i18n 22, builder-sections 74 |
| **LB.40** | **DEPLOYED 14 Aug.** **`robots.txt` stops saying `Allow: /` to everyone.** A REPLACEMENT, not the addition it was asked for: `public/robots.txt` already existed and had been serving in production — five blocks (Googlebot, Bingbot, Twitterbot, facebookexternalhit, `*`), every one `Allow: /`, so crawlers were invited into `/console` and `/api`. Not a live incident (robots governs CRAWLING, LB.37's meta governs INDEXING, so the console was fetched and correctly not indexed) but it spent budget on auth-gated redirects and on `/api`, where checkout keeps a per-IP rate limit. Now a route, because a static file cannot vary by host: the **platform host names NO sitemap** (the only one it could name lists every tenant — LB.39's roster objection), a **verified custom domain names that one shop's**. **The static file WON while both existed** — measured, the route was completely inert until it was deleted. `Disallow` and `noindex` kept together: neither replaces the other. **No migration.** storefront 60→66 |
| **LB.35b** | **DEPLOYED 13 Aug (late night).** **The per-page pixel choice gets somewhere to be made.** LB.35 shipped the column, the PATCH, the storefront read path and eleven tests to production and built **no UI** — `trackingIntegrationIds` appeared in no component. Worse than absent: the editor's Integrations section rendered a signpost saying tracking "applies to every page automatically", true when LB.5 wrote it and made false by LB.35, so the section named after the feature told merchants it did not exist there. Now a **mode switch**, not a checkbox list, because the column has THREE states and ticks express two: `null` = every active integration (default), `[ids]` = subset, `[]` = none, honoured rather than falling back. Choosing "choose" starts from every ACTIVE integration, since starting empty would read as "turn everything off" at the moment someone asks to be specific. Inactive integrations are listed and marked, not hidden — hiding them would drop a page's link on the next save. **No migration.** builder-api 37→41 |
| **LB.39** | **DEPLOYED 13 Aug (late night).** **Each shop gets its own sitemap, listing exactly what LB.37 allows to be indexed.** `/{tenant}/sitemap.xml` — store home, visible categories, published pages; thank-you, drafts, archived pages and the console excluded, each by the SAME predicate the page itself uses, so a URL that 404s cannot be advertised. **A route handler, not `sitemap.ts`, and that was measured:** Next's metadata convention passes no route params — at `[tenant]/sitemap.ts` the function is called with `undefined` and 500s — and the documented alternative, `generateSitemaps`, enumerates ids up front, which here means publishing the tenant roster. Under `[tenant]` rather than the root for the same reason: a platform-host `/sitemap.xml` could only be every shop in one file or nothing. New `currentOrigin()` in `resolve-tenant.ts` reuses the vetted `currentHost()` so the header-trust rule stays stated once. `lastModified` is real (`updatedAt`; the home borrows the newest thing it links to). **No migration.** storefront 54→60 |
| **LB.38** | **DEPLOYED 13 Aug (late night).** **The hard delete finally gets a door.** LB.34 hardened the `DELETE` route (409 `HAS_ORDERS` for a page that sold anything, real removal otherwise) and left it wired to nothing — `method: "DELETE"` appeared in no component, so a mistyped draft could only ever be archived and an archive meant for retired products filled with pages that were never anything. A Delete row-action now sits beside Archive, **offered only at zero orders**: the route is the authority and refuses regardless, but a button that always answers 409 teaches a merchant the console is unreliable, so a page with orders simply sees Archive. Order count came free — the list already selects `_count.salesOrders` for its Orders column. `HAS_ORDERS` was also unmapped in `action-errors.ts` (the LB.14c/UNKNOWN_ADAPTER pattern a third time), so the one refusal protecting a merchant's revenue history read "that didn't work"; it names Archive now, ×3 locales. Shown for ARCHIVED rows too when order-free, since clearing that archive is the point. **No migration.** builder-api 35→37, the new pair asserting the DOOR rather than the route |
| **LB.37** | **A storefront's `<head>` stopped introducing it as the platform.** LB.31 closed the body and left the head: a shop served `<title>… · LandingOS</title>`, the platform's internal tagline as its description, and `noindex, nofollow` on the store home and every category — all inherited from the root layout's "internal admin tool, never indexed". The root STAYS `noindex` (fail-closed, and the console has no declaration of its own); the storefront opts in at its own layout, so a future route under it is public by construction and one anywhere else is not. `absolute`, not `default` — a default is still templated by its parent, which put "· LandingOS" back in the tab on the first attempt. **The thank-you page opts back out explicitly**: it carries a name, a wilaya and a total, and an unguessable id is not what keeps a linked URL out of an index. Product canonical moved onto `storefrontHref`. **No migration.** storefront 48→54 |
| **LB.34** | A landing page can be ARCHIVED, and the pre-existing hard delete stops being able to shred a sales history. Two surprises in measurement: a `DELETE` route already existed (live, callable, never wired to a button), and it cascades — `SalesOrder` from the page, status history from the order, `DraftOrder` from the page, `FulfillmentOrder` SetNull — so deleting a page that sold anything destroys its whole commercial record, and LB.30's thank-you additionally reads `order.landingPage`. Archive is the delete: `status: ARCHIVED` **plus** `published: false` (the storefront filters on both), restore lands on DRAFT so it never republishes by itself. **No migration** — `LandingPageStatus.ARCHIVED` existed with no writer since the port. The hard delete is kept for pages that never sold and returns `409 HAS_ORDERS` otherwise. Console: archived rows leave the list behind an "Archived (n)" door, Archive↔Restore in place. builder-api 23→29 |
| **LB.33** | The "name field is invalid before you touch it" report, measured FALSE — and the real defect beside it. A fresh form's input is `aria-invalid="false"` with a neutral border, matches neither `:invalid` nor `:user-invalid`, has no `required`, and the form is `noValidate`; the compiled variant is `[aria-invalid=true]` (read from the served stylesheet), which `"false"` cannot match. The red state is genuine but arrives only after a submit attempt. What WAS broken: `Field` derived `htmlFor` from the label TEXT, so `الاسم الكامل` → `الاسمالكامل` against an input id of `fullName` — **no field in the checkout form had a working label** (`labels.length === 0`), on the one form that takes money. `htmlFor` is explicit now; the destination selects gained ids. storefront 38→40 |
| **LB.32** | The editor's sticky header stops covering content. `sticky top-16` compensated for a console shell header that is NOT above this screen — the editor is deliberately mounted outside `ConsoleShell` (the `(shell)` route group), so the header is the page's first child with a natural flow position of 0. Sticky reserves no space for its offset, so content flowed from 56 while the header painted 64→120: a permanent 64px overlap band at every scroll position, plus dead space above it. `scroll-mt-24` on the section cards corroborated the diagnosis before the change (96px clears a 56px header, lands 24px under a 120px one). Fixed to `top-0`, the only `sticky top-16` in the source. Verified live: band [0,56], anchored scroll clearance −24px → **+40px** |
| **LB.31** | A storefront never wears the PLATFORM's identity. Two paths to one leak: the nav/footer fell back to the platform `<Logo />` (linking to `/`, which 307s to the console) plus the platform's internal description and copyright whenever `store` was null — and the storefront built it as `store ? {…} : null`; and `StoreSettings.storeName` is NOT NULL defaulting to `"LandingOS"`, so `storeName ?? tenant.name` could never fire. Measured read-only against `landingos_prod`: **both production tenants have a null settings row**, one already holding an unpublished page — zero published pages, so unseen, but one publish away. `resolveStoreName` treats absent-row and untouched-default alike and answers with the tenant's name; the platform fallbacks are deleted; the preview drawer (which passed no store at all) now renders the merchant's name as a non-clickable span. A test asserting the defect ("keeps the platform fallback") is replaced. storefront 36→38 |

**LB.27, LB.28 and LB.29 are DEPLOYED** — `e3939e9..08e386d` pushed 13 Aug
2026 with the user's approval, no migration, verified live by authed content
markers plus a full throwaway-tenant journey (`HANDOFF_PRODUCTION.md` §1).
**LB.30 is DEPLOYED too** (the same night, user-approved): `e940f06` rebased
onto the deploy-record commit as `4f1b599` — docs-only conflicts, code clean
— pushed and confirmed by a PUBLIC content marker (the theme scope appearing
on a real tenant's store home), then verified with a throwaway tenant and
two real API orders: themed thank-you inherits the merchant theme, home and
category hold the default, unthemed falls back; swept with `deleteTenant`.

> ### 13 Aug 2026 (night): LB.35's MIGRATION IS APPLIED. The CODE is still local.
>
> **The database moved and the code did not, on purpose.** The user approved
> LB.35's migration as an action on its own:
> `ALTER TABLE "LandingPage" ADD COLUMN "trackingIntegrationIds" JSONB;` is now
> in `landingos_prod` — diff previewed first (exactly that one statement, no
> other drift), datasource read back out of the push's own output, column
> confirmed `jsonb`/nullable with the one existing row NULL, a second diff
> returning empty, and **RLS unchanged at 49** because no table was added.
>
> **✔ AND THEN THE CODE FOLLOWED, the same night.** `origin/main` is now
> `d6a56b1`: the range shipped as `bd6d664..d6a56b1` — **eighteen** commits
> (LB.31–LB.36 and its merge record, then **LB.15** money inputs, **LB.14a**
> storefront caching, **LB.14b** the duplicate-completeness fix, **LB.14c**
> the domain-refusal messages, the dev-tenant sweep, and the records for all
> of it, plus two later doc commits). Rollback point `bd6d664`.
>
> **NO MIGRATION REMAINED, and the check that proved it was drift, not file
> paths.** The earlier claim here — "nothing in `790e4ae..ca1e9b3` touches
> `packages/db/prisma`" — was true of that sub-range but false of the full
> range, which carries LB.35's schema edit. What settled it was
> `prisma migrate diff --from-url <prod>` answering **"This is an empty
> migration."** RLS stayed 49/49. **Use the diff, not `git diff --name-only`.**
>
> *(the paragraph below was the state before that migration ran, kept for the
> record)*
>
> ### *(historical)* LB.31–LB.36 are MERGED INTO LOCAL `master`, and NOT DEPLOYED
>
> **Superseded — this range deployed the same night as `bd6d664..d6a56b1`;
> see above.** Kept for the record of how the merge itself was done.
>
> `bd6d664..fecc4ff`, merged 13 Aug 2026 as a **clean fast-forward** — master
> was an ancestor of the branch (it had been synced onto master's tip at the
> end of the LB.30 deploy), so there was nothing to rebase and the merged tree
> hash is **identical** to the branch tip that was tested and verified live.
> Not one byte of application code changed in the merge.
>
> *(as written at the time)* **`origin/main` is still at `bd6d664`. Nothing is
> pushed and nothing is deployed.** Production continues to run the LB.30 app
> tree (`4f1b599`). — **No longer true: shipped 13 Aug, late night.**
>
> **THE BLOCKER IS LB.35's MIGRATION.** It adds
> `LandingPage.trackingIntegrationIds JSONB` and that column exists only in
> `neondb`. Until it is applied to `landingos_prod` — user-approved, in the
> LB.20 order, before the app push — this range cannot ship: the storefront
> and the general PATCH both read the column, so deploying the code first
> would break every landing page render. No `apply-rls` re-run is needed (no
> new table; still 49/49). Full runbook: `HANDOFF_PRODUCTION.md` §1.
>
> The other five carry no schema change. LB.34 notably needed none — it
> writes the `LandingPageStatus.ARCHIVED` value that has existed since the
> port with no writer.

**Suite totals after LB.15 / LB.14a / LB.14b / LB.14c** — every one re-run per
file against the final build on 13 Aug 2026 (night), all green:

builder-sections **74** · storefront **48** · builder-api **35** ·
hardening **13** · calc **28** · console-shell **20** · tracking **15** ·
webhooks **10** · platform/domains **14** · platform/team **63** ·
platform/workspace **4** · platform/sessions **2** · i18n **22** ·
packages/db **35**.

What moved this session: calc 20 → **28** (LB.15's money reader, in the one
pure suite), storefront 40 → **48** (LB.14a's cache policy, asserted on the
served header), builder-sections 73 → **74** (no money box in the editor is a
number input), hardening 12 → **13** (a duplicate carries the parts the page
grew after LB.6), platform/domains 13 → **14** (every refusal the domains
screen can produce has a message in the reader's language).

*(unchanged, not re-run this session)* erp/screens **172** ·
erp/finance **44** · erp/catalog **75** · erp/access **205** · erp/ai **31** ·
product-registry **36**. *(historical, after LB.30)* storefront 36 ·
builder-api 23 · calc 20 · hardening 12.

**Two red runs, both re-verified green, both the documented Neon transient** —
recorded because the rule is to rerun a red once before believing it:
`packages/db` failed 2/35 in a back-to-back run and passes 35/35 alone;
`platform/team` failed 1/63 and passes 63/63 alone. One earlier red was NOT
transient and is worth knowing: builder-sections failed a published-page
render with `PrismaClientValidationError: Unknown field
trackingIntegrationIds`, because **`builder:build` regenerates the app's
Prisma client and not `packages/db/prisma/client`.** After any schema change,
run `npm run generate --workspace @landingos/db` as well.

**The rule this pass adds to the method:** *a feature that reads a number and a
feature that charges it must call the same function.* LB.20's quote and charge
paths each built their own query under a comment promising they could not
disagree — a copy is a promise nobody enforces, and no suite over either route
alone would have caught the divergence. The same shape appeared twice more in
one session (LB.19's product `where`, and LB.13's registry/section titles), which
is why it is written down as a rule rather than three fixes.

---

## PHASE PM — PRODUCT MATURITY: COMPLETE

Phase UI was **presentation only by declaration** and said so in every entry.
This phase is the other half: it is allowed to change what a screen SHOWS, and
does. What it does not change is the domain — no calculation moved, no
permission widened, no tenant scoping touched, and every D-06 rule still holds.

**The finding it was built from, in one sentence.** The console had reached
parity and a coherent visual language and was still built to be READ rather than
to be WORKED.

| Slice | What it closed |
|---|---|
| **PM.1** the operational dashboard | The front door was six LIFETIME counts with no period, no comparison and no trend — it answered "how many confirmed orders exist" and never "is today going better or worse than yesterday" |
| **PM.2** the photograph that had no reader | `CatalogProduct.image` and every variant's `image` — columns since M-06, writable since Phase 5, **rendered by nothing anywhere**, and with no way to upload a file at all |
| **PM.3** variants, and one-pass creation | A 45-row flat matrix with no grouping; a product with fifteen variants took three passes through two panels that did not know about each other |
| **PM.4** notifications that open the record | `entity`/`entityId` written, stored, streamed — and read only to flash a row you were already looking at |
| **PM.5** one stock vocabulary | `stock <= threshold` was one bit for "restock next week" and "cannot ship this order", and a product with no threshold could sit at zero unlisted |
| **PM.6** secondary text vs. a dead control | `opacity: 0.5` put a disabled label exactly where `--muted-foreground` lives |
| **PM.7** the question the product is opened with | "A customer is on the phone and gives me a number" cost four navigations |

### The three findings that were capabilities, not styling — for the tenth time

1. **`CatalogProduct.image` and `variants[].image`.** Accepted by two routes,
   returned by `PRODUCT_SELECT`, rendered by no screen, and with no control that
   could produce one. The legacy shows a photograph on the product grid, the
   stock screen, the variant editor and every order row.
2. **`Notification.entity` / `entityId`.** Written by six ERP notifiers, carried
   on every SSE frame, and consumed only by `flashEntity` — which does nothing
   unless the row happens to be on the screen you are already reading.
3. **`/api/uploads/[...path]` refused the keys `/api/builder/upload` writes.**
   Not an ERP gap: a shipped, live defect in the PLATFORM. The writer moved to
   `tenants/<id>/<file>` at the platform port and the reader kept refusing
   anything that was not one segment, so every console-uploaded image 404s
   unless the deployment has a PUBLIC R2 bucket. Four audits walked past it
   because the writer, the storage and the URL are all correct and only the
   reader disagrees.

### D-PM.1.3 — on a pinned transaction, the query count IS the latency

`withTenant` opens an interactive transaction, so `Promise.all` around nine
Prisma calls does not parallelise them — it queues them on one connection. The
first build of the dashboard issued ~35 round trips and measured **3.2–4.8 s**
on the screen a manager opens first. `groupBy` consolidation (one pass by
`status` answers four of the old counts, one by `deliveryOutcome` answers three,
`[dimension, status]` replaces two passes per breakdown) brought it to **~2.0 s**
— level with the order list and under the untouched analytics screen, against a
0.86 s floor for a near-queryless page on this connection.

**What was not done for that speed:** the record scope was not hand-written into
SQL. `orderScope` is a Prisma `where`, and a second copy of "which orders may
this person see" expressed as a string is the one place being wrong leaks a
colleague's queue.

### D-PM.7.1 — the shell must never learn what a product SEARCHES either

`ProductManifest.search` declares the path, the query parameter and the
placeholder. A header hard-coding `/console/erp/orders?search=` would be the
shell knowing what an ERP is — D-UI.1's argument, one field further on. The
parameter is `search`, the one `orderFilters` already validates, so the box and
the list cannot disagree about what was asked.

### D-PM.A — a control's gate and its DESTINATION's gate are two questions

Phase PM's own review caught it in Phase PM's own code. Three alert cards on the
new dashboard counted correctly and linked into a 404: the two integration cards
were gated on `erp:settings:read` — **a permission that is not in the ERP's
manifest at all**, so `can()` answered it by role glob — while pointing at
screens that check `erp:shipments:write` and `erp:settings:write`; and the stock
cards were ungated while pointing at a screen whose nav gate is
`erp:inventory:write`.

D-06.2 says render a control only where the API would ACCEPT it, and every route
here was gated correctly. What was wrong is a question D-06.2 does not ask: **is
the person allowed to reach where this control SENDS them?** It is only visible
by reading the manifest's nav permissions beside the screen's own, which no
route-shaped review does. Every flag on `AlertInput` now names the permission its
destination checks, and a stock alert for somebody who cannot open the stockroom
points at the products list instead.

### The rule Phase PM adds to the method

**A column with a writer and no reader is not "done"; it is a feature nobody can
use.** This project has caught that shape nine times by asking *which columns
does something write that nothing reads*. `packages/db/test/orphans.test.ts`
made the cheap half mechanical — but it is a NAME check, so a column that is
written, selected, returned by an API and rendered by no screen passes it
cleanly. All three findings above are that residue. **The question the schema
scan cannot ask is: for every column an API returns, which SCREEN renders it?**
Recorded as PM.12 in `NEXT_STEPS.md`.

### Verification (Phase PM)

Per suite, live, against the running server.

| Suite | Result |
|---|---|
| `packages/ui` | **42/42** (was 26 — the oklch ground is measurable now) |
| `packages/i18n` | 20/20 |
| `packages/product-registry` | 36/36 |
| ERP `catalog` | **72/72** (was 66 — the photograph round trip) |
| ERP `screens` | 173/173 |
| ERP `notifications` + `access` | 252/252 |
| `console-shell` + ERP `analytics` + `listing` | 62/62 |
| ERP `orders` + `registry` + `export` + `calc` | 132/132 per suite |
| ERP `integrations` | 80/80 |

**Two red runs, both environmental, both re-verified green — recorded because a
green table with no explanation of what went red is worth less than one that
says.**

`registry.test.ts` failed 2/23 in a four-suite back-to-back run and passes 23/23
on its own — the documented Neon capacity limit, and the reason this table is
per suite. The failing run's two tests completed in 623 ms against 8,195 ms
alone, which is a connection failure's signature rather than an assertion's.

`integrations.test.ts` failed 3/80, all three rendering assertions on the
follow-up screen, **because `npm run builder:build` was run while the suite was
in flight and replaced `.next` under the serving process.** Re-run against a
stable build: 3/3. It is rule 5 of *Read this first* biting from the other
direction — that rule warns about verifying a change against a stale server, and
this is the mirror image, a stable test against a server whose build moved. **A
build is a write to the thing under test.**

**The role walkthrough is mechanical, not anecdotal.** 21 screens × 4 demo roles
= 84 pairs driven over HTTP: every 200 renders inside the console shell, no
screen leaks a raw i18n key as text, and the only 404s are the 18
permission-shaped ones. Measured in the running page at 375 px and at desktop:
no horizontal overflow on the dashboard or the products grid, the create panel's
fields present in the DOM while hidden (D-06.4), and the expandable row
`display: none` → `table-row` on the checkbox alone.

---

## PHASE UI — UI/UX MODERNISATION: COMPLETE

Legacy parity is reached and four engineering audits are closed. **Phase UI is a
presentation phase and nothing else**: no business logic, no calculation, no API
behaviour, no permission and no tenant-scoping change. Every control that
rendered before renders now, decided by the same predicate; D-06.1 through
D-06.4 are all intact.

**`UI_UX_AUDIT.md` is the measurement it was planned from** — 87 findings across
the shell, the tokens, the tables, the forms, feedback, accessibility and 39
screens, taken *before* anything moved, with the file each lives in. §10 states
what the work may not touch. §12 is the scoreboard afterwards, including the two
defects the work itself introduced and what was deliberately left open.

| Slice | What it closed |
|---|---|
| **UI.1** the audit and the design system | No navigation below 768px · the dark theme could not be turned on · nav icons computed and discarded · eight of the nine design-system axes absent · **no `:focus-visible` rule anywhere** |
| **UI.2** the enterprise table | **`?sort=` had no control anywhere** · no sticky header, hover, selected state, select-all, density or scroll affordance · one empty message for two different empties |
| **UI.3** the screens and the feedback states | 35 bespoke page headers · **no error boundary and no not-found page in the whole application** · nothing between a click and a page · user-facing English on six screens including login |
| **UI.4** the forms | Eleven fields sharing one refusal · no required marks · **success was silent** · ten panels each owning their own outer margin |
| **UI.5** the final audit | Two defects the passes introduced, both found in the running page |

### The three findings that were capabilities, not styling

Each is the shape this project has now caught seven times — computed, stored,
validated, and reachable by nothing.

1. **`orderSort` has read `?sort=`/`?dir=` since Phase 5 and no control anywhere
   set either.** An operator could not sort the order book by value, by date or
   by customer. `ORDER_SORT_FIELDS` now lives in `lib/erp/sort-fields.ts` —
   directive-free, because `lib/erp/orders.ts` is `server-only` and no contract
   test can import it — and the whitelist is `Record<OrderSortField, …>`, so a
   key with no column fails to compile. Four tests assert it **both ways**,
   D-LP.3's rule for filters applied to ordering.
2. **`ProductNavItem.icon` has carried a lucide name since the contract was
   written**, its comment says "resolved by the shell's icon registry", the shell
   computed it and `ConsoleNav` dropped it. Fifteen ERP items were fifteen
   identical lines of text.
3. **`components/shared/theme-toggle.tsx` was complete and imported by nothing**,
   so the dark palette — which `tokens.css` documents as the ERP's own, promoted,
   and as the resolution of R-14 — appeared only if the operating system asked
   for it.

### D-UI.1 — the shell must never learn what a product contains

`ProductNavItem.group` is optional, an i18n key, and declared by the PRODUCT. A
flat list of fifteen is not navigable and the grouping had to come from
somewhere; putting it in the shell would be the shell knowing that "orders,
queue and follow-up are one job", which is the single thing the registry exists
to prevent, and a `switch` on `product.id` is exactly the shape the registry
replaced. A manifest declaring no groups renders the flat list it rendered
before.

### D-UI.2 — density follows the device, the notification sound follows the person

D-LP.11.1 put the notify preferences on `ProductSetting` rather than
`localStorage`, for two stated reasons: a mute must follow the person between
machines, and a supervisor must be able to see whether an agent silenced the
alarm that watches them. **Neither is true of row height.** The right density on
a 4K desk monitor is the wrong one on a 13″ laptop, nobody audits it, and
storing it would add a bound read to every console render. It is a `data-`
attribute on `<html>`, set before first paint by a four-line script — reading it
in an effect means every navigation paints comfortable and then jumps, for
exactly the people who chose compact because they scan fast.

### D-UI.3 — no `loading.tsx`, and the reason is structural

`ConsoleShell` is rendered by each PAGE rather than by `console/layout.tsx`
(every screen resolves its own session and passes its own `productId`), so a
route-level Suspense fallback replaces the whole frame and the sidebar blinks
out on every navigation. A pending state that removes the navigation you are
navigating with is worse than none. `useLinkStatus` answers the narrower and
more useful question — is THIS the link you are waiting for — and the spinner
lands on the item that was clicked. **Moving the shell into the layout is the
right next slice for this** and is recorded in `UI_UX_AUDIT.md` §12.

### The rule Phase UI adds to the method

**A Tailwind arbitrary value containing an operator must be verified in the
running page.** `md:max-h-[calc(100dvh-var(--console-header-h)-13rem)]` compiles,
appears in the class list, survives every contract test that asserts on HTML —
and emits no CSS, because Tailwind reads a space as the end of a class and CSS
requires whitespace around `-` in `calc()`. The sticky header therefore silently
did not work with the class sitting right there in the markup. It was found by
measuring the live document, along with a 16px horizontal overflow at 375px on
the width the whole drawer work exists for. That is AUDIT.3's argument again:
the contract suite was green and the running page was wrong.

---

## ⚠️ CURRENT PHASE: LEGACY PARITY RESTORATION — NOT Phase 8

Phase 7 is complete, but **Phase 8 is deferred.** A full feature-by-feature
comparison of `apps/erp` (the legacy CRM) against the platform ERP was carried
out on 6 August 2026 and is in **`LEGACY_PARITY.md`**. Read it before doing
anything else.

**Second pass, 6 August 2026 (from `9d1f887`): 115 features compared —
52 identical · 6 improved · 18 partial · 39 missing.**

**As of 7 August 2026, TIERS 1, 2 AND 3 ARE ALL COMPLETE — twenty-one of the
twenty-seven roadmap slices have landed, and PARITY IS REACHED.** The six that
remain are Tier 4 (23–27), which `LEGACY_PARITY.md` §4 states is Phase 8 work the
legacy happened to also have, a decision to revisit, preference, or a deployment
choice — not parity.
Every production blocker §0b named is closed, as is every "computed, stored and
shown nowhere" defect the three passes found.

**TIER 2 IS COMPLETE** — 7, 8, 9, 10, 11 and 12 are all in.
**TIER 3 IS COMPLETE — 13–22 are all in.** Parity is reached at the end of Tier 3, so **one roadmap slice
remain** — the full list is in `LEGACY_PARITY.md` §4 and every one still carries
its own detail card in §3.

**The first pass measured APIs, not workflows, and five verdicts did not
survive.** A feature was marked ✅ when the endpoint existed and had contract
tests; several of those endpoints have **no caller anywhere in the console** —
the same defect the first pass caught in `IntegrationLog` and then failed to look
for anywhere else.

| Corrected | Why |
|---|---|
| notifications (L1, L2) 🔵 → **🔴** | M-16's whole transport — storage, audience, SSE with exact replay, Web Push, service worker, **33 tests** — has **no consumer in the console**. No bell, no badge, no toast. A signed-in operator is never told anything. |
| Web Push (L3) ✅ → **🟡** | Sends, but there is no in-app surface at all, so push is the only possible channel — and VAPID is unset by default. |
| create an order (B3) ✅ → **🔴** | `POST /api/erp/orders` is tested and has **no console control**. A phone order cannot be entered. |
| list + filter (B1) ✅ → **🟡** | `orderFilters` supports nine filters, richer than the legacy's four, and the orders screen renders **no filter form**. |

**And the finding that changes the verdict: there is no pagination anywhere in
the console.** Every ERP screen is a hard-capped first-N read — orders 50,
clients 50, products 100, shipments 100, follow-up 100 — with no next, no page
number and no total. The legacy downloaded the whole book and filtered in the
browser (slow, PERF-02); the platform fixed the query side properly and never
built the navigation, so the data went from *slow to reach* to **impossible to
reach**. Row 51 does not exist.

The **domain layer is at or above parity** and in nine places is objectively
better (LEGACY_PARITY §6.3) — query-side scoping, RLS, revocable sessions,
idempotent jobs, write-time notification audiences, `Decimal` money, atomic
client counters, the assignment rules, the contract-test discipline. **None of
that may be traded back to restore the consumer layer.**

Do not start Phase 8, do not add SaaS functionality, and do not redesign
anything until the roadmap in `LEGACY_PARITY.md` §4 reaches the end of Tier 3.

### Restoration progress

| Slice | Restores | State |
|---|---|---|
| **LP.1** product editing | R1 | **DONE** — catalog 40→55 |
| **LP.2** unknown carrier adapter refused, not mocked | R2 (half) | **DONE** — delivery 33→39, screens 99→100 |
| **LP.3** list pagination + filter bar + search | N1, N7, N8, B1 | **DONE** — screens 100→112, listing 25→30 |
| **LP.4** create an order from the console | N6 | **DONE** — screens 112→121 |
| **LP.5** the real ZR Express adapter | R2 (rest) | **DONE** — delivery 39→61, screens 121→123 |
| **LP.6** order export (CSV: ZR / Ecom / Ecotrac + report) | R4 | **DONE** — export 31 (new), screens 123→130, access 65→68 |
| **LP.16** the profit/loss calculator, all four steps | R9, N23, half of R20 | **DONE** — finance 38 (new), calc 20 (new), delivery 61→64, access 68→72 |
| **LP.7** the notification provider (bell, badge, panel, toast, live refresh) | N2, N3, L1, L2 | **DONE** — notifications 33→41, orders 38→40 |
| **LP.13** analytics + the dashboard's reaction-time figures | R6, K1, N18, N20 | **DONE** — analytics 19 (new), access 72→73 |
| **LP.17** the AI screen (a live 404) + provider/agent CRUD | R10 | **DONE** — ai 20 (new), access 73→78 |
| **LP.14** carrier test / sync / integration logs, mapping delete | R3, R20 (rest) | **DONE** — delivery 64→77, access 78→82 |
| **LP.12** missed-counter reset, the suspicious flag, payroll, the order audit trail, password reset | R11, R14, R15, N11, N12 | **DONE** — screens 130→140, team 56→62, access 82→84 |
| **LP.8** inline row actions + list density + the changed-row flash | N9, N10, N21, N22 | **DONE** — screens 140→148 |
| **LP.9** bulk classify / assignFollowup / createShipments / sendToDelivery | R7, half of R13 | **DONE** — orders 40→58, screens 148→152 |
| **LP.10** client detail / correction / export / eight filters | R5 (3 of 4) | **DONE** — registry 21 (new), access 84→87 |
| **LP.11** six sound signatures, per-family toggles, desktop notifications | N4, N5 | **DONE — TIER 2 COMPLETE** — notifications 41→48 |
| **LP.15** sales-channel screen, adapter registry, test, logs, per-platform parsing | R8 | **DONE** — integrations 29→47, access 87→90 |
| **LP.18** product fields, the variant editor, `niche`/`category`/`supplier` | R12 | **DONE** — catalog 55→66, registry 21→23, access 90→92 |
| **LP.19** customer + order CSV import (preview, per-row reasons, dedup) | R5 (rest), R17 (import) | **DONE** — import 25 (new), access 92→94 |
| **LP.20** lead capture, product sync, Shopify topic routing | R19 | **DONE** — integrations 47→63 |
| **LP.21** manual follow-up assignment + the live countdown | R13, N14 | **DONE** — integrations 63→75, access 94→95 |
| **LP.22** the Ecom Delivery adapter + the poll leaves the transaction | R2 (rest), N17 | **DONE — TIER 3 COMPLETE** — delivery 77→88 |
| **AUDIT.1** the independent audit: 7 findings, all writer/reader mismatches | — | **DONE** — screens 152→167 |
| **AUDIT.2** the access inventory derives itself from the route files | — | **DONE** — access 95→201 |
| **AUDIT.3** a duplicated product name attributes to neither row, visibly | — | **DONE** — screens 167→169 |
| **AUDIT.4** a `t()` key that existed only in code, and the scan that closes the class | — | **DONE** — i18n 18→20 |
| **AUDIT.5** AI provider Test Connection + integration log — two columns whose writer the port left behind | — | **DONE** — ai 20→31, access 201→203 |
| **AUDIT.6** "run it now" had no button; the roster did not say where people come from | — | **DONE** — jobs 27→31 |
| **AUDIT.7** the webhook dropped `externalProductId`/`VariantId`/`OrderAt` — the link branch had never run | — | **DONE** — integrations 75→80 |
| **AUDIT.8** a column nothing names fails the build; nine found on the way in | — | **DONE** — db 29→33 |
| **AUDIT.9** the worker's tick had no deadline — a hung platform stopped every job forever | — | **DONE** — worker 0→4 |

**The roadmap was re-ordered by the second pass** (LEGACY_PARITY §4). Pagination
moved to the front: row 51 is unreachable today, and the shared `<Pager>` /
`<FilterBar>` primitives are an architectural dependency of most of what follows.
The ZR adapter moved back one place deliberately — it is the highest-risk slice
in the roadmap (network I/O inside a 15s transaction), and LP.3/LP.4 are low-risk
and unblock daily work immediately.

### D-LP.5.1 — a carrier is not a database, and must not share its transaction

`withTenant` opens an interactive transaction with a 15-second timeout
(TX_OPTIONS), and until LP.5 every carrier call ran inside it. That was harmless
only because the one registered adapter was a synchronous simulator. A ZR
booking is three HTTP round trips to somebody else's server — **and booking is
triggered by CONFIRMING an order**, so a slow carrier would have rolled back the
call record, the status change and the stock movement. `confirm.ts`'s
`try/catch` does not save a transaction that has already timed out; every
statement after it fails too.

Every carrier interaction is now three phases — **plan** in a transaction,
**call** in none, **record** in a transaction — as separate exported functions in
`shipments.ts`, so the route and the scheduled poll compose the SAME
`ingestEvents`. `bookAtCarrier` takes no `db`, so a caller cannot hand it one.

`tenantRoute` gained **`afterCommit(work)`**: work that runs after the
transaction commits and before the response is sent, and may replace the
response. Additive — a handler that never calls it is unchanged. It is not a
background queue; the response waits, because whoever pressed the button is owed
the answer.

**The one caller still inside a transaction is the scheduled poll** — bounded by
`POLL_BATCH = 25`, waiting on nobody, and reaching no network today because ZR
declares `canPoll: false` and refuses first. Recorded as **N17**, grouped with
the Ecom adapter (Tier 3, slice 22).

### D-LP.5.2 — the commune must belong to the wilaya, which the ERP did not require

`zr.js` scoped the commune lookup to the resolved wilaya and then, if that
missed, searched every returned territory "ignoring parentId (rare but safe)".
It is not safe: Algerian commune names repeat across wilayas, so the fallback
books a real parcel to the right NAME in the wrong PLACE — a courier drives to
another province, the customer is never called, and the order looks perfectly
booked. The platform refuses instead, naming the word to correct. It is the only
place LP.5 does not port the legacy behaviour.

Two more ZR rules worth stating: **the Svix check fails closed** (the ERP's
returned *accept* for a missing header, a missing secret, and from its own
`catch` — SEC-04), and **a ZR parcel has no tracking number when booked**, so the
delivery webhook finds a parcel by `carrierReference` as well as by tracking
number and writes the number once, on the first webhook that carries it.

### Two defects LP.5 found, both in shipped code

**`guessStatus` read "Sorti en livraison" as DELIVERED.** It tested
`/livr|deliver/` first and "livraison" contains "livr", so an unmapped carrier
reporting a parcel that had just left the depot settled the order — outcome
written, client lifetime spend moved, product revenue moved, delivered pay
earned, none of it reversible because settlement is permanent by design.
Reachable from the one path that deliberately keeps this fallback: a webhook
PUSHED for a carrier with no registered adapter (D-LP.2). `refus|rejected` had
also been dropped, so every unmapped refusal resolved to "pending". Both
restored from `apps/erp/lib/statusMap.js`, which had the ordering right.

**`Shipment` had no unique on `(tenantId, orderId)`.** "One parcel per order" was
stated in three comments and enforced by a `findFirst` before a `create` — two
concurrent bookings could both see nothing and both insert. Milliseconds wide
before, as wide as the carrier's latency after D-LP.5.1, so this slice closes it:
the constraint is real, `bookShipment` recovers from the P2002 by returning the
winner's shipment, and a test fires two bookings at one order.

### D-LP.6 — the export is the list, and a carrier file means confirmed

**D-LP.6.1 CSV, not XLSX.** The three carrier files are flat column lists; the
report's two SHEETS become two formats. XLSX would mean a writer dependency in
the server bundle for one feature.

**D-LP.6.2 the export IS the list, filtered the same way.** It takes the same
query string through the same `orderFilters` and `scopedWhere`, so an export and
the screen that offered the filters cannot disagree about what "confirmed orders
from this week" contained. That is also why the controls live on the order list
rather than on a screen of their own — the legacy's separate Export page could
only ever export "all confirmed" and never what an operator had narrowed to.

**D-LP.6.3 a carrier file is confirmed orders and no caller can widen it.**
`status` is dropped for `zr`/`ecom`/`ecotrac` and `confirmed` is ANDed in; every
other filter still applies. Handing a courier an order nobody confirmed is a
real visit to a customer who never agreed to one — which is why the rule applies
to a TICKED SELECTION too, the hole that attacking the implementation found.

**Two spreadsheet properties that are security, not polish.** A cell beginning
`=`, `+`, `-` or `@` is a FORMULA to Excel, and `client`/`product`/`note` are
typed by strangers on a storefront; `csvCell` neutralises them and leaves plain
numbers alone. And the file carries a UTF-8 BOM, or Excel reads it in the
machine's ANSI codepage and every accented wilaya is mojibake. **The BOM test
asserts bytes**: `Response.text()` strips a leading BOM by specification, so the
obvious assertion cannot fail.

**`EXPORT_LIMIT = 10_000`, refused by name over it.** No fixture reaches 10,001
rows, so that path is verified manually — lower the constant to 2, rebuild,
confirm three orders, observe `422 TOO_MANY_ROWS {total:3, limit:2}` — and the
reproduction is in the changelog rather than in somebody's memory.

### Two open questions LP.4 recorded rather than answered

**N15 — the price breakdown is lost at order entry.** The legacy new-order modal
captures unit price, discount and shipping and derives the total.
`CreateOrder` accepts a flat `price`; the four breakdown columns exist, are
`MANAGER_WRITABLE`, and are therefore reachable by a `PATCH` a second later but
never at creation. Widening the create route means deciding whether it derives
the total or trusts it — a real design question, not a form change.

**N16 — create and edit disagree about who may set a price.** `price` and
`carrierCode` are manager-only in `buildPatch` and **ungated in `CreateOrder`**,
so an agent may set a price on a new order and may not change it a second later.
One of the two rules is wrong. The panel follows the ROUTE (D-06.2); deciding
which rule is right is an authorization change and needs its own review.

### D-LP.3 — one filter vocabulary, and offset paging with a total

`orderFilterFields` lives in the same module as `orderFilters`. A filter bar with
its own list of fields is a second vocabulary: it goes stale the moment a filter
is added to the API, and it shows up not as an error but as a capability nobody
can find. The screens test asserts it **both ways** — every offered control names
a key the filter function reads, and each offered value then narrows a real list.

**Paging is offset, not a cursor, and that reverses this project's own earlier
proposal** (LEGACY_PARITY §6.4b). A cursor cannot answer "page 3 of 27", and the
API's `pagination()` helper is already `page`/`pageSize` — paging the screens by
cursor would be a second vocabulary over the same rows, which is the failure the
paragraph above exists to prevent. The deep-scan cost is real and is bounded by
the filter bar beside it.

Named date windows (`range=today|yesterday|week|month`) resolve **inside**
`orderFilters`, never on a page: a screen doing its own arithmetic would
eventually disagree with an export about what "today" contained. An unknown range
is ignored rather than refused, like an unknown sort column.

### D-LP.2 — an unregistered adapter refuses, except when mapping a pushed status

`getAdapter` returns **null** for a key nothing is registered under; it used to
return `mock`. Booking or polling through a fallback is how a carrier configured
as `zr` got a fabricated `MOCK…` tracking number and a 201 — and how polling
that shipment then walked a real parcel along the mock's synthetic pipeline and
**settled its delivery outcome**, booking revenue for a delivery that never
happened.

Refused at configuration (`POST`/`PUT /api/erp/carriers`, message naming the
keys that DO work) and again at use (`createShipment`, `refreshShipment`),
because a row can already hold a bad key.

**The one exception is `mapCarrierStatus`**, which keeps a keyword fallback and
is what the inbound delivery webhook uses. Interpreting a status string cannot
invent a parcel, and the carrier PUSHED that event — dropping it would lose a
real delivery outcome to a configuration problem.

### D-LP.1 — an edit never moves stock

`PATCH /api/erp/products/[id]` **refuses** `stock` and `variants` with a named
422 rather than accepting them. The ERP's `PUT` recomputed the stock column from
whatever the caller sent; here stock is owned by the movement ledger, where
`applyMovement` writes the level and its reason in one transaction — and that
pairing is the only reason the cost basis can be trusted. Refusing by name
rather than dropping silently is deliberate: a caller sending `stock` believes
they are setting a level, and a 200 that does nothing is the same class of
defect this slice existed to fix in `costPrice`.

---

## Read this first

If you are a new session picking this up, read this section fully before running anything.

1. **This is a multi-tenant SaaS platform, not an app.** The single most important
   property in the codebase is tenant isolation. Three layers enforce it
   (columns → client binding → Postgres RLS). Never weaken any of them to make
   something work. If a query returns nothing, the usual cause is a missing
   tenant binding, not missing data — **RLS denies by returning zero rows, not
   by erroring**, which is the single most common way to lose an hour here.

2. **Never write `where: { tenantId }` in application code.** The binding does
   it and the database enforces it. A second filter is a weaker copy of a rule
   that already holds, and the two will eventually disagree.

3. **The database is live and shared.** `packages/db/.env` points at a real Neon
   Postgres. Migrations and seeds affect it immediately. There is no local
   database.

4. **A green build proves almost nothing.** This project has been bitten three
   separate times by a build that compiled while every request failed at
   runtime. Always verify against the running server.

5b. **`builder:start` runs the STANDALONE build now, and the reason is a trap
   worth knowing.** `next.config.ts` sets `output: "standalone"`, and Next 16.2
   REFUSES `next start` with that configuration — in the worst possible order:
   it prints `✓ Ready in 533ms`, *then* the refusal, then exits 1. A background
   start therefore looks healthy for exactly one line and leaves nothing
   listening, which is rule 5's silent port race arriving from the other
   direction. It stayed hidden for a whole session because another process was
   holding :3000 and answering every request.

   `apps/website-builder/scripts/start-standalone.mjs` runs
   `standalone/apps/website-builder/server.js` — **the same artifact the
   Dockerfile runs and the deployment serves** — and mirrors `public/` and
   `.next/static/` in beside it first, because Next deliberately leaves both out
   of the standalone bundle and the Dockerfile copies them as separate layers.
   Without that copy the pages render and every stylesheet 404s, which looks
   like a broken build rather than a missing directory. `start:next` keeps the
   old command for anyone who turns `output` off.

5. **Windows: stop node, build, THEN start — in that order, every time.**
   `prisma generate` rewrites a native `.dll` a running node process holds open,
   so building with the server up can fail with `EPERM`. Worse, `next start`
   serves a PREBUILT app: if the old server still holds :3000 the new one loses
   the port race SILENTLY, `/api/health` answers 200 from the stale process, and
   you verify a change against the previous build. That cost a full debugging
   cycle in 5.3 — twice.

6. **The full-workspace `npm test` is intermittently red for infrastructure
   reasons** — see *Known limitations*. Every suite passes reliably on its own.
   Judge correctness per suite, not by the aggregate run.

7. **Two security actions are outstanding and need a human** — see *Security
   actions requiring manual intervention*. Neither blocks development.

---

## Executive summary

LandingOS is a **modular multi-tenant SaaS platform**. It is deliberately *not*
one product with a bolt-on: it hosts any number of independently subscribable
**products**, of which two exist today.

| Product | id | Status |
|---|---|---|
| Website Builder | `website-builder` | Fully migrated onto the platform |
| ERP / CRM | `erp` | Backend fully ported (Phase 5). Its API runs on the platform; the vanilla SPA is Phase 6. |

A customer subscribes to either, or both. Neither is privileged. The platform
supplies authentication, tenancy, roles, entitlements, billing hooks, domains,
notifications, i18n and the design system; products supply only their own
screens and data.

**The central architectural claim, and the thing to preserve:** adding a tenth
product must touch that product's files and nothing else. The platform never
enumerates products — it reads a registry.

---

## Where we are

**Phase 5 is complete. PHASE 6.3 IS COMPLETE.** The ERP's backend runs entirely
on the platform (235 contract tests), **every item in its navigation leads to a
real screen** — twelve of them — and **every mutation the ERP's SPA can perform
now has a control on the platform.**

Phase 6.3 landed in four slices: 6.3a the agent's working loop (start a call, log
its result, add a note, classify an order as fake); 6.3b editing an order,
reassigning it, and bulk status/assign/delete; 6.3c the parcel, products and the
stockroom; 6.3d carriers, the books, the team and the automation rules.

**Phase 6.4 has ported everything `agent.html` shows that the platform can
serve.** `/console/erp/queue` is the tap-to-dial working screen: the scoped
queue, the call loop, notes, filters, the parcel line, and the follow-up panel.

6.4c added the one route the agent PWA had that the platform lacked — resolving
a follow-up task — and that port exposed two Phase 5 gaps. **6.5a closed the
first**: carrier events raise tasks again, on the `ingestEvents` choke point both
the poll and the webhook pass through.

**6.5b closed the second: M-15 is done.** Follow-up escalation and the overdue
sweep run as idempotent jobs in `src/lib/erp/jobs.ts`, driven either by a
manager (`POST /api/erp/jobs/[job]`) or by `services/worker`, which is a timer
and an HTTP client holding no logic and no database connection.

**6.6a closed the first of the four accepted behaviour differences:
auto-assignment.** `src/lib/erp/assign.ts` is the one eligibility-and-workload
rule behind all three of the ERP's assignment behaviours — a new order, a
confirmed one, and an overdue one that changes hands.

**6.6b closed the second — the carrier tracking poll — and found that
`services/worker` had never run a single job.** 6.5b's tick read `Subscription`
through the unbound `asPlatform()` client, and that table is RLS-scoped, so every
tenant came back unentitled and the tick answered `{ tenants: 0 }`. The worker
logged "0 jobs over 0 tenants" and looked healthy. **It was found by running the
worker, not by a test** — the authorised half of the endpoint had never been
executed by anything, because the dev server had no `WORKER_SECRET` and the tick
fails closed. `ERP_CONTRACT=strict` now refuses to run without one.

**6.6c is M-16, part one: notifications are a platform service.** One feed per
person across every product, one badge, and the audience decided ONCE at write
time — one row per recipient — because every notification bug the audit found
lived in interpreting a free-text audience at read time. An audience is named by
a PERMISSION and resolved with `can()`, so it cannot drift from the rule the
routes apply. **6.6d completed M-16**: a live SSE stream that polls the table rather than
fanning out in process — correct on one instance and on ten — with exact replay
from `Last-Event-ID`, and Web Push. The AI assistant remains a deliberate 501.

**Phase 6 closed with 6.6f.** Every ERP behaviour is on the platform; `apps/erp`
is kept deliberately as the reference implementation — see *What still prevents
retiring `apps/erp`*.

**Phase 7 has started. 7.1a landed the team API** — six routes under
`/api/platform/team/*`, 39 contract tests, purely additive. **7.1b landed the join
flow** — `/console/join/[token]` plus `POST /api/platform/invitations/[token]/accept`,
47 contract tests, and the `withInvitationToken` RLS binding. **7.1c landed the team
screen** — `/console/settings/team`. **Phase 7.1 (team management) is complete.**
**7.2 landed billing** — `GET/PUT /api/platform/billing/*` plus
`/console/settings/billing`, 19 contract tests, proving "change entitlements and
watch access follow". **7.3 landed self-serve signup** — `POST /api/platform/signup`
plus `/console/signup`, 10 contract tests, closing R-08 (the reserved-slug list
enforced at creation). **Phase 7 (the SaaS layer) is complete.** The next phase
is **8, hardening**; see *Next recommended task* below.

**Exact stopping point:** committed and verified. Nothing is half-built: 7.3 is a
complete, tested slice. A signed-out visitor can create a tenant, become its
owner, and land in their console.

### The assignment rule (6.6a)

Three decisions, and the first two are both places where the platform is
deliberately **stricter** than the ERP:

- **D-06.5.** Automatic assignment requires an **explicit** `jobRole` of
  `confirmation`, `followup` or `both`. The ERP treated a missing role as
  "confirmation agent" because every row in its `agents` table was one;
  `Membership` is everybody in the company, and `jobRole` is null for the
  bookkeeper, the builder-only user and the owner.
- **D-06.6.** Eligibility also asks `can(..., "erp:orders:write")` — the same
  function and permission the route checks. Never hand out work the API would
  refuse; it produces work nobody can do and a missed-order counter climbing
  against somebody who was never able to act. Entitlement rides along inside
  `can`, so a lapsed subscription assigns nothing.
- **D-06.7.** `overdueFlaggedAt` is **both the guard and the clock**. The ERP
  cleared it on reassignment while measuring the deadline from `createdAt`,
  which never moves — so one ignored order would walk the whole roster in
  minutes, counting a miss against each agent sixty seconds after they received
  it. Re-arming from the handover applies only when `autoReassign` is on; with
  it off an order is flagged exactly once, as before.

The sweep's threshold is **`reassignMinutes`**, not `alertMinutes`. The two are
different ERP jobs and 6.5b conflated them: `alertMinutes` is the hourly
stale-order alert and the queue screen's overdue badge.

### How a write surface is built here (6.3)

Three decisions, made in 6.3a and binding on the rest:

- **D-06.1.** A control calls the API route. It does **not** get its own server
  action. Every mutation already has a route with contract tests in front of it;
  a server action would be a second write path with its own copy of the
  permission gate, the ownership guard and the validation — the half nobody
  tested. The cost is that these controls need JavaScript.
- **D-06.2.** A control is rendered only where the API would accept it, decided
  with the same function the route checks (`can`, `mayTouchOrder`,
  `seesWholeBook`) and with **the permission that route names** — the ERP write
  surface spans seven (`erp:orders:write`, `erp:shipments:write`,
  `erp:products:write`, `erp:inventory:write`, `erp:finance:write`,
  `erp:agents:manage`, `erp:settings:write`, plus `seesWholeBook` for
  reassignment), and one blanket "may write" flag would be wrong for most of
  them. Equally: never withhold a control the API *does* accept — logging a
  result with no call-start is allowed and flagged, so the button stays. Absence
  is stated on the page, not silent.
- **D-06.3.** No optimistic UI. On success the router refreshes and the server
  component re-renders from the database; the control is busy until then. A form
  a write can change is **keyed on the server's values**, so a refresh remounts
  it on what was stored.
- **D-06.4.** A collapsible panel renders its contents always and toggles
  `hidden`. Mounting on click means the offered vocabulary only exists after
  JavaScript runs — unassertable by a contract test and unreadable to assistive
  tech until somebody clicks.

Two rules that decide what a screen may offer at all:

- **A screen reading the database directly must apply the permission its API
  equivalent applies.** 6.3d found the carriers page rendering for an agent who
  could not call a single carrier route, because it bypassed the API. A nav item
  is a hint; the URL is typeable.
- **A product must never ship a nav item the platform owns** — `settings`,
  `profile`, `billing`, `team`, `notifications`. `packages/product-registry`
  asserts it. When the ERP's rules screen collided, the name was the defect: it
  became **Automation**, which is what those keys actually are.

Client components take **translated strings and vocabularies as props** and hold
neither. Two modules carry no directive and are imported from both sides —
`lib/console/action-errors.ts` (envelope `code` → i18n key, because the API's
`message` is English written for a log) and `components/console/edit-field.ts`
(the field descriptor and `editFingerprint`).

**A value exported from a `"use client"` module is not callable on the server.**
It is a client reference, and calling it throws at runtime while the build
succeeds — which is how the order detail spent a cycle answering 500 in 6.3b.
Anything both sides need goes in a directive-free module.

### Sequencing note

NEXT_STEPS originally had 5.2 build every repository and 5.3 add every route.
That was changed on purpose: done in that order nothing is verifiable until both
finish, which is the position this project has been bitten by three times. Work
proceeded in **vertical slices** — repository plus routes plus green tests, one
domain at a time.

### The ERP surface, all of it

| Surface | Contract |
|---|---|
| orders (+ stats, **the seven bulk actions** LP.9, 6 per-order routes), clients, settings, audit | orders 58/58 · validation 29/29 · listing 30/30 |
| the customer registry — one record, its history, its correction and its file (LP.10), and the niche filter LP.18 unblocked | registry 23/23 |
| products (incl. **editing**, LP.1, the **normalised sales-summary match**, LP.16a, and the **variant editor + three classification columns**, LP.18), inventory, stock lots (incl. stock on confirm/cancel), agents, payroll (incl. `periodType`, LP.16b) | catalog 66/66 |
| carriers (incl. **adapter refusal** LP.2, the **real ZR Express adapter** LP.5, **test / sync / the integration log** LP.14, and the **Ecom Delivery adapter** LP.22), shipments, delivery settlement, the follow-up producer, the tracking poll (**outside the transaction since LP.22**) | delivery 88/88 |
| sales channels (incl. the **screen, the adapter registry, test / logs and per-platform parsing**, LP.15), inbound webhooks (incl. **lead capture, product sync and topic routing**, LP.20), AI, follow-up (incl. **manual assignment**, LP.21) | integrations 75/75 |
| the SalesOrder ↔ FulfillmentOrder relationship (M-05) | order-split 8/8 |
| every ERP screen, read and write (incl. paging/filters LP.3, **order entry** LP.4, the **ZR configuration surface** LP.5, the **export panel** LP.6, the accountability surface LP.12, the **inline row actions + density** LP.8, the **completed bulk bar** LP.9, the **product record** AUDIT.1/3 and the **sortable column headers** UI.2) | screens 173/173 |
| the order book as a file — ZR / Ecom / Ecotrac / report (LP.6) | export 31/31 |
| a spreadsheet coming IN — customers and orders, with a preview (LP.19) | import 25/25 |
| the scheduled work (M-15), and the worker's tick both ways | jobs 16/16 |
| assignment — new, confirmed and overdue orders | assign 25/25 |
| notifications: storage, audience, badge, the live stream, Web Push (M-16), the console that consumes them (LP.7) **and how a person wants to be told (LP.11)** | notifications 48/48 |
| the P&L department — proration, fixed costs, versions, roll-up, the calculator screen (LP.16) | finance 38/38 + calc 20/20 |
| the confirmation rate and six other breakdowns, plus the dashboard's reaction-time figures (LP.13) | analytics 19/19 |
| the AI screen, the assistants and their providers (LP.17) | ai 20/20 |
| every surface, gated — **derived from the route files**, not listed by hand | access 203/203 |

**969/969** across EIGHTEEN ERP contract files, each verified on its own, plus
**91/91** platform contract (team 62 · billing 19 · signup 10) and **20/20** in
`test/calc.test.ts` — the one PURE suite, which needs no server at all. Running
several contract files back to back still trips the documented Neon connection
limit; judge them per file.

Three routes answer **501 by design**, and are not gaps: `POST /api/erp/agents`
(inviting a person is a platform action, M-02), and `ai/chat`, `ai/chat/stream`,
`ai/insights/deep` (calling a model is deployment configuration). All are gated
first, so the authorization contract is complete either way.

### Decisions taken in Phase 5

- **D-05.1.** `*:clients:read` and `*:finance:read` are `SENSITIVE` — no role
  grants them implicitly. The customer registry is every customer's PII and the
  finance screens are the company's P&L.
- **D-05.2.** Human-readable numbering comes from an atomic per-tenant
  `TenantSequence`, not from counting rows and probing for a free slot.
- **D-05.3.** `ORD-0042` is a `reference` column, unique per tenant; the primary
  key is a cuid. The ERP used the number AS the key, which collides across
  tenants on the second tenant's first record.
- **D-05.4.** Per-member ERP data (pay rates, days off, missed-order counter)
  lives in `ProductSetting` keyed `agent:<userId>`, not as columns on
  `Membership` — the platform must never learn what a payroll rate is.
- **D-05.5.** Inbound webhook paths carry the tenant
  (`/api/erp/webhooks/[tenant]/...`), because `SalesChannel` is RLS-scoped and a
  channel id alone cannot be resolved before a tenant is bound.

### Still with no platform home

Two ERP guarantees left the product suite in 5.1 and remain unowned: the
cross-origin state-change refusal (`CSRF_ORIGIN`) and rate limiting (login
throttling per IP *and* per account, plus an API backstop exempting the event
stream and inbound carrier webhooks).

### Phases completed

| Phase | What it delivered |
|---|---|
| 1 | Security & correctness on the ERP (pre-existing work) |
| 2 | Product quality on the ERP (pre-existing work) |
| 3.1 | npm workspace; ERP → `apps/erp`; builder imported with all 65 commits |
| 3.2 | Unified Prisma schema — 51 tables, 3 domains, one database |
| 3.3 | Tenant isolation: RLS on 46 tables, tenant-bound client, isolation suite |
| 3.4 | Identity: opaque sessions, argon2id, entitlement-aware RBAC |
| 4.1 | Console design system — tokens, status vocabulary, WCAG-verified |
| 4.2 | i18n — Arabic, French, English, enforced by tests |
| 4.3 | The console shell — registry-driven, names no product |
| 4.4 | The builder's data layer and every screen, ported and proven |
| 4.5 | Storefront migrated; legacy dashboard, JWT and middleware deleted |
| 5.1 | The ERP's tests ported to `/api/erp/*` — 227 tests, executable ahead of the routes |
| 5.2 | ERP data-layer foundation + the orders/clients/settings slice, verified live |
| 5.3a | Products, inventory, agents/payroll and finance — catalog 31/31 |
| 5.3b | Carriers, shipments and delivery settlement — delivery 20/20 |
| 5.3c | Sales channels, webhooks, AI, follow-up — the surface is complete |
| 5.4 | The order split (M-05) — Builder→ERP in one transaction, 235/235 |
| 6.1 | The ERP's first real screens — overview, orders, order detail |
| 6.2 | The remaining eight screens — every nav item leads somewhere, 31/31 |
| 6.3a | The screens start writing — the call surface, 39/39 |
| 6.3b | Editing, reassigning, and the list's bulk actions, 50/50 |
| 6.3c | The parcel, the catalogue and the stockroom, 59/59 |
| 6.3d | Carriers, books, team, automation — **Phase 6.3 complete**, 80/80 |
| 6.4a | The confirmation agent's queue — tap to dial, 90/90 |
| 6.4b | Filters, the parcel line and the follow-up panel, 95/95 |
| 6.4c | Resolving a follow-up task — and the two gaps it exposed, 96/96 |
| 6.5a | The follow-up producer — carrier events raise tasks, 26/26 |
| 6.5b | M-15 — the scheduled work leaves the web process, 14/14 |
| 6.6a | Auto-assignment — new, confirmed and overdue orders, 25/25 |
| 6.6b | The carrier poll — and the worker that had never run a job, 33+16 |
| 6.6c | M-16 part 1 — notifications become a platform service, 18/18 |
| 6.6d | M-16 part 2 — the live stream and Web Push, 29/29 |
| 6.6e | The console installs, and can receive a push, 33/33 |
| 6.6f | Stock moves on confirm/cancel — the last gap, 40/40 |
| 7.1a | The team API — invitations, members, roles, suspension, removal, 39/39 |
| 7.1b | Accepting an invitation — the join page, the accept API, `withInvitationToken` RLS, 47/47 |
| 7.1c | The team screen — `/console/settings/team`, D-06.2 control visibility, **Phase 7.1 complete**, 56/56 |
| 7.2 | Billing — entitlement management; drop `product.erp` and ERP 403s on the next request, 19/19 |
| 7.3 | Self-serve signup — `POST /api/platform/signup`, R-08 reserved-slug at creation, **Phase 7 complete**, 10/10 |

### Remaining roadmap

| Phase | Scope |
|---|---|
| 7 | SaaS layer — team management (**complete**), billing (**complete**), self-serve signup (**complete**). See NEXT_STEPS §7. |
| 8 | Hardening — adversarial isolation review, load testing, backup/restore, runbooks |

### Next recommended task — LEGACY PARITY, Tier 1

**Phase 7 (the SaaS layer) is complete.** Four slices: 7.1 team management
(API + acceptance + screen, 56 tests), 7.2 billing (entitlement management,
19 tests), 7.3 self-serve signup (10 tests), plus a demo tenant.

**Phase 8 is DEFERRED.** `LEGACY_PARITY.md` measured the platform ERP against
`apps/erp` feature by feature and found 24 missing and 14 partial features. The
restoration roadmap is in that file, §4, ordered by business value rather than
by technical simplicity. Tier 1 is the four production blockers:

| # | Slice | Size | State |
|---|---|---|---|
| 1 | Product editing — `PATCH /api/erp/products/[id]` + the control | S | **DONE (LP.1)** |
| 2a | Carrier adapter refusal — no more fabricated tracking numbers | S | **DONE (LP.2)** |
| 2b | The real ZR Express adapter | L | **DONE (LP.5)** |
| 3 | Order export — CSV for ZR / Ecom / Ecotrac + the performance report | M | **DONE (LP.6)** |
| 4 | Carrier test / sync / integration logs (`IntegrationLog`'s first caller) | M | to do (Tier 3, slice 14) |

**TIER 1 IS COMPLETE.** Six slices: product editing (LP.1), the carrier adapter
refusal (LP.2), pagination + filters + search (LP.3), order entry (LP.4), the
real ZR Express adapter (LP.5) and order export (LP.6). An operator can now
enter a phone order, find it, correct a product's cost, book a real parcel with
ZR Express, and hand a day's confirmed orders to a carrier that has no API.

**LP.16 was taken next rather than LP.7**, because two of its findings were live
wrong answers on shipping screens (§7 P2 and P3) rather than missing features,
and taking the calculator whole instead of only its prerequisite closed R9, N23
and half of R20 in one slice. It is recorded as a judgement call, per
NEXT_STEPS's own instruction to record it either way.

**The next work is still Tier 2 — daily operator productivity — and it starts
with the notification provider (LP.7)**, which is the largest single piece of dead
machinery in the repo: M-16's whole transport (storage, audience, SSE with exact
replay, Web Push, service worker, 33 tests) has **no consumer in the console**.
An operator is still never told anything.

### LP.0d — the third pass, module by module (`LEGACY_PARITY` §8)

Every department and every cross-cutting dimension walked on both sides with
Tier 1 complete. No code changed. **Five legacy screens still have no platform
equivalent** — Stores, Analytics, Alerts, Import, the profit calculator — and
**one platform nav item leads to a 404** (`ai`). Six findings, N18–N23.

**N18 is the one that matters: the confirmation rate is computed nowhere on the
platform.** The legacy leads its dashboard with it and its analytics screen
recomputes it across seven dimensions; it is the number a COD call centre is
managed by. The dashboard also lost the never-called count and the overdue
banner — the two with the shortest reaction time — while gaining in-delivery,
delivered and customers. A trade, not a plain regression, and the four that went
are the four somebody acts on within the hour.

**N19, so nobody "fixes" the right answer:** legacy revenue sums CONFIRMED
orders, the platform sums DELIVERED ones. The platform is correct (a COD
confirmation is not a sale) and the two will never agree.

**N20** `marketer` and `source` are written by the channel webhooks and read by
nothing — **ad attribution is uncomputable today**. **N21** the order row carries
8 facts against 14, and the four missing are exactly the four that decide what to
do next: overdue, called, noted, flagged. **N22** the legacy flashes the changed
row for 3s; the platform marks nothing.

**N23 produces new work.** `fixedCosts` and `defaultCarrierByChannel` are
declared, validated and read by real code, and the automation screen excludes
`array`/`object` settings **by type — the right rule**, so both are unreachable
by any control. One missing pattern: a list editor and a map editor, **S**,
closing half of §7 P3 and all of R20.

**Confirmed as NOT gaps, twice now:** neither system has keyboard shortcuts,
context menus, or a chart of any kind.

### LP.12 — a counter that only rose, and a trail nobody wrote

**R14 is the operational trap.** The overdue sweep raises `missedOrders` and
`autoSuspend` locks the account out at `suspendThreshold`, and **nothing could
lower it** — so every agent eventually trips auto-suspension with no way back
except editing a `ProductSetting` row by hand. `POST /agents/[id]/reset-missed`
closes it, with an audit row, and **does NOT reactivate**: clearing a count and
lifting a lockout are two decisions.

**R11 — the flag was computed, stored and shown nowhere.** `OrderCall.suspicious`
is written on every short confirmed call, which is the entire point of
`minCallSeconds`. Two readers now: a per-agent count on the roster and a
`suspicious=true` filter. **A filter rather than an Alerts screen**, deliberately
— in `orderFilters` it shares one vocabulary with the list, the export and the
analytics (D-LP.3), so a flagged set can be narrowed, exported or analysed.

**N12 turned out to be hiding a defect.** The audit route existed and the screen
did not render it — but `AuditEvent`, `GET /api/erp/audit` and `erp:audit:read`
all existed while **no order mutation wrote a row**. There was nothing to render.
`PATCH /orders/[id]` records the edit now — WHICH FIELDS, not what they became,
because an order carries a customer's address and an audit table is read by
anybody with the permission. The screen follows the ROUTE's permission (D-06.2);
whether `erp:audit:read` should be SENSITIVE is recorded as an authorization
question of N16's shape, not decided here.

**N11** the payroll report finally renders — on the roster, for the aligned
current month, under the rule LP.16b made shared.

**D-LP.12.1 — a password reset DOES destroy sessions, and suspension does not.**
D-07.2 keeps `destroySessionsForUser` away from suspension because it is keyed on
the PERSON and one person belongs to many companies. A reset is the opposite case
for the same reason: the credential is global, and leaving old sessions alive
would lock out the person who forgot it while whoever is already signed in on a
shared handset stays in. R15 closes with
`POST /api/platform/team/members/[userId]/password` — on the platform surface,
because identity is a platform concern.

### LP.8 — the row acts, and says enough to act on

**N9, N10, N21 and N22 — the four findings no route inventory could see.** The
legacy row carries four controls (status, agent, carrier, express) and 14 facts;
the platform's carried none and 8, and **the four facts missing were the four
that decide what to do next** — overdue, called, noted, flagged.

Every inline control calls `PATCH /api/erp/orders/[id]` (D-06.1), so a status
moved to `confirmed` from a list select **reserves stock, books a parcel and
raises a follow-up task** — it goes through the door that does all of that.
Which controls exist is decided per row by the predicates the ROUTE uses:
`status`/`expressDelivery` are `AGENT_WRITABLE`, `agentUserId` is a REASSIGNMENT
field (403 `FORBIDDEN_FIELD` otherwise) and `carrierCode` is
`MANAGER_WRITABLE` — an agent gets two controls, a manager four.

**`orderRowFacts` lives in `lib/erp/orders.ts`**, not on the page: the list, the
board and the queue all need one answer to "is this abandoned", and `overdue`
takes `alertMinutes` as an argument so it cannot become a fourth opinion beside
the dashboard banner and the queue badge. **Overdue is never-called AND old** —
an order phoned three times is being worked however old it is.

**The two facts that live on `OrderCall` are fetched for the PAGE, not per row.**
PERF-02's decision stands: `ORDER_LIST_SELECT` still joins no call history. The
flagged set and the newest note are two bounded queries over the fifty ids on the
page.

**N22's flash marks, it never merges.** `row-flash.ts` retries until the row
exists (bounded, ≈2.4 s) so it survives LP.7's 500 ms debounced refresh
re-rendering the table underneath it. No directive on that module, deliberately —
`"use client"` would make its exports client references rather than functions.

**The defect it introduced, caught by LP.3's tests:** the first build gave the
control div its own `data-order-id`, and the paging tests count rows by that
attribute — every count doubled, 100 rows on a page of 50.

### LP.9 — the bulk bar finishes the job, and a reason nobody could read

**R7.** The legacy dispatches eight bulk actions and this dispatched three.
`createShipments` is the highest-volume manager action in the building;
`assignFollowup` is how a supervisor moves fifty difficult customers at once.
`export`/`print` are deliberately NOT restored as bulk actions — the legacy's
mutate nothing and only validate ids for a browser that builds the file, and
LP.6 gave the export a real server-side writer.

**The drift it exposed: bulk `classify` was STRICTER than the single route.**
"Everything except `status` requires `seesWholeBook`" is right for `delete` and
`assign` and wrong for `classify` — `POST /orders/[id]/classify` is
`erp:orders:write` plus ownership, so an agent could mark ONE of their own orders
fake and not fifty. `ACTION_RULES` now names the permission and manager
requirement per action, each copied from the route that does that thing to one
order.

**D-LP.5.1 is why booking is a second phase.** Fifty parcels is fifty × three
HTTP round trips; holding the 15-second transaction across them would roll back
the `carrierCode` writes `sendToDelivery` had already made, leaving orders
neither routed nor booked. `BULK_BOOK_LIMIT = 50`, refused BY NAME above it (the
`EXPORT_LIMIT` rule), and a carrier refusal is reported per id with the carrier's
own code.

**`assignFollowupAgent` is the manual half of R13** and differs from
`autoAssignFollowup` in exactly two ways, both the difference between an
automation and an instruction: it ignores `followupAutoAssign`, and it
OVERWRITES an existing assignee. A named person is still checked against
`eligibleAgents` — work handed to somebody the API would refuse is a queue nobody
can work (D-06.6). It writes an audit row.

**The defect it found: `fakeReason`, `fakeResponsible` and `fakeAt` were written
since Phase 5 and read back by nothing.** Not in `ORDER_LIST_SELECT`, so the
order read did not return them; the detail showed a bare pill and the list a bare
badge. Marking an order fake is an accusation — it removes the order from the
confirmed count and names a colleague — so "why" and "who says" are exactly the
parts somebody disputes.

### LP.10 — the customer registry stops being read-only

**R5, three of its four features.** The registry is what repeat-purchase
campaigns run on, and it was ONE SEARCHABLE LIST: no detail, no correction, no
export, eight of the legacy's twelve filters missing — while the schema carried
five `imported*` columns and an `address` for features that did not exist.

**The rule the slice is built around: a counter is the sum of events.** `PATCH`
writes four fields (`name`, `wilaya`, `commune`, `address`) and REFUSES every
lifetime counter and every `imported*` column BY NAME (D-LP.1). `phone` is
refused too and that is the load-bearing one — it is the identity key and every
order joins to this record BY VALUE, so editing it would collide with another
customer or silently detach the record from its own history.

**`erp:clients:write` is new and SENSITIVE** (`*:clients:write` in
`packages/auth/src/rbac.ts`). Correcting an address changes where a courier
drives, and a role that could write the registry without reading it would be an
incoherent grant.

**Two of the eight filters are properties of the customer's ORDERS**, not of the
client row — a customer buys many products from many channels over a lifetime.
`clientHistoryPhones` resolves them to a phone set first, and `null` (no filter
asked for) is deliberately different from `[]` (the filter matched no orders):
collapsing them would return the whole registry for a filter that matched
nothing.

**`niche` is absent on purpose** — it needs `CatalogProduct.niche`, which slice
18 adds. A filter over a column that does not exist is a control matching
nothing.

**The detail screen does not attach a parcel timeline per history row.** The
legacy did, at two extra queries PER ORDER; forty orders was eighty round trips
on a screen somebody opens to read a phone number.

### LP.11 — the bell learns to make a noise (Tier 2 complete)

**N4 and N5.** LP.7's bell, badge, panel and toast are all things you have to be
LOOKING at, and in a call centre nobody watches the screen. Six Web Audio
signatures, ported note for note, with a per-family toggle, a volume and a test
button beside each — a per-type sound you cannot hear before saving is one
nobody sets correctly.

**D-LP.11.1 — `ProductSetting`, not `localStorage`.** The one thing the legacy
got wrong here: a manager who mutes the manipulation siren on one machine is
un-muted on the next, and a supervisor cannot tell whether an agent has silenced
the alert that watches them.

**D-LP.11.2 — the preference is per (person, tenant)**, because
`ProductSetting` is tenant-scoped and because the volume somebody wants in a COD
call centre is not the volume they want in a quiet back office.

**There is no way to name a target.** The session's own id is used; a `userId` in
the body is ignored, and a test asserts it. The manipulation siren is the one
notification a person has a motive to silence for somebody else.

**N5's two corrections to the legacy:** the desktop notification fires only when
the tab is NOT visible (otherwise it duplicates the toast beside it), and
permission is asked on a CLICK rather than on page load — asking on load is what
trains people to click Block, and a blocked permission can never be re-requested.

**The build failure that produced `notify-vocab.ts`:** the vocabulary started in
the `server-only` module that the client components import, and the whole build
failed. Directive-free module for anything both sides need — the `edit-field.ts`
rule, now with a second worked example.

### LP.15 — a storefront can finally be connected

**R8.** The channel API has had full CRUD since Phase 5.3c and there was no
screen and no nav item — a tenant could not connect a Shopify store through the
console at all, and the webhook URL generated on create was never shown again by
anything. That string is the single most valuable thing this screen produces,
and it is rendered in FULL: a URL truncated with an ellipsis and then copied is a
URL that silently does not work.

**The catalogue and the registry are two different lists.** `PLATFORMS` is what a
tenant may choose (the legacy's nine); `ADAPTERS` is what this deployment can do
(two). Both facts are published per entry and the screen marks the difference.

**The fallback exists here and does not for carriers**, and the reason is
concrete: a carrier adapter can INVENT a tracking number (D-LP.2), a channel
adapter cannot invent anything. Refusing the seven unregistered platforms would
mean a tenant on JustSell cannot connect a store. So a structural test says
`structural: true` and states that nothing was contacted.

**The defect a test caught: a registered adapter's `null` is an answer.** The
first build fell back to the generic parser when an adapter returned null, so a
Shopify `products/update` topic became an order with no customer and no total.
D-LP.2's rule in a new place — a registered integration's refusal must be
honoured, never routed around.

**Per-platform parsing.** One generic parser reads Shopify tolerably and
LightFunnels not at all: the order is wrapped in `{ node: … }` and the items are
`items`. Both LightFunnels rules are ported verbatim, including the
checkout-stage stub that fires with only an id and must create nothing.

**`IntegrationLog`'s `salesChannel` half gets its writer** — `test_connection`,
`auth_error`, `webhook_rejected`, `webhook_unparsed`, `webhook_received`. It is
the only place an operator can find out why an order never arrived.

### LP.18 — the variant matrix, and three columns the port dropped

**R12.** A variant could be created once, in the product's `variants` array at
creation, and never renamed, removed or given a threshold; its stock could only
be moved by typing the variant name exactly right into the generic adjust
control. `optionDefs` had a column since Phase 3.2 with **no writer anywhere**.

**D-LP.18.1 — every stock difference goes through the ledger.** The route writes
the ARRAY (names, SKUs, images, thresholds, option maps) directly and never a
LEVEL: a `stock` on an incoming variant becomes a DELTA applied through
`applyMovement`, which writes the level and its reason together. An unchanged
level writes nothing — a ledger full of zero-delta rows is a ledger nobody reads.

**D-LP.18.2 — removing a variant that still holds stock is refused BY NAME**, and
the refusal lists every variant that would lose stock. The ERP dropped them
silently and the stock went with them.

**`erp:inventory:write`, not `erp:products:write`.** The route moves stock, so it
is gated on the permission `/inventory/adjust` checks — a different gate from the
edit panel directly above it on the same screen.

**The generator keeps existing variants' stock.** A generator that replaced the
matrix would silently zero every level it regenerated. The generated name is the
option values joined in definition order, which is stable and is what stops a
catalogue growing "M / Blue" and "Blue / M" as two rows.

**`niche` unblocks the client filter LP.10 shipped without**, with the legacy's
own caveat carried over rather than assumed: an order stores the product NAME, so
a product renamed after its orders were placed will not match its niche.

### LP.19 — a spreadsheet can come in, not only go out

**R5's fourth feature and R17's import.** Five `imported*` columns, an
`importedSource` and an `importedAt` have existed since M-06 — declared, indexed
and RENDERED by LP.10's customer screen — with no writer at all.

**D-LP.19.1 — the file is parsed on the SERVER.** The legacy parses in the
browser and posts "clean records" to an endpoint that trusts them: a second
implementation where nothing tests it, and an API no script can use. `parseCsv`
handles quoting, every line ending, and a leading BOM — which matters concretely,
because our own export writes one and a file exported here re-imported here would
otherwise arrive with its first header named `﻿Name`.

**D-LP.19.2 — preview and commit are one request with a REQUIRED `mode`.** No
default: the failure mode of a defaulted commit is a spreadsheet written into a
live registry by somebody who meant to look first. The panel disables commit
until this file has been previewed, and a new file clears the previous preview.

**D-LP.19.3 — an import never overwrites a real value.** Identity fields fill
only where blank; the `imported*` figures are written ONCE, marked by
`importedSource`; and the LIVE counters are never touched, because they are the
sum of order events.

**D-LP.19.4/5 — the order import goes through `createOrder`** (so it mints a
reference and populates the registry) **and raises no notification** (two years
of history would fire LP.11's ka-ching a thousand times).

**Dedup by external id is the property that matters.** An operator unsure whether
the first import worked runs it again. Without an id column the fallback is
phone + total and the response SAYS so.

**The defect a test caught:** the first build checked the phone before the id, so
a Shopify export — which repeats the order row per LINE ITEM with the customer
columns blank — arrived as one order plus a `no_phone` skip.

### LP.20 — the three inbound paths the port dropped

**R19.** Lead capture is a real revenue path and the only one that catches it:
the legacy confirmed against six real-webhook tests that no platform event
exposes a phone number before an order is completed or forgotten, so a script on
the checkout page posts here directly.

**D-LP.20.1 — no signature, deliberately, and narrow by construction.** The
caller is public page JS, so a secret embedded there is not a secret. It can only
ever create an `abandoned` row (price forced to zero), reads four fields by name,
is refused by a disabled channel, and writes every call to the integration log.

**D-LP.20.2 — a 24-hour merge window**, filling only blank fields, because the
script fires on every keystroke-debounce. **D-LP.20.3 — CORS on this route and
nowhere else**: it is unauthenticated by design, so there is no ambient credential
for a cross-origin request to abuse.

**Product sync creates the LINK**, which is what LP.16a made `sales-summary`
match on first and exclusively. It never UPDATES an existing product: the
catalogue carries a cost basis and a stock ledger the storefront knows nothing
about, and a `products/update` echoing a retail price over it would corrupt every
margin. It creates no stock, and a platform with no product adapter refuses to
guess.

**Topic routing on the one URL.** A tenant configures one endpoint;
`checkouts/*` lands `abandoned` and `draft_orders/*` lands `draft`.

**The defect a test caught: two places interpreting the topic.** LP.15's adapter
gated `parseOrder` to `orders/*`, so LP.20's abandoned-marking never ran and a
`checkouts/create` produced no row at all. **The parser decides SHAPE; the route
decides MEANING**, and both files now say so.

### LP.21 — a difficult customer can be moved, and the deadline ticks

**R13 and N14.** LP.9 built the assignment RULE and reached it only in bulk; this
is the single-order door, on the screen a supervisor already has open.

**`auto: true` is not the same request as an omitted agent.** Neither a `userId`
nor `auto` is a 422, because a supervisor who left the select empty must not
discover the system picked for them. Two refusal codes, because they send you to
different screens: `NO_FOLLOWUP_AGENTS` is a settings problem;
`NOT_ELIGIBLE` names who CAN take it.

**The notification the port dropped with the route.** `followup_assigned` goes to
the PERSON, not to the supervisors — the opposite audience from
`notifyNewOrder`, because a feed that repeats your own actions back at you is one
people stop reading. Only when the assignee actually moved.

**N14 — the countdown is a client component and that is not a D-06.3
violation.** It derives nothing and writes nothing: `dueAt` is the server's fact
and this renders the DIFFERENCE against the browser's clock. Server-rendering
that difference bakes in the render time and is wrong by however long the page
has been open. The first paint is the server's absolute time (no hydration
mismatch, and a real answer without JavaScript), which also stays as the tooltip.

### LP.22 — the Ecom adapter, and the poll leaves the transaction (Tier 3 complete)

**R2's remaining half and N17.** Ecom Delivery is the second real carrier:
`X-API-Key` + `X-API-Token`, `POST /colis`, `GET /colis/{tracking}`.

**D-LP.22.1 — the wilaya map is ported, the OPPOSITE choice from ZR's.** ZR uses
its own UUIDs so LP.5 resolves by name against a live endpoint; Ecom uses the
standard Algerian numbers 1–58, which the state has changed once in fifty years.

**D-LP.22.2 — the default-to-Alger fallback is NOT ported.** The legacy returns
16 for anything it cannot resolve, INCLUDING an empty wilaya, which books a real
parcel to the wrong province. D-LP.5.2 in a second place, refused BY NAME.

**`mapStatus` matches the longest key first**, so "en livraison" cannot win
inside "sortir en livraison" — the LP.5 `guessStatus` defect made structural.

**A polled event with an unreadable date is dropped; a pushed one is stamped
now.** Intake dedupes on the event time, so a synthesised time on a poll doubles
the timeline; a webhook is the carrier telling us something happened NOW and
dropping it would lose a real outcome.

**N17 closes here because Ecom is the first registered adapter that can be
polled.** `pollCarriers(tenantId, settings)` and `runJob(tenantId, job)` now take
NO `db`, so a caller cannot hand them one — the property `bookShipment` has had
since D-LP.5.1, and the signature change is the fix rather than a refactor. The
claim (`lastPolledAt`) is committed in its own short transaction BEFORE the
network call, and both callers changed as N17 predicted: the route runs it
through `afterCommit`, the worker's tick no longer wraps it. There is still
exactly one ingest path — the poll composes `refreshShipmentForOrder`.

### AUDIT.9 — a request with no deadline, which stopped every scheduled job

**Surfaced from a slow test, not from reading.** `jobs.test.ts` failed twice on
the worker tick with `UND_ERR_HEADERS_TIMEOUT` after 308 seconds — easy to
dismiss as a loaded database. Asking WHY it was slow led to the code.

`fetch` has no default timeout. A platform that accepts the connection and never
answers held the worker's `running` flag true **forever**: every later tick
logged "previous tick still in flight, skipping this one" and **the scheduled
work stopped permanently** — escalations, the overdue sweep, carrier polling,
stale-order alerts and the notification prune, for every tenant. The only
evidence was a warn line once an interval, which reads like a tick that is merely
slow.

**It defeated the guarantee the file states.** Its `catch` says "the scheduled
work would stop until somebody noticed. The next tick retries" — and with no
deadline there was no next tick. AUDIT.5's shape again: sound reasoning, and one
line elsewhere making it false.

`AbortSignal.timeout`, defaulting to TEN intervals — the tick legitimately
outlasts one on a large deployment, and a tight deadline would turn a slow pass
into no pass. **The test then caught a second defect in the fix**: the floor
clamped an EXPLICIT `WORKER_TIMEOUT_MS` too, so an operator would set it and
watch nothing change. A value somebody typed is an instruction; the floor applies
to the derived default only.

**The first test this process has ever had.** It runs the worker as a real child
process against a server that never responds, because the defect is a call that
never happens and no unit test of `tick()` can observe a skipped call. Verified
causally: with `signal:` removed the suite fails 2/4 with the original symptom;
restored, 4/4.

### AUDIT.8 — the question that found most of this, asked on every run

The fourth pass's most productive question — **which columns does something write
that nothing reads, and which does something read that nothing writes** — is the
shape of eight serious defects: BUG-02, `IntegrationLog`, `OrderCall.suspicious`,
`fakeReason`, A5, A7, A11 and A14. It was asked by hand each time somebody
thought to. `packages/db/test/orphans.test.ts` asks it on every run, beside the
M-03/M-04 constraint suite whose header states the principle: **mechanical, not
vigilant.**

**It found nine columns immediately, all in the PLATFORM schema** — which the
by-hand sweep had never covered, because it read `erp.prisma` and stopped. Two
are dead in the legacy too. Seven are unbuilt halves of platform features and are
now recorded with the work that would reference them: custom-domain management
(the READ path is complete and safe), session management, seat billing (**no seat
limit is enforced anywhere today**), the billing provider integration, and trial
/ period expiry (nothing moves a subscription to PAST_DUE on a date). **None is
an ERP parity gap** — the legacy is single-tenant, sells nothing and has no
domains.

An exemption must say **what would make the column referenced**: DEAD BOTH SIDES,
or AHEAD OF A FEATURE naming the work. Two further tests stop the list becoming
somewhere findings hide — an exemption for a removed column fails, and so does
one for a column that has since acquired a reference.

**What it cannot see is in the file:** it is a name check, so it catches a column
nothing mentions (A5) and not one read but never written (A11). The cheap half is
mechanical now; the expensive half stays a thing a person asks.

**Verified to fail**: a column nothing names was added to `Carrier`, the suite
went red naming it, and it was removed.

### AUDIT.7 — three fields the parser threw away

`FulfillmentOrder.externalProductId`, `externalVariantId` and `externalOrderAt`
exist in the schema — the last commented `// was shopifyCreatedAt` — and
**nothing has ever written any of them.**

**`resolveProduct` reads `externalProductId` FIRST**, and its comment says "a
link that resolves DECIDES, including deciding 'this one and not the name
match'". That branch had never run. Every channel order matched by NAME instead
— and AUDIT.3 had just made name matching REFUSE on a duplicate. So a tenant
selling through Shopify with two products called "Montre" got no counters on
either and a badge telling them to rename something, while every payload carried
the `product_id` that resolves it exactly.

**Why no test caught it, which is worth more than the fix.** `delivery.test.ts`
covers that branch thoroughly — including "an order linked to ANOTHER product is
refused, even when the names match" — and reaches it through a HELPER that writes
the column directly. The branch was proven correct and unreachable at the same
time. **A test that stages the state a production path is supposed to produce
cannot tell you the path produces it.**

`externalOrderAt` is when the CUSTOMER ordered; `createdAt` is when we heard.
Same second in the good case, days apart when a store is first connected and the
platform replays a backlog — which is exactly when it matters. Shown on the
detail only when the two differ by more than a minute, because two dates that
always agree is a field people stop reading.

### AUDIT.6 — two things an operator could not reach

Both found by asking AUDIT.5's next question: **for every route, which screen
calls it?**

**A12.** `POST /api/erp/jobs/[job]` has existed since M-15 and **no screen has
ever called it** — while its own comment says "a manager needs to be able to say
'run it now' after changing a threshold" and its response comment says "whoever
pressed 'run it now' is owed the result". There was no "run it now" to press.
`access.test.ts` covered it and the jobs suite drove it; both were testing a door
with no corridor to it. It is on the AUTOMATION screen now, because every job
acts on a rule configured directly above it, and the button list is the route's
own `JOBS` import rather than a copy.

**A13.** The ERP staff roster has no "add a person" control, which is CORRECT —
inviting somebody is a platform action (M-02). The defect is that the reasoning
lived in a source comment: an operator saw a table, no button, and no sentence.
It is LP.17's defect inverted — a nav item leading to a 404 versus a screen with
a missing signpost — and it fails the same way. The sentence carries a link only
where `platform:team:read` holds, because `erp:agents:manage` does not carry it
and the alternative is sending somebody to a screen that 404s at them.

**An endpoint existing is not a workflow existing.** Grep a route path across
`.tsx`; an empty result on a route documented as an operator action is the
finding.

### AUDIT.5 — the Test Connection button, and a reason that did not survive re-reading

`AiProvider.lastTestAt` / `lastTestOk` are selected by both provider routes and
rendered by the AI screen, and **nothing has ever written them** — BUG-02's
shape for the fourth time.

**LP.17 did not miss it; it deferred it with a reason, and the reason was
false.** It said "testing a provider means calling a model, which needs an
adapter layer this deployment does not have". The legacy's own adapters: two of
the three test with `GET /models`, which runs no inference at all; the third
sends `max_tokens: 1`. It is a CREDENTIAL CHECK and needs nothing from Tier 4
slice 27. **A deferral with a reason attached reads as a decision and stops being
re-examined** — which is why this survived four passes when A5's bare absence did
not.

It matters more here than for a carrier: a wrong carrier key surfaces the first
time somebody books a parcel, and a wrong model key surfaces at CHAT time, which
on this deployment is never (`ai/chat` answers 501). An operator could configure
a provider, mark it default, and never learn the key had a trailing newline.

`POST /ai/providers/[id]/test` (plan / call / record, D-LP.5.1) and
`GET /ai/providers/[id]/logs` (the third `IntegrationLog` entity after carriers
and channels). `erp.ai.testUnavailable` is deleted from all three locales — a
string describing a limitation the build no longer has is worse than no string.

### AUDIT.4 — a translation key that only existed in the code

AUDIT.1's product screen asked for `t("erp.overview.revenue")` and **no catalogue
had it.** `next-intl` throws `MISSING_MESSAGE` at RENDER time and only in the
missing locale, so it is a 500 on one screen for one language's readers and a
green suite for everybody else — and Arabic is the DEFAULT here, which is the
only reason it surfaced. It surfaced in the server log while a live order was
being driven through the console.

**The existing i18n test could not see it.** It asks whether the three locales
agree with EACH OTHER and whether every key the manifests and status registries
name exists — both derived, both sound, and neither looking at a `t("…")` call in
a component. The catalogues agreed with each other perfectly and with the code
not at all.

The suite now scans every `t("literal")` in the console source (300+ keys) and
asserts it exists in every locale — LP.17's and AUDIT.2's general form again.
**Verified to fail**: the key was deleted from `ar.json`, the suite went red
naming it and the file, then it was restored. What it cannot see is a runtime key
(`` t(`erp.period.${type}`) ``), and the file says so.

**A second defect on the same line:** the overview's revenue tile was borrowing
`erp.overview.delivered`, so the dashboard showed two tiles with the same label
and different numbers — a delivered COUNT and a delivered VALUE.

### AUDIT.3 — a duplicated product name, found by driving a real order

**The only finding no test could have made.** AUDIT.1's contract tests passed
167/167; the counters were then exercised against the RUNNING server — sign up,
create a product, place an order, confirm it — and the product still read
`totalOrders: 0`. They had landed on a different row with the same name. Every
test creates its own tenant with one product per name, so no test could see it.

`resolveProduct` did what the legacy does and took the FIRST matching row. Two
rows answering to one normalised name is what an import produces, what a
duplicate entry produces, and what listing two colours as two products produces
— and the loser reads zero forever with nothing to explain it. In
`/sales-summary` it is worse: both rows claim the same orders and the P&L counts
the revenue twice.

**Refused rather than guessed**, which is D-LP.5.2 and D-LP.22.2 in a third
place. It cannot refuse the ORDER — a sale must not fail over a catalogue
tidiness problem — so the counters do not move and BOTH rows are marked on the
products screen, where somebody can rename one. A counter that silently does not
move is the same defect as one that silently moves to the wrong row; the badge is
what makes it neither.

**Worth carrying forward as a method, not just a fix:** the contract suite is
green and the live console was not. Every slice from here should end with a real
action through the running app.

### AUDIT.2 — the list that could not catch the mistake it existed for

`access.test.ts`'s `SURFACES` says it exists "because a route added later without
a permission is exactly the mistake this catches" — and a hand-written list
cannot catch that. The audit diffed it against the filesystem: **34 ERP routes
were unlisted**, including `POST /orders/[id]/call` (the payroll-fraud surface),
`/products/[id]/inventory/adjust` (it moves stock) and `/jobs/[job]` (it can
suspend accounts).

**Every one was correctly gated** — the derived run passes 201/201 first time.
The gap was the guarantee, not the behaviour.

The fix is the general form this project used for navigation in LP.17: read the
ROUTE FILES and assert every exported method. One exclusion, stated in the file:
`/api/erp/webhooks/**` is unauthenticated by construction. And the derivation
asserts it found something, because a glob that silently matches nothing makes
every assertion below it vacuous.

### AUDIT.1 — the independent audit: four writers and four readers that never met

**Read module by module from `apps/erp`, not from the roadmap.** It enumerated
the legacy's 125 routes and 15 screens against the platform's, then walked the
schema asking the question every serious defect here has answered the wrong way:
**which columns does something write that nothing reads, and which does something
read that nothing write?** Seven findings.

**The biggest: `CatalogProduct`'s lifetime counters were maintained by nothing.**
The schema has said "maintained by the order pipeline" since M-06 and
`PRODUCT_SELECT` has returned them to every caller; the port brought
`syncClientFromOrder` across and left `upsertProductStatsFromOrder` behind. Every
product reported zero orders and zero revenue for the life of the platform —
BUG-02 exactly. `product-stats.ts` is the writer, on the same three doors the
client counters use, resolving the product through `product-match.ts` so the
counters and `/sales-summary` cannot disagree.

**`totalProfit` is deliberately not a column** (it depends on the cost basis at
the time of sale, which `/sales-summary` answers period-accurately) and **the
counters are NOT backfilled** — they are lifetime EVENT counts, and a backfill
from current state would produce a different, authoritative-looking number.

**`CatalogProductEvent` and `CatalogProductLink` had no reader either**, on the
same record: the first is what a cost basis USED to be, the second is what
revenue attribution keys on. `/console/erp/products/[id]` renders all three.

**A badge LP.8 introduced could never appear.** It read
`callReminderStatus`, which nothing writes — the resolve route's own comment says
so. Fixed in the direction that decision chose: `FollowupTask` is the record.

**`FinancialRecord` is append-only and the table looked flat** — two saves of one
week as two equally authoritative lines. The older is marked superseded.

**The AI provider vocabulary had grown a second copy** in the screen, under a
comment claiming it had not. One list now, carrying the base-URL and model
presets the legacy publishes and this had nothing for.

### LP.14 — carriers: three columns nobody wrote, and a log nobody read

`Carrier.lastTestAt`, `lastTestOk` and `lastSyncAt` are **rendered by the
carriers screen** and had no writer anywhere, so every carrier read "never
tested" forever. `IntegrationLog` was migrated with its indexes in Phase 3.2 and
had **no reader and no writer at all** — so the only evidence of a failing
integration was a parcel that did not book.

`testConnection` joins the adapter contract as OPTIONAL, and its absence is
meaningful: an adapter with nothing to ask falls back to a structural check that
**says so** and returns `structural: true`, because a green tick meaning "we did
not look" is the same lie as D-LP.2's fabricated tracking numbers. ZR implements
it as `POST /territories/search` — the smallest call proving BOTH halves of the
credentials. **It must be a READ**: a test that books a parcel to find out
whether booking works sends a real courier to a real address.

`lib/erp/integration-log.ts` is the only writer and **redacts by key at any
depth** rather than trusting callers; it is append-only and never throws, because
a logger that can fail the operation it describes turns a hiccup into a 500.

**D-LP.5.1 applies to both new calls.** A test is one round trip; a sync is up to
25, bounded by `SYNC_BATCH` and reporting `capped`. The sync composes
`refreshShipmentForOrder` — the same function the manual refresh uses — so there
is still exactly one ingest path. A carrier that cannot be polled is refused by
NAME (ZR publishes no tracking endpoint), and the control is not rendered.

**R20's second half:** a wrong status mapping was permanent. `DELETE` is keyed on
`originalStatus`, is idempotent, and touches no history — `ShipmentEvent` keeps
the carrier's own wording on every row.

### LP.17 — the AI screen, and a nav item that answered 404

`packages/product-registry` shipped an `ai` nav item and **no screen existed at
that path**. Every member saw a menu item that 404'd; `screens.test.ts`
enumerates screens by hand and omitted this one, so nothing caught it. **The new
suite's first test is the general form of that defect** — it reads the MANIFEST
and asserts every declared nav item answers 200, so the next one cannot be added.

The screen's insights half is real and works with no provider (counts, not
generation). **The chat half is a sentence saying it is unavailable**, not a box
that fails on submit: `ai/chat` is a deliberate 501, and a control that always
errors says less than the sentence — the same class of lie as D-LP.2's
fabricated tracking numbers. Provider `/test` is deferred to Tier 4 slice 27 for
the same reason, and the column where it would appear says so.

R10's missing half also landed: `PUT`/`DELETE` on providers and assistants, plus
`/default`. **`type` is not editable** (it decides which adapter and what each
field means), an **empty `apiKey` is refused** rather than blanking a key,
**exactly one default** is enforced in one transaction, and deleting a provider
**does not cascade** to the assistants pointing at it.

### LP.13 — analytics, and the number that was computed nowhere

**The confirmation rate did not exist on this platform.** Not on the dashboard,
not on any screen, not in any route — while the legacy leads its dashboard with
it and recomputes it across seven dimensions. It is what a COD call centre is
managed by, and two agents at 40% and 75% looked identical on every screen.

`GET /api/erp/analytics` + `/console/erp/analytics`: headline figures plus seven
breakdowns (status · channel · product · wilaya · agent · **marketer/source** ·
delivery status), each a `groupBy` rather than the legacy's whole-book-in-a-
browser. **N20 closes here** — `marketer`/`source` were written by the channel
webhooks and read by nothing, so ad attribution was uncomputable.

**Three properties that are easy to get plausibly wrong:** orders count by
`createdAt` and parcels by `deliveryOutcomeAt` (a March order delivered in April
belongs to both months, in different columns); **N19 is answered by reporting
BOTH revenue figures and calling neither of them "revenue"** — confirmed value is
what was agreed, delivered value is what was collected, and the page says so;
and "never called" asks the `calls` relation, because three failed attempts is
not the same state as none and a status count cannot tell them apart.

**Scoping is the list's.** `erp:orders:read` + `scopedWhere`, so an agent gets
their own queue's analytics; the BY-AGENT table needs `erp:agents:manage`,
because a league table of colleagues is supervision data (the rule LP.6 applies
to its `agents` export).

**The dashboard gets three of the four reaction-time figures back (N18):** the
confirmation rate under the confirmed count, a never-called tile, and an overdue
BANNER judged against the tenant's own `alertMinutes`. In-delivery, delivered and
customers stay — they were a real gain.

### LP.7 — the notification provider, and the two defects it found

**M-16's entire transport had no consumer.** Storage, the audience resolved at
write time, an SSE stream with exact replay, Web Push, a service worker, 33
passing tests — and no bell, no badge, no panel, no toast anywhere in the
console. A signed-in operator was never told anything.

`components/console/notification-provider.tsx` is mounted **once**, in the shell,
and owns exactly three things: the badge (whose count is the SERVER's, re-read on
every render — an in-memory counter is wrong the moment a second tab marks
something read), a toast per LIVE arrival (replayed frames do not toast; fifty on
reconnect hide the one that matters), and a **debounced `router.refresh()`** so a
burst of carrier events costs one re-render. It merges nothing into any list:
that would be a second copy of the truth in the browser, and D-06.3 exists
because a confirmed call is money.

**Defect 1 — a fresh subscription replayed the whole backlog as LIVE.** An empty
cursor meant "from the beginning", so every page load sent up to 50 historical
notifications flagged `replayed: false`. Invisible while nothing consumed the
stream; a burst of toasts for last week's news the moment something did. A client
with no `Last-Event-ID` has just been server-rendered with the current state and
is subscribing for what happens NEXT — `newestNotificationId()` starts it there,
and a resumed connection is untouched.

**Defect 2 — `POST /api/erp/orders` answered 500 in every seeded tenant.** Found
by creating an order as `manager@demo.test`: `P2002` on `(tenantId, reference)`.
The seed writes ORD-0001…ORD-0006 directly and never touches `TenantSequence`, so
the counter started at 1 and the first console-created order collided —
permanently, walking up through every seeded number. **Not a seed problem:** any
path that writes a reference without `nextReference` leaves the counter behind
(a migration, a restore, the CSV import still on the roadmap). Catching the P2002
is not available — a unique violation aborts the whole Postgres transaction and
every caller is already inside `withTenant`'s — so `nextReference` heals itself
from the highest reference already in use, counting **only** references this
scheme could have minted (`INV/2024/17` must not move it).

### LP.16 — the P&L calculator, and the four defects it closed

**Every gap LP.0c measured (§7 P1–P7) is implemented**, in four steps, plus a
fourth defect the port itself found. `test/erp/finance.test.ts` is new at
**38/38**; `test/calc.test.ts` is new at **20/20** and is the **first pure suite
in this app** — no server, no database.

**The three defects that were live wrong answers, not missing features:**

1. **A `™` cost a product all of its revenue.** `sales-summary` matched orders
   with exact string equality. It now goes through `lib/erp/product-match.ts`:
   the channel's `CatalogProductLink` first — **exclusively**, so a linked order
   is refused by name-matching rather than double-counted — then a normalised
   name. Accents are deliberately NOT normalised: attributing `Café`'s revenue to
   `Cafe` is worse than a zero, because it looks right. **And the same line hid a
   second failure**: a catalogue row with a NULL name passed `product: undefined`
   to Prisma, which is not a filter, so a nameless product reported the whole
   book's revenue.
2. **Every saved P&L was missing its rent.** `fixedCosts` had no editor anywhere.
   Two now exist — a list editor and a map editor in
   `components/console/erp/settings-structured.tsx` — and the automation screen's
   type filter is untouched, because the filter was right and the editors were
   the gap. `defaultCarrierByChannel` got its editor **and its first reader**
   (`planShipment` resolves order code → channel default → tenant default), so
   N23 closes whole and R20's default-carrier half with it.
3. **`periodType` was echoed and never used.** `lib/erp/prorate.ts` is now the
   one rule — month unchanged, week ÷4, quarter ×3, year ×12, day ÷ that month's
   real length, anything else ÷30.44 × days — and **both payroll routes share
   it**, because a rent and a salary scaled onto the same week were coming out at
   different fractions of a month.

**D-LP.16.1 — the fourth defect, found by porting: the legacy's saved record
disagreed with its own screen.** `calcAll` subtracts incidents (returns +
exchanges + losses) from every product's profit and shows the result; the POST
sends six cost lines that do not include them, because `FinancialRecord` has no
incidents column. The stored `netProfit` therefore came out HIGHER than the
banner by exactly the incident total — one period, two answers, and the permanent
one was the optimistic one. Incidents are folded into `productCosts` here, and
`test/calc.test.ts` asserts both the new agreement and the size of the old
overstatement.

**Why `÷4` for a week is load-bearing and not arbitrary:** four saved weeks must
tile into exactly one month, because `aggregate` builds a month by SUMMING four
weekly records. Day-counting gives `0.92 × month` — an 8% under-charge of fixed
costs on every aggregated month, invisible because each number looks plausible.

**D-LP.16.2** the calculator is its own nav item (`/console/erp/calculator`),
gated on `erp:finance:read`; the legacy served it as a static HTML file with no
authorization on the page at all. **D-LP.16.3** `alignedRange` (Monday-to-Sunday)
is a SECOND vocabulary beside `orderFilters`' rolling `range=week`, deliberately
— the tiling needs the aligned one and "what came in recently" needs the rolling
one.

**`src/lib/money.ts` is exact decimal arithmetic that runs in a browser**
(scaled `bigint`), because the legacy calculator is `Number(...)` end to end and
its output is filed as a company's permanent record of a month. The arithmetic
lives in `src/lib/erp/calc.ts` rather than in the component so `node --test` can
reach it: a `.tsx` module cannot be imported by the type stripper, and maths only
reachable through rendered HTML is how a rounding error survives review.

### LP.0c — the P&L calculator measured, and two defects it found

**`LEGACY_PARITY.md` §7** is the 1,244-line legacy calculator read line by line
against the platform's finance surface. No code changed. Seven gaps, and R9's
"the API half is largely there" corrected: `sales-summary` **cannot answer two of
the five questions** the calculator's sync asks it, and its `avgBuyPrice` folds
packaging in where the legacy keeps it separate — so filling one from the other
**double-counts packaging**.

**Two defects live in shipped code, neither needing a calculator to hurt:**

1. **A product whose name carries a `™`, a non-breaking space or different
   casing from its orders reports ZERO revenue.** `sales-summary` matches with
   `where: { product: product.name }` — exact string equality — where the legacy
   matched by external product id first, then by a normalised name.
   `/console/erp/products` renders that zero today. BUG-02's exact shape.
2. **Every saved P&L record is missing its rent and salaries.** `fixedCosts` is
   declared and summed by `prorate-fixed`, and **nothing writes it** — the
   automation screen correctly excludes array settings and no other screen offers
   one, so the prorated figure is always zero, which reads as "there are none".

**And the finding that explains an "arbitrary" legacy rule:** the legacy prorates
÷4 for a week and ×3/×12 for a quarter/year so that **four saved weeks tile into
exactly one month**, because `aggregate` builds a month by summing them. The
platform's `monthly/30.44×days` gives `0.92 × monthly` for four weeks — an 8%
under-charge every aggregated month. Both formulas are needed, keyed on
`periodType`, which the platform's route accepts and ignores.

Slice 16 becomes four steps (§7.4), and **16a is worth pulling forward on its own
merits** because defect 1 is a wrong answer on a screen that already ships.

Phase 8's two guarantees (`CSRF_ORIGIN` and rate limiting) remain owed and are
Tier 4 of the same roadmap — the legacy system had both, so they are a parity
item as well as a hardening one.

### Phase 7.3 — landed (GLM-5.2)

Self-serve signup — `POST /api/platform/signup` + `/console/signup`. The first
PUBLIC, unauthenticated write path. `test/platform/signup.test.ts` is new at
10/10. A signed-out visitor creates a tenant, becomes its OWNER, and lands in
their console with a TRIALING subscription (both products).

**R-08 closed:** the reserved-slug list (`isReservedSlug`) already guarded the
storefront read path; this slice enforces it at CREATION — the half the schema
comment promised but no route implemented. A reserved slug (`api`, `console`,
`login`, …) is refused with `RESERVED_SLUG` before `tenant.create`.

**Four writes, two binding contexts:** Tenant + User via `asPlatform()` (no
RLS), Membership + Subscription via `withTenant(newTenantId)` (RLS-scoped, one
transaction). The new owner lands signed in (session cookie set, like login).

**Verified live:** signup 10/10 · team 56/56 · billing 19/19 · access 63/63 ·
console-shell 13/13 · i18n 18/18. Build clean. End-to-end: POST → 201, cookie
works, storefront live.

### Phase 7.2 — landed (GLM-5.2)

Billing management — `GET /api/platform/billing`, `PUT /api/platform/billing/
entitlements`, and `/console/settings/billing`. `test/platform/billing.test.ts`
is new at 19/19. The domain was already done (`Subscription` + every gate reading
it fresh); this is the management half.

**The load-bearing test:** drop `product.erp` and every ERP route 403s on the
very next request — same session, no re-login, because `resolveSession` re-reads
the subscription every call. Add it back and access returns just as fast. This
is the whole value of the slice, verified live.

**Unknown entitlements are refused** (validated against the registry), not
silently stored. **SENSITIVE and not entitlement-gated** — a company whose
subscription lapsed still manages its own billing (otherwise a bounced invoice
removes the ability to fix it). **No payment provider** — a Stripe webhook is a
second slice that writes the same row.

**Verified live:** billing 19/19 · team 56/56 · access 63/63 · console-shell
13/13 · i18n 18/18. Build clean.

### Phase 7.1c — landed (GLM-5.2)

`/console/settings/team` renders the company's people and its outstanding
invitations, with write controls calling the routes 7.1a built (D-06.1) and
rendered only where the API accepts them (D-06.2). Gated on `platform:team:read`
(SENSITIVE — a MANAGER gets 404). The write surface is gated again on
`platform:team:write`, so a reader sees the list with no controls.

**Every refusal the API makes is unreachable from the screen**, because the
control that would trip it is not rendered: the owner row has no
suspend/remove/role-change (`OWNER_IMMUTABLE`); the actor's own row has none
(`SELF_TARGET`); a member above the actor's ceiling has no role-change
(`ROLE_ABOVE_SELF` — `grantableRoles` is strictly ceiling-filtered, empty when
the member ranks above the actor); an accepted invitation has no revoke
(`ALREADY_ACCEPTED`). These are computed server-side and passed to the client,
which holds no permission logic.

**Two bugs the tests caught:** the first build rendered the role-change control
for an above-ceiling member (the list included the member's current role "so the
select shows it selected" — wrong, that's still a control the API refuses). The
second gated revoke on `invitation.path`, but the list carries no token so the
button never rendered. Both fixed; see CHANGELOG §7.1c.

**Verified live:** team 56/56 · access 63/63 · screens 96/96 · console-shell
13/13 · i18n 18/18 · auth 36/36 · product-registry 36/36 · db 29/29. Build clean.

### Phase 7.1b — landed (GLM-5.2)

The load-bearing change was RLS: a second, narrower `FOR SELECT` policy on
`Invitation` (`tenant_isolation_token`) plus a `withInvitationToken(token, work)`
binding in `packages/db` — the `Membership` `_self` pattern applied to a token.
The join flow resolves a token *before* any tenant is bound, and an unbound
`asPlatform().invitation.findUnique({ where: { token } })` returns zero rows
silently (RLS denies by returning nothing). The binding opens exactly the one row
whose token was presented and nothing else. Verified live before anything was
built on it.

**One design question, resolved:** the accepter need NOT be signed in as the
invited address — the 32-byte token is the claim. This slice does NOT create a
`User` for an address that has none (that is 7.3 self-serve signup); it refuses
with `ACCOUNT_REQUIRED` instead. Accepting creates a `Membership` only.

**Refusals are uniform across the oracle surface:** unknown / expired / revoked /
deleted-tenant tokens all answer `404 INVITATION_NOT_FOUND`, because
distinguishing them turns the endpoint into an oracle for which addresses have
been invited. `ALREADY_ACCEPTED`, `ACCOUNT_REQUIRED` and `ALREADY_MEMBER` are
distinct (the caller already holds the token).

**The acceptance endpoint is an API route, not a server action.** A server action
was tried first and failed: Next.js server actions are dispatched through a
`Next-Action` header and are not HTTP-addressable, so they cannot be
contract-tested over `fetch`. `POST /api/platform/invitations/[token]/accept` is
a plain route (not `tenantRoute`) — the same shape as every other write surface
(D-06.1). The page's accept button calls it via a small client component.

**Verified live:** team 47/47 · access 63/63 · website-builder 102/102 · i18n
18/18 · auth 36/36 · product-registry 36/36 · db 29/29 · preflight 9/9. Build
clean. Full reasoning in CHANGELOG §7.1b.

### Next recommended task — Phase 7.1b, measured (GLM-5.2)

### Next recommended task — Phase 7.1b, measured (GLM-5.2)

**Verification status of this measurement (GLM-5.2, commit `1aab962`):** measured
against the live Neon database and the committed source, not inferred. Working tree
clean. No code written yet — this is the design end of the slice, stopped at the safe
boundary before implementation.

**Decisive live finding.** `Invitation` has exactly one RLS policy — `tenant_isolation`
(`FOR ALL`, `USING` + `WITH CHECK` on `"tenantId" = current_setting('app.tenant_id')`),
`ENABLE` + `FORCE` both on. **There is no token-based policy.** Therefore
`asPlatform().invitation.findUnique({ where: { token } })` returns zero rows silently
(RLS denies by returning nothing), which is the exact failure the 7.1a changelog warned
about. The fix is the pattern `Membership` demonstrates:

- a second, **narrower** policy on `Invitation` — `tenant_isolation_token`,
  `FOR SELECT USING ("token" = current_setting('app.invitation_token', true))`;
- a `withInvitationToken(token, work)` binding in `packages/db/src/tenant-client.ts`,
  alongside `withUser`, binding `app.invitation_token` via `SET LOCAL`;
- the policy's `CREATE` added to `packages/db/scripts/apply-rls.ts` beside the
  `Membership` `_self` block, so it survives `npm run rls` and is idempotent;
- the binding exported from `packages/db/src/index.ts`.

**Safe to add — verified:** `preflight.ts`, `apply-rls.ts`'s audit, and
`isolation.test.ts` all key off the literal policy name `tenant_isolation`, so a
separately-named `FOR SELECT` policy will not affect their counts. Postgres ORs
permissive policies, so token-resolution opens exactly one row and nothing else, the
same property `withUser` gives for `Membership`.

**The resolved design question (the one real one in this slice).** *Must the accepter be
signed in as the invited address?* — **No.** Possession of the 32-byte token IS the
claim, exactly as the 7.1a changelog already reasoned ("the invitation carries a role,
not an identity"). Forcing a signed-in session that matches the email would (a) require
creating a `User` for an invitee who has none, which is 7.3 self-serve signup and must
not be half-built, and (b) offer no real security gain over the unguessable token. So:

- **GET `/console/join/[token]`** renders for a signed-out visitor, shows who is
  inviting, to which company, in what role. It resolves the invitation via
  `withInvitationToken` (NOT `asPlatform`), so a bad/expired/revoked token is refused
  **identically** — see NEXT_STEPS §7.1b for the refusal vocabulary.
- **POST `/console/join/[token]`** accepts. It creates a `Membership` only. If the
  invited address already has a `User`, the membership is attached to it (one person,
  many companies — the seeded consultant's case). If no `User` holds the address, the
  slice **refuses with a stated code** and does not create one — that is 7.3.
- The route **must not use `tenantRoute`** (it requires a session + active tenant and
  binds `withTenant`). It is a server component page (`page.tsx`) like
  `/console/login`, optionally reading `getConsoleSession()` to show a "signed in as X"
  banner but never requiring it.

**Idempotence, restated from 7.1a:** accepting twice produces one membership, guarded
by `acceptedAt` (precedence `accepted > revoked > expired > open`, from
`invitationState`). A token for a soft-deleted tenant is refused like every other bad
token — the tenant read goes through the same binding and returns nothing.

### Decisions taken in Phase 7

- **D-07.1.** `OWNER` is not a role the team API hands out. A tenant has exactly
  one owner and the schema states it in a comment rather than a constraint, so an
  assignable OWNER would silently produce two — both holding `*`, neither
  removable. The invariant is held by the vocabulary (`ASSIGNABLE_ROLES`) rather
  than by a count query that races itself. Ownership transfer is a separate,
  deliberate operation and is not built.
- **D-07.2.** Suspending a member does **not** destroy their sessions.
  `resolveSession` re-reads the membership every request and `can()` refuses a
  suspended context, so the flag alone takes effect on the next call — the exact
  property M-09 bought. `destroySessionsForUser` is keyed on the *user*, and one
  person belongs to many companies, so using it here would sign a consultant out
  of an unrelated employer.
- **D-07.3.** An invitation token is returned **once**, by the call that creates
  it; the list carries state and never the secret. Same rule as a raw session
  token. Recovery for a mislaid link is revoke-and-reinvite, which mints a new
  one.
- **D-07.4.** Nobody may act on their own membership through the team surface —
  no self-promotion, self-suspension or self-removal. Leaving a company is a
  different operation and belongs to the person, not to a row in a list of
  colleagues.
- **The owner cannot be demoted, suspended or removed by anybody**, themselves
  included. There is deliberately no "last administrator" check, because the
  unremovable owner already guarantees somebody holds `*`.
- **Team management is not entitlement-gated.** `productOf("platform:…")` is null,
  so a lapsed subscription still leaves a company able to manage its own people —
  otherwise a bounced invoice removes the ability to remove whoever stopped
  paying.

---

## Architecture

```
landingos/                        (repo root = npm workspace)
├── apps/
│   ├── erp/                      Express + SQLite. Still runnable; being ported.
│   └── website-builder/          The Next.js app — hosts the whole platform
├── packages/
│   ├── db/                       Prisma schema, tenant client, RLS, seeds
│   ├── auth/                     Sessions, passwords, RBAC
│   ├── product-registry/         The product-module contract
│   ├── ui/                       Console design tokens + status vocabulary
│   └── i18n/                     ar/fr/en catalogues, direction, formatters
└── services/                     (empty — the Phase 5.5 worker lands here)
```

> **Naming note.** `apps/website-builder` now hosts the *entire platform* —
> console, storefront and platform APIs — not just the builder product. The
> directory name is historical. Renaming it to `apps/web` is cosmetic and
> deferred; do it in Phase 6 when the ERP UI arrives, if at all.

### Route structure inside `apps/website-builder`

```
src/app/
├── console/                  Authenticated console. Platform session.
│   ├── login/                Sign-in (platform, opaque session)
│   ├── page.tsx              Product picker / auto-redirect if one product
│   ├── settings/             PLATFORM settings: profile, store, delivery, integrations
│   ├── builder/              The website-builder product's screens
│   └── [product]/            GENERIC fallback — serves any product with no screens
├── (storefront)/[tenant]/    Public, anonymous, customer-facing
│   ├── page.tsx              Storefront homepage
│   ├── [slug]/               A published landing page
│   ├── category/[slug]/
│   └── thank-you/[orderId]/
└── api/
    ├── builder/              Console API for the builder product
    ├── platform/             Cross-product surfaces (integrations, notifications, push, team)
    ├── storefront/[tenant]/  Public API — checkout, wilayas, drafts, pixels
    ├── health/               Deploy healthcheck
    └── uploads/[...path]/    Serves uploaded images
```

**There is no middleware.** It was deleted with the legacy JWT. Authentication
happens in server components and in the `tenantRoute` wrapper.

---

## Database

**PostgreSQL 18.4 on Neon.** One database, one Prisma schema, three domains.

- **52 tables**, 161 indexes, 8 enums (LP.18 added three columns to `CatalogProduct`)
- **47 tables carry `tenantId`** and have RLS
- **5 do not, by design:** `Tenant`, `User`, `Session` (identity — resolved
  before a tenant is known) and `Wilaya`, `Baladia` (platform reference data)
- **37 `numeric` money columns, 0 `double precision`**

Schema lives in `packages/db/prisma/schema/` — split into `main`, `platform`,
`builder`, `erp` (multi-file schema, supported natively).

### Two Neon PROJECTS — dev and prod, and both databases are named `neondb`

**Since 17 Aug 2026, development and production live in different Neon
projects.** Dev is `ep-gentle-sky-b1rahhl0` (database `neondb`); production is
`landingos_prod` inside `ep-summer-shadow-a2ks6nf8`, which is **suspended on
its compute quota and off-limits to development activity** by the user's
instruction — dev work used to spend that project's compute, which is why the
split exists.

**⚠️ Identify a database by HOST, never by name.** The old dev database and the
new one are both called `neondb`; anywhere in this file that says "`neondb`"
without a host means the OLD project's dev database. The dev project was built
fresh by the recipe in `apps/website-builder/DEPLOY.md` — RLS 49/49, 58 wilayas
/ 537 baladias, preflight all-PASS, **0 tenants and 0 users (no `seed:demo`)**.

### Two database roles — this matters

| Role | Env var | Endpoint | Purpose |
|---|---|---|---|
| `neondb_owner` | `MIGRATE_DATABASE_URL` | **direct** | Migrations and DDL only |
| `landingos_app` | `DATABASE_URL` / `PLATFORM_DATABASE_URL` | **pooled** | Everything the app does |

**Why:** `neondb_owner` carries `BYPASSRLS`. A role with that attribute ignores
row-level security entirely — `FORCE` does nothing and policies are never
consulted. Running the app as the owner would make every policy decorative and
the isolation suite would pass while enforcing nothing.

The endpoint split matters too: the app must use the **pooler** (the direct
endpoint has a hard connection cap), migrations must use the **direct**
endpoint (the pooler multiplexes sessions and breaks advisory locks / long DDL).
Getting this backwards presents as intermittent "Can't reach database server"
that looks exactly like a flaky test.

`packages/db/scripts/setup-roles.ts` provisions and verifies all of this and is
idempotent.

---

## Tenant isolation — three layers

1. **`tenantId` column** on every business table, every compound index leading
   with it.
2. **Bound client** — `withTenant(tenantId, fn)` / `forTenant(tenantId)` in
   `packages/db/src/tenant-client.ts`. Opens a transaction and binds
   `app.tenant_id` via `set_config(..., true)` — i.e. `SET LOCAL`, so it cannot
   leak onto a pooled connection.
3. **Postgres RLS** — `tenant_isolation` policy on all 46 scoped tables, with
   both `USING` **and** `WITH CHECK`, plus `FORCE ROW LEVEL SECURITY`.

### Non-obvious things that took work to get right

- **`WITH CHECK` is not optional.** A `USING`-only policy governs visibility,
  not writes: tenant A could `INSERT` a row stamped with tenant B's id —
  invisible to A afterwards, very visible to the victim.
- **`Membership` has a second policy.** Resolving a session means reading which
  tenants a user belongs to, but a tenant cannot be bound before the memberships
  that *name* it are read — circular. Postgres ORs permissive policies, so
  `Membership` is visible *within its tenant* **or** *to the user it belongs to*
  (read-only). `withUser(userId, fn)` is the only thing that opens it.
- **`withTenant` is already a transaction.** Prisma does not nest, so the client
  it hands back has **no `$transaction`**. Sequential statements inside it are
  already atomic. Calling `$transaction` inside it throws at runtime.
- **Interactive transactions pin a connection.** Every tenant-bound request is
  one. `TX_OPTIONS` (`maxWait: 10s, timeout: 15s`) exists because Prisma's
  defaults (2s/5s) throw `P2028` → 500 under ordinary load.

---

## Authentication and authorization

**Opaque, revocable, server-side sessions.** Not JWTs. Only the SHA-256 of the
token is stored, so a database leak cannot be replayed.

**The reason** (and it should not be traded away): suspending a team member must
revoke access *immediately*. With a stateless 7-day token, a dismissed employee
keeps working access for a week. In a product whose headline feature is team
management, that is a daily operation.

**The accepted cost:** resolving a session needs a database read, so auth cannot
run in Edge middleware. It runs in server components (`requireConsoleSession`)
and in the `tenantRoute` wrapper.

**Passwords:** argon2id via `@node-rs/argon2` (prebuilt, no node-gyp). Verifies
the ERP's legacy `scrypt$...` hashes too, and upgrades them on login, so ERP
agents keep working through the Phase 5 cutover.

### Authorization — three gates, in this order

1. **Entitlement** — does the tenant's subscription include the product this
   permission belongs to? *Checked first,* so a downgrade removes access without
   anyone editing a role.
2. **Role** — `OWNER`, `ADMIN`, `MANAGER`, `MEMBER`, `VIEWER`, as glob patterns.
3. **Explicit grant** — extra permissions on the membership.

Permissions are `product:resource:action` and the prefix **must exactly match a
registered product id**, or `productOf()` resolves to nothing and the permission
silently skips the entitlement gate.

---

## Product registry

`packages/product-registry` defines what a product *is*: id, i18n name keys,
icon, base path, billing entitlement, declared permissions, navigation, status.

- Manifests are validated at construction — duplicate id, base path or
  entitlement throws at boot rather than surfacing later as one product
  shadowing another.
- `CONSOLE_PREFIX = '/console'`. A manifest declares only its own segment
  (`/builder`); `hrefFor()` composes the two. **A product never learns the prefix
  exists.**
- The generic `console/[product]` route serves any product that ships no screens
  of its own — the ERP today is a manifest and literally nothing else, and it
  renders a full navigation.
- A product **may** supply its own index (the builder does); a static segment
  simply wins over the dynamic one.

Adding a product = adding a manifest + its own screens. No platform file changes.

---

## Key architectural decisions

| Decision | Reasoning |
|---|---|
| **Products under `/console`, tenants at the root** | Forced: `/[tenant]` and `/[product]` are both single dynamic root segments and Next rejects the ambiguity outright. Between a customer-facing URL and an internal one, the customer keeps the root. Bonus: tenant slugs no longer share a namespace with product paths, so a tenant *can* be called "builder". |
| **Path prefix + custom domains** (decision D2) | `landingos.app/acme/product`, or a tenant's own verified hostname. A custom domain **wins** over a path prefix — honouring a prefix on someone's own hostname would let anyone serve another tenant's shop from that company's address. |
| **Opaque sessions over JWT** | Immediate revocation. See above. |
| **Entitlement checked before role** | Ties authorization to billing; a lapsed subscription takes effect without touching memberships. |
| **`SalesOrder` / `FulfillmentOrder`** | Both products had `Order` and one schema cannot hold two. The builder's is an immutable commercial snapshot; the ERP's is a mutable operational record. **Only the names landed** — the relationship and the in-process domain event are Phase 5.4 (M-05). |
| **Two design systems** (decision D3) | `packages/ui` is the console identity, fixed for every product. Storefront themes are per-page and tenant-chosen. They must **never** share tokens: a tenant restyling their shop must be incapable of touching the console. |
| **The ERP's palette became the dark theme** | Resolving R-14 without discarding the ERP's identity. Its violet also survives in light as "in progress". |
| **Trilingual from the start** (decision D4) | Arabic default, French, English. CSS logical properties everywhere; direction declared once on `<html dir>`. |
| **`asPlatform()` is named, not default** | Unscoped access must be greppable and obvious in a diff. |

---

## Migrations completed

| id | Migration |
|---|---|
| M-01 | Platform tables: Tenant, TenantDomain, User, Membership, Session, Invitation, Subscription, AuditEvent, Notification, ProductSetting |
| M-02 | Identity rewrite — `agents.name` (TEXT PK, referenced by value in ~100 places) → `userId` |
| M-03 | `tenantId` on 46 tables, indexes leading with it |
| M-04 | Every unique constraint rescoped, each with a recorded decision in `packages/db/CONSTRAINTS.md` |
| M-06 | SQLite → Postgres: `REAL`→`Decimal`, epoch-ms→`DateTime`, `0/1`→`Boolean`, JSON-text→`Json` |
| M-07 | RLS policies, `FORCE`, `USING` + `WITH CHECK` |
| M-09 | JWT → opaque sessions (middleware left the Edge runtime) |
| M-10 | scrypt/bcrypt → argon2id with legacy verification |
| M-13 | Console design tokens |
| M-18 | ERP test port — 227 tests to `/api/erp/*`, executable ahead of the routes |
| M-21 | `TenantSequence`, cuid keys and per-tenant `reference` (D-05.2, D-05.3) |
| M-11 | The ERP's routes → `/api/erp/*`, in vertical slices |
| M-05 | `SalesOrder` ↔ `FulfillmentOrder`, and the Builder→ERP domain event |
| M-17 | Public routing → `/[tenant]/[slug]` + `TenantDomain` |
| M-20 | Trilingual i18n |
| — | Builder API + all screens ported; legacy stack deleted |

| M-15 | Jobs → `services/worker`: idempotent job functions, a manager trigger, and a scheduler holding no logic |

**Not yet done:** M-12 (ERP UI — 6.3/6.4 have delivered it bar the retirement),
M-14 (ERP base64 images → R2), M-16 (notification unification), M-19 (template
registry).

M-15 discharged its debt to M-18: `overdue-sweep.test.js` is superseded by
`test/erp/jobs.test.ts`, which asserts the same behaviours plus the idempotence
a scheduled job needs and an in-process timer never had. **M-16 still owes
`notifications.test.js` (~20 tests)** — porting it against a transport that does
not exist would encode a contract nobody has designed.

---

## Legacy still remaining, and why

**`apps/erp`** — the entire ERP: Express, SQLite, 27 tables, 126 routes, a
4,949-line vanilla SPA and a 1,261-line agent PWA. Completely untouched and
still runnable standalone. It is the subject of Phases 5 and 6.

As of 6.3d the **manager console it serves is fully superseded** — every screen
and every mutation exists on the platform with a contract test on it. 6.4a
ported the agent's working queue.

### What still prevents retiring `apps/erp` — the assessment

Every surface of `agent.html` (1,172 lines) and of the manager SPA was measured
against the platform. **The answer is no, not yet** — and the reasons are not
the ones this section listed before 6.4c.

| Feature | Platform state | Blocks deletion? |
|---|---|---|
| Manager console — all twelve screens, every mutation | Ported, 339 contract tests | No |
| Agent queue, call loop, notes, filters, parcel line | `/console/erp/queue` (6.4a–b) | No |
| Resolve a follow-up task | **Ported in 6.4c** — `POST /api/erp/followup/tasks/[id]/resolve`, 7 contract tests | No |
| Agent login screen, stored server URL | Nothing to port to — the session is a cookie on this origin | No |
| AI assistant | `ai/chat`, `ai/chat/stream`, `ai/insights/deep` answer **501 by design**. Gated first, so the authorization contract is complete. | No |
| Raising a follow-up task | **Ported in 6.5a** — `raiseFollowupTask` on the `ingestEvents` choke point, 6 contract tests | No |
| Auto-assigning a follow-up agent | **Ported in 6.6a** — `autoAssignFollowup`, behind `followupAutoAssign`, on both confirm paths | No |
| Auto-assigning a new order | **Ported in 6.6a** — `autoAssignOnCreate`, behind `autoAssign`, on all three creation paths | No |
| Escalation, the overdue sweep, missed-order counting, auto-suspend | **Ported in 6.5b (M-15)** — idempotent jobs plus `services/worker`, 14 contract tests | No |
| Auto-reassign an overdue order | **Ported in 6.6a** — behind `autoReassign`, to the least-loaded eligible agent or to the unassigned queue | No |
| Polling carriers on a timer | **Ported in 6.6b** — `pollCarriers`, driven by `trackingPollMinutes`, guarded by `Shipment.lastPolledAt`, going through the same `ingestEvents` a webhook does | No |
| Reserving stock on confirmation | **Ported in 6.6f** — `reserveOnConfirm` / `releaseOnCancel` on both doors into `confirmed`, honouring `reservationMode`, idempotent by the ledger, restoring to the lots the reservation consumed. 9 contract tests. | No |
| Notifications and Web Push | **M-16 complete (6.6c–6.6e)** — `/api/platform/notifications`, a live SSE stream with exact replay, Web Push sending, and the service worker that receives it. 33 contract tests. `notifications.test.js` is discharged. | No |
| Service worker and installability | **Done in 6.6e** — manifest, icons, a registered worker, and the `push`/`notificationclick` handlers Web Push needs to be received. **No offline shell, deliberately**: every console page is session-scoped, and a cache keyed by URL survives signing out. | No |

**Why these keep being invisible.** Every one of them is a Phase 5 porting gap,
not a Phase 6 regression, and every one is **code that runs between routes**: a
producer on the carrier-ingest path, a jobs loop, an assignment rule, a stock
movement on a status change. Contract tests over HTTP attack endpoints, and an
endpoint that answers correctly while a side effect nobody asked for silently
does not happen is exactly what they cannot see. Each has surfaced by building
the thing at the far end of it — which is the argument for finishing the
consumer side before declaring a port complete.

**One consequence to note before deleting.** `apps/erp` is also the source
`overdue-sweep.test.js` (~12 tests) and `notifications.test.js` (~20) would be
ported *from* — PORTING.md defers them with M-15 and M-16 and says explicitly
they must be ported, not abandoned. After deletion they are recoverable only
from git history.

## Verdict as of 6.6f: **YES — with nothing outstanding that keeping it would fix**

Every behaviour `apps/erp` has is on the platform, and both deferred test files
are discharged rather than abandoned:

| What it was | Where it went |
|---|---|
| `overdue-sweep.test.js` (~12) | superseded by `test/erp/jobs.test.ts` (16) |
| `notifications.test.js` (~20) | superseded by `test/erp/notifications.test.ts` (33) |
| SSE half of `delivery-outcome.test.js` | covered by the same file |

**The three things that are still true, and none is caused by deleting it:**

1. **No cross-origin state-change refusal, and no rate limiting.** Both were real
   and tested in the ERP; both left the product suite in 5.1 because neither
   belongs in one. They were never on the platform, so keeping `apps/erp` running
   does not give them to it — it only means a second, unrelated application also
   has them. Phase 8 work either way.
2. **Web Push has never crossed a real push service**, and whether a browser
   OFFERS the install prompt needs a real device over HTTPS. Nothing is deployed,
   so both are untested by construction rather than by omission.
3. **The AI assistant answers 501 by design** — calling a model is deployment
   configuration, and it is gated first so the authorization contract is complete.

**What deleting it costs, stated plainly:** 298 tests of an Express + SQLite
stack that no longer runs anything, and the reference implementation for
everything ported since Phase 5. Both stay reachable in git history. The
directory has been read end to end four times during this port — 6.4a for the
agent PWA, 6.5a for the follow-up producer, 6.6a for assignment, 6.6f for the
in-process timers — and each read found something. That is worth weighing before
the last copy goes behind a `git show`.

**DECISION, taken after the 6.6f reassessment: `apps/erp` STAYS, for now.**

It is kept deliberately as the **reference implementation**, not because anything
depends on it. The reasoning is the last paragraph above: four separate end-to-end
reads of that directory during this port each turned up something the platform was
missing, and Phases 7 and 8 will read it again — billing and team management touch
`agents`, `sessions` and the settings surface, and hardening needs its rate
limiter and its `CSRF_ORIGIN` check as worked examples.

**Re-assess after Phase 7, Phase 8 and production readiness are complete.** At
that point the platform will have been exercised against every question the ERP
can answer, and the directory will have stopped being useful — which is the right
moment to delete it, not before.

Nothing in the platform reads it, imports from it, or needs it running. It costs
one workspace entry, `better-sqlite3` in `allowScripts`, and 298 tests in the
aggregate count. The deletion checklist is in NEXT_STEPS §2c for whenever that
moment comes.

**Nothing else.** The legacy dashboard, legacy storefront, legacy JWT, legacy
middleware and the pre-tenant Prisma client were all deleted in `82dacc9`.

---

## Known technical debt

1. **`(db as any)` casts throughout the ported routes.** Needed to reach models
   dynamically on the transaction client, but they defeat type checking — they
   are what hid the nested-`$transaction` bug until runtime. Worth a typed
   accessor.
2. **`apps/website-builder` is misnamed** — it hosts the whole platform.
3. **Windows Prisma DLL lock** — building while the dev server runs fails with
   `EPERM`. Stop node first.
4. **Stock does not move on confirmation or cancellation.** The ERP's
   `reservationMode` drove `decrementOnConfirm` / `releaseOnCancel`;
   `applyMovement` on the platform has one caller, the manual adjust route. The
   setting is rendered by the automation screen and read by nothing. Found in
   6.6a while building the shared confirm path — it is the one gap that blocks
   retiring `apps/erp` without a functional regression.
5. **No template registry yet (M-19).** The storefront has one hardcoded
   template with colour-only themes; `/api/themes`-style branching on
   `isLuxury`/`isTech` was noted in Phase 3.2 and still stands.
6. **ERP images are base64 in the database** (M-14), which is why its JSON body
   limit is 25 MB.
7. **`toPreviewState` vs `toLandingPageData`** are easy to confuse — the editor
   and the public template take different shapes. Passing the wrong one compiles
   and throws at render.

---

## Known bugs and limitations

1. **Full-workspace `npm test` is intermittently red.** Always
   `Can't reach database server` (`P1001`) against the free-tier Neon instance
   when several suites run back to back. **Every suite passes reliably alone.**
   Root causes already fixed: wrong endpoint, tiny pools, tight transaction
   timeout. The residue is capacity. A paid instance or a local Postgres would
   remove it.

   Observed repeatedly in 6.3 and worth knowing: **the first run right after
   `builder:start` is the likeliest to trip it**, because the freshly started
   server and the test process open their pools at the same moment. It also
   surfaces as a **500 from a screen**, not only as a test-harness error — check
   the server log for `P1001` before believing a page has regressed.
2. **Uploads fall back to local disk** when R2 is unconfigured — reported by
   `/api/health` as `local disk (not durable)`. On an ephemeral host, images
   vanish on restart.
3. **Docker image unverified.** Docker is not installed on the development
   machine. The Dockerfile was rewritten for the workspace and every `COPY`
   source was checked, and `npm ci --workspace` was run locally, but the image
   has never been built.
4. **The concurrency isolation test runs in waves of 4**, not 12, because the
   free-tier database refuses that many simultaneous interactive transactions.
   Raise `WAVE` in `packages/db/test/isolation.test.ts` on a larger instance.

---

## Security actions requiring manual intervention

1. **Rotate the Neon credentials.** The `neondb_owner` password was printed into
   a working transcript. Neon → project → Roles → reset. Then re-run
   `npm run setup:roles --workspace @landingos/db -- --rotate` for
   `landingos_app`.
2. **Rotate `AUTH_SECRET` and the old `DATABASE_URL`.** They were committed to
   the website-builder's git history (8 commits, imported via subtree). The file
   is untracked now, which stops further exposure but does not remove what is
   recorded. Whether to scrub history is a judgement call and only worthwhile if
   those commits never reached another remote.

Neither blocks development. Both should happen before anything real ships.

---

## Environment setup

**Required:** Node ≥ 22.6 (developed on 24.18), npm 11.x, a PostgreSQL 14+
database (Neon assumed).

```bash
npm install                                         # from the repo root
npm run setup:roles  --workspace @landingos/db      # provision landingos_app
npm run push         --workspace @landingos/db      # apply the schema
npm run rls          --workspace @landingos/db      # apply RLS policies
npm run seed:reference --workspace @landingos/db    # 58 wilayas, 537 baladias
npm run seed:dev     --workspace @landingos/db      # 2 tenants, 3 users
npm run seed:demo    --workspace @landingos/db      # 1 demo tenant, full ERP dataset (see DEMO.md)
```

### Env files (all gitignored)

`packages/db/.env` — `DATABASE_URL` (app role, **pooled**),
`MIGRATE_DATABASE_URL` (owner, **direct**), `APP_DB_PASSWORD`.

`apps/website-builder/.env` — `PLATFORM_DATABASE_URL` (same as the app role
URL; named separately so it can never be confused with another client),
`AUTH_SECRET`, `WORKER_SECRET`, optional R2 variables, and — for Web Push —
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. **The VAPID pair must
be stable across deploys**: generating one at boot silently invalidates every
stored subscription and nobody notices until no phone rings again. Push is off,
not broken, when they are absent.

**`WORKER_SECRET` is not optional for the test suite.** `POST /api/jobs/tick`
fails closed, so without it the contract suite can only exercise the refusal —
which is exactly how 6.5b shipped a tick that could never run a job.
`ERP_CONTRACT=strict` refuses to start without it. The value must match whatever
`services/worker` is given.

### Seeded development accounts

Password for all: `devpassword123`

| Email | Tenant | Role | Products |
|---|---|---|---|
| `owner@acme.test` | Acme Trading (`/acme`) | OWNER | builder + erp |
| `agent@acme.test` | Acme Trading | MEMBER | builder + erp |
| `consultant@landingos.test` | Acme **and** Beta Shop | VIEWER / ADMIN | Beta has erp only |

The consultant belongs to **two tenants with different roles** — that case
exists on purpose and must keep working.

---

## Commands

```bash
npm test                                      # all workspaces (see limitations)
npm run builder:build                         # build the platform app
npm run builder:start                         # run it on :3000
npm run preflight    --workspace @landingos/db   # verify RLS is real (9 checks)
npm run rls          --workspace @landingos/db   # re-apply policies after schema changes
npm run ddl          --workspace @landingos/db   # render the schema to SQL, offline
```

Most E2E tests need the server running on `:3000`; they **skip** rather than
fail without it, so check the counts, not just the exit code.

---

## Testing status

| Suite | Tests | State |
|---|---|---|
| `apps/erp` | 298 | 297 pass, 1 skipped (the legacy stack, still standalone) |
| `apps/website-builder` | 102 | all pass (builder-api 22, builder-sections 45, console-shell 13, storefront 22) |
| `apps/website-builder` — ERP contract | 989 | all pass against a running server (18 suites, each verified individually) |
| `apps/website-builder` — platform contract | 91 | team (7.1 + R15) + billing (7.2) + signup (7.3), against a running server |
| `apps/website-builder` — `test/calc.test.ts` | 20 | PURE — no server, no database. The profit calculator's arithmetic. |
| `packages/auth` | 36 | all pass |
| `packages/db` | 33 | all pass (11 schema + 18 isolation + 4 orphan-column) — two of the schema assertions had been red since Phase 5.2/5.4 and were repaired in 6.6a |
| `packages/product-registry` | 36 | all pass |
| `packages/ui` | 26 | all pass |
| `packages/i18n` | 20 | all pass — including a scan of every `t("literal")` in the console source. **What it cannot see is a string that never went through `t()` at all**, which is how six screens kept their English through four passes (Phase UI). |
| `services/worker` | 4 | all pass — AUDIT.9, the first tests this process has had. Runs it as a real child process against a server that never answers. |
| **Total** | **1655** | green per suite |

The ERP contract suite needs the server on `:3000`. It skips with a stated
reason when the server is down or `/api/erp/*` is unmounted, and
`ERP_CONTRACT=strict` turns that skip into a failure — which is what CI should
use, now that every surface exists.

The tests are written to **attack boundaries, not confirm happy paths**: another
tenant's id, a role without the permission, a tenant without the subscription, a
forged price, a hostile raw SQL `WHERE 1=1 OR tenantId=...`. Several were
verified to *fail* against the pre-fix code before being kept. Preserve that
character.

---

## Deployment status

**Nothing is deployed.** Configuration exists and is unverified.

- `railway.json` at the repo root; build context is the **repo root**, not the
  app directory (the lockfile lives at the root).
- `apps/website-builder/Dockerfile` — multi-stage, `npm ci --workspace` so the
  image never compiles the ERP's native binding.
- `.next/standalone` puts the server at
  `standalone/apps/website-builder/server.js` — one level deeper than a
  single-app build. The Dockerfile and entrypoint both depend on that, and
  `outputFileTracingRoot` is pinned in `next.config.ts` so the shape cannot
  change silently.
- Healthcheck: `/api/health`, which now probes the **platform** database and
  counts wilayas.

Verify before shipping:
```bash
docker build -f apps/website-builder/Dockerfile -t landingos-builder .
```

---

## Assumptions future sessions must preserve

1. **Neither product is the main product.** No code may assume two products
   exist, or which they are.
2. **Never `where: { tenantId }` in application code.**
3. **Never run the application as the database owner.**
4. **Entitlement is checked before role.**
5. **Console tokens and storefront themes never mix.**
6. **Every user-facing string is an i18n key.** No literals.
7. **Money is `Decimal`, formatted from its string form.** Never a JS float.
8. **Append-only tables stay append-only** — financial records, inventory
   movements, shipment events, audit, order history.
9. **Checkout never trusts a price from the client.**
10. **404, not 403, for another tenant's resource.** Confirming a row exists
    elsewhere is itself information.
11. **The changelog is part of the work**, in the established
    what/why/files/migration/risk format.
