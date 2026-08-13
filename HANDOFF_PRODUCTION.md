# HANDOFF_PRODUCTION — deployment and production state

**Written:** 9 August 2026, ~19:00 UTC · **Updated:** 13 August 2026, late
night — **the LB.31–LB.36 / LB.15 / LB.14a–c range IS DEPLOYED** (`d6a56b1`;
see §1. LB.35's migration had been applied earlier the same night as a database
action on its own; the LB.30 deploy is the earlier-night record, LB.27–LB.29
the morning one, and the LB.13–LB.26 deploy + LB.20 migration the 12 August
record below) · **For:**
the next conversation/agent picking this project up. Read this FIRST for anything
touching production; `PROJECT_STATE.md` (platform history),
`BUILDER_HANDOFF.md` (product) and `UIUX_PASS.md` (the UI/UX + mobile passes)
remain the deep references.

---

## 1. CURRENT PRODUCTION STATE

> ### ✔ LB.37 IS DEPLOYED TOO — 13 Aug 2026 (late night)
>
> **`origin/main` is `ab24466`.** The storefront `<head>` fix shipped and was
> confirmed on the SAME throwaway fixture measured before and after the push —
> the cleanest form of this check, because the only variable is the build.
>
> | Page | Before | After |
> |---|---|---|
> | store home | *"LandingOS — Internal tool…"* · `noindex, nofollow` | **"Boutique Nour Élégance"** · `index, follow` · canonical |
> | product | *"Montre en cuir · LandingOS"* · `index, follow` | **"Montre en cuir · Boutique Nour Élégance"** · `index, follow` |
> | category | *"LandingOS — Internal tool…"* · `noindex, nofollow` | **"Montres · Boutique Nour Élégance"** · `index, follow` · canonical |
> | thank-you | platform tagline · `noindex` (inherited) | store name · **`noindex` (declared)** |
> | `/console/login` | platform tagline · `noindex` | **unchanged** |
>
> **The console row is the one that matters most.** It is unchanged, which is
> what proves the fix was applied at the storefront layer rather than by
> weakening the root's fail-closed default — the failure mode a `robots` fix
> invites. Live 2m50s after the push. No migration.
>
> LB.14a's cache markers were re-checked afterwards and are all intact, health
> stayed green, and the fixture was swept with `deleteTenant` (4 rows, 2
> passes; both real tenants untouched). A checkout against that fixture
> correctly answered `UNDELIVERABLE` — it had no delivery prices, and
> "an unpriced wilaya is undeliverable, not free" is a pinned rule.
>
> ### ✔ EVERYTHING BEFORE IT IS DEPLOYED — 13 Aug 2026 (late night)
>
> **`origin/main` is `d6a56b1` and that is what production serves.** The range
> that had been held back, `bd6d664..d6a56b1`, was pushed and verified live;
> the details are in the deploy record below and in CHANGELOG's top entry.
> **No migration pending**, RLS **49/49**.
>
> **`d6a56b1` is the APPLICATION TREE production serves.** This deploy's own
> record commits were pushed on top of it afterwards, so `origin/main`'s head
> is a documentation commit, not the app tree — the two are different things
> and this file has now been wrong about it three times by trying to pin a
> hash. **The invariant, which does not go stale:**
> `git diff origin/main master -- apps packages` returns **empty**, and the
> last commit that changed anything under `apps/` or `packages/` is the
> deployed app tree. Derive both; do not trust a hash typed here.
>
> Pushing docs does trigger a Render rebuild. It was done deliberately and
> watched: 18 checks over 6 minutes, **zero blips** — health green and every
> cache marker intact throughout, which is what a byte-identical app tree
> should look like.
>
> ### ✔ LB.35's MIGRATION WAS APPLIED FIRST — 13 Aug 2026 (night)
>
> **The database and the code moved separately, on purpose** — the column went
> first, alone, and the app code followed in the deploy below. The user
> approved each as its own action.
>
> **Applied to `landingos_prod`:**
>
> ```sql
> ALTER TABLE "LandingPage" ADD COLUMN "trackingIntegrationIds" JSONB;
> ```
>
> **How, in the LB.20 order — and the order is what made it safe:**
> 1. `prisma migrate diff --from-url <prod owner> --to-schema-datamodel` FIRST.
>    It rendered exactly that one statement and nothing else, which is also how
>    we know no other drift had accumulated between the schema and production.
> 2. `prisma db push`, with `Datasource "db": PostgreSQL database
>    "landingos_prod"` read back out of the push's own output — the target is
>    confirmed, never assumed.
> 3. Read back afterwards: `jsonb`, `is_nullable = YES`; the one existing
>    `LandingPage` row holds NULL, which MEANS "fire all of the tenant's active
>    integrations" — what every page did before the column existed.
> 4. `migrate diff` again → *"This is an empty migration."*
>
> **No `apply-rls` run, and the numbers are the evidence:** 49 tables with
> policies, 49 with `relrowsecurity`, before and after. No table was added.
> (That is the one way this differed from LB.20, which moved 48→49.)
>
> Overrides were shell-env only; `packages/db/.env` still names `neondb`. The
> read-only verification script was deleted after use. Health stayed green
> throughout.
>
> ### ✔ THAT RANGE IS NOW DEPLOYED — and two things the old note got wrong
>
> **`origin/main` is `d6a56b1`.** The range was `bd6d664..d6a56b1`:
>
> | Range | What |
> |---|---|
> | `bd6d664..790e4ae` | **LB.31–LB.36** (the six-slice range) + its merge record |
> | `790e4ae..ca1e9b3` | **LB.15** money inputs, **LB.14a** storefront caching, **LB.14b** the duplicate-completeness fix, **LB.14c** the domain-refusal messages, the dev-tenant sweep record, and the deploy/migration records for all of it |
> | `ca1e9b3..d6a56b1` | two documentation commits written after the count below was made |
>
> **CORRECTION 1 — it was EIGHTEEN commits, not sixteen.** This document said
> sixteen and named `ca1e9b3` as master's head; two more doc commits landed
> afterwards. A count written into a handoff goes stale the moment the next
> commit lands — **verify `git rev-parse master` against `origin/main`, never
> trust a number written here.**
>
> **CORRECTION 2 — the range DOES touch `packages/db/prisma`.** This document
> said "nothing in `790e4ae..ca1e9b3` touches `packages/db/prisma` at all",
> which is true of that sub-range but NOT of the full range: `a234d48` (LB.35)
> changes `schema/builder.prisma`. The conclusion still held, but only because
> the column was already applied — and **file paths are the wrong check
> anyway.** The check that settles it is drift:
> `prisma migrate diff --from-url <prod> --to-schema-datamodel` → **"This is
> an empty migration."** Run that, not a `git diff --name-only`.
>
> **NO MIGRATION REMAINS.** RLS **49/49**, verified before and after.
>
> **The marker that confirmed this deploy, kept because it needs no fixture.**
> LB.14a sets `NEVER_CACHE` on the wilayas route's **404** branch, so
> `curl -D - https://landingos.onrender.com/api/storefront/<anything>/wilayas`
> is a complete unauthenticated test of the new code with no tenant, no login
> and no production data: **no header at all** before, `private, no-store,
> max-age=0, must-revalidate` after. It went live 2m38s after the push.
> *Rule reinforced: the best marker is one whose baseline you captured BEFORE
> pushing — take it first, every time.*
>
> ### One local trap this uncovered
>
> `npm run builder:build` regenerates the APP's Prisma client through its own
> prebuild but **not** `packages/db/prisma/client` — a second generated client
> the storefront path uses. After the LB.35 merge it still had no
> `trackingIntegrationIds`, and every published-page render 500'd with
> `PrismaClientValidationError`, showing up as one unrelated-looking red test.
> **After any schema change run `npm run generate --workspace @landingos/db`
> as well.**

- **Deployed commit: `d6a56b1`** (13 Aug 2026, late night, user-approved —
  the range `bd6d664..d6a56b1`, eighteen commits: **LB.31** storefront
  branding, **LB.32** the editor's sticky-header offset, **LB.33** checkout
  field labels, **LB.34** archive/restore, **LB.35** per-page pixel selection,
  **LB.36** the brand scoping note, **LB.15** money inputs, **LB.14a**
  storefront caching, **LB.14b** duplicate completeness, **LB.14c** the
  domain-refusal messages, plus the sweep and record commits).
  **Rollback point: `bd6d6643eab892ad0619fe861eb0a86a48dbdbfb`.**
  **No migration** — proven by `migrate diff` returning an empty migration
  against `landingos_prod`, not by inspecting changed paths (see the
  correction above). Fast-forward, no rebase, no conflicts.
- **Confirmed by a definitive PUBLIC marker that needs no production data:**
  the wilayas 404 `Cache-Control` flip described above, baseline captured
  before the push. Four further header paths moved exactly as
  `next.config.ts` intends — including `/<tenant>/thank-you` answering
  `no-store` rather than the broad rule's `max-age=60`, and the bare root `/`
  keeping the framework default, which are the two traps LB.14a's own commit
  message says it fixed. `/console/*` and `/_next/static` unchanged.
- **Live verification (13 Aug, late night), throwaway tenant
  `lb-dep-check-msrk9u03` on the real domain** — store "Boutique Nour
  Élégance", published page at **2990.50 DZD**, Adrar page-level override
  500/300, an explicit ONE-integration subset against two active
  integrations. **LB.15:** zero `type="number"` across all 34 editor inputs;
  **two ArrowUp presses left 2990.50 unchanged** (the defect stored 2992);
  French `2990,75` previewed `DA 2,990.75`, saved, read back as Decimal
  **2990.75**; an ambiguous value refused, not guessed. **LB.14b:** the copy
  made through the real route carries BOTH `deliveryPrices` and the
  `trackingIntegrationIds` subset. **LB.31:** header and footer name the
  merchant and link to its own root; zero platform strings in the body.
  **LB.32:** header band `[0,56]` at every scroll position, anchored scroll
  lands a card at **96px, 40px clearance** (was −24px). **LB.33:** labels
  wire to stable ids, not ids derived from Arabic text. **LB.34:** archiving
  404s the storefront and the checkout refuses it, **while the order already
  sold survived** (2990.5 + 500 = 3490.5); restore lands on DRAFT.
  **Checkout end-to-end:** a REAL production order totalled **3490.5**,
  priced server-side. **Cleanup with `deleteTenant`:** 12 rows in 2 passes as
  the RLS-scoped `landingos_app` role, fixture user removed separately, every
  scoped count read back **0**, both real tenants untouched, health green.
- **A PRE-EXISTING issue found during this deploy — since FIXED as LB.37,
  which is NOT yet deployed.** A storefront page's `<title>` read
  `<page> · LandingOS` and the storefront inherited the root layout's
  `robots: { index: false, follow: false }` — byte-identical in `bd6d664` and
  `d6a56b1`, so not a regression and outside LB.31's SiteNav/SiteFooter scope.
  **The note first written here was wrong in one way worth keeping:** it
  implied the product page was noindexed. It was not — it had set
  `index: true` since it was written. The pages actually excluded from search
  were the store HOME and every CATEGORY. The claim came from reading the root
  layout and inferring inheritance instead of reading the response, which is
  LB.14a's rule a second time. Fixed in `fcbd1e5` (see CHANGELOG §LB.37).
- *(historical — the state this deploy replaced)* **Deployed commit:
  `4f1b599`** (13 Aug 2026, night, user-approved —
  **LB.30**: the store home, category and thank-you pages wear the store's
  theme instead of the visitor's dark mode; the thank-you inherits the theme
  of the landing page its order came from). **Rollback point: `0f6d743`**
  (the state this deploy replaced). **No migration.** The commit is
  `e940f06` REBASED onto `0f6d743`: the worktree branch and `master` had
  diverged by one commit each (the LB.27–29 deploy-record landed after the
  branch was cut), so the predicted fast-forward was impossible — stopped
  and reported per instruction, then rebased on approval. The conflicts
  were confined to the three shared handoff docs (both sides kept); the
  four code/test files merged clean, so the app tree is byte-identical to
  the one verified locally (storefront 36/36, live-checked both ways).
- **Confirmed by a definitive PUBLIC content marker** — applying the rule
  the last deploy taught (one method, on a page that contains the changed
  code): a real tenant's public store home flipped from no
  `data-landing-theme` in its HTML (baseline read before the push) to
  serving the scope div with `background-color:#FAF9F6`,
  `--background:#FAF9F6` and `color-scheme:light` inline — markup only
  LB.30's code emits on a store home, checked with a single method
  end-to-end. No authed probe was needed: the changed pages are public.
- **Live verification (13 Aug, night), throwaway tenant `lb30-check-*` on
  the real domain:** fixtures created by prod-DB script (subscription +
  a `#141414` "Merchant Night" theme + a themed and an unthemed published
  page + category + Adrar delivery 500/300), then **two REAL orders
  through the production checkout API** (each priced server-side
  **3,400** = 2,900 + 500). Under an emulated dark-OS visitor at 375px:
  the themed order's thank-you wears the MERCHANT's theme
  (`data-landing-theme` = the theme row's id, canvas `rgb(20,20,20)`,
  text `#FAFAFA`) — inherited, not bled; store home and category hold
  `#FAF9F6` with the default scope; the unthemed order's thank-you falls
  back to the default cleanly; the landing page itself still carries
  exactly ONE scope (LB.26 intact), and it visually matches the thank-you
  its checkout lands on. **Cleanup with `deleteTenant`:** 6 rows in 2
  passes (the orders and their status history cascaded with their pages),
  tenant row gone, every scoped count read back **0**.
- *(historical — the 13 Aug morning state this deploy replaced)*
  **Deployed commit: `08e386d`** (13 Aug 2026, user-approved — the range
  `e3939e9..08e386d`: the 12-Aug deploy record commit plus **LB.27** the
  tenant-deletion sweep, **LB.28** the `rtl:` correction, **LB.29** the Sheet
  logical close edge). **Rollback point:
  `e3939e98e6de58ebfada4a9bb38f9764fe1a4031`.** **No migration** — verified
  before pushing that nothing in the batch touches `packages/db/prisma`.
- **How this deploy was confirmed, and the trap it re-taught.** An unauthed
  chunk-fingerprint marker was USELESS here and briefly gave a false
  positive (two different hashing methods compared against each other).
  Recomputed consistently it never changed — correctly, because none of
  these commits touch code reachable from the login page, so its
  content-hashed chunks are byte-identical. Same shape as `90f3d43` in §5.
  **Build identity was proven by CONTENT on an authed page instead:** the
  editor's back arrow carries `rtl:-scale-x-100` and the Sheet close button
  `top-4 end-4`, classes no earlier build emits. *Rule: one method per
  marker, and pick a page that contains the changed code.*
- **Live verification (13 Aug), throwaway tenant on the real domain:** Arabic
  back arrow computes `scale: -1 1`; drawer close button at x 17–33 (inline
  end) at 375 px; checkout end-to-end **3,400** = 2,900 + 500 quoted and
  charged; merged Finances screen (المالية) carries calculator + history +
  charge list + add panel with `/console/erp/finance` 404; orders, products,
  clients 200; health green. **Fixture removed with `deleteTenant` itself** —
  9 product-domain rows swept in 2 passes, zero rows behind, its first real
  production use.
- *(resolved the same night)* The "**⚠ NOT deployed: LB.30**" warning that
  stood here is CLOSED — the user approved the merge with the branch
  situation in view, `e940f06` was rebased onto `0f6d743` as `4f1b599` and
  deployed; see the current-state bullets above. The near-black thank-you
  measured on production that morning is the exact page verified themed
  that night.
- *(historical — the 12 Aug state this deploy replaced)* **Deployed commit:**
  `e3939e9` (12 Aug 2026, evening — the full local range
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

> **Everything in this table IS deployed, and as of 13 Aug 2026 (late night)
> nothing is waiting.** `origin/main` = local `master` = `d6a56b1`.

| Commit | What it is |
|---|---|
| `bd6d664..d6a56b1` | **13 Aug 2026 (late night): LB.31–LB.36 + LB.15 + LB.14a/b/c** — storefront branding, the editor's sticky-header offset, checkout field labels, archive/restore, per-page pixel selection, the brand scoping note, money inputs, storefront caching, duplicate completeness, the domain-refusal messages. Eighteen commits, fast-forward, no migration (proven by an empty `migrate diff` against `landingos_prod`). Confirmed by a public `Cache-Control` flip on the wilayas 404 — a marker needing no fixture — plus a throwaway tenant driven through the editor, a duplicate, an archive/restore and a real checkout |
| `0f6d743..4f1b599` | **13 Aug 2026 (night): LB.30** — the store home, category and thank-you pages wear the store's theme (thank-you inherits its order's landing-page theme; home/category wear the default — a store-level theme field stays an open product decision). `e940f06` rebased onto the deploy-record commit; docs-only conflicts. No migration. Verified by a public content marker (the theme scope appearing on a real tenant's store home) + a throwaway tenant with two real API orders, themed and unthemed, under an emulated dark OS |
| `e3939e9..08e386d` | **13 Aug 2026: LB.27–LB.29** — the `deleteTenant` sweep (a tenant delete used to orphan every product-domain row; 73,267 of them had accumulated in dev), the `rtl:` record correction + editor back-arrow flip, and the Sheet's logical close edge. No migration. Verified by authed content markers + a full throwaway-tenant journey |
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

10. **Added 13 Aug (late night), all measured this session, none started:**
    - **LB.14a.2 — one front door per tenant identity.** The only way to make
      storefront pages genuinely cacheable. Today a custom domain wins over a
      path prefix, so every render reads the `Host` header and ISR is
      structurally unavailable — `revalidate` on those routes is INERT while
      looking deliberate (measured: the build still emits `ƒ (Dynamic)`, no
      warning). Scoped in `NEXT_STEPS.md` §LB.14a.
    - **`TenantDomain.isPrimary` is a writer with no functional reader.** The
      editor's Copy Link builds from `window.location.origin` — the CONSOLE's
      host — so a merchant with a verified primary domain still copies a
      platform link. **Deliberately NOT fixed**: until a hostname actually
      reaches Render, pointing Copy Link at it swaps a working link for a 403.
    - **The builder's money routes still parse with `z.coerce.number()`.** A
      latent D-06 violation rather than a live defect (every typeable price
      round-trips a double exactly, and server-side arithmetic is already
      Decimal). Changing it needs every caller measured — checkout, catalogue
      publish, webhooks, CSV import.
    - **`apps/website-builder/prisma/schema.prisma` is a drifted 570-line
      legacy schema** whose generated client is imported for TYPES only
      (`lib/landing/mappers.ts`), and `ignoreBuildErrors` means the drift
      cannot fail a build. Deleting it is a small slice that touches the
      prebuild and LB.9's Docker client-generation step.
    - **216 historical test tenants in `neondb`** (dev only, 2–10 Aug,
      pre-LB.27 hooks, zero orphans). Count and command in `NEXT_STEPS.md`.

## 6. TESTING STATUS

**Re-run per file against the FINAL local build, 13 Aug 2026 (late night) —
all green:** builder-sections **74** · storefront **48** · builder-api **35** ·
hardening **13** · calc **28** · console-shell **20** · tracking **15** ·
webhooks **10** · platform/domains **14** · platform/team **63** ·
platform/workspace **4** · platform/sessions **2** · i18n **22** ·
packages/db **35**. (ERP suites untouched this session: erp/screens 172,
erp/finance 44, erp/catalog 75, erp/access 205, erp/ai 31,
product-registry 36.)

Two reds re-verified green, both the documented Neon transient — `packages/db`
2/35 and `platform/team` 1/63, each passing alone. **One red was NOT
transient and is the rule to remember:** builder-sections failed a
published-page render with `PrismaClientValidationError: Unknown field
trackingIntegrationIds`, because `builder:build` regenerates the app's Prisma
client and **not** `packages/db/prisma/client`. Run
`npm run generate --workspace @landingos/db` after any schema change.

*(historical, kept for the record)*

**Tested locally (green, per file, against the a42676b build):**
console-shell **19/19** · platform/team **63/63** · erp/screens **173/173** ·
erp/notifications **48/48** · builder-sections **50/50** · builder-api
**23/23** · hardening **12/12** · i18n **20/20**. (Local reruns absorbed
several documented Neon P1001 transients — judge suites per file, rerun
before believing a red.)

**Verified in production, 13 Aug (late night), on the `d6a56b1` build:**
the wilayas-404 `Cache-Control` flip (baseline captured pre-push) · four more
header paths incl. thank-you `no-store` and the bare root keeping the framework
default · a real published page at `private, max-age=60` · **zero
`type="number"` across 34 editor inputs; two ArrowUp presses leaving 2990.50
intact; `2990,75` saved and read back as Decimal 2990.75** · a duplicate
carrying both `deliveryPrices` and `trackingIntegrationIds` · storefront brand
naming the merchant with zero platform strings in the body · editor header band
`[0,56]` with 40px anchored-scroll clearance · checkout labels wired to stable
ids · archive 404ing the storefront and refusing checkout while its existing
order survived · a REAL order at **3490.5** priced server-side · `deleteTenant`
sweeping 12 rows in 2 passes to zero, both real tenants untouched.

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
3. **Confirm `origin/main` still equals `d6a56b1`** (`git fetch && git log
   --oneline origin/main -1`) — if it moved, someone else deployed; re-read
   the situation before assuming this document's state. **Local `master` is
   in sync with `origin/main` at `ab24466` — LB.37 shipped too. The check that
   tells you whether anything is waiting:
   `git diff origin/main master -- apps packages`. Empty means no application
   code is queued; non-empty means something is.** Do not trust the commit
   COUNT any
   handoff quotes — this one said "sixteen" and the real answer was eighteen
   by the time it was read. Derive it: `git rev-list --count origin/main..master`.
   The stale worktree at `.claude/worktrees/interesting-herschel-ceeb8f` sits
   at `fecc4ff`, an ancestor of master — fully merged, and it still holds its
   own stale copies of these docs saying "not deployed". It can be removed.
4. **Nothing is queued to deploy.** LB.31–LB.36 + LB.15 + LB.14a/b/c
   (`bd6d664..d6a56b1`) and then LB.37 (`fcbd1e5`) both shipped on 13 Aug
   (late night) and are verified live — §1 has the records, the markers and
   the corrections they produced. No migration is pending; RLS is 49/49.
5. **Know the decisions owned by the user**, none of which may be started
   unprompted:
   - the `erp-serveur` decommission (dashboard action);
   - **custom domains: they are complete in the app and INERT in production**
     until each hostname is added to the Render service so it issues a
     certificate — three options written up in `NEXT_STEPS.md` §LB.14c, with
     a recommendation. `landingos_prod` holds 0 `TenantDomain` rows, so
     nobody is affected yet;
   - **page version history** (`NEXT_STEPS.md` §LB.14b) — needs one additive
     table, so RLS 49 → 50, and three product decisions;
   - LB.36 brands, LB.23 Facebook Ads (blocked on a Meta app), LB.24 AI
     generator;
   - the 216 historical test tenants still in `neondb` (dev only) — the count
     and the one command are in `NEXT_STEPS.md`.
6. The most valuable next engineering work, if the user asks "what now":
   the storefront JS diet (~1.29MB on customer phones, §5.4) or **LB.14a.2,
   "one front door per tenant identity"** — the front-door split that would
   make storefront pages genuinely cacheable. LB.14a measured that ISR is
   *structurally unavailable* today, not merely unconfigured: a custom domain
   wins over a path prefix, so every storefront render reads the `Host`
   header, and a `revalidate` export on those routes is inert while looking
   deliberate.
6. The demo login for local browser work is documented in the project memory
   (`owner@demo.test`, demo tenant) — it exists in `neondb` (dev/tests) ONLY;
   production (`landingos_prod`) has no demo accounts and must stay that way.
   Never seed demo/test fixtures into `landingos_prod`; local fixtures in
   `neondb` still get cleaned up after scripted checks.
