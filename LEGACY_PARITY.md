# Legacy Parity Report — `apps/erp` (legacy CRM/ERP) vs the LandingOS platform ERP

**Measured:** 6 August 2026 · **Baseline commit:** `a780cd8` · **Working tree:** clean
**Measured by:** reading both implementations end to end, not by consulting prior documentation.

---

## 0. What was measured, and how

| Side | Artefact | Size |
|---|---|---|
| **Legacy** | `apps/erp/index.js` | 3,762 lines · **123 HTTP routes** |
| | `apps/erp/lib/db.js` | 185 KB · **27 SQLite tables** |
| | `apps/erp/lib/` (auth, inventory, followup, jobs, notifications, ratelimit, statusMap) | 7 modules |
| | `apps/erp/lib/providers/` | 6 files · **4 real carrier adapters** (`zr` 479 ln, `ecom` 211 ln, `zr-webhook`, `mock`), 12 declared |
| | `apps/erp/lib/platforms/` | 4 files · **2 real channel adapters** (`shopify`, `lightfunnels` 289 ln), 9 declared |
| | `apps/erp/lib/ai/` | 9 files · **3 real model adapters** (anthropic, gemini, openai-compat) + context/insights/agents |
| | `apps/erp/index.html` | 4,949 lines · **15 manager screens** |
| | `apps/erp/agent.html` | 1,261 lines · the agent PWA |
| | `apps/erp/calculateur_profit_perte.html` | 1,244 lines · the profit/loss calculator |
| **Platform** | `src/app/api/erp/**` | **60 route files** (~95 method handlers) |
| | `src/app/console/erp/**` | **12 screens** |
| | `src/lib/erp/**` | 22 modules |
| | `packages/db/prisma/schema/erp.prisma` | **22 models** |

Two things were confirmed before anything else:

1. **The legacy CRM/ERP is `apps/erp`.** `C:\Users\HP\drive-download-…` is the
   pre-migration *website builder* (`nextjs_tailwind_shadcn_ts`, 65 commits),
   already imported into `apps/website-builder` in Phase 3.1 — not the CRM.
2. **The schema is at parity.** All 27 legacy tables have a platform home (22 ERP
   models + `Membership`/`ProductSetting`/`Session`/`AuditEvent`/`Notification`
   on the platform side). No data model is missing. **Every gap below is
   behaviour, not storage** — and several are storage that exists with nothing
   using it.

---

## 0b. Second pass — what the first pass got wrong

**Re-measured 6 August 2026, from commit `9d1f887`.** The first pass compared
**123 routes against 60 route files and 15 screens against 12**. That is an API
inventory, and it is the wrong instrument for the question "can an operator do
their job here". Read a second time at the level of *workflows* — the SPA's
4,949 lines of JavaScript, the agent PWA's live loop, the service worker, and
every control on every screen — five pass-1 verdicts do not survive, and twelve
features were missed entirely because **no route was missing to point at them**.

**The systematic error:** a feature was marked ✅ when the endpoint existed and
had contract tests. Several of those endpoints have **no caller anywhere in the
console**. That is the same defect the first pass caught in `IntegrationLog` and
then failed to look for anywhere else.

### Verdicts corrected

| # | Was | Now | Why |
|---|---|---|---|
| **L1** live notification feed | 🔵 | **🔴** | M-16 built storage, audience, an SSE stream with exact replay, Web Push and a service worker — **33 contract tests** — and *nothing in the console consumes any of it*. No bell, no badge, no panel, no toast. `grep` for a consumer of `/api/platform/notifications` outside `app/api/` returns nothing. A signed-in operator sees no notification, ever. |
| **L2** per-account read state | 🔵 | **🔴** | Same. `unreadCount()` exists in `lib/platform/notifications.ts` and has no caller. |
| **L3** Web Push | ✅ | **🟡** | Sending works and the worker can receive it. There is no in-app surface at all, so push is the *only* way a notification can ever reach a person — and only if VAPID is configured, which it is not by default. |
| **B3** create an order | ✅ | **🔴** | `POST /api/erp/orders` has contract tests and **no console control**. `grep` for `"/api/erp/orders"` in `components/` and `app/console/` returns nothing. A manager taking an order over the phone cannot enter it. The legacy has a "New order" button and modal on the main screen. |
| **B1** list + filter | ✅ | **🟡** | `orderFilters` supports nine filters — *richer* than the legacy's four — and the orders screen **renders no filter form**. Only `/console/erp/queue` has one. A manager must hand-type query strings. |

### The one that changes the verdict

**There is no pagination anywhere in the console.** Every ERP screen is a
hard-capped first-N read with no next, no previous, no page number and no total:

| Screen | Cap |
|---|---|
| orders | 50 |
| clients | 50 |
| products | 100 |
| inventory movements | 50 |
| shipments | 100 |
| follow-up | 100 |
| finance / charges | 50 / 25 |
| queue | 20 |

The legacy downloaded the whole book and filtered in the browser — slow at 5,000
orders, which is exactly what PERF-02 was filed for. The platform fixed the
query side properly (filter, scope and page all in SQL) **and then never built
the navigation**. So the data went from *slow to reach* to *impossible to
reach*: with 51 orders, order 51 does not exist as far as the console is
concerned. That is a worse outcome than the bug that was fixed, and it is a
production blocker in its own right.

---

## 1. Scoreboard

**117 features compared** (101 in the first pass, 14 added by the second, 2 surfaced while implementing LP.4).

| Class | Count | Share | Measured |
|---|---|---|---|
| ✅ IDENTICAL | 52 | 44% | at the second pass, `9d1f887` |
| 🔵 IMPROVED | 6 | 5% | |
| 🟡 PARTIAL | 20 | 17% | |
| 🔴 MISSING | 39 | 33% | |

**These counts are the second pass's and have deliberately NOT been re-derived
slice by slice.** Six slices have landed since (LP.1–LP.6) and each records what
it closed in its own card; re-scoring the whole board after every slice invites
the failure §0b exists to name — a number that moves while the workflow behind it
has not been re-measured. **TIER 1 IS NOW COMPLETE, which is the moment to
re-measure**: the whole board is due one full pass, at the level of workflows and
not routes, before Tier 2 is called finished.

**Verdict: TIER 1 IS COMPLETE, and the platform still cannot replace the legacy
CRM in production — for one reason that is now the whole of it.** An operator can
enter a phone order, find it, correct a product's cost, book a real parcel with
ZR Express and hand a day's confirmed orders to a carrier with no API. What they
still cannot do is **be told anything**: M-16's entire transport has no consumer,
so nothing reaches a signed-in person until they reload. That is Tier 2's first
slice and the last of §0b's six blockers.

The **domain layer** — the business rules, the ledger, the settlement chain, the
assignment rules, the jobs — is at or above parity and in several places is
objectively better than the legacy (see §6.3). What is missing is almost entirely
the **consumer layer**: screens, controls and the live loop that turn those rules
into an operator's working day.

| Blocker | Why it blocks production |
|---|---|
| ~~**No real carrier adapter**~~ | *(Fixed in LP.2 + LP.5. `zr` is registered and books real parcels — territory resolution, Svix webhooks, outbound creation. `ecom` remains, at Tier 3 slice 22.)* |
| ~~**No pagination, anywhere**~~ | *(Fixed in LP.3.)* |
| **No product editing** | *(Fixed in LP.1.)* |
| ~~**No export**~~ | *(Fixed in LP.6. CSV for ZR Express / Ecom Delivery / Ecotrac plus the performance report, produced from the order list and carrying its filters — which the legacy's separate Export screen could not do.)* |
| ~~Cannot create an order~~ | *(Fixed in LP.4.)* |
| **No notification surface** | The whole M-16 transport exists with no consumer. An operator is never told anything. Found in the second pass. |
| **No client management** | The registry is a read-only list. No detail view, no correction, no import — although `Client.importedTotalOrders` / `importedSource` / `importedAt` exist in the schema, unused. |

Two further findings worth stating on their own:

- **`/console/erp/ai` is a live 404.** The ERP manifest ships an `ai` nav item
  (`packages/product-registry/src/manifests.ts:89`) and there is no
  `console/erp/ai/page.tsx`. An owner clicking "AI" in their own product's
  navigation gets a not-found. `screens.test.ts` enumerates eight screens and
  does not include it, so nothing catches it.
- **`IntegrationLog` has zero callers.** The model was migrated (`erp.prisma:430`)
  and nothing reads or writes it. `Carrier.lastTestAt` / `lastSyncAt` /
  `lastTestOk` are *selected and rendered* on the carriers screen
  (`carriers/page.tsx:181`) and *never written*, because no test or sync route
  exists. The column shows "—" forever.

---

## 2. Feature-by-feature comparison

Legend: ✅ identical · 🔵 improved · 🟡 partial · 🔴 missing

### A. Identity, access and hardening

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| A1 | Sign in | `POST /api/auth/login`, name+password, decoy verification | `/console/login`, opaque server-side session, argon2id | 🔵 |
| A2 | Sign out | `POST /api/auth/logout` | server action | ✅ |
| A3 | Who am I | `GET /api/auth/me` | `requireConsoleSession` | ✅ |
| A4 | Change own password | `POST /api/auth/change-password` — requires current, drops all other sessions | `/console/settings/profile` — same rule | ✅ |
| A5 | **Manager resets another account's password** | `POST /api/agents/:name/password` | — | 🔴 |
| A6 | Grant/revoke manager | `PUT /api/agents/:name/account-role`, 2 roles | `/api/platform/team/members/[userId]`, 5 roles + ceiling | 🔵 |
| A7 | Cannot remove the last manager | `LAST_MANAGER` guard | owner is immutable (D-07.1) | 🔵 |
| A8 | Create an account | `POST /api/agents` | invitation flow (7.1) — ERP route 501 by design (M-02) | 🔵 |
| A9 | Suspend / reactivate | `POST .../suspend`, `/reactivate` | same, both ERP and platform team | ✅ |
| A10 | Remove a person | `DELETE /api/agents/:name` | `DELETE /api/platform/team/members/[userId]` | ✅ |
| A11 | **Login rate limiting** | `lib/ratelimit.js` — per IP *and* per account, case-insensitive key | — | 🔴 |
| A12 | **API rate-limit backstop** | present, exempts SSE + carrier webhooks | — | 🔴 |
| A13 | **Cross-origin state-change refusal** | `CSRF_ORIGIN` on every mutating request | — | 🔴 |
| A14 | Tenant isolation | none (single company) | 3 layers, RLS-enforced | 🔵 |

### B. Orders

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| B1 | List + filter + paginate | `GET /api/orders` + 4 filters, instant | 9 filters in `orderFilters`, **no filter form and no pager on the screen** (corrected in §0b) | 🟡 |
| B2 | Stats | `GET /api/orders/stats` | same | ✅ |
| B3 | **Create** | `POST /api/orders`, "New order" button + modal | route exists, **no console control** (corrected in §0b) | 🔴 |
| B4 | Edit | `PUT /api/orders/:id` | `PATCH` | ✅ |
| B5 | Delete | `DELETE /api/orders/:id` | same | ✅ |
| B6 | Call start / log result | `/call-start`, `/call` | same | ✅ |
| B7 | Notes (5 types) | `/note` | same | ✅ |
| B8 | Audit timeline | `/audit` | same | ✅ |
| B9 | Classify as fake | `/classify` | same | ✅ |
| B10 | Attempts matrix (day × tentative) | `/attempts` | same | ✅ |
| B11 | Reassign | `PUT` with `agent` | `PATCH`, gated on `seesWholeBook` | ✅ |
| B12 | **Bulk actions** | 8: assign · status · classify · assignFollowup · delete · createShipments · sendToDelivery · export/print | 4: status · delete · assign · **export** (LP.6) | 🟡 |
| B13 | **Board (kanban) view** | `renderBoardView`, persisted in localStorage | list only | 🔴 |
| B14 | Export confirmed orders to carrier formats | ZR Express · Ecom Delivery · Ecotrac · full performance report — 4 XLSX builders | same four, as CSV, from the order list and carrying its filters (LP.6) | ✅ |
| B15 | **Import orders from Shopify CSV** | drop-zone, preview, dedup by `shopifyId` | — | 🔴 |
| B16 | **Print labels for selected orders** | `bulkPrintSelected()` | — | 🔴 |
| B17 | Auto-assign on create | `autoAssign` | `autoAssignOnCreate` (6.6a) | ✅ |
| B18 | Stock reservation on confirm/cancel | `reservationMode` | ported 6.6f | ✅ |

### C. Delivery and carriers

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| C1 | Carrier CRUD | `/api/providers` × 5 | `/api/erp/carriers` × 5 | ✅ |
| C2 | Adapter registry | `GET /api/providers/adapters` | `GET /api/erp/carriers?adapters=true` | ✅ |
| C3 | **Real carrier adapters** | `zr` (479 ln, live territory resolution + outbound parcels), `ecom` (211 ln), `zr-webhook`, `mock`; 12 keys declared | **`mock` + `zr`** (LP.5) — `zr` is stricter than the legacy on commune scoping (D-LP.5.2) and fails closed on Svix. `ecom` and `zr-webhook` remain. | 🟡 |
| C4 | **Test connection** | `POST /api/providers/:id/test` — live or structural, writes `lastTestAt`/`lastTestOk` + a log | — (columns rendered, never written) | 🔴 |
| C5 | **Sync now** | `POST /api/providers/:id/sync` — re-poll every shipment for this carrier | — | 🔴 |
| C6 | **Integration logs** | `GET /api/providers/:id/logs`, `db.logIntegration` on every adapter interaction | `IntegrationLog` model exists, **zero callers** | 🔴 |
| C7 | Status mappings | GET · POST · **DELETE /:mid** | GET · POST | 🟡 |
| C8 | **Default carrier per channel** | `GET/PUT /api/stores/:id/default-carrier` | `defaultCarrierByChannel` setting exists, no route, no control | 🟡 |
| C9 | Book a parcel | `POST /api/orders/:id/shipment` | same | ✅ |
| C10 | Refresh tracking | `/shipment/refresh` | same | ✅ |
| C11 | Inbound delivery webhook | `POST /webhook/delivery` | `/api/erp/webhooks/[tenant]/delivery` | ✅ |
| C12 | Tracking poll on a timer | in-process timer | `pollCarriers` + `services/worker` (6.6b) | 🔵 |
| C13 | Delivery outcome settlement | present | present | ✅ |
| C14 | CRM status vocabulary API | `GET /api/delivery/statuses` | vocabularies are server-side props only | 🔴 |
| C15 | Order status vocabulary API | `GET /api/statuses` | same as above | 🔴 |

### D. Sales channels (legacy "stores")

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| D1 | Channel CRUD | `/api/stores` × 4 | `/api/erp/sales-channels` × 4 | ✅ |
| D2 | **Channel management screen** | `page-stores` | **no screen, no nav item** | 🔴 |
| D3 | **Platform adapter registry** | `GET /api/platforms` — 9 keys | — | 🔴 |
| D4 | **Real channel adapters** | `shopify` (HMAC-verified), `lightfunnels` (289 ln) | one generic `parseOrder` in `lib/erp/webhooks.ts` | 🟡 |
| D5 | **Test connection** | `POST /api/stores/:id/test` | — | 🔴 |
| D6 | **Channel logs** | `GET /api/stores/:id/logs` | — | 🔴 |
| D7 | Inbound order webhook | `POST /webhook/store/:id` | `/webhooks/[tenant]/channel/[id]` | ✅ |
| D8 | Abandoned-checkout webhook | `/checkout` | same | ✅ |
| D9 | Contact webhook | `/contact` | same | ✅ |
| D10 | **Lead-capture webhook** | `/lead-capture` — partial-form capture, 24 h merge window | — | 🔴 |
| D11 | **Product webhook** | `/product` — auto-creates a catalogue product + external link | — | 🔴 |
| D12 | **Shopify HMAC endpoint + draft orders** | `POST /webhook/shopify`, incl. `draft_orders/create` | — | 🔴 |

### E. Products and inventory

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| E1 | List (active + archived) | `GET /api/products?archived` | same | ✅ |
| E2 | **Create** | 15 fields incl. description, image, variants, optionDefs, niche, category, supplier | API accepts 11; **form offers 8** (no description, image, variants) | 🟡 |
| E3 | **Edit a product** | `PUT /api/products/:id` | **no route, no control** | 🔴 |
| E4 | Archive / restore | `DELETE`, `/unarchive` | same | ✅ |
| E5 | Product history timeline | `/history` | same | ✅ |
| E6 | **Variant editor** | `PUT /api/products/:id/variants` — per-variant stock, threshold, SKU, option map | — | 🔴 |
| E7 | **`niche` / `category` / `supplier`** | product columns, drive client + analytics filters | **columns absent from `CatalogProduct`** | 🔴 |
| E8 | Inventory read | `/inventory` | same | ✅ |
| E9 | FIFO stock lots (purchase / return) | `/stock-lots` | same | ✅ |
| E10 | Manual adjustment with reason | `/inventory/adjust` | same | ✅ |
| E11 | Movement ledger | `/inventory/history` | same | ✅ |
| E12 | Low-stock alerts | `/inventory/low-stock` | same | ✅ |
| E13 | Per-product sales summary | `/sales-summary` | same | ✅ |

### F. Clients

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| F1 | **List + filters** | search, sort, wilaya, product, niche, store, minOrders, minDelivered, since, until | **search only** | 🟡 |
| F2 | Filter options | wilaya · niche · store | wilaya · commune | 🟡 |
| F3 | **Client detail + full order history** | `GET /api/clients/:id` | **no route, no screen** | 🔴 |
| F4 | **Correct a client's details** | `PUT /api/clients/:id` (name, wilaya, commune, address) | — | 🔴 |
| F5 | **Import clients (preview + commit)** | `/import/preview`, `/import` — the schema's `imported*` columns exist for this | — (columns present, **unused**) | 🔴 |
| F6 | **Export clients** | `exportClients()` | — | 🔴 |
| F7 | Auto-populate from orders | `upsertClientFromOrder` | `syncClientFromOrder`, atomic increments | 🔵 |

### G. Finance

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| G1 | One-off charges | `/api/unexpected-charges` × 3 | same | ✅ |
| G2 | Saved P&L records | `/api/financial-records` GET+POST | same | ✅ |
| G3 | Prorated fixed costs | `/prorate-fixed` | same | ✅ |
| G4 | **Record versions** | `/versions` — every save of the same period, in order | — | 🔴 |
| G5 | **Period aggregation** | `/aggregate` — roll weeks→month, months→quarter/year, without recomputing | — | 🔴 |
| G6 | **Profit/loss calculator screen** | `calculateur_profit_perte.html`, 1,244 lines, auto-filled from `/sales-summary` + `/prorate-fixed` | — | 🔴 |

### H. Follow-up (Suivi)

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| H1 | Dashboard buckets | `/api/followup/dashboard` | same | ✅ |
| H2 | Task list, scoped | `/api/followup/tasks` | same | ✅ |
| H3 | Resolve a task | `/tasks/:id/resolve` | same (6.4c) | ✅ |
| H4 | Raise a task from a carrier event | `raiseFollowupTask` | ported 6.5a | ✅ |
| H5 | Auto-assign on confirm | `followupAutoAssign` | ported 6.6a | ✅ |
| H6 | **Assign a follow-up agent by hand** | `POST /api/followup/assign` (`agent` or `auto`) | **no route, no control** | 🟡 |
| H7 | Escalation + overdue sweep | in-process timers | idempotent jobs + worker (6.5b) | 🔵 |

### I. Agents and payroll

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| I1 | Roster + per-agent stats | `GET /api/agents` | `/console/erp/agents` | ✅ |
| I2 | Pay rates | `PUT .../payment` | `PATCH agents/[id]` | ✅ |
| I3 | Job role | `PUT .../role` | `PATCH agents/[id]` | ✅ |
| I4 | Weekly days off | `PUT .../days-off` | same | ✅ |
| I5 | Suspend / reactivate | present | same | ✅ |
| I6 | Payroll (one + all) | `/payroll` × 2 | same | ✅ |
| I7 | **Reset the missed-order counter** | `POST /api/agents/:name/reset-missed` | **no route, no control** | 🔴 |
| I8 | Auto-suspend at threshold | `autoSuspend` | ported 6.5b | ✅ |

### J. AI

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| J1 | **AI provider CRUD** | 7 routes: list · adapters · presets · create · update · delete · default · test · logs | **GET + POST only** | 🟡 |
| J2 | **AI agent CRUD** | 5 routes: list · enabled · create · update · delete | **GET + POST only** | 🟡 |
| J3 | Permission ceiling | `/api/ai/permissions` | same | ✅ |
| J4 | **Chat** | `POST /api/ai/chat` — 3 live model adapters | **501** | 🔴 |
| J5 | **Chat stream** | `GET /api/ai/chat/stream` | **501** | 🔴 |
| J6 | Conversations | GET · DELETE | same | ✅ |
| J7 | **Instant insights** | `lib/ai/insights.js`, 173 lines of rules | 3 counts | 🟡 |
| J8 | **Deep analysis** | `POST /api/ai/insights/deep` | **501** | 🔴 |
| J9 | **AI screen** | `page-ai-chat` + `page-ai-settings` | **nav item exists, screen does not — 404** | 🔴 |

### K. Analytics and dashboards

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| K1 | **Headline dashboard** | 7 stat cards incl. confirmation rate, cancellation rate, average order, delivered/returned parcels with revenue | 6 tiles, no rates, no averages | 🟡 |
| K2 | **Analytics screen** | 7 breakdown tables (status · channel · product · wilaya · confirming agent · marketer · delivery status), each with orders / confirmed / conf-rate / canc-rate / revenue, over 5 date presets | — | 🔴 |
| K3 | **Agent-manipulation alerts** | `page-alerts` — every order with a suspicious call, sorted by recency, with a nav badge | — | 🔴 |
| K4 | Suivi tracking screen | `page-suivi` buckets | `/console/erp/follow-up` + `/shipments` | ✅ |
| K5 | Low-stock banner + nav badge | present | inventory screen | ✅ |

### L. Notifications

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| L1 | **Live feed (SSE)** | one writer per name, in-process; drives every screen refresh | the transport is better and **has no consumer in the console** (corrected in §0b) | 🔴 |
| L2 | **Read state** | global, with a bell and a badge | per account, `unreadCount()` **has no caller** (corrected in §0b) | 🔴 |
| L3 | Web Push | `web-push`, alongside an in-app bell | sending + worker work; **no in-app surface at all**, so push is the only channel (corrected in §0b) | 🟡 |
| L4 | VAPID public key | `/api/push/vapid-public-key` | `GET /api/platform/push` | ✅ |

### M. Settings

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| M1 | Automation settings + validation | `SETTINGS_SCHEMA`, 17 keys | ported unchanged, per-tenant | ✅ |
| M2 | Cross-field work-hours rule | present | present | ✅ |
| M3 | Server-URL setting | present | not applicable (same origin) | ✅ |

---

## 3. Detail cards — every 🟡 and 🔴

Ordered by the roadmap position assigned in §4. Complexity is **S** (≤ ½ day),
**M** (1–2 days), **L** (3–5 days), **XL** (> 1 week).

---

### R1 · Product editing — 🔴 MISSING
**Legacy:** `PUT /api/products/:id` merges any subset of fields onto the stored
product and records the change on the permanent timeline. The products screen
opens the same modal for create and edit.
**Now:** `products/[id]/route.ts` exports `GET` and `DELETE` only.
`ProductRowActions` offers archive/restore. There is no way to change a name,
price, cost, packaging cost, threshold, description or image after creation.
**Missing:** the whole edit path — route, validation, event row, control.
**Business impact:** **Critical.** `costPrice` and `packagingCost` are the cost
basis for FIFO lots, payroll's delivered-order pay, `/sales-summary`, and every
P&L record. A typo at creation is permanent and silently corrupts money figures
forever. The only workaround is archive-and-recreate, which orphans the movement
ledger and the sales history.
**Complexity:** **S** — the create route's zod schema, `PRODUCT_SELECT`, and
`CatalogProductEvent` all exist.
**Dependencies:** none.

---

### R2 · Real carrier adapters — 🟡 PARTIAL *(ZR done — LP.2 + LP.5)*
**Legacy:** four working adapters. `zr.js` (479 lines) books real parcels against
ZR Express: dynamic wilaya/commune territory resolution via
`POST /territories/search`, Svix webhook envelope handling, `X-Tenant`/`X-Api-Key`
auth, a 20-entry status map, and a deliberate throw with a French message when an
address cannot be resolved. `ecom.js` (211 lines) does the same for Ecom Delivery.
`zr-webhook.js` handles the older inbound-only integration. Twelve adapter keys
are offered in the UI.
**Now:** `ADAPTERS = { mock, zr }`. `getAdapter` returns **null** for an
unregistered key (LP.2) and `zr` books real parcels (LP.5) — territory
resolution at booking time, `X-Tenant`/`X-Api-Key` auth, the 20-entry status
map, Svix webhooks, and a refusal naming the wilaya or commune it could not
resolve.
**Still missing:** `ecom` (211 ln) and `zr-webhook`.
**Three places the platform is now stricter than the ERP**, each recorded as a
decision rather than as a port: the commune must belong to the resolved wilaya
(**D-LP.5.2** — the ERP's "ignoring parentId, rare but safe" fallback books a
parcel to the right name in the wrong province); the Svix check **fails closed**
(the ERP's returned *accept* for a missing header, a missing secret and from its
own `catch` — SEC-04); and the carrier call happens **outside the request
transaction** (**D-LP.5.1**), because booking is triggered by a confirmation and
a 15-second transaction timeout would have rolled that confirmation back.
**Complexity:** **M** for Ecom, which now has a contract, a stub-server test
pattern and the three-phase shape to follow.
**Dependencies:** R3 (test connection) is how anyone would verify credentials
without booking a parcel.

---

### R3 · Carrier test / sync / integration logs — 🔴 MISSING
**Legacy:** `POST /api/providers/:id/test` (live adapter test, or a structural
check when the adapter has none) writes `lastTestAt` + `lastTestOk` and an
`integration_logs` row. `POST /:id/sync` re-polls every shipment for that carrier.
`GET /:id/logs` returns the last 100 interactions. The same three exist for
stores.
**Now:** none of the three. `IntegrationLog` has **zero callers** anywhere in the
repo. `Carrier.lastTestAt` and `lastTestOk` are selected by the API and rendered
by `carriers/page.tsx:181` — and written by nothing.
**Missing:** the test route, the sync route, the log route, and every
`logIntegration` call site.
**Business impact:** **High.** Pasting an API key and having no way to check it is
how a tenant discovers a bad credential from a customer complaint. With no logs,
a failed webhook is invisible: the legacy system's answer to "why did this order
not arrive" is a log line, and there is no equivalent.
**Complexity:** **M.**
**Dependencies:** R2 for a meaningful live test; the structural test works today.

---

### R4 · Order export to carrier formats — ✅ DONE (LP.6)
**Legacy:** the Export screen produces four XLSX files —
ZR Express (`Nom, Tel, Tel2, Wilaya, Commune, Produit, Qte, Prix, Note`),
Ecom Delivery, Ecotrac, and a two-sheet performance report (Orders + Agents with
confirmation rates and suspicious-call counts). Plus bulk export and bulk label
printing from the order list selection.
**Now:** all four, as CSV, from `GET/POST /api/erp/orders/export` and a panel on
the order list. The report's two sheets are two formats (`orders`, `agents`), and
the ticked-rows export is the POST.
**Three ways the platform's is better, and one way it is not.** It carries the
LIST's filters (the legacy's separate Export screen could only ever produce "all
confirmed"); a carrier file cannot be widened past `confirmed` by any caller,
including one ticking rows; a cell beginning `=`/`+`/`-`/`@` is neutralised, where
`XLSX.utils.json_to_sheet` passed a stranger's customer name straight into an
operator's Excel; and the file is capped at 10,000 rows with a named refusal
rather than being unbounded. **Not better:** CSV has no sheets, so the two-sheet
report is two files (D-LP.6.1), and XLSX remains the answer if a carrier is ever
found that refuses CSV.
**Still missing from B12:** bulk label PRINTING, which is Tier 4 slice 25 and was
deliberately not pulled forward.

---

### R5 · Client detail, correction, import and export — 🔴 MISSING (4 features)
**Legacy:** `GET /api/clients/:id` returns the client plus their complete order
history. `PUT /api/clients/:id` corrects name/wilaya/commune/address without ever
touching the lifetime counters. `POST /import/preview` and `/import` take
browser-parsed CSV/Excel rows and merge them, recording `importedSource` and
`importedAt`. `exportClients()` downloads the filtered list.
**Now:** a single searchable list. No detail route, no detail screen, no update
route, no import, no export.
**Missing:** four routes, one screen, two controls.
**Business impact:** **High.** The customer registry is the most valuable asset in
a COD business — it is what repeat-purchase campaigns run on. Today it can be
read and nothing else. The schema is already carrying five `imported*` columns and
`Client.address` for features that do not exist, which is a standing invitation to
assume they work.
**Complexity:** **M** (detail + edit) / **M** (import) / **S** (export).
**Dependencies:** export shares the writer built in R4.

---

### R6 · Analytics screen — 🔴 MISSING
**Legacy:** seven breakdown tables over a date-preset filter, each showing orders,
confirmed, confirmation rate (with a bar), cancellation rate and revenue, grouped
by status, delivery channel, product, wilaya, confirming agent, marketer/source,
and delivery status. Plus seven headline cards including confirmation rate,
cancellation rate, average order value, and delivered/returned parcel counts with
their revenue.
**Now:** `/console/erp` shows six raw counts. No rates, no averages, no
breakdowns, no date filter.
**Missing:** the screen, the aggregation, and four of the seven headline figures.
**Business impact:** **High.** Confirmation rate per agent and per wilaya is how a
call-centre is managed day to day; marketer breakdown is how ad spend is
attributed. This is the reporting the business decides with.
**Complexity:** **M** — all of it is `groupBy` over `FulfillmentOrder`.
**Dependencies:** the marketer breakdown reads `source`/`marketer`, both present.
A `niche` breakdown additionally needs E7 (R12).

---

### R7 · Bulk actions — 🟡 PARTIAL
**Legacy:** eight actions. **Now:** three (`status`, `delete`, `assign`).
**Missing:** `classify` (fake), `assignFollowup`, `createShipments`,
`sendToDelivery`, and the `export`/`print` validation pass.
**Business impact:** **Medium–High.** `createShipments` over a day's confirmed
orders is the single highest-volume manager action in the legacy system —
one-at-a-time booking is the difference between a minute and an hour.
**Complexity:** **M.**
**Dependencies:** `createShipments` and `sendToDelivery` want R2 to be useful;
`classify` and `assignFollowup` have no dependency.

---

### R8 · Sales-channel screen and channel operations — 🔴/🟡 (5 features)
**Legacy:** the Stores screen manages connected storefronts; `GET /api/platforms`
lists nine platform keys; `POST /:id/test` validates credentials;
`GET /:id/logs` shows every inbound interaction; `shopify.js` and
`lightfunnels.js` parse and HMAC-verify their own payloads.
**Now:** full CRUD API, **no screen, no nav item**, no adapter registry, no test,
no logs, and one generic `parseOrder`.
**Missing:** the screen, `GET adapters`, test, logs, and per-platform parsing.
**Business impact:** **High.** A tenant cannot connect a Shopify store at all
through the console — the API exists and nothing reaches it. The webhook URL is
generated on create and never shown again.
**Complexity:** **M** (screen + adapters route) / **M** (adapters) / covered by
R3 (test + logs).
**Dependencies:** shares the integration-log machinery with R3.

---

### R9 · Profit/loss calculator, record versions and aggregation — 🔴 (3 features)
**Legacy:** a 1,244-line calculator screen auto-filled from
`/api/products/:id/sales-summary` (real units sold, returns, actual revenue) and
`/api/financial-records/prorate-fixed`. `GET /versions` lists every save of the
same period so a correction never overwrites history. `GET /aggregate` rolls
already-saved sub-periods up (weeks → month, months → quarter/year) **without
recomputing from orders**, which is the explicit requirement — old periods are
never re-derived.
**Now:** the finance screen saves and lists records. `prorate-fixed` exists.
Versions and aggregate do not, and there is no calculator.
**Missing:** two routes and one substantial screen.
**Business impact:** **High.** This is the screen the owner uses to decide whether
a product is profitable. The API half is largely there, which makes the absence
of the consumer especially cheap to fix relative to its value.
**Complexity:** **S** (versions) · **M** (aggregate) · **L** (calculator screen).
**Dependencies:** the calculator wants R1 so a wrong cost can be corrected.

---

### R10 · AI screen and provider/agent management — 🔴/🟡 (5 features)
**Legacy:** an AI Settings screen (provider CRUD with adapters, presets, default,
test, logs; agent CRUD) and an AI Chat screen with instant insights and deep
analysis, backed by three real model adapters and a masked, permission-scoped CRM
context builder (`lib/ai/context.js`, 224 lines).
**Now:** `ai/providers` GET+POST, `ai/agents` GET+POST, `ai/permissions`,
`ai/conversations` GET+DELETE, a three-count `ai/insights`, and three deliberate
501s. **The `ai` nav item leads to a 404** — there is no `console/erp/ai` screen.
**Missing:** the screen (both halves), PUT/DELETE/default/test/logs for providers,
PUT/DELETE for agents, adapters + presets, and the model calls themselves.
**Business impact:** **Medium** for the model calls (a deliberate deployment
decision, correctly documented). **High** for the 404 — a broken navigation item
in a shipped product is a defect regardless of what sits behind it.
**Complexity:** **S** for the 404 (a screen that manages providers and agents and
states the assistant's status). **M** for the remaining CRUD. **L** for real model
calls.
**Dependencies:** none for the screen and CRUD.

---

### R11 · Agent-manipulation alerts — 🔴 MISSING
**Legacy:** a dedicated screen listing every order carrying a suspicious call,
newest first, with a red nav badge showing the count, linking straight into the
order's audit trail. `minCallSeconds` flags a call as suspicious; the agents grid
shows a per-agent suspicious count.
**Now:** the flag is computed and stored on `OrderCall`. Nothing surfaces it: no
screen, no badge, no per-agent count.
**Missing:** the screen, the badge, the roster column.
**Business impact:** **Medium–High.** The whole point of `minCallSeconds` is
catching an agent who marks orders confirmed without really calling. The data is
being collected and nobody can see it.
**Complexity:** **S.**
**Dependencies:** none.

---

### R12 · Product create fields, variant editor, and `niche`/`category`/`supplier` — 🔴/🟡 (3 features)
**Legacy:** create/edit carries description, image, variants (with per-variant
stock, threshold, SKU and an option map), `optionDefs`, plus `niche`, `category`
and `supplier`. `PUT /api/products/:id/variants` is the inventory editor's write
path and appends to the movement ledger in the same transaction.
**Now:** the API accepts description, image and variants; **the form offers none
of them**. `optionDefs` exists in the schema and has no writer. There is no
variant editor. `niche`, `category` and `supplier` **are not columns on
`CatalogProduct`**, and `niche` is what the legacy client filter and one analytics
breakdown group by.
**Missing:** three form fields, the variant editor route + screen, three columns.
**Business impact:** **Medium.** Multi-dimensional variants are how a clothing or
cosmetics catalogue is modelled; without an editor a variant's stock can only be
set through the generic adjust control by name.
**Complexity:** **S** (form fields) · **M** (variant editor) · **S** (columns +
migration).
**Dependencies:** R1 lands the edit route these fields need.

---

### R13 · Manual follow-up assignment — 🟡 PARTIAL
**Legacy:** `POST /api/followup/assign` takes either an explicit agent or
`auto: true` and broadcasts the assignment. Reachable from the order list in bulk.
**Now:** auto-assignment runs on confirmation (6.6a). There is no way to assign or
reassign a follow-up agent by hand.
**Missing:** the route and the control.
**Business impact:** **Medium.** A supervisor cannot move a difficult customer to a
senior agent.
**Complexity:** **S** — `autoAssignFollowup` and `assign.ts` already hold the rule.
**Dependencies:** none.

---

### R14 · Reset the missed-order counter — 🔴 MISSING
**Legacy:** `POST /api/agents/:name/reset-missed`, offered on the agent card
whenever the counter is above zero.
**Now:** the counter is written by the overdue sweep and drives `autoSuspend` at
`suspendThreshold`. **Nothing can reset it.**
**Missing:** the route and the control.
**Business impact:** **Medium–High.** The counter only ever rises, so every agent
eventually trips auto-suspension with no way back other than editing
`ProductSetting` by hand. This is a latent operational trap that gets worse with
uptime.
**Complexity:** **S.**
**Dependencies:** none.

---

### R15 · Manager password reset — 🔴 MISSING
**Legacy:** `POST /api/agents/:name/password` — a manager sets a forgotten
password, all that account's sessions are dropped, an audit row is written.
**Now:** self-service change only. No reset, and no forgot-password flow.
**Missing:** the route and the control.
**Business impact:** **Medium–High.** A locked-out agent cannot be recovered by
anybody, which in a call centre is a weekly event.
**Complexity:** **S** — `hashPassword`, `destroySessionsForUser` and the team
surface all exist.
**Dependencies:** none. Belongs on `/console/settings/team`, not in the ERP.

---

### R16 · Rate limiting and cross-origin refusal — 🔴 MISSING (3 features)
**Legacy:** `lib/ratelimit.js` throttles login per IP **and** per account with a
case-insensitive key, plus a general API backstop that exempts the event stream
and inbound carrier webhooks. Every state-changing request with an unrecognised
`Origin` is refused with `CSRF_ORIGIN`.
**Now:** neither exists, on any surface. Already recorded in NEXT_STEPS §4.
**Business impact:** **High**, and it grows the moment anything is deployed. The
platform now has a **public unauthenticated write path** (`POST /api/platform/signup`)
that nothing throttles — a tenant-creation flood is unmetered.
**Complexity:** **M.**
**Dependencies:** none. This is Phase 8 work that parity also demands.

---

### R17 · Order board view, print labels, CSV import — 🔴 MISSING (3 features)
**Legacy:** a kanban board grouped by status with the choice persisted; bulk label
printing; Shopify CSV order import with a preview and dedup by external id.
**Now:** a list only; no print; no import.
**Business impact:** **Medium** (board — preference), **Medium** (print),
**Medium** (import — a one-off migration aid, but it is how a new tenant's history
arrives).
**Complexity:** **M** each.
**Dependencies:** import shares parsing with R5's client import.

---

### R18 · Status vocabulary endpoints — 🔴 MISSING
**Legacy:** `GET /api/statuses` and `GET /api/delivery/statuses` publish the order
statuses, call results, CRM delivery statuses, labels and the terminal set.
**Now:** the vocabularies live in server modules and reach screens as props —
correct for the console, but nothing outside it can read them.
**Business impact:** **Low.** Matters only for a future external client.
**Complexity:** **S.**
**Dependencies:** none.

---

### R19 · Channel-side webhooks: lead-capture, product, Shopify HMAC — 🔴 MISSING (3 features)
**Legacy:** `/lead-capture` captures a partial checkout form and merges it into an
existing abandoned row within 24 hours; `/product` auto-creates a catalogue
product from a platform product event and links it by external id;
`/webhook/shopify` is the HMAC-verified Shopify endpoint, routing
`checkouts/*` and `draft_orders/create` to their own handlers.
**Now:** `channel/[id]`, `/checkout` and `/contact` only.
**Business impact:** **Medium.** Lead capture is a real revenue path — a phone
number typed and abandoned is a callable lead. Product sync saves manual
catalogue entry.
**Complexity:** **M** each.
**Dependencies:** R8's adapter registry.

---

### R20 · Default carrier per channel, status-mapping delete — 🟡 PARTIAL (2 features)
**Legacy:** `GET/PUT /api/stores/:id/default-carrier` reads and writes the
`defaultCarrierByStore` map, which the order form preselects from.
`DELETE /api/providers/:id/status-mappings/:mid` removes a mapping.
**Now:** `defaultCarrierByChannel` is a validated setting with **no route and no
control**; status mappings can be added but never removed.
**Business impact:** **Medium.** A wrong status mapping is permanent.
**Complexity:** **S** each.
**Dependencies:** R8 for where the default-carrier control lives.

---

## 3b. Second-pass findings — the sixteen the route inventory could not see, plus N17

Each of these has no missing endpoint behind it, which is why counting routes
missed all of them.

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| **N1** | **List pagination** | client-side paging on clients; everything else rendered in full | **nothing, anywhere** — first 50–100 rows, no next | 🔴 |
| **N2** | **Live console updates** | every SSE event re-fetches and re-renders the affected screen; the changed row flashes for 3s (`hl-flash`) | the console re-renders only after the **viewer's own** action (`router.refresh()`). Another agent's confirmation, a carrier webhook, a new order — none reach an open screen | 🔴 |
| **N3** | **Notification bell, badge and panel** | header bell, unread count from the server, 200-entry panel, read watermark advanced on open | none | 🔴 |
| **N4** | **Notification sounds** | six distinct Web Audio signatures — `new_order` (ka-ching), `abandoned`, `assignment`, `manipulation` (siren), `delivery`, `followup` — with a per-type toggle and a volume, persisted in `localStorage` | none | 🔴 |
| **N5** | **Desktop notifications** | `Notification` API on every event, tagged by order id so they collapse | none | 🔴 |
| **N6** | **Create an order from the console** | "New order" button + modal on the main screen | **no control** (route exists) | 🔴 |
| **N7** | **Filter bar on the order list** | status · agent · date preset (all/today/yesterday/week/month/**custom** with from–to) · search, all instant | `orderFilters` supports **nine** filters; the screen offers **none** | 🔴 |
| **N8** | **Search box** | orders, clients (debounced, 8 more filters), products | the APIs accept `search`; **no screen has an input** | 🔴 |
| **N9** | **Inline row actions** | board card carries agent select, carrier select, express toggle and status select — three changes without leaving the list | click into the detail page, once per order | 🔴 |
| **N10** | **List information density** | per row: order type badge (draft/abandoned/normal), note badge with the note as a tooltip, fake badge, overdue tag with a pulsing dot, store logo + name + brand + platform, date **and** time, variant thumbnail, and qty / unit / delivery / discount / total | reference, customer, destination, product, total, status, call count, date — roughly a third of the information | 🟡 |
| **N11** | **Payroll report** | modal from the agents screen | `/api/erp/agents/payroll` exists; **nothing renders it** | 🔴 |
| **N12** | **Audit-log view** | investigation modal per order | `/api/erp/orders/[id]/audit` exists; the detail screen does not render it | 🔴 |
| **N13** | **Offline app shell** | service worker precaches the agent shell; network-first with cache fallback, so a dropped 3G connection does not blank the screen | **deliberately none** — see §6.4, where that decision is re-opened | 🔴 |
| **N15** | **Price breakdown at order entry** | the new-order modal captures unit price, discount and shipping and DERIVES the total (`calcTotal()`), so a manually-entered order carries the same breakdown a storefront order does | `CreateOrder` accepts a flat `price` only. The four breakdown columns exist and are `MANAGER_WRITABLE` — reachable by a `PATCH` immediately after, never at creation | 🟡 |
| **N16** | **Create/edit authorization agree on a field** | one rule per field | `price` and `carrierCode` are manager-only in `buildPatch` and **ungated in `CreateOrder`** — an agent may set a price on a new order and may not change it a second later. One of the two is wrong; deciding which is a authorization change, not a UI one | 🟡 |
| **N14** | **Live follow-up countdown** | ticks every 15s in place, and re-sorts the moment a task goes overdue | a formatted due date, static | 🟡 |
| **N17** | **The scheduled poll still calls a carrier inside a transaction** | in-process `setInterval`, no transaction at all | LP.5 moved booking and the manual refresh out (D-LP.5.1); `pollCarriers` was left in, bounded by `POLL_BATCH = 25`. It writes nothing a person is waiting on, and **neither registered adapter reaches a network from there** — ZR declares `canPoll: false` and `planRefresh` refuses first. Moving it out means `runJob` stops receiving a bound `db` and opens a binding per parcel: a change to the job runner and both of its routes. **Grouped with Tier 3 slice 22 (the Ecom adapter)**, the first registered carrier that can be polled. | *(not a legacy gap — recorded so it is not rediscovered)* |

**Not present in either system, so not a gap:** global keyboard shortcuts, and
custom context menus. Neither the legacy SPA nor the agent PWA has any — the only
key handlers are Enter-to-submit on three inputs. Anyone reading this report
looking for "the shortcuts we lost" should stop here: there were none.

---

## 6. The dimensions that are not features

### 6.1 Workflow speed and clicks — the legacy wins, and it is not close

Measured on the three highest-frequency operations in a COD call centre.

| Operation | Legacy | Platform | Ratio |
|---|---|---|---|
| Reassign an order to another agent | 2 (open board → pick from the row's select) | 4 (open list → click order → open reassign panel → pick → save) | **2×** |
| Change the carrier on an order | 2 (row select) | 4 | **2×** |
| Find "pending orders in Alger from yesterday" | 3 (three dropdowns, instant) | **impossible from the UI** — hand-type `?status=pending&wilaya=Alger&since=…&until=…` | ∞ |
| Enter a phone order | 2 (New order → save) | **impossible** | ∞ |
| See that a new order arrived | 0 — sound + toast + the row appears | **never** — until the operator reloads | ∞ |
| Reach the 60th order | 1 (scroll) | **impossible** | ∞ |

The pattern is consistent and it has one cause: **D-06.1 — "a control calls the
API route"** — was applied without ever building the *list-level* controls, so
every mutation is a page navigation. That decision is right (it is what stops a
second, untested write path) and it does not require the current cost: a control
in a table row still calls the route.

### 6.2 Cognitive load, density, hierarchy, discoverability

- **Density.** One legacy list row carries ~14 facts; the platform's carries 8,
  and drops the four that decide what to do next — is it overdue, has it been
  called, is there a note, is it flagged. The agent's own queue screen (6.4) is
  the exception and is *good*: it was built from `agent.html` rather than from
  the API, which is precisely why.
- **Hierarchy.** The legacy leads every row with the order number, the type badge
  and the overdue state — the three things that decide priority. The platform
  leads with the reference and sorts by date, so priority is not visible at all.
- **Discoverability.** The platform's nine order filters are undiscoverable by
  construction: they exist only as query-string keys. The legacy's four are three
  dropdowns in the header.
- **Feedback.** The legacy toasts on every action, flashes the changed row, and
  plays a typed sound. The platform's `ActionButton` shows a busy state and then
  the page re-renders — correct, but silent, and only for the actor.

### 6.3 Where the platform is objectively better — and must not be traded back

This list is as important as the gaps. None of it should be given up to restore
the items above.

| | Why it is better |
|---|---|
| **Query-side filtering and scoping** | The legacy downloaded the whole order book and filtered in JavaScript (PERF-02: 3,006 ms on 5,000 orders). The platform's filter, scope and page are all in SQL. The *only* thing missing is the navigation on top of it. |
| **Tenant isolation** | Three layers with RLS `FORCE` and `WITH CHECK`. The legacy is single-company and has no concept. |
| **Opaque, revocable sessions** | Suspension takes effect on the next request. |
| **Jobs out of the web process** | The legacy ran the overdue sweep on an in-process `setInterval` — on two instances it double-counts every miss against an agent. The platform's are idempotent by column guard, driven by a worker. |
| **Notification audience decided at write time** | One row per recipient, audience named by a PERMISSION and resolved with `can()`. The legacy interpreted a free-text audience at read time, which is where every notification bug in its audit lived. |
| **Money as `Decimal`** | 37 columns, none `double precision`. The legacy is `REAL` throughout. |
| **Atomic client counters** | `increment` in SQL vs the legacy's read-modify-write, which loses updates on two concurrent webhooks for the same customer. |
| **The assignment rules (D-06.5/6/7)** | The legacy cleared `overdueFlaggedAt` on reassignment while measuring the deadline from `createdAt`, so one ignored order walked the whole roster in minutes, counting a miss against every agent. |
| **Contract tests that attack boundaries** | 512 of them. The legacy has 298 and a different character. |
| **A carrier never shares a transaction with the work that triggered it** (D-LP.5.1) | Added by LP.5. The legacy called its carrier from a request with no transaction at all, so it never had this problem *or* the guarantees around it; this platform has both — a booking cannot roll back the confirmation that caused it, and one parcel per order is enforced by the database rather than by a `findFirst`. |
| **A carrier that cannot be asked says so** | `canPoll: false` on ZR makes "ask the carrier" answer `CARRIER_NO_POLLING`. The legacy's `getTracking` returned `[]`, which reads as "no news" — a different fact, and the one an operator acts on. |

### 6.4 Where BOTH are weak — two decisions to re-open

**(a) Live updates.** The legacy fans out in-process from a module-level map:
correct on one instance, wrong on two, and lost on every deploy. The platform
built the right transport — a table-polled SSE stream with exact replay from
`Last-Event-ID`, correct on ten instances — and then stopped. Neither system
currently gives a scaled deployment a working live console.

> **Proposed architecture.** One `<NotificationProvider>` in the console shell,
> subscribing **once** per session to `/api/platform/notifications/stream`. It
> owns three things and nothing else: the unread badge, a toast per arriving
> notification, and a **debounced `router.refresh()`** (~500 ms) so a burst of
> carrier events costs one re-render. Server-rendered truth, event-driven
> invalidation — this keeps every D-06 rule intact (no optimistic UI, no second
> write path) while removing the "silent until you reload" failure. Sounds and
> desktop notifications hang off the same provider, behind a per-type preference
> stored on `ProductSetting`, not `localStorage`, so it follows the person
> between devices — the one thing the legacy got wrong here.

**(b) List navigation.** The legacy renders everything (unusable at scale); the
platform truncates silently (unusable at 51 rows).

> **Proposed architecture.** A shared `<Pager>` and `<FilterBar>` in
> `components/console`, both driven by the **same vocabulary the API validates
> against** — `orderFilters` for orders, `clientFilter` for clients — exported
> from the directive-free module the route already uses. One vocabulary, so a
> filter added to the API appears in the UI instead of going stale. This is
> D-06.2's principle applied to reads: *offer exactly what the endpoint accepts.*
>
> **Correction, made while implementing this as LP.3:** the proposal above said
> *cursor-based, because `skip`/`take` at page 200 is a sequential scan*. That
> was wrong on the decisive point. A cursor cannot show "page 3 of 27", and an
> operator asking how many pending orders exist is asking a business question a
> next-arrow cannot answer. More decisively, the API's own `pagination()` helper
> is already `page`/`pageSize` — a screen paging by cursor would be a **second
> vocabulary over the same rows**, which is the exact failure this whole section
> is about. Shipped as offset paging with a total, matching the API. The deep-scan
> cost is real and is bounded by the filter bar sitting next to it.

**(c) The offline shell — a decision worth re-opening, not just accepting.**
6.6e recorded "no offline shell, deliberately: every console page is
session-scoped, and a cache keyed by URL survives signing out." The reasoning is
sound and the conclusion is too broad. The legacy agent PWA is used by field
agents on Algerian mobile networks, and its worker is network-first with a cache
fallback for the **shell only** — never for data. A shell-only cache leaks
nothing (it is markup and CSS, identical for every tenant), and it is the
difference between a dropped connection showing a stale screen and showing
nothing. Recommend revisiting with that narrower scope rather than treating the
whole idea as closed.

---

## 4. Restoration roadmap — ordered by business value

**Re-ordered by the second pass.** The priority axes, in the order the review
asked for: (1) production blockers, (2) daily operator productivity, (3) business
value, (4) architectural dependencies, (5) risk. The first pass ordered by
business value alone and put a whole tier of *daily productivity* work behind
completeness work; that was wrong, and the shared primitives (pager, filter bar,
notification provider) are architectural dependencies of almost everything below
them, which is the fourth axis saying the same thing.

**Five slices are done.** LP.1 (product editing, R1), LP.2 (carrier adapter
refusal) and LP.5 (the real ZR Express adapter) together close R1 and the ZR
half of R2; LP.3 closes N1/N7/N8/B1 and LP.4 closes N6. **Tier 1 is one slice
from complete** — order export (R4) is all that remains in it.

### Tier 1 — production blockers — **COMPLETE**

| # | Slice | Restores | Size | Why here |
|---|---|---|---|---|
| ~~1~~ | ~~Product editing~~ | R1 | S | **DONE — LP.1** |
| ~~2a~~ | ~~Carrier adapter refusal~~ | R2 | S | **DONE — LP.2** |
| ~~3~~ | ~~List pagination + filter bar + search~~ | N1, N7, N8, B1 | M | **DONE — LP.3** |
| ~~4~~ | ~~Create an order from the console~~ | N6 | S | **DONE — LP.4** |
| ~~5~~ | ~~The real ZR Express adapter~~ | R2 (ZR) | L | **DONE — LP.5.** The risk the ordering was worried about was real and was not the adapter: the carrier call sat inside a 15s transaction that a confirmation depended on. D-LP.5.1 is that fix. |
| ~~6~~ | ~~Order export (CSV → ZR / Ecom / Ecotrac + performance report)~~ | R4 | M | **DONE — LP.6. TIER 1 IS COMPLETE.** |

### Tier 2 — daily operator productivity — **STARTS HERE**

| # | Slice | Restores | Size | Why here |
|---|---|---|---|---|
| **7** | **The notification provider** — bell, badge, panel, toast, debounced live refresh | N2, N3, L1, L2 | M | **NEXT (LP.7).** The whole M-16 transport has no consumer — the last of §0b's six blockers, and the only one left. This is one client component plus a badge, and it turns 33 tested-but-dead endpoints into the operator's live loop. Architecture in §6.4(a); the implementation notes are in NEXT_STEPS. |
| **8** | **Inline row actions + list density** — agent, carrier, express, status on the row | N9, N10 | M | Halves the clicks on the two highest-frequency operations in the building. Depends on 3. |
| **9** | **Bulk actions completed** — classify, assignFollowup, createShipments, sendToDelivery | R7 | M | `createShipments` in bulk is the highest-volume manager action there is. Depends on 5 to be worth anything. |
| **10** | **Client detail, correction, export** | R5 (part) | M | The registry is the business's most valuable asset and is read-only. Depends on 3 for search. |
| **11** | **Sound + desktop notification preferences** (on `ProductSetting`) | N4, N5 | S | Hangs off 7. In a call centre nobody watches the screen; the ka-ching is the alert. |
| **12** | **Agent alerts screen · missed-counter reset · manager password reset · payroll report · audit view** | R11, R14, R15, N11, N12 | S ×5 | Five small independent traps. R14 gets strictly worse with uptime — the counter only rises and auto-suspends at threshold with no way back. |

### Tier 3 — business value

| # | Slice | Restores | Size |
|---|---|---|---|
| **13** | Analytics screen + headline rates (confirmation, cancellation, AOV, delivered/returned) | R6, K1 | M |
| **14** | Carrier test / sync / integration logs — `IntegrationLog`'s first caller | R3, R20 | M |
| **15** | Sales-channel screen + platform adapter registry | R8 | M |
| **16** | Profit/loss calculator + record versions + period aggregation | R9 | L |
| **17** | AI screen (fixes the live 404) + provider/agent CRUD | R10 | M |
| **18** | Product fields, variant editor, `niche`/`category`/`supplier` | R12 | M |
| **19** | Client + order CSV import | R5 (rest), R17 | M |
| **20** | Channel webhooks: lead-capture, product, Shopify HMAC | R19 | M |
| **21** | Manual follow-up assignment · live countdown | R13, N14 | S |
| **22** | Ecom carrier adapter | R2 (rest) | M |

### Tier 4 — hardening and polish (overlaps Phase 8)

| # | Slice | Restores | Size |
|---|---|---|---|
| **23** | Rate limiting + `CSRF_ORIGIN` | R16 | M |
| **24** | Offline shell for the queue screen — the re-opened decision, §6.4(c) | N13 | M |
| **25** | Order board view, print labels | R17 (rest) | M |
| **26** | Status vocabulary endpoints | R18 | S |
| **27** | Real model calls for the AI assistant | R10 (rest) | L |

**Parity is reached at the end of Tier 3.** Tier 4 is Phase 8 work the legacy
happened to also have (23), a decision to revisit (24), preference (25, 26), or a
deployment choice (27).

---

## 5. Rules this restoration follows

Carried over from the existing project conventions, and binding on every slice:

- One slice per commit. Never modify unrelated code.
- Every slice: compiles · every test passes · **new tests** · CHANGELOG ·
  PROJECT_STATE · NEXT_STEPS.
- Before every commit: build · tests · permissions · regression check on a
  neighbouring suite.
- **D-06.1** a control calls the API route — no server actions for product writes.
- **D-06.2** render a control only where the API would accept it, decided with the
  same function the route checks.
- **D-06.3** no optimistic UI.
- Never `where: { tenantId }` — the binding does it.
- Money is `Decimal`, entered through `inputmode="decimal"`, never `type="number"`.
- Every user-facing string is an i18n key, in all three catalogues.
- A test that asserts a boundary is not relaxed to make a change pass.
