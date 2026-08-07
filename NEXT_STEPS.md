# Next Steps

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
| **UI.6** | Move `ConsoleShell` into `console/layout.tsx`, then add `loading.tsx` per segment | M | This is the ONLY thing blocking a real route-level loading state. Every console page is `force-dynamic` and runs 2–11 queries before it can paint; today a Suspense fallback would blink the sidebar out, because the shell is rendered by each PAGE and every screen resolves its own session. Doing it also removes one bound read per navigation. |
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
