# LandingOS — Project State

**Last updated:** 6 August 2026
**Branch:** `master` · **Last commit:** *LP.2: an unknown carrier adapter is refused*
**Working tree:** clean, all work committed.

---

## ⚠️ CURRENT PHASE: LEGACY PARITY RESTORATION — NOT Phase 8

Phase 7 is complete, but **Phase 8 is deferred.** A full feature-by-feature
comparison of `apps/erp` (the legacy CRM) against the platform ERP was carried
out on 6 August 2026 and is in **`LEGACY_PARITY.md`**. Read it before doing
anything else.

**Second pass, 6 August 2026 (from `9d1f887`): 115 features compared —
52 identical · 6 improved · 18 partial · 39 missing.** The platform cannot
replace the legacy CRM in production today.

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
| **LP.3** list pagination + filter bar + search | N1, N7, N8, B1 | **NEXT** |
| LP.4 create an order from the console | N6 | to do |
| LP.5 the real ZR Express adapter | R2 (rest) | to do |
| LP.6 order export (CSV: ZR / Ecom / Ecotrac + report) | R4 | to do |
| LP.7 the notification provider (bell, badge, toast, live refresh) | N2, N3, L1, L2 | to do |

**The roadmap was re-ordered by the second pass** (LEGACY_PARITY §4). Pagination
moved to the front: row 51 is unreachable today, and the shared `<Pager>` /
`<FilterBar>` primitives are an architectural dependency of most of what follows.
The ZR adapter moved back one place deliberately — it is the highest-risk slice
in the roadmap (network I/O inside a 15s transaction), and LP.3/LP.4 are low-risk
and unblock daily work immediately.

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
| orders (+ stats, bulk, 6 per-order routes), clients, settings, audit | orders 38/38 · validation 29/29 · listing 25/25 |
| products (incl. **editing**, LP.1), inventory, stock lots (incl. stock on confirm/cancel), agents, payroll, finance | catalog 55/55 |
| carriers (incl. **adapter refusal**, LP.2), shipments, delivery settlement, the follow-up producer, the tracking poll | delivery 39/39 |
| sales channels, inbound webhooks, AI, follow-up | integrations 29/29 |
| the SalesOrder ↔ FulfillmentOrder relationship (M-05) | order-split 8/8 |
| every ERP screen, read and write | screens 100/100 |
| the scheduled work (M-15), and the worker's tick both ways | jobs 16/16 |
| assignment — new, confirmed and overdue orders | assign 25/25 |
| notifications: storage, audience, badge, the live stream, Web Push (M-16) | notifications 29/29 |
| every surface, gated | access 65/65 |

**462/462**, each file verified on its own. Running several back to back still
trips the documented Neon connection limit — judge them per file.

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
| 2b | The real ZR Express adapter | L | **NEXT** |
| 3 | Order export — CSV for ZR / Ecom / Ecotrac + the performance report | M | to do |
| 4 | Carrier test / sync / integration logs (`IntegrationLog`'s first caller) | M | to do |

**LP.2 starts with the refusal, not the adapter.** `getAdapter` in
`src/lib/erp/carriers.ts` falls back to `mock` for any unregistered key, so a
carrier configured as `zr` books a fabricated `MOCK…` tracking number and
reports success. That half is small and stops a silent wrong answer; the real ZR
Express adapter (`apps/erp/lib/providers/zr.js`, 479 lines — live territory
resolution, Svix webhooks, outbound parcel creation) is the large half after it.

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

- **52 tables**, 161 indexes, 8 enums
- **47 tables carry `tenantId`** and have RLS
- **5 do not, by design:** `Tenant`, `User`, `Session` (identity — resolved
  before a tenant is known) and `Wilaya`, `Baladia` (platform reference data)
- **37 `numeric` money columns, 0 `double precision`**

Schema lives in `packages/db/prisma/schema/` — split into `main`, `platform`,
`builder`, `erp` (multi-file schema, supported natively).

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
| `apps/website-builder` | 102 | all pass (console-shell split one test in two) |
| `apps/website-builder` — ERP contract | 462 | all pass against a running server |
| `apps/website-builder` — platform contract | 85 | team (7.1) + billing (7.2) + signup (7.3), against a running server |
| `packages/auth` | 36 | all pass |
| `packages/db` | 29 | all pass (11 schema + 18 isolation) — two of the schema assertions had been red since Phase 5.2/5.4 and were repaired in 6.6a |
| `packages/product-registry` | 36 | all pass |
| `packages/ui` | 26 | all pass |
| `packages/i18n` | 18 | all pass |
| **Total** | **1092** | green per suite |

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
