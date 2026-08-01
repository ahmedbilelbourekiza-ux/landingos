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
