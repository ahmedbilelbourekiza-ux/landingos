# Next Steps

Immediate tasks to continue from commit `82dacc9`. Full context is in
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
npm test --workspace @landingos/website-builder    # 101
npm test --workspace @landingos/erp                # 298 (297 pass, 1 skipped)
```

If `packages/db` fails on connection errors, the database may have been rotated
or suspended. Re-run:

```bash
npm run setup:roles --workspace @landingos/db
npm run preflight   --workspace @landingos/db      # 9 checks; all must pass
```

---

## 1. Start Phase 5.1 — port the ERP's test suite first

**Do this before moving any ERP logic.** Those 13 files are the only meaningful
coverage the ERP has, and they are contract tests over HTTP rather than unit
tests bound to Express — so they port. A rewrite that abandons them starts from
zero coverage on the more complex of the two products.

- Source: `apps/erp/test/` (13 files, 298 tests)
- Target: the new API surface at `/api/erp/*`
- They boot the real server as a child process via `apps/erp/test/helpers.js`;
  the ported versions should drive the platform routes with a platform session
  instead, the way `apps/website-builder/test/builder-api.test.ts` does.

Expect this to be the slowest-feeling part of Phase 5 and the reason the rest
goes quickly.

---

## 2. Then Phase 5.2 — `lib/db.js` → tenant-scoped repositories

`apps/erp/lib/db.js` is ~185 KB of hand-written SQL. Port it model by model
onto `withTenant`.

Two things to watch:

- **Audit every `db.transaction`.** The ERP's transactions assume SQLite's
  single writer. Under real concurrency, read-modify-write sequences in
  inventory and FIFO lot consumption need explicit row locking.
- **Do not call `$transaction` inside `withTenant`** — it is already one, and
  the client it hands back does not have it.

---

## 3. Then Phase 5.3 — routes

126 Express routes → Next handlers under `/api/erp/*`, using the existing
`tenantRoute(permission, handler)` wrapper. The ERP's permissions are already
declared in its manifest (`packages/product-registry/src/manifests.ts`).

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
