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
