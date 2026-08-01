# Changelog

Work driven by the engineering audit of 1 August 2026. Findings are referenced
by their audit IDs (`SEC-01`, `BUG-02`, `PERF-01`, …).

Format: newest first. Each entry records **what** changed, **why**, the **files**
touched, any **migration**, and any **risk**.

---

## Phase 1 — Critical

### Groundwork

#### Version control baseline
**What.** `git init`, `.gitignore`, `.gitattributes`, and a baseline commit of the
codebase exactly as reviewed.
**Why.** The project was not under version control at all, so there was no way to
make the small reviewable commits this work requires, and no way to roll back.
**Files.** `.gitignore`, `.gitattributes` (both new).
**Migration.** None.
**Risk.** None. `crm.db`, `node_modules`, `.env` and the stray `{try{return` /
`_probe.py` artefacts are excluded from tracking.

#### Made the project installable and runnable on current Node
**What.** Bumped `better-sqlite3` from `^11.3.0` to `^12.11.1`; added
`start`/`dev`/`test`/`smoke` scripts, an `engines` field (`node >=20`), and a
committed `package-lock.json`.
**Why.** `better-sqlite3` 11.x publishes no prebuilt binary for Node 20+ on
Windows, so `npm install` fell through to a `node-gyp` build requiring Visual
Studio and failed outright. A fresh clone could not be installed or started.
**Files.** `package.json`, `package-lock.json` (new).
**Migration.** None — the SQLite file format is unchanged between the two majors.
**Risk.** *Moderate, and worth a deliberate check on deploy.* Only the stable
surface of the library is used here (`Database`, `pragma`, `exec`,
`prepare`/`run`/`get`/`all`, `transaction`, named `@params`), all unchanged
between v11 and v12; the full 27-table schema and the regression suite were
verified against v12. If the production host pins an old Node, confirm it is
≥ 20 before deploying.

#### Configurable database location
**What.** `CRM_DB_PATH` (and `CRM_DATA_DIR`) now override where `crm.db` lives;
the directory is created on boot if missing.
**Why.** Two reasons. In production the app directory on a container host is
usually ephemeral, so the default in-repo path silently loses every order on
redeploy — this is audit priority #1. In tests, each run needs its own throwaway
database so tests can never touch real data.
**Files.** `lib/db.js`.
**Migration.** None. Defaults to the original path, so existing deployments are
unaffected until the variable is set.
**Risk.** None by default. **Action required on the production host:** set
`CRM_DB_PATH` to a mounted persistent disk (e.g. `/var/data/crm.db` on Render)
and copy the existing `crm.db` there, or order data remains at risk.

#### Integration test harness
**What.** `test/helpers.js` boots the real server as a child process on a random
port against a throwaway database; `test/regression.test.js` covers 45 behaviours
across orders, calls, clients, products, inventory, agents, settings, providers,
stores, shipments, follow-up, bulk operations and financial records.
**Why.** "Test every change before moving to the next task" needs something to
test against. These tests were written against the pre-fix code and must keep
passing through every phase, so they detect regressions introduced by the fixes.
**Files.** `test/helpers.js`, `test/regression.test.js` (both new).
**Migration.** None.
**Risk.** None — tests never touch the real database.

### Fixes

#### BUG-01 — the overdue sweep crashed on its first candidate, every run
**What.** Declared the `minutes` value that `runOverdueSweep()` was already
passing to the audit log, computed as the elapsed time since the order was
created. The audit entry now also records `thresholdMinutes` and the resulting
`missedOrders` count. The sweep interval is overridable via
`CRM_SWEEP_INTERVAL_MS` (default unchanged at 60s) so it can be tested, and the
interval's error log now includes a stack trace.
**Why.** `minutes` was referenced at `index.js:389` but never declared anywhere in
the file, so the sweep threw `ReferenceError` on the first overdue order of every
run. The `setInterval` wrapper caught and logged it, so there was no visible
symptom — but everything downstream of that line never executed. This meant the
missed-order alert, automatic reassignment, the unassigned-overdue queue and
auto-suspend had **never worked**, and the `autoReassign`, `autoSuspend`,
`suspendThreshold`, `reassignMinutes`, `workHoursStart/End` and
`nightGraceMinutes` settings were all inert.
Recording the threshold alongside the elapsed time keeps an old audit entry
explicable after the setting is later changed — the same reasoning already
applied to `call.threshold`.
**Files.** `index.js`, `test/overdue-sweep.test.js` (new).
**Migration.** None.
**Risk.** *This turns on behaviour that has never run in production.* Once
deployed, agents will start accumulating `missedOrders`, and if `autoReassign`
or `autoSuspend` are enabled they will begin moving orders and locking accounts.
Both default to `false`. **Recommended:** deploy with both off, watch the
`overdue-sweep` log lines for a day to confirm the thresholds suit the team, then
enable. Note `reassignMinutes: 0` means *five* minutes, not zero — `Number(0) || 5`
falls through to the default.
**Tests.** 12 new tests covering: the sweep not throwing, single-counting per
timeout, the order flag, the audit payload, protection for in-progress and
already-called orders, counter reset, reassignment to the least-loaded eligible
agent, the unassigned queue when nobody is eligible, auto-suspend at threshold,
the weekly-day-off exclusion, and the working-hours gate.

#### BUG-04 — delivery and follow-up SSE events were malformed
**What.** The two `broadcaster(...)` calls in `lib/providers/index.js` now pass a
single payload object with `type` inside it, matching `broadcast(payload, target)`.
**Why.** They were called with three arguments, event-name first, so the payload
was the bare string `"delivery_update"` and the target was the object. Clients
received `data: "delivery_update"`, `JSON.parse` produced a string, `data.type`
was `undefined`, and the handler fell straight through — so the enriched delivery
notification the manager console is built to render (order number, customer,
carrier, old → new status, row highlight) never arrived. Because the target was
an object rather than a name, the frame also went only to the `manager` key.
Both the carrier webhook and the 15-minute polling job run through this path.
**Files.** `lib/providers/index.js`, `test/delivery-outcome.test.js` (new).
**Migration.** None.
**Risk.** Low. The payload shape already matched what `handleNotif` expects; only
the call signature changed. A test now subscribes to the real SSE stream and
asserts a well-formed `delivery_update` object arrives with no string-only frames.

#### BUG-02 — `deliveryOutcome` was read in eight places and written in none
**What.** `ingestTrackingEvents()` now settles `orders.deliveryOutcome` and
`deliveryOutcomeAt` when a carrier reports a terminal state, plus a one-time
non-destructive backfill (`db.backfillDeliveryOutcomes()`) that recovers the
outcome for parcels already delivered before this fix existed.
**Why.** Nothing wrote these columns, so every figure derived from them was
permanently zero: the profit calculator's *Synchroniser* (units sold, returns,
real revenue, average buy price), `clients.deliveredOrders` / `totalSpent` and
therefore every customer's lifetime value, `products.deliveredOrders` /
`totalRevenue` / `totalProfit`, and `computeAgentPayroll`'s `deliveredPay` — so
the `payPerDeliveredOrder` rate never paid out. The FIFO cost machinery
underneath was correct and simply being fed nothing.
Per the schema contract the value is set **once**, only from a carrier-reported
terminal state, and only for `delivered` or `returned` — `cancelled` and `refused`
stay provisional until the parcel settles. It is deliberately not derived from
the confirmation-call status: under cash-on-delivery a phone confirmation is not
a sale. All newly-inserted events are scanned rather than only the newest,
because carriers commonly replay their whole history in one response; the
earliest settling event wins, since `deliveryOutcomeAt` is what date-range profit
queries attribute against.
**Files.** `lib/providers/index.js`, `lib/db.js`, `index.js`,
`test/delivery-outcome.test.js` (new), `test/backfill.test.js` (new).
**Migration.** `backfillDeliveryOutcomes()` runs once on boot, after the legacy
migration. Non-destructive: it only fills rows where `deliveryOutcome` is empty
and never overwrites an existing value. It reads the append-only `shipment_events`
history, routes each update through `patchOrder()` so client and product lifetime
counters move on the same transition they would have at the time, writes a
`delivery_outcome_backfilled` audit row per order, and records a settings marker
so later boots skip the scan entirely.
**Risk.** *Reporting numbers will change on first boot after deploy* — this is the
point, but it is a visible jump. Historic revenue, delivered counts and lifetime
customer spend will go from zero to their true values, and any agent on a
`payPerDeliveredOrder` rate will show back-pay for every parcel already delivered.
**Recommended:** take a copy of `crm.db` before deploying, then reconcile the
first payroll run manually. The migration is idempotent and re-running it cannot
double-count.
**Tests.** 14 new tests: settlement on delivery, settle-once, in-flight parcels
staying unsettled, phone-confirmation never settling, client lifetime spend,
product sales-summary revenue and cost basis, delivered-pay payroll, plus a
backfill suite that stages a real pre-fix database, restarts the server, and
asserts recovery, timestamp fidelity, counter rebuild, the audit trail,
no-double-count on a second boot, and never overwriting an existing outcome.

#### Carrier adapters could not create shipments (found while testing)
**What.** `getAdapter()` now fills every adapter against a default contract, and
`mock.js` declares a real `statusMap` derived from its own pipeline.
**Why.** Not in the audit — surfaced by the new test suite. `lib/providers/base.js`
defines an `ADAPTER_SHAPE` contract but it is a documentation object that was
never merged into anything, and `mock.js` never defined `mapStatus()`. Because
`getAdapter()` falls back to the generic (= mock) adapter for any key without an
implementation, **shipment creation threw `adapter.mapStatus is not a function`
for 9 of the 12 carriers offered in the admin dropdown** — every one except `zr`,
`zr-webhook` and `ecom`. The caller catches and logs, so the only symptom was
confirmed orders silently never getting a shipment. With `autoCreateShipment`
defaulting to `true`, this affected the default configuration.
Separately, `mock.js` returned French labels (`"Création"`) while declaring
`statusMap: {}`, so a new shipment resolved to `pending` instead of `created`.
**Files.** `lib/providers/index.js`, `lib/providers/mock.js`, `test/regression.test.js`.
**Migration.** None.
**Risk.** Low. Behaviour only changes where it previously threw. A regression test
now asserts every registered adapter key answers the full contract.
**Follow-up.** The 7 carrier keys with no implementation (yalidine, noest, ems,
dhl, ups, fedex, aramex) still fall back to simulated tracking. Fabricating
delivery events for a real carrier is wrong; this is queued for Phase 2 under
"frontend features without backend support".

#### SEC-01 / SEC-02 — authentication, authorization and login screens
**What.** A complete authentication layer: `lib/auth.js` (scrypt hashing, opaque
server-side sessions), the `sessions` table, `agents.accountRole`, login/logout/
me/change-password endpoints, a deny-by-default gate on `/api`, a declarative
manager-authorization table, login screens in both clients, and record-level
scoping of the order book.
**Why.** There was no authentication of any kind: 117 open routes, no login
endpoint anywhere, `GET /api/agents` returning every password in cleartext, and
the agent PWA comparing that password in the browser. The manager console had no
login at all — opening the URL made you the manager.
**Files.** `lib/auth.js` (new), `lib/db.js`, `index.js`, `agent.html`,
`index.html`, `test/auth.test.js` (new), `test/helpers.js`.
**Migration.** Two, both idempotent and run on boot:
1. Legacy plaintext passwords are rewritten as scrypt hashes. Accounts whose
   password was **empty keep working exactly as before** — the empty string is
   hashed, so a blank field still authenticates — and are surfaced as
   `hasPassword: false` so a manager can find and fix them. Locking staff out
   mid-shift is a worse failure than carrying a weak password one more release.
2. A manager account is created from `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
**Risk.** **Deployment will fail closed if `ADMIN_USERNAME` and `ADMIN_PASSWORD`
are not set — nobody will be able to sign in.** Set both before deploying. Set
`ALLOWED_ORIGINS` only if you keep hosting the frontend separately; the clients
are now served from `/app` and `/agent` on the API itself, which is what makes
the session cookie work without cross-site cookies.
Also note both clients now default to the origin they were served from rather
than the hardcoded `erp-serveur.onrender.com`. Anyone with a server URL saved in
Settings keeps that value.
**Tests.** 49 new: the closed-by-default gate across 20 routes, login/logout/
session lifecycle, uniform failure for unknown accounts, HttpOnly cookie
attributes, no password field anywhere in a response, hash-at-rest, manager vs
agent authorization, last-manager protections, suspension revoking live
sessions, password change evicting other sessions, static client serving, and
order-book scoping.

#### SEC-03 / SEC-04 — AI clamping and fail-closed webhooks
See the commit message for detail. Summary: the AI permission fallback is
clamped to the caller's ceiling (`read_analytics` withheld from agents because
it aggregates across all orders and ignores scoping), `actor`/`scopedAgent` now
come from the session rather than query parameters, and one shared
`webhookSignatureOk()` makes a configured secret mandatory to verify — omitting
the signature header no longer bypasses the check.
**Risk.** Webhook verification is *not* mandatory by default, because many
deployments run with no secret configured and demanding one would drop every
live order. The boot log now names every integration still accepting unsigned
payloads. Set a secret on each, then `REQUIRE_WEBHOOK_SIGNATURES=1`.

#### ARCH-01 — SSE connections evicting each other
`sseClients` is now `channel -> Set<writer>`. One writer per name meant a second
browser tab evicted the first, and the close handler removed the entry
regardless of which connection had closed — so closing either tab killed live
updates for both. Files: `index.js`.

---

## Phase 1 — self-review

A deliberate adversarial pass over the Phase 1 work, assuming it was wrong.
Seven defects were found and demonstrated against a running server before being
fixed; three were critical, and the worst was introduced *by* Phase 1.

#### REV-01 — `express.static(__dirname)` published the entire application directory
**Severity: critical. Introduced by Phase 1.**
Serving the clients from the project root also served everything else in it.
`GET /crm.db` returned the **live database** — every order, customer phone
number, password hash and carrier API key — to an unauthenticated caller
(verified: HTTP 200, 319 KB). `/lib/*.js`, `/index.js`, `/package.json` and any
`.env` were equally readable. This was strictly worse than the unauthenticated
API the phase set out to close.
**Fix.** An explicit allowlist of six client files plus the icons directory.
Nothing is served unless it is named.
**Files.** `index.js`. **Tests.** 21, including path-traversal attempts.

#### REV-02 — case-insensitive routing bypassed every manager-only rule
**Severity: critical.**
Express matches routes case-insensitively by default, but the authorization
table matches paths with regexes, which are case-sensitive. `POST /api/AGENTS`
therefore reached the handler while skipping the manager check. Verified: a
plain confirmation agent created an account and rewrote global settings.
**Fix.** Case-sensitive routing enabled, *and* the gate lowercases and strips
trailing slashes before matching — two independent defences.
**Files.** `index.js`. **Tests.** 9 casing variants across five routes.

#### REV-03 — order-list scoping was cosmetic
**Severity: critical.**
Filtering `GET /api/orders` hid other agents' orders from the list, but every
per-order route read the id straight from the URL with no ownership check. Any
agent could read another's `/audit` (customer name, phone, full call history),
edit the order, reassign it to themselves, or log a confirmed call against it —
which credits `payPerConfirmedOrder` to the caller, i.e. payroll fraud. All
verified against a running server.
**Fix.** A record-level gate on `/api/orders/:id*`, plus a single
`agentOwnsOrder()` used by both the list filter and the gate so the two can
never disagree. Non-managers also cannot change `agent`/`followupAgent`.
**Files.** `index.js`. **Tests.** 14.

#### REV-04 — the same client-supplied-filter mistake in two more places
`GET /api/followup/tasks?agent=` took the filter from the query string, so any
agent could list another queue (or omit it and get everything). `/api/clients`
— the densest PII in the system — was readable by any signed-in agent although
the agent PWA never calls it.
**Fix.** Follow-up tasks are pinned to the caller for non-managers; the client
registry, the Suivi dashboard and follow-up assignment are manager-only.
Resolving a follow-up task now requires it to be yours.
**Files.** `index.js`. **Tests.** 3.

#### REV-05 — the password migration mislabelled blank-password accounts
`setAgentPasswordHash()` third argument was omitted in the migration, so it
defaulted to `true` and every migrated account reported `hasPassword: true` —
including the blank-password ones the flag exists to expose. The boot warning
counted them correctly while the UI showed them as fine.
**Fix.** The flag is derived from the actual value. **Tests.** 1, which stages a
real pre-auth database and asserts the flag after migration.

#### REV-06 — login blocked the event loop and had no input bound
`scryptSync` spends ~100-200 ms of CPU *blocking*, so a handful of concurrent
logins stalled every other request. Passwords were also unbounded up to the
25 MB body limit. And the unknown-account decoy was built per request, costing
two derivations against a real account one — making misses measurably *slower*
and leaking exactly what the uniform error message was hiding.
**Fix.** Async `crypto.scrypt` (libuv threadpool), a 1 KB password cap, and one
lazily-generated decoy hash. **Tests.** 3, including a health check timed during
a login burst.

#### REV-07 — CSRF once `ALLOWED_ORIGINS` is used
CORS stops an attacker *reading* a cross-site response; it does not stop the
request. Same-origin deployments are protected by `SameSite=Lax`, but setting
`ALLOWED_ORIGINS` forces `SameSite=None`, at which point any page could POST
with the victim session attached.
**Fix.** State-changing requests must carry a recognised `Origin`. A missing
`Origin` is allowed, since non-browser callers (curl, carrier webhooks) send
none and are not the CSRF threat. **Tests.** 4.

### Also corrected
- Auto-suspend from the overdue sweep now revokes sessions, matching the manual
  suspend route.
- `attachUser` moved from global to `/api`: it was doing a session lookup plus
  an agent lookup for every static asset request.
- Session `lastSeenAt` is written at most every 5 minutes instead of on every
  request — it was an UPDATE per API call against a single-writer database.
- The delivery-outcome backfill now runs just *after* `listen()`. It walks every
  order through `patchOrder()`, which on a large database is minutes of
  synchronous work; blocking the port that long risks the host health check
  killing the container mid-migration.
- Auth bootstrap is awaited before `listen()`, so a login cannot race the
  password migration.
- `x-powered-by` disabled.

**Test count after review: 188, all passing** (133 before).
