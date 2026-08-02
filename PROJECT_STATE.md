# LandingOS — Project State

**Last updated:** 2 August 2026
**Branch:** `master` · **Last commit:** *Phase 5.3 (part 2): carriers, shipments, and the BUG-02 write*
**Working tree:** clean, all work committed.

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
| ERP / CRM | `erp` | Porting in progress (Phase 5) — orders, customers, settings live on the platform; the rest still standalone |

A customer subscribes to either, or both. Neither is privileged. The platform
supplies authentication, tenancy, roles, entitlements, billing hooks, domains,
notifications, i18n and the design system; products supply only their own
screens and data.

**The central architectural claim, and the thing to preserve:** adding a tenth
product must touch that product's files and nothing else. The platform never
enumerates products — it reads a registry.

---

## Where we are

**Phase 5.2 is complete and Phase 5.3 is about two thirds done.** The ERP
data-layer foundation plus five vertical slices — orders, customers, settings,
audit, products, inventory, agents/payroll and finance — run end to end on the
platform with their contract tests passing against a live server.

**Exact stopping point:** committed and verified. The next task is **the rest of
Phase 5.3 — the remaining ERP route surfaces**, listed under *What is built* below.

### Sequencing note

NEXT_STEPS originally had 5.2 build every repository and 5.3 add every route.
That was changed on purpose: done in that order nothing is verifiable until both
finish, which is the position this project has been bitten by three times.
Work proceeds in **vertical slices** — repository plus routes plus green tests,
one domain at a time.

### What is built, and what is not

| Surface | State |
|---|---|
| `/api/erp/orders` (+ stats, bulk, 6 per-order routes) | **done** |
| `/api/erp/clients` (+ filter-options) | **done** |
| `/api/erp/settings`, `/api/erp/audit` | **done** |
| `/api/erp/products` (+ inventory, stock-lots, history), `inventory/low-stock` | **done** |
| `/api/erp/agents` (+ payroll, days-off, suspend/reactivate) | **done** |
| `/api/erp/financial-records`, `/api/erp/unexpected-charges` | **done** |
| `/api/erp/carriers` (+ status-mappings, default), shipments, settlement | **done** |
| sales channels, inbound webhooks | not built |
| follow-up tasks and dashboard | not built |
| AI providers, agents, conversations | not built |

**Contract suite, each file verified on its own:** orders 38/38 ·
validation 29/29 · listing 25/25 · catalog 31/31 · delivery 20/20 ·
access **48/62**. The 14 remaining access failures name exactly the unbuilt
surfaces above, and `integrations.test.ts` is red for the same reason. That is
the remaining scope, stated rather than hidden.

Running several contract files back to back still trips the documented Neon
connection limit - judge them per file, as *Known limitations* says.

### Decisions taken in 5.2

- **D-05.1 (resolved).** `*:clients:read` and `*:finance:read` are now
  `SENSITIVE` in `packages/auth/src/rbac.ts` — no role grants them implicitly.
  The customer registry is every customer's PII and the finance screens are the
  company's P&L; the `*:*:read` glob would have handed both to every member.
- **D-05.2.** Human-readable numbering comes from an atomic per-tenant
  `TenantSequence`, not from counting rows and probing for a free slot.
- **D-05.3.** `ORD-0042` is a `reference` column, unique per tenant; the primary
  key is a cuid. The ERP used the number AS the key, which collides across
  tenants on the second tenant's first order.

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

### Remaining roadmap

| Phase | Scope |
|---|---|
| **5** | **ERP backend onto the platform** — 5.1 and 5.2 done; next the remaining route surfaces (5.3) and the M-05 order split (5.4) |
| 6 | ERP interface — rebuild ~6,200 lines of vanilla SPA + agent PWA in React |
| 7 | SaaS layer — company/team management, billing, self-serve signup, notifications |
| 8 | Hardening — adversarial isolation review, load testing, backup/restore, runbooks |

### Next recommended task

See `NEXT_STEPS.md`. In short: **continue Phase 5.3** — sales channels and
inbound webhooks next (they unblock `integrations.test.ts`), then follow-up,
then the AI surface. The
foundation in `apps/website-builder/src/lib/erp/` is in place and the contract
each slice must satisfy is already written in `apps/website-builder/test/erp/`.

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
    ├── platform/             Cross-product surfaces (integrations)
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
| M-17 | Public routing → `/[tenant]/[slug]` + `TenantDomain` |
| M-20 | Trilingual i18n |
| — | Builder API + all screens ported; legacy stack deleted |

**Not yet done:** M-05 (order relationship + domain event), M-11 (ERP's 126
routes), M-12 (ERP UI), M-14 (ERP base64 images → R2), M-15 (jobs → worker),
M-16 (notification unification), M-19 (template registry).

M-15 and M-16 each still owe M-18 a file: `overdue-sweep.test.js` (~12 tests)
and `notifications.test.js` (~20) were deferred rather than dropped, because
porting them against a worker and a notification transport that do not exist
would encode a contract nobody has designed.

---

## Legacy still remaining, and why

**`apps/erp`** — the entire ERP: Express, SQLite, 27 tables, 126 routes, a
4,949-line vanilla SPA and a 1,261-line agent PWA. Completely untouched and
still runnable standalone. It is the subject of Phases 5 and 6.

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
4. **`services/worker` does not exist yet.** The ERP's jobs still run in-process
   in `apps/erp` and would duplicate on a scaled deployment (M-15).
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
   `Can't reach database server` against the free-tier Neon instance when
   several suites run back to back. **Every suite passes reliably alone.** Root
   causes already fixed: wrong endpoint, tiny pools, tight transaction timeout.
   The residue is capacity. A paid instance or a local Postgres would remove it.
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
```

### Env files (all gitignored)

`packages/db/.env` — `DATABASE_URL` (app role, **pooled**),
`MIGRATE_DATABASE_URL` (owner, **direct**), `APP_DB_PASSWORD`.

`apps/website-builder/.env` — `PLATFORM_DATABASE_URL` (same as the app role
URL; named separately so it can never be confused with another client),
`AUTH_SECRET`, optional R2 variables.

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
| `apps/erp` | 298 | 297 pass, 1 skipped |
| `apps/website-builder` | 101 | all pass |
| `apps/website-builder` — ERP contract | 227 | **skipped** until 5.3 mounts `/api/erp/*` |
| `packages/auth` | 32 | all pass |
| `packages/db` | 29 | all pass (11 schema + 18 isolation) |
| `packages/product-registry` | 36 | all pass |
| `packages/ui` | 26 | all pass |
| `packages/i18n` | 18 | all pass |
| **Total** | **767** | 540 green per suite, 227 pending routes |

The ERP contract suite reports as `tests 227, skipped 227` rather than
disappearing from the run — each test is skipped individually, because a skipped
`describe` reports `tests 0` and a suite whose absence is invisible is a suite
that gets quietly deleted. `ERP_CONTRACT=strict` turns the skip into a failure.

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
