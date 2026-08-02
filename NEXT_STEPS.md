# Next Steps

Immediate tasks to continue from the Phase 5.1 commit. Full context is in
`PROJECT_STATE.md` — read its "Read this first" section before starting.

---

## 0. Before writing any code

```bash
npm install
npm run builder:build                  # stop node first if it fails with EPERM
npm run builder:start                  # :3000 — most E2E tests need this
```

Confirm the baseline per suite (the aggregate run is flaky for infrastructure
reasons — see PROJECT_STATE):

```bash
npm test --workspace @landingos/db                 # 29
npm test --workspace @landingos/auth               # 32
npm test --workspace @landingos/website-builder    # 101 pass + 227 skipped
npm test --workspace @landingos/erp                # 298 (297 pass, 1 skipped)
```

The 227 skipped are the ported ERP contract suite. They report their own reason;
if they say anything other than *"the ERP API is not mounted yet"*, fix that
before starting — a suite skipping for the wrong reason is a suite not running.

If `packages/db` fails on connection errors, the database may have been rotated
or suspended. Re-run:

```bash
npm run setup:roles --workspace @landingos/db
npm run preflight   --workspace @landingos/db      # 9 checks; all must pass
```

---

## 1. Decide D-05.1 first — it blocks the whole phase

**The ERP's manager/agent split does not survive the platform's role globs.**

The ERP treated the customer registry and the finance screens as manager-only.
On the platform, `MEMBER` and `VIEWER` both carry `*:*:read`, which grants
`erp:clients:read` and `erp:finance:read` to every member of the tenant — every
customer's phone number and lifetime spend, and the company's profit and loss,
handed to a confirmation agent. That is the exposure SEC-02 closed.

Full reasoning and the recommendation are in
`apps/website-builder/test/erp/PORTING.md`. The short version: add
`*:clients:read` and `*:finance:read` to `SENSITIVE` in
`packages/auth/src/rbac.ts`. It is product-agnostic, it is what that list exists
for, and it means a `MANAGER` needs the grant by name — which reads correctly.

Decide it before writing a route, because every ERP route's permission argument
depends on the answer, and the tests marked `D-05.1` fail until it is settled.

---

## 2. Phase 5.2 — `lib/db.js` → tenant-scoped repositories

`apps/erp/lib/db.js` is ~185 KB of hand-written SQL. Port it model by model onto
`withTenant`. The schema is already there — `packages/db/prisma/schema/erp.prisma`,
22 models, with the five that did not survive the port and why recorded at the
top of the file.

Three things to watch:

- **Audit every `db.transaction`.** The ERP's transactions assume SQLite's
  single writer. Under real concurrency, the read-modify-write sequences in
  inventory and FIFO lot consumption need explicit row locking.
- **Do not call `$transaction` inside `withTenant`** — it is already one, and
  the client it hands back does not have it. This threw at runtime once already,
  hidden by the `(db as any)` casts.
- **Money is `Decimal`.** 37 columns, zero `double precision`. The contract
  tests compare the **string** form throughout; a repository that hands back a
  JS number has already lost what the column type was for.

---

## 3. Phase 5.3 — routes

126 Express routes → Next handlers under `/api/erp/*`, using the existing
`tenantRoute(permission, handler)` wrapper. The ERP's permissions are already
declared in its manifest (`packages/product-registry/src/manifests.ts`).

**Turn the contract suite on the moment you start:**

```bash
ERP_CONTRACT=strict npm test --workspace @landingos/website-builder
```

That makes an unmounted API a failure rather than a skip. Work route by route
against `apps/website-builder/test/erp/` — the paths, verbs, status codes and
response envelope the tests expect are the specification.

The moment the first real ERP screen exists, remove the placeholder body from
`console/[product]/page.tsx` for that route only — the generic route must keep
serving any *other* product that has no screens.

---

## 4. Phase 5.4 — the order split (M-05)

`SalesOrder` and `FulfillmentOrder` currently exist as **names only**. This is
where they gain their relationship and where the Builder→ERP webhook becomes an
in-process domain event inside one transaction.

Note: `order.created` webhooks currently fire from
`api/storefront/[tenant]/orders/route.ts` via `lib/webhooks/tenant-triggers.ts`.
That mechanism stays — it becomes the *tenant-facing* integration feature — but
the internal Builder→ERP hop should stop being a network call.

---

## Owed to M-18, when their migrations land

Two ERP test files were **deferred, not dropped**. Whoever does these
migrations owes the port:

- **M-15** (jobs → `services/worker`) → port `apps/erp/test/overdue-sweep.test.js`
  (~12 tests). The sweep is an in-process `setInterval` today and would
  double-count every miss on a scaled deployment, which is why M-15 exists.
- **M-16** (notification unification) → port `apps/erp/test/notifications.test.js`
  (~20 tests) and the SSE half of `delivery-outcome.test.js`. What they protect
  is specific and worth keeping: per-account read state, manager-only targeting,
  replay on reconnect, and a watermark that can be neither poisoned nor moved
  backwards.

---

## Two guarantees that need a platform owner

Both were real and tested in the ERP and have no equivalent on the platform.
Neither belongs in a product suite:

1. **Cross-origin state changes.** The ERP refused a POST carrying an
   unrecognised `Origin` with `CSRF_ORIGIN`. CORS stops an attacker *reading* a
   cross-site response; it does not stop the request happening. `/api/builder/*`
   has no such check either.
2. **Rate limiting.** Login throttling per IP *and* per account, keyed
   case-insensitively so casing cannot reset the counter, plus a general API
   backstop that exempts the event stream and inbound carrier webhooks (carriers
   replay backlogs and must never be throttled off).

---

## Not blocking, but do them when convenient

- **Rotate the two credentials** listed under *Security actions* in
  PROJECT_STATE. Needs a human.
- **Verify the Docker image** — never built:
  `docker build -f apps/website-builder/Dockerfile -t landingos-builder .`
- **Replace the `(db as any)` casts** in the ported routes with a typed
  accessor. They hid a real bug once.

---

## Do not

- Do not weaken tenant isolation to make something pass.
- Do not add `where: { tenantId }` — the binding already does it.
- Do not assume only two products exist.
- Do not trust a green build; verify against the running server.
- Do not "fix" a `D-05.1` test by relaxing its assertion. It is asserting the
  boundary the ERP shipped with; if that boundary is being given up, that is a
  decision to record, not an assertion to edit.
