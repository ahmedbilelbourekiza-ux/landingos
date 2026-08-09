# HANDOFF_PRODUCTION — deployment and production state

**Written:** 9 August 2026, ~19:00 UTC · **For:** the next conversation/agent
picking this project up. Read this FIRST for anything touching production;
`PROJECT_STATE.md` (platform history), `BUILDER_HANDOFF.md` (product) and
`UIUX_PASS.md` (the UI/UX + mobile passes) remain the deep references.

---

## 1. CURRENT PRODUCTION STATE

- **Deployed commit:** `a42676b` ("A session outlives its membership, a phone
  gets its language back") — verified serving by an **authed marker**
  (`locale-mobile` in the rendered console shell), not assumed from the push.
- **Production URL:** `https://landingos.onrender.com` (Render, Docker,
  auto-deploys from `origin/main`). The bare domain root 307-redirects to
  `/console`.
- **Health** (fresh curl, 9 Aug 18:57 UTC):
  `{"database":"ok","referenceData":"58 wilayas","isolation":"rls","uploads":"r2"}`
  — all four checks green. `isolation: "rls"` means the runtime role is
  RLS-scoped; the entrypoint additionally REFUSES to boot on a bypassing role.
- **Mobile language switcher:** deployed and verified — the `locale-mobile`
  control was confirmed in the authed production shell HTML, and the full
  behavior (drawer switcher visible at 360px, dropdown-only switch ar↔fr with
  correct RTL/LTR both ways, desktop header switcher unchanged) was verified
  in the browser against the exact build that was then deployed.
- **Mobile bulk-actions bar:** deployed — the `md:sticky` class confirmed in
  production's served orders HTML. Behavior (static + scrolls away at 360px
  in LTR and RTL; still pinned at 64px on desktop) verified in the browser
  against the same build locally.
- **Stale-tenant/session fixes:** deployed in the same commit (they compile
  into the same bundle the marker proves). Covered by three regression tests
  that ran green against this build (console-shell ×2, team ×1).

## 2. RECENT COMMITS / DEPLOYMENTS (all on `main`, all deployed, oldest first)

| Commit | What it is |
|---|---|
| `5ac85b0` | The UI/UX pass: builder overview rebuilt, table headers, editor variant-label + unsaved-state fixes, ERP order summary strip, notification timestamps, locale switcher auto-submit (~60 i18n keys) |
| `4470c50` | Mobile UX fixes (filter-bar mobile collapse, orders-table mobile columns, strip static on phones, tap targets, storefront select sizing) + the **RLS boot/health guard** |
| `8c23746` | Mobile drawer + toast portals — the header's `backdrop-blur` made it the containing block for `fixed` descendants; the drawer was pinned to a 55px box |
| `acbc96a` | Bare domain root `/` → 307 `/console`; a verified custom domain's root goes to its own storefront |
| `a42676b` | Mobile language switcher (drawer instance, `id="locale-mobile"`) + bulk bar `md:sticky` + the five stale-tenant session fixes with regression tests |

## 3. IMPORTANT PRODUCTION INFRASTRUCTURE STATE

- **Database:** production uses the EXISTING Neon database
  (`ep-summer-shadow-…/neondb`, eu-central-1) — **the same database local dev
  and the contract suites use.** It contains months of test fixtures
  alongside the demo/acme tenants.
- **The RLS incident (9 Aug), fixed:** Render's `DATABASE_URL` originally
  carried the owner credential (`neondb_owner`, BYPASSRLS) — with the app
  deliberately writing no `where: {tenantId}`, production served **every
  tenant's rows to every tenant** (60 tenants' ORD-0001 in one list; 6.4MB /
  8.7s order pages). The user corrected the Render env var to the
  `landingos_app` role. Two guards now make the misconfiguration
  unrepeatable: the entrypoint refuses to boot on a BYPASSRLS role (probe
  proven both ways against the live cluster) and `/api/health` reports
  `isolation` and goes unhealthy on bypass (pinned test).
- **Env-var note:** Render has only `DATABASE_URL` (no `PLATFORM_DATABASE_URL`).
  That is valid — the entrypoint normalizes either name into both, and
  `packages/db/src/tenant-client.ts` prefers `PLATFORM_DATABASE_URL` then
  falls back. **`DATABASE_URL` is the effective runtime credential in Render.**
- **Legacy service:** `erp-serveur.onrender.com` (the pre-platform ERP) still
  exists and is **NOT decommissioned**. It answers `Cannot GET /api/health`.
  Decommissioning is a Render-dashboard action (recommended: Suspend first,
  check its own old database for anything worth archiving, Delete later).
- **No Render/Neon API credentials exist on the dev machine.** All dashboard
  changes are the user's; deployments are verified from outside (health shape
  + authed markers).
- **Not deployed:** `services/worker` — no scheduled ERP jobs (follow-up
  escalation, overdue sweep, carrier polling) run in production.

## 4. SEPARATE PRODUCTION DATABASE (prepared, NOT executed)

**Why it was proposed.** Three independent reasons, all observed:
1. **Fixture pollution** — the shared DB holds hundreds of contract-test
   tenants/orders/pages; before the RLS fix these rendered inside production
   screens, and they still inflate anything unscoped (and any future
   cross-tenant aggregate).
2. **Contention** — suites, local dev and production share one Neon endpoint;
   the audit recorded repeated transient `P1001 Can't reach database server`
   failures under combined load (they hit test runs today; they would hit
   real customers tomorrow).
3. **Blast radius** — a test bug or a `seed:demo` run can currently write
   into the database production reads.

**Current vs dedicated.** Today: one `neondb` database serving dev + tests +
production. Dedicated: a `landingos_prod` database on the same Neon cluster
(same host, same `landingos_app` role — roles are cluster-wide), containing
only schema, RLS policies, reference data (58 wilayas / 537 baladias) and
real tenants.

**Already prepared:**
- A reviewed, additive-only provisioning script:
  `packages/db/scripts/_provision-prod-db.ts` (UNTRACKED, deliberately never
  committed). It creates `landingos_prod`, grants the existing app role on
  current and future objects, and verifies NOBYPASSRLS. It prints no secrets.
- The full runbook (also in the 9-Aug conversation): after the script, run
  `prisma db push`, `npm run rls`, `npm run seed:reference` — each with
  `MIGRATE_DATABASE_URL`/`DATABASE_URL` overridden IN THE SHELL to the
  new-database owner URL (never by editing `packages/db/.env`, and
  deliberately **no** `seed:demo`). Then Render's `DATABASE_URL` changes to
  the pooled `landingos_app` URL with `/landingos_prod` as the database.

**NOT executed:** none of it. The script has never run (its execution was
permission-blocked and then deliberately deferred); `landingos_prod` does not
exist; Render still points at `neondb`. **Do not execute any of this, and do
not change Render's database connection, without the user's explicit
approval.**

**The decision that must precede the switch:** the new database starts
EMPTY. The demo/acme tenants, their pages, and everything the user created
while testing production live in `neondb` and will not follow automatically.
Before switching, the user must decide: start production clean (tenants
re-created via signup), or plan a deliberate data migration for whichever
tenants are real. This is a product decision, not a technical default.

## 5. REMAINING WORK (in rough priority order)

1. **Separate production database** (§4) — prepared, awaiting approval + the
   migrate-or-clean decision.
2. **Decommission `erp-serveur`** — user's dashboard; suspend → verify
   nothing breaks → delete.
3. **Route-level loading states (UI.6)** — move `ConsoleShell` into
   `console/layout.tsx`, then `loading.tsx` per segment. The biggest
   remaining *perceived*-performance lever: console screens render 1.2–2.8s
   server-side with only the nav-item spinner as feedback.
4. **Storefront JS diet** — the public landing page ships ~1.29MB of JS
   (more than the console); framer-motion and the template bundle are the
   suspects. This is the customer-facing surface on Algerian mobile networks.
5. **Deploy `services/worker`** when scheduled ERP jobs are wanted in
   production (needs `WORKER_SECRET` on both sides).
6. From the audits, still open: editor i18n (LB.13, 54 components), Benefits/
   FAQ (LB.12), notification write-time i18n, analytics comparisons (PM.10),
   builder list pagination, LB.11 real-credential tracking smoke test (still
   gates real ad spend), UI.7 settings i18n residue, calculator step
   structure (UI.8), bulk-bar mobile collapse (it scrolls away now but is
   still a tall card when reached).

## 6. TESTING STATUS (as of 9 Aug 2026, evening)

**Tested locally (green, per file, against the a42676b build):**
console-shell **19/19** · platform/team **63/63** · erp/screens **173/173** ·
erp/notifications **48/48** · builder-sections **50/50** · builder-api
**23/23** · hardening **12/12** · i18n **20/20**. (Local reruns absorbed
several documented Neon P1001 transients — judge suites per file, rerun
before believing a red.)

**Verified in production (from outside, with evidence):**
health shape incl. `isolation: rls` · deployed-commit identity via authed
`locale-mobile` marker · bulk-bar `md:sticky` class in served HTML · Arabic
RTL (`<html lang="ar" dir="rtl">` served) · tenant scoping (pages list
104,892B ≈ local scoped render; only acme's own order references) · root
redirect `/ → 307 → /console` · drawer full-viewport at 390px (browser-driven
against production) · storefront + checkout pages 200.

**Not yet verified:**
- The stale-tenant self-heal exercised against PRODUCTION traffic (covered by
  local suites over HTTP; the production build is the same code).
- The mobile language switcher on the user's REAL device (browser-verified at
  emulated widths; the user's phone has caught things emulation missed).
- Anything involving the worker, real tracking credentials (LB.11), Web Push
  on a real device, or real carrier endpoints — unchanged from
  BUILDER_HANDOFF §11's honest list.

## 7. CRITICAL INSTRUCTIONS FOR THE NEXT CONVERSATION

1. **Never assume something is deployed because it exists locally.** This
   session shipped a stale build once because a piped `npm run build | tail`
   masked a failure. Read real exit codes; confirm `BUILD_ID` changed; verify
   the deploy by a marker only the new build can serve.
2. **There is no Render or Neon dashboard/API access.** Env vars, service
   settings and decommissioning are the user's hands. Verify configuration
   BEHAVIORALLY (health shape, markers, scoping) and say exactly what the
   user should change — never claim to have checked a dashboard.
3. **Never print secrets** — no connection strings with passwords, no
   AUTH_SECRET, no tokens in chat or logs. Point at where they live
   (`packages/db/.env`) and describe shapes with the password masked. Do not
   paste credentials into any dashboard yourself.
4. **Do not provision or migrate the production database without explicit
   approval** — and surface the migrate-or-clean decision (§4) before any
   switch.
5. **The dev loop is documented and earns its keep:** stop node → build
   (unpiped, check exit) → start; suites per file with `ERP_CONTRACT=strict`;
   rerun a red once before believing it (shared Neon); a server restart
   mid-suite invalidates the run; shells parked inside `.next` break the next
   build (EBUSY); the browser pane never composites screenshots, so OPEN
   interactive elements and measure them — presence is not correctness.
6. **Read this file, then `PROJECT_STATE.md`'s "Read this first", before
   changing anything.**

---

## Next Conversation Starting Point

The exact first steps, in order:

1. **Read this document**, then `PROJECT_STATE.md` §"Read this first", then
   `UIUX_PASS.md` for the UI/mobile history.
2. **Verify production is still healthy before trusting anything here:**
   `curl -s https://landingos.onrender.com/api/health` — expect
   `database: ok`, `referenceData: 58 wilayas`, `isolation: rls`,
   `uploads: r2`. If `isolation` is missing, an old build is serving; if
   `BYPASSED`, stop everything and tell the user to fix Render's
   `DATABASE_URL` (see §3).
3. **Confirm `origin/main` still equals `a42676b`** (`git fetch && git log
   --oneline origin/main -1`) — if it moved, someone else deployed; re-read
   the situation before assuming this document's state.
4. **Know the two open decisions owned by the user:** the separate production
   database (§4 — including migrate-or-clean) and the `erp-serveur`
   decommission. Neither may be started unprompted.
5. The most valuable next engineering work, if the user asks "what now":
   UI.6 loading states (perceived speed) or the storefront JS diet (customer
   phones) — both scoped in §5.
6. The demo login for local browser work is documented in the project memory
   (`owner@demo.test`, demo tenant); the shared DB is LIVE — clean up any
   fixtures or sessions you create (audit sessions carry distinctive
   user-agent strings for exactly this).
