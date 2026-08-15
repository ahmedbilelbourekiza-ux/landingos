# Next Steps

**PHASE LB (the Landing Page Builder as a commercial product) IS COMPLETE —
see `BUILDER_AUDIT.md` (the before), `BUILDER_HANDOFF.md` (the after, with the
readiness checklist and roadmap), and PROJECT_STATE's *Phase LB* section. The
ERP is deliberately paused with its PM work committed.**

**LB.9 (Docker/production packaging) and LB.10 (the pre-production readiness
audit — six defects fixed with regression tests, CHANGELOG §LB.10) have both
landed since the queue below was first written; the old queue numbers LB.9 and
LB.10 are renumbered to avoid colliding with those commits.**

## WHAT PHASE LB LEFT — the builder's own queue

Full reasoning in `BUILDER_HANDOFF.md` §12–13. In order:

| # | Slice | Size | Why |
|---|---|---|---|
| ~~**LB.11**~~ | ~~Real-credential smoke test~~ | S | **CLOSED 15 Aug 2026 by production evidence, for Meta.** The user's real pixel + CAPI token on the real store (`selliora16`); two live checkout orders; Meta's dataset stats recorded **Purchase ×2, Lead ×2** server-side, `server_last_fired_time` 20s after the first order. No code change; the user's "it didn't fire" was a false negative (no `testCode` → Test events tab empty; ~35-min stats lag; their browser's pixel blocked). CHANGELOG §LB.11 has the full record. TikTok/GA4 remain unexercised against real endpoints — same class of gate, when a customer brings those credentials |
| ~~**LB.12**~~ | ~~Benefits + FAQ end to end~~ | M | **DONE 10 Aug 2026** (`CAPABILITY_AUDIT.md` B1, CHANGELOG §LB.12). The audit found it was deeper than recorded: the storefront FAQ/Reviews renderers were **mounted by nothing** (saved reviews travelled in the payload and rendered nowhere) and BenefitsList hardcoded four badges. Now: `features`/`faqs` PUT routes, Benefits+FAQ editor sections replace the stubs, mappers unhardcoded, sections mounted with `show*` gating (default true), benefits data-driven with the four badges as fallback. builder-sections 54/54, live-verified through the real editor + public page |
| ~~**LB.13**~~ | ~~Editor i18n~~ | M | **DONE 11 Aug 2026; DEPLOYED to production 12 Aug (evening) — `EDITOR_I18N.md` is the full record.** Seven slices, 213 `builder.editor.*` keys in en/fr/ar, 31 live components plus four shared modules. Suites: i18n 22/22 (two new guard tests), builder-sections 58/58, console-shell 20/20, storefront 32/32; verified live in `ar` (RTL) and `fr` (LTR) with the forms driven, not read. The measurement corrected M-04 twice — the create screen was already translated, and 10 of the "54 components" are dead legacy code reachable from nothing. It also closed a class the audit never named: the save path rendered the API's ENGLISH developer message in every locale. **Three decisions remain yours: `EDITOR_I18N.md` §3.** |
| ~~**LB.16**~~ | ~~The ten dead components, deleted~~ | S | **DONE 12 Aug 2026; DEPLOYED to production the same evening.** Re-confirmed unreachable three ways — filenames, exported SYMBOLS, a fresh import-graph walk — before `git rm`. The i18n guard's exemption for `media-picker-dialog.tsx` went WITH the file rather than into an empty set, because a list that exists is an invitation to add to it. `components/landings/` now holds only `edit/`. All eight builder suites green; every builder screen re-verified at 200. See the narrative below |
| ~~**LB.17**~~ | ~~Back-navigation on ERP detail screens~~ | S | **DONE 12 Aug 2026; DEPLOYED to production the same evening.** A reported defect, and the measurement was sharper than the report: a back link EXISTED but sat after the title as a 44×20px muted word with no arrow. `PageHeader`'s own comment says its breadcrumb was built to replace this link and the product detail's — UI.22 built the primitive and migrated only the order detail. erp/screens 173/173 |
| ~~**LB.18**~~ | ~~The finance module becomes optional~~ | M | **DONE 12 Aug 2026; DEPLOYED to production the same evening.** Four things make "removed" mean something: the nav loses Finance AND the Calculator, both screens 404 on a typed URL, all nine finance handlers refuse with `FINANCE_DISABLED`, and NOTHING IS DELETED. erp/finance 38→44 |
| ~~**LB.19**~~ | ~~Product categories in the catalogue~~ | M | **DONE 12 Aug 2026; DEPLOYED to production the same evening.** Pages already had categories since B3; products had unguided free text. Closed WITHOUT converting to a relation — the schema states a reasoned decision against that. erp/catalog 72→75 |
| ~~**LB.20**~~ | ~~Per-product delivery pricing~~ | M–L | **DONE 12 Aug 2026; DEPLOYED the same evening WITH its production migration (user-approved — `landingos_prod` push + RLS 49/49, quote=charge verified live with a real order).** The schema did not support it: `TenantDeliveryPrice` is unique on `(tenantId, wilayaId)`. builder-sections 62→67, storefront 32/32, packages/db 33/33 |
| ~~**LB.21**~~ | ~~Landing pages publish into the ERP catalogue~~ | M | **DONE 12 Aug 2026; DEPLOYED to production the same evening.** All products or one. `CatalogProductLink` is the idempotency key; ADOPTION is what protects a catalogue the merchant already filled in by hand. builder-sections 67→72 |
| ~~**LB.22**~~ | ~~A theme generated from a product image~~ | M | **DONE 12 Aug 2026; DEPLOYED to production the same evening.** The hard part is readability, not colour-finding. builder-sections 58→62 |
| ~~**LB.25**~~ | ~~Merge the Finances screen into the Calculator~~ | S–M | **DONE 12 Aug 2026; DEPLOYED to production the same evening.** Measured first: both screens wrote the SAME record through the same route. The expense form + list and the superseded marker moved to `/console/erp/calculator`, now titled Finances; the finance screen and its nav item are deleted; the URL stays. erp/screens 173→172, finance 44, ai 31, access 205 |
| ~~**LB.26**~~ | ~~The preview/storefront theme-bleed bug~~ | M | **DONE 12 Aug 2026; DEPLOYED to production the same evening.** A landing page rendered the VIEWER's dark/light (console toggle in the editor; the visitor's OS on the published page) instead of its own theme — `--theme-background` had a writer and no reader. The ThemeProvider now paints its canvas and redefines the console token names in scope; the mini preview wraps in it; the never-sent `themeId` now reaches the preview state. storefront 33, builder-sections 73 |
| ~~**LB.27**~~ | ~~Tenant deletion leaves orphaned rows~~ | M | **DONE 12 Aug 2026 (night); DEPLOYED 13 Aug** (and used there for the deploy's own fixture cleanup — 9 rows, zero behind). `deleteTenant()` in packages/db — an RLS-scoped sweep chosen over FK cascades on purpose (a cascade makes an accidental delete silently total). Harness + 11 suite hooks swapped; `neondb` bulk-cleaned **73,267 → 0** orphans and still 0 after suite runs. packages/db 33→35 |
| ~~**LB.28**~~ | ~~The dead `rtl:` Tailwind variant~~ | S | **DONE 12 Aug 2026 (night); DEPLOYED 13 Aug — and the premise measured FALSE.** `rtl:` is native on Tailwind 4.3.3 (`:lang()`-keyed); the data table was already correct in Arabic, the calendar is unmounted. Real fixes: the editor back arrow now flips (it cited the false premise for not flipping), the stale comments/memory corrected, and the dir-island rule recorded in globals.css. i18n 22, builder-sections 73 |
| ~~**LB.29**~~ | ~~`ui/sheet.tsx` closes on a physical edge~~ | S | **DONE 12 Aug 2026 (night); DEPLOYED 13 Aug** (verified in production Arabic: close at x 17–33). `right-4` → `end-4`; scope corrected by measurement — the mobile nav drawer is a custom logical-first component and was never affected; the editor preview drawer is the only live Sheet. ar close x 343→17 at 375px emulation, fr unchanged. No physical device reachable — caveat recorded. builder-sections 73 |
| ~~**LB.30**~~ | ~~Home/category/thank-you follow the visitor's dark mode~~ | S | **DONE 13 Aug 2026; DEPLOYED the same night** (verified in production: the themed order's thank-you wears the merchant theme under emulated dark; fixture swept with `deleteTenant`). LB.26's recorded remainder. The thank-you inherits the ORDER's landing-page theme (the checkout journey's last step looks like the page the customer bought on); home/category wear `DEFAULT_THEME` — a store-level theme field on `StoreSettings` is a schema migration + merchant UI, deliberately left as a decision, with the two call sites marked. Verified live under emulated dark OS both ways (bound theme + default). storefront 33→36 |
| ~~**LB.35b**~~ | ~~The per-page pixel control has no UI~~ | S–M | **DONE 13 Aug 2026 (late night); DEPLOYED the same night.** LB.35 built the column, the PATCH, the storefront read path and the tests and **touched no editor file** — the Integrations section rendered LB.5's signpost, which LB.35 had made untrue. Now a mode switch (**All** = `null` / **Choose** = `[ids]`, ticking nothing = `[]` = none), because three states do not fit in a checkbox list. "Choose" pre-selects the active set so a save cannot silently stop reporting; inactive integrations are listed and marked so a page's link is never dropped. Verified live in all three states, storefront included. No migration. builder-api 37→41. §LB.35b below |
| ~~**LB.35**~~ | ~~A landing page can link only one Meta pixel~~ | M | **DONE 13 Aug 2026; DEPLOYED the same night — but see LB.35b: the console control was never built.** (its migration was applied to `landingos_prod` first, as its own approved action; the app code followed in `bd6d664..d6a56b1`). Verified live: a page's explicit one-integration subset survived a duplicate through the real route. Premise half-false: multiple pixels per TENANT already fired (Meta fetched a signals/config for both ids). The gap was per-PAGE selection, blocked because an App Router layout cannot see its child's params — the loader mount moved from the layout to the four storefront routes, with LB.5's "no page forgets" guarantee moved into a test. builder-api 29→35 |
| ~~**LB.38**~~ | ~~No way to permanently delete a page, even an order-free one~~ | S | **DONE 13 Aug 2026 (late night); DEPLOYED the same night.** LB.34's hardened `DELETE` was wired to NOTHING — `method: "DELETE"` in no component — so a mistyped draft could only be archived. Delete row-action added beside Archive, **offered only at zero orders** (the route refuses regardless; the absence is so nobody is invited to press a button that always 409s). `HAS_ORDERS` was also unmapped in `action-errors.ts` — the LB.14c pattern a third time — and now names Archive ×3 locales. Shown for archived rows too when order-free. No migration. builder-api 35→37 |
| ~~**LB.34**~~ | ~~No way to delete a landing page~~ | M | **DONE 13 Aug 2026; DEPLOYED the same night.** Verified in production: archiving 404s the storefront and the checkout refuses the page, **while the order it had already sold survived intact**; restore landed on DRAFT. **The hard delete it kept had no UI until LB.38.** A hard-DELETE route already existed and cascades into `SalesOrder` (+ status history, drafts; fulfilment SetNull) — wiring a button to it would have shredded revenue history. Archive instead, using the never-written `ARCHIVED` enum value: **no migration**. Sets status AND unpublishes; restore lands on DRAFT. Hard delete kept for orderless pages, `409 HAS_ORDERS` otherwise. builder-api 23→29 |
| ~~**LB.33**~~ | ~~"Full name" looks invalid on a fresh form~~ | S | **DONE 13 Aug 2026; DEPLOYED the same night — premise measured FALSE.** Fresh field is `aria-invalid="false"`, neutral border, no `required`, form `noValidate`, and the compiled variant is `[aria-invalid=true]`; the red state is genuine but post-submit only. The real defect found in the same component: `Field` derived `htmlFor` from label TEXT, so **no checkout field had a working label**. Fixed explicitly. storefront 38→40 |
| ~~**LB.32**~~ | ~~The editor's sticky header overlaps the content~~ | S | **DONE 13 Aug 2026; DEPLOYED the same night** (measured in production: header band `[0,56]` at every scroll position, anchored scroll landing a card at 96px with 40px clearance). Not z-index, not padding: `sticky top-16` cleared a shell header that is not above this screen (the editor mounts outside `ConsoleShell`). Sticky reserves no space for its offset, so content flowed from 56 while the header painted 64→120 — a permanent 64px overlap. `scroll-mt-24` corroborated the diagnosis. `top-0`; anchored-scroll clearance −24px→+40px |
| ~~**LB.31**~~ | ~~The storefront header shows "LandingOS" and links to the platform~~ | S | **DONE 13 Aug 2026; DEPLOYED the same night** (verified in production on a real published page: header and footer name the merchant and link to its own root, zero platform strings in the body). Not preview-only: with no `StoreSettings` row the published page rendered the platform wordmark linking to `/` (307 → console), plus the platform's internal description and copyright. Both production tenants have exactly that null row — 0 published pages, so unseen, one publish away. `resolveStoreName` + deleted fallbacks; brand is a span in the preview drawer. storefront 36→38 |
| **LB.36** | Brands — a store organised around brands instead of one flat shop | M–L | **SCOPED, NOT BUILT (13 Aug 2026; the scoping doc is merged to local `master`)** — a measurement + proposal pass only, like the store-theme question. Full write-up below; the decision is yours |
| **LB.23** | Facebook Ads account linking | L | **DECIDED, NOT STARTED — blocked on credentials.** Real ad-spend attribution via a Meta app + OAuth, not merely storing an account id. Waiting on a Meta Developer App: Marketing API product, App ID/Secret, redirect URI, `ads_read`, possibly App Review / Business verification. See `FEATURE_PASS_AUG12.md` §5 |
| **LB.24** | AI landing page generator | L | **ON HOLD, NOT STARTED** — deliberately. The `AiProvider`/`AiAgent` infrastructure exists and `ai/chat` is a deliberate 501; the scoping is in `FEATURE_PASS_AUG12.md` §5 |
| **LB.14** | Storefront caching + version history + custom-domain console flow | M–L | **SPLIT INTO THREE, because they are three different risks.** LB.14a caching — **DONE 13 Aug 2026 (night), DEPLOYED the same night**; LB.14b version history and LB.14c custom domains — see their own rows below. Original scoping: handoff §13 |
| ~~**LB.14c**~~ | ~~Custom-domain console flow~~ | S | **PREMISE FALSE — the flow already exists** (B5, 10 Aug, deployed): claim, per-row token, **real DNS TXT verification**, primary, unlink, screen, tests. Driven live to confirm. **What was wrong and is now fixed (13 Aug, night; DEPLOYED the same night):** the verify route distinguishes "no TXT record yet" from "wrong value" on purpose — the opposite instruction to a merchant mid-setup — and both arrived as "that didn't work", because one code carried both meanings and B5 mapped **none** of its five refusal codes in `action-errors.ts`. Split + six messages ×3 locales. platform/domains 13→14. **⚠ SCOPED, NOT BUILT — the part that needs infrastructure:** a verified domain still 403s until the OPERATOR adds the hostname to Render and it issues a certificate (proven: `x-render-routing` 403; no Render credential exists here). **Custom domains are therefore complete in the app and inert in production.** Three options + the `isPrimary`-has-no-reader finding written up below; the decision is yours |
| **LB.14b** | Page version history / undo (M-02, = CAPABILITY_AUDIT B7) | M–L | **SCOPED, NOT BUILT (13 Aug 2026) — it needs a new table, therefore a production migration, and that was out of scope for the session that measured it.** Confirmed nothing exists: the whole schema has ONE history table and it is `SalesOrderStatusHistory`. Eleven separate section-save routes and no single write path to hook. A snapshot measured at 0.6–3.6 KB on real pages, so storage is not the argument — the three open questions are all product decisions (when a version is taken, what restore does to a page that has SOLD, whether restore may republish). Proposed shape + costs written up below; **RLS would move 49 → 50.** **Built instead, needing no migration: the `duplicate` completeness fix**, because until this exists a duplicate is the only way back a merchant has |
| ~~**LB.14a**~~ | ~~Storefront caching (P-01)~~ | S–M | **DONE 13 Aug 2026 (night); DEPLOYED the same night — and the finding inverted the premise.** Confirmed in production across five header paths plus two controls; the wilayas 404's flip from *no header at all* was the deploy's own marker. The pages were sending `no-store` (the strictest header there is); the **delivery quote was sending no `Cache-Control` at all**, and RFC 9111 lets a shared cache invent freshness for exactly that. The rule settled on: *a response may be reused by a shared cache only if a stale copy cannot cost somebody money or expose somebody's order* — stricter than "changes rarely", because a storefront is reachable through a MERCHANT's own hostname and this platform cannot purge their CDN. Public pages → `private, max-age=60, must-revalidate` (the one real win: `no-store` forbade even a back-button redisplay); quote, pixel configs and thank-you → `private, no-store`. **ISR measured UNAVAILABLE, not declined** — `revalidate = 60` still built as `ƒ (Dynamic)` with no warning, because a custom domain wins over a path prefix and so every render reads the Host header. storefront 40→48 |
| ~~**LB.15**~~ | ~~Editor money inputs off `type="number"` (pricing section)~~ | S | **DONE 13 Aug 2026 (night); DEPLOYED the same night — and the measurement found data loss, not style residue.** Re-measured live in production after the deploy: two ArrowUp presses left 2990.50 unchanged, and a French `2990,75` saved and read back as Decimal 2990.75. Three boxes: `price`, `oldPrice`, and every variant option's supplement. `step="1"` made any sub-unit price `stepMismatch` (the browser calling it invalid while `aria-invalid` said fine) and **two ArrowUp presses on 2990.50 stored 2992** — the control discarding the centimes. All three are now text + `inputMode="decimal"` + `dir="ltr"`, and ONE reader (`lib/landing/money-field.ts`) serves the schema, the preview strip and the save body. A comma is a decimal separator; `1,000` is REFUSED rather than guessed (a 1000× error either way), while a dot with three places is deliberately allowed because that is what a stored `Decimal` returns. New key `builder.editor.priceUnreadable` ×3 locales. calc 20→28, builder-sections 73→74 |
| ~~LB.10~~ | ~~`website-builder:orders:write`~~ | — | **DONE in the LB.10 commit** (B-08 closed, console writes rerouted through the API, webhooks fire from console changes) |

### The 12 August pass — LB.16 to LB.22, slice by slice

**DEPLOYED 12 Aug 2026 (evening), user-approved** — the whole range
`b767928..e3939e9` (these commits plus LB.25/LB.26) went to `origin/main`
after the LB.20 production migration ran; see `HANDOFF_PRODUCTION.md` §1 for
the deploy record and its live verification. `FEATURE_PASS_AUG12.md` carries
the session-level record (the defect list, the database state, the
decisions); what follows is the per-slice narrative in the shape LP.16 and
its neighbours use.

**LB.16 — DONE. The ten dead components, deleted.** LB.13's measurement found
that ten of `BUILDER_AUDIT` M-04's "54 editor components" were unreachable from
`app/` — the legacy dashboard's page list, superseded by the server-rendered
console screen and imported only by each other. Re-confirmed three ways before
deleting: the filenames, their exported SYMBOLS (a file can be imported under a
name that does not match its path), and a fresh import-graph walk. The i18n
guard's named exemption went with the file rather than into an empty set,
because a list that exists is an invitation to add to it. Two exports are now
orphaned and deliberately left — `toListItem` in `mappers.ts` (**already dead
before this deletion**; nothing imported it) and the `LandingListItem` type;
`VariantGroup`/`VariantOption` in the same module stay live, so
`mock-landings.ts` must not be deleted wholesale.

**LB.17 — DONE. Back-navigation on the ERP client and product detail screens.**
Reported as "opening a client has no way back to the list". The measurement was
sharper: a link existed, 44×20px of muted text reading "Clients", no arrow, no
"back", sitting AFTER the title and after the tap-to-dial button — measured in
the running page at x=294 beside an `h1` at x=16. It reads as a tag ON the
record rather than navigation OFF it, which is why it was experienced as
absent. **The check the user asked for found the cause:** `PageHeader`'s own
doc comment says its breadcrumb exists "to replace three different hand-written
back links (the order detail's, the client detail's, and the product detail's
absence)" — UI.22 built the primitive and migrated only the order detail. Both
screens use it now, so all four list-then-detail pairs in the console navigate
the same way. Nothing was demoted to make room: the dial control keeps its
prominence as `actions`, the archived chip becomes `meta`. erp/screens 173/173.

**LB.18 — DONE. The finance module can be switched off, per tenant.** The
mechanism already existed — `ProductSetting` keyed (tenant, product, key), a
route validating against `SETTINGS_SCHEMA`, and a settings screen that builds
its controls FROM that table — so declaring `financeEnabled` made the switch
appear, labelled and translated, with no edit to the page. Four things make
"removed" mean something and only the first is visible: the nav loses Finance
AND the Calculator (it writes the records the books are made of), both screens
404 on a typed URL, all nine finance handlers refuse with `FINANCE_DISABLED`,
and **nothing is deleted** — `FinancialRecord` is append-only by design, so a
control that shredded it would be the one irreversible action on this platform.
The shell is handed IDS, never knowledge: `hiddenNavIds` is product-agnostic,
and that "finance" and "calculator" are one module lives in `lib/erp/settings.ts`
and is applied by the ERP's own segment layout — a `switch (product.id)` in the
shell is exactly what the manifest contract exists to prevent. Settings gained a
generic hint slot on the way, derived from the catalogue via `t.has()` rather
than a maintained list. erp/finance 38 → **44**.

**LB.19 — DONE. Product categories in the ERP catalogue.** Half the request was
already done: `LandingPage` has had a `Category` relation, a management screen
and a picker since B3. Products had `CatalogProduct.category` as free text with
nothing around it. **The free text was NOT converted to a relation**, and that
is a decision — the schema states a reasoned one against it ("a niche list is a
handful of words per tenant, and a Supplier table would be a migration plus RLS
plus a management screen for something no route needs to join on"). What was
closed is the gap that decision left open: the field was unguided, so a merchant
typing "Skincare", "skincare" and "Skin care" got three categories and no way to
notice. Values in use are now offered wherever the field appears — a datalist on
create (suggesting, never forbidding, because the first product in a category
must be able to create it), a select on the list filter, and
`GET /api/erp/products/categories` with counts. **D-LB.19.1** closed a real
duplication on the way: the screen and `GET /api/erp/products` each built their
`where` by hand under a comment promising they could not disagree; both call
`productWhere` now, and a test asserts they return the same set for the same
query string rather than restating the promise. erp/catalog 72 → **75**.

**LB.20 — DONE; MIGRATION EXECUTED IN PRODUCTION 12 Aug 2026 (user-approved).
Per-product delivery pricing.** The
schema did not support it: `TenantDeliveryPrice` is unique on
`(tenantId, wilayaId)`, so a company had exactly one price per destination and a
heavy or fragile product had to be absorbed into it. `LandingDeliveryPrice` is a
SECOND table rather than a nullable `landingPageId` on the first, because the
existing uniqueness is what makes "the company's price for Alger" a single fact
and a nullable column would make NULL mean "default" — and Postgres NULLs are
not equal to each other, so the constraint would stop preventing duplicate
defaults. **D-LB.20.1 is the property that makes this safe:** two endpoints read
delivery prices — `/wilayas` quotes into the destination dropdown, `/orders`
charges — and each built its own query. A per-product price reaching one and not
the other bills a customer something other than what they were shown, and no
suite over either route alone would notice. Both call `deliveryPricesFor()`, and
the test asserts the charged `shippingPrice` on the stored snapshot equals the
quoted price AND differs from the company rate. Driven live: a 1500 override on
a 2900 product produced an order totalling **4400**, not the 3300 the company
rate would have given. builder-sections 62 → **67**, storefront 32/32,
packages/db 33/33.

> **✔ The hold was lifted and the migration RAN 12 Aug 2026 (user-approved):**
> DDL previewed against `landingos_prod` (only the one table), pushed with the
> datasource confirmed in output, RLS re-applied at **49/49**, table confirmed
> empty before the app deploy — then quote=charge proven in production with a
> real order. `HANDOFF_PRODUCTION.md` §1 is the record.

**LB.21 — DONE. Landing pages publish into the ERP catalogue.** The gap was
quiet rather than loud: a merchant builds a product in the builder and it exists
nowhere in the Manager until somebody retypes it, so `fulfilmentFromSale` writes
the product's NAME onto the order, `productOrderMatcher` looks it up, finds no
row, and the lifetime counters never move while no cost basis exists.
Idempotency is the design because "send all" is a button somebody presses twice:
`CatalogProductLink` already models "this catalogue row IS that external
product", so it is the key. **D-LB.21.1 — adoption is what protects an existing
catalogue:** a naive importer gives a merchant who already typed their products
in TWO rows per product, and two rows answering to one normalised name make
every order naming it attributable to NEITHER — which is exactly what
`duplicateProductNames` exists to detect. An unlinked row with a matching
normalised name is adopted; two already-ambiguous rows are left alone, because
adopting one would pick a winner arbitrarily and make the ambiguity permanent.
The Manager's own columns survive an import — `costPrice`, `packagingCost`,
`stock`, `threshold`, `supplier` are facts a manager maintains, and resetting a
cost basis to zero would corrupt every profit figure derived from it. "All"
takes published pages only. builder-sections 67 → **72**.

**LB.22 — DONE. A storefront theme taken from the product's own photograph.**
The hard part is not finding the colours — averaging pixels is four lines — it
is that the result must be READABLE: a generated theme that puts white text on a
pale yellow buy button ships a broken storefront and the merchant finds out from
their conversion rate. The two colours that carry text are CHOSEN by WCAG
contrast; the extracted hue survives where being wrong is cosmetic and yields
where being wrong is a lost sale. The contract test asserts ≥ 4.5 on both pairs,
computing the ratio independently of the implementation so it checks the result
rather than restating the code. Near-white and near-black are excluded from the
vote (product photography is shot on a white sweep, so the honest dominant
colour of most of these images is the backdrop), and an image with nothing to
take is REFUSED — inventing a plausible theme from no evidence is the worst
outcome because it looks like it worked. `readTenantImage` checks the URL's
owner segment against the caller and accepts only `/uploads/` paths, so the
route is not a fetcher. No new dependency: `sharp` was already here.
builder-sections 58 → **62**.

**LB.25 — DONE. The Finances screen merged into the Calculator (a later 12 Aug
session).** The measurement came first, live, and decided the shape: both
screens' save buttons POST the same `/api/erp/financial-records` into the same
append-only `FinancialRecord` (the same demo record rendered on both tables),
both nav items sit behind SENSITIVE `erp:finance:read` in the same `insight`
group, both pages apply identical `seesWholeBook` + `financeEnabledFor` gates,
and LB.18's toggle already hid the pair as one unit. So the finance screen was
a shorter, hand-typed duplicate of what the calculator derives and partly
syncs from real orders — and it went. What moved rather than died: the one-off
expense add form AND its list (delete only, never edit — the schema's
deliberate asymmetry), and the **current/superseded version marker** with its
hint, which was an audit finding and would otherwise have been lost; the
history's money columns picked up `formatMoney` on the way, as the deleted
table had. Two decisions to know: **the URL stays `/console/erp/calculator`**
(the label carries the name — the Automation precedent; a move breaks links to
buy nothing) and **the manual six-totals form was dropped, not moved** — the
route is untouched and still accepts manual posts; only the duplicate control
went. No route, schema or permission change; `FINANCE_NAV_IDS` is
`["calculator"]`. Verified live in fr AND ar (RTL): a charge added through the
moved form lands in the roll-up exactly once, deletes cleanly, and the module
toggle removes/restores the single merged screen with analytics untouched.
erp/screens 173 → **172** (the walkthrough row for the deleted screen),
erp/finance 44/44, erp/ai 31/31, erp/access 205/205, console-shell 20/20,
i18n 22/22, product-registry 36/36, calc 20/20.

**LB.26 — DONE. A landing page wears its OWN theme, never the viewer's dark
mode (a later 12 Aug session).** Reported as the editor preview's background
following the console's dark/light toggle instead of the page's colour
template. Measured live, it was one mechanism with three symptoms: next-themes
in the ROOT layout stamps `.dark` + `color-scheme:dark` on `<html>` for every
route — the STOREFRONT included, where `defaultTheme="system"` means a real
customer's OS preference — the root `<body>` paints console `bg-background`,
the template's structural sections are console Tailwind tokens, and the page
theme's `--theme-background` was **written by the ThemeProvider and read by
nothing**. The published page was confirmed dark for an emulated dark-OS
anonymous visitor against a `#FAF9F6` theme. The fix is ONE scope: the landing
`ThemeProvider` paints its canvas (`background-color`, `color`,
`color-scheme:light`) and REDEFINES the console token names on its scope
element — `@theme inline` makes utilities resolve `var(--background)` at the
element they style, so the nearest declaration wins and `.dark` on `:root`
cannot reach a landing page. The storefront and the drawer preview inherit it
through `LandingTemplate`; the miniature preview now wraps in the same
provider (theme resolution extracted to `useSelectedLandingTheme`, one
vocabulary for both previews). **Two findings on the way:**
`GeneralPreviewValues.themeId` was declared and never sent by the section's
preview watcher — whose object REPLACES the slice — so both previews only
ever showed the SAVED theme and the first keystroke in General wiped even
that; and the scope element must be a PLAIN div, because framer-motion routes
`style` through its animation pipeline and kept serving the first theme's
background after an editor theme switch with the inline style already
correct. Verified live at the worst case (console dark AND emulated dark OS):
published page, drawer and miniature all hold the theme; switching themes in
the editor recolours the miniature without saving. **Recorded, not built:**
the store home/category/thank-you pages still follow the visitor's dark/light
— no per-page theme exists for them, and which theme a store-level page wears
is a design question. storefront 32 → **33**, builder-sections 72 → **73**,
builder-api 23/23, tracking 15/15.

**LB.27 — DONE. A deleted tenant actually goes away (12 Aug, night — the
finding from the deploy session's cleanup).** `tenant.delete` cascades
platform rows and NOTHING else: product-domain tables carry `tenantId` as an
RLS-scoped column, not a foreign key, so pages, orders, clients and settings
survive as unreachable orphans. Measured first: `neondb` held **73,267
orphaned rows from 4,149 dead tenants** across 41 tables, left by a harness
whose own comment claimed the cascade existed. The fix is
**`deleteTenant()` in `packages/db`, deliberately NOT foreign-key cascades**:
an FK to Tenant on 49 tables is a live-database migration that only becomes
coherent once production migrates too, and — the load-bearing reason — a
cascade changes what `tenant.delete` MEANS everywhere, turning one accidental
platform-row delete into silent total destruction, where the column-only
design fails SAFE. Destruction stays a named act. The helper enumerates the
scoped models from the Prisma DMMF (a new table is swept without being
listed) and sweeps under `withTenant` with UNFILTERED `deleteMany({})` —
rule 2 means RLS itself decides what "everything" is, so the helper CANNOT
touch another tenant even if buggy. Passes repeat until clean; the Tenant row
goes last and may already be gone (the orphan-cleanup case). The harness
(`cleanup()`) and eleven suite-level hooks were swapped;
`isolation.test.ts`'s own owner-side cleanup too. New suite
`packages/db/test/delete-tenant.test.ts` asserts zero rows via
information_schema through the OWNER connection, and pins the defect itself
(a bare `tenant.delete` must still orphan — if that ever fails, an FK
cascade appeared and this design note needs revisiting). The historical
backlog was bulk-swept owner-side: **73,267 → 0**, and still 0 after
console-shell 20/20 + hardening 12/12 ran with the new cleanup. packages/db
33 → **35**. **DEPLOYED 13 Aug 2026**, and it did the deploy's own fixture
cleanup in production: 12 tables held the throwaway tenant's rows, the helper
swept the 9 product-domain ones in 2 passes (Membership/Subscription/
AuditEvent cascaded with the Tenant row), zero rows behind — the first real
use of the helper, on the defect it was written for.

**LB.28 — DONE. The "dead `rtl:` variant" was never dead; the record was (12
Aug, night).** The backlog said `rtl:` emits no CSS app-wide and the ERP data
table and date picker are "likely rendering wrong in Arabic right now".
Measured in the running page first, per the standing order — and the premise
is FALSE on Tailwind 4.3.3: `rtl:` is a real native variant (keyed on
`:lang()`, the RTL-language list), the products screen's expander chevron
computes `scale: -1 1` in Arabic and `none` in French — correct all along —
and `ui/calendar.tsx` is imported by NOTHING, so there is no reachable date
picker to be wrong. The false record came from LB.13 verifying the absence
of `rtl:rotate-180`, a class in no source file: Tailwind emits utilities on
demand, so the absence proved nothing was generated, not that the variant
did not exist. What WAS wrong and is fixed: the editor's back arrow carried
no flip — its own comment cited the false premise — and now mirrors in
Arabic (`rtl:-scale-x-100`, verified live both directions); the stale
comments and the session memory are corrected. One real limit found and
recorded as a rule in `globals.css`: the `:lang` basis means an `rtl:`
utility STILL FIRES inside this app's `dir="ltr"` islands (money, phone
figures — probed live), so `rtl:` must never be used inside an island —
logical properties there; and an `@custom-variant rtl` override of the
built-in name is SILENTLY IGNORED by Tailwind 4.3, which is why the rule is
a comment, not a declaration. i18n 22/22, builder-sections 73/73. **DEPLOYED
13 Aug 2026** — the back arrow's `rtl:-scale-x-100` computing `scale: -1 1`
in production Arabic doubled as this deploy's build-identity marker.

**LB.29 — DONE. The Sheet's close button moves to the logical edge (12 Aug,
night).** `ui/sheet.tsx` positioned its close button `right-4` — a physical
edge, with LB.13's note recorded beside it — so in Arabic it sat over where
the title STARTS instead of at the inline end where a reader closes things.
It is `end-4` now. **The scope was corrected by measurement:** the backlog
said this also affects the mobile navigation drawer — it never did, because
that drawer is a custom component (`console-sidebar.tsx`) built
logical-first (`start-0`, `border-e`, `end-2`), and `ui/sidebar.tsx`, the
other Sheet consumer, is imported by nothing. The editor's preview drawer is
the ONLY live Sheet, and it is where the change was verified: at 375×812
mobile emulation the Arabic close button moved from x 343–359 to **x 17–33**
(inline end) and the French one stayed at the right edge, unchanged.
**Caveat, stated per the instruction rather than implied: no physical phone
is reachable from this environment** — verification is Chrome viewport
emulation with touch emulation, and the change is a single physical→logical
class swap with no layout arithmetic to disagree on. builder-sections 73/73
ran against the build carrying the change. **DEPLOYED 13 Aug 2026** and
re-verified on the real domain in Arabic at 375 px: the close button reports
`top-4 end-4` and sits at x 17–33.

**LB.30 — DONE. The rest of the storefront wears the store's theme, not the
visitor's dark mode (13 Aug).** The remainder LB.26 recorded: the store home,
the category page and the thank-you page rendered console tokens with no
theme scope, so all three followed the visitor's OS — measured live first,
near-black (lab L≈2.5) under an emulated dark OS, and the thank-you sits at
the END of the checkout journey, so a dark-phone customer bought on a light
themed page and landed on a near-black confirmation. **The design decision,
in two halves:** the thank-you INHERITS the theme of the landing page its
order came from (`order.landingPage.theme` → `toThemeData`, default fallback
like any unthemed landing page) — the confirmation should look like the page
the customer just bought on; home and category wear `DEFAULT_THEME`, because
`StoreSettings` has no theme field and growing one is a schema migration
plus a merchant-facing control — a product decision deliberately left OPEN,
with the two provider call sites carrying the note for where it slots in.
The mechanism is LB.26's existing plain-div `ThemeProvider` scope, no new
machinery. Verified live against the build carrying the change: all three
hold `#FAF9F6` + `color-scheme:light` with `html.dark` stamped and ignored;
a theme temporarily bound to the order's page flips the thank-you to that
theme's id and background, then unbound and re-verified; a light-OS visitor
with a stale `.dark` in localStorage gets the same stable canvas.
storefront 33 → **36**. **DEPLOYED 13 Aug 2026 (night)** — `e940f06`
rebased onto the deploy-record commit as `4f1b599` (docs-only conflicts;
the code merged clean) and re-verified on the real domain with a throwaway
tenant and two real API orders: the themed order's thank-you wears the
merchant's `#141414` theme under an emulated dark OS, home/category hold
the default, the unthemed order falls back cleanly; fixture swept with
`deleteTenant`, zero rows behind.

### LB.31–LB.36: DEPLOYED (13 Aug 2026, late night)

The six slices below (LB.31 the branding leak, LB.32 the editor's sticky
header, LB.33 the checkout labels, LB.34 the landing-page archive, LB.35 the
per-page Meta pixels, LB.36 the brands scoping) were merged as
`bd6d664..fecc4ff` — a **clean fast-forward**, because master was already an
ancestor of the branch: it had been synced onto master's tip at the end of the
LB.30 deploy, before these six began. Nothing to rebase, no conflict to
resolve, and the merged tree hash is **identical** to the branch tip that was
tested and verified live — `git diff fecc4ff master -- apps packages` is
empty. The suites were re-run against the merged state rather than inherited
from the branch.

**DEPLOYED 13 Aug 2026 (late night), user-approved.** `origin/main` is
`d6a56b1` — these six went out together with LB.15 and LB.14a/b/c as
`bd6d664..d6a56b1`, a fast-forward of eighteen commits. Rollback point
`bd6d664`. Every slice was verified live on the real domain with a throwaway
tenant that `deleteTenant()` then removed completely; see
`HANDOFF_PRODUCTION.md` §1 for the per-slice evidence.

**✔ LB.35's MIGRATION IS APPLIED — 13 Aug 2026 (night), user-approved, as a
database action ON ITS OWN.** `LandingPage.trackingIntegrationIds JSONB` now
exists in `landingos_prod`. The DDL was previewed with `migrate diff` against
the live production database (exactly that one statement, no other drift),
pushed with the datasource confirmed `landingos_prod` in the output, and read
back afterwards: `jsonb`, nullable, the one existing page row NULL — which is
"inherit the tenant's whole set", what every page did before the column
existed. A second `migrate diff` then returned *an empty migration*. **No
`apply-rls` re-run**, as predicted: 49 tables with policies before and after
(no new table). Shell-env overrides only; `packages/db/.env` still names
`neondb`.

**That was a migration, NOT a deploy — and the code caught up the same night.**
For the few hours between them, production ran the LB.30 app tree against a
schema carrying one extra nullable column no deployed code read: the additive,
forward-compatible direction, and the reason the column had to land first.
That gap is now closed. The other five slices carry no schema change; LB.34
in particular needed none, writing the `ARCHIVED` enum value that has existed
since the port.

**One local hazard this uncovered, worth knowing before any suite run:**
`npm run builder:build` regenerates the APP's Prisma client
(`apps/website-builder/src/generated/prisma`) through its own prebuild, but
**not** `packages/db/prisma/client`, which is a second generated client the
storefront path uses. After LB.35 merged, that client did not know
`trackingIntegrationIds` and every published-page render 500'd with a
`PrismaClientValidationError` — one red test in builder-sections that had
nothing to do with the change under test. Fix is
`npm run generate --workspace @landingos/db`. **After any schema change, both
clients have to be regenerated.**

### Housekeeping — the dev-tenant sweep, and the number was not five (13 Aug, night)

**Authorised: "5 leftover test tenants from an earlier, unrelated session are
still sitting in the dev database — sweep them with `deleteTenant()`."**
Measuring before deleting found something materially different, so the sweep
was scoped to what was actually authorised and the rest is reported here rather
than acted on.

**What is in `neondb`:** at the start, **224 tenant rows**. Two are the real
local fixtures (`demo` — Demo Trading Co., `acme` — Acme Trading). The other
222 are contract-suite tenants, by day of creation:

| Day | Tenants |
|---|---|
| 2 Aug | 14 | 
| 3 Aug | 7 |
| 5 Aug | 17 |
| 6 Aug | 92 |
| 7 Aug | 65 |
| 8 Aug | 1 |
| 10 Aug | 22 |
| **12 Aug** | **6** |
| 13 Aug | **0** |

**The 12 August cluster of 6 is the "earlier session" in the instruction** —
`erp-delivery-*`, `erp-carrier-beta-*`, `erp-shipment-beta-*`,
`erp-screens-*`, `erp-screens-builder-*`, `erp-screens-beta-*`, all created
between 02:32 and 02:35. Six rather than five, because that session ran two
ERP suites; same session, same cluster.

**Swept, with `deleteTenant()`:** 6 tenants, **163 product-domain rows**, 2
passes each, every tenant row gone, **0 rows remaining for those slugs**, and
**0 orphans** across `LandingPage`, `SalesOrder`, `CatalogProduct`, `Client`,
`FinancialRecord` and `Membership` read back afterwards.

**NOT swept, deliberately: the other 216.** A go-ahead for five tenants is not
a go-ahead for two hundred, and `deleteTenant()` is total and irreversible —
so the default chosen here was the reversible one. They are all from 2–10
August, i.e. **before LB.27's `deleteTenant` hooks landed on the suites**, and
they are harmless where they sit: `neondb` is dev/tests only, and the orphan
count is zero, so LB.27's bulk clean still holds. They cost Neon storage and
they make any unscoped "how many tenants" reading in dev meaningless.

**If you want them gone, that is one decision and one command** — the shape is
`asPlatform().tenant.findMany()` for every slug that is not `demo` or `acme`,
then `deleteTenant(id)` per row, with the same read-back. Worth doing in one
sitting rather than piecemeal.

**One thing this measurement quietly proves: LB.27 works.** **Zero** tenants
were created on 13 August despite this session running builder-sections,
storefront, builder-api, hardening, calc, console-shell, tracking, i18n and
platform/domains repeatedly. Every one of those suites cleaned up after itself.

### LB.14c — the console flow ALREADY EXISTS; one gap closed, one scoped (13 Aug, night)

**DEPLOYED 13 Aug 2026 (late night).** Asked for as "a UI for a tenant to
configure their own custom domain from inside the console", with the sensible
worry that it might need DNS/SSL nobody here can test. **The premise measured
false: the whole flow was built as `CAPABILITY_AUDIT` B5 on 10 August and is
deployed.** That is the third time this queue has asked for something already
shipped (LB.33's fresh-form defect and LB.35's single-pixel claim were the
others).

**What exists, confirmed by reading it and by driving it in the running
console:**

| Piece | Where |
|---|---|
| Schema | `TenantDomain` — `domain @unique` (globally, because one hostname belonging to two tenants is unresolvable by definition), `verificationToken`, `verifiedAt`, `isPrimary` |
| Claim / list | `POST` / `GET /api/platform/domains` — hostname normalised, platform's own names refused, 5 per workspace, `409 DOMAIN_TAKEN` from the cross-tenant `@unique` |
| **Real DNS proof** | `POST /api/platform/domains/[id]/verify` — `resolveTxt("_landingos-verify.<domain>")` via `node:dns`, exact token match, nothing else writes `verifiedAt` |
| Primary / unlink | `PATCH` / `DELETE /api/platform/domains/[id]` |
| Console screen | `/console/settings/domains` + `domains-manager.tsx`, i18n'd, gated on `platform:domains:manage` (SENSITIVE → OWNER/ADMIN) |
| Read side | `tenantByDomain` refuses any row without `verifiedAt`; the `tenant_isolation_verified` RLS policy, guarded since `90f3d43` |
| Tests | `test/platform/domains.test.ts`, now 14 |

Driven live: claiming `shop.lb14c-probe.dz` produced the pending row, the TXT
record name, the token value and the CNAME target, all in French; Vérifier ran
a real DNS lookup and failed correctly; unlink removed it. **So the DNS half is
not missing and does not need to be built.**

**What WAS wrong, and is now fixed** — see the commit before this one. The
verify route distinguishes two failures on purpose ("no record" = keep waiting
for propagation; "records exist but none match" = you published the wrong
string — the opposite instruction), and both reached the merchant as
`Cela n'a pas fonctionné.` One code carried both meanings, and B5 had mapped
**none** of its five refusal codes in `action-errors.ts`. Split into
`DNS_NO_RECORD` / `DNS_TOKEN_MISMATCH`, six messages added in en/fr/ar.

**⚠ WHAT CANNOT BE BUILT HERE, AND IT IS THE PART THAT MAKES THE FEATURE REAL.**

A verified row in the database does not make a hostname serve. Two more things
must be true, and only one of them is the merchant's:

1. **The merchant points the name at the platform** (CNAME to
   `landingos.onrender.com`). The screen already tells them to.
2. **The platform operator adds that hostname to the Render service, and Render
   issues its TLS certificate.** Until then the request never reaches the app
   at all — **already proven, not theorised**: `resolve-tenant.ts` records that
   Render answers **403 with `x-render-routing`** for an unconfigured hostname,
   measured by a deploy probe. There is no Render API credential on this
   machine (`HANDOFF_PRODUCTION.md` §3), so step 2 cannot be automated, tested
   or even observed from here.

**Consequence, stated plainly for the handoff: custom domains are complete in
the application and INERT IN PRODUCTION until the operator adds each hostname
in the Render dashboard.** A merchant can claim, verify and mark primary today
and their domain will still 403. Nobody is affected yet — `landingos_prod` held
**0 `TenantDomain` rows** at the last measurement — but the first merchant who
tries will get no explanation.

**Three options, for the decision that is yours:**

- **(a) Manual/support step, documented.** After a merchant verifies, the
  operator adds the hostname in Render. Cheapest and honest. Needs the screen
  to SAY so — today "Vérifié" implies done, and the merchant has no way to know
  a step remains. **Recommended**, and it is the only one buildable without
  credentials.
- **(b) Automate through Render's API.** A `RENDER_API_KEY` + service id, a call
  to add a custom domain on verify, and polling for certificate issuance. Real
  work, and it puts a deploy-platform credential inside the app — worth
  weighing against how many merchants will ever use this.
- **(c) Terminate TLS somewhere the platform controls** (a proxy in front of
  Render with on-demand certificates). Largest change, removes the manual step
  entirely, and is an infrastructure decision rather than a code one.

**One defect that waits on the same decision, recorded so it is not
rediscovered: `isPrimary` is written and has no functional reader.** The PATCH
route's own comment says "Primary means the hostname canonical links use", and
nothing uses it that way — the storefront's `canonical` is deliberately
path-only, `storefrontHref` branches on `viaCustomDomain` rather than on
primary, and **the editor's Copy Link builds its URL from
`window.location.origin`, which is the CONSOLE's host.** So a merchant with a
verified primary domain still copies a `landingos.onrender.com` link. That is
the platform's most-caught defect class (a column with a writer and no reader,
nine times before) — and it must NOT be "fixed" until (a), (b) or (c) is
chosen, because pointing Copy Link at a domain that 403s would replace a link
that works with one that does not.

### LB.14b — SCOPED, NOT BUILT. Page version history (13 Aug, night)

**No code, deliberately: it needs a new table, therefore a production
migration, and this session was explicitly not to require one.** What follows
is the measurement and the proposal, so the decision can be made rather than
discovered halfway through building.

**What exists today — confirmed, not assumed.** Nothing. No `*Version`,
`*History` or `*Snapshot` model exists on `LandingPage`; the whole schema
contains exactly one history table, `SalesOrderStatusHistory`, which is about
an order's status and nothing else. Every one of the editor's saves is a
destructive overwrite.

**The write surface a snapshot would have to hook — measured: eleven routes**
under `/api/builder/landings/[id]/`: `general`, `pricing`, `shipping`,
`order-form`, `media`, `variants`, `features`, `reviews`, `faqs`,
`delivery-prices`, `publish` — plus `archive`, the top-level `[id]` PATCH, and
`duplicate`. They are separate on purpose (a section saves explicitly, which
`BUILDER_AUDIT.md` M-02 itself calls "fine as a model"), and that is exactly
what makes a snapshot hook awkward: **there is no single write path to hang it
on.** Any design that hooks eleven routes will be missing the twelfth within a
month — which is precisely the drift that had already happened to `duplicate`
(fixed in the commit before this one).

**What a snapshot must contain.** `LandingPage` plus seven owned relations:
`media`, `variants`, `features`, `reviews`, `faqs`, `setting`,
`deliveryPrices` — and now `trackingIntegrationIds`. `duplicate` is the one
piece of code that already knows this list, which is both the reason it is the
right starting point and the reason it is dangerous: it is the same list, and
it has already gone stale twice.

**How big one is — measured on real dev pages** (whole page + all relations,
as JSON): 595 B for an empty page, **1.4–3.6 KB** for pages with 1–3 images and
up to 6 variants. A rich page with a photo gallery and fifteen variants is
plausibly 10–20 KB. At one snapshot per section save, a merchant editing hard
for a day writes a few hundred KB. **That is small enough that the storage is
not the argument** — the arguments are all about correctness.

**The three questions that are product decisions, not engineering ones:**

1. **When is a version taken?** Per section save is the honest reading of "no
   way back" and produces a version list dominated by trivia (eleven entries
   for one afternoon's work on one page). Per publish is a much better list and
   does not help the case M-02 actually describes — a mis-save on a page that
   is not republished. A third option, "snapshot the state BEFORE the first
   save of a session and label it", is closer to undo than to history.
2. **What does restore do to a page that has SOLD?** `SalesOrder` rows point at
   `landingPageId`, and LB.30's thank-you page reads `order.landingPage` to
   theme itself. Restoring a price is therefore visible on the confirmation
   page of an order taken at the OTHER price. LB.34 already settled the
   neighbouring question — a page that sold something may not be hard-deleted —
   and restore needs the same kind of answer stated up front.
3. **Does restoring change `published`/`status`?** LB.34's precedent says
   restore-from-archive lands on DRAFT so nothing republishes itself. A version
   restore that silently re-publishes a page would be worse.

**The shape recommended, if it is built.** One additive table:

```
LandingPageVersion
  id, tenantId, landingPageId, actorUserId?, reason (save|publish|restore),
  snapshot Json,          // the page + its seven relations, duplicate's list
  createdAt
  @@index([tenantId, landingPageId, createdAt])
```

A Json snapshot rather than shadow tables, for LB.35's reason on
`trackingIntegrationIds`: the value is small, always read whole, and never
queried from the other side. Restore rebuilds by DELETING the owned relation
rows and recreating them inside `withTenant`'s existing transaction — the same
shape `variants`'s PUT already uses, so it is a known-safe pattern here.

**Cost:** **M–L. One additive table → a production `db push` → an `apply-rls`
run moving 49 → 50.** That is the whole reason it is not in this session:
`CAPABILITY_AUDIT.md` B7 said the same thing in different words, and it has
been true every time it was re-measured.

**What was built instead, because it needed no migration and was the same
finding:** `duplicate` was quietly dropping the two parts the page grew after
LB.6 wrote it. Until version history exists, duplicating a page before a risky
edit is the only way back a merchant has, and a lossy copy is worse than no
copy because it looks like a backup. See the commit and the CHANGELOG entry.

### LB.14a — DONE. The storefront caching story, and what it refuses (13 Aug, night)

**DEPLOYED 13 Aug 2026 (late night)** — and it supplied the deploy's own
marker; see `HANDOFF_PRODUCTION.md` §1. `BUILDER_AUDIT.md` P-01 asked for a
decision rather than a change. Measuring produced the opposite of the expected
finding.

**What was actually being sent, measured with `curl -D -`:**

| Response | Before | Consequence |
|---|---|---|
| `/[tenant]`, `/[tenant]/[slug]`, `/[tenant]/category/[slug]` | `private, no-cache, no-store, max-age=0, must-revalidate` (Next's `force-dynamic` default) | strictest possible; forbids even a back-button redisplay |
| `GET /api/storefront/[t]/wilayas` — **the delivery quote** | **no `Cache-Control` at all** | RFC 9111 §4.2.2 lets a shared cache assign its own heuristic freshness |
| `GET /api/storefront/[t]/tracking`, `/meta-pixels` | **no `Cache-Control` at all** | same |
| `/[tenant]/thank-you/[orderId]` | the dynamic default | correct — but by accident, not by decision |

So the marketing pages were locked down hard enough to hurt, and **the one
response whose staleness costs a customer money carried no instruction at
all.** That is the finding.

**Timings, for scale** (dev machine → Neon eu-central-1, so this is an upper
bound): landing page **1.12–1.90 s** TTFB / 120 KB; store home **0.73–0.87 s**;
the wilayas quote **0.54–0.73 s**. Every one a cold database round trip.

**The rule, now in `src/lib/storefront/cache-policy.ts` with the argument
attached:** *a response may be reused by a SHARED cache only if a stale copy of
it cannot cost somebody money or expose somebody's order.*

That is deliberately stricter than "product data changes rarely", and the
reason is custom domains: a storefront is reachable at a MERCHANT's own
hostname, they are free to put Cloudflare in front of it, and **this platform
has no way to purge it.** `public`/`s-maxage` would be a promise we cannot take
back once a price changes.

**Why the public pages are not shareable either**, which is easy to miss
because they look like static marketing:

1. **Every one of them renders a price** — the product page in its hero and its
   JSON-LD, home and category in each card — and the checkout recomputes the
   price server-side from the row (the storefront suite asserts the server
   ignores what the browser submits). A stale copy does not look wrong, it
   **takes an order at a number the customer never agreed to.**
2. **LB.34 made archive the delete.** A shared copy of an archived page keeps
   selling a product the merchant retired.

**What changed:** public pages `private, max-age=60, must-revalidate`; the
delivery quote, both pixel-config routes and the thank-you page
`private, no-store, max-age=0, must-revalidate`. The 60 seconds is the one real
win available — it makes a back navigation free on a phone, and it adds no
hazard class that was not already there, because a page left open in a tab is
already unboundedly stale.

**ISR is UNAVAILABLE, not declined — and this was measured because "just add
`revalidate`" is the obvious suggestion.** `export const revalidate = 60` was
put on the category route with `force-dynamic` removed. The build still emitted
`ƒ /[tenant]/category/[slug]  (Dynamic) server-rendered on demand`, **with no
warning and no error**, and at runtime the route still sent `no-store` and
still cost a round trip per request. The cause is structural:
`resolveStorefrontTenant` asks `tenantByDomain` FIRST because a custom domain
wins over a path prefix (decision D2), that reads the `Host` header, and
`headers()` is a Dynamic API — so a `revalidate` export on a storefront route
is **inert while looking deliberate**, the shape this project has been caught
by three times (the Tailwind `calc()`, `--theme-background`, `rtl:`).

**Two mistakes the config made before the response was read** — both now pinned
by tests that assert the SERVED header, never the config:

- **Next applies every matching header rule, later ones overriding earlier.**
  The thank-you `no-store` was written first, assuming first-match-wins, and
  the broad tenant rule silently overrode it: **a customer's order confirmation
  was answering `max-age=60`.** It is now both last and excluded from the broad
  rule, so it does not depend on ordering semantics at all.
- **`.*` in the tenant segment matches the EMPTY string**, so the bare root `/`
  was caught and its 307 to `/console` started being cached for a minute. The
  root is the one path whose meaning depends on the Host (platform root →
  console; a verified custom domain's root → that tenant's storefront,
  `acbc96a`), and a header chosen by PATH cannot tell them apart, so it keeps
  the framework default. `.+`.

**Stated boundaries of this decision, so the next person does not have to
rediscover them:**

- A custom domain's storefront HOME is served by `/`, which is deliberately
  left uncached for the reason above — so a path-prefix home gets the 60 s and
  a custom-domain home does not. Fixing that needs the same front-door split
  ISR needs.
- A **404 is cached for 60 s too.** That fails closed (an unpublished page
  stays unavailable), but a merchant who publishes and immediately reloads the
  public URL in the same browser can see their own stale 404 for up to a
  minute. A hard reload clears it.
- Nothing here reduces database load. The DB cost per render is unchanged; only
  the repeat-visit and back-navigation cost moved. **The load fix is the
  front-door split, scoped below.**

**Scoped, not built — LB.14a.2, "one front door per tenant identity."** To make
storefront pages statically cacheable, path-prefix rendering must not read a
header. Shape: resolve custom domains in one place that runs BEFORE the page
(a rewrite that turns `shop.acme.dz/x` into `/acme/x` internally), so
`/[tenant]/[slug]` renders from params alone and can take `revalidate`. It
touches D2's "a custom domain wins" guarantee, the `X-Forwarded-Host` trust
rule recorded in `resolve-tenant.ts`, and every storefront test — a real slice
with a real blast radius, and it needs the price-staleness question answered
first (a cached page and a server-side price are the same divergence as
before, only now with a TTL). **Not started.**

**Verified live across nine paths** against the running build; console screens
and `/_next/static/*` (still `public, max-age=31536000, immutable`) are outside
the rule. storefront 40 → **48**; console-shell 20, hardening 12, tracking 15,
builder-sections 74 unaffected.

### LB.35b — DONE + DEPLOYED. The control LB.35 never built (13 Aug, late night)

**`dd4edac`, DEPLOYED 13 Aug 2026 (late night).** Confirmed on production against a pre-push baseline: `tracking-mode-all` 0 → 1, and a real save in the production editor stored the subset and changed which pixel the production storefront serves. The section below records what was measured; this is
what was built in answer to it.

**A mode switch, not a checkbox list.** The column has three states and a list
of ticks expresses two — with checkboxes alone, "nothing ticked" would have to
mean either *all* or *none* and could not mean both. So: **All your tracking**
(`null`) or **Choose which ones** (`[ids]`), and inside "choose", ticking
nothing is `[]`, which the storefront honours as *none* rather than treating as
unset.

**Two decisions that exist to protect reporting.** Switching to "choose"
pre-selects every ACTIVE integration rather than starting empty: an empty start
reads as "turn everything off" at the exact moment a merchant asks to be more
specific, and one careless save would stop their reporting. And **inactive
integrations are listed and marked, not hidden** — one fires nothing today, but
a page linked to it stays linked, and showing only active rows would silently
drop that link on the next save, so the page would come back different from how
it was left.

**The empty selection is called out on screen.** Legal, honoured, and the one
choice that stops reporting without producing an error — so the merchant reads
that they made it rather than discovering it in an ad account.

**A guard lesson worth keeping.** `t(cond ? a : b)` is invisible to the
key-exists scan and looks like hardcoded English to LB.13's guard; it failed
exactly that way first. Two literal `t()` calls with the ternary *outside* are
covered by both, and the component says so where it does it.

`builder.editor.integrationsBody` was **deleted**, not reworded — orphaned the
moment the signpost went, and its text ("applies to every page automatically")
had become untrue.

**Verified live in the running editor, in French, all three states end to end:**
"all" → stored `null`, storefront served both active pixels; subset → stored
`["<id>"]`, served that one and not the other; nothing ticked → stored `[]`,
served **no** pixels with the page still 200. The inactive pixel stayed out
throughout (the resolver filters `isActive` first). builder-api **37 → 41**.
**No migration.**

**Still open, deliberately:** the "all" mode does not list which integrations
it means — it says "every active integration" in words. Showing them greyed
would be informative but re-raises the question this design settles, so it is
left until somebody asks for it.

### (the measurement this came from) LB.35's CONSOLE CONTROL WAS NEVER BUILT — 13 Aug

**Reported by the user as "the per-page Meta pixel control is not visible on my
real account". It was not visible because it did not exist.**

**The code IS live** — LB.35 shipped in the `bd6d664..d6a56b1` range and is
verified in production: the column is on `landingos_prod`, the storefront
honours it, and a duplicate carried an explicit one-integration subset through
the real route. The mechanism works end to end.

**What LB.35 actually built.** Its commit (`a234d48`) touched: the four
storefront routes, `api/builder/landings/[id]/general/route.ts` (the PATCH
accepts `trackingIntegrationIds`), `storefront-tracking.tsx`,
`lib/storefront/tracking.ts`, the schema, tests and docs. **Zero editor
files.** `trackingIntegrationIds` appears in no `.tsx` anywhere in the repo.
Its own "verified live" note describes linking a page to a pixel — that linking
was done through the API, and the commit never claims a console control.

**What the user is looking at.** The editor HAS an "Integrations" section, and
it renders a signpost: one sentence plus a link to
`/console/settings/integrations`. Its comment says a per-page panel "would be a
second place for the same settings" — written before LB.35, and now out of
date, because per-page selection is exactly what LB.35 made meaningful. So the
merchant opens the section named Integrations, is told integrations live at the
workspace level, and has no way to choose pixels for one page.

**Was not fixed in that session because it is not small — built as LB.35b
immediately afterwards, see above.** It needed a real slice: load the
tenant's `TrackingIntegration` rows into the editor, a control expressing
**three** states (NULL = all active integrations, `[]` = none, `[ids]` = an
explicit subset — the column's own semantics, and an empty array is honoured
as "no tracking here"), the save path through the general route, ~3 locales of
copy, and tests. It also needs one product decision: whether the default
NULL should be shown as "all" or as "not configured", since they look
identical and mean the same thing today.

### LB.35b RE-VERIFIED ON PRODUCTION — 14 Aug. It was already built and deployed

**Requested again as "build the per-page Meta pixel UI control that's been
missing since LB.35". It was built earlier the same session (`dd4edac`) and
deployed (`407854a`), and the design asked for is the design that shipped** —
so it was re-verified rather than rebuilt. Recorded here because a second
request for work already done is worth answering with evidence, not a claim.

**The spec, point by point, against what is live:**

| Asked for | Live on production |
|---|---|
| Measure the three states end to end | `selectedIds()` returns `null` for anything non-array, so **SQL NULL and JSON null both mean "inherit all"** — the reader is robust to Prisma's Json-null subtlety |
| NULL should mean "inherit all active integrations" | It does. The UI shows **"Tout votre suivi"** with the hint *"C'est le réglage par défaut"* |
| Zero pixels must be distinct and deliberate, not the same as "not configured" | It is: a **separate mode**, then untick everything, which raises *"Aucune sélection : cette page ne remontera à aucun de vos suivis."* |
| Verify against how the field is actually read today | Done — the reasoning was checked against `lib/storefront/tracking.ts`, not against a summary |
| Control in the Integrations section, replacing the signpost | Yes; the signpost survives only for a tenant with no integrations connected |
| Save path, three locales, tests | `general` route; ar/fr/en; builder-api 37 → 41 |

**Re-measured end to end on production, 14 Aug, on a throwaway tenant with two
active pixels:**

| State | Stored | Storefront serves |
|---|---|---|
| never touched | `null` | **both** pixels |
| explicit subset | `["<pixelA>"]` | **only** that one |
| explicit empty | `[]` | **none** — page still 200, no fallback to all |
| back to unset | `null` | both return |

Switching to "choose" pre-selects **every active integration**, so the
transition out of "inherit all" cannot silently reduce reporting — which is the
same safety argument the request made from the other direction. Fixture swept
with `deleteTenant`.

### LB.42 — DONE, NOT DEPLOYED. The write-panels stop speaking English (14 Aug)

**`262f258`, local only.** Asked for as "the six write-panel strings".
**There were 37**, and finding that out is most of what this slice is.

**Six was my own number and it was wrong.** It came from a rough grep in LB.41
that looked for `label:` props. Pointing LB.13's guard at
`components/console/platform` found **22 immediately** — JSX ternaries and
`pendingLabel` props the grep had never looked at.

The panels now take their words as a **prop** rather than reading a catalogue.
That is this console's stated convention for client write controls
(`lib/console/action-errors.ts`): the server translates once and hands the
result down, so a write control never depends on whether messages happen to be
available client-side. It is the same shape `PageRowActions` uses.

#### The guard had two holes, and both were found by reading the page

**1. It scanned LINE BY LINE.** So it could only ever see text sharing a line
with the `>` that opened it. Prettier puts a long label on the next line:

```
<span className="…">
  Label <span aria-hidden>*</span>
</span>
```

and the scan walked past it. **Fourteen more strings** were sitting in plain
sight — `Label`, `Signing secret`, `Send test`, `Confirm delete`, `Deliveries`.
A whole-file pass catches them now, and it also turned up a **third screen
nobody had counted**: `settings/delivery-prices` ("Save", "Saved {n} wilayas.").

**2. Then the new pass still missed one.** The code-shape filter rejects
anything containing a semicolon — and **`&apos;` ends in one**, so
`Events Manager&apos;s test tab` read as code to a filter looking for code.
Entities are decoded before that test now.

Both were caught the same way: **reading the rendered page after the guard
reported clean.** A green scan is evidence about the scan.

#### What was deliberately NOT translated

Six ternaries in three other files — `variant={x ? "danger" : "ghost"}`,
`action={s ? "suspend" : "reactivate"}`, `aria-pressed={p ? "true" : "false"}`.
Those are machinery, not prose, and translating them would have been the wrong
fix. The ternary branch now skips a lowercase single word, exactly as the
jsx-text branch already did — so the guard stops asking.

`publicIdLabel: "Pixel ID"` and `serverTokenLabel: "Conversions API access
token"` in `lib/tracking/config.ts` stay English. They are the names Meta uses
in its own dashboard, and a merchant reading both screens at once is better
served by them matching. **A product call, not a cleanup** — and that file is
provider data rather than a component, so it is outside the guard's scope by
design. If it is ever revisited, the question is per-provider: whether a
vendor's field name should be localised at all.

Verified on the running build in all three locales: fr *Plateforme / Libellé /
Connecter / Envoyer un test / Créer le point de terminaison*, ar *المنصّة /
التسمية / ربط / إرسال اختبار*, en unchanged. The only English left on the screen
is the two vendor field names above. i18n 22, builder-sections 74, storefront
66, builder-api 41, console-shell 20, hardening 13, webhooks 10, tracking 15.
**No migration.**

### LB.41 — DONE + DEPLOYED. The store settings screen answered in a fourth language (14 Aug)

**`94b6a40`, DEPLOYED 14 Aug 2026** (`ce883f1..c3b1917`). Confirmed on production against a pre-push baseline: on a French account the store screen went from "Store name" to "Nom de la boutique" and the integrations column header from "Managed by" to "Géré par". Investigated as a production error on
`/console/settings/store`, digest `2216248186`.

#### The error does not reproduce — here is exactly what was tried

A fixture was built shaped **exactly** like the real production tenants, after
reading their rows first rather than assuming: **no `StoreSettings` row**,
OWNER membership, **TRIALING** subscription with both entitlements, `ar`
locale. (The StoreSettings-row lead is worth recording as settled: **all three
real tenants have no row**, so "no row" cannot be the cause on its own — the
screen falls back to `session.tenant.name` and renders.)

Against that fixture, on production:

| Path | Result |
|---|---|
| `GET /console/settings/store` | **200**, form renders, all 12 fields |
| Text save (server action) | redirects `?saved=1`, value persists |
| Image upload → R2 | stored, and the file serves back with `image/png` + immutable caching |

Every path on that screen is healthy. **The digest is unresolved**, and the
candidates in order:

1. **A Neon `P1001` transient** — the strongest. This project hits them
   repeatedly, and one inside a server component surfaces exactly this way:
   the component throws, `console/error.tsx` renders, and the digest is all
   the user sees. Unreproducible by nature.
2. A one-off on an older build. The screen itself has not been touched since
   B4, so nothing recent broke or fixed it.
3. Something specific to that session that a fixture cannot recreate.

**There are no Render logs and no dashboard access**, so a digest without a
reproduction cannot be traced further. If it recurs, the thing worth capturing
is the TIME — a transient shows up as a cluster, a code fault does not.

#### What was found instead, and fixed

`/console/settings/store` was **the only console screen still rendering
user-facing English**: twelve field labels, both error messages, the saved
banner, Remove and Save. A merchant on an Arabic account met a translated page
frame wrapped around an English form, right-to-left — which is a fair
description of "this screen is broken", and may well be what prompted the
report alongside whatever produced the digest.

It escaped LB.13's guard because that scan covers the **editor** directories
and nothing else. The guard now covers `app/console/settings`, and extending it
immediately found a second screen: **`settings/integrations`, 13 more strings**
that a first rough grep had missed because they were JSX ternaries rather than
`label:` props. **Both screens are fixed** and the guard left covering the
directory — narrowing it to dodge a known defect is the exemption list its own
comment warns against.

One test broke correctly: it asserted the English sentence "administrator
access", which stopped appearing once the screen was translated (these fixtures
take the default locale, `ar`). It reads the **catalogue** now instead of a
copy of the prose, plus a structural assertion that a manager is handed no
create panels — which survives any rewording.

Verified on the running build in all three locales: fr *Nom de la boutique /
Enregistrer*, ar *اسم المتجر / حفظ*, en unchanged; the integrations headings
and status cells translated in fr and ar. **No migration.**

**Recorded, NOT fixed at the time — CLOSED by LB.42 above, and the count was
wrong.** This said "six strings" in the client write-panels, from a rough grep.
Extending the guard to `components/console/platform` found **37**, because the
grep looked for `label:` props and the scan itself could not see JSX text that
wrapped onto its own line. Kept as written, because the undercount is the point:
a number produced by grepping is not a measurement.

### LB.40 — DONE + DEPLOYED. robots.txt stops inviting crawlers in (14 Aug)

**`f1e38bf`, DEPLOYED 14 Aug 2026** (`c89b19b..0286f99`). Confirmed on production against a pre-push baseline: `Googlebot` 1 → 0, `Disallow: /console/` 0 → 1, and the platform host still names no sitemap. Asked for as "add the robots.txt". It is a
**replacement**.

**The finding, and it corrects my own note.** `public/robots.txt` already
existed and had been serving in production: five blocks — Googlebot, Bingbot,
Twitterbot, facebookexternalhit, `*` — every one `Allow: /`. §LB.39's proposal
said "both are reserved slugs and neither route exists", which came from
grepping `src/` and never looking in `public/`. One `curl` to the live host
would have found it. **Same failure LB.37 produced: reasoning about code
instead of reading the response.**

**Not a live incident, and the distinction is the point.** robots.txt governs
CRAWLING, the meta governs INDEXING — LB.37's `noindex` meant the console was
fetched and correctly never indexed. The cost was crawl budget on auth-gated
redirects and on `/api`, where the checkout route keeps a per-IP rate limit a
crawler has no business consuming.

**Why a route.** A static file is identical on every hostname, and this app
answers on two KINDS of hostname whose right answer differs:

- **Platform host** — many shops, so it names **no** sitemap. The only file it
  could name lists every tenant at a guessable URL: LB.39's roster objection.
- **Verified custom domain** — one shop, no ambiguity, so it names that
  merchant's sitemap and nobody else's. Exactly the case §LB.39 flagged.

**The static file WON while both existed** — measured, not reasoned about: the
served body was still the old five blocks and `app/robots.ts` was completely
inert until `public/robots.txt` was deleted. Shipping without that check would
have looked like a working feature. The tests assert the SERVED body and name
the four old user-agents as what must never come back.

**`Disallow` and `noindex` stay together.** Different instructions, neither
replacing the other: a disallowed page can still be indexed URL-only if
something links to it (so `noindex` stays), and a `noindex` page still costs a
fetch (so the disallow is here).

**Tests use `node:http`, not `fetch`** — `host` is a forbidden header name in
fetch and is silently dropped, measured after a `headers: { host }` request
returned the platform answer and would have asserted nothing. Both gates
pinned: a forged `X-Forwarded-Host` at a platform address adds no sitemap, and
an **unverified** domain gets the platform answer rather than a shop's.

storefront **60 → 66**. **No migration.**

**Still open, deliberately:** the platform host names no sitemap, so a crawler
finds each shop only by following a link into it. Handing crawlers the full
list is the disclosure decision that stays the user's — §LB.39 option 3.

### LB.39 — DONE + DEPLOYED. Each shop gets a sitemap (13 Aug, late night)

**`dbe1cf0`, DEPLOYED 13 Aug 2026 (late night).** Confirmed on production
against a pre-push baseline: `/{tenant}/sitemap.xml` **404 → 200**, absolute
`https://` URLs, the four right entries and all five exclusions absent.

LB.37 settled which storefront pages may be indexed
and left nothing telling a crawler where to look. This is the same decision
written where it will be read.

**The set, and why it cannot drift from LB.37.** Included: the store home,
every visible category, every published page. Excluded: thank-you (LB.37 marks
it `noindex` — it carries a name, a wilaya and a total), drafts, archived
pages, and the console, which is not under this layout at all. The exclusions
are not filters added afterwards — each is the **same predicate the page
itself uses** (`published: true AND status: PUBLISHED`, `isVisible: true`), so
a page that 404s cannot be advertised. A sitemap listing a 404 is worse than
none: it spends a crawler's budget and teaches it the host is unreliable.

**A route handler, not `sitemap.ts` — measured, not preferred.** Next's
metadata convention does not pass route params. At `[tenant]/sitemap.ts` the
exported function is invoked with `undefined` and dies destructuring it (a real
500, reproduced before the approach changed). The documented way to vary one is
`generateSitemaps`, which enumerates ids up front — for this app that means
listing every tenant, i.e. publishing the customer roster to anyone who asks. A
route handler takes `params` exactly as the four storefront routes already do.

**Under `[tenant]`, not at the root, for the same reason.** `/sitemap.xml` on
the platform host could only be every tenant's pages in one file (the same
roster leak) or nothing at all, and neither is a shop's sitemap. Each merchant
gets `/{tenant}/sitemap.xml`, read through the same `withTenant` binding as
every other storefront query — asserted both ways round, since a sitemap is
precisely the shape a tenant leak would take.

**`currentOrigin()` is new in `resolve-tenant.ts`** because a sitemap is the
one thing this app emits that cannot be path-relative. It reuses
`currentHost()` rather than reading a header itself: the rule about which
header may be believed stays stated once, so a spoofed `X-Forwarded-Host`
cannot put another hostname into a merchant's sitemap. The scheme is derived
from the host rather than `X-Forwarded-Proto` — also client input, and trusting
it would add a second spoofable input for nothing.

**Custom domains are not special-cased,** deliberately. `currentOrigin()` is
whatever host the request arrived at, and the tenant prefix is correct there
because `app/page.tsx` REDIRECTS a custom domain to `/{slug}` rather than
serving at `/`. Whether that prefix should exist is LB.14a.2, scoped and
unbuilt; a sitemap must describe the URLs that answer today.

**`lastModified` is real** — `updatedAt` off the row listed; the home borrows
the newest thing it links to, which is what "this shop changed" means. A test
asserts every value parses and none sits in the future, because a static date
teaches a crawler to stop believing the ones that are true.

**No `Cache-Control` is set by the route:** `next.config.ts`'s storefront rule
already gives this path `private, max-age=60, must-revalidate` (LB.14a), which
is right for a document carrying no price and no order — and a second value
here is how the two would drift apart.

Verified live on a fixture holding one of every case: four URLs emitted, five
kinds of row correctly absent (hidden category, draft, archived, the
`published: true` + `status: DRAFT` half-state, thank-you), unknown tenant
**404** rather than an empty shop, `/console/sitemap.xml` still 404. storefront
**54 → 60**. **No migration.**

#### robots.txt — BUILT as LB.40 (14 Aug), and this proposal was wrong on a fact

**Read the correction in §LB.40 below before this section.** The analysis of
the three options held up and option 2 (plus the custom-domain case) is what
shipped — but the premise that "neither route exists" was **false**:
`public/robots.txt` existed and had been serving in production the whole time,
saying `Allow: /` to every crawler. The proposal below reasoned about a file it
never fetched. Kept as written, because the options are still the right ones
and the error is worth seeing next to them.

#### robots.txt — the original proposal (superseded by LB.40)

The natural pairing, and it was weighed rather than skipped. It is **not** the
small addition it looks like, for one reason: `/robots.txt` can only exist at a
HOST root, and this host is both the platform and every shop. A single file
would have to `Disallow: /console` while allowing `/{tenant}/…`, and it would
have to name a sitemap — but there is no single sitemap to name, because each
tenant has their own. That leaves three options, all product decisions:

1. **Per-tenant `robots.txt` at `/{tenant}/robots.txt`.** Consistent with the
   sitemap, and **useless**: crawlers only read the host root. Rejected.
2. **One platform `robots.txt`** disallowing `/console` and `/api`, listing no
   sitemap. Honest and cheap, but adds nothing the per-page `noindex` LB.37
   already emits — the console is already excluded by meta.
3. **One platform `robots.txt` that enumerates every tenant's sitemap.** The
   only version that actually helps discovery, and it publishes the full
   customer list at a guessable URL — the same objection that kept the sitemap
   out of the root.

**Recommendation: option 2, and only alongside a decision about (3).** It
costs a few lines and is strictly correct, but the discovery win people expect
from robots.txt is entirely in (3), which is a disclosure question for the
user, not a cleanup. **A verified custom domain changes the answer** — there
the host IS one shop, so a root `robots.txt` naming that shop's sitemap is
unambiguous and valuable. That makes this worth revisiting exactly when
LB.14c's hostnames actually reach Render, and not before.

### LB.38 — DONE + DEPLOYED. The hard delete finally gets a door (13 Aug, late night)

**`a70f588`, DEPLOYED 13 Aug 2026 (late night).** Confirmed on production
against a pre-push baseline: `page-delete` **0 → 3** with `page-archive`
unchanged at 4, `HAS_ORDERS` unmapped → mapped, the one row with an order
offering Archive and no Delete, a real delete removing the page from the
database, and a real 409 on the sold one.

Reported by the user as: the archive control IS
visible and working — the gap is that there is still no way to permanently
DELETE a page, even one that never had an order.

**Measured, and the report is exactly right.** The hardened `DELETE` route has
existed since LB.34: `409 HAS_ORDERS` for a page that has sold anything, real
hard delete otherwise. **It was wired to nothing.** `method: "DELETE"` appeared
in no component; `HAS_ORDERS` appeared nowhere outside the route file. The
route's own docstring says archiving "is what the console now offers" — true,
and complete. The consequence is small and constant: a mistyped draft could be
archived and never removed, so an archive intended for retired products
accumulated pages that had never been anything.

**What "delete" means here, confirmed before building:** full hard removal, as
the existing route already does — the row and its media, variants, features,
reviews and FAQs. Not a second kind of archive. That is only safe because the
route refuses anything with orders, and it refuses on the database's count
rather than on what the screen believed.

**Offered only at zero orders — belt and braces, deliberately.** The route is
the authority and refuses regardless. The button's absence is a separate
courtesy: a merchant should never be invited to press something that always
fails for them, and a control that always answers 409 teaches them the console
is unreliable. A page with orders shows Archive instead, which is the door that
works for it. The order count cost nothing — the list already selects
`_count.salesOrders` for its Orders column.

**A second gap found on the way.** `HAS_ORDERS` had no entry in
`action-errors.ts` — the `UNKNOWN_ADAPTER` and LB.14c pattern for a third time.
Normally unreachable now, but a list rendered before the first order arrived
and left open in another tab is the case that is not normal: the row says zero,
the database disagrees, and the reply would have been the generic "that didn't
work" for the one refusal in this screen that protects a merchant's revenue
history. It names Archive now, ×3 locales.

**Shown for ARCHIVED rows too**, when they are order-free — clearing that
archive out is the point of the request.

**Verified live in the running console, in French,** on a fixture with one page
of each kind: sold row → Archiver, no Supprimer; never-sold row → both; the
confirm names the loss as irreversible; the row leaves the table AND the
database (state afterwards lists only the sold page — not an archived pair).
The first click, where the browser auto-dismissed the native dialog, correctly
deleted nothing. A direct `DELETE` against the sold page still answers 409 with
the translated message. builder-api **35 → 37**, the new pair asserting the
DOOR rather than the route; storefront 54, builder-sections 74, console-shell
20, hardening 13, i18n 22 unaffected. **No migration.**

### LB.37 — DONE + DEPLOYED. A shop's `<head>` introduced it as the platform (13 Aug, late night)

**`fcbd1e5`, deployed the same night as `ab24466`.** Found while verifying the
LB.31–LB.36 deploy and fixed on the user's instruction immediately after.
Confirmed on one throwaway fixture measured before AND after the push, with
`/console/login` unchanged as the control that proves the fix landed at the
storefront layer rather than by weakening the root.

**What was measured, and one correction to how it was first reported.** A
storefront page served `<title>… · LandingOS</title>`, the platform's internal
tagline as its `description`, and — on the **store home and every category** —
`robots: noindex, nofollow`. All three come from the ROOT layout, whose
comment reads "Internal admin tool — never indexed": true when this app was
only a console, inherited by every storefront page since.

**The first report of this said the PRODUCT page inherits `noindex`. It does
not** — it has set `index: true` plus a canonical since it was written. That
claim came from reading the root layout and inferring inheritance instead of
reading the response. The routes actually excluded from search were the shop
FRONT and the whole catalogue structure, which is worse than the version
reported, and the lesson is LB.14a's again: **read the served response, not
the config.**

**The shape of the fix.** The root layout STAYS `noindex` — it is the
fail-closed default, and the console declares no `robots` of its own and
relies entirely on that inheritance (now pinned by a test that fails if
somebody "fixes" the root instead). The storefront opts IN at
`(storefront)/[tenant]/layout.tsx`, so a future route under it is public by
construction and a future route anywhere else is not. Title, description,
`robots` and `openGraph.siteName` are declared once there rather than in four
pages, the same argument the favicon in that file already makes.

**`absolute`, not `default` — and a test caught it.** A `title.default` is
still the title of a segment that HAS a parent template, so the first attempt
served "Shop A Store · LandingOS": the platform's name put back in the tab by
the metadata written to remove it. `AbsoluteTemplateString`
(`{ absolute, template }`) is the one form that ends template resolution
upward while still templating children.

**The thank-you page opts back OUT, explicitly.** The blanket opt-in is right
for a shop and wrong for a customer's order — that page carries a name, a
wilaya and a total. An unguessable id is what makes it safe to serve without a
session, not what keeps it out of an index. LB.14a already refuses to let any
cache hold that response; a page nobody may cache is a page nobody may index.

**Corrected in passing:** the product page's canonical was hand-built as
`/${tenant}/${slug}` under a comment claiming it was "correct relative to
whichever host served it". Relative was true; the right PATH was not, because
a custom domain drops the tenant prefix. It goes through `storefrontHref` now,
the helper every other storefront link already uses. **Custom-domain ROUTING
is still the known-inert LB.14a.2 problem and was deliberately not touched.**

storefront **48 → 54**, asserting served HTML rather than metadata objects.
Verified live against the running build across all four storefront pages plus
the console as a control; fixture swept with `deleteTenant` (4 rows, 2
passes). builder-sections 74, builder-api 35, console-shell 20, hardening 13,
calc 28, i18n 22 unaffected.

*(this section's "still open" note is now half closed)* **The sitemap was
built as LB.39** — per tenant, at `/{tenant}/sitemap.xml`, listing exactly the
set this slice made indexable. **`robots.txt` is still deliberately unbuilt**,
and §LB.39 records the three options and the recommendation; the short version
is that a host root serving both the platform and every shop cannot name one
sitemap without either helping nobody or publishing the tenant roster.

### LB.15 — DONE. A price spinner was rounding the centimes away (13 Aug, night)

**DEPLOYED 13 Aug 2026 (late night).** Asked for as style residue — "the
editor's money inputs are still `type="number"`, the M-05/D-06 finding" — and
the measurement found silent data loss sitting behind the rule.

**What was affected, exactly.** Three boxes, all `Decimal` columns: the
Pricing section's `price` and `oldPrice`, and the extra-price box on every
variant option row. Nothing else in the editor — LB.20's delivery overrides
were already text with a decimal keypad, and the create screen was fixed in
LB.6. That is the whole of it, confirmed by reading every numeric input under
`components/landings/` and by counting `input[type=number]` in the served
editor HTML: three, then zero.

**What `type="number"` was actually doing.** All three carried `step="1"`.
Measured in the running editor:

- A price of `2990.50` makes the box `stepMismatch: true` / `valid: false` —
  the browser calls the field invalid while the section's own `aria-invalid`,
  driven by zod, says it is fine. Two verdicts on one box.
- **Two ArrowUp presses on `2990.50` produced `2992`.** The first snapped the
  value to 2991, rounding the centimes away; the strip confirmed the form had
  taken it. The control itself was destroying money.
- On the variant row, `Number(e.target.value) || 0` turned anything it could
  not parse into a free option.

**The fix, and the one rule it adds.** All three are now
`type="text" inputMode="decimal" dir="ltr"` with the pattern the create screen
has published since LB.6 — the same money island the ERP panels use, so no
`rtl:` utility may go inside one (LB.28). And because a box that stops being a
number input needs SOMETHING to say what the characters mean,
`lib/landing/money-field.ts` says it once: the schema that validates, the
preview strip and the request that saves all call `readTypedMoney`. Two
readings would let the section refuse a price it then sends, or send one it
never showed — LB.20's rule, one field further on.

**The comma decision, which is the part worth arguing about.** A comma is a
decimal separator, because the fr and ar keypads offer one and a merchant here
types `2990,50`. Ambiguity is **refused rather than guessed**: `1,000` is a
thousand to an English reader and one to a French one, and picking either
silently is a 1000× error on a price. A dot with three places is deliberately
NOT refused — a dot is the separator the function itself emits, so `1.000` is
what a stored `Decimal` comes back as, and refusing it would put an error on a
form nobody had touched (LB.33's shape, avoided on purpose).
`builder.editor.priceUnreadable` is new in all three locales, because "your
price must be greater than 0" is untrue and useless when what you typed was
`1,000`.

**The variant row now holds the TEXT.** Driven straight off
`option.extraPrice`, a controlled box could not hold `500,` for the keystroke
between `500` and `500,75` — the number parsed back and the separator vanished
under the cursor, which is why a decimal supplement was unenterable at all.

**Verified live in fr and ar** against the running build: zero
`input[type=number]` in the editor; `2990,50` typed in French saved and read
back from the database as `2990.50`; `500,75` on a variant option stored as
`500.75`; `1,000` refused with the new message in both languages; the box
computing `direction: ltr` inside `dir="rtl"`. Fixtures restored afterwards
(price back to 5900, the throwaway variant deleted, the demo user's locale put
back to fr). calc 20→**28**, builder-sections 73→**74**, storefront 40,
builder-api 35, i18n 22.

**Recorded rather than widened.** Both routes still parse money with
`z.coerce.number()`. Every price a merchant can type round-trips through a
double exactly, and the server-side arithmetic is already `Decimal` (M-06's
storefront test), so this is a latent rule violation rather than a live
defect. Changing how the quote/charge path parses is its own slice and needs
its own measurement of every caller — the storefront checkout, the catalogue
publish, the webhooks and the CSV import all reach those columns.

**LB.35 — DONE. A landing page links to its own Meta pixels (13 Aug).
⚠ ITS MIGRATION IS NOW APPLIED — see above.** Half the premise measured false before anything was
touched: "only the first pixel fires" was never true — with two active Meta
integrations, Meta's own `fbevents.js` fetched a `signals/config` for BOTH
ids in a real browser, so the loader's `for (const id of ids) fbq("init",id)`
and `fbq("track")` fan-out were already correct. Multiple pixels per TENANT
worked. The real gap was that the selection could not be made PER PAGE, and
the obstacle was structural: LB.5 mounted the loader in `[tenant]/layout.tsx`
so no page could forget it, but **an App Router layout cannot see its child
segment's params** — it can name the tenant and never the page. While the
mount lived there, "this pixel belongs to this product" was unexpressible.
The mount therefore moved down to the four storefront routes, and **LB.5's
guarantee moved from placement into a test** asserting home, category,
product and thank-you all still emit the loader — the invariant is stated now
rather than implied by a file's position. The link is
`LandingPage.trackingIntegrationIds Json?`: NULL (the default, and every
existing row) means "the tenant's whole active set", an array is an explicit
subset, and an empty array is honoured as "none" — three different states, so
nullable rather than defaulted. Json rather than a join table because the
list is small, bounded by the tenant's own integrations, read whole with the
page and never queried from the other side; unresolvable ids are ignored at
read time so deleting an integration cannot break a page, and the PATCH
refuses another tenant's ids with a visible 422 instead of a silent no-op.
The thank-you page keeps the tenant's WHOLE set deliberately — its Purchase
is the conversion every one of the merchant's ad accounts is waiting for.
**The migration is one additive nullable column** (`ADD COLUMN
"trackingIntegrationIds" JSONB`, previewed with `migrate diff`), applied to
`neondb` only after asserting the target was not `landingos_prod`; **it must
be applied to production before this slice deploys**, LB.20 order. No
`apply-rls` re-run — no new table, still 49. Verified live: unlinked serves
both ids, linked-to-one serves that one and NOT the other, linked-to-both
serves both with a real browser initialising both, cleared restores both.
builder-api 29 → **35**, storefront 40/40, tracking 15/15.

**LB.36 — SCOPED, NOT BUILT. Brands (13 Aug).** A measurement and a proposal,
in the shape the store-theme question was left. **Nothing was implemented.**

**The idea, as given:** a store may optionally organise around brands. A brand
has a name and the category of products it sells; a landing page (or product)
can be tied to one; if a page has a brand, the storefront header shows the
BRAND's name instead of the store's; if no brand is used the store keeps
working as a general multi-niche shop exactly as today.

**What the model already has, measured.**
1. `CatalogProduct.brand String?` **already exists** — free text, ERP-side,
   part of the `niche`/`category`/`supplier` classification trio. It is not
   surfaced on the storefront and nothing joins on it.
2. `LandingPage` has a real `Category` RELATION (since B3) with a management
   screen, a picker and a public `/[tenant]/category/[slug]` listing. So
   "the category of products it sells" is a concept that already exists as a
   first-class row — a brand pointing at one would be pointing at a real
   thing, not at a string.
3. `StoreSettings` has the store's public identity (name, logo, description,
   socials) and, since LB.31, one resolver — `resolveStoreName` — behind
   **exactly two call sites** (the storefront product page and the editor's
   preview mount). That is the seam a brand would slot into.
4. `LandingPage` has no brand column of any kind.

**The precedent this has to engage with.** LB.19 faced the same fork for
product categories and did NOT convert free text to a relation, citing the
schema's own reasoning: a classification list is a handful of words per
tenant, and a table means "a migration plus RLS plus a management screen for
something no route needs to join on". A brand as proposed is different on
exactly one axis, and it is the deciding one: **a brand has to be RENDERED
and would own a public surface** (the header, and plausibly a
`/[tenant]/brand/[slug]` listing). A thing customers see needs a stable slug,
a logo and an identity that survives a merchant retyping its name — which is
what free text cannot give. The categories precedent argues for text; the
public-surface requirement argues for a row. **Recommendation: a row.**

**Proposed shape (not built).**
```
model Brand {
  id       String  @id @default(cuid())
  tenantId String
  name     String
  slug     String            // public: /[tenant]/brand/<slug>
  logo     String?           // falls back to the store's logo
  description String?
  categoryId String?         // "the category it sells" — the EXISTING relation
  category   Category? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  isVisible  Boolean @default(true)
  landingPages LandingPage[]
  @@unique([tenantId, slug])
}
// on LandingPage:
brandId String?
brand   Brand? @relation(fields: [brandId], references: [id], onDelete: SetNull)
```
`onDelete: SetNull` on both, deliberately: deleting a brand must never
cascade into pages, and LB.34 is the argument — a page cascades into its
orders, so anything that can reach a page must be prevented from deleting
one.

**Where it lands in the header (item 3's seam).** `SiteNav` already takes a
resolved `store.name`/`logo`/`homePath` and nothing else, so a brand needs no
component change at all: the two call sites resolve the identity, and a brand
would add one step before `resolveStoreName` — brand name if the page has a
brand, else the store name, else the tenant name. `homePath` becomes the
brand's listing when a brand is set. **The fallback chain stays exactly one
function**, which is the property LB.31 bought and should not be given back.

**Size: M–L.** Migration + RLS policy for one table (the `apply-rls` run
takes it from 49 to 50 checks) · a console CRUD screen (the Categories screen
is the template) · a brand picker in the editor's General section beside the
category picker · the header resolution above · a public brand listing page
if wanted (optional — the header works without it) · i18n for three locales.
The migration is the only part needing a production step, and it is additive.

**Open questions that are yours, not the schema's.**
- Does a brand REPLACE the store name everywhere (footer, `<title>`, favicon,
  order confirmations) or only in the product header? Replacing it everywhere
  makes a brand a storefront-within-a-storefront and raises the question of
  whether the thank-you page should wear it too (it already inherits the
  page's THEME since LB.30, so there is a precedent for "the checkout looks
  like the product").
- Is a brand one category, or many? The proposal says "the category it
  sells", which the shape above takes literally; many-to-many is a join table
  and a different feature.
- Should `CatalogProduct.brand` (free text, ERP) be reconciled with this, or
  left alone? Leaving it is defensible — it is an internal classification and
  this is a public identity — but two things called "brand" in one product
  will eventually be asked to agree.

**LB.34 — DONE. A landing page can be archived, and the delete that was
already there stops being able to shred a sales history (13 Aug).** Asked for
as "there is no way to delete a landing page"; the measurement changed the
answer's shape twice. FIRST, a `DELETE /api/builder/landings/[id]` route
already existed — live and callable by anyone with `pages:write`, just never
wired to a button — so the gap was a delete nobody had looked at, not a
missing one. SECOND, what it destroys: `SalesOrder.landingPage` is
`onDelete: Cascade`, `SalesOrderStatusHistory` cascades from the order,
`DraftOrder` from the page, and `FulfillmentOrder.salesOrder` is SetNull, so
deleting the row a product was sold from takes **every order, every status
transition and every captured lead** with it and orphans the ERP's fulfilment
records — silently. Wiring the requested button to that route would have
shipped a one-click revenue shredder. Since LB.30 there is a second reason to
keep the row: the thank-you page reads `order.landingPage.title` and its
theme. **The decision — archive is the delete, and it needs NO MIGRATION:**
`LandingPageStatus.ARCHIVED` has existed since the port with no writer
(`webhooks/payloads.ts` already maps it to `"archived"`), so this gives the
value its first one. Archiving sets `status: ARCHIVED` AND `published:
false`, because the storefront filters on both and setting one alone leaves a
page archived in the console and still on sale; restoring lands on DRAFT,
never straight back to PUBLISHED, because putting a page on sale is the
publish decision with its own permission. The hard delete is KEPT for pages
that never sold anything — a mistyped draft should be able to go away — and
returns `409 HAS_ORDERS` otherwise. In the console, archived pages leave the
working list behind an "Archived (n)" door that exists only when something is
behind it, with Archive↔Restore in place so undo is never on another screen.
Verified live: archiving a page with an order dropped it from the list and
raised the door, the archived view showed it as **Archivé with its order
count still 1**, and Restore returned it to DRAFT, unpublished, order intact.
builder-api 23 → **29**. **Recorded, not built:** the editor has no archive
control — the pages list is where a merchant retires a product, and the
editor keeps publish/unpublish.

**LB.33 — DONE. The "invalid on arrival" report measured false; the broken
labels beside it fixed (13 Aug).** Reported as the Full name field showing a
red invalid outline on a fresh form with no interaction. It does not
reproduce, and the mechanism explains why: on the published page and in the
preview drawer, desktop and 375px, the input is `aria-invalid="false"` with
the theme's neutral `#E5E7EB`, matches neither `:invalid` nor
`:user-invalid`, carries no `required`, and the form is `noValidate` so the
browser applies no validity styling of its own. The Tailwind variant compiles
to `[aria-invalid=true]` — **read out of the served stylesheet rather than
assumed**, which is what killed the first hypothesis that React's literal
`"false"` was matching an attribute-presence selector. The red state is real
and correct: after an empty submit the same field goes `aria-invalid="true"`
with `#f87171` and the Arabic message, so the capture almost certainly
followed a submit. **The investigation did find a real defect in that exact
component:** `Field` derived its label's `htmlFor` from the label TEXT, so
`الاسم الكامل` became `الاسمالكامل` while the input's id is `fullName` —
NOT ONE field in the checkout form had a working label (`labels.length` was
0), tapping a label focused nothing and assistive tech announced every input
unnamed, on the only form in the product that takes money. Merchant-authored,
translated labels can never yield a fixed id, so `htmlFor` is passed in
explicitly and the two destination selects gained the ids they never had.
Verified live: 0 → 1 label each for `fullName`/`phone`/`wilaya`/`notes`, no
dangling `for`. storefront 38 → **40**.

**LB.32 — DONE. The editor's sticky header stops covering the content below
it (13 Aug).** Reported as the header overlapping content when scrolling. The
cause was neither a z-index nor a missing padding but a STALE OFFSET:
`sticky top-16` reserves 64px for a console shell header that is not above
this screen, because the editor is deliberately mounted OUTSIDE `ConsoleShell`
(its own page comment says so, and the shell lives in the `(shell)` route
group this route is not in). A sticky element reserves no space for its
offset, so the content flowed from y=56 — right after the header's 56px flow
box — while the header PAINTED at 64→120: a permanent 64px band where it sat
on top of the content at every scroll position, with dead space above it
belonging to nothing. At scroll 0 the first section card was already 21px
underneath. **A second reading agreed before anything was changed:** the
section cards' `scroll-mt-24` (96px) clears a header ending at 56 with 40px
spare and lands content 24px UNDER one ending at 120 — the scroll margin had
been authored for `top-0` all along. One class changed (the only
`sticky top-16` in the source); verified live at four scroll positions with
the band now [0,56] and anchored-scroll clearance −24px → **+40px**.

**LB.31 — DONE. A storefront never wears the platform's identity (13 Aug).**
Reported as "the live preview shows LandingOS and clicking it goes back to the
platform". The measurement widened it: the leak was never confined to the
preview. TWO paths reached it. `SiteNav`/`SiteFooter` fell back to the platform
`<Logo />` — linking to `/`, which 307s to the platform console — whenever
`store` was null, and the storefront built `store` as `store ? {…} : null`, so
any tenant WITHOUT a `StoreSettings` row shipped a customer-facing page branded
`LandingOS`, with the platform's internal description and `© LandingOS` in the
footer. Separately `StoreSettings.storeName` is NOT NULL with
`@default("LandingOS")`, so an untouched row carries the platform's name as a
literal value and the existing `storeName ?? tenant.name` can never fire.
**Urgency was measured, not assumed:** read-only against `landingos_prod`,
**both** production tenants have a null settings row and one already holds an
unpublished page — zero published pages today, so no customer has seen it, but
it was one publish away. The fix is one resolver (`resolveStoreName`, treating
absent-row and untouched-default as the same case) plus deleting the platform
fallbacks: a storefront that cannot name its merchant shows no brand line
rather than the platform's. The brand links to the tenant's own storefront
root, and renders as a plain span in the editor's preview drawer, where a live
link would navigate the merchant out of their editor — the drawer previously
passed NO store at all, which is why the merchant met the bug first. A test
that asserted the defect as design ("a tenant with no settings row keeps the
platform fallback") is replaced by its inverse. storefront 36 → **38**.
**Deliberately NOT built here:** the "brand" concept (LB.36's scoping) — this
slice only stops the leak.

**Phase 5, 6 and 7 are complete. LEGACY PARITY IS REACHED — Tiers 1, 2 and 3 of
`LEGACY_PARITY.md` §4 have all landed, plus a fourth measurement pass (§9) that
did not use the roadmap at all. PHASE UI (the UI/UX modernisation) IS COMPLETE
— see `UI_UX_AUDIT.md`, and PROJECT_STATE's *Phase UI* section for the
decisions. PHASE PM (product maturity) IS COMPLETE — see PROJECT_STATE's
*Phase PM* section and CHANGELOG §PM.1–PM.7.**

## WHAT PHASE PM LEFT

Full reasoning in CHANGELOG §PM.1–PM.8. Four things are recorded rather than
done, and each is a slice rather than polish:

| # | Slice | Size | Why it is worth doing |
|---|---|---|---|
| **PM.9** | The order detail's summary rail | M | 653 lines, eleven sections, one column below `lg`. The status and the actions are still ~400 px apart vertically, and the screen has no in-page navigation. UX-82 was closed on *tokens*, not on *shape*. A sticky summary carrying the status, the value, the customer and the primary action is the missing half. |
| **PM.10** | `/console/erp/analytics` gets the dashboard's comparison | S | It has the design system now and still reports nine absolute figures with no previous period. The arithmetic already exists in `lib/erp/dashboard.ts` (`dashboardWindow`, `changePercent`, `changePoints`); this is wiring, not design. It is also the slowest screen in the console at **3.7 s**, for the reason D-PM.1.3 documents — eight breakdowns × three passes each. `performance()`'s single-pass `groupBy` is the fix and it is already written. |
| **PM.11** | The quick search on a phone | S | It is `hidden md:block`, because UI.5 measured the header cluster at 319 px against a 375 px viewport and this is the width the drawer work exists for. A phone needs the lookup MORE than a desktop does, not less; it needs its own affordance (a search item in the drawer, or a full-width sheet) rather than a box squeezed into that row. |
| **PM.12** | A screen-coverage test for API-returned columns | S | The three findings PM.2 and PM.4 opened were all *written, stored, returned by an API, rendered by no screen*. `orphans.test.ts` is a NAME check and passes them cleanly. The general form — for every column an API `SELECT` returns, grep the console for a reader — is the next mechanical guard, and it is the same shape AUDIT.2 applied to routes and LP.17 to nav items. |

**One rule Phase PM added to the method:** *a column with a writer and no reader
is not done; it is a feature nobody can use.* The question the schema scan
cannot ask is **for every column an API returns, which SCREEN renders it** — see
PM.12 above.

## WHAT PHASE UI LEFT, AND WHAT IT IS WORTH

Full list with reasoning in `UI_UX_AUDIT.md` §12. Three are worth naming here
because they are slices rather than polish:

| # | Slice | Size | Why it is worth doing |
|---|---|---|---|
| ~~**UI.6**~~ | ~~Move `ConsoleShell` into `console/layout.tsx`, then add `loading.tsx` per segment~~ | M | **DONE 10 Aug 2026 — `UIUX_PASS.md` §15, with a design correction this row's plan needed:** the shell went into SEGMENT layouts (erp / settings / builder-`(shell)` route group, the editor stays full-bleed), but `loading.tsx` is FORBIDDEN here — its Suspense boundary streams the response, so every screen-level `notFound()` (unbought product, permission gate, cross-tenant probe) would 200 instead of 404, a contract dozens of suite assertions pin. The skeleton is client-driven instead (`content-pending.tsx` off `useLinkStatus`). Layouts also gate entitlement; a new console-shell test pins the chrome-free 404 body (suite 20/20); skeleton verified live in LTR **and RTL** (geometry measured, flush-right in Arabic). |
| **UI.7** | Finish the i18n residue on `settings/integrations` and `settings/delivery-prices` | S | ~15 strings in three catalogues. Titles, labels, buttons and the sign-in error are keys already. This is translation work, not design work — and the i18n suite cannot catch it, because it scans `t("…")` calls and these strings never went through `t()`. |
| **UI.8** | A step structure for the profit calculator | M | The largest client module in the console (26 KB) and the only screen the design system reached without restructuring. It has the tokens, not the shape. |

**One rule Phase UI added to the method, and it generalises:** *a Tailwind
arbitrary value containing an operator must be verified in the running page.* It
compiles, it is in the class list, it survives every HTML assertion — and it
emits no CSS. See PROJECT_STATE, *The rule Phase UI adds to the method*.

## WHAT IS NEXT, IN ORDER

**1. Tier 4 of the parity roadmap — which is Phase 8 by another name.**

| # | Slice | Why it is not parity |
|---|---|---|
| 23 | Rate limiting + `CSRF_ORIGIN` | The legacy had both; they left the product suite in 5.1 because neither belongs in one. **This is the one item a production deployment genuinely needs**, and it is a platform concern rather than an ERP one. |
| 24 | The offline shell for the queue screen | A decision to revisit (§6.4c), not a missing feature. 6.6e closed it on "a cache keyed by URL survives signing out", which is true and too broad — a SHELL-only cache leaks nothing. |
| 25 | Order board view, print labels | Preference. The board is a second rendering of a list that already pages, filters and acts. |
| 26 | Status vocabulary endpoints (R18) | Matters only to a future external client; the vocabularies reach every screen as props today. |
| 27 | Real model calls for the AI assistant | A deployment choice. `ai/chat` is a stated 501 and the screen says so rather than offering a box that always fails. |

**2. The rest of Phase 8** — adversarial isolation review, load testing,
backup/restore, runbooks.

**3. The two security actions that need a human** (PROJECT_STATE, *Security
actions requiring manual intervention*): rotate the Neon credentials and
`AUTH_SECRET`. Neither blocks development; both should happen before anything
real ships.

**4. Re-assess `apps/erp`.** PROJECT_STATE's 6.6f decision was to keep it as the
reference implementation and re-assess "after Phase 7, Phase 8 and production
readiness are complete". The fourth pass (§9) read it end to end for the fifth
time and found nine things — which is the argument for keeping it until Phase 8
has read it once more for its rate limiter and its `CSRF_ORIGIN` check.

## PLATFORM COLUMNS DECLARED AHEAD OF THEIR FEATURE (AUDIT.8)

`packages/db/test/orphans.test.ts` fails on a schema column nothing names, and
its exemption list is the live record of these. **None is an ERP parity gap** —
the legacy is single-tenant, sells nothing and has no custom domains — so none
blocks replacing it. Each is platform work with the column already in place.

| Work | Columns waiting | Note |
|---|---|---|
| Custom-domain management | `TenantDomain.verificationToken`, `isPrimary` | **The read path is complete and safe** — `tenantByDomain` refuses a row with no `verifiedAt`. There is simply no screen that adds one. |
| Session management | `Session.lastSeenAt` | Writing it per request is a write per request; that is the design question the work has to answer first. |
| Seat billing | `Subscription.seats` | **No seat limit is enforced anywhere today.** The invitation route admits as many people as a tenant invites. |
| Billing provider | `Subscription.externalCustomerId`, `externalSubscriptionId` | The integration does not exist. Nullable precisely so a tenant can exist before it pays. |
| Trial / period expiry | `Subscription.trialEndsAt`, `currentPeriodEnd`, `cancelAtPeriodEnd` | The STATUS is honoured everywhere; nothing moves a subscription to PAST_DUE when a date passes, so a status changes only because somebody changes it. |

---

## THE THREE THINGS THAT STILL NEED A REAL DEVICE OR REAL CREDENTIALS

None is a gap in the code; each is untestable in this repository by
construction, and each is stated where it is implemented rather than implied.

- **Web Push has never crossed a real push service**, and whether a browser
  OFFERS the install prompt needs a device over HTTPS (6.6e).
- **LP.11's six sound signatures and the desktop notification** need a person
  with speakers and a real browser. The synthesis is a note-for-note port and
  the permission handling is asserted structurally.
- **No request has crossed a real ZR Express or Ecom Delivery endpoint.** Every
  refusal path is tested against a dead port; the success paths need carrier
  credentials.

## THE METHOD THE FOURTH PASS ADDED

**End every slice with a real action through the running app.** AUDIT.3 is the
argument: the contract suite passed 167/167 and the live console was wrong, and no
test could have seen it because every test creates its own tenant with one
product per name. Sign up, place an order, confirm it, look at the number.

---

## LP. Legacy parity restoration — COMPLETE

`LEGACY_PARITY.md` compares `apps/erp` (the legacy CRM/ERP: 123 routes, 27
tables, 15 screens) against the platform ERP (60 route files, 22 models, 12
screens), feature by feature. **101 features: 55 identical · 8 improved ·
14 partial · 24 missing.**

**Read `LEGACY_PARITY.md` before writing anything.** §3 has a detail card for
every partial and missing feature — what existed, what exists now, what is
missing, business impact, complexity and dependencies. §4 is the roadmap,
ordered by business value.

### Second pass — the first pass measured APIs, not workflows

**Re-measured 6 August 2026 from `9d1f887`. 115 features: 52 identical ·
6 improved · 18 partial · 39 missing.** Five pass-1 verdicts were corrected and
fourteen features were found that no route inventory could have seen, because
**nothing was missing from the API to point at them**.

**Read LEGACY_PARITY §0b and §6 before writing anything.** §6 covers the
dimensions that are not features — clicks, density, hierarchy, discoverability,
feedback — and §6.3 lists the nine places the platform is **objectively better**,
none of which may be traded back.

### The blockers, as they stand now

1. **No pagination anywhere.** Every screen is a hard-capped first-N read (orders
   50, clients 50, products 100, shipments 100, follow-up 100) with no next and
   no total. Row 51 does not exist. The platform fixed the *query* side of
   PERF-02 properly and never built the navigation on top of it.
2. **Cannot create an order.** `POST /api/erp/orders` is contract-tested and has
   **no console control**.
3. **No filter form or search box on any list.** `orderFilters` supports nine
   filters — richer than the legacy's four — reachable only by hand-typing a
   query string. Only `/console/erp/queue` has a form.
4. ~~**No notification surface.**~~ *(Closed by LP.7 — a bell, a badge, a panel,
   a toast and a debounced `router.refresh()` in the console shell. Sound and
   desktop notifications are Tier 2 #11 and hang off the same provider.)*
5. ~~**No real carrier adapter.**~~ *(Closed by LP.5 — `zr` books real parcels.)*
6. ~~**No export.**~~ *(Closed by LP.6 — CSV for ZR / Ecom / Ecotrac plus the
   performance report, from the order list, carrying its filters.)*

**ALL SIX BLOCKERS ARE CLOSED.** Tier 1 finished with LP.6; blocker 4, the
notification surface, closed with **LP.7**, which is where Tier 2 opened.

### Two decisions re-opened by the second pass

- **Live updates (LEGACY_PARITY §6.4a).** Neither system has a working live
  console at scale — the legacy fans out in-process (wrong on two instances), the
  platform built the correct transport and no consumer. The proposed shape is one
  `<NotificationProvider>` in the shell owning a badge, a toast and a **debounced
  `router.refresh()`**, which keeps every D-06 rule intact.
- **The offline shell (§6.4c).** 6.6e closed this on "a cache keyed by URL
  survives signing out". True, and too broad: a **shell-only** cache leaks
  nothing and is the difference between a dropped 3G connection showing a stale
  screen and showing nothing. Worth revisiting with that narrower scope.

### Five defects in shipped code — three are closed by LP.16

- ~~**A product with a `™` in its name reports ZERO revenue.**~~ **CLOSED —
  LP.16a.** `sales-summary` now resolves orders through
  `lib/erp/product-match.ts`: the channel's `CatalogProductLink` first and
  exclusively, then a normalised name. It also found a second failure on the same
  line — a catalogue row with a NULL name passed `product: undefined` to Prisma,
  which is not a filter, so a nameless product reported the whole book.
- ~~**Every saved P&L record is missing its fixed costs.**~~ **CLOSED —
  LP.16b.** A list editor and a map editor in
  `components/console/erp/settings-structured.tsx`, on the automation screen (and
  the fixed-cost one on the calculator, where its effect is visible). The
  automation screen's type filter is untouched: it was the right rule and the
  editors were the gap. `defaultCarrierByChannel` also got its first READER
  (`planShipment`), so §8 N23 closes whole.
- ~~**The confirmation rate is computed NOWHERE.**~~ **CLOSED — LP.13.**
  `GET /api/erp/analytics` + `/console/erp/analytics`, seven breakdowns, and the
  dashboard's reaction-time figures back (N18). `marketer`/`source` get their
  first reader, so ad attribution is computable at last (N20).
- ~~**`/console/erp/ai` is a live 404**~~ **CLOSED — LP.17.** The screen exists,
  and `test/erp/ai.test.ts` now asserts the general form: every nav item the
  MANIFEST declares must answer 200, so the next one cannot be added.
- ~~**`IntegrationLog` has zero callers**~~ **CLOSED — LP.14.** It has a writer
  (`lib/erp/integration-log.ts`, redacting credentials by key at any depth) and a
  reader (`GET /carriers/[id]/logs` + a panel). `lastTestAt`/`lastTestOk` are
  written by `POST /carriers/[id]/test` and `lastSyncAt` by
  `POST /carriers/[id]/sync`.

### Done so far

**LP.1 — product editing (R1).** `PATCH /api/erp/products/[id]` plus the edit
panel on `/console/erp/products`. catalog 40 → **55**, screens 96 → **99**,
access 63 → **65**. `CatalogProductEvent.field/oldValue/newValue` get their
first writer: one row per CHANGED field (`price_change`, `cost_change`,
`packaging_cost_change`, `brand_changed`), money compared as a `Decimal` so
`2000` and `2000.00` record nothing.

**D-LP.1:** the route **refuses** `stock` and `variants` with a named 422 rather
than dropping them. Stock is owned by the movement ledger — `applyMovement`
writes the level and its reason together, and that pairing is why the cost basis
can be trusted. Answering 200 while ignoring a `stock` field would be the same
defect this slice fixed in `costPrice`.

**LP.2 — the carrier adapter refusal (R2, first half).** `getAdapter` returned
`mock` for ANY unregistered key, so a carrier configured as `zr` booked a
fabricated `MOCK…` tracking number and answered 201 — and polling that shipment
walked a REAL parcel along the mock's synthetic pipeline and settled its delivery
outcome, booking revenue for a delivery that never happened. It now returns null,
and configuration, booking and polling all refuse by name. delivery 33 → **39**,
screens 99 → **100**.

**D-LP.2:** the one exception is `mapCarrierStatus`, which keeps a keyword
fallback and is what the inbound delivery webhook uses — interpreting a status
string cannot invent a parcel, and the carrier PUSHED that event.

**LP.3 — the lists became navigable (N1, N7, N8, B1).** Shared `<Pager>` and
`<FilterBar>` in `components/console`, wired into orders, clients, products and
shipments. Row 51 exists now. `orderFilters` gained `range=today|yesterday|week|
month` and `toBound`, which accepts both epoch milliseconds and `YYYY-MM-DD`.
screens 100 → **112**, listing 25 → **30**.

**D-LP.3:** the filter vocabulary lives in the module that validates it
(`orderFilterFields` beside `orderFilters`), and paging is **offset with a
total, not a cursor** — reversing this project's own earlier proposal, because a
cursor cannot answer "page 3 of 27" and the API's `pagination()` helper is
already `page`/`pageSize`.

**LP.4 — an order can be taken over the phone (N6).** `OrderCreatePanel` on
`/console/erp/orders`, over exactly the vocabulary `CreateOrder` parses.
`carrierCode` is a select over the tenant's active carriers, because
`createShipment` falls back to the DEFAULT when a code matches nothing — a typed
code books the wrong carrier and says so nowhere. `agentUserId` is offered only
to somebody who sees the whole book; the panel itself is not withheld from an
agent, because the route accepts an order from one. screens 112 → **121**.

**Two findings recorded rather than fixed** (PROJECT_STATE, and N15/N16 in
LEGACY_PARITY §3b): the create route takes a flat `price` where the legacy
captured unit price / discount / shipping and derived the total; and `price` and
`carrierCode` are manager-only on EDIT and ungated on CREATE, so an agent may set
a price and then not change it. Both are decisions, not form changes.

**LP.5 — the real ZR Express adapter (R2, rest).** `zr` is registered and books
real parcels: territory resolution against `POST /territories/search` at booking
time, `X-Tenant`/`X-Api-Key` auth, the 20-entry status map, Svix webhooks, and a
refusal that names the wilaya or commune it could not resolve. delivery
39 → **61**, screens 121 → **123**.

**D-LP.5.1 is the load-bearing change, not the adapter.** Every carrier call left
the request transaction. `withTenant`'s timeout is 15s and booking is triggered
by CONFIRMING an order, so a slow carrier would have rolled back the call record,
the status change and the stock movement — a `try/catch` cannot save a
transaction that has already timed out. Booking and refreshing are now **plan
(in a transaction) → call (in none) → record (in a transaction)**, and
`tenantRoute` gained `afterCommit(work)` so a route can do that without a second
write path. A test makes the stub carrier sleep 17 seconds and asserts a 201.

**D-LP.5.2:** the commune must belong to the resolved wilaya, with no fallback —
the ERP had one ("ignoring parentId, rare but safe") and it books a parcel to the
right name in the wrong province.

**Two defects in shipped code, found by measuring and by attacking:**
`guessStatus` read "Sorti en livraison" as **delivered** (it tested `/livr/`
first) and settled revenue for a parcel that had just left the depot; and
`Shipment` had no unique on `(tenantId, orderId)`, so "one parcel per order" was
a hope. Both fixed — the second with a schema change recorded in `CONSTRAINTS.md`.

**LP.6 — order export (R4), and Tier 1 closed.** `GET/POST
/api/erp/orders/export` plus an export panel on the order list. Four formats —
ZR Express, Ecom Delivery, Ecotrac and the performance report as `orders` +
`agents` — with the legacy's exact column names, because a header is a contract
with somebody else's importer. `test/erp/export.test.ts` is new at **31/31**;
screens 123 → **130**, access 65 → **68**.

Three decisions, all in PROJECT_STATE: **D-LP.6.1** CSV rather than XLSX;
**D-LP.6.2** the export IS the list, taking the same query string through the
same `orderFilters` and `scopedWhere` (which is why the controls live on the
order list and there is no new nav item); **D-LP.6.3** a carrier file is
confirmed orders and no caller can widen it — including by ticking rows, which
is the hole attacking the implementation found.

Two spreadsheet properties that are security rather than polish: a leading
`=`/`+`/`-`/`@` is neutralised (a customer name arrives from a storefront and
the file opens in an operator's Excel), and the file carries a UTF-8 BOM. The
BOM test asserts BYTES — `Response.text()` strips one by specification, so the
obvious assertion cannot fail.

**LP.16 — the profit/loss calculator (R9, N23, half of R20).** Four steps, all
of §7's gaps: 16a `sales-summary` (normalised + link-first product matching,
`returnedCount`, `avgPackagingCost` split out, the cost-basis honesty columns);
16b one proration rule shared with payroll plus the two structured-settings
editors AND the channel-carrier resolver; 16c `versions` and `aggregate`; 16d
`/console/erp/calculator`. `test/erp/finance.test.ts` is new at **38/38** and
`test/calc.test.ts` at **20/20**; delivery 61 → **64**, access 68 → **72**.

**D-LP.16.1 is the defect the port found rather than the plan predicted:** the
legacy's saved record disagreed with the legacy's own screen, because incidents
are subtracted in the banner and omitted from the POST. Incidents now go into
`productCosts`, and the calc suite asserts the record's derived net profit equals
the screen's total.

### LP.7 — DONE. The notification provider (Tier 2 opened here)

**Implemented and verified.** notifications 33 → **41**, orders 38 → **40**.
`components/console/notification-provider.tsx` is mounted once in the shell and
owns the badge (server-counted), a toast per live arrival, and a debounced
`router.refresh()`. Every bullet below was honoured; the design was not changed.

**Two defects in shipped code were found by building the consumer**, and neither
was reachable any other way:

1. **A fresh subscription replayed the whole backlog as LIVE** — an empty cursor
   meant "from the beginning", so every page load would have produced a burst of
   toasts for old news. A client with no `Last-Event-ID` now starts at the newest
   existing id; a resumed one is untouched and replay stays exact.
2. **`POST /api/erp/orders` answered 500 in every seeded tenant** — `P2002` on
   `(tenantId, reference)`, because the seed writes references directly and never
   advances `TenantSequence`. `nextReference` now heals itself from the highest
   reference already in use, counting only references it could have minted.

**TIERS 1, 2 AND 3 ARE ALL COMPLETE, AND PARITY IS REACHED**, plus a fourth
measurement pass (§9) that did not use the roadmap and found nine more things.
#11
(sound + desktop notification preferences on `ProductSetting`) hangs directly off
this provider.

### LP.22 — DONE. The Ecom adapter and N17 (R2 rest) — **TIER 3 COMPLETE**

**Implemented and verified.** delivery 77 → **88**, jobs 16/16 unchanged.

**Three things to carry forward:**

- **`runJob` takes a tenant id, not a bound client**, and must stay that way.
  Both callers were changed with it. Anything added to `jobs.ts` that reaches a
  network inherits the rule.
- **D-LP.22.2 is the second time a carrier's "default to Alger" fallback has
  been refused.** If a third adapter is written, the rule is: a territory that
  cannot be resolved is a REFUSAL naming the value, never a guess.
- **Not verifiable here:** no request has crossed a real Ecom endpoint. Every
  refusal path is tested against a dead port; the success path needs credentials
  this repository does not have, exactly as ZR does.

### LP.21 — DONE. Manual follow-up assignment and the countdown (R13, N14)

**Implemented and verified.** integrations 63 → **75**, access 94 → **95**.

**Two things to carry forward:**

- **`auto: true` must stay distinguishable from an omitted agent.** A default of
  "automatic" means a supervisor who left a select empty gets a choice made for
  them, silently.
- **The countdown's first paint is the SERVER's absolute time.** Any future live
  clock on a server-rendered page inherits that: rendering a relative time on
  the server bakes in the render moment, and rendering it on the client without a
  neutral first paint is a hydration mismatch on every load.

### LP.20 — DONE. The three inbound paths (R19)

**Implemented and verified.** integrations 47 → **63**. Lead capture, product
sync, and Shopify topic routing.

**Two things to carry forward:**

- **The parser decides SHAPE; the route decides MEANING.** Both files say so
  now, because the first build had the adapter and the route each interpreting
  `x-shopify-topic` and they disagreed — `checkouts/create` produced no row.
  Any new channel adapter inherits the rule.
- **`/lead-capture` is the only unauthenticated write on the platform, and its
  threat model is written above the code.** If anything is ever added to it,
  the four bounds (abandoned-only, four fields by name, refused by a disabled
  channel, always logged) are what keep it safe — not the URL being obscure.

### LP.19 — DONE. A spreadsheet can come in (R5 rest, R17 import)

**Implemented and verified.** `test/erp/import.test.ts` is new at **25/25**;
access 92 → **94**. Customer and order CSV import, parsed server-side, with a
preview and per-row skip reasons.

**Three things to carry forward:**

- **`parseCsv` and the dictionaries live in `lib/erp/import.ts`.** Anything that
  ever reads a file here uses them; a second parser is the browser-side mistake
  D-LP.19.1 exists to avoid.
- **`mode` is required and must stay required.** A default of `commit` is a
  spreadsheet written into a live registry by somebody who meant to look first.
- **The order import raises no notification, deliberately** (D-LP.19.5). If a
  future import path is added, it inherits that or it fires LP.11's ka-ching once
  per historical row.

### LP.18 — DONE. The variant matrix (R12)

**Implemented and verified.** catalog 55 → **66**, registry 21 → **23**,
access 90 → **92**. Three columns, four form fields, and
`PUT /products/[id]/variants`.

**Three things to carry forward:**

- **D-LP.18.1 is the rule, not the implementation.** Anything that ever writes a
  variant level must go through `applyMovement`. The only route that may write
  the variants ARRAY is this one, and it carries the stored levels over rather
  than trusting the request.
- **`niche` unblocked LP.10's missing filter**, and the legacy's caveat is in the
  code: an order stores the product NAME, so a renamed product will not match.
  Do not "fix" that by switching to `product-match.ts` — that module exists for
  the MONEY path, where an approximate match moves revenue between products.
- **Uploading an image file still has no control.** The field is a URL. That is
  the honest state until M-14 moves these to R2, and it is recorded in
  LEGACY_PARITY R12 rather than implied.

### LP.15 — DONE. A storefront can finally be connected (R8)

**Implemented and verified.** integrations 29 → **47**, access 87 → **90**.
The screen, the adapter registry, the connection test, the log, and Shopify +
LightFunnels payload parsing.

**Two things to carry forward:**

- **A registered adapter's `null` is an ANSWER.** The generic `parseOrder` is the
  fallback for platforms with NO adapter, never a second chance after a
  registered one declined. The first build got this wrong and a Shopify
  `products/update` topic became an order. Anything added to
  `channel-adapters.ts` inherits the rule.
- **The channel fallback is deliberate and the carrier one is not.** D-LP.2
  refuses an unregistered carrier because it can invent a tracking number; a
  channel adapter cannot invent anything, and refusing would lock seven of nine
  platforms out entirely. Do not "make them consistent".

### LP.11 — DONE. The bell learns to make a noise (N4, N5) — **TIER 2 COMPLETE**

**Implemented and verified.** notifications 41 → **48**. Six Web Audio
signatures, per-family toggles with a test button each, a clamped volume,
desktop notifications when the tab is not visible — all stored on
`ProductSetting`.

**Two things to carry forward:**

- **`notify-vocab.ts` is directive-free and `notify-prefs.ts` is
  `server-only`.** The first build put both in one module and failed outright:
  a client component cannot import `server-only`. This is the second worked
  example of the `edit-field.ts` rule; do not merge them back.
- **Not verifiable here:** whether the six signatures sound distinct through a
  headset, and whether a real browser raises the desktop notification. Both need
  a person with speakers on a real device. Grouped with the two other things
  Phase 8 owes a device (Web Push crossing a real push service, and the install
  prompt).

### LP.10 — DONE. The registry stops being read-only (R5, 3 of 4)

**Implemented and verified.** `test/erp/registry.test.ts` is new at **21/21**;
access 84 → **87**. Detail route + screen, correction, export, and the filters
from one to eight.

**Three things to carry forward:**

- **`erp:clients:write` is SENSITIVE.** Anything else that writes customer PII
  should use it rather than inventing a second gate.
- **`clientHistoryPhones` returns `null` vs `[]` and they mean different
  things.** Any future filter that correlates through order history must keep
  that distinction or it silently ignores itself.
- **The import (R5's fourth feature) is slice 19** and shares its parser with the
  order import. `importedSource`/`importedAt` and the five `imported*` counters
  are already rendered by the detail screen, so the writer has a reader waiting.

### LP.9 — DONE. The bulk bar finishes the job (R7, half of R13)

**Implemented and verified.** orders 40 → **58**, screens 148 → **152**. Four
actions restored: `classify`, `assignFollowup`, `createShipments`,
`sendToDelivery`. `export`/`print` deliberately not — LP.6 replaced them.

**Two findings worth carrying forward:**

- **`ACTION_RULES` replaced an approximation.** "Everything except `status`
  requires `seesWholeBook`" made bulk `classify` STRICTER than
  `POST /orders/[id]/classify`. Every future bulk action must name the
  permission and manager requirement of the route that does that thing to one
  order, not inherit a blanket rule.
- **`fakeReason`, `fakeResponsible` and `fakeAt` had no reader at all.** Written
  since Phase 5. The same class of defect as `IntegrationLog` (LP.14) and
  `OrderCall.suspicious` (LP.12): computed, stored and shown nowhere. Worth
  sweeping for the rest in the final audit.

### LP.8 — DONE. Inline row actions and list density (N9, N10, N21, N22)

**Implemented and verified.** screens 140 → **148**. Four controls on every row —
status, agent, carrier, express — each calling `PATCH /api/erp/orders/[id]`
(D-06.1), each gated by the predicate that route uses, so an agent gets two and a
manager four. The density half restores every fact §3b measured as missing, and
`row-flash.ts` closes N22.

**Three decisions worth carrying forward:**

- **`orderRowFacts` lives beside `orderFilters`**, not on the page. Three copies
  of "is this abandoned" is three chances for the list, the board and the queue
  to disagree about one order. `overdue` takes `alertMinutes` as an argument so
  it cannot become a fourth opinion beside the dashboard banner and the queue.
- **The `OrderCall` facts are fetched for the PAGE.** PERF-02's decision stands —
  `ORDER_LIST_SELECT` still joins no call history. Two bounded queries over the
  fifty ids on the page, unaffected by the size of the book.
- **`row-flash.ts` carries no directive.** It touches the DOM and is imported
  only from client components; `"use client"` would make its exports client
  references rather than functions (the `edit-field.ts` trap).

**The defect it introduced, caught by LP.3's own tests:** the control div carried
its own `data-order-id`, and the paging tests count rows by that attribute — 100
rows on a page of 50, five assertions red at once. Renamed `data-row-order`, with
the reason recorded in the component.

### The design LP.7 was built to — preserved

**The largest piece of dead machinery in the repo.** M-16 built storage, the
audience decided at write time, an SSE stream with exact replay from
`Last-Event-ID`, Web Push and a service worker — **33 contract tests** — and
**nothing in the console consumes any of it.** No bell, no badge, no panel, no
toast. A signed-in operator is never told anything: not that an order arrived,
not that a parcel came back, not that a follow-up escalated.

The architecture is already proposed and reviewed — LEGACY_PARITY §6.4(a):

> One `<NotificationProvider>` in the console shell, subscribing **once** per
> session to `/api/platform/notifications/stream`. It owns three things and
> nothing else: the unread badge, a toast per arriving notification, and a
> **debounced `router.refresh()`** (~500 ms) so a burst of carrier events costs
> one re-render. Server-rendered truth, event-driven invalidation — every D-06
> rule intact (no optimistic UI, no second write path).

**What to settle before writing anything:**

- **One subscription per session, not per screen.** The provider belongs in the
  shell (`components/console/console-shell.tsx`), which every console page
  already renders. A provider per screen means N streams per tab.
- **The debounce is the whole performance story.** A carrier replaying a backlog
  produces dozens of events in a second; each one calling `router.refresh()`
  re-renders a server component tree that runs real queries. Debounce, and prove
  it with a test that pushes a burst.
- **`router.refresh()` and nothing else.** No client-side merge of the incoming
  notification into a list — that is a second copy of the truth, and D-06.3
  exists because a confirmed call is money.
- **What the badge counts.** `unreadCount()` in `lib/platform/notifications.ts`
  already exists and has no caller. Read it on the server for the first paint,
  then let the stream move it — do not compute it in the client from the events
  it happens to have seen, which is the in-memory-counter defect the M-16 audit
  found.
- **The stream is cross-product.** `/api/platform/notifications` is a platform
  surface: one feed per person across every product. The provider must not
  become ERP-shaped, and a toast must be able to name which product raised it.
- **Sounds and desktop notifications are the NEXT slice** (Tier 2 #11) and hang
  off the same provider, behind a preference on `ProductSetting` rather than
  `localStorage` — so it follows the person between devices, which is the one
  thing the legacy got wrong here.

### One slice the third pass added — DONE in LP.16b

**A structured-settings editor** — `S`, and it closed two live defects at once.
`fixedCosts` (an array) and `defaultCarrierByChannel` (an object) are both
declared in `SETTINGS_SCHEMA`, both validated, both READ by real code, and
neither is reachable by any control: `/console/erp/automation` builds its
controls by filtering `spec.type !== "object" && spec.type !== "array"`, which is
**the right rule** and was chosen deliberately so a structured setting added
later cannot render as a checkbox. The fix is a list editor and a map editor, not
a change to that filter. Until it lands, every saved P&L record is missing its
rent and the order form cannot preselect a channel's carrier. §8 N23, §7 P3, R20.

### The slice taken out of order — DECIDED, and it was the whole of 16, not 16a

**LP.16 was taken before LP.7.** The reasoning this section asked to be recorded:
two of §7's findings were **live wrong answers on screens that already ship**
(the exact-string product match, and the always-zero fixed costs), not missing
features — and once 16a is being done, 16b–16d are its consumers. Taking the
calculator whole cost three more steps and closed R9, N23 and half of R20 in one
slice. **Tier 2 resumes at LP.7, unchanged.**

### The order of work (LEGACY_PARITY.md §4)

**Re-ordered by the second pass.** Priority axes: production blockers → daily
operator productivity → business value → architectural dependencies → risk.

**Tier 1 — blockers:** product editing **[DONE LP.1]** · adapter refusal
**[DONE LP.2]** · pagination + filters + search **[DONE LP.3]** · create an
order **[DONE LP.4]** · the real ZR adapter **[DONE LP.5]** · order export
**[DONE LP.6]**. **TIER 1 IS COMPLETE.**
**Tier 2 — operator productivity:** (7) the notification provider **[DONE LP.7]** ·
(8) inline row actions + list density **[DONE LP.8]** · (9) bulk actions
completed **[DONE LP.9]** · (10) client detail/edit/export **[DONE LP.10]** ·
(11) sound + desktop notification **[DONE LP.11]**
preferences · (12) agent alerts, missed-counter reset, manager password reset,
payroll report, audit view **[DONE LP.12]**.
**Tier 3 — business value:** (13) analytics **[DONE LP.13]** ·
(14) carrier test/sync/logs **[DONE LP.14]** ·
(15) sales-channel screen **[DONE LP.15]** · (16) profit calculator **[DONE LP.16]** ·
(17) AI screen **[DONE LP.17]** ·
(18) product fields + variant editor **[DONE LP.18]** ·
(19) CSV import **[DONE LP.19]** · (20) channel webhooks **[DONE LP.20]** ·
(21) manual follow-up assignment **[DONE LP.21]** · (22) Ecom adapter
**[DONE LP.22]**. **TIER 3 IS COMPLETE.**
**Tier 4 — hardening:** (23) rate limiting + `CSRF_ORIGIN` · (24) the offline
shell decision · (25) board view + print · (26) status vocabularies ·
(27) real AI calls.

**Parity is reached at the end of Tier 3, and it is reached.**

### Slice rules

One slice per commit; never touch unrelated code. Every slice compiles, keeps
every suite green, adds new tests, and updates CHANGELOG + PROJECT_STATE +
NEXT_STEPS. Before every commit: build · tests · permissions · a neighbouring
suite for regressions.

---

## 0. Before writing any code

```bash
npm install
npm run builder:build
npm run builder:start
```

**Stop node, build, THEN start — in that order, every time.** `next start`
serves a PREBUILT app, so a new route needs a rebuild; and if the old server
still holds :3000 the new one loses the port race *silently* while
`/api/health` keeps answering 200 from the stale process. That cost a full
debugging cycle in 5.3, twice.

Confirm the baseline per suite. The aggregate run is flaky for infrastructure
reasons — see *Known limitations* — so judge these one at a time:

```bash
npm test --workspace @landingos/db                 # 29
npm test --workspace @landingos/auth               # 36
npm test --workspace @landingos/product-registry   # 36
npm test --workspace @landingos/website-builder    # 102 + 266 ERP contract
npm test --workspace @landingos/erp                # 298 (the legacy stack)
```

The ERP contract suite needs the server up. Run it in strict mode, which turns
a skip into a failure, from `apps/website-builder`:

```bash
ERP_CONTRACT=strict node --env-file=.env --test --test-concurrency=1 "test/erp/access.test.ts"
```

Expect **627/627** across the FIFTEEN files: access 73 · orders 40 ·
validation 29 · listing 30 · catalog 55 · delivery 64 · integrations 29 ·
order-split 8 · screens 130 · jobs 16 · assign 25 · notifications 41 ·
export 31 · finance 38 · analytics 19.

`test/calc.test.ts` (20) is the one PURE suite and needs **no server and no
database** — the profit calculator's arithmetic, which is the highest-consequence
code on any screen here because its output is filed as a permanent record:

```bash
node --test "test/calc.test.ts"
```

`delivery.test.ts` starts a **stub ZR Express server on an ephemeral port** in
the test process and points a carrier's `apiUrl` at it, so the real adapter runs
over real HTTP. Nothing external is contacted and no credentials are needed. One
test deliberately takes ~20 seconds: it makes that stub sleep 17 seconds to prove
a booking outlives the 15-second transaction timeout (D-LP.5.1).

The platform contract suite lives beside it and runs the same way — **56/56**
(team management 7.1a + invitation acceptance 7.1b + team screen 7.1c):

```bash
ERP_CONTRACT=strict node --env-file=.env --test --test-concurrency=1 "test/platform/team.test.ts"
```

It imports the harness from `../erp/helpers.ts` on purpose. That file is the
app's contract-test harness, not the ERP's; tenants, members, sessions and the
skip-with-a-reason machinery are product-agnostic, and the directory name is
historical in the same way `apps/website-builder` is.

`ERP_CONTRACT=strict` also requires **`WORKER_SECRET`** in
`apps/website-builder/.env`, matching whatever the server was started with.
Without it `POST /api/jobs/tick` answers 404 to everybody and only its refusal
can be tested — which is how 6.5b shipped a tick that could never run a job.

---

## 1. Phase 6.3 is done — what it built

**Every mutation the ERP's SPA can perform now has a control on the platform.**
Twelve screens, all writable where the API allows it:

| Action | Route it calls | Screen |
|---|---|---|
| Start a call, log its result | `POST orders/[id]/call-start`, `/call` | order detail |
| Add a note · classify as fake | `POST orders/[id]/note`, `/classify` | order detail |
| Edit an order, reassign it | `PATCH orders/[id]` | order detail |
| Bulk status / assign / delete | `POST orders/bulk` | order list |
| Book / refresh a parcel | `POST orders/[id]/shipment`, `/refresh` | order detail |
| Create / archive / restore a product | `POST products`, `DELETE`, `/unarchive` | products |
| Adjust stock, add a lot | `POST products/[id]/inventory/adjust`, `/stock-lots` | inventory |
| Configure a carrier, default, status mappings | `POST/PUT carriers`, `/default`, `/status-mappings` | carriers |
| Save a P&L, add / delete a one-off charge | `POST financial-records`, `unexpected-charges` | finance |
| Pay rates, days off, suspend / reactivate | `PATCH agents/[id]`, `/days-off`, `/suspend` | agents |
| Automation rules | `PUT settings` | **automation** (new) |

**`/console/erp/automation`, not `/settings`.** `packages/product-registry`
refuses a product nav item named `settings` — a tenant with N products must still
see ONE Settings, owned by the shell. The name was the defect: every key on that
screen is a rule the ERP applies by itself.

### The pattern to follow for any new write surface

The write primitive is `src/components/console/api-action.tsx`
(`useApiAction`, `ActionError`, `ActionButton`); the field descriptors are in
`src/components/console/{edit-field,setting-field}.ts`; the worked examples are
the five files in `src/components/console/erp/`.

**Anything both sides need goes in a directive-free module.** A value exported
from a `"use client"` module is a client reference on the server, and calling it
throws at runtime while the build succeeds — that cost a cycle in 6.3b.

- **D-06.1. A control calls the API route.** No server actions for product
  writes. A server action is a second write path needing its own copy of the
  permission gate, the ownership guard and the validation — and that copy is the
  half no contract test covers. The builder's order detail shows the cost: it
  re-declares `VALID_TRANSITIONS` in the page.
- **D-06.2. Render a control only where the API would accept it** — decided with
  the same function the route checks (`can`, `mayTouchOrder`, `seesWholeBook`),
  never a second opinion. An agent must not see a reassign control, a delete
  button on a saved P&L, or an edit on a movement. **And the converse:** do not
  withhold a control the API accepts. Logging a result with no call-start is
  allowed and flagged, so the button stays. State the absence on the page rather
  than leaving a reader guessing.
- **D-06.3. No optimistic UI.** A confirmed call is money. `router.refresh()` on
  success, inside a transition, and the control stays busy until the server
  component re-renders.
- **Client components hold no strings and no vocabularies.** Both arrive as
  props from the server, which reads them from the same `lib/erp` modules the
  routes validate against. `lib/console/action-errors.ts` turns the envelope's
  `code` into an i18n key — the API's `message` is English, for a log.
- **Test the control surface both ways.** The offered set must equal what the
  API accepts, and each offered value must then be exercised for real. That is
  how 6.3a found `tentative1/2/3` missing from the status registry.
- **A form that a write can change must be keyed on the server's values**, so a
  refresh remounts it on what was stored. `buildPatch` normalises a phone
  number; without the key the box goes on showing what was typed.
- **Money is a text input with `inputmode="decimal"`, never `type="number"`** —
  a number input hands back a JS float and these columns are `Decimal` (M-06).
- **Leave a field off rather than guess its vocabulary.** `deliveryMethod` is
  `'COD'` everywhere and has no options, so a free-text box would write values
  nothing downstream understands. Where a vocabulary *does* exist, export it from
  the module the route validates against (`SETTINGS_SCHEMA`, `PERIOD_TYPES`,
  `JOB_ROLES`, `CALL_RESULTS`) — a form with its own list goes stale silently.
- **Exclude by TYPE, not by a list of names.** The automation screen skips the
  structured settings because their declared type has no editor, so one added
  later is excluded automatically instead of rendering as a checkbox.
- **A collapsible panel is `hidden`, never unmounted.** Mounting on click means
  the offered vocabulary only exists after JavaScript runs — unassertable by a
  contract test and unreadable to assistive tech until somebody clicks.
- **A screen that reads the database directly must apply the permission its API
  equivalent applies.** 6.3d found the carriers page rendering for an agent who
  could not call a single carrier route. A nav item is a hint; the URL is
  typeable; the gate belongs on the page.
- **A product must never ship a nav item the platform owns** — `settings`,
  `profile`, `billing`, `team`, `notifications`. The registry asserts it.

---

## 2. NEXT — 6.4, the agent PWA, and retiring `apps/erp`

**This is the current task.** All 1,172 lines of `apps/erp/agent.html` were read
in 6.4a; this table is the measurement, not a guess.

### Done — 6.4a and 6.4b

`/console/erp/queue`. The scoped queue over `ACTIVE_STATUSES`, oldest first;
tap-to-dial as a real `tel:` anchor with `call-start` fired alongside; the eight
result buttons; the five note types; the overdue badge judged against the
tenant's `alertMinutes`; a plain GET filter form read by `orderFilters`; the
parcel's status and tracking number on the card; and the follow-up panel,
read-only.

### Does not port, and must not be faked

- **Login screen and stored server URL.** The platform session is a cookie on
  this origin; there is nothing to port to.
- **Notifications and Web Push** — M-16 (§3). No platform transport exists.
- **AI assistant** — `ai/chat` answers 501 by design (§5).

### Done in 6.4c — resolving a follow-up task

`POST /api/erp/followup/tasks/[id]/resolve`. Guarded by
`loadOwnedFollowupTask` (whole book, own, or unassigned — the ERP's rule with
the platform's 404), settles once, and writes no second marker. Seven contract
tests in `integrations.test.ts`.

It also found that 6.4b's panel filtered `status: "pending"` when the vocabulary
is `open | done | overdue`, so it was showing nothing.

---

## 2b. THE NEXT TASK — what actually blocks deleting `apps/erp`

Building the resolver exposed two **Phase 5 porting gaps**. Neither is visible
to a contract test over HTTP, because both are code that runs *between* routes.

### (1) DONE in 6.5a — carrier events raise tasks

`raiseFollowupTask` in `src/lib/erp/followup.ts`, attached to `ingestEvents` —
the one choke point both the tracking poll and the inbound webhook pass through.
Fires only on a status TRANSITION, which is stricter than the ERP: replayed
history no longer re-raises a task an agent has resolved. Both halves of
`statusRequiresCall` ported (the CRM status list and the keyword fallback over
the carrier's own wording). Six contract tests in `delivery.test.ts`.

A task raised here carries the order's `followupUserId`, and unassigned is fine
— `loadOwnedFollowupTask` treats an unowned task as work anybody may pick up.
6.6a closed the other half: `autoAssignFollowup` now sets that field on
confirmation, so a task raised later already names somebody.

### (2) DONE in 6.5b — M-15, the scheduled work

`src/lib/erp/jobs.ts` holds follow-up escalation and the overdue sweep, both
**idempotent by column guard** rather than by lock, each driven twice by a test
that asserts the second pass changes nothing. Two ways to run them:

- `POST /api/erp/jobs/[job]` — `erp:settings:write`, the caller's own tenant.
  A manager's "run it now", and what makes any of this contract-testable: a
  timer is not something a test can wait for.
- `POST /api/jobs/tick` — `WORKER_SECRET`, every entitled tenant. **Fails
  closed with 404**, not 401. `services/worker` calls it on an interval and
  holds no business logic and no database connection.

```bash
WORKER_TARGET=http://127.0.0.1:3000 WORKER_SECRET=... npm run worker
```

### (3) DONE in 6.6a — auto-assignment

`src/lib/erp/assign.ts` is the one eligibility-and-workload rule behind all three
ERP behaviours: `autoAssignOnCreate` (behind `autoAssign`, on all three creation
paths), `autoAssignFollowup` (behind `followupAutoAssign`, on both confirm
paths), and reassignment inside the overdue sweep (behind `autoReassign`).
25 contract tests in `assign.test.ts`, **11 of which were verified to fail
against the pre-change build.**

Three decisions, in PROJECT_STATE: **D-06.5** an explicit `jobRole` is required
(`Membership` is everybody in the company, not a staff table); **D-06.6**
eligibility also asks `can(..., "erp:orders:write")`, so automation never hands
out work the API would refuse; **D-06.7** `overdueFlaggedAt` is both the guard
and the clock, which is what stops one ignored order walking the whole roster in
minutes.

`onOrderConfirmed` in `src/lib/erp/confirm.ts` is now the single confirm path for
both doors into `confirmed` — `/call` and `PATCH` had diverged, which is the
exact defect the ERP records at `index.js:1685`.

**The sweep's threshold is `reassignMinutes`, not `alertMinutes`.** They are
different ERP jobs and 6.5b conflated them.

### (4) DONE in 6.6b — the carrier poll, and a worker that had never worked

`pollCarriers` in `src/lib/erp/jobs.ts`, driven by `trackingPollMinutes` and
guarded by the new `Shipment.lastPolledAt` column — which is both the interval
marker and the idempotency guard, matched in the same `updateMany` that writes
it. It calls `refreshShipment`, so it feeds the same `ingestEvents` a webhook
does: one ingest path, so a polled parcel raises follow-up tasks and settles its
outcome exactly as a pushed one does.

**And the thing worth remembering from this slice:** `services/worker` had never
run a job. 6.5b's tick read `Subscription` through `asPlatform()`, which is
unbound, and that table is RLS-scoped — so every tenant looked unentitled and the
tick answered `{ tenants: 0 }`, which the worker logged as a quiet system. It was
found by **running the worker**, because no test could reach the authorised half
of a route that fails closed on a dev server with no secret.

The entitlement is now read inside the binding via `hasProduct` — the same
predicate the storefront checkout uses. `WORKER_SECRET` is required by
`ERP_CONTRACT=strict`, and two tests exercise the authorised path: it escalates a
real task, and a cancelled subscription is skipped.

**The limitation, fixed for two of its three callers in LP.5.** The carrier call
happened inside the transaction `withTenant` opened, whose timeout is 15s.
Booking and the manual refresh now do the HTTP outside it and ingest inside
(D-LP.5.1). **The scheduled poll still does not**, deliberately: it is bounded by
`POLL_BATCH = 25`, it writes nothing a person is waiting on, and neither
registered adapter reaches a network from there — ZR declares `canPoll: false`
and `planRefresh` refuses first. Moving it out means `runJob` stops receiving a
bound `db` and starts opening a binding per parcel, which is a change to the job
runner and both of its routes. **Recorded as N17 and grouped with the Ecom
adapter (Tier 3, slice 22)**, the first registered carrier that can be polled.

---

## 2c. NOTHING BLOCKS DELETING `apps/erp` — the 6.6f reassessment

Every behaviour it has is on the platform. The full table is in PROJECT_STATE
under *What still prevents retiring `apps/erp`*; both deferred test files are
discharged rather than abandoned (`overdue-sweep.test.js` → `jobs.test.ts`,
`notifications.test.js` → `notifications.test.ts`, which also covers the SSE half
of `delivery-outcome.test.js`).

The three things still true, and **none is caused by deleting it**:

1. **No cross-origin state-change refusal, and no rate limiting** (§4). Both left
   the product suite in 5.1 because neither belongs in one, and neither was ever
   on the platform — so keeping `apps/erp` running does not give them to it.
2. **Web Push has never crossed a real push service**, and installability needs a
   real device over HTTPS. Nothing is deployed, so both are untested by
   construction rather than by omission.
3. **The AI assistant answers 501 by design** (§5).

### DECISION: not yet — it stays as the reference implementation

Taken after the 6.6f reassessment. Nothing depends on it and nothing imports from
it; it is kept because **four end-to-end reads of that directory during this port
each found something the platform was missing**, and Phases 7 and 8 will read it
again — billing and team management touch `agents`, `sessions` and the settings
surface, and hardening needs its rate limiter and `CSRF_ORIGIN` check as worked
examples.

**Re-assess after Phase 7, Phase 8 and production readiness are complete.**

### The checklist for when that moment comes

One commit that touches nothing else, so the diff is a pure removal and a revert
is one command. Then:

- `package.json` — drop `apps/erp` from the workspace globs if they are explicit,
  and `better-sqlite3` from `allowScripts`, which nothing else needs.
- PROJECT_STATE's *Legacy still remaining* section and its suite totals
  (929 → 682, since the 298 go with the directory).
- `apps/website-builder/test/erp/PORTING.md` references files that will be gone.
  Keep the reasoning and say where each went.

That directory has been read end to end four times during this port — 6.4a for
the agent PWA, 6.5a for the follow-up producer, 6.6a for assignment, 6.6f for the
in-process timers — and **each read found something the platform was missing**.
Weigh that before the last working copy goes behind a `git show`.

## 7. Phase 7, the SaaS layer — IN PROGRESS

**Phase 6 is complete.** Every ERP behaviour is on the platform (6.6f), and
`apps/erp` is kept as the reference implementation until Phase 7, Phase 8 and
production readiness are done — see §2c.

**7.1a is done** (the team API), **7.1b is done** (invitation acceptance),
**7.1c is done** (the team screen), **7.2 is done** (billing) and **7.3 is done**
(self-serve signup). **Phase 7 (the SaaS layer) is complete.**
**Phase 8 (hardening) is next** — see §4 for the two guarantees still owed.

Phase 7 is what turns the platform from *a thing two seeded tenants use* into a
product somebody can buy. Three pieces, in this order, and the order is the
argument:

### 7.1a — DONE. The team API.

Six routes under `/api/platform/team/*`, 39 contract tests in
`test/platform/team.test.ts`, purely additive — no existing file was modified.

| Route | What it does |
|---|---|
| `GET/POST /api/platform/team/invitations` | list · invite by address and role |
| `POST .../invitations/[id]/revoke` | withdraw one; idempotent |
| `GET /api/platform/team/members` | the company, plus `assignableRoles` |
| `PATCH .../members/[userId]` | change a role |
| `POST .../members/[userId]/{suspend,reactivate}` | |
| `DELETE .../members/[userId]` | remove the membership, never the person |

The rules, all enforced and each with a test that violates it: the owner cannot
be demoted, suspended or removed by anybody including themselves; nobody hands
out more access than they hold (by promotion *or* by invitation — both doors are
tested); nobody acts on their own membership; suspension takes effect on the next
request and is per-company, not per-person; an invitation is replaced rather than
duplicated; the token is shown once. Four decisions — **D-07.1** to **D-07.4** —
are recorded in PROJECT_STATE.

**Every guard returns a CODE, and every test asserts it.** A test that only
checks for 403 passes against a route that refused for the wrong reason.

### 7.1b — THE NEXT TASK. Accepting an invitation.

7.1a issues links that lead to a 404. This closes that.

- `GET /console/join/[token]` — show who is inviting, to what company, in what
  role. **Before a session exists**, so it must render for a signed-out visitor.
- `POST /console/join/[token]` — accept. Creates a `Membership`; the `User` may
  already exist (one person, many companies — the seeded consultant is exactly
  this case and must keep working). Sets `acceptedAt`.

**Start here, because it is the part that is not obvious:**

> **`asPlatform()` does not bypass RLS.** The app role is not the database owner,
> so an unbound read of `Invitation` returns **zero rows, silently** — RLS denies
> by returning nothing, not by erroring. Resolving a token before a tenant is
> bound therefore needs the pattern `Membership` already demonstrates in
> `packages/db/scripts/apply-rls.ts`:
>
> - a second, narrower policy on `Invitation` —
>   `FOR SELECT USING ("token" = current_setting('app.invitation_token', true))`
> - a `withInvitationToken(token, work)` binding in
>   `packages/db/src/tenant-client.ts`, alongside `withUser`
> - `npm run rls --workspace @landingos/db` to apply it, then re-run the
>   preflight
>
> It opens exactly the row whose token was presented and nothing else. Do not
> reach for it to sidestep a tenant binding — like `withUser`, it grants a
> strictly narrower view, not a wider one.

**The rules for this slice, each needing a test that violates it:**

- **An expired, revoked or already-accepted token is refused IDENTICALLY.** A
  different answer per case turns the endpoint into an oracle for which addresses
  have been invited and which have joined.
- **An invitation is not an account.** Accepting creates a `Membership` only. If
  no `User` holds that address, this slice must not create one — that is 7.3,
  self-serve signup. Say so; do not half-build it.
- **The address on the invitation is not proof of identity.** Whoever follows the
  link is whoever received it. Decide explicitly whether accepting requires being
  signed in as *that* address, and write the reasoning down — it is the one real
  design question in the slice.
- **Accepting twice creates one membership.** Idempotent by `acceptedAt`, the
  same shape as every job in `jobs.ts`.
- **A token for a soft-deleted tenant is refused**, like every other bad token.

### 7.1b — DONE (GLM-5.2)

**Implemented and verified.** `test/platform/team.test.ts` 39 → **47/47**. The
invitation link (`/console/join/[token]`) now resolves: a GET renders the preview
for a signed-out visitor, and `POST /api/platform/invitations/[token]/accept`
creates the membership. Every rule above has a test that violates it.

**What landed:**
- A second RLS policy on `Invitation` (`tenant_isolation_token`, `FOR SELECT` on
  the token) plus `withInvitationToken(token, work)` in `packages/db` — the
  `Membership` `_self` pattern applied to a token. Verified live: resolves exactly
  one row, wrong token → nothing, unbound → nothing.
- `POST /api/platform/invitations/[token]/accept` — a plain route, NOT
  `tenantRoute` (the accepter has no session/tenant). A server action was tried
  first and rejected: server actions are not HTTP-addressable, so they cannot be
  contract-tested over `fetch` (every other write surface is an API route — D-06.1).
- The page renders GET for everyone and its accept button calls the route via a
  small client component (`components/console/join-form.tsx`).
- The one design question, resolved: the accepter need NOT be signed in as the
  invited address. The token is the claim. No `User` is created (that is 7.3);
  an address with no account is refused `ACCOUNT_REQUIRED`.
- Refusals uniform across the oracle surface: unknown / expired / revoked /
  deleted-tenant → `404 INVITATION_NOT_FOUND`; `ALREADY_ACCEPTED`,
  `ACCOUNT_REQUIRED`, `ALREADY_MEMBER` distinct.
- Idempotent by `acceptedAt`; membership + acceptedAt + audit in one transaction.
- Acceptance does NOT switch the active tenant (D-07.4) — the seeded-consultant
  test asserts both memberships survive and the original session still resolves.

**Verified live:** team 47/47 · access 63/63 · website-builder 102/102 · i18n
18/18 · auth 36/36 · product-registry 36/36 · db 29/29 · preflight 9/9. Build
clean. End-to-end invite → GET → POST → membership-in-DB driven manually. Full
reasoning in CHANGELOG §7.1b; the measurement that locked the design is preserved
below.

### 7.1b — measured and designed (GLM-5.2, commit `1aab962`)

**Status: design complete, no code written.** Stopped at the safe boundary after
measurement so the next session implements from a locked design. Everything below was
verified against the live database or the committed source, not inferred. Working tree
clean at the stop.

**The one real design question is RESOLVED — the accepter need NOT be signed in as the
invited address.** Possession of the 32-byte token is the claim (7.1a already reasoned
this: "the invitation carries a role, not an identity"). Requiring a matching signed-in
session would force creating a `User` for an invitee who has none — that is 7.3
self-serve signup, and this slice must not half-build it. So the join flow treats the
token as the claim and creates a `Membership` only.

**The RLS fix is the first thing to land, and it is verified-necessary.** Measured live:
`Invitation` carries exactly one policy (`tenant_isolation`, `FORCE`d), so an unbound
`asPlatform().invitation.findUnique({ where: { token } })` returns **zero rows silently**.
Apply the `Membership` `_self` pattern:

1. `packages/db/scripts/apply-rls.ts` — add a `tenant_isolation_token` block beside the
   `Membership` `_self` block: `FOR SELECT USING ("token" = current_setting('app.invitation_token', true))`.
2. `packages/db/src/tenant-client.ts` — add `INVITATION_SETTING = 'app.invitation_token'`
   and `withInvitationToken(token, work)`, shaped exactly like `withUser`.
3. `packages/db/src/index.ts` — export `withInvitationToken`.
4. `npm run rls --workspace @landingos/db` then re-run the preflight.

**The route is a page, not a `tenantRoute`.** `tenantRoute` requires a session + active
tenant and binds `withTenant` — all three are false for a signed-out invitee. Mirror
`/console/login/page.tsx`: a `page.tsx` under `/console/join/[token]/` that renders GET
for everyone and handles POST (a server action or a same-file handler). It may read
`getConsoleSession()` for a "signed in as X" banner but must never require it.

**The refusal vocabulary (every non-open state refuses IDENTICALLY, to avoid an oracle):**

| Condition | Status | Code |
|---|---|---|
| token resolves to no row (unknown / revoked / expired / wrong-tenant-via-deleted-tenant) | 404 | `INVITATION_NOT_FOUND` |
| invitation already `accepted` | 409 | `ALREADY_ACCEPTED` |
| the invited address has no `User` (7.3 owns creating one) | 409 | `ACCOUNT_REQUIRED` |
| the accepting user is already a member of this tenant | 409 | `ALREADY_MEMBER` |

Note the deliberate collapse: **expired, revoked, soft-deleted-tenant, and unknown token
all answer the same 404**, because distinguishing them turns the endpoint into an oracle
for which addresses have been invited. `accepted` and the two membership states are
different because the caller already proved they hold the token, so no oracle is opened.

**Idempotence:** accepting twice yields exactly one membership, guarded by `acceptedAt`
(precedence `accepted > revoked > expired > open`, from `invitationState` in `team.ts`).
The membership insert is the final write; `acceptedAt` is set in the same
`withInvitationToken` transaction, so a double-submit or a `PATCH`/POST race settles once.

**Acceptance writes (all inside the one `withInvitationToken` transaction the GET already
opened — OR a fresh one on POST, but never `asPlatform` for the writes):**
- `membership.create({ data: { tenantId: invitation.tenantId, userId, role: invitation.role } })`
  — `role` is trusted from the row (it passed `assignableRoleError` at issue time); never
  re-validate against an actor ceiling, there is no actor.
- `invitation.update({ where: { id }, data: { acceptedAt: new Date() } })` — only if null.
- `auditEvent.create({ ..., product: PLATFORM_PRODUCT, entity: "invitation", entityId, action: "accept", payload: { email } })` — never the token.
- Do **not** destroy/create sessions here. The invitee's session (if any) is their own;
  landing them in the new tenant is `switchTenant`'s job and is a separate concern.

**Files this slice will touch (predicted, for the audit trail):**
- `packages/db/src/tenant-client.ts` (+ export), `packages/db/src/index.ts`,
  `packages/db/scripts/apply-rls.ts` — the RLS binding + policy (the load-bearing change).
- `apps/website-builder/src/lib/platform/team.ts` — add `acceptInvitation(db, token, ...)` if
  the logic deserves a named helper (the reads/writes are small; a helper keeps the route thin).
- `apps/website-builder/src/app/console/join/[token]/page.tsx` (new) — GET + POST.
- `apps/website-builder/test/platform/team.test.ts` — new `describe` block for acceptance,
  following the existing fixture pattern (`invite()` then POST to `/console/join/[token]`).
- `packages/i18n/src/messages/{en,fr,ar}.json` — a `join` category (every string is a key).
- No `apps/erp` change. No schema migration (the policy is DDL applied by `npm run rls`).

**Verification the next session must run, in order:**
1. `npm run rls --workspace @landingos/db` then `npm run preflight --workspace @landingos/db` (9 checks).
2. `npm test --workspace @landingos/db` (29) — confirms the policy change broke nothing.
3. Stop node → `npm run builder:build` → `npm run builder:start` (Windows DLL lock + port race).
4. `ERP_CONTRACT=strict node --env-file=.env --test --test-concurrency=1 "test/platform/team.test.ts"` — expect 39 → ~48+.
5. Re-run a neighbouring suite (`test/erp/access.test.ts`, 63) to confirm no regression.

### 7.1c — DONE (GLM-5.2)

**Implemented and verified.** `test/platform/team.test.ts` 47 → **56/56** — nine
new screen tests. `/console/settings/team` renders the company's people and its
outstanding invitations, gated on `platform:team:read` (a MANAGER gets 404).

**D-06.2 enforced:** every refusal the API makes is unreachable from the screen,
because the control that would trip it is not rendered — the owner row has no
suspend/remove/role-change (`OWNER_IMMUTABLE`), the actor's own row has none
(`SELF_TARGET`), a member above the actor's ceiling has no role-change
(`ROLE_ABOVE_SELF`, via strictly ceiling-filtered `grantableRoles`), and an
accepted invitation has no revoke (`ALREADY_ACCEPTED`). The write surface is
gated again on `platform:team:write`, so a reader sees the list with no controls.

**The controls call the routes 7.1a built** (D-06.1) — invite, revoke, change
role, suspend, reactivate, remove — and add no write path of their own.

**Two bugs the tests caught:** (1) the role-change control rendered for an
above-ceiling member because `grantableRoles` included the member's current role
— fixed to strictly ceiling-filter, empty list = no control; (2) revoke was
gated on `invitation.path` which the list never carries — fixed to key off
`state === "open"`. See CHANGELOG §7.1c.

**Verified live:** team 56/56 · access 63/63 · screens 96/96 · console-shell
13/13 · i18n 18/18 · auth 36/36 · product-registry 36/36 · db 29/29. Build clean.
**Phase 7.1 (team management) is complete.**

### 7.2 — DONE (GLM-5.2)

**Implemented and verified.** `test/platform/billing.test.ts` is new at **19/19**
(14 API + 5 screen). `GET /api/platform/billing` and `PUT /api/platform/billing/
entitlements`, plus `/console/settings/billing`.

**The load-bearing test passes:** drop `product.erp` and every ERP route 403s on
the very next request — same session, no re-login — because `resolveSession`
re-reads `Subscription` every call. Add it back and access returns just as fast.

**Unknown entitlements are refused** (validated against the registry's catalog),
not silently stored. **SENSITIVE and not entitlement-gated** — a lapsed
subscription still manages its own billing. **No payment provider** — a Stripe
webhook is a second slice that writes the same row.

**Verified live:** billing 19/19 · team 56/56 · access 63/63 · console-shell
13/13 · i18n 18/18. Build clean. Full reasoning in CHANGELOG §7.2.

### 7.3 — DONE (GLM-5.2)

**Implemented and verified.** `test/platform/signup.test.ts` is new at **10/10**.
`POST /api/platform/signup` + `/console/signup`. **Phase 7 (the SaaS layer) is
complete.**

**R-08 closed:** the reserved-slug list (`isReservedSlug` in `resolve-tenant.ts`)
already guarded the storefront read path; this slice enforces it at CREATION.
Signup imports `isReservedSlug` and refuses with `RESERVED_SLUG` before
`tenant.create`.

**Four writes, two binding contexts:** Tenant + User via `asPlatform()` (no RLS),
Membership + Subscription via `withTenant(newTenantId)` (RLS-scoped, one
transaction). The new owner lands signed in — the route sets a session cookie
with `activeTenantId` = the new tenant, like login. Both products on trial.

**Refusal vocabulary:** reserved slug → `RESERVED_SLUG`; bad shape →
`INVALID_INPUT`; slug taken → `SLUG_TAKEN` (409, not 404 — this is a public
create); email taken → `EMAIL_TAKEN`; weak password → `INVALID_INPUT`. The
404-not-403 rule does not apply: telling a signup a slug is taken is necessary.

**Verified live:** signup 10/10 · team 56/56 · billing 19/19 · access 63/63 ·
console-shell 13/13 · i18n 18/18. Build clean. End-to-end: POST → 201, cookie
works (team = 1), storefront at `/{slug}` → 200. Full reasoning in CHANGELOG §7.3.

---

### 7.3 (measurement) — the locked design, preserved for the audit

### 7.3 — Self-serve signup (measured by GLM-5.2, ready to implement)

Create a tenant, its OWNER, and a TRIALING subscription in one transaction. The
slug is the hard part and it is already recorded as **R-08**: `Tenant.slug` is a
public-namespace unique that appears in every storefront URL, so it needs a
reserved-word list (`api`, `console`, `login`, `admin`, `_next`, …) or a customer
can claim a path the platform routes on.

**Measurement (GLM-5.2, commit `fdc9d85`) — no code written, design locked.** This
slice is the first PUBLIC, UNAUTHENTICATED write path on the platform (every prior
write is session-gated). It creates four rows across two binding contexts, so it
is heavier than 7.1/7.2 and was deliberately deferred to a fresh session rather
than started at the tail of the 7.2 run.

**R-08 is half-done — the create half is what this slice adds.** The reserved-word
list ALREADY EXISTS and guards the read path: `RESERVED_TENANT_SLUGS` +
`isReservedSlug(slug)` in `apps/website-builder/src/lib/storefront/resolve-tenant.ts`.
The storefront resolver refuses a reserved slug (returns null → 404). But
`isReservedSlug` has **no caller in any creation path** — `grep` returns 3 hits, all
in that one file. The schema comment on `Tenant.slug` says "additionally checked
against a reserved-word list at creation"; the "at creation" half is unimplemented
because no creation route exists yet. **Signup must import `isReservedSlug` and
refuse before `tenant.create`.**

**The four writes, and which binding each needs:**

| Write | Client | Why |
|---|---|---|
| `Tenant.create({ slug, name })` | `asPlatform()` | `Tenant` has no `tenantId`, no RLS |
| `User.create({ email, name, passwordHash })` | `asPlatform()` | `User` is global identity |
| `Membership.create({ tenantId, userId, role: "OWNER" })` | `withTenant(tenant.id)` | RLS-scoped; the tenant must be bound |
| `Subscription.create({ tenantId, ... })` | `withTenant(tenant.id)` | RLS-scoped; default `status: TRIALING` (the schema default — do NOT set ACTIVE like the seed does) |

The `Tenant` + `User` creates are platform-side; then `withTenant(newTenantId,
tx => { membership.create; subscription.create })` does the two RLS-scoped writes
inside one transaction. If the second half fails, the tenant+user are orphaned —
acceptable for a first slice (cleanup is Phase 8), but worth a comment.

**The proven shapes (copy from the test harness, not the seed):**
- `makeTenant` in `test/erp/helpers.ts` — minimal: `asPlatform().tenant.create({ data: { slug, name } })`, then `withTenant(id, tx => tx.subscription.create({ data: { tenantId, status, entitlements } }))`. Leave `status` unset for TRIALING.
- `makeMember` — `user.create`, then `membership.create` inside `withTenant`, then `createSession(userId, tenantId)`.
- Slug shape: kebab-case lowercase, matching `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` (same as the registry's `ID_PATTERN`). `tenantBySlug` lowercases before lookup, so lowercase on store.

**Refusal vocabulary (each needs a test):**
- reserved slug → 422 `RESERVED_SLUG` (use `isReservedSlug`)
- slug not kebab-case / too short / too long → 422 `INVALID_INPUT`
- slug already taken (`Tenant.slug @unique`) → 409 `SLUG_TAKEN` (the 404-not-403 rule does NOT apply here: this is a public create, and telling a signup that a slug is taken is necessary, not an oracle)
- email already registered → 409 `EMAIL_TAKEN` (one account per email; the consultant case is one person in many companies via Membership, not many accounts)
- weak/missing password → 422 `INVALID_INPUT`

**Route shape:** `POST /api/platform/signup` (NOT `/console/signup` — it is public,
pre-session, like `/console/login`). Returns the join-link shape: create a session,
set the cookie, redirect to `/console`. Mirror the login page's server-action shape
OR a plain route handler. The page is `/console/signup` (gated to signed-OUT
visitors — redirect to `/console` if already signed in, the way login does).

**Entitlements on signup:** a fresh tenant starts with BOTH products on trial
(`['product.website-builder', 'product.erp']`) OR none — a design decision worth
recording. The spec says TRIALING subscription; the trial's entitlements are the
question. Recommend: both products, since a trial that shows an empty console
teaches nothing, and the billing screen (7.2) lets the owner turn them off.

**Do NOT:** create accounts from a product surface (M-02 — the 501 on
`POST /api/erp/agents` exists to state it). Signup is a platform action.

### What Phase 7 must not do

- Do not give a product a way to create accounts. That is M-02, and the 501 on
  `POST /api/erp/agents` exists to state it.
- Do not put a team or billing nav item inside a product. The registry refuses
  it, and the reason is that a tenant with N products must still see ONE of each.
- Do not weaken `SENSITIVE`. `platform:team:*` and `platform:billing:*` are on it
  so that MANAGER — who runs a call centre day to day — does not by default get
  to decide who works there or what the company pays for.

---

## 3. The migrations Phase 5 left, with what they owe

| id | Scope | Owes |
|---|---|---|
| **M-15** | **DONE — 6.5b and 6.6b.** Jobs → `services/worker`; all three of the ERP's scheduled loops have a platform equivalent. | Discharged. `test/erp/jobs.test.ts` supersedes `overdue-sweep.test.js`, asserting the same behaviours plus the idempotence a scheduled job needs — and, since 6.6b, the authorised half of the tick that had never been executed. |
| **M-16** | **DONE — 6.6c, 6.6d, 6.6e.** Storage, audience, per-account read state, every producer, a live SSE stream with exact replay, Web Push, and the service worker that receives it. | Discharged: `test/erp/notifications.test.ts` (33 tests) supersedes `notifications.test.js` and covers the SSE half of `delivery-outcome.test.js`. |
| **M-14** | ERP images → R2. | — |
| **M-19** | Template registry. The storefront has one hardcoded template with colour-only themes. | — |
| **—** | **DONE in 6.6f.** Stock reservation on confirm/cancel, plus the notification-retention and expired-session prunes that existed with no caller. | Discharged: 9 contract tests over FIFO lot consumption in `catalog.test.ts`. |

---

## 4. Two guarantees that still need a platform owner

Both were real and tested in the ERP and have no equivalent here. Neither
belongs in a product suite, which is why they left it in 5.1:

1. **Cross-origin state changes.** The ERP refused a POST carrying an
   unrecognised `Origin` with `CSRF_ORIGIN`. CORS stops an attacker *reading* a
   cross-site response; it does not stop the request happening. `/api/builder/*`
   and `/api/erp/*` have no such check.
2. **Rate limiting.** Login throttling per IP *and* per account, keyed
   case-insensitively so casing cannot reset the counter, plus a general API
   backstop that exempts the event stream and inbound carrier webhooks (carriers
   replay backlogs and must never be throttled off).

---

## 5. Deliberate 501s, so nobody reads them as gaps

- `POST /api/erp/agents` — inviting a person is a PLATFORM action (M-02).
  Gated first, so an agent is still refused; a manager is told where it lives.
- `POST /api/erp/ai/chat`, `GET /api/erp/ai/chat/stream`,
  `POST /api/erp/ai/insights/deep` — calling a model needs a configured provider
  and a real key, which is deployment configuration. Gated first, because
  leaving them unrouted would put a hole in "every AI route requires a session"
  exactly where SEC-03 was.

---

## 6. Not blocking, but do them when convenient

- **Rotate the two credentials** listed under *Security actions* in
  PROJECT_STATE. Needs a human.
- **Verify the Docker image** — never built:
  `docker build -f apps/website-builder/Dockerfile -t landingos-builder .`
- **Replace the `(db as any)` casts** in the Phase 4.4 builder routes. The
  entire ERP layer is written without one — `db.fulfillmentOrder` typechecks on
  `TenantDb` — so the pattern is proven; it is only the older routes left.
- **Rename `apps/website-builder`.** It hosts the whole platform. The end of
  Phase 6, when `apps/erp` is deleted and there is exactly one app, is the
  moment — if ever.

---

## Do not

- Do not weaken tenant isolation to make something pass.
- Do not add `where: { tenantId }` — the binding already does it.
- Do not assume only two products exist.
- Do not trust a green build; verify against the running server.
- Do not "fix" a contract test by relaxing its assertion. It asserts the
  boundary the ERP shipped with; giving that up is a decision to record, not an
  assertion to edit.
- Do not put a per-tenant sequential number in a primary key (D-05.3).
- Do not add `(db as any)`. Typed model access works; the casts are what hid the
  nested-`$transaction` bug.
- Do not catch P2002 per-insert inside a transaction. A unique violation aborts
  the whole Postgres transaction; use `createMany({ skipDuplicates: true })`.
