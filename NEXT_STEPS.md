# Next Steps

Immediate tasks to continue from the Phase 5.3 (part 3) commit. Full context is in
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
npm test --workspace @landingos/auth               # 36
npm test --workspace @landingos/website-builder    # 101 + the ERP contract suite
npm test --workspace @landingos/erp                # 298 (297 pass, 1 skipped)
```

The ERP contract suite now RUNS rather than skipping, because `/api/erp/*`
exists. Expect `access.test.ts` at 34/62 and `catalog`/`delivery`/`integrations`
largely red: those name routes Phase 5.3 has not built yet. `orders`,
`validation` and `listing` are 92/92 and must stay that way.

If `packages/db` fails on connection errors, the database may have been rotated
or suspended. Re-run:

```bash
npm run setup:roles --workspace @landingos/db
npm run preflight   --workspace @landingos/db      # 9 checks; all must pass
```

---

## 1. Phase 5.4 — the order split (M-05), the last piece of Phase 5

`SalesOrder` and `FulfillmentOrder` exist as **names only**. 3.2 settled that
both products needed an "Order" and one schema cannot hold two: the builder's is
an immutable commercial snapshot of what a customer bought, the ERP's is a
mutable operational record of getting it to them. Only the names landed.

This is where they gain their relationship, and where the Builder→ERP handoff
stops being a network call.

Today a storefront checkout writes a `SalesOrder` and fires an `order.created`
webhook from `api/storefront/[tenant]/orders/route.ts` via
`lib/webhooks/tenant-triggers.ts`. That mechanism **stays** — it is the
tenant-facing integration feature, and a tenant subscribing their own endpoint
is the point of it. What should stop being a network call is the INTERNAL hop:
one platform writing to another product in the same database over HTTP, which
can fail after the sale is recorded and leaves the two out of step with nothing
to reconcile them.

Both writes belong in one transaction. `withTenant` has already opened one.

Watch for: a tenant with the builder but NOT the ERP must still be able to
check out — the fulfilment record simply is not created. Check the entitlement,
do not assume both products.

---

## 2. Then, when Phase 5 is done

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
- Do not "fix" a contract test by relaxing its assertion. It is asserting the
  boundary the ERP shipped with; if that boundary is being given up, that is a
  decision to record, not an assertion to edit.
- Do not put a per-tenant sequential number in a primary key. See D-05.3 — it
  collides across tenants on the second tenant's first record.
- Do not add `(db as any)`. Typed model access works on `TenantDb`; the casts
  are what hid the nested-`$transaction` bug.
