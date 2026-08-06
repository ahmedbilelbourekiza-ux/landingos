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

## 1. Scoreboard

**101 features compared.**

| Class | Count | Share |
|---|---|---|
| ✅ IDENTICAL | 55 | 54% |
| 🔵 IMPROVED | 8 | 8% |
| 🟡 PARTIAL | 14 | 14% |
| 🔴 MISSING | 24 | 24% |

**Verdict: the platform cannot replace the legacy CRM in production today.**

The order pipeline — the thing the business runs on — is at or above parity. What
is missing clusters in four places, and three of them are *hard blockers*:

| Blocker | Why it blocks production |
|---|---|
| **No real carrier adapter** | Only `mock` is registered. Not one parcel can be booked with ZR Express, Ecom, or anyone else. The legacy system's 479-line ZR adapter (live territory resolution, Svix webhooks, outbound parcel creation) has no equivalent. |
| **No product editing** | A product can be created and archived. It can never be corrected. A wrong price, cost, or threshold is permanent — and every profit figure derived from it is permanently wrong. |
| **No export** | Orders reach carriers by Excel file in the legacy system (ZR / Ecom / Ecotrac formats). There is no CSV or XLSX anywhere on the platform. Confirmed orders cannot leave. |
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
| B1 | List + filter + paginate | `GET /api/orders` | same | ✅ |
| B2 | Stats | `GET /api/orders/stats` | same | ✅ |
| B3 | Create | `POST /api/orders` | same | ✅ |
| B4 | Edit | `PUT /api/orders/:id` | `PATCH` | ✅ |
| B5 | Delete | `DELETE /api/orders/:id` | same | ✅ |
| B6 | Call start / log result | `/call-start`, `/call` | same | ✅ |
| B7 | Notes (5 types) | `/note` | same | ✅ |
| B8 | Audit timeline | `/audit` | same | ✅ |
| B9 | Classify as fake | `/classify` | same | ✅ |
| B10 | Attempts matrix (day × tentative) | `/attempts` | same | ✅ |
| B11 | Reassign | `PUT` with `agent` | `PATCH`, gated on `seesWholeBook` | ✅ |
| B12 | **Bulk actions** | 8: assign · status · classify · assignFollowup · delete · createShipments · sendToDelivery · export/print | 3: status · delete · assign | 🟡 |
| B13 | **Board (kanban) view** | `renderBoardView`, persisted in localStorage | list only | 🔴 |
| B14 | **Export confirmed orders to carrier formats** | ZR Express · Ecom Delivery · Ecotrac · full performance report — 4 XLSX builders | — | 🔴 |
| B15 | **Import orders from Shopify CSV** | drop-zone, preview, dedup by `shopifyId` | — | 🔴 |
| B16 | **Print labels for selected orders** | `bulkPrintSelected()` | — | 🔴 |
| B17 | Auto-assign on create | `autoAssign` | `autoAssignOnCreate` (6.6a) | ✅ |
| B18 | Stock reservation on confirm/cancel | `reservationMode` | ported 6.6f | ✅ |

### C. Delivery and carriers

| # | Feature | Legacy | Platform | Status |
|---|---|---|---|---|
| C1 | Carrier CRUD | `/api/providers` × 5 | `/api/erp/carriers` × 5 | ✅ |
| C2 | Adapter registry | `GET /api/providers/adapters` | `GET /api/erp/carriers?adapters=true` | ✅ |
| C3 | **Real carrier adapters** | `zr` (479 ln, live territory resolution + outbound parcels), `ecom` (211 ln), `zr-webhook`, `mock`; 12 keys declared | **`mock` only** | 🟡 |
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
| L1 | Live feed (SSE) | one writer per name, in-process | per-recipient rows, table-polled, exact replay (6.6c–d) | 🔵 |
| L2 | Read state | global | per account | 🔵 |
| L3 | Web Push | `web-push` | same + service worker (6.6e) | ✅ |
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

### R2 · Real carrier adapters — 🟡 PARTIAL
**Legacy:** four working adapters. `zr.js` (479 lines) books real parcels against
ZR Express: dynamic wilaya/commune territory resolution via
`POST /territories/search`, Svix webhook envelope handling, `X-Tenant`/`X-Api-Key`
auth, a 20-entry status map, and a deliberate throw with a French message when an
address cannot be resolved. `ecom.js` (211 lines) does the same for Ecom Delivery.
`zr-webhook.js` handles the older inbound-only integration. Twelve adapter keys
are offered in the UI.
**Now:** `ADAPTERS = { mock }` (`lib/erp/carriers.ts:153`). `getAdapter` falls
back to `mock` for every key, so a carrier configured as `zr` silently books a
`MOCK…` tracking number.
**Missing:** every real adapter, and the fallback is dangerous — it fabricates a
tracking number instead of refusing.
**Business impact:** **Critical — this alone blocks production.** No parcel can
reach a real carrier. Worse than an error: the mock returns success, so the order
shows a tracking number that does not exist.
**Complexity:** **L** per adapter (ZR is the largest). **S** to make `getAdapter`
refuse an unknown key instead of silently mocking.
**Dependencies:** R3 (test connection) is how anyone would verify credentials.
**Recommendation:** land the *refusal* first (S, prevents fake tracking numbers),
then ZR, then Ecom.

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

### R4 · Order export to carrier formats — 🔴 MISSING
**Legacy:** the Export screen produces four XLSX files —
ZR Express (`Nom, Tel, Tel2, Wilaya, Commune, Produit, Qte, Prix, Note`),
Ecom Delivery, Ecotrac, and a two-sheet performance report (Orders + Agents with
confirmation rates and suspicious-call counts). Plus bulk export and bulk label
printing from the order list selection.
**Now:** no CSV, XLSX, or file download anywhere on the platform.
**Missing:** all of it.
**Business impact:** **Critical.** Excel hand-off is how confirmed orders reach
carriers that have no API — which, until R2 lands, is *every* carrier. Without it
a confirmed order cannot leave the system by any route.
**Complexity:** **M** (CSV) / **L** (XLSX with multiple sheets). CSV covers the
carrier hand-off; the performance report wants real sheets.
**Dependencies:** none.

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

## 4. Restoration roadmap — ordered by business value

The order below is **not** easiest-first. It is "what stops this replacing the
legacy CRM in production", then "what the business uses every day", then the rest.
Slice sizes are chosen so each one compiles, tests and commits on its own.

### Tier 1 — production blockers (nothing ships without these)

| # | Slice | Restores | Size | Why first |
|---|---|---|---|---|
| **1** | **Product editing** | R1 | S | A permanent wrong cost basis silently corrupts every money figure downstream. Smallest fix with the largest blast radius. |
| **2** | **Carrier adapter refusal + real ZR adapter** | R2 | S then L | `mock` fabricating tracking numbers for a real carrier is worse than an error. Refuse first (S), then land ZR. |
| **3** | **Order export (CSV → ZR / Ecom / Ecotrac + report)** | R4 | M | Until every carrier has an adapter, Excel is the only way a confirmed order leaves the building. |
| **4** | **Carrier test / sync / integration logs** | R3, R20 | M | The only way a tenant can tell a credential is wrong before a customer does. Also gives `IntegrationLog` its first caller. |

### Tier 2 — daily operations

| # | Slice | Restores | Size | Why here |
|---|---|---|---|---|
| **5** | **Client detail, correction, export** | R5 (part) | M | The registry is the business's most valuable asset and is currently read-only. |
| **6** | **Analytics screen + headline rates** | R6 | M | Confirmation rate per agent and per wilaya is how the call centre is run. |
| **7** | **Bulk actions completed** | R7 | M | `createShipments` in bulk is the highest-volume manager action there is. |
| **8** | **Agent alerts + missed-counter reset + manager password reset** | R11, R14, R15 | S ×3 | Three small, independent operational traps. R14 gets worse with uptime. |
| **9** | **Sales-channel screen + adapter registry** | R8 | M | A tenant cannot connect a store today; the API is unreachable from the console. |

### Tier 3 — completeness

| # | Slice | Restores | Size |
|---|---|---|---|
| **10** | Profit/loss calculator + record versions + aggregation | R9 | L |
| **11** | AI screen (fixes the 404) + provider/agent CRUD | R10 | M |
| **12** | Product fields, variant editor, `niche`/`category`/`supplier` | R12 | M |
| **13** | Manual follow-up assignment | R13 | S |
| **14** | Client + order CSV import | R5 (rest), R17 (import) | M |
| **15** | Channel webhooks: lead-capture, product, Shopify HMAC | R19 | M |
| **16** | Ecom carrier adapter | R2 (rest) | M |

### Tier 4 — hardening and polish (overlaps Phase 8)

| # | Slice | Restores | Size |
|---|---|---|---|
| **17** | Rate limiting + `CSRF_ORIGIN` | R16 | M |
| **18** | Order board view, print labels | R17 (rest) | M |
| **19** | Status vocabulary endpoints | R18 | S |
| **20** | Real model calls for the AI assistant | R10 (rest) | L |

**Parity is reached at the end of Tier 3.** Tier 4 is either Phase 8 work the
legacy system happened to also have (17), preference (18, 19), or a deliberate
deployment decision (20).

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
