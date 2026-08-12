# HANDOFF_PRODUCTION — deployment and production state

**Written:** 9 August 2026, ~19:00 UTC · **Updated:** 12 August 2026 (the
LB.13–LB.26 deploy + the LB.20 production migration — see §1) · **For:** the
next conversation/agent picking this project up. Read this FIRST for anything
touching production; `PROJECT_STATE.md` (platform history),
`BUILDER_HANDOFF.md` (product) and `UIUX_PASS.md` (the UI/UX + mobile passes)
remain the deep references.

---

## 1. CURRENT PRODUCTION STATE

- **Deployed commit:** `e3939e9` (12 Aug 2026, evening — the full local range
  `b767928..e3939e9`, 20 commits: LB.13 editor i18n, LB.16–LB.22 the feature
  pass incl. per-product delivery pricing, LB.25 the Finances/Calculator
  merge, LB.26 the storefront theme-bleed fix). **The commit REPLACED was
  `b7679284bfd71ea666a5f3d13973a9b769ba828f`** — the rollback point if one is
  ever needed (a rollback past it also needs the older apply-rls, per the
  §5 coupling note).
- **The LB.20 migration WAS APPLIED to production first, in order:** the DDL
  was previewed with `prisma migrate diff` against `landingos_prod` (exactly
  the one `LandingDeliveryPrice` table, no other drift), pushed via the owner
  role on the direct endpoint (`Datasource … "landingos_prod"` confirmed in
  the push output), then `apply-rls` — **49/49 on all four checks** (was
  48/48) — and the table confirmed present with **0 rows** before the app
  push. The env overrides were shell-only; `packages/db/.env` still points at
  `neondb`.
- **Deploy verified from outside, then in a real browser** (12 Aug): the
  unauthed marker `/console/erp/finance` flipped 307-to-login → **404**
  (LB.25 deleted the page; only the new build answers that) with
  `/console/erp/calculator` still 307; health green
  (`database ok · 58 wilayas · isolation rls · uploads r2`). Then a
  throwaway tenant (`dv-aug12-check`) driven through the REAL journey on the
  live domain: signup → page published → tenant delivery price (Adrar
  500/300) → checkout **3,400** (2,900 + the tenant default) → a per-page
  override of 900 set in the editor's Shipping section → quote **3,800** =
  charge **3,800** on the stored order (D-LB.20.1 live in production) → the
  LB.26 check with an emulated dark-OS visitor (page holds its theme;
  `html.dark` stamped and ignored inside the scope) → the merged Finances
  screen 200 with history + charge list, orders present, category control on
  products, client-detail breadcrumb. **All fixtures deleted after**,
  including an orphan sweep (see the finding below).
- **Finding from the cleanup, worth its own slice:** `tenant.delete` cascades
  platform rows but NOT product-domain rows — they carry `tenantId` as an
  RLS-scoped column, not an FK to Tenant — so deleting the throwaway tenant
  left its LandingPage/SalesOrder/Client/… rows orphaned until swept by
  tenantId across all 49 scoped tables. Any future tenant-deletion feature
  (or test cleanup) must do the same sweep; the dev harness's
  `tenant.deleteMany` has been leaving the same orphans in `neondb`.
- *(historical — the 10 Aug state this deploy replaced)* Deployed commit
  `86a4e90`, verified by the domains-screen marker flips; the
  `tenant_isolation_verified` policy applied to `landingos_prod` (48/48) and
  proven both ways with a throwaway tenant, fixture deleted after.
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
| `b767928..e3939e9` | **12 Aug 2026 (evening): the LB.13–LB.26 range** — editor i18n (LB.13), dead-component deletion (LB.16), ERP detail back-nav (LB.17), the finance module switch (LB.18), product categories (LB.19), **per-product delivery pricing (LB.20, with its production migration applied first)**, catalogue publishing (LB.21), image-derived themes (LB.22), the Finances/Calculator merge (LB.25), the storefront theme-bleed fix (LB.26) |
| `5ac85b0` | The UI/UX pass: builder overview rebuilt, table headers, editor variant-label + unsaved-state fixes, ERP order summary strip, notification timestamps, locale switcher auto-submit (~60 i18n keys) |
| `4470c50` | Mobile UX fixes (filter-bar mobile collapse, orders-table mobile columns, strip static on phones, tap targets, storefront select sizing) + the **RLS boot/health guard** |
| `8c23746` | Mobile drawer + toast portals — the header's `backdrop-blur` made it the containing block for `fixed` descendants; the drawer was pinned to a 55px box |
| `acbc96a` | Bare domain root `/` → 307 `/console`; a verified custom domain's root goes to its own storefront |
| `a42676b` | Mobile language switcher (drawer instance, `id="locale-mobile"`) + bulk bar `md:sticky` + the five stale-tenant session fixes with regression tests |

## 3. IMPORTANT PRODUCTION INFRASTRUCTURE STATE

- **Database (since 10 Aug 2026):** production uses the DEDICATED
  `landingos_prod` database on the same Neon cluster
  (`ep-summer-shadow-…`, eu-central-1), connected as `landingos_app` via the
  pooler. **Local dev and the contract suites stay on `neondb`** — the shared
  fixture/dev database no longer serves production. `neondb` was left
  untouched (rollback = revert Render's `DATABASE_URL` path to `/neondb`).
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

## 4. SEPARATE PRODUCTION DATABASE (EXECUTED 10 Aug 2026 — clean start)

**This section's plan was carried out on 10 August 2026 with the user's
explicit approval, using the clean-start option.** What happened, in order:

1. `_provision-prod-db.ts` ran: `landingos_prod` created on the same cluster,
   `landingos_app` granted on existing + future objects, role verified
   NOBYPASSRLS/NOSUPERUSER. The script was deleted afterwards, per its own
   "throwaway (deleted after use)" contract (its content survives in the
   9–10 Aug session records).
2. `prisma db push` (exit 0, datasource confirmed `landingos_prod`), then
   `apply-rls` (48/48 tenant-scoped tables, USING + WITH CHECK, FORCE; the 5
   expected unscoped tables), then `seed:reference` (58 wilayas / 537
   baladias). **No `seed:demo` — the database started clean.**
3. The full isolation preflight ran against the new database with the real
   role split — every check PASS (deny-by-default, per-transaction scoping,
   writes constrained, no connection leakage), scratch schema dropped.
4. Final state read as the app role itself: `landingos_app@landingos_prod`,
   0 tenants, 0 users, 58/537 reference rows.
5. The user changed Render's `DATABASE_URL` path from `/neondb` to
   `/landingos_prod` (credential, host, params unchanged). A startup hiccup
   during the switch was resolved by the user; the end state was then
   verified from outside (§6).
6. **Post-switch verification:** health green incl. `isolation: rls`; root
   `/` → 307 `/console`; unauthed `/console` → login; login + signup pages
   200 with the full form; signup API validates (422 on empty body, writes
   nothing); `ar`→RTL / `fr`→LTR served correctly; and the database-identity
   proof — `/acme` and `/demo`, both previously-live storefronts, now 404.

**Consequence of clean start:** the demo/acme tenants and every account that
existed in `neondb` do NOT exist in production. Real tenants enter through
`/console/signup`. Nothing was migrated and nothing was deleted from `neondb`.

The original rationale and preparation notes are kept below for the record.

### (historical) The original proposal, as prepared on 9 Aug

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

**(historical)** At the time of the 9-Aug writing, none of this had run and
the instruction was to wait for explicit approval plus the migrate-or-clean
decision. On 10 Aug the user gave both (approval + **clean start**), and the
plan above was executed exactly as written.

## 5. REMAINING WORK (in rough priority order)

**10 Aug (overnight session): `CAPABILITY_AUDIT.md` was written and its
queue executed — LB.12 Benefits/FAQ, the display toggles, categories UI,
tenant storefront identity, custom domains, workspace defaults, sessions
screen — eight local commits (`ee896b4..6f3a1b4`), each measure→fix→test→
live-verify→commit. NONE of it is deployed (deploys were off-limits).
SHIPPED 10 Aug ~01:45 UTC with the user's explicit go-ahead: pushed
`1cd499e..86a4e90`, deploy verified by marker flips, then `npm run rls`
against `landingos_prod` (TenantDomain line + 48/48), then the both-ways
storefront-resolution probe with a throwaway tenant. The audit's §2
removals and §4 decisions (incl. B7 version history, which DOES need a new
table + prod `db push`+RLS run) remain open and user-owned. One
observation from the probe, recorded for the hardening queue: Render's
edge passes a CLIENT-sent `X-Forwarded-Host` through to the app, and
`currentHost()` trusts it.**

> ### ⚠ PRODUCTION IS ONE COMMIT BEHIND ON RLS — read before any domain work
>
> The host-trust fix (committed locally, NOT deployed) also corrects a defect
> in the `tenant_isolation_verified` policy that **was applied to
> `landingos_prod` on 10 Aug**. The first version,
> `USING ("verifiedAt" IS NOT NULL)`, has no binding guard — and because
> Postgres ORs permissive policies, it adds every verified domain row to what
> **every tenant-bound read** returns, not just the pre-tenant lookup. A
> tenant owning nothing saw another tenant's hostname (measured in dev).
>
> **Actual production exposure today: none** — `landingos_prod` holds 1
> tenant and 0 TenantDomain rows, so there is nothing to leak, and the
> console's domains screen has no rows to widen. The window closes the moment
> anyone links a second domain.
>
> **CLOSED 10 Aug (user-approved):** `90f3d43` pushed to `origin/main`, and
> `npm run rls` re-run against `landingos_prod`. The live policy is now
> `USING (("verifiedAt" IS NOT NULL) AND (current_setting('app.domain_lookup',
> true) = 'on'))`, verified by reading `pg_policies` from production, and the
> behaviour was proven there with throwaway tenants (stranger's bound read
> `[]`, owner still sees its own row, pre-tenant lookup still resolves).
> Nothing had leaked: production held **0 verified rows** throughout, and the
> policy only ever opened verified ones.
>
> ### ⚠ ONE COUPLING THE NEXT SESSION MUST KNOW
> The guarded policy and the new build are a **matched pair**. The policy
> opens a verified row only inside `withVerifiedDomains()`, which exists only
> in `90f3d43`. If a build older than that is ever served (rollback, failed
> deploy), custom domains resolve to NOTHING — safe, but silently dead.
> **A rollback past `90f3d43` therefore requires re-running the previous
> apply-rls too, or custom domains break.**
>
> The deploy of `90f3d43` could NOT be confirmed by external probe, and the
> reason is worth recording: every change in it is server-side (client bundle
> byte-identical), and the corrected policy independently produces the same
> answer to the spoof probe that the fixed build does. The definitive check
> is the first real verified custom domain — if it serves its storefront, the
> build is current.

1. ~~Separate production database~~ — **DONE 10 Aug 2026** (§4, clean start).
2. **Decommission `erp-serveur`** — user's dashboard; suspend → verify
   nothing breaks → delete.
3. **Route-level loading states (UI.6)** — DONE locally 10 Aug
   (`UIUX_PASS.md` §15): shell into segment layouts + a client-driven pending
   skeleton (deliberately NOT `loading.tsx`, which would stream every
   screen-level `notFound()` into a 200 — a pinned information-disclosure
   contract). Product layouts gate entitlement; a new console-shell test pins
   the chrome-free 404 body (suite 20/20); skeleton verified live in LTR and
   RTL (geometry measured). Committed locally; deployed only when the repo
   history says so.
4. **Storefront JS diet** — the public landing page ships ~1.29MB of JS
   (more than the console); framer-motion and the template bundle are the
   suspects. This is the customer-facing surface on Algerian mobile networks.
5. **Deploy `services/worker`** when scheduled ERP jobs are wanted in
   production (needs `WORKER_SECRET` on both sides).
6. **Editor i18n (LB.13) — DONE 11 Aug, DEPLOYED 12 Aug (evening).** Seven
   commits (`43b55c6..` through the guard). `EDITOR_I18N.md` is the full
   record: the corrected measurement, a per-slice log with the live evidence,
   and §3's four open decisions. Suites green per file (i18n 22/22 including a
   new guard that fails on any hardcoded editor string, builder-sections
   58/58, console-shell 20/20, storefront 32/32); verified in `ar` and `fr`
   against the running app; **nothing written to the database.**
   Two things a deployer should know: it edits `packages/i18n` (shared by
   every screen) and `components/ui/{dialog,sheet}` (shared by every dialog),
   and it touches the storefront's `purchase-form.tsx` — two Arabic labels now
   read from one shared constant, covered by storefront 32/32.
   **LB.16 (12 Aug) deleted the ten dead legacy components** LB.13's
   measurement found — `EDITOR_I18N.md` §4. Every builder screen re-verified
   live at 200; all eight builder suites green.
7. **Feature pass (12 Aug) — DEPLOYED 12 Aug 2026 (evening), user-approved.**
   `FEATURE_PASS_AUG12.md` is the record: seven slices (LB.16–LB.22), nine
   defects found and fixed on the way, and the two requested features
   deliberately NOT built, with the reasons.

   > ### ✔ LB.20's MIGRATION WAS EXECUTED — 12 Aug 2026, user-approved
   >
   > **The hold was lifted by explicit approval and the migration ran against
   > `landingos_prod` BEFORE the app deploy, in the documented order:** DDL
   > previewed with `migrate diff` (exactly the one table, no other drift),
   > `prisma db push` with the datasource confirmed `landingos_prod` in its
   > output, then `apply-rls` — **49/49 on all four checks**, as predicted —
   > and `LandingDeliveryPrice` confirmed present and EMPTY before the push
   > to `origin/main`. Overrides were shell-env only; `packages/db/.env`
   > still names `neondb`. The quote=charge property was then verified in
   > production with a real order (§1).

   **LB.25 (a later 12 Aug session — DEPLOYED 12 Aug, evening):** the
   Finances screen merged into the Calculator — `/console/erp/finance`
   deleted (it 404s in production now, and is the deploy's marker),
   `/console/erp/calculator` is the finance module's one screen, titled
   Finances, carrying the one-off expense form + list and the
   current/superseded marker. Record: CHANGELOG §LB.25.

   **LB.26 (same session — DEPLOYED 12 Aug, evening):** the theme-bleed fix —
   a published landing page rendered the VISITOR's OS dark mode instead of
   its own theme. Verified in production with an emulated dark-OS visitor on
   a real published page. Record: CHANGELOG §LB.26.

8. **Decided but NOT started, both waiting on something (12 Aug decisions):**
   - **LB.23 — Facebook Ads linking.** Decided to build REAL ad-spend
     attribution via a Meta app + OAuth, not merely store an account id.
     **Blocked on the user creating a Meta Developer App:** Marketing API
     product, App ID/Secret, redirect URI, `ads_read`, possibly App Review /
     Business verification. Untestable here by construction — the same gate
     LB.11 records. Full scoping: `FEATURE_PASS_AUG12.md` §5.
   - **LB.24 — AI landing page generator.** Deliberately on hold, not started.
     The `AiProvider`/`AiAgent` infrastructure exists and `ai/chat` is a
     deliberate 501; the shape it would take is recorded in
     `FEATURE_PASS_AUG12.md` §5.

9. From the audits, still open: notification write-time i18n, analytics
   comparisons (PM.10), builder list pagination, LB.11 real-credential
   tracking smoke test (still gates real ad spend), UI.7 settings i18n
   residue, calculator step structure (UI.8), bulk-bar mobile collapse (it
   scrolls away now but is still a tall card when reached), and the three
   decisions in `EDITOR_I18N.md` §3 (the dead `rtl:` Tailwind variant,
   `ui/sheet.tsx`'s physical close-button edge, the redundant French shipping
   gloss). **Benefits/FAQ (LB.12) is DONE** — it was left on this list in
   error and is removed here.

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
3. **Confirm `origin/main` still equals `e3939e9`** (`git fetch && git log
   --oneline origin/main -1`) — if it moved, someone else deployed; re-read
   the situation before assuming this document's state. (One local docs
   commit recording this deploy sits on `master` ahead of `main`,
   deliberately unpushed.)
4. **Know the open decision owned by the user:** the `erp-serveur`
   decommission. (The separate-database decision was resolved and executed
   10 Aug — §4.) It may not be started unprompted.
5. The most valuable next engineering work, if the user asks "what now":
   UI.6 loading states (perceived speed) or the storefront JS diet (customer
   phones) — both scoped in §5.
6. The demo login for local browser work is documented in the project memory
   (`owner@demo.test`, demo tenant) — it exists in `neondb` (dev/tests) ONLY;
   production (`landingos_prod`) has no demo accounts and must stay that way.
   Never seed demo/test fixtures into `landingos_prod`; local fixtures in
   `neondb` still get cleaned up after scripted checks.
