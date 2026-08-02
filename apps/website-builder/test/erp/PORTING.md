# Porting the ERP test suite (Phase 5.1, M-18)

The ERP's 13 test files and 298 tests are the only meaningful coverage the more
complex of the two products has. They are **contract tests over HTTP**, not unit
tests bound to Express, which is the only reason they port at all — and the
reason they are moved *before* any ERP logic, rather than rewritten afterwards
against whatever the new routes happen to do.

This file records every decision, including the ones where the answer was "no".
A test that was dropped without a recorded reason is indistinguishable from a
test that was forgotten.

---

## The two things that changed shape

### 1. Identity is no longer the ERP's

The ERP owned its own accounts (`agents.name` as a TEXT primary key), its own
sessions, its own scrypt hashes and its own binary `accountRole`. All four were
replaced in Phase 3.4 by `@landingos/auth` — opaque sessions, argon2id,
entitlement-aware RBAC — which carries **32 tests of its own**.

So the ERP's login, logout, password-change, suspension and session-eviction
tests are not ported: they now assert something the platform already asserts,
and a second copy would drift. What *is* ported is everything those tests were
protecting — that the routes are closed, that an agent cannot do a manager's
job, and that an agent sees only their own order book.

**The role mapping used throughout these tests:**

| ERP | Platform | Why |
|---|---|---|
| `accountRole: manager` | `ADMIN` | `erp:agents:manage` is SENSITIVE in `rbac.ts`, so only a bare `*` reaches it. |
| `accountRole: agent` | `MEMBER` + explicit `erp:orders:write` | A confirmation agent must write calls and edit their own orders; `MEMBER`'s role globs are read-only. |
| `role: confirmation \| followup \| both` | `Membership.jobRole` | Already modelled. The JOB is not the PRIVILEGE — the ERP kept them separate so a follow-up agent could also be a manager, and collapsing them here would undo that. |

### 2. There is a tenant now

Every ported test runs inside a tenant, and the suite adds a dimension the ERP
never had: **two tenants, and the assertion that neither can see the other.**
The ERP was single-tenant, so "another company's order" was not a case it could
express. It is now the most important one.

No ported test writes `where: { tenantId }`. The binding does it and the
database enforces it — which is only worth claiming because these tests try to
break it from every direction.

---

## File-by-file

### Ported

| Source | Target | Notes |
|---|---|---|
| `auth.test.js` §SEC-01, §authorization, §record scoping | `access.test.ts` | The route inventory, the manager/agent split and the agent's order-book scope. Login/logout/password/suspension dropped — see above. |
| `regression.test.js` orders | `orders.test.ts` | Lifecycle, call results, notes, classification, the attempts matrix, bulk. |
| `hardening.test.js` §3 | `orders.test.ts` | Per-order ownership on **every** sub-route. Scoping the list was cosmetic while `/api/orders/:id/call` took the id from the URL unchecked — logging a confirmed call on someone else's order is payroll fraud. |
| `validation.test.js` | `validation.test.ts` | Mass assignment, the privilege split on order fields, prototype pollution, settings whitelist/range/atomicity. |
| `regression.test.js` products/inventory/clients/finance | `catalog.test.ts` | Variants, stock lots, the FIFO ledger, archive-not-delete, the client registry surviving order deletion, financial records. |
| `pagination.test.js` | `listing.test.ts` | Paging, filter composition, sort whitelisting, injection attempts, stats — and the property the file exists for: the scope is applied **inside** the query. |
| `delivery-outcome.test.js` §BUG-02 | `delivery.test.ts` | The settlement chain: carrier event → `deliveryOutcome` → client lifetime spend → product revenue → delivered pay. |
| `regression.test.js` providers/shipments | `delivery.test.ts` | Carrier secrets masked on read, re-saving a masked value not destroying the stored secret, status mappings, shipment creation and tracking. |
| `webhook-ai-security.test.js` §SEC-04 | `integrations.test.ts` | Signature verification **fails closed**. The original bug was `if (secret && sig)`, so omitting the header skipped verification entirely. |
| `webhook-ai-security.test.js` §SEC-03 | `integrations.test.ts` | The AI surface is gated and scoped; `actor` and `scopedAgent` come from the session, never a query parameter. |

### Reshaped, because the platform answers differently

| Source | What changed |
|---|---|
| `hardening.test.js` §1 — static serving | **Dropped.** The ERP served its whole application directory, database included. Next serves nothing from the app root; there is no equivalent surface to attack. The class of bug cannot recur because the mechanism is gone. |
| `hardening.test.js` §2 — case-insensitive bypass | **Reshaped.** Express matched routes case-insensitively while the authorization table used case-sensitive regexes, so `/api/AGENTS` bypassed every manager-only rule. Next matches case-**sensitively** and authorization is a parameter to `tenantRoute`, not a path regex — so the bypass is structurally impossible. Kept as an assertion that a cased variant 404s rather than reaching a handler, because "structurally impossible" is a claim worth a test. |
| `hardening.test.js` §5 — login stalling the event loop | **Dropped.** Belongs to `@landingos/auth`, and argon2id via `@node-rs/argon2` does not block the event loop the way `scryptSync` did. |
| `hardening.test.js` §6 — CSRF origin check | **Dropped from the ERP suite.** It is a platform concern, not a product one; it needs to hold for `/api/builder/*` identically. Recorded as an open item below. |
| `hardening.test.js` §8 — dead code and SIGTERM | **Dropped.** Source-level assertions about `apps/erp/index.js`, which stays where it is until Phase 6. |
| `pagination.test.js` — "the legacy unpaginated shape still works" | **Dropped.** That compatibility existed so a cached copy of the old vanilla SPA would not break on deploy. There is no cached old client on a new API surface, and carrying two response shapes forward would make the platform envelope optional. |
| `ratelimit.test.js` — login throttling, security headers | **Dropped from the ERP suite.** Both are platform-wide. Recorded as open items below. |
| `auth.test.js` — static clients (`/app`, `/agent`, service worker) | **Dropped.** Phase 6 rebuilds those screens in React; asserting the vanilla SPA is served would pin work we intend to delete. |

### Does not port

| Source | Why |
|---|---|
| `indexes.test.js` | `EXPLAIN QUERY PLAN` against SQLite's `sqlite_master`. The Postgres equivalent already exists: `packages/db` asserts the 157 indexes and that every compound index on a scoped table leads with `tenantId`. Re-asserting it here would be a worse copy. |
| `backfill.test.js` | A one-time SQLite migration that recovered `deliveryOutcome` from `shipment_events` for installations upgrading past BUG-02. M-06 already converted that data. The migration cannot run again and there is nothing left to assert. |
| `harness.test.js` | Tests the SQLite child-process harness itself — that `stop()` really killed the process and left no unrecovered write-ahead log. The platform harness spawns nothing and has no WAL. |

### Deferred, with the migration that unblocks them

| Source | Blocked on | Why not now |
|---|---|---|
| `notifications.test.js` (~20 tests) | **M-16** — notification unification | The ERP's notification table already moved to `platform.prisma`, but the transport (SSE, per-account read watermark, replay on reconnect, Web Push) has no platform equivalent yet. Porting these against a transport that does not exist would encode a contract nobody has designed, and getting it wrong is worse than the gap. The behaviour they protect is real and specific — per-account read state, manager-only targeting, a watermark that cannot be poisoned or moved backwards — so this file must be ported, not abandoned. |
| `overdue-sweep.test.js` (~12 tests) | **M-15** — jobs move to `services/worker` | The sweep is an in-process `setInterval` in `apps/erp`. On a scaled deployment it would run once per instance and double-count every miss, which is exactly why M-15 exists. The tests drive it by shortening `CRM_SWEEP_INTERVAL_MS` on a child process; there is nothing to shorten yet. |
| `delivery-outcome.test.js` §BUG-04 (SSE frames) | **M-16** | Same reason. The settlement half of the file ports now; the "is the broadcast well-formed" half waits for a broadcast. |

---

## What this port exposed

### D-05.1 — the ERP's manager/agent split does not survive the role globs

**Open. Must be resolved in Phase 5.3, before the first ERP route ships.**

The ERP treated the customer registry and the finance screens as manager-only.
Its tests assert this directly:

```js
assert.equal((await agent.api('GET', '/api/clients')).status, 403);
assert.equal((await agent.api('GET', '/api/followup/dashboard')).status, 403);
```

On the platform, `MEMBER` and `VIEWER` both carry the glob `*:*:read`, which
grants `erp:clients:read` and `erp:finance:read` to every member of the tenant.
A confirmation agent would gain every customer's phone number and lifetime spend
and the company's profit and loss — precisely the exposure the ERP's SEC-02 work
closed.

This is not a bug in either system. It is two authorization models meeting: the
ERP's was binary and hand-listed, the platform's is a glob over a vocabulary
products declare. Nothing detects the collision except a test that knew the old
boundary.

**Recommendation.** Add `*:clients:read` and `*:finance:read` to `SENSITIVE` in
`packages/auth/src/rbac.ts`. That list exists for exactly this class — the
permissions where "probably fine" is the wrong default — and it is already
expressed as product-agnostic globs, so it stays true to the platform's rule
that no platform file enumerates products. It also means a `MANAGER` needs the
grant by name, which reads correctly: running a call-centre day to day is not a
reason to hold every customer's PII.

The affected tests are written to assert **the ERP's boundary**, and are marked
`D-05.1` where they appear. They will fail until this is decided. That is the
intended behaviour of a contract test: it fails to force the decision, rather
than passing against whatever was built.

### Open items that left the ERP suite and need a platform home

Neither blocks Phase 5. Both were real, tested guarantees in the ERP that
currently have no platform equivalent:

1. **Cross-origin state changes.** The ERP refused a POST carrying an
   unrecognised `Origin` with `CSRF_ORIGIN`, because CORS stops an attacker
   *reading* a cross-site response but not the request happening. `/api/builder/*`
   has no such check.
2. **Rate limiting.** Login throttling (per-IP *and* per-account, case-insensitive
   so casing cannot reset the counter) and a general API backstop, with the SSE
   stream and inbound carrier webhooks exempt. `packages/auth` has neither.

---

## Running them

The suite probes for the ERP API on start-up and **skips with a stated reason**
while `/api/erp/*` is not mounted, so it does not turn the workspace red before
Phase 5.3 lands the routes. The moment the first route exists, its tests light
up on their own.

Each test is skipped individually rather than by skipping its `describe`. That
is not cosmetic: node reports a skipped suite as `suites 8, tests 0`, so the
ported tests would vanish from the run instead of appearing as skipped, and
nobody reading the output could tell whether this directory held 227 tests or
none. As written the run reports `tests 227, skipped 227`.

```bash
npm test --workspace @landingos/website-builder
```

To make an unmounted API a **failure** instead of a skip — which is what CI
should do once Phase 5.3 starts:

```bash
ERP_CONTRACT=strict npm test --workspace @landingos/website-builder
```

Most of these tests need the server running on `:3000`; they skip rather than
fail without it, so check the counts, not just the exit code.
