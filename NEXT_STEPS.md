# Next Steps

**Phase 5 is complete.** Immediate tasks to continue from the Phase 5.4 commit.
Full context is in `PROJECT_STATE.md` — read its "Read this first" section
before starting.

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
npm test --workspace @landingos/website-builder    # 101 + 235 ERP contract
npm test --workspace @landingos/erp                # 298 (the legacy stack)
```

The ERP contract suite needs the server up. Run it in strict mode, which turns
a skip into a failure, from `apps/website-builder`:

```bash
ERP_CONTRACT=strict node --env-file=.env --test --test-concurrency=1 "test/erp/access.test.ts"
```

Expect **235/235** across the eight files: access 62 · orders 38 ·
validation 29 · listing 25 · catalog 31 · delivery 20 · integrations 22 ·
order-split 8.

---

## 1. Phase 6 — the ERP interface

The backend is done. What is left of the old ERP is its front end: a
4,949-line vanilla SPA (`apps/erp/index.html`) and a 1,261-line agent PWA
(`apps/erp/agent.html`), both talking to the Express API that has now been
superseded.

**Retiring `apps/erp` is Phase 6's first act, not its last.** It is a UI in
front of a dead API. Every screen it has now has a platform route behind it, and
the contract tests say so.

Rebuild it the way Phase 4.4 rebuilt the builder — screens on the console shell,
in `apps/website-builder/src/app/console/erp/`. The ERP's manifest already
declares its navigation (`packages/product-registry/src/manifests.ts`), and the
generic `console/[product]` route serves it today with no screens of its own.

**When the first real ERP screen exists, remove the placeholder body from
`console/[product]/page.tsx` for that route only** — the generic route must keep
serving any *other* product that ships no screens.

Two things the old SPA does that the new one must not inherit:

- **Images as base64 in the database** (M-14). It is why the ERP's JSON body
  limit is 25 MB. Upload to R2, store a key.
- **A 25 MB body limit.** With images out of the payload there is no reason for
  one.

---

## 2. The migrations Phase 5 left, with what they owe

| id | Scope | Owes |
|---|---|---|
| **M-15** | Jobs → `services/worker`. The overdue sweep and tracking poll are in-process `setInterval`s in `apps/erp`; on a scaled deployment they run once per instance and double-count every miss. `services/` exists and is empty. | Port `apps/erp/test/overdue-sweep.test.js` (~12 tests), deferred in 5.1. |
| **M-16** | Notification unification. The table already moved to `platform.prisma`; the transport — SSE, per-account read watermark, replay on reconnect, Web Push — has no platform equivalent. | Port `apps/erp/test/notifications.test.js` (~20 tests) and the SSE half of `delivery-outcome.test.js`, both deferred in 5.1. |
| **M-14** | ERP images → R2. | — |
| **M-19** | Template registry. The storefront has one hardcoded template with colour-only themes. | — |

---

## 3. Two guarantees that still need a platform owner

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

## 4. Deliberate 501s, so nobody reads them as gaps

- `POST /api/erp/agents` — inviting a person is a PLATFORM action (M-02).
  Gated first, so an agent is still refused; a manager is told where it lives.
- `POST /api/erp/ai/chat`, `GET /api/erp/ai/chat/stream`,
  `POST /api/erp/ai/insights/deep` — calling a model needs a configured provider
  and a real key, which is deployment configuration. Gated first, because
  leaving them unrouted would put a hole in "every AI route requires a session"
  exactly where SEC-03 was.

---

## 5. Not blocking, but do them when convenient

- **Rotate the two credentials** listed under *Security actions* in
  PROJECT_STATE. Needs a human.
- **Verify the Docker image** — never built:
  `docker build -f apps/website-builder/Dockerfile -t landingos-builder .`
- **Replace the `(db as any)` casts** in the Phase 4.4 builder routes. The
  entire ERP layer is written without one — `db.fulfillmentOrder` typechecks on
  `TenantDb` — so the pattern is proven; it is only the older routes left.
- **Rename `apps/website-builder`.** It hosts the whole platform. Phase 6 is
  the moment, if ever.

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
