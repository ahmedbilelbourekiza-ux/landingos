# Changelog

Work driven by the engineering audit of 1 August 2026. Findings are referenced
by their audit IDs (`SEC-01`, `BUG-02`, `PERF-01`, …). From Phase 3 onward,
work follows the LandingOS platform architecture and references its migration
and risk IDs (`M-01`, `R-08`, …).

Format: newest first. Each entry records **what** changed, **why**, the **files**
touched, any **migration**, and any **risk**.

---

## Phase LB — the Landing Page Builder becomes a commercial product

- **LB.33** The checkout form's "invalid on arrival" report, measured — and
  the defect that was actually there (13 August 2026 — **local only, not
  pushed, not deployed**).

  **The reported bug does NOT reproduce, and the mechanism says why.** A
  fresh, untouched purchase form was measured on the published page and in
  the editor's preview drawer, at desktop and at 375px: the name input
  carries `aria-invalid="false"` with the theme's neutral `#E5E7EB`
  border, matches neither `:invalid` nor `:user-invalid`, and has no
  `required` attribute (the form is `noValidate`, so the browser never
  applies its own validity styling either). The Tailwind variant compiles
  to `[aria-invalid=true]` — read out of the served stylesheet rather
  than assumed — so the literal `"false"` React renders cannot match it.
  The red border IS real, and correct: after an empty submit the same
  input goes `aria-invalid="true"` with `#f87171` and the Arabic message.
  It arrives on submit, not on arrival, so the capture almost certainly
  followed a submit attempt.

  **What the investigation did find.** `Field` derived its label's
  `htmlFor` from the label TEXT — `label.replace(/\s+/g,"").toLowerCase()`
  turned "الاسم الكامل" into `الاسمالكامل` while the input's id is
  `fullName`. **Not one field in the checkout form had a working label:**
  measured `fullName.labels.length === 0`. Tapping a label did not focus
  its input, and assistive technology announced every input unnamed — on
  the only form in the product that takes money. The labels are
  merchant-authored and translated, so an id derived from them could
  never match a fixed id; `htmlFor` is passed in explicitly now, and the
  two destination selects gained the ids they never had.

  **Verified live** on the build carrying it: fresh form still neutral,
  and `fullName`, `phone`, `wilaya`, `notes` each report exactly one
  associated label (all were 0), with no dangling `for`. Two tests pin
  both halves — no field invalid on a freshly served form, and every
  label pointing at a control that exists. storefront 38 → **40**.

- **LB.32** The editor's sticky header stops covering the content below it
  (13 August 2026 — **local only, not pushed, not deployed**).

  **The root cause is a stale offset, not a z-index or a padding.** The
  workspace header carried `sticky top-16` — a 64px offset that exists to
  clear a console shell header ABOVE it. There is no such header on this
  screen: the editor is deliberately mounted OUTSIDE `ConsoleShell` (its
  page comment says so, and the shell lives in the `(shell)` route group
  this route is not in), so the header is the first child of the page and
  its natural flow position is 0.

  **What that produced, measured before the change.** Sticky elements do
  not reserve space for their offset, so the content flowed from y=56
  (immediately after the header's 56px flow box) while the header PAINTED
  at 64→120. The result was a permanent 64px band in which the header sat
  on top of the content at every scroll position, plus dead space above
  it that belonged to nothing. At scroll 0 the first section card's own
  header was already 21px underneath it.

  **A second reading agreed with the diagnosis before anything changed:**
  the section cards carry `scroll-mt-24` (96px), which clears a header
  ending at 56 with 40px to spare and lands content 24px UNDERNEATH one
  ending at 120. The scroll margin had been authored for `top-0` all
  along.

  **The fix is `top-0`** — one class, the only `sticky top-16` in the
  source. Verified live at four scroll positions: the header band is now
  [0, 56] with content starting at 56 and no permanent overlap, and an
  anchored scroll lands a section card at 96px with **40px clearance**
  (previously −24px, i.e. beneath the header). No layout arithmetic
  elsewhere depends on the old value.

- **LB.31** A storefront never wears the platform's identity (13 August
  2026 — **local only, not pushed, not deployed**).

  **Reported** as "the live preview shows LandingOS in the header and
  clicking it goes back to the platform". Measured, it was not confined
  to the preview.

  **Two independent paths to the same leak.** (1) `SiteNav`/`SiteFooter`
  fell back to the platform `<Logo />` whenever `store` was null — and
  the storefront built `store` as `store ? {…} : null`, so ANY tenant
  without a `StoreSettings` row shipped a customer-facing page branded
  `LandingOS`, linking to `/`, which 307s to the platform's own console.
  The footer additionally printed the platform's INTERNAL description
  ("Internal tool for building high-converting COD product landing
  pages.") and `© LandingOS`. (2) `StoreSettings.storeName` is NOT NULL
  with `@default("LandingOS")`, so an untouched row holds the platform's
  name as a literal — and the existing `storeName ?? tenant.name` could
  never fire, because the column is never null.

  **Urgency, measured rather than assumed.** Read-only against
  `landingos_prod`: **both production tenants have `settings: null`**,
  and one already holds an unpublished page. Zero published pages today,
  so no real customer has seen it — but it was one publish away, which
  is why this is a live-risk fix and not a preview cosmetic.

  **The fix.** `resolveStoreName` (new,
  `lib/storefront/store-identity.ts`) treats an absent row and an
  untouched default as the same thing and answers with the tenant's own
  name. The storefront now builds a store identity ALWAYS. The platform
  fallbacks are deleted from both components — a storefront that cannot
  name its merchant shows no brand line rather than the platform's. The
  brand links to the tenant's own storefront root; in the editor's
  preview drawer `homePath` is null and it renders as a plain span,
  because a live link inside a preview navigates the merchant out of
  their own editor. The drawer now receives the store identity at all
  (it passed none, which is why the merchant saw it first).

  **A test that asserted the defect** is replaced: "a tenant with no
  settings row keeps the platform fallback" required a brandless page to
  render no brand, and the template's answer to that was the platform's
  wordmark. Its replacement asserts the tenant's own name. New coverage
  pins the wordmark, the internal description, the platform copyright
  and the `/` link out of the storefront, using the fixture tenant that
  never gets a settings row.

  **Verified live** against the build carrying it: a throwaway tenant
  shaped exactly like production (no settings row) serves its own name,
  a brand linking to its own storefront, and none of the three platform
  strings; the preview drawer shows "Acme Trading" as a non-clickable
  span with zero "LandingOS" text anywhere in it. storefront 36 → **38**.
  No schema, route or API change.

- **DEPLOY — LB.30 reaches production** (13 August 2026, night,
  user-approved). Supersedes the "local only" note on the LB.30 entry and
  closes the "Not in this deploy: LB.30" caveat of the morning's record.

  **What.** `0f6d743..4f1b599` pushed to `origin/main`; Render
  auto-deployed. **Rollback point: `0f6d743`.** No migration. The commit
  is `e940f06` **rebased** onto `0f6d743`: branch and master had diverged
  by one commit each (the morning's deploy-record commit landed after the
  branch was cut), so the predicted fast-forward was impossible — stopped
  and reported first, rebased on approval. Conflicts were confined to the
  three shared handoff docs, resolved by keeping both records; the four
  code/test files merged clean, so the deployed app tree is byte-identical
  to the one verified locally (storefront 36/36).

  **Confirmed by a public content marker — one method, on a page that
  contains the changed code** (the morning's rule, applied): a real
  tenant's public store home read WITHOUT `data-landing-theme` in its HTML
  before the push (baseline), then polled until it served the scope div
  with `background-color:#FAF9F6` / `--background:#FAF9F6` /
  `color-scheme:light` inline — markup only LB.30 emits on a store home.
  No fingerprint hashes, no authed probe: the changed pages are public.

  **Verified live** with a throwaway tenant (`lb30-check-*`): fixtures by
  prod-DB script, then two REAL orders through the production checkout
  API (each priced server-side **3,400** = 2,900 + 500). Emulated dark-OS
  visitor at 375 px: the themed order's thank-you wears the MERCHANT's
  `#141414` theme (scope id = the theme row) — inherited, not bled; store
  home and category hold the `#FAF9F6` default; the unthemed order's
  thank-you falls back cleanly; the landing page still carries exactly one
  scope (LB.26 intact) and matches the thank-you its checkout lands on.
  **Cleanup:** `deleteTenant` — 6 rows in 2 passes (the orders and their
  status history cascaded with their pages), tenant row gone, all scoped
  counts read back 0.

- **DEPLOY — LB.27, LB.28, LB.29 reach production** (13 August 2026,
  user-approved). Supersedes the "local only" notes on those three entries.

  **What.** `e3939e9..08e386d` (4 commits: the 12-Aug deploy record plus the
  three slices) pushed to `origin/main`; Render auto-deployed. **Rollback
  point: `e3939e98e6de58ebfada4a9bb38f9764fe1a4031`.** No migration — verified
  before pushing that neither this batch nor the pending LB.30 touches
  `packages/db/prisma`; the only `packages/db` changes are the new helper
  source and its tests.

  **The marker lesson, recorded because it nearly produced a false
  confirmation.** The first check compared a PowerShell-computed chunk-hash
  fingerprint against a bash-computed one built from a different string, and
  "flipped" instantly — an artifact of my own two methods, not a deploy.
  Recomputed consistently, the fingerprint was **unchanged**, and correctly
  so: none of these commits touch code reachable from the login page, so its
  content-hashed chunks are byte-identical. This is the `90f3d43` situation
  from §5 again — **a build whose changes are all server-side or auth-gated
  cannot be confirmed by an unauthed probe.** The rule this adds: *compute a
  marker with ONE method, and pick a marker on a page that actually contains
  the changed code.*

  **Build identity was then proven by content**, on the authed editor: the
  back arrow carries `rtl:-scale-x-100` (LB.28) and the Sheet close button
  carries `top-4 end-4` (LB.29) — classes that exist in no earlier build.

  **Verified live** with a throwaway tenant on the real domain: in Arabic the
  back arrow computes `scale: -1 1` and the drawer's close button sits at
  x 17–33 (inline end) at 375 px; checkout end-to-end **3,400** = 2,900 + 500
  quoted and charged; the merged Finances screen (titled المالية) carries the
  calculator, history, charge list and add panel, with `/console/erp/finance`
  still 404; orders/products/clients all 200; health green throughout.

  **LB.27 proved itself in production** doing the cleanup: `deleteTenant` swept
  the fixture's 9 product-domain rows (Membership/Subscription/AuditEvent
  cascaded with the Tenant row) across 2 passes, leaving **zero rows** — the
  first real use of the helper, on the defect it was written for.

  **Not in this deploy: LB.30.** It is committed on
  `claude/interesting-herschel-ceeb8f` (worktree), not on `master`, so it was
  not deployable as part of this push. Measured on production afterwards, the
  gap it closes is still open and now precisely documented: under an emulated
  dark-OS visitor the landing page holds its theme (`#FAF9F6`, LB.26) while
  the **thank-you page has no theme scope and renders a near-black canvas**
  (`lab(2.48 …)`) — the last step of a real checkout journey.

- **LB.30** The rest of the storefront wears the store's theme, not the
  visitor's dark mode (13 August 2026 — **deployed to production the same
  night**, see the deploy entry above).

  **The remainder LB.26 recorded and did not build.** The theme-bleed fix
  scoped only pages rendered through `LandingTemplate`; the store home,
  the category page and the thank-you page still rendered console Tailwind
  tokens with no scope. Measured live first (emulated dark OS, mobile
  viewport): all three painted the console `.dark` canvas — body
  near-black (lab L≈2.5) with near-white text — and the thank-you sits
  directly in the checkout journey, so a dark-phone customer bought on a
  light themed page and landed on a near-black confirmation.

  **The design decision, taken in two halves.** The THANK-YOU inherits the
  theme of the landing page its order came from (`order.landingPage.theme`
  → `toThemeData`, the same mapper the landing route uses): the
  confirmation is the last step of the checkout journey and should look
  like the page the customer just bought on, falling back to
  `DEFAULT_THEME` exactly as an unthemed landing page does. HOME and
  CATEGORY wear `DEFAULT_THEME`: `StoreSettings` has no theme field, and
  growing one is a platform schema migration plus a merchant-facing
  control — a product decision deliberately NOT smuggled into this slice.
  The provider call sites carry the note, so a store-level theme slots in
  at exactly two places when it is decided.

  **The mechanism is the existing one** — each page wraps its `<main>` in
  the landing `ThemeProvider` (the plain-div scope from LB.26), which
  paints the canvas and redefines the console token names inside the
  subtree, so `.dark` on `<html>` cannot reach in. No new machinery.

  **Files:** the three storefront pages (`[tenant]/page.tsx`,
  `[tenant]/category/[slug]/page.tsx`,
  `[tenant]/thank-you/[orderId]/page.tsx` — the last also selects
  `theme` through the order's `landingPage`), `test/storefront.test.ts`.

  **Verified live against the build carrying the change** (emulated dark
  OS): all three pages hold `#FAF9F6` with `color-scheme: light` and the
  theme's own border/muted tokens while `html.dark` stays stamped; a
  theme temporarily bound to the order's page flips the thank-you scope
  to that theme's id and background (`#fbfbfc`), unbound and re-verified
  after; the landing page control still carries exactly one scope. A
  light-OS visitor with a STALE `.dark` in localStorage gets the same
  stable canvas — the worst case both ways. **Suites:** storefront 33 →
  **36** (home scope, category scope, thank-you inheritance — the last on
  an order whose fixture theme is deliberately nothing like the default).
  No schema, route or API change.

- **LB.29** The Sheet's close button moves to the logical edge (12 August
  2026, night — **deployed to production 13 August**, see the deploy entry
  above).

  **The fix.** `ui/sheet.tsx`'s close button was `absolute top-4 right-4` — a
  PHYSICAL edge, with an LB.13 note recorded beside it. It is `end-4` now: in
  LTR nothing moves; in Arabic the button sits at the inline end (the left),
  away from where the title starts, which is where a reader closes things.

  **The scope, corrected by measurement.** The backlog said this "also
  affects the mobile nav drawer's close button in RTL" — it does not: the
  console's mobile navigation drawer is a CUSTOM component
  (`console-sidebar.tsx`) built on logical properties from the start
  (`start-0`, `border-e`, `end-2`), and `ui/sidebar.tsx` (the other Sheet
  user) is imported by nothing. The ONLY live Sheet surface is the editor's
  preview drawer, and that is where the fix lands and was verified.

  **Verified** at 375×812 with the browser's mobile emulation: in Arabic the
  preview drawer's close button moved from x 343–359 (physical right, over
  the RTL title start) to **x 17–33** (inline end); in French it stays at the
  right edge (x 347–363), unchanged. builder-sections 73/73 ran against the
  build carrying this change. **Caveat, stated rather than implied: no
  physical phone is reachable from this environment** — the verification is
  Chrome viewport emulation (375×812, touch emulation), the same method the
  UI passes used before their real-device checks; the change itself is one
  physical→logical class swap with no layout arithmetic to disagree on.

- **LB.28** The "dead `rtl:` variant" was never dead — the record was (12
  August 2026, night — **deployed to production 13 August**, see the deploy
  entry above).

  **The premise, measured false.** The backlog item said `rtl:` emits no CSS
  app-wide, so the ERP data table and date picker "are likely rendering wrong
  in Arabic right now". Measured in the running page on Tailwind 4.3.3:
  **`rtl:` is a real, native variant** — the products screen's expander
  chevron computes `scale: -1 1` under Arabic and `none` under French, i.e.
  the data table has been CORRECT in Arabic all along — and `ui/calendar.tsx`
  is imported by nothing, so there is no reachable date picker to be wrong.
  How the false record happened: LB.13 verified the absence of
  `rtl:rotate-180`, a class that existed in NO source file; Tailwind emits
  utilities on demand, so the absence proved nothing was generated — not
  that the variant did not exist. The one usage that DID exist
  (`data-table.tsx`'s `rtl:-scale-x-100`) had been emitted and working.

  **What was actually wrong, and is fixed:** the editor's back arrow
  deliberately carried no flip — its comment cited the false premise — so it
  pointed AWAY from "back" in Arabic. It now carries `rtl:-scale-x-100`
  (verified live: `-1 1` in ar, `none` in fr). The stale comments are
  corrected, and the zcode-dev-loop memory's claim is retracted.

  **A real limit found on the way, recorded as a rule:** Tailwind's native
  `rtl:` matches by `:lang()` (the RTL-language list), NOT the `dir`
  attribute — measured: a probe inside one of this app's `dir="ltr"` islands
  (money, phone figures) still flips. An `@custom-variant rtl
  (&:where(:dir(rtl)))` override was tried and is SILENTLY IGNORED by
  Tailwind 4.3 for this built-in name (the compiled selector stays
  :lang-based), so the rule lives as a constraint comment in `globals.css`:
  never put an `rtl:` utility inside a dir island; use logical properties
  there. No current usage violates it.

  **Suites:** i18n 22/22 · builder-sections 73/73. No route, schema or
  behavioral change outside the one arrow.

- **LB.27** A deleted tenant actually goes away (12 August 2026, night —
  **deployed to production 13 August** and used there for the deploy's own
  fixture cleanup; the finding is from the previous deploy session's cleanup).

  **The defect, measured.** `tenant.delete` cascades platform rows and
  nothing else: product-domain tables carry `tenantId` as an RLS-scoped
  COLUMN, not an FK, so pages, orders, clients and settings survive as
  unreachable orphans. `neondb` held **73,267 orphaned rows from 4,149 dead
  tenants** across 41 tables — left by a test harness whose own comment
  claimed the cascade existed ("cascades ... all 46 scoped tables").

  **The decision: a `deleteTenant()` helper, NOT foreign-key cascades.**
  Three reasons, stated in the module: an FK to Tenant on 49 tables is a
  schema migration on a live shared database that only becomes coherent once
  production migrates too; a cascade CHANGES THE MEANING of `tenant.delete`
  everywhere — one accidental platform-row delete would silently destroy
  every product row, where the column-only design fails SAFE; and this
  platform's stated posture (LB.18: "nothing is deleted") is that total
  destruction must be a deliberate, NAMED act — so the named act is
  `deleteTenant` in `packages/db/src/delete-tenant.ts`.

  **How it sweeps.** The scoped models are enumerated from the Prisma DMMF —
  a table added later is swept without being listed (AUDIT.8's
  closing-of-the-class). Each pass runs under `withTenant` and issues an
  UNFILTERED `deleteMany({})`: rule 2 (never write `where: {tenantId}`)
  means RLS itself decides what "everything" is, so a bug in the helper is
  INCAPABLE of touching another tenant. Passes repeat until one deletes
  nothing (FK ordering resolves itself); the Tenant row goes last, and its
  absence is tolerated — that is the orphan-cleanup case.

  **The harness stops leaking.** `test/erp/helpers.ts`' `cleanup()` and the
  eleven suite-level hooks that called `tenant.delete(Many)` directly (
  hardening, webhooks, tracking, storefront, console-shell, builder-api,
  builder-sections, platform/workspace, platform/domains, platform/sessions,
  platform/team's mid-test delete) now call `deleteTenant`;
  `packages/db/test/isolation.test.ts`' own owner-side cleanup too.

  **Tests:** `packages/db/test/delete-tenant.test.ts` (new) — the zero-rows
  assertion is DATABASE-derived (every `tenantId`-bearing table from
  information_schema, counted through the owner connection so RLS cannot
  hide a leftover), and a second test PINS the defect: a bare
  `tenant.delete` must still orphan rows, so if an FK cascade is ever added,
  the test fails and points at this design note. packages/db 33 → **35**.

  **Verified live:** the historical backlog was bulk-swept owner-side
  (57,222 direct deletes + cascades) — `neondb` measured **73,267 → 0**
  orphans — and after running console-shell (20/20) and hardening (12/12)
  with the new cleanup, the orphan count is STILL 0, which the old harness
  could never have produced. Production was not touched.

- **DEPLOY — LB.13 through LB.26 reach production** (12 August 2026, evening,
  **user-approved, including the LB.20 migration**). This supersedes every
  "local only / not deployed / migration held off" statement in the entries
  below.

  **What.** `b767928..e3939e9` (20 commits) pushed to `origin/main`; Render
  auto-deployed. The commit replaced — the rollback point — is
  `b7679284bfd71ea666a5f3d13973a9b769ba828f`.

  **Migration, first and in order.** Against `landingos_prod`: the DDL was
  previewed with `prisma migrate diff` (exactly `LandingDeliveryPrice`, no
  other drift), applied with `prisma db push` (datasource confirmed
  `landingos_prod` in the output), then `apply-rls` — **49/49 on all four
  checks**, as `FEATURE_PASS_AUG12.md` §4 predicted — and the table
  confirmed present and EMPTY before the app push. Shell-env overrides only;
  `packages/db/.env` still names `neondb`.

  **Verified live on the production domain.** The deploy marker: unauthed
  `/console/erp/finance` flipped 307-to-login → 404 (LB.25's deletion) with
  `/console/erp/calculator` still 307; health green throughout. Then a
  throwaway tenant driven through the real journey: signup → page published
  → tenant delivery price → checkout **3,400** (the default path LB.20 must
  not break) → per-page override → quote **3,800 = charge 3,800** on the
  stored order (D-LB.20.1, in production) → LB.26 held for an emulated
  dark-OS visitor on the real page → merged Finances screen, orders,
  category control and detail breadcrumbs all present. Every fixture deleted
  after, including a sweep of product-domain rows that survive a
  `tenant.delete` (recorded as a finding in `HANDOFF_PRODUCTION.md` §1 — a
  tenant delete cascades platform rows, not RLS-scoped product rows).

  **Risk note.** A rollback past `90f3d43` still requires the older
  apply-rls (the §5 coupling); rolling back to `b767928` itself is safe with
  the new table present, since pre-LB.20 code never queries it.

- **LB.26** A landing page wears its OWN theme, never the viewer's dark mode
  (12 August 2026; deployed to production the same evening — see the deploy
  entry above).

  **The reported bug.** The editor preview's background followed the console's
  dark/light toggle instead of the page's chosen colour template. Measured
  live before changing anything, it was three defects sharing one mechanism:

  1. **The mechanism.** next-themes (root layout, `defaultTheme="system"`)
     stamps `.dark` + `color-scheme:dark` on `<html>` for EVERY route — the
     storefront included, where it follows the VISITOR's OS preference. The
     root `<body>` paints console `bg-background`; the landing template's
     structural sections are console Tailwind tokens; and the page theme's
     `--theme-background` was **written by the ThemeProvider and read by
     nothing** — the canvas never had a reader. The 45 `--theme-*` usages
     were accents only.
  2. **The published page had it too, both ways:** it followed the console's
     stored preference in the same browser, and an anonymous dark-OS visitor
     (no stored preference) got `html.dark` and a near-black page against a
     `#FAF9F6` theme — measured with emulated `prefers-color-scheme: dark`.
  3. **Found on the way:** `GeneralPreviewValues.themeId` was declared,
     initialised — and never sent by the section's preview watcher, whose
     object REPLACES the slice. So both previews only ever rendered the SAVED
     theme, a merchant trying a theme saw nothing until they saved, and the
     first keystroke in General wiped even the saved id out of the preview
     state.

  **The fix, one scope for all three surfaces.** The landing `ThemeProvider`
  now (a) PAINTS its canvas (`background-color`/`color` from the theme,
  `color-scheme:light` against next-themes' html-level dark), and (b)
  REDEFINES the console token names (`--background`, `--card`,
  `--foreground`, `--muted-foreground` via `color-mix` of the theme's own
  text and background, …) on its scope element. `@theme inline` makes every
  Tailwind utility resolve `var(--background)` at the element it styles, so
  the nearest declaration wins and `.dark` on `:root` cannot reach a landing
  page — the storefront, the drawer preview and the (newly wrapped)
  miniature preview all inherit the fix from the one component. The theme
  fetch became `useSelectedLandingTheme`, shared by both previews (D-LP.3:
  one vocabulary), and the General watcher now sends every field its type
  declares. **The scope element is a PLAIN div** — framer-motion routes
  `style` through its animation pipeline and kept serving the first theme's
  resolved background after a switch (measured live, inline style already
  correct); the motion div now only fades content.

  **Verified live** against the rebuilt server, worst case (console
  preference dark AND emulated dark OS, `html.dark` stamped): published page
  canvas `#FAF9F6`, nav light, cards white, native inputs
  `color-scheme:light`; both editor previews stable across the console
  toggle; selecting a theme in the editor now recolours the miniature
  without saving. **Suites:** storefront **33** (+1: the served page carries
  the painted canvas and the redefined tokens) · builder-sections **73**
  (+1: the editor preview renders inside a theme scope) · builder-api 23 ·
  tracking 15.

  **Recorded, not built:** the store HOME, category and thank-you pages still
  follow the visitor's dark/light — they have no per-page theme to wear, and
  which theme a STORE-level page should wear is a design question, not a
  regression of this fix. The `/api/builder/themes` items also carry no
  radius/shadow fields, so editor previews render without the theme's radii
  (pre-existing, cosmetic, editor-only).

- **LB.25** The Finances screen merges into the Calculator (12 August 2026;
  deployed to production the same evening — see the deploy entry above).

  **What changed.** `/console/erp/finance` is deleted, along with its nav item
  and its manual six-totals form (`RecordSavePanel`); the calculator screen at
  `/console/erp/calculator` is now the finance module's ONE screen, titled
  **Finances** in all three locales (`erp.nav.finance` / `erp.finance.title` on
  the existing keys — no new label text). What the finance screen alone had
  moved onto it: the one-off expense add form and list (delete only, never
  edit — the schema's deliberate asymmetry), and the **current/superseded
  version marker** on the saved history (an audit finding, not lost in the
  merge; `data-record-id`/`data-current` and the versions hint moved with it).
  The history's revenue and net-profit columns now render `formatMoney` output,
  as the deleted screen's table did. The settings toggle hint no longer names
  two screens. `FINANCE_NAV_IDS` shrinks to `["calculator"]`.

  **Why.** Measured live before changing anything: both screens' save buttons
  POST the same `/api/erp/financial-records` into the same append-only
  `FinancialRecord` (the same demo record rendered on both tables), both nav
  items sit behind SENSITIVE `erp:finance:read` in the same group, both pages
  apply the identical `seesWholeBook` + `financeEnabledFor` gates, and LB.18's
  toggle hid both as one unit. The finance screen was a shorter, hand-typed
  duplicate of what the calculator derives and partly syncs from real orders.

  **Two decisions.** The URL stays `/calculator` (label carries the name — the
  Automation precedent; a directory move buys broken links plus a redirect page
  needing its own module-off semantics). The manual form is dropped, not moved:
  the route still accepts manual posts — only the duplicate control went.

  **No route change, no schema change, no migration.** The charge list is two
  queries on purpose: a window-scoped one feeds the roll-up total, a
  latest-25-any-date one is the management list, and a new `chargesHint` line
  states which charges count.

  **Files:** `console/erp/calculator/page.tsx` (merged screen),
  `console/erp/finance/` (deleted), `erp/finance-write.tsx` (charge components
  only), `erp-strings.ts`, `product-registry/src/manifests.ts`,
  `lib/erp/settings.ts`, the three catalogues, and the four test files that
  pinned the old screen.

  **Verified live** (fr LTR and ar RTL, against the rebuilt server): one nav
  item; old URL 404 for a manager; a charge added through the moved form lands
  in the roll-up **exactly once** (2500 → net −2500), deletes cleanly in RTL,
  totals return to zero; toggle off → nav item gone + screen 404 + routes
  refuse, on → all back, analytics untouched throughout. **Suites, per file:**
  erp/screens **172** (173 − the removed nav-walkthrough row) · erp/finance
  **44** · erp/ai **31** · erp/access **205** · console-shell **20** · i18n
  **22** · product-registry **36** · calc **20**.

- **LB.16–LB.22** The dead-code deletion and the feature pass (12 August 2026;
  deployed to production the same evening — see the deploy entry above).
  Seven slices, commits `93c4f00..e49ba19`. Per-slice narrative in
  `NEXT_STEPS.md`; tracking rows in `PROJECT_STATE.md`; the session-level
  record (defect list, database state, decisions) in
  **`FEATURE_PASS_AUG12.md`**.

  **What changed.** LB.16 deleted the ten unreachable legacy components LB.13's
  measurement found. LB.17 gave the ERP client and product detail screens the
  breadcrumb UI.22 had built for them and never wired up. LB.18 made the ERP's
  finance module switchable off per tenant — nav, screens and all nine routes,
  with nothing deleted. LB.19 made `CatalogProduct.category` guided (values in
  use offered on create and as a list filter) without converting free text to a
  relation, because the schema states a reasoned decision against that.
  **LB.20 added per-product delivery pricing.** LB.21 publishes landing pages
  into the ERP catalogue, all or one. LB.22 extracts a storefront theme from a
  product photograph.

  **MIGRATION.** LB.20 adds one table, `LandingDeliveryPrice`
  (`@@unique([tenantId, landingPageId, wilayaId])`, cascade on the page). It
  was pushed to `neondb` (dev) during the pass — 48 → **49** tenant-scoped
  tables, 49/49 on all four RLS checks. The production migration was held off
  at first, then **executed 12 Aug 2026 with the user's explicit approval**
  (the deploy entry above carries the production record: same 49/49, table
  confirmed empty before the app deploy, quote=charge verified live).

  **The rule this pass adds to the method:** *a feature that quotes a number and
  a feature that charges it must call the same function.* LB.20's two paths each
  built their own query under a comment promising they could not disagree; a
  copy is a promise nobody enforces, and no suite over either route alone would
  have caught the divergence. The same shape appeared twice more in one session
  (LB.19's product `where`; LB.13's registry-versus-section titles).

  **Nine incidental defects** were found and fixed on the way — including a
  schema `@@unique` that omitted `tenantId` (caught by the repo's own
  `constraints.test.ts`), a formatting function passed Server→Client that 500'd
  a screen, and a `useEffect` keyed on `useBuilderApi()` (a new closure per
  render) that silently discarded unsaved rows. Full list: `FEATURE_PASS_AUG12.md`
  §3.

  **Suites, per file against the running server:** builder-sections **72** ·
  storefront **32** · builder-api **23** · console-shell **20** · hardening
  **12** · webhooks **10** · tracking **15** · erp/screens **173** ·
  erp/finance **44** · erp/catalog **75** · i18n **22** · packages/db **33** ·
  product-registry **36**.

  **Not built, decided after the session:** LB.23 (Facebook Ads) — build real
  ad-spend attribution via a Meta app + OAuth, **blocked** on the user creating
  the Meta Developer App (Marketing API, App ID/Secret, redirect URI,
  `ads_read`, possibly App Review/Business verification). LB.24 (AI landing
  page generator) — **on hold, not started**.

- **LB.13** The landing editor learns Arabic and French (11 August 2026,
  closing `BUILDER_AUDIT.md` M-04). Seven slices, each measure → fix → test →
  verify live in `ar` (RTL) **and** `fr` (LTR) → commit: the editor shell and
  section frame; General/Pricing/SEO; the two media sections; Variants/
  Shipping/Order form; Benefits/Reviews/FAQ/Display; the live preview; and the
  guard. **213 `builder.editor.*` keys** in three locales (catalogue 963 →
  1 176) across **31 live components** plus `ui/dialog`, `ui/sheet`,
  `lib/landing/mock-order-form`, `lib/landing/benefit-icons` and the
  storefront's `purchase-form`. Full record in **`EDITOR_I18N.md`**.

  **The measurement corrected the audit before any code moved.** M-04 said "54
  editor components and the create screen". The create screen was already
  translated, and an import-graph walk from every entry under `app/` found
  **ten of those components unreachable** — the legacy dashboard's page list,
  superseded by the server-rendered pages screen and imported only by each
  other. They were deliberately NOT translated: translating a screen nobody
  can open makes dead code look maintained. Real scope: 31 live components.

  **What it found that M-04 never described**, each by driving the running app
  rather than reading it:
  - **Every section's save rendered the API's ENGLISH developer message.**
    `throw new Error(json.error?.message || "Save failed")` ×12, while
    `lib/console/action-errors.ts` states in its own header that the envelope's
    message is for a log and the screen must key off the CODE. Now
    `refuseIfFailed` throws an `ApiRefusal` carrying only the code and
    `useSectionState` resolves it through `actionErrors(t)` — the same map
    every other console write uses. A `fetch` rejection is a `TypeError` by
    spec and says the request never left; anything else gets the honest generic
    sentence rather than a lie about the network.
  - **`rtl:` emits no CSS anywhere in this app.** Added `rtl:rotate-180` to the
    back arrow, saw `transform: none` in the running page, and found no rule
    for it in the served stylesheet: `globals.css` declares only
    `@custom-variant dark` and Tailwind v4 ships no `rtl` variant. The class
    was removed rather than shipped as a no-op; **two files already carry the
    same dead classes** (`console/data-table.tsx`, `ui/calendar.tsx`) and are
    recorded for a decision. Eleven physical margins DID become logical
    (`ml-`/`mr-`/`left-`/`right-` → `ms-`/`me-`/`start-`/`end-`), each measured
    in Arabic — e.g. the hero card at x=41…483 with its badge at x=436 and its
    remove button at x=50.
  - **Two icon-only controls had no accessible name at all** (the gallery and
    hero remove buttons); **two more announced their name twice**, because an
    `alt` duplicated the button's label (avatar picker, review card).
  - **A label pointed at a heading**: the SEO input's `id="seo-title"` was
    exactly the id `SectionShell` gives its own `<h2>` for a section called
    `seo`, so `getElementById` returned the heading.
  - **Seven English names lived in a data module** (`FIELD_DEFS.displayName`),
    and the benefit picker offered raw lucide keys (`shield-check`,
    `refresh-ccw`). Both carry catalogue keys now.
  - **The preview ignored the config it exists to preview**: "Select wilaya…"
    was hardcoded over the merchant's own `config.wilaya.placeholder`.
  - **The star rating pluralised English by hand.** As an ICU plural, Arabic
    gets grammar English cannot express — «نجمة واحدة», the DUAL «نجمتان»,
    then «3 نجوم».

  **The decision LB.13f had to make, recorded because it generalises:** a
  preview panel contains two kinds of string. What the CUSTOMER will see mirrors
  the storefront — Arabic by design for an Algerian buyer — because a preview
  that says "Total" while the page says «الإجمالي» is not previewing the page.
  What the EDITOR says ABOUT the preview follows the console's locale. Two
  storefront labels moved into one shared `STOREFRONT_COPY` that both
  `purchase-form.tsx` and the preview read, deleting a duplicate rather than
  adding one.

  **The guard, because a green suite proved nothing here.** Every existing
  i18n check asks whether a key the code REQUESTS exists; a `t()` scan cannot
  see 166 strings that never went through `t()`. The suite now also asserts
  *the editor holds no user-facing English*, with exclusions by rule
  (SCREAMING_CASE enums, Tailwind, identifiers, paths, non-latin) and one
  named exemption for the unreachable `media-picker-dialog.tsx`. **Proven to
  bite**: reintroducing one literal in `seo-section.tsx` failed it; restoring
  returned 22/22.

  Tests: i18n **22/22** · builder-sections **58/58** · console-shell **20/20**
  · storefront **32/32**; `tsc` shows the same six pre-existing errors in this
  tree as before the first slice. **Nothing was written to the database** —
  every live check drove the real forms and every save was refused by
  validation or stubbed to fail. Local commits at the time; deployed to
  production 12 Aug 2026 (the deploy entry above).

- **B6 (CAPABILITY_AUDIT)** Sessions become visible and revocable (10 August
  2026). The write side had quietly existed — a throttled `lastSeenAt` touch
  in resolveSession, ua/ip columns, destroy helpers — with no screen. The
  profile now lists every live session (presenting one marked) with a
  "sign out other sessions" action on the new `destroyOtherSessions`
  (keeps by session id, trusts no raw token). Suite platform/sessions 2/2:
  the kept session survives, a revoked cookie is a stranger immediately.
  Three orphans exemptions retired (`Session.lastSeenAt`,
  `TenantDomain.verificationToken`, `.isPrimary`) — the staleness test
  demanded it once B5/B6 made them referenced, exactly as designed.

- **B9 (CAPABILITY_AUDIT)** Workspace defaults unfreeze (10 August 2026).
  No `tenant.update` existed anywhere: a company's name, default language,
  currency and timezone were whatever signup wrote, forever. Now
  `PATCH /api/platform/workspace` — keyed to the caller's session and
  nothing from the request (Tenant is deliberately unscoped, so application
  logic IS the isolation here), slug immutable, values validated against
  the real locale/currency/IANA sets — plus a Settings → Workspace screen.
  New SENSITIVE permission `platform:workspace:manage`. Suite 4/4.

- **B5 (CAPABILITY_AUDIT)** Custom domains get their write half (10 August
  2026). The read path was complete and safe from the day the schema landed —
  `tenantByDomain` refuses rows without `verifiedAt` — and nothing could
  create a row. Now: claim routes minting 128-bit tokens, DNS TXT
  verification (`_landingos-verify.<domain>`, exact match, the ONLY writer
  of `verifiedAt`), exclusive make-primary on verified rows, delete; a
  Settings → Domains screen with the TXT + CNAME instructions in three
  locales. New permission `platform:domains:manage`, deliberately SENSITIVE
  in rbac (OWNER/ADMIN only — a domain decides where customer traffic
  goes). New suite platform/domains 9/9; the positive DNS path is honestly
  untestable without a real zone and says so in the suite header.

- **B4 (CAPABILITY_AUDIT)** The storefront wears the tenant's identity
  (10 August 2026). Measuring the "store settings are half-editable" finding
  exposed the sharper defect: the landing template's nav and footer rendered
  the PLATFORM's wordmark — linking to "/", "© LandingOS" — on every
  tenant's customer page, while their own name/logo/socials sat unrendered
  in StoreSettings. The tenant's identity now flows from the page query into
  the template (nav brand + logo → their storefront root; footer name,
  description, social links with handle→URL normalisation, their © line;
  platform mark only when no settings row exists). Console additions:
  `telegram` field; `logo`/`favicon` file inputs handled in the server
  action via the upload route's own `storeImage`; `favicon` gains its first
  real consumer (storefront layout metadata). storefront 30→32.

- **B3 (CAPABILITY_AUDIT)** Categories become manageable (10 August 2026).
  The CRUD routes existed — validated, permission-gated, suite-covered — and
  the console screen was a read-only list. Added the create form (slug
  auto-follows the name until touched, charset enforced while typing),
  per-row visibility toggle and two-step inline delete, gated on the same
  `website-builder:pages:write` the routes check; `builder.categories.*` keys
  in en/fr/ar. New contract test: deleting a category releases its pages
  (the FK's SetNull, which the screen's hint promises) rather than deleting
  them. `Category.coverImage`/`icon` remain accept-only with no renderer —
  reclassified as removal candidates in the audit's §2.

- **B2 (CAPABILITY_AUDIT)** The LandingSetting toggles get their controls
  (10 August 2026). All five display toggles plus `freeShipping` were stored
  and (partially) honoured with no way for a merchant to set them —
  `freeShipping` the sharpest case: checkout has zeroed the delivery charge
  on it since the port. Shipped: a Display editor section (five toggles,
  saving through the order-form route that already accepted them),
  `freeShipping` in the Shipping section, the missing `FloatingWhatsapp`
  storefront component (number from `StoreSettings.whatsapp`, wa.me
  normalisation local-0 → 213, absent without toggle or number), and the
  editor preview honouring the toggles live. Tests: builder-sections 54→56,
  storefront 28→30 (incl. the money contract: an order on a free-shipping
  page bills product price only). `countdownEnabled` stays recorded — it
  needs a target-date column to mean anything (audit §4).

- **LB.12** Benefits + FAQ end to end (10 August 2026, from `CAPABILITY_AUDIT.md` B1).
  The audit's measurement made it bigger than the queue entry: beyond the known
  gaps (no `features`/`faqs` routes, "Coming Soon" editor stubs,
  `toLandingPageData` hardcoding both empty), the storefront FAQ **and
  Reviews** renderers were **mounted by nothing** — a merchant's saved reviews
  reached the browser inside the data payload and produced no markup — and
  `BenefitsList` rendered four hardcoded badges. Shipped: replace-all PUT
  routes for `features`/`faqs` mirroring the reviews route; Benefits + FAQ
  editor sections (dnd ordering, curated icon-key set shared with the
  renderer so the picker cannot offer what the page cannot draw); both
  mappers unhardcoded; `ReviewsSection`/`FAQSection` mounted in the template
  gated on `showReviews`/`showFAQ` (default true); `BenefitsList` data-driven
  with the four COD badges as the empty-state fallback, gated on
  `showFeatures`; the editor preview shows the three sections while editing.
  Tests: builder-sections 50→54 (round-trip + replace semantics, icon-key
  validation, cross-tenant 404, and the render contract — markup present
  when on, absent when off, asserted with payload-immune `>text<` patterns).
  Verified in the live app: benefit + FAQ added through the real editor,
  rendered on the public Arabic storefront.

**Recorded differently from every phase before it, deliberately.** This phase's
findings live in `BUILDER_AUDIT.md` (the before-measurement, taken in the
running app), its architecture and verification in `BUILDER_HANDOFF.md` (a
handoff that stands alone from the ERP's), and each slice's full reasoning in
its commit message — LB.1 through LB.6 plus the validation run, commits
`6d44262..410d7c5`. The summaries:

- **LB.10** the pre-production readiness audit (8 August 2026, the night before
  the first Render deploy). Six defects found by reading the shipped pipeline
  end to end and driving it in a real browser, all fixed with regression tests:
  1. **The Lead event fired only when the FIRST draft capture carried a phone.**
     The 2s debounce fires after the name field, so the common
     name-pause-phone sequence set `notifiedAt` on a phone-less draft and the
     phone arriving later was only ever `draft_order.updated` — for a product
     whose ad campaigns optimise on Lead, most real leads were invisible. The
     rule is now the TRANSITION: a capture is a Lead exactly when it brings the
     first phone (`draft-orders/route.ts`), proven end-to-end by a
     name-first-then-phone test and re-proven live in the browser.
  2. **Attribution identifiers were dropped at both server doors.** Checkout
     accepted fbc/fbp/ttclid and dropped `_ttp`/GA client id; draft capture
     accepted none at all, so the Lead reached Meta with no click id. Both
     bodies now carry all five (never stored — read at event-fire time).
  3. **Phone hashes never matched for local numbers.** Meta and TikTok match on
     E.164 digits; `sha256("0555…")` matches nothing. `phoneCandidates` adds
     the `213` candidate for the Algerian local shape — Meta gets every
     candidate (ph is an array by spec), TikTok the most specific one.
  4. **Console writes bypassed the API (D-06.1 violations, audit B-08/N16).**
     The order detail's status buttons and the create-page form were server
     actions: the status action checked NO permission (a VIEWER could confirm
     an order) and fired NO webhook (a CRM subscribing to order.updated never
     heard about console-made changes); the create action never fired
     product.created. Both now call their API routes through `useApiAction`;
     `website-builder:orders:write` is in the manifest and gates the status
     route (MANAGER's glob grants it; MEMBER/VIEWER read only).
  5. **Webhook delivery followed redirects.** url-guard checks the URL as
     written, and a public host answering 302 walked the signed tenant payload
     to an address that never passed the guard. Deliveries and test sends now
     refuse every 3xx (`redirect: "manual"`, terminal, logged); the guard also
     refuses IPv4-mapped IPv6 (`[::ffff:127.0.0.1]`) and pins the URL-parser
     normalisation of decimal/hex/octal IPv4 spellings with tests.
  6. **The login `next` parameter was an open redirect** — a signed-in person
     following `/console/login?next=https://attacker.example` was bounced
     there. Only same-origin paths survive now.
  Also: checkout money arithmetic moved from JS floats to `Prisma.Decimal` end
  to end (the route's own M-06 rule — `(1999.9 + 0.2) × 3` no longer stores
  dust in the permanent snapshot); the thank-you page speaks Arabic like the
  rest of the storefront (M-04's storefront half); the Docker entrypoint warns
  unmissably when a tracking stub override (`META_GRAPH_BASE` et al.) is set,
  because that misconfiguration silently discards every production conversion.
  Suites after: storefront 28 · builder-api 23 · builder-sections 50 ·
  webhooks 10 · tracking 15 · hardening 11 · console-shell 14 — all green
  against the rebuilt server, plus the full journey re-driven in a real
  browser (create → publish → capture → checkout → Arabic thank-you →
  confirm-with-webhook, ERP record `ORD-0021` in the same transaction).

- **LB.1** the storefront client speaks the API's vocabulary again (the public
  page crashed for every customer; checkout could not post an acceptable body;
  the abandoned-lead capture had never landed a row). One shared contract
  module, both sides import it. Draft conversion gets its first writer.
- **LB.2** the editor stops crashing and its saves stop lying (envelope drift
  in every consumer; four sections posting vocabularies their routes refuse or
  ignore; a media replace that deleted the other placement's images; Copy Link
  handing out dead legacy URLs).
- **LB.3** webhooks become first-class: three independent kills fixed
  (Json-array subscriptions, plaintext secrets under a decrypting reader,
  triggers racing their own transaction), every declared event now fires,
  page.published/unpublished added, console write surface + delivery log +
  signed send-test, and the platform's first real-receiver delivery suite.
- **LB.4** the console front door stops 404ing builder-only tenants; the two
  manifest nav items with no screens get theirs; the manifest-driven screen
  test generalises LP.17's guard to this product.
- **LB.5** the tracking pipeline: one canonical event model with provider
  adapters — Meta pixel + Conversions API (advanced matching, event_id dedup,
  test codes), TikTok pixel + Events API, GA4, GTM, Google Ads — a new
  RLS-scoped `TrackingIntegration` table with encrypted server credentials and
  the platform-managed/customer-owned split as data, one storefront loader
  mounted by a new layout, server-side Purchase/Lead after commit, and a suite
  that drives a real checkout into stubbed provider endpoints.
- **LB.6** SEO gets its writer (+ OG/Twitter/JSON-LD on the public page), pages
  get duplication and their first row actions, the two public writes get
  per-IP rate limits, webhook destinations get an SSRF guard, and the create
  page's money input stops being `type="number"`.
- **LB.7/LB.8** validation as a real customer in a real browser (variant-priced
  checkout, Lead + Purchase observed at receiver stubs, order confirmed through
  the UI, the ERP record in the same transaction, the standalone walkthrough
  with zero ERP rows), and the two documents above.

**Migration:** one additive table (`TrackingIntegration`), RLS applied (48/48).
**Risk:** provider adapters are spec-built and stub-verified; no request has
crossed the real Meta/TikTok/GA4 endpoints (the ZR/Ecom precedent — verify with
test pixels before first ad spend).

---

## Phase PM — product maturity

**This phase is not a styling pass.** Phase UI was presentation-only by
declaration; this one is allowed to change what a screen SHOWS, and does — a
dashboard that answers a different question, columns that had readers for the
first time, an upload route, a search box in the header. What it does not change
is the domain: no calculation moved, no permission widened, no tenant scoping
touched. Every D-06 rule still holds, and the contract suites that assert on
rendered HTML were kept green rather than relaxed — including the two
assertions that are BOUNDARIES rather than markup (`data-tile="customers"` is
absent for an agent, D-05.1; the confirmation rate renders with the count it is
derived from).

**Its finding, in one sentence.** The console had reached parity and a coherent
visual language, and was still built to be READ rather than to be WORKED: the
front door was six lifetime counts with no period and no comparison; the product
photograph, the variant image and the per-variant stock level had columns,
writers and no reader anywhere; a notification carried the id of the record it
was about and linked nowhere; and "is this running out" was answered four
different ways on four screens.

### PM.1 The front door becomes an operational dashboard

[Opus 5]
Date: 7 August 2026

**What.** `/console/erp` was six lifetime counts and an overdue banner. It is
now four bands, in the order a shift is actually run:

1. **What needs a person** — overdue calls, confirmed orders with no parcel
   booked, follow-ups past their deadline, out-of-stock and critically low
   variants, flagged calls, and carrier / sales-channel failures in the last 24
   hours. Only what is non-zero renders; each card links to the screen where the
   thing gets FIXED rather than to a screen that describes it. When nothing is
   wrong the page says so in one line instead of showing six zeros.
2. **What the period did** — nine figures (orders, confirmation rate, never
   called, confirmed value, delivered value, delivery rate, return rate, average
   order, new customers), each against **the same length of time immediately
   before it**, with the direction coloured by whether a rise is good. A return
   rate climbing is never green.
3. **The shape over time** — orders per day with the confirmed share filled in,
   for the chosen window.
4. **Who and what** — agent roster (bar length is workload, colour is
   conversion), carrier delivery rates, top products, and the ten worst stock
   levels.

**Why.** Every figure on the old screen was a lifetime total, so the page
answered "how many confirmed orders exist" — a question nobody has — and never
"is today going better or worse than yesterday", which is the only question a
manager opens a dashboard with. The one thing on it that WAS a decision (the
overdue banner) had to compete with a grid of tiles for attention.

**Files.** `src/lib/erp/dashboard.ts` (new), `src/lib/erp/stock-level.ts` (new),
`src/components/console/erp/dashboard-parts.tsx` (new),
`src/components/console/erp/stock-chip.tsx` (new),
`src/app/console/erp/page.tsx`, `src/lib/erp/orders.ts` (exports
`rangeBounds`), the three i18n catalogues (+44 keys, and four the rewrite
orphaned removed rather than left — 867 keys in each of the three, still
exactly equal).

**D-PM.1.1 — the window is `rangeBounds`, exported rather than recomputed.**
Every tile links to the order list carrying the same `range=` word. A dashboard
that resolved "today" itself would eventually disagree with the list it links
to, and the symptom is a tile reading 14 that opens a list of 11. D-LP.3's rule,
one screen further out.

**D-PM.1.2 — no chart library.** `recharts` is installed and unused, and it is a
client component that mounts, measures and re-renders to draw fourteen
rectangles. Fourteen rectangles are fourteen `<div>`s with a percentage height:
server-rendered, nothing to hydrate, themed by the same tokens as everything
else, correct before JavaScript — the property every other read surface in this
console already has. A visually-hidden `<table>` carries the same numbers for a
screen reader.

**D-PM.1.3 — the query count IS the latency, because the transaction is
pinned.** `withTenant` opens an interactive transaction, so `Promise.all` around
nine Prisma calls does not parallelise them — it queues them on one connection.
The first build issued ~35 round trips and measured **3.2–4.8 s** on the screen a
manager opens first. Consolidating with `groupBy` (one pass by `status` answers
four of the old counts; one by `deliveryOutcome` answers three; `[dimension,
status]` replaces two passes per breakdown; both integration counts became one
grouped read) brought it to **~2.0 s steady state** — level with the order list
(2.1 s) and well under the untouched analytics screen (3.7 s), against a floor
of 0.86 s for a near-queryless page on this connection.

**And what was NOT done for that speed:** the scope was not hand-written into
SQL. `orderScope`'s record-level rule is a Prisma `where`, and a second copy of
"which orders may this person see" expressed as a string is the one place being
wrong leaks a colleague's queue rather than merely disagreeing about a filter.

**Risk.** The dashboard reads more than any other screen. Every section that is
supervision data is withheld with the permission its API equivalent checks —
`erp:agents:manage` for the roster and the carriers, `erp:clients:read` for the
customer count (absent, never zero), `followupScope` for the follow-up count —
and an agent's figures are their own queue through `orderScope`, verified live
for all four demo roles.

**A defect this slice introduced, and the review that caught it.** The first
build gated the two integration alert cards on `erp:settings:read` — a
permission that **is not in the ERP's manifest at all**, so `can()` answered it
by role glob — and pointed them at `/console/erp/carriers` and
`/console/erp/sales-channels`, which check `erp:shipments:write` and
`erp:settings:write`. The stock cards had the same shape: unconditional, aimed
at `/console/erp/inventory`, whose nav gate is `erp:inventory:write`. Three
cards that count correctly and link into a 404 — the exact failure the same
slice wrote a rule about for the header search box.

**The check that finds it is not a route review.** Every route was gated
correctly; what was wrong was the pairing between a control's gate and its
DESTINATION's gate, which is only visible by reading the manifest's nav
permissions beside the screen's. Each flag on `AlertInput` now names the
permission its destination checks, and a stock alert for somebody who cannot
open the stockroom points at the products list instead — verified live: the
demo agent's card reads `/console/erp/products`, the manager's reads
`/console/erp/inventory`.

### PM.2 The product photograph, which had columns and no reader

[Opus 5]
Date: 7 August 2026

**What.** `CatalogProduct.image` and each variant's `image` have existed since
M-06, are accepted by `POST /products` and `PUT /products/[id]/variants`, and
were **rendered by nothing anywhere in the console** — while the legacy CRM shows
a photograph on the product grid, on the stock screen, in the variant editor and
on every order row. There was also no way to put a FILE into either: the
products screen offered a text box for a URL, and its own comment said so.

Now: `POST /api/erp/uploads` (gated on `erp:products:write`), an `ImageInput`
control on the product create panel, the edit panel and every variant row, a
bulk "one photograph for this whole colour" upload on each variant group, and
thumbnails on the products grid, the product detail, the inventory list, the
dashboard's stock panel, the order list, the order detail and the agent's queue
card.

**Why it is more than decoration on the order screens.** The same lookup that
finds the photograph knows the stock level of the exact variant somebody is
about to confirm. An agent on the phone saying yes to a size that ran out this
morning is a courier dispatched for nothing and a customer rung back to be told
no — and the screen where that decision is taken said nothing about it.

**Files.** `src/lib/image-upload.ts` (new, shared),
`src/app/api/erp/uploads/route.ts` (new), `src/app/api/builder/upload/route.ts`
(now composes the shared uploader), `src/lib/erp/order-product.ts` (new),
`src/components/console/erp/{image-input,product-thumb}.tsx` (new),
`catalog-write.tsx`, `queue-card.tsx`, the products / inventory / orders / order
detail / queue / dashboard screens, `edit-field.ts` (`kind: "image"`),
`test/erp/catalog.test.ts` (+6), `test/erp/helpers.ts`.

**THE DEFECT IT FOUND, and it was shipped, live, and not the ERP's.**
`POST /api/builder/upload` has stored `tenants/<tenantId>/<uuid>.<ext>` since the
platform port. `GET /api/uploads/[...path]` refused any key that was not a
SINGLE path segment — its comment still said "uploads are stored flat" — and its
private-R2 branch looked objects up under the bare filename rather than the key
they were written at. **So every image uploaded through the console 404'd unless
the deployment happened to have a public R2 bucket**, which is why four audits
walked past it: the writer, the storage and the returned URL are all correct and
only the reader disagrees. Found by uploading a real file through the running
console and asking for it back. `test/erp/catalog.test.ts` now asserts the ROUND
TRIP, not the upload — a test that only checks the POST answers 200 tests the
half that already worked — plus the traversal guard the fix widened.

**D-PM.2.1 — plain `<img>`, not `next/image`.** Two shapes live in that column:
the `/uploads/...` key this platform writes, and the `data:image/...;base64` URL
a tenant migrated from the legacy arrives with (M-14 is the move off that, and
until it happens both are live). `next/image` cannot render a data URL, so using
it would mean a migrated catalogue showing broken images with no error anywhere.

**D-PM.2.2 — one uploader, two gates.** The processing is shared; the permission
is not. `/api/builder/upload` stays `website-builder:pages:write` and the ERP's
is `erp:products:write` — the permission the routes that STORE the resulting
string check. A shared uploader carrying its own gate would be one permission
for two products, which is the shape the product registry exists to prevent.

**D-PM.2.3 — the catalogue is resolved for the PAGE, never per row.**
`resolveOrderProducts` reads the catalogue once and matches in memory, because
the match is on a normalised name Postgres has no index for. Fifty orders would
otherwise be a hundred round trips on the screen an agent lives in — PERF-02,
and the same reason `ORDER_LIST_SELECT` joins no call history. Resolution order
is `resolveProduct`'s: the channel link first and exclusively (AUDIT.7), then a
normalised name, and a duplicated name resolves to NOTHING (AUDIT.3) rather than
showing the first row's photograph while the counters attribute to neither.

### PM.3 Variants that can be navigated, and a product created in one pass

[Opus 5]
Date: 7 August 2026

**What.** Three changes to the same workflow:

- **The products grid opens out.** A row with variants gets a disclosure that
  reveals the matrix grouped by its first option axis, with a thumbnail, a stock
  chip and a per-group total. The grid's `variants` column was a COUNT and its
  `stock` column the roll-up — both true, and neither the question anybody has,
  which is "of the twelve, which are gone". A 200-unit shoe is not fine if 199
  of them are size 45.
- **The variant editor groups and collapses.** Three colours × five sizes is
  fifteen rows and a length axis makes it forty-five; LP.18 generated them
  correctly and rendered them as one flat list of text inputs. Groups now
  collapse to one line carrying a cover photograph, a count and a running stock
  total, and one upload can be applied to every variant in a group.
- **A product and its variants are created together.** Adding a product with
  fifteen variants took three passes through two panels that did not know about
  each other — create a bare product, find it again in the EDIT panel for the
  classification fields, find it a third time in the variant editor. `POST
  /api/erp/products` has always accepted the whole thing in one request.

**Files.** `src/components/console/erp/{variant-matrix,variant-breakdown,
product-create}.tsx` (new), `variant-editor.tsx` (rebuilt on the shared matrix),
`catalog-write.tsx` (the old create panel removed), `data-table.tsx`
(`rowDetail`), `globals.css`, `src/app/console/erp/products/page.tsx`.

**D-PM.3.1 — the disclosure is a checkbox and a `:has()` rule, not state.**
`.console-table tr:has(input[data-row-expand]:checked) + tr[data-row-detail]`.
So the table stays a server component, a page of 200 products ships no
JavaScript to open one of them, the contents are in the HTML for a contract test
to assert (D-06.4's principle applied to a read surface), and an opened row
survives the debounced `router.refresh()` the notification provider fires. The
SELECTED-row tint moved out of a Tailwind `has-[…]` variant and into
`globals.css` because it now has to exclude the expander — an arbitrary variant
carrying `:not(…)` is exactly the shape Phase UI's rule warns about.

**Two live violations this closed.** The old create panel used `{open && …}`,
which mounts on click — a D-06.4 violation in the panel a manager uses most,
verified fixed in the running page (`input#new-name` is in the DOM while the
panel is hidden). And `catalog-write.tsx` still carried its own hand-written
copy of the text input, the tenth of the nine UX-14 replaced.

### PM.4 A notification that opens the thing it is about

[Opus 5]
Date: 7 August 2026

**What.** `Notification.entity` and `entityId` are written on every ERP
notification about one order, stored, returned by the API and carried on every
SSE frame — and the console read them for exactly one purpose: flashing a row
you were already looking at. Panel rows were `<li>`s with no link. So "delivery
problem — ORD-0042" meant opening the order list, finding ORD-0042 and opening
it: three navigations to reach a record the notification was holding the id of.

`src/lib/platform/notification-href.ts` maps `(product, entity, entityId)` to a
destination, falling back to a per-TYPE one for the notifications that carry a
count instead of an id (`followup_overdue` → the follow-up queue, `stale_orders`
→ pending orders oldest-first, `agent_suspended` → the roster, `suspicious_call`
→ `?suspicious=true`). Panel rows are links; the toast gains an action, which is
the one moment somebody is already looking at the event.

**D-PM.4.1 — an unknown type resolves to nothing rather than to a guess.** A
notification type added later reads correctly and simply is not a link until
somebody adds it. A destination that 404s is worse than a row that does not
move — D-LP.2's argument about fabricated tracking numbers, applied to a URL.

**The table says which entries are LIVE.** `erp`/`order` is the only one
anything writes today; the rest are ahead of a writer and say so, with the work
that would make each reachable — the discipline `orphans.test.ts`'s exemption
list uses for a schema column. Writing that down caught one:
`landingPage` pointed at `/console/builder/pages/{id}`, and the route that
exists is `/pages/{id}/edit`. A lookup table is the easiest place in a codebase
for a plausible-looking path to sit and look like a fact.

**Verified in the running page**: the panel's 22 rows are 22 links, each at
`/console/erp/orders/<the id the notification carries>`.

### PM.5 One answer to "is this running out"

[Opus 5]
Date: 7 August 2026

**What.** `stock <= threshold` is one bit for two situations a warehouse treats
completely differently: a variant at 18 against a threshold of 24 is a restock to
schedule, and a variant at 0 is an order the call centre is about to confirm and
cannot ship. Both were the same red, so the second was invisible inside a list of
the first — and a product with NO threshold could sit at zero and never appear on
the low-stock screen at all.

`lib/erp/stock-level.ts` is the one vocabulary — `out` / `critical` (at or under
half the threshold) / `low` / `ok` — and `StockChip` renders it identically on
the products grid, the expanded variant matrix, the variant editor, the
inventory list, the order list, the order detail, the agent's queue card and the
dashboard. The inventory screen leads with counts per severity and orders the
list worst-first.

**A green pill is never shown on a healthy row.** `onlyWhenAlert` exists because
a page where every row is decorated is a page where the two rows that matter
disappear.

### PM.6 Secondary text stops looking like a control nobody may press

[Opus 5]
Date: 7 August 2026

**What.** Disabled controls were `opacity: 0.5`, which puts a label at whatever
grey sits halfway to the background — and that is precisely where
`--muted-foreground` lives. So a caption and a control nobody may press were the
same colour and the operator had to work out which one was information. Opacity
is also invisible to assistive technology (UX-72), and it faded the BORDER as
well as the label, so the control lost the one shape that said it was still a
control.

- `--muted-foreground` firmer in both themes (light 0.48 → 0.45, dark 0.68 →
  0.72): measured **6.55 → 7.30** on a card in dark, 6.55 → ~7.3 in light.
- New `--control-disabled-{bg,fg,border}`: a filled inert box, a label below
  every live grey, `cursor: not-allowed`, and `pointer-events` deliberately NOT
  removed — a disabled `<button>` fires no click by specification, and
  suppressing pointer events also suppresses the cursor and any `title`
  explaining WHY. The light value was measured in the running page at 2.63:1
  and darkened to clear **3:1** — the floor the test asserts, chosen because it
  is WCAG's own non-text threshold rather than because it is what the token
  happened to measure.
- **Read-only and disabled stopped sharing one declaration.** A read-only box
  holds a real value somebody has to read; it keeps full foreground text.
- Dark theme: surfaces lifted one step (raised 0.185 → 0.20), borders and hover
  firmed, so a card reads as a card without the border carrying the whole job.

**`packages/ui/test/tokens.test.ts` gained an oklch→sRGB converter and 16
tests.** The status palette is hex and has been measurable since M-13; the
GROUND is `oklch(…)` and was measurable by nobody — so the one contrast question
an eight-hour reader actually has was the one the contrast test could not ask.
It now asserts secondary text clears 4.5:1 on all three surfaces in both themes,
body text clears AAA, a raised surface differs from the page, a hovered row
differs from a raised one, and — the load-bearing one — that disabled text is
**measurably weaker than secondary text and still above 3:1**. Verified to fail:
setting `--control-disabled-fg` near `--muted-foreground` turns it red, naming
the ratio. 26 → 42 tests.

### PM.7 The question this product is opened with

[Opus 5]
Date: 7 August 2026

**What.** "A customer is on the phone and gives me a number" is the most
frequent question anybody asks this software, and answering it cost four
navigations: open the product, open the order list, open the filter bar, type,
submit. `orderFilters` has read `search` since LP.3 and it reaches the
reference, the customer name and the phone number — the capability was there and
the distance to it was the whole cost. There is now a search box in the console
header, focused from anywhere with `/`.

**D-PM.7.1 — the product declares it; the shell renders it.**
`ProductManifest.search` carries the path, the query parameter and the
placeholder key. A header that hard-coded `/console/erp/orders?search=` would be
the shell knowing what an ERP is — the one thing the registry exists to prevent,
and the same argument `ProductNavItem.group` already makes. The builder declares
none and gets no box. The parameter is `search`, the one `orderFilters`
validates, so the box and the list cannot disagree about what was asked; it is
gated on `erp:orders:read`, because a search box that submits into a 404 is
worse than no search box.

A plain GET form, like the filter bar and the pager: the answer is a URL
somebody can bookmark or hand to a colleague, and it works before JavaScript.

### PM.8 `npm run builder:start` had stopped starting anything

[Opus 5]
Date: 7 August 2026

**What.** `next.config.ts` sets `output: "standalone"`, and Next 16.2 refuses
`next start` with that configuration — printing `✓ Ready in 533ms`, *then* the
refusal, then exiting 1. So the documented local command looks healthy for
exactly one line and leaves nothing listening on :3000.

**Why it stayed hidden for a whole session.** Another `next start` process was
already holding the port and answering everything, so every restart "worked".
It surfaced the first time the port was genuinely free. That is PROJECT_STATE
rule 5's silent port race seen from the other direction: rule 5 warns that a
stale server can serve a NEW verification; this is a dead starter hiding behind
an OLD server.

**Files.** `apps/website-builder/scripts/start-standalone.mjs` (new),
`apps/website-builder/package.json` (`start` → the script; `start:next` keeps
the old command for anyone who turns `output` off).

**It runs the artifact that ships.** `standalone/apps/website-builder/server.js`
— the same file the Dockerfile runs and the deployment serves, one level deeper
than a single-app build because `outputFileTracingRoot` is pinned to the
workspace root. Verifying against anything else is verifying against something
that will never be deployed.

**And it mirrors `public/` and `.next/static/` in first**, because Next
deliberately leaves both out of the standalone bundle and the Dockerfile copies
them as separate layers. Without that the pages render and every stylesheet,
script and committed image 404s — which reads as a broken build rather than as
a missing directory. Verified: the console's CSS bundle answers 200 and the 84
screen/role pairs are still clean on this server.

### Verification

Live, against the running server on a real Neon database. Re-run end to end on
the STANDALONE server after PM.8, which is the artifact that deploys.

| Suite | Result |
|---|---|
| `packages/ui` | **42/42** (was 26 — the oklch ground is measurable now) |
| `packages/i18n` | 20/20 |
| `packages/product-registry` | 36/36 |
| ERP `catalog` | **72/72** (was 66 — the photograph round trip) |
| ERP `screens` | 173/173 |
| ERP `notifications` + `access` | 252/252 |
| `console-shell` + ERP `analytics` + `listing` | 62/62 |
| ERP `orders` + `registry` + `export` + `calc` | 132/132 per suite |
| ERP `integrations` | 80/80 |

**Two red runs, both environmental and both re-verified.** `registry` failed
2/23 in a four-suite back-to-back run (the documented Neon capacity limit; its
two tests completed in 623 ms against 8,195 ms alone, which is a connection
failure's signature) and passes 23/23 alone. `integrations` failed 3/80 because
a build was run while the suite was in flight and replaced `.next` under the
serving process — 3/3 on a stable build. **A build is a write to the thing under
test**, which is rule 5 of PROJECT_STATE's *Read this first* seen from the other
direction.

**The role walkthrough is mechanical rather than anecdotal.** 21 screens × 4
demo roles = 84 pairs driven over HTTP: every 200 renders inside the console
shell, no screen leaks a raw i18n key as text, and the only 404s are the 18
permission-shaped ones (an agent and a follow-up agent reaching clients,
carriers, channels, finance, the calculator, the roster, automation, team and
billing). Measured in the running page at 375 px and at desktop width: no
horizontal overflow on the dashboard or the products grid, the create panel's
fields present in the DOM while hidden, and the expandable row `display: none` →
`table-row` on the checkbox alone.

---

## Phase UI — UI/UX modernisation

**Presentation only.** No business logic, no calculation, no API behaviour, no
permission and no tenant-scoping change. Every control that rendered before
renders now, decided by the same predicate the route checks (D-06.2); no
optimistic UI was introduced (D-06.3); every collapsible panel still renders its
contents and toggles `hidden` (D-06.4); every `data-testid` the contract suites
read survives.

`UI_UX_AUDIT.md` is the measurement this phase was planned from — 87 findings,
taken before anything moved, with the file each lives in. §10 states what the
work may not touch; §12 is the scoreboard afterwards, including what was left
open and why.

### UI.4 Forms that say what they need, and one column that owns the rhythm

[Opus 5]
Date: 7 August 2026
Summary: pass 5, plus the four tests the sortable headers owed.
screens 169 → **173**.

#### What changed

**`<Field>` binds a refusal to the control that caused it.** `ActionError`
rendered one `role="alert"` at panel level and nothing else, so the new-order
panel's eleven fields shared one message: the operator was told *that* something
was refused and never *which*, and a screen-reader user got the sentence with no
context at all. `fieldAria` sets `aria-describedby` and `aria-invalid` — which
is also what tints the input's border — and `required` renders a mark AND
`aria-required`, because an asterisk is invisible to a screen reader and an
attribute is invisible to everyone else. The required rule mirrors the ROUTE's
own and adds none of its own.

**Success has a voice.** D-06.3 says no optimistic UI, and the console had read
that as "say nothing" — the only feedback an operator ever got was a refusal.
`ActionFeedback` fires AFTER the API answered success, so it reports what the
server said rather than what a form assumed. Dispatched as a DOM event rather
than threaded as a prop: more than twenty panels already call `useApiAction`,
and a flag through each is twenty edits a twenty-first panel would forget.

**`PageBody` owns the column.** Ten panel components each set their own outer
margin, so the gap between two of them was decided by whichever rendered second.
`flex flex-col gap-4`, not `space-y-4`: `space-y` sets `margin-top` through a
compound selector that OUTRANKS a child's own `mt-8`, and adopting it would have
silently flattened every deliberate section break on the finance, inventory and
AI screens.

**`ORDER_SORT_FIELDS` moved to `lib/erp/sort-fields.ts`, directive-free.** The
first attempt at asserting the sort vocabulary died with `ERR_MODULE_NOT_FOUND`,
because `lib/erp/orders.ts` is `server-only` and no contract test can import it —
the same rule that produced `edit-field.ts`, `filter-field.ts` and
`notify-vocab.ts`. The whitelist is now `Record<OrderSortField, …>`, so a key
added to the list without a column fails to compile and a column no key names is
impossible.

#### Files

`components/console/ui/primitives.tsx` (Field, fieldAria, PageBody),
`components/console/action-feedback.tsx` (new), `components/console/api-action.tsx`,
`components/console/erp/order-create.tsx`, `lib/erp/sort-fields.ts` (new),
`lib/erp/orders.ts`, 35 screens, `test/erp/screens.test.ts`.

#### Risk

The sort tests assert **both directions** (D-LP.3's rule for filters, applied to
ordering) precisely because `orderSort` falls back to `createdAt` for an unknown
column deliberately, so a stale bookmark renders. A header bound to a key outside
the list would therefore render perfectly, sort by date, and claim to have done
something else.

---

### UI.3 The screens get a frame, and the console stops answering in English

[Opus 5]
Date: 7 August 2026
Summary: pass 3 and the last of pass 6.

#### What changed

**One header everywhere.** 35 screens each rendered their own
`<h1 className="text-xl font-semibold">`, with nowhere to put a description, an
action or a breadcrumb — so descriptions were loose `<p>` tags and every
second-level screen invented a different back link (the order detail's
`← Back to list`, the client detail's own, the product detail's absence).

**The dashboard leads with the thing that has a deadline.** The overdue banner
sat between the title and a grid of six equal tiles. `auto-fit` replaces
`lg:grid-cols-3`: five tiles became three and two-stretched-to-fill, and an
agent — deliberately not shown the customer count (D-05.1) — got a hole where it
would have been.

**Three feedback states that did not exist.** There was **no error boundary
anywhere in the application**: a thrown screen showed the framework's default
page, with no shell and no way back, and PROJECT_STATE's own known-limitations
section records that the free-tier connection limit "surfaces as a 500 from a
screen". There was no not-found page either, though `notFound()` is called
deliberately and often — assumption 10 is 404-not-403 for another tenant's row,
so one sentence has to cover a mistyped URL, another tenant's id and a screen
this person may not open. And nothing happened between a click and a page.

**Not `loading.tsx`, and the reason is structural.** `ConsoleShell` is rendered
by each PAGE rather than by the console layout, so a route-level Suspense
fallback replaces the whole frame and the sidebar blinks out on every
navigation. `useLinkStatus` answers the narrower question — is THIS the link you
are waiting for — and the spinner lands on the item that was clicked.

**The English.** Six screens rendered user-facing literals in a product whose
default locale is Arabic, including the login page. AUDIT.4's i18n scan reads
`t("…")` calls, so it could never see a string that never went through `t()` —
which is how these survived four passes. The residue is named in
`UI_UX_AUDIT.md` §12 rather than left unstated.

#### Files

`components/console/ui/primitives.tsx`, `app/console/error.tsx` (new),
`app/console/not-found.tsx` (new), `components/console/nav-pending.tsx` (new),
`components/console/notification-provider.tsx`, 35 screens,
`packages/i18n/src/messages/{ar,fr,en}.json`.

---

### UI.2 The table an ERP is actually used through

[Opus 5]
Date: 7 August 2026
Summary: pass 4. `DataTable` renders every list in the product and was a clean
2010-era table.

#### The one that is a capability, not a style

`orderSort` has read `?sort=`/`?dir=` since Phase 5, against a whitelist, and
**no control anywhere set either of them** — so an operator could not sort the
order book by value, by date or by customer, though the query always could. That
is the shape of defect this project has now caught six times: BUG-02,
`IntegrationLog`, `OrderCall.suspicious`, `fakeReason`, A12 and A13. Computed,
stored, whitelisted, reachable by nothing.

The header is a LINK, like the pager: sorting lives in the URL, survives a
refresh, can be sent to a colleague, works before JavaScript, and can be
asserted by a contract test.

#### The rest

Sticky header on a scroll region capped only from `md` up — a nested vertical
scroll on a phone is worse than the problem it solves. Hover, and a selected row
driven by `has-[:checked]`, so there is no second copy of what is ticked.
Select-all with a real indeterminate state, in the bulk bar rather than the
header cell, because the table is a server component and the form is the bar's.
The bulk bar is sticky and takes the selected tint: it sat above the table, so
selecting row 40 meant scrolling back up to act on it. `scope="col"`,
`aria-sort`, a caption, and an empty state that tells "nothing yet" from
"nothing matched" — "No orders yet" on `?status=cancelled` in a tenant with
4,000 orders is simply false. Scroll shadows via `background-attachment: local`:
no listener, and both edges drawn, which is what it has to be with Arabic as the
default locale.

**Density follows the DEVICE, not the person.** D-LP.11.1 put the notification
preferences on `ProductSetting` for two stated reasons — a mute must follow the
person between machines, and a supervisor must be able to see whether an agent
silenced the alarm that watches them. Neither is true of row height, and putting
it in the database would add a bound read to every console render.

#### Files

`components/console/data-table.tsx`, `components/console/density-toggle.tsx`
(new), `components/console/density-script.tsx` (new),
`components/console/ui/list-frame.tsx` (new),
`components/console/erp/order-bulk.tsx`, `lib/erp/orders.ts`, the four list
screens, `app/globals.css`.

#### Risk

`data-order-id` stays exactly one per row — the defect LP.8 introduced and the
LP.3 paging tests caught, where every row count doubled. Verified: listing 30/30.

---

### UI.1 The audit, the design system, and a console you can reach on a phone

[Opus 5]
Date: 7 August 2026
Summary: passes 1 and 2. `UI_UX_AUDIT.md` is new — 87 findings across the shell,
the tokens, the tables, the forms, feedback, accessibility and 39 screens, each
with the file it lives in.

#### The three that matter most, all found by measuring rather than by looking

**There was no navigation at all below 768px.** The sidebar was
`hidden … md:flex` and nothing replaced it — no drawer, no menu button, no
bottom bar. The screen this hurts is `/console/erp/queue`, the port of the
legacy agent PWA, which LEGACY_PARITY §6.4(c) records is used by field agents on
Algerian mobile networks. It was reachable on a phone only by typing the URL.

**The dark theme could not be turned on.** `tokens.css` documents at length that
the dark palette IS the ERP's own, promoted — "the dense operational screens
people use every day keep the exact colour language they already read fluently"
— and that it was the resolution of R-14. `theme-toggle.tsx` was written to
switch it and imported by nothing.

**The icons were computed, passed down, and thrown away.** `ProductNavItem` has
carried a lucide name since the contract was written, its comment says "resolved
by the shell's icon registry (lucide today)", and no registry existed:
`console-shell.tsx` computed the name, `ConsoleNav` destructured it and rendered
only the title. Fifteen ERP items were fifteen identical lines of text.

#### The system

`packages/ui/src/tokens.css` gains surfaces, elevation, focus and motion, in both
themes. The colour system was real and was 23 colour decisions; eight of the
nine axes of a design system did not exist, so every screen re-decided them —
the audit counted seven vertical rhythms, three radii for one role, five type
sizes of which two were arbitrary, and no focus treatment at all.

`globals.css` gains a `:focus-visible` ring, which the codebase had nowhere.
Every keyboard guarantee this project built deliberately — GET filter forms, a
pager of links, panels that render before hydration — is unusable if you cannot
see where you are. Plus one reduced-motion guard for everything, `.tap` (a 44 px
floor on coarse pointers only), and a fix: `::selection` named `--crimson`,
which has never existed, so both declarations were invalid and dropped.

`components/console/ui/styles.ts` is the class vocabulary, directive-free so a
server screen and a client panel share it — the `edit-field.ts` rule, third
worked example. It replaces the text input written out by hand in nine files.

#### The registry change

`ProductNavItem.group` — optional, an i18n key, declared by the PRODUCT. The
shell knowing that "orders, queue and follow-up are one job" would be the shell
knowing what an ERP is, which is the one thing the registry exists to prevent,
and a `switch` on `product.id` is exactly the shape the registry replaced. A
manifest that declares no groups renders the flat list it rendered before.

#### Files

`packages/ui/src/tokens.css`, `packages/product-registry/src/{types,manifests}.ts`,
`packages/i18n/src/messages/{ar,fr,en}.json`, `app/globals.css`,
`components/console/{console-shell,console-nav,console-sidebar,theme-switcher,
product-switcher,tenant-switcher,locale-switcher,sign-out-button}.tsx`,
`components/console/ui/{styles.ts,primitives.tsx,icon.tsx}` (new).

#### Risk

The tokens suite parses `:root { … \n}` as a flat block and requires both themes
to define every tone, so no nested rule may be introduced inside `:root` and any
token added to one theme is added to the other. Verified: ui 26/26.

---

## Phase LP — Legacy parity restoration

### AUDIT.9 A request with no deadline, which stopped every scheduled job

[Opus 5]
Date: 7 August 2026
Summary: the audit's fifteenth finding, in the one process that had never been
tested — and the first test it has ever had. worker 0 → **4**.

#### How it surfaced

Not by reading. `test/erp/jobs.test.ts` failed twice on the worker-tick test with
`UND_ERR_HEADERS_TIMEOUT` after **308 seconds**, which is easy to dismiss as a
slow test on a loaded database. Asking *why is it slow* led to the tick's own
code, which iterates every entitled tenant and — since LP.22 — reaches real
carriers.

#### The defect

`fetch` has no default timeout. A platform that accepts the connection and never
answers holds the worker's `running` flag true **forever**: every subsequent tick
logs "previous tick still in flight, skipping this one" and **the scheduled work
stops permanently.** Escalations, the overdue sweep, carrier polling, stale-order
alerts and the notification prune all stop, for every tenant.

The only evidence is a warn line once an interval, which reads exactly like a
tick that is merely slow.

**It defeated the guarantee the file itself states.** The `catch` carries this
comment:

> Never rethrow: an unhandled rejection would take the process down and the
> scheduled work would stop until somebody noticed. The next tick retries.

With no deadline there IS no next tick. The reasoning was right and one line
elsewhere made it false — the same shape as AUDIT.5, where a deferral's stated
reason did not survive reading the source it described.

#### The fix

`AbortSignal.timeout(deadlineMs)`, defaulting to **ten intervals**. Not one: the
tick legitimately outlasts an interval on a large deployment, and a deadline near
the interval would abort healthy work and turn a slow pass into no pass at all.
Ten is far beyond any honest pass and far short of forever.

A timeout is **named separately** in the log, because the two failures need
different things done about them: "the platform did not answer in ten minutes"
means look at the platform; a connection refused means look at `WORKER_TARGET`.

#### The second defect, which the test found in the fix

The first version was
`Math.max(Number(WORKER_TIMEOUT_MS) || intervalMs * 10, 30_000)` — so the floor
clamped an EXPLICIT setting too, and the test's own `WORKER_TIMEOUT_MS=2000` was
silently raised to 30 seconds. The floor exists to stop a tiny interval making
the deadline flaky; **a value somebody typed is an instruction.** An operator
would have set it and watched nothing change. The floor applies to the derived
default only.

#### The first test this process has ever had

~90 lines holding no business logic, which is why it had none — and those lines
decide whether ANY of the jobs run at all.

It runs the worker as a **real child process** against a server that accepts the
connection and never responds, because the failure is about what happens BETWEEN
ticks: the defect is a call that never happens, and no unit test of `tick()` can
observe a call that is skipped. The assertions are: it gives up on its deadline;
**a second request reaches the server**, which is the proof the guard released;
and a hung tick never prints a line that looks like a completed pass.

**Verified causally**: with `signal:` removed the suite fails 2/4 with the
original symptom ("previous tick still in flight" repeating); restored, 4/4.

#### Files

- `services/worker/src/index.ts`
- `services/worker/test/tick.test.ts` (new)
- `services/worker/package.json` — a `test` script, which it had no need of before

**Migration:** none. `WORKER_TIMEOUT_MS` is optional. **Risk:** low — the default
is ten intervals, so a pass that completes today is unaffected.

---

### AUDIT.8 The question that found most of this, asked on every run

[Opus 5]
Date: 7 August 2026
Summary: the audit's most productive question becomes a test, and finds nine more
columns on the way in. db 29 → **33**.

#### Why this exists

The fourth pass asked one question more productively than any other:

> Which columns does something write that nothing reads, and which does
> something read that nothing writes?

It is the shape of **eight serious defects** across the project's life: BUG-02
(`deliveryOutcome` — eight readers, no writer), `IntegrationLog` (migrated with
its indexes, no caller), `OrderCall.suspicious` (computed, shown nowhere),
`fakeReason` (written since Phase 5, read by nothing), **A5** (`CatalogProduct`'s
lifetime counters maintained by NOTHING for the platform's whole life), A7,
**A11** (`AiProvider.lastTestAt`), **A14** (the channel parser dropping
`externalProductId`, leaving `resolveProduct`'s exact-link branch dead since it
was written).

One question, eight defects, asked by hand each time somebody thought to. It is
asked on every run now — `packages/db/test/orphans.test.ts`, beside the M-03/M-04
constraint suite whose header states the principle this follows: **mechanical,
not vigilant.**

#### What it found immediately

Nine columns, all in the PLATFORM schema — which the audit's own by-hand sweep
had never covered, because it read `erp.prisma` and stopped. Two are dead in the
legacy too. **Seven are unbuilt halves of platform features**, and each is now
recorded with the work that would reference it rather than left to be
rediscovered:

| Column | What is missing |
|---|---|
| `TenantDomain.verificationToken`, `isPrimary` | No screen adds a custom domain. **The read path is complete and safe** — `tenantByDomain` refuses a row with no `verifiedAt` — so nothing can be claimed; there is simply no way to add one. |
| `Session.lastSeenAt` | Session management. Writing it per request is a write per request, which is the design question that work must answer first. |
| `Subscription.seats` | **No seat limit is enforced anywhere** — the invitation route admits as many people as a tenant invites. |
| `Subscription.externalCustomerId`, `externalSubscriptionId` | The billing provider integration, which does not exist. |
| `Subscription.trialEndsAt`, `currentPeriodEnd`, `cancelAtPeriodEnd` | Nothing moves a subscription to PAST_DUE when a period or trial ends. A status changes today only because somebody changes it. |

**None is an ERP parity gap** — the legacy is single-tenant, sells nothing and
has no domains. They are platform work, and they are in NEXT_STEPS now.

#### What the exemption list is allowed to say

A reason must state **what would make the column referenced**, and there are
exactly two acceptable answers:

- **DEAD BOTH SIDES** — the legacy does not use it either, so nothing ever will.
- **AHEAD OF A FEATURE** — naming the work. An entry that cannot name it is a
  finding, not an exemption.

Two further tests keep the list from becoming somewhere findings hide: an
exemption for a column that no longer exists fails, and so does an exemption for
a column that has since acquired a reference.

#### What it cannot see, stated in the file rather than implied

It is a NAME check, not a dataflow analysis. It catches a column no source file
mentions at all — which is what A5 was — and **not** one that is read but never
written when both are the same identifier, which is what A11 was
(`lastTestAt` was named by the carrier routes). The cheap half of the question is
mechanical now; the expensive half stays a thing a person asks.

**Verified to fail.** A column was added to `Carrier` that nothing names, the
suite went red naming it, and it was removed.

#### Files

- `packages/db/test/orphans.test.ts` (new)

**Migration:** none. **Risk:** none — a test.

---

### AUDIT.7 Three fields the parser threw away, and a branch that had never run

[Opus 5]
Date: 7 August 2026
Summary: the audit's fourteenth finding, and the one with the largest silent
consequence — a dead code path that AUDIT.3 had just made expensive.
integrations 75 → **80**.

#### The finding

`FulfillmentOrder.externalProductId`, `externalVariantId` and `externalOrderAt`
exist in the schema, the last carrying the comment `// was shopifyCreatedAt`.
**Nothing has ever written any of them.** The parser reads a platform payload,
takes seven fields out of it and drops these three on the floor.

#### Why the first one is expensive

`resolveProduct` reads `externalProductId` **first**, and its own comment says
what that means:

> A link that resolves DECIDES, including deciding "this one and not the name
> match".

**That branch has been dead for every order ever written.** Every channel order
falls through to matching the catalogue by NAME — and AUDIT.3 had just made name
matching REFUSE when two catalogue rows share one, because guessing was worse.

So the combined state before this slice: a tenant selling through Shopify with
two products called "Montre" got **no lifetime counters on either**, and a badge
telling them to go rename something — while every one of those webhook payloads
was carrying the `product_id` that resolves it exactly. AUDIT.1 built the link's
display, AUDIT.3 made the fallback honest, and the identifier that makes the
fallback unnecessary was being discarded one function earlier.

#### Why no test caught it, which is worth more than the fix

`delivery.test.ts` covers the link branch **thoroughly** — including the sharpest
case, "an order linked to ANOTHER product is refused, even when the names match".
It reaches that branch through a helper: `setOrderExternalProduct` writes the
column directly.

So the branch was proven correct and unreachable at the same time. **A test that
stages the state a production path is supposed to produce cannot tell you the
path produces it.** That is a general property of fixture helpers and it is worth
naming: the helper is what made the coverage look complete.

#### The second: a date that is not the date

`externalOrderAt` is when the CUSTOMER ordered. `createdAt` is when this system
heard. They are the same second in the good case and hours or days apart in the
ones that matter — a replayed backlog when a store is first connected, a retried
webhook, an outage. The legacy stored it. **Losing it means a connected store's
whole history lands on the day it was connected.**

It is rendered on the order detail **only when it differs from `createdAt` by
more than a minute**: two dates side by side that always agree is a field people
stop reading, and the case worth seeing is the one where a week of backlog all
says "arrived today".

A malformed date leaves the column **null** rather than an Invalid Date, which
would be either a throw or a row no date range can ever match — and this is a
field the remote platform controls and we do not.

#### Files

- `apps/website-builder/src/lib/erp/webhooks.ts` — the shape, the generic
  parser, `externalDate`, and the three columns on the create
- `apps/website-builder/src/lib/erp/channel-adapters.ts` — both registered
  adapters, each reading its OWN payload's spelling
- `apps/website-builder/src/lib/erp/orders.ts` — `ORDER_LIST_SELECT`
- `apps/website-builder/src/app/console/erp/orders/[id]/page.tsx`
- `packages/i18n/src/messages/{ar,en,fr}.json` — 1 key × 3
- `apps/website-builder/test/erp/integrations.test.ts` — 5 regression tests,
  the last of which drives the whole path: two same-named products, a link on
  one, a webhook order, and the counter landing on the linked row

**Migration:** none — all three columns already exist. **Risk:** low. Every field
is optional and absent ones behave exactly as before; the attribution change is a
strict improvement (an exact id now decides where a name previously refused).

**Not backfilled**, for the reason recorded in AUDIT.1: these are historical
facts about orders already written, and inventing them from current state would
produce a different, authoritative-looking number.

---

### AUDIT.6 Two things an operator could not reach

[Opus 5]
Date: 7 August 2026
Summary: the audit's twelfth and thirteenth findings, both of the same shape and
both found by applying AUDIT.5's lesson one question further — **an endpoint
existing is not a workflow existing.** jobs 27 → **31**.

#### A12 — "Run it now", with nothing to press

`POST /api/erp/jobs/[job]` has existed since M-15. **No screen has ever called
it.** Its own comment states the operator need it was built for:

> A manager needs to be able to say "run it now" after changing a threshold,
> rather than waiting out an interval to see what it does.

and, on the response:

> whoever pressed "run it now" is owed the result.

There was no "run it now" to press. The route was reachable by typing a URL,
which is a thing an engineer can do — not a workflow. `access.test.ts` covered it
and the jobs suite drove it; both were testing a door with no corridor to it.

It belongs on the **automation** screen and nowhere else, because every job acts
on a rule configured directly above it: the escalation interval, the overdue
threshold, the poll cadence, the stale window. Changing a number and watching
what it does is one act, and splitting it across two screens is how a manager
ends up not checking.

The list is `JOBS`, imported from the module the route validates against —
D-LP.3. A second list here would go stale the moment a job is added, and it would
fail as a button that 404s. **The test asserts both directions**: every job the
route accepts has a control, and every control the screen offers is a job the
route actually runs.

#### A13 — a roster with no way to add to it, and no sentence saying why

`/console/erp/agents` lists the staff and has no "add a person" control. **That
is correct** — inviting somebody is a platform action (M-02), and routing it
through a product would give every product a way to create accounts in every
other one.

The defect is that the reasoning lived in a **source comment**. An operator
standing on the staff roster saw a table, no button, and nothing at all
explaining where people come from; the legacy has "Add agent" right there. It is
LP.17's defect inverted — a nav item that led to a 404 versus a screen with a
missing signpost — and it fails the same way: the capability exists and nobody
finds it.

There is a sentence now, and **D-06.2 decides whether it carries a link**.
`platform:team:*` is on the SENSITIVE list, so `erp:agents:manage` does not carry
it: somebody granted the roster by name would otherwise be sent to a screen that
404s at them.

#### The method, stated because it is what found both

AUDIT.5's lesson was *read the source a deferral claims to be about*. This is the
next question along: **for every route, which screen calls it?** Two answered
"none" while their own comments described an operator pressing a button. Grep the
route path across `.tsx` — an empty result on a route documented as an operator
action is the finding.

#### Files

- `apps/website-builder/src/components/console/erp/job-runner.tsx` (new)
- `apps/website-builder/src/app/console/erp/automation/page.tsx`
- `apps/website-builder/src/app/console/erp/agents/page.tsx`
- `packages/i18n/src/messages/{ar,en,fr}.json` — 8 keys × 3
- `apps/website-builder/test/erp/jobs.test.ts` — 4 regression tests

**Migration:** none. **Risk:** none — no route, permission or calculation
changed. Both are paths to things that already worked.

---

### AUDIT.5 The Test Connection button, and a reason that did not survive re-reading

[Opus 5]
Date: 7 August 2026
Summary: the audit's eleventh finding — two columns with three readers and no
writer, left behind by a deferral whose stated premise was false. ai 20 → **31**,
access 201 → **203**.

#### The finding

`AiProvider.lastTestAt` and `lastTestOk` are selected by BOTH provider routes and
rendered by the AI screen. **Nothing has ever written them.** It is BUG-02's shape
for the fourth time — columns migrated with their legacy meaning intact, readers
built on top, writer left behind in the port.

#### The part that makes it worth a card of its own

LP.17 did not miss this. It recorded the absence and gave a reason:

> `/test` is NOT [here], and the reason is stated rather than left as a gap:
> testing a provider means calling a model, which needs an adapter layer this
> deployment does not have.

**The rule is right and the premise is false.** The legacy's own three adapters
were read again for this audit:

| adapter | what its `testConnection` actually does |
|---|---|
| `openai-compat` | `GET /models` — lists what the key can see. No inference. |
| `gemini` | `GET /models?key=…` — the same. |
| `anthropic` | `POST /messages` with `max_tokens: 1` — a ping, because Anthropic publishes no models list. |

It is a CREDENTIAL CHECK, not a chat feature, and it needs none of Tier 4 slice
27. A deferral with a reason attached reads as a decision and stops being
re-examined — which is why this one survived four passes when A5's bare absence
did not.

#### Why it matters more here than for a carrier

A carrier key that is wrong shows up the first time somebody books a parcel. **A
model provider key that is wrong shows up at chat time — which on this deployment
is never**, because `ai/chat` answers 501. An operator could configure a provider,
see it listed, mark it default, and never learn the key was pasted with a
trailing newline. AUDIT.1 added presets to make a wrong base URL less likely;
this is the part that finds out.

#### What landed

- `POST /api/erp/ai/providers/[id]/test` — plan (in a transaction), call (in
  none, through `afterCommit`), record (in a fresh one). **D-LP.5.1**, the same
  three phases as `carriers/[id]/test`.
- `GET /api/erp/ai/providers/[id]/logs` — the third entity on `IntegrationLog`,
  after LP.14's carriers and LP.15's channels. Without it a failed test is a red
  tick: "the key is wrong" and "the base URL points at a host that does not
  answer" have different fixes.
- `lib/erp/ai-connection.ts` — the three testers, ported call for call. It takes a
  config object and not a `db`, so a caller cannot hand it a transaction.
  **D-LP.2**: an unregistered type refuses rather than reporting success.
- The screen: a Test button and a log panel per row, and the cell that said
  *"Testing needs a model adapter"* forever now reads a date and a tick, or the
  same "Never tested" the carriers and channels screens use.
- `erp.ai.testUnavailable` is **deleted** from all three locales. A string that
  describes a limitation the build no longer has is worse than no string.

#### The five strings are not new

`test`, `testing`, `logs`, `hideLogs`, `noLogs` are the carrier and channel ones,
reused — a fourth near-identical copy of "Hide log" is a translation somebody has
to keep in step with two others for no gain.

#### Files

- `apps/website-builder/src/lib/erp/ai-connection.ts` (new)
- `apps/website-builder/src/app/api/erp/ai/providers/[id]/{test,logs}/route.ts` (new)
- `apps/website-builder/src/lib/erp/integration-log.ts` — `aiProvider` on `LogEntity`
- `apps/website-builder/src/components/console/erp/ai-write.tsx`
- `apps/website-builder/src/app/console/erp/ai/page.tsx`
- `apps/website-builder/src/lib/console/erp-strings.ts`
- `packages/db/prisma/schema/erp.prisma` — the `entity` comment
- `apps/website-builder/test/erp/ai.test.ts` — 11 regression tests

**Migration:** none — no column changed, only a comment. **Risk:** low; every
path is new, and the one edit to an existing screen replaces a permanently-false
label with a real state.

---

### AUDIT.4 A translation key that only existed in the code

[Opus 5]
Date: 7 August 2026
Summary: the audit's tenth finding, read out of the running server's log — and
the test that closes the class. i18n 18 → **20**.

#### The finding

AUDIT.1's product-detail screen asked for `t("erp.overview.revenue")`. **That key
did not exist in any catalogue.** `next-intl` throws `MISSING_MESSAGE` at RENDER
time and only in the missing locale, so it is a 500 on one screen for the readers
of one language and a green suite for everybody else — and Arabic is the DEFAULT
locale here, which is the only reason it surfaced.

It surfaced in the server log while a live order was being driven through the
console, not in any test.

#### Why the existing test could not see it

`packages/i18n/test/messages.test.ts` asks two questions, both derived and both
sound: do the three locales carry the same keys, and does every key the PRODUCT
MANIFESTS and the STATUS REGISTRIES name exist. Its own header says the keys "are
read from the product manifests and the status registries, so a product added
later is covered automatically rather than only if somebody remembers to extend a
test".

Neither question looks at the place keys are actually used: a `t("…")` call in a
component. The catalogues agreed with each other perfectly and with the code not
at all.

#### The fix, and the class it closes

The suite now reads every `t("literal")` in the console source and asserts the
key exists in every locale — the same general form as LP.17's navigation test and
AUDIT.2's route inventory: **derive the list rather than maintain one.** It
scans 300+ keys.

**Verified to fail.** The key was deleted from `ar.json` and the suite went red
naming it and the file; then it was restored. A test that has never been seen to
fail is a test nobody should trust, and this one was written for a defect that
had already shipped.

**What it cannot see, stated in the file rather than implied:** a key built at
runtime — `` t(`erp.period.${type}`) ``, `t(tone.labelKey)` — is invisible to a
static scan. Those are covered by the manifest and status-registry checks above
it and by the contract suites that render the screens.

#### And the second, smaller defect on the same line

The overview's revenue tile was borrowing `erp.overview.delivered` for its label,
so the dashboard showed **two tiles with the same label and different numbers** —
a delivered COUNT and a delivered VALUE. It has its own label now.

#### Files

- `packages/i18n/test/messages.test.ts` — the code scan
- `packages/i18n/src/messages/{ar,en,fr}.json` — `erp.overview.revenue`
- `apps/website-builder/src/app/console/erp/page.tsx`

**Migration:** none. **Risk:** none.

---

### AUDIT.3 A duplicated product name, found by driving a real order

[Opus 5]
Date: 7 August 2026
Summary: the audit's ninth finding, and the only one no test could have found —
it took placing an order through the running console. screens 167 → **169**.

#### How it was found, which is the point

AUDIT.1's contract tests passed 167/167. The counters were then exercised
against the live server by signing up a tenant, creating a product, placing an
order and confirming it — and the product still read `totalOrders: 0`.

The counters were working perfectly. They had landed on a DIFFERENT product with
the same name, created a minute earlier by a curl that had errored on its
response parsing and succeeded on the server. Every test creates its own tenant
with one product per name, so no test could see it.

#### The defect

`resolveProduct` did what the legacy does —
`products.find(p => normalize(p.name) === normalize(order.product))` — and took
**the first row that matched.**

Two catalogue rows answering to one normalised name is not exotic: it is what an
import produces, what a duplicate entry produces, and what listing two colours as
two products produces. When it happens, every order's lifetime counters land
silently on whichever row was created first, and the other reads zero forever
with nothing to explain it.

**The same ambiguity is worse in `/sales-summary`,** because that direction asks
"which orders are mine" per product: BOTH rows claim the same orders, and the
P&L counts that revenue twice.

#### The fix — the rule this project already has, in a third place

D-LP.5.2 (ZR's commune), D-LP.22.2 (Ecom's wilaya) and LP.16a (the exclusive
channel link) all say the same thing: **a resolution that could be one of two is
refused rather than guessed, because the wrong answer looks exactly like the
right one.**

So an ambiguous name attributes to NEITHER row. It cannot refuse the ORDER —
a sale must not fail over a catalogue tidiness problem — so the counters simply
do not move, and **both rows are marked on the products screen**, which is where
somebody can fix it by renaming one. A counter that silently does not move is
the same class of defect as one that silently moves to the wrong row; the badge
is what makes it neither.

The badge carries the consequence in its tooltip rather than just the word
"duplicate": an order naming it is attributed to neither, and the sales summary
would count its revenue twice.

#### Files

- `apps/website-builder/src/lib/erp/product-stats.ts` — refuse on ambiguity,
  plus `duplicateProductNames` as the reader
- `apps/website-builder/src/app/console/erp/products/page.tsx`
- `packages/i18n/src/messages/{ar,en,fr}.json` — 2 keys × 3
- `apps/website-builder/test/erp/screens.test.ts` — 2 regression tests, one of
  which asserts the badge CLEARS after a rename

**Migration:** none. **Risk:** low, and it is a narrowing: a name that resolved
to an arbitrary row now resolves to none, which is visible instead of silent.

---

### AUDIT.2 The list that could not catch the mistake it existed for

[Opus 5]
Date: 7 August 2026
Summary: the audit's eighth finding — `access.test.ts`'s hand-written route
inventory was 34 routes short. access 95 → **201**.

#### The finding

`SURFACES` in `test/erp/access.test.ts` is the anonymous-caller inventory, and
its own comment says it exists *"because a route added later without a permission
is exactly the mistake this catches."*

**A hand-written list cannot catch that.** The audit diffed it against the
filesystem and found **34 unlisted ERP routes**, including three that matter
more than most:

- `POST /orders/[id]/call` — the payroll-fraud surface `hardening.test.js` §3 was
  written for: logging a confirmed call on somebody else's order.
- `POST /products/[id]/inventory/adjust` — it moves stock.
- `POST /jobs/[job]` — it can suspend accounts.

**Every one of them was correctly gated.** This was a test-coverage gap and not
a hole: the derived run passes 201/201 first time. What was missing was the
guarantee, not the behaviour.

#### The fix is the general form, which this project has used before

LP.17 hit the identical shape in navigation — `screens.test.ts` enumerated
screens by hand and omitted `ai`, so a nav item 404'd for every member and
nothing caught it. The fix then was to read the MANIFEST and assert every
declared item; the fix now is to read the ROUTE FILES and assert every exported
method.

A route added tomorrow is covered without anybody remembering to add a line, and
one that ships without a gate fails here rather than in production. The
hand-written list stays: it carries the reasoning about WHY each surface is
interesting, which a derivation cannot.

**One exclusion, and it is stated in the file:** `/api/erp/webhooks/**` is
inbound and unauthenticated by construction — a carrier and a storefront have no
session, they are gated by signature and tenant slug, and `integrations.test.ts`
is where that is asserted. Nothing else is excluded; anything that needs to be
needs a reason written beside it.

**The derivation asserts it found something.** `files.length >= 30` guards the
failure mode of every "for each discovered X" test: a glob that silently matches
nothing makes every assertion below it vacuous and the suite green.

#### Files

- `apps/website-builder/test/erp/access.test.ts` — the derived inventory,
  106 new assertions

**Migration:** none. **Risk:** none — test-only.

---

### AUDIT.1 Four writers and four readers that never met

[Opus 5]
Date: 7 August 2026
Summary: the independent engineering audit, read module by module from
`apps/erp` rather than from the roadmap. Seven findings, all of one shape and
all fixed here. screens 152 → **167**.

#### What the audit looked for, and why it found this

Every parity pass so far has measured FEATURES. This one enumerated the legacy's
125 routes and 15 screens against the platform's, then walked the schema asking
a different question: **which columns does something write that nothing reads,
and which does something read that nothing writes?**

That is the shape of every serious defect this project has found — BUG-02
(`deliveryOutcome` read in eight places, written in none), `IntegrationLog`
(migrated with its indexes, no caller), `OrderCall.suspicious` (computed, shown
nowhere), `fakeReason` (written since Phase 5, read back by nothing). Seven more
were there.

#### AUDIT-5 — the biggest: a product's lifetime counters were maintained by nothing

`CatalogProduct.totalOrders`, `cancelledOrders`, `totalRevenue` and
`firstOrderAt` have existed since M-06 under the schema comment *"denormalized
lifetime counters, maintained by the order pipeline"*. `PRODUCT_SELECT` returns
all four from `GET /api/erp/products`.

**Nothing has ever written one.** The port brought `upsertClientFromOrder` across
as `syncClientFromOrder` and left `upsertProductStatsFromOrder` behind, so every
product on this platform has reported zero orders and zero revenue for its whole
life. Nothing errored, every number was a real number, and a product that had
sold two hundred units said it had sold none. BUG-02 exactly.

`lib/erp/product-stats.ts` is the writer, called from `createOrder`,
`updateOrder` and `settleOutcome` — the same three doors `syncClientFromOrder`
already used, in the same transactions, so the two ledgers can never describe
different events. Three columns were added so the set is coherent
(`confirmedOrders`, `deliveredOrders`, `lastOrderAt`).

**`totalProfit` is deliberately NOT a column**, though the legacy has one. It
depends on the cost basis at the time of sale, `/sales-summary` already answers
it period-accurately from the movement ledger, and a denormalised lifetime profit
would be a second answer that drifts the first time a lot is corrected.

**Which product an order is goes through `product-match.ts`** — the channel's
`CatalogProductLink` first and exclusively, then a normalised name. Using the
same resolver the revenue attribution uses is what stops the counters and
`/sales-summary` disagreeing, and it means a product called `Montre™` is not left
at zero forever (LP.16a's defect, which an exact string compare here would have
reintroduced).

**`lastOrderAt` only moves forward and `firstOrderAt` only backward**, because
LP.19's import arrives with older `createdAt` values than rows already present.

#### AUDIT-3, AUDIT-6 — and the two other things on the same record

`CatalogProductEvent` has three writers (LP.1's four field events, LP.18's
`variants_changed`) and `GET /products/[id]/history` serves them; **no screen
rendered one.** It is the permanent record of what a cost basis used to be —
the only way to answer "why is last quarter's margin different from this one's".

`CatalogProductLink` decides revenue attribution FIRST and EXCLUSIVELY (LP.16a)
and is created by LP.20's product webhook; nothing showed which channels a
product was linked to, so a mis-linked product was invisible until its revenue
appeared on the wrong row.

`/console/erp/products/[id]` renders all three, which is the shape the legacy's
own product modal has: they are the same question asked three ways.

#### AUDIT-7 — a badge that could never appear, introduced by LP.8

LP.8 rendered the overdue-follow-up badge from
`FulfillmentOrder.callReminderStatus`. **Nothing on this platform writes that
column** — `POST /followup/tasks/[id]/resolve` says so in its own comment
("NO SECOND MARKER… nothing on this platform reads `callReminderStatus` at
all"), which was true when it was written and stopped being true when LP.8 added
a reader.

Fixed in the direction that decision already chose: `FollowupTask` IS the record,
so the badge asks the record. One more bounded page-scoped query beside the two
LP.8 added. `callReminderStatus` and `callReminderDue` are named in
`ORDER_LIST_SELECT` as dead, so the next reader knows before adding one.

#### AUDIT-4 — an append-only table that looked like a flat list

`FinancialRecord` is insert-only, which is P5's whole point: saving a period
twice keeps both rows, and `GET /financial-records/versions` (LP.16c) answers
"what did this week say before". **That route had no reader**, and the finance
table listed every row flat — two saves of one week as two adjacent, equally
authoritative lines, with nothing saying which one the business runs on.

The older rows are marked superseded, computed from the ordering the table
already has rather than by calling `versions` (a second query would be a second
answer to a question this list has already sorted itself into), and the screen
states WHY a period has two versions: almost always a parcel that came back
after the first calculation.

#### AUDIT-1, AUDIT-2 — a vocabulary that had quietly grown a second copy

`POST /api/erp/ai/providers` validated
`z.enum(["openai-compat", "gemini", "anthropic"])`, and
`console/erp/ai/page.tsx` declared its own identical `PROVIDER_TYPES` — under a
comment on the component reading *"the route's own enum, so a type it would
refuse cannot be offered"*, which was the intent and not what the code did. It is
the D-LP.3 defect in a place nobody had looked: silent the moment one of the two
changes.

`lib/erp/ai-providers.ts` is the one list, and it carries the **presets** the
legacy publishes (`GET /api/ai/providers/presets/:type`) and this had nothing
for: an operator configuring Gemini was shown an empty base-URL box and had to
know `generativelanguage.googleapis.com/v1beta` from memory. A field somebody
looks up in another tab is a field they get wrong, and a wrong base URL fails at
CHAT time rather than at configuration time. They are suggestions, not silent
defaults — switching type replaces them only where the person has not typed over
them.

#### What the audit checked and found NOT to be gaps

- Every one of the legacy's **15 screens** has a platform home, including the
  three that became something else deliberately: Alerts → the `suspicious=true`
  filter (LP.12), Export → the panel on the order list (D-LP.6.2), Import → the
  panels on the client and order lists (LP.19).
- **Every settings key** in the legacy's `DEFAULT_SETTINGS` exists in
  `SETTINGS_SCHEMA`, validated and with a control.
- The legacy's **three job loops** are a subset of the platform's four.
- `GET /api/erp/inventory/low-stock` has no console caller, and correctly: the
  inventory screen computes the same answer through the same `inventoryView`,
  which is the established server-component pattern rather than a second rule.
- `GET /api/erp/orders/stats` likewise — the overview needs six figures that
  route does not carry, so it reads its own, scoped by the same `orderScope`.
- `GET /api/statuses` and `/api/delivery/statuses` are genuinely absent and are
  Tier 4 slice 26 (R18) — the vocabularies reach every screen as props, and the
  routes matter only to a future external client.

#### Files

- `packages/db/prisma/schema/erp.prisma` — three counter columns
- `apps/website-builder/src/lib/erp/product-stats.ts` — new
- `apps/website-builder/src/lib/erp/ai-providers.ts` — new
- `apps/website-builder/src/app/console/erp/products/[id]/page.tsx` — new
- `apps/website-builder/src/lib/erp/orders.ts`, `shipments.ts`
- `apps/website-builder/src/app/console/erp/{orders,products,finance,ai}/page.tsx`
- `apps/website-builder/src/app/api/erp/{products,ai/providers}/route.ts`
- `apps/website-builder/src/components/console/erp/ai-write.tsx`
- `packages/i18n/src/messages/{ar,en,fr}.json` — 8 keys × 3
- `apps/website-builder/test/erp/screens.test.ts` — 15 new tests

**Migration:** three nullable/defaulted columns on `CatalogProduct`, applied with
`prisma db push`. Additive.

**Backfill: NOT done, deliberately.** The counters start from now. They are
LIFETIME EVENT counts — "how many times has an order of this product ever reached
confirmed" — and a backfill from current state would produce a different number
from the events (an order confirmed and then cancelled contributes to both
counters, and only the second is still visible). A wrong history that looks
authoritative is worse than one that visibly starts today. `/sales-summary`
answers the period questions from the order book directly and is unaffected.

**Risk:** medium. Every order write now resolves a catalogue product, which is
one indexed read plus a bounded catalogue scan for the name fallback — the same
work `/sales-summary` already does per product, moved to once per order write.

---

### LP.22 The Ecom adapter, and the poll finally leaves the transaction — **TIER 3 IS COMPLETE**

[Opus 5]
Date: 7 August 2026
Summary: R2's remaining half and N17. delivery 77 → **88**; jobs 16/16
unchanged. **Parity is reached at the end of Tier 3.**

#### R2 — the second real carrier

Ported from `apps/erp/lib/providers/ecom.js`. `X-API-Key` + `X-API-Token`,
`POST /colis` (an array of one to a hundred parcels), `GET /colis/{tracking}`,
and an `x-webhook-signature: sha256=<hex>` HMAC.

**D-LP.22.1 — the wilaya map is ported, and that is the OPPOSITE choice from
ZR's.** LP.5 resolves ZR's territories by NAME against a live endpoint because
ZR uses its own UUIDs and a local map would go stale. Ecom uses the STANDARD
Algerian wilaya numbers 1–58, which are set by the state and have changed once in
fifty years — the ten added in 2019, which are in the map. A live lookup would be
three round trips to learn something constant.

**D-LP.22.2 — the default-to-Alger fallback is NOT ported.** The legacy's
`getWilayaId` returns 16 (Alger) for anything it cannot resolve, **including an
empty wilaya**. That books a real parcel to the wrong PROVINCE: a courier drives
to Alger for a customer in Oran, the customer is never called, and the order looks
perfectly booked. It is exactly D-LP.5.2's commune fallback in a second place, and
it is refused here for the same reason — **by name**, so the fix is a spelling
correction somebody can make in a minute rather than a support ticket.

**Its `mapStatus` matches the longest key first**, which is the LP.5 lesson made
structural: `guessStatus` tested `/livr/` before anything else, so "Sorti en
livraison" — a parcel that had just LEFT the depot — resolved to delivered and
settled revenue that was never collected. Sorting the substring match by key
length means "en livraison" cannot win inside "sortir en livraison".

**A polled event with an unreadable date is DROPPED; a pushed one is stamped
now.** The asymmetry is deliberate. Intake dedupes on (shipment, eventTime,
originalStatus), so a synthesised time on a poll makes every pass look like new
events and the timeline doubles. A poll re-reads the whole history, so dropping a
row costs nothing; a webhook is the carrier telling us something happened at this
moment, and dropping it would lose a real delivery outcome.

**Its webhook check fails closed.** The legacy verified only when the header was
PRESENT, so omitting it skipped verification entirely — SEC-04, the same bypass
LP.5 removed from ZR's Svix check.

#### N17 — and why it had to be this slice

`pollCarriers` has run inside `withTenant`'s 15-second interactive transaction
since 6.6b. That was harmless because **no registered adapter could be polled**:
ZR declares `canPoll: false` and `planRefresh` refuses first, and `mock` is a
synchronous simulator. LEGACY_PARITY grouped the fix with this slice for exactly
that reason, and Ecom is the adapter that makes it live — `GET /colis/{tracking}`
means twenty-five parcels is twenty-five HTTP round trips inside fifteen seconds.

**`pollCarriers(tenantId, settings)` and `runJob(tenantId, job)` take no `db`, so
a caller cannot hand them one.** That is the property `bookShipment` has had since
D-LP.5.1, and the signature change IS the fix rather than a refactor. The three
other jobs still do all their work in one transaction — they touch nothing but
this database — and each gets its own binding inside `runJob`.

**The claim is committed BEFORE the network call.** `lastPolledAt` is matched in
the same `updateMany` that writes it, in its own short transaction, so two
workers ticking at once still cannot both call the carrier about one parcel —
and a carrier that never answers can no longer roll the claim back and cause the
same parcels to be re-asked on every tick forever.

**Both callers changed, as N17 predicted.** `POST /api/erp/jobs/[job]` runs it
through `afterCommit` (the response still waits — whoever pressed "run it now" is
owed the answer), and the worker's tick no longer wraps it at all.

**There is still exactly one ingest path.** The poll now composes
`refreshShipmentForOrder`, which is the same function the manual "ask the carrier"
button uses, so events still land through `ingestEvents` — where they are stored
idempotently, the delivery outcome is settled and follow-up tasks are raised.

#### Files

- `apps/website-builder/src/lib/erp/carrier-ecom.ts` — new
- `apps/website-builder/src/lib/erp/carriers.ts` — registered
- `apps/website-builder/src/lib/erp/jobs.ts` — `pollCarriers` and `runJob` unbound
- `apps/website-builder/src/app/api/erp/jobs/[job]/route.ts`
- `apps/website-builder/src/app/api/jobs/tick/route.ts`
- `apps/website-builder/test/erp/delivery.test.ts` — 11 new tests

**Migration:** none.

**Risk:** medium, and it is the job runner. `runJob`'s signature changed and both
callers with it; jobs 16/16 and delivery 88/88 pass. The poll now opens two short
bindings per parcel instead of one long one for the batch — more connections,
each held for milliseconds instead of for a carrier's latency.

**Not verifiable here:** no request has crossed a real Ecom Delivery endpoint.
The adapter is a port of a working one and every refusal path is tested against a
dead port; the success path needs credentials this repository does not have. It
is the same limitation ZR carries (PROJECT_STATE, *Known bugs*).

---

### LP.21 A difficult customer can be moved, and the deadline ticks

[Opus 5]
Date: 7 August 2026
Summary: R13 and N14 — `POST /api/erp/followup/assign`, the per-row control on
the follow-up screen, and a countdown that moves. integrations 63 → **75**,
access 94 → **95**.

#### R13 — the business case is one sentence

A supervisor cannot move a difficult customer to a senior agent. LP.9 built the
RULE (`assignFollowupAgent`) and reached it only through the bulk action; this is
the single-order door, on the screen a supervisor is already looking at.

**`auto: true` is not the same request as an omitted agent.** A body with neither
`userId` nor `auto: true` is a 422, not a silent automatic assignment — a
supervisor who meant to name somebody and left the select empty must not discover
the system picked for them. The control matches: "Automatic" is its own button
rather than an empty option in the select.

**Two refusals, because they send you to different screens.** `NO_FOLLOWUP_AGENTS`
means nobody on the team carries the job role at all — a settings problem.
`NOT_ELIGIBLE` means the person you named cannot take work right now: suspended,
on a day off, or without `erp:orders:write` (D-06.6). It lists who CAN. A single
"failed" would send a supervisor to the wrong place.

#### The notification the port dropped with the route

The ERP broadcasts `followup_assigned` to the chosen agent, and the platform had
no equivalent. Work that lands in a queue silently is work nobody knows they
have, and follow-up work is a customer WAITING for a call — the whole department
exists because that call has a deadline.

**Addressed to the PERSON, not to the supervisors**, which is the opposite
audience from `notifyNewOrder` and deliberately so: a manager who has just pressed
"assign" does not need telling what they did, and a feed that repeats your own
actions back at you is a feed people stop reading.

**Only when it MOVED.** Re-assigning somebody to the order they already hold
notifies nobody; a test asserts it.

#### N14 — the countdown

The legacy ticks every 15 seconds in place. The platform rendered a formatted due
date and nothing moved — on a screen whose entire subject is a deadline, which is
most of the information missing: "14:20" answers nothing without knowing what
time it is now, and "in 3 minutes" answers it exactly.

**It is a client component and that is not a D-06.3 violation.** It derives
nothing from the server and writes nothing: `dueAt` is the server's fact, and this
renders the DIFFERENCE between it and the browser's clock. Server-rendering that
difference would bake in the render time and be wrong by however long the page has
been open — which is the actual defect on a screen people leave open all day.

**The first render is the server's.** `now` starts null and the absolute time
shows until the first tick, so there is no hydration mismatch on a timestamp and
a reader without JavaScript keeps a real answer. The absolute time also stays as
the `title`: "in 3 minutes" is what to act on, "14:20" is what to write on a note.

**Fifteen seconds, as the legacy.** A per-second tick re-renders a hundred rows
sixty times a minute for a number whose useful resolution is a minute.

#### Files

- `apps/website-builder/src/app/api/erp/followup/assign/route.ts` — new
- `apps/website-builder/src/components/console/erp/followup-assign.tsx` — new
  (the control and the countdown)
- `apps/website-builder/src/app/console/erp/follow-up/page.tsx`
- `apps/website-builder/src/lib/erp/notify.ts` — `notifyOrderAssigned`
- `apps/website-builder/src/lib/console/erp-strings.ts`
- `packages/i18n/src/messages/{ar,en,fr}.json` — `erp.followUp.*`, 8 keys × 3
- `apps/website-builder/test/erp/integrations.test.ts` — 12 new tests
- `apps/website-builder/test/erp/access.test.ts` — 1 new surface

**Migration:** none.

**Risk:** low. The route composes `assignFollowupAgent`, which LP.9 shipped and
tested; this adds the single-order door, the two refusal codes and the
notification.

---

### LP.20 The three inbound paths the port dropped

[Opus 5]
Date: 7 August 2026
Summary: R19 — lead capture, product sync, and Shopify topic routing.
integrations 47 → **63**.

#### Lead capture — a real revenue path, and the only one that catches it

The legacy built this after confirming, against six real-webhook tests, that
**no LightFunnels event exposes a phone number** before an order is either
completed or genuinely abandoned-and-forgotten. A visitor who types their number
into a checkout form and closes the tab is a callable lead worth real money, and
every event-based route misses them. So a small script on the checkout page posts
here directly, bypassing the platform's event system.

**D-LP.20.1 — this endpoint has no signature, deliberately.** The caller is
JavaScript on a public page; a webhook secret embedded in that page is not a
secret. What that costs is stated rather than glossed: anybody who knows the URL
can create abandoned leads. Four things bound it, and they are the design:

- it can only ever create an `abandoned` row. `price` is forced to zero and
  `status` to `abandoned`, so nothing it makes can reach a revenue figure.
- it reads **four text fields by name**. There is no allow-list to get wrong
  because there is no spread.
- a channel with `webhookEnabled: false` accepts nothing, so a tenant being
  abused turns it off from the screen LP.15 built.
- every call is written to the integration log, so abuse is visible rather than
  inferred from a queue full of junk.

**D-LP.20.2 — the 24-hour merge window.** The script fires on every
keystroke-debounce: name, then phone, then wilaya. Without a merge that is four
leads for one person. It fills only fields that are still blank — the same
never-overwrite rule the import follows — so a later call cannot blank what an
earlier one set.

**D-LP.20.3 — cross-origin, and only here.** The script runs on the storefront's
own domain, so `OPTIONS` answers the preflight and the response carries `*`. That
is acceptable HERE and nowhere else: the endpoint is unauthenticated by design,
so there is no ambient credential for a cross-origin request to abuse — which is
precisely the property that makes CORS matter everywhere else.

The lead notifies with `abandoned_cart` rather than `new_order`, so LP.11's
signature for it is the abandoned-cart alert rather than the ka-ching. A lead
that walked away is a different urgency from a sale that landed.

#### Product sync — and the link that revenue attribution reads first

It saves the double catalogue entry, but the more important thing it creates is
the **`CatalogProductLink`** — the row tying a catalogue product to the
platform's own product id. LP.16a made `sales-summary` match on that link FIRST
and EXCLUSIVELY; without it, attribution falls back to matching a product NAME,
which is the defect that cost a product with a `™` in its name all of its
revenue.

**It never UPDATES an existing product.** A product already linked to this
external id is left exactly as it is. The catalogue here carries `costPrice`,
`packagingCost` and a stock ledger the storefront knows nothing about, and a
`products/update` webhook echoing a retail price back over a cost basis would
silently corrupt every margin, every FIFO lot and every saved P&L. A test edits a
cost basis and then re-delivers the webhook to prove it.

**It creates no stock.** A new product arrives at zero and its variants at zero;
opening stock is a movement (D-LP.18.1).

**A platform with no product adapter refuses to guess** — D-LP.2's rule, because
a catalogue row invented from a misread payload is worse than no row: somebody
prices from it. **The signature IS checked here**, unlike the lead-capture route
beside it, because this caller is the platform and a secret is a real secret.

#### Shopify sends every topic down one URL

The platform has `/checkout` and `/contact` as separate URLs, which is the better
shape when a tenant can configure per topic. A tenant configures ONE. So the main
endpoint now reads `x-shopify-topic`: `checkouts/*` is marked `abandoned` and
`draft_orders/*` is marked `draft`, exactly as the legacy routes them inside
`/webhook/shopify` — and for its stated reason, that an abandoned checkout
carries a different payload shape and force-fitting it into the order pipeline
produces a sale nobody made.

#### The defect a test caught: two places interpreting the topic

The first build had LP.15's Shopify adapter gate `parseOrder` to `orders/*` and
`draft_orders/*`, and LP.20's route mark a checkout abandoned. Those disagree:
the adapter refused `checkouts/create` outright, the route's abandoned-marking
never ran, and the topic produced **no row at all**.

The rule is now stated in both files. **The parser decides SHAPE; the route
decides MEANING.** `orders/*`, `draft_orders/*` and `checkouts/*` all carry the
same order-ish shape and the adapter reads all three; what a parsed payload MEANS
is read from the topic once, in the route.

#### Files

- `apps/website-builder/src/app/api/erp/webhooks/[tenant]/channel/[id]/lead-capture/route.ts` — new
- `apps/website-builder/src/app/api/erp/webhooks/[tenant]/channel/[id]/product/route.ts` — new
- `apps/website-builder/src/lib/erp/webhook-route.ts` — topic routing
- `apps/website-builder/src/lib/erp/channel-adapters.ts` — the shape/meaning split
- `apps/website-builder/src/lib/erp/notify.ts` — `notifyNewOrder` can say `abandoned_cart`
- `apps/website-builder/test/erp/integrations.test.ts` — 16 new tests

**Migration:** none.

**Risk:** medium, and it is the unauthenticated lead-capture endpoint. Its whole
threat model is written above the code; the four bounds are each asserted by a
test, including that a disabled channel accepts nothing and that an unknown
tenant answers identically to a known one.

---

### LP.19 A spreadsheet can come in, not only go out

[Opus 5]
Date: 7 August 2026
Summary: R5's fourth feature and R17's import — customer and order CSV import,
with a preview, per-row skip reasons and dedup by external id.
`test/erp/import.test.ts` is new at **25/25**; access 92 → **94**.

#### How a new tenant's history arrives, and there was no door for it

The schema has carried five `imported*` columns, an `importedSource` and an
`importedAt` since M-06 — declared, indexed, and rendered by LP.10's customer
screen — and **nothing could write any of them**. The registry could be exported
and not imported, which is half a round trip. The order half is R17: a back
catalogue of orders is what makes a new tenant's analytics, customer registry and
repeat-purchase campaigns mean anything on day one.

#### D-LP.19.1 — the file is parsed on the SERVER

The legacy parses the CSV in `index.html`, maps its columns there, and posts
"clean records" to an endpoint that trusts them. That is a second implementation
of the format living where nothing tests it, and it makes the API unusable by
anything except that one page — a migration script, a support engineer with
`curl`, a future mobile client would each have to re-implement the parser.

`parseCsv` is RFC 4180 including the parts people get wrong: a quoted comma, a
doubled quote, an embedded newline, `\r\n` / `\n` / lone `\r`, and a leading
BOM. The BOM matters concretely — **our own export writes one** because Excel
needs it, so without stripping it a file exported here and re-imported here
arrives with its first header named `﻿Name` and every column unmapped. A test
drives that exact round trip.

#### D-LP.19.2 — preview and commit are one request with a required `mode`

Two endpoints is two chances for the preview to describe something the commit
does not do. `mode` has **no default**, because the failure mode of a defaulted
`commit` is a spreadsheet written into a live registry by somebody who meant to
look at it first. The preview walks the identical path and writes nothing, which
is what makes it worth trusting.

The panel disables the commit button until THIS file has been previewed, and
choosing a different file clears the previous preview — otherwise an operator can
preview one file, pick another, and commit the second on the first's numbers.

#### D-LP.19.3 — an import never overwrites a real value

Ported verbatim from `importClientRecord`, and it is the whole safety of the
feature:

- identity fields (`name`, `wilaya`, `commune`, `address`) are filled **only
  where the stored value is blank**;
- the `imported*` figures are written **once**, on the first import that ever
  touches a client, marked by `importedSource` — a second import does not double
  them;
- the **live counters are never touched at all**. They are the sum of order
  events, and a file is not an order event. They land in their own columns, which
  is why those columns exist.

#### The two refusals that turn a wall into an instruction

**`NO_PHONE_COLUMN`.** A file whose phone column was not recognised produces
records with no phone, and every row is skipped as `no_phone` — which reads as
"the data is bad" rather than "the mapping is wrong". Named separately, with the
headers it saw, so the operator maps the column instead of editing the file.

**Per-row skip reasons.** A 400-row file with three bad numbers names those three
by row number (offset for the header, and counting from one) rather than
reporting "3 skipped" and leaving somebody to find them.

A header that maps to nothing is IGNORED rather than refused — real exports carry
a dozen columns nobody wants, and refusing over "Accepts Marketing" would be a
wall in front of a migration. The dictionary matches English AND French headers,
because the two files an operator has to hand are "the one I exported from here"
and "the one the old system gave me".

#### D-LP.19.4 / D-LP.19.5 — the order import

**It goes through `createOrder`, not around it.** `createMany` would be faster and
would produce orders with no `reference` (a customer cannot read a cuid back over
the phone) and a customer registry that does not know they exist — which is most
of what an import is FOR.

**No notification is raised.** Importing two years of history would push two
years of "new order" alerts at everybody holding `erp:orders:write`, and the
ka-ching LP.11 just built would fire a thousand times. `autoAssignOnCreate` IS
honoured, because a tenant with auto-assignment on wants the back catalogue
distributed.

**Dedup by external id, and it is the property that matters.** An operator who is
not sure whether the first import worked runs it again, and doubling the history
also doubles every customer's lifetime counters — which are append-only and
cannot be walked back. A file with no id column falls back to phone + total, and
the response **says** `dedupBy: "phone+total"` rather than presenting it as a
guarantee.

#### The defect a test caught: a Shopify export repeats the order row per line item

The first build checked the phone before the id. Shopify writes one row per LINE
ITEM and leaves every customer column blank on the continuation rows, so a
two-line-item order arrived as one order plus one `no_phone` skip — which reads
as a broken file rather than as the normal shape of the export. **The id is
checked first now**, and a row carrying an already-seen id is a duplicate
whatever else it carries.

#### Files

- `apps/website-builder/src/lib/erp/import.ts` — new: the parser, the
  dictionaries, and the merge rules
- `apps/website-builder/src/app/api/erp/clients/import/route.ts` — new
- `apps/website-builder/src/app/api/erp/orders/import/route.ts` — new
- `apps/website-builder/src/components/console/erp/csv-import.tsx` — new
- `apps/website-builder/src/app/console/erp/clients/page.tsx`
- `apps/website-builder/src/app/console/erp/orders/page.tsx`
- `apps/website-builder/src/lib/console/erp-strings.ts`
- `packages/i18n/src/messages/{ar,en,fr}.json` — `erp.import.*`, 15 keys × 3
- `apps/website-builder/test/erp/import.test.ts` — new, 25 tests
- `apps/website-builder/test/erp/access.test.ts` — 2 new surfaces

**Migration:** none. The `imported*` columns have existed since M-06 and finally
have a writer.

**Risk:** medium — these are the two largest writes on the surface. Bounded by
`IMPORT_LIMIT = 5,000` rows, refused by name above it; the whole run is inside
one transaction, so a failure part-way leaves nothing behind; and both commits
write an audit row with the counts, because "where did these 900 customers come
from" needs an answer.

---

### LP.18 The variant matrix, and three columns the port dropped

[Opus 5]
Date: 7 August 2026
Summary: R12 — `niche`/`category`/`supplier`, the missing form fields, and
`PUT /api/erp/products/[id]/variants`. It also closes the client filter LP.10
had to ship without. catalog 55 → **66**, registry 21 → **23**, access 90 → **92**.

#### R12 — a variant could be created once and never touched again

The ERP's `PUT /api/products/:id/variants` is its variant editor's write path,
and the port lost it. A variant could be created in the product's `variants`
array at creation and then never renamed, never removed, never given a
threshold — and its stock could only be moved through the generic adjust control
by typing the variant name exactly right. `optionDefs` has had a column since
Phase 3.2 with **no writer anywhere**, so the vocabulary a matrix is built from
could not be stored at all.

Multi-dimensional variants are how a clothing or cosmetics catalogue is
modelled, which in this market is most of them.

#### D-LP.18.1 — every stock difference goes through the ledger

The route may write the variants ARRAY directly — names, SKUs, images,
thresholds, option maps — because none of that is stock. It may **not** write a
LEVEL: a `stock` on an incoming variant is turned into a DELTA against what is
stored and applied with `applyMovement`, which writes the level and its reason in
one transaction. That pairing is the only reason the FIFO cost basis can be
trusted, and it is why `buildProductPatch` still refuses `variants` — the message
now names where they live instead of saying "not yet".

The ERP did the same thing: its editor called `inventory.setVariantStock` rather
than writing the column. This is the one part of the route that is not optional.

**An unchanged level writes NO movement.** Saving after correcting a SKU must not
manufacture a zero-delta row; a ledger full of no-ops is a ledger nobody reads.

#### D-LP.18.2 — removing a variant that still holds stock is refused by name

The ERP silently dropped it and the stock went with it: no movement row, no
reason, and a cost basis that no longer adds up. Zero it through
`/inventory/adjust` first — which records WHY: damaged, miscounted, returned to
the supplier — and then it can go. The refusal lists **every** variant that would
lose stock, because one at a time is four requests to discover four problems.

#### `erp:inventory:write`, not `erp:products:write`

The route moves stock, so it is gated on the permission `/inventory/adjust`
checks. Somebody who may only edit product TEXT must not be able to move a level
by renaming a variant. The panel is rendered under the same gate (D-06.2), which
is a different one from the edit panel directly above it.

#### The three columns, and the filter they unblock

`niche`, `category` and `supplier` are free text on `CatalogProduct`. Free text
rather than relations, deliberately: the ERP stored them as text, a niche list is
a handful of words per tenant, and a `Supplier` table would be a migration plus
RLS plus a management screen for something no route joins on.

**`niche` is the load-bearing one.** The legacy's CLIENT filter groups by it —
"everybody who has ever bought something in the skincare niche" is a
repeat-purchase campaign — and LP.10 had to ship the customer registry **without**
that filter and say so, because a control over a column that does not exist
matches nothing. It is offered now, and the legacy's own caveat is carried over
verbatim rather than silently assumed: an order stores the product NAME, so a
product renamed after its orders were placed will not match its niche. That is a
smaller wrong answer than no filter at all, and it is stated in the code.

**A niche no product carries narrows to NOTHING**, not to everything — the same
`null`-versus-`[]` distinction LP.10 established for the history filters.

#### The generator, and the one thing it must not do

The matrix generator builds the cross product of the option definitions.
**Existing variants keep their stock**: a generator that replaced the matrix
would silently zero every level it regenerated, which is a stock loss with no
movement row — precisely what D-LP.18.1 forbids. New combinations arrive at zero
and take their opening stock as a movement like everything else.

The generated name is the option values joined in definition order, which is
stable: regenerating after adding a size does not rename everything. It is also
what stops a catalogue growing "M / Blue" and "Blue / M" as two rows holding
separate stock.

#### The form fields R12 named

`description` was already there. `niche`, `category`, `supplier` and `image` are
added. The image is a text field and not an uploader — that is the honest state:
it is a URL like any other, and M-14 (base64 → R2) changes what goes IN it rather
than whether it can be typed. **What still has no control is uploading a file**,
and that is recorded rather than implied.

#### Files

- `packages/db/prisma/schema/erp.prisma` — three columns on `CatalogProduct`
- `apps/website-builder/src/app/api/erp/products/[id]/variants/route.ts` — new
- `apps/website-builder/src/components/console/erp/variant-editor.tsx` — new
- `apps/website-builder/src/lib/erp/catalog.ts` — the three fields, and
  `optionDefs` refused with a destination
- `apps/website-builder/src/lib/erp/inventory.ts` — `options` on `Variant`,
  `image`/`options` in `inventoryView`
- `apps/website-builder/src/lib/erp/clients.ts` — the `niche` filter
- `apps/website-builder/src/app/api/erp/products/route.ts`
- `apps/website-builder/src/app/console/erp/products/page.tsx`
- `apps/website-builder/src/app/console/erp/clients/page.tsx`
- `apps/website-builder/src/lib/console/erp-strings.ts`
- `packages/i18n/src/messages/{ar,en,fr}.json` — `erp.variants.*` + 4 keys
- `apps/website-builder/test/erp/catalog.test.ts` — 11 new tests
- `apps/website-builder/test/erp/registry.test.ts` — 2 new tests
- `apps/website-builder/test/erp/access.test.ts` — 2 new surfaces

**Migration:** three nullable columns on `CatalogProduct`, applied with
`prisma db push`. Additive; no backfill, and no RLS change (the policy is on the
table, not on its columns).

**Risk:** medium, and it is the ledger. The route is the second caller of
`applyMovement` and the first that can move several variants in one request. Every
difference is a delta with a reason; an unchanged level writes nothing; a removal
that would lose stock is refused. All three are asserted.

---

### LP.15 A storefront can finally be connected

[Opus 5]
Date: 7 August 2026
Summary: R8 — the sales-channel screen, the adapter registry, the connection
test, the integration log, and per-platform payload parsing. integrations
29 → **47**, access 87 → **90**.

#### R8 — full CRUD since Phase 5.3c, and nothing reached it

The channel API has existed since Phase 5.3c with contract tests in front of it,
and there was **no screen and no nav item**. A tenant could not connect a Shopify
store through the console at all — and the webhook URL, generated once on create,
was never shown again by anything, so even a channel created by hand through the
API was unusable. The single most valuable thing this screen produces is that
string.

#### The catalogue and the registry are two different lists

`PLATFORMS` is what a tenant may CHOOSE — the legacy's nine. `ADAPTERS` is what
this deployment can actually DO — Shopify and LightFunnels. `GET
/api/erp/sales-channels/adapters` publishes both facts per entry, and the screen
marks a platform with no live integration on its row and in the create form's
dropdown.

**Why the fallback exists here and does not for carriers.** D-LP.2 made an
unregistered CARRIER adapter refuse outright, because booking through a fallback
fabricated a tracking number and polling it then settled a delivery outcome for a
parcel that never existed. A channel adapter cannot invent anything: its two jobs
are checking credentials and reading a payload the platform PUSHED. Refusing the
seven unregistered platforms would mean a tenant on JustSell cannot connect a
store at all. So the fallback exists **and says so** — `structural: true` and a
message stating nothing was contacted, which is the same honesty LP.14 gave the
carrier test.

#### The defect a test caught: a registered adapter's `null` is an answer

The first build wrote `adapter?.parseOrder?.(…) ?? parseOrder(body)`. A Shopify
`products/update` topic — which the adapter correctly refuses — **fell through to
the generic parser**, which turned `{id, title}` into an order with no customer
and no total. LightFunnels' checkout stub would have done the same, which is the
exact empty-"Client / 0 DA"-row defect the legacy's comment warns about.

It is D-LP.2's rule in a new place: **a registered integration's refusal must be
honoured, never routed around.** The generic parser now applies only where there
is no adapter at all.

#### Per-platform parsing, and the two things the legacy learned the hard way

Shopify puts the total in `total_price` and the items in `line_items`;
LightFunnels wraps the order in `{ node: … }` and calls them `items`. One generic
parser reads Shopify tolerably and LightFunnels **not at all** — a tenant on
LightFunnels received orders with no product and no total.

Both LightFunnels rules are ported verbatim because they were discovered against
a live integration and cannot be re-derived from documentation: the envelope is
`node`, and **a checkout-stage stub fires with only an id** (prefixed `ch_`) the
instant a customer lands on the checkout page. Its id never matches the real
order's later, so there is nothing to update — no phone means no order.

#### The log, and what an operator can now find out

`IntegrationLog`'s `salesChannel` half had no writer. Four events land now:
`test_connection` / `auth_error` from the test, and `webhook_rejected` /
`webhook_unparsed` / `webhook_received` from the inbound path. That is the only
place an operator can find out WHY an order never arrived — a signature that did
not verify, a payload no adapter recognised, an access token the platform
rejected. The alternative diagnosis is "orders stopped", reported three days
later.

**A rejected webhook is still acknowledged with 200** (the platform would
otherwise disable the endpoint) **and now also recorded.** The payload is
deliberately still not logged: it is customer data of unknown provenance, and the
whole reason we are there is that we cannot say who sent it.

#### The screen

No credential is SELECTED — not masked afterwards, not loaded. That is the
carriers screen's rule and it applies with more force here: `webhookSecret` is
what proves an inbound payload came from the platform, so anyone holding it can
forge orders into a tenant's book. What is shown is whether credentials exist.

The webhook URL is **never truncated**. A URL shortened with an ellipsis and then
copied is a URL that silently does not work, and this one is pasted into somebody
else's admin panel.

Each row shows **how many orders have actually arrived through that channel**,
which is the question somebody opens this screen to answer.

Gated on `erp:settings:write` — what every channel route checks — **on the page**,
because it reads the database directly. 6.3d found exactly this hole on the
carriers page: a nav item is a hint, the URL is typeable.

#### Files

- `apps/website-builder/src/lib/erp/channel-contract.ts` — new
- `apps/website-builder/src/lib/erp/channel-adapters.ts` — new
- `apps/website-builder/src/app/api/erp/sales-channels/adapters/route.ts` — new
- `apps/website-builder/src/app/api/erp/sales-channels/[id]/test/route.ts` — new
- `apps/website-builder/src/app/api/erp/sales-channels/[id]/logs/route.ts` — new
- `apps/website-builder/src/app/console/erp/sales-channels/page.tsx` — new
- `apps/website-builder/src/components/console/erp/channel-write.tsx` — new
- `apps/website-builder/src/lib/erp/webhook-route.ts` — adapter parsing + logging
- `packages/product-registry/src/manifests.ts` — the `sales-channels` nav item
- `packages/i18n/src/messages/{ar,en,fr}.json` — `erp.channels.*` + 3 keys
- `apps/website-builder/test/erp/integrations.test.ts` — 18 new tests
- `apps/website-builder/test/erp/access.test.ts` — 3 new surfaces

**Migration:** none.

**Risk:** medium, and it is the inbound path. `webhook-route.ts` now parses
through an adapter where a registered one exists, so a tenant on Shopify or
LightFunnels gets a different (correct) reading of the same payload. Existing
channels on the other seven platforms are unchanged — they still go through
`parseOrder`. Two tests drive real Shopify and LightFunnels payloads end to end
and assert the resulting order.

---

### LP.11 The bell learns to make a noise — **TIER 2 IS COMPLETE**

[Opus 5]
Date: 7 August 2026
Summary: N4 and N5 — six Web Audio signatures with a per-family toggle and a
volume, plus desktop notifications, stored on `ProductSetting` rather than in a
browser. notifications 41 → **48**.

#### N4 — in a call centre nobody watches the screen

LP.7 gave the console a bell, a badge, a panel and a toast, and every one of them
is a thing you have to be LOOKING at. An operator is on the phone with their eyes
on a customer's address; the ka-ching IS the alert. The legacy CRM has six
distinct Web Audio signatures for exactly that reason, and one generic ping is
trained out within a day.

`components/console/notification-sound.ts` ports all six note for note —
ka-ching, the abandoned-cart descent, a two-note assignment bell, the
manipulation siren, the delivery honk and the follow-up trill. **Synthesised
rather than sampled**: six audio files are six requests, six things to cache and
six things to ship, and an `<audio>` element a browser refuses to play before a
user gesture fails SILENTLY. Web Audio is ~120 lines and no assets.

**It never throws.** Autoplay policy, a locked-down kiosk, a headless agent — a
notification that failed to arrive because its sound could not play would be a
far worse defect than a silent one.

**The family for an unmapped type is a neutral chime, never silence.** A
notification type added later is audible by default and somebody turns it off,
rather than inaudible by default and nobody finding out it exists.

#### D-LP.11.1 — `ProductSetting`, not `localStorage`

The one thing the legacy got wrong here. Its preference lives in `localStorage`,
so a manager who mutes the manipulation siren on the office desktop is un-muted
on the laptop, on the tablet and after clearing site data — and a supervisor
cannot tell whether an agent has silenced the alert that watches them. Stored
server-side under `platform` / `notify:<userId>`, it follows the person between
devices. That is D-05.4's mechanism applied to a platform concern: the table
exists so configuration needs no new table, it is tenant-scoped and RLS-covered,
and no platform model learns what a sound preference is.

#### D-LP.11.2 — the preference is per (person, tenant), deliberately

`ProductSetting` is tenant-scoped, so a consultant belonging to two companies has
two sets. That is the right answer rather than a limitation: the notifications
themselves are per tenant, and the volume somebody wants in a COD call centre is
not the volume they want in a quiet back office.

#### It is the caller's own, and there is no way to name a target

No `userId` in the query, in the body, or anywhere else — the session's own id is
used. The manipulation siren is the alert that catches an agent marking orders
confirmed without dialling, which makes it the one notification a person has a
motive to turn off **for somebody else**. A test posts `{userId: <colleague>}`
and asserts it is ignored.

**The volume is clamped, not trusted.** A stored 40 would be forty times the gain
the envelopes were designed for — a genuinely painful noise on a headset — and
junk falls back to 0.6 rather than to `NaN`.

#### N5 — the desktop notification, and two things the legacy got wrong

It fires **only when the tab is not visible**. A browser notification for a page
somebody is looking at duplicates the toast beside it; the legacy raised both
unconditionally.

**Permission is asked on a CLICK, never on load.** The legacy calls
`Notification.requestPermission()` during start-up, which is what trains people
to click Block — and a blocked permission can never be asked for again by that
origin. Here the request comes from the desktop toggle, at the moment somebody
has said they want it, and a denied permission is stated on the panel so an
operator wondering why nothing appears is told it is their browser.

**Tagged by entity**, as the legacy tags by order id: six carrier events for one
parcel replace each other in the tray rather than stacking six deep.

#### The build failure that produced `notify-vocab.ts`

The first build put the vocabulary, the types and the coercion in
`notify-prefs.ts`, which imports `server-only` — and the client components import
`SOUND_FAMILIES` and `soundFamilyOf`. The whole build failed with *"'server-only'
cannot be imported from a Client Component module"*.

Split: `notify-vocab.ts` carries NO directive and holds the vocabulary, the
mapping, the shape and `parseNotifyPrefs`; `notify-prefs.ts` is `server-only` and
holds the two database functions. It is the `edit-field.ts` pattern, and the
reason is recorded in both files so the split is not quietly undone.

**One coercion, not two.** `parseNotifyPrefs` is in the shared module so the
client renders from the same normalisation the server stores — a second copy
would eventually disagree about what `volume: "loud"` means.

#### Files

- `apps/website-builder/src/lib/platform/notify-vocab.ts` — new, directive-free
- `apps/website-builder/src/lib/platform/notify-prefs.ts` — new, `server-only`
- `apps/website-builder/src/components/console/notification-sound.ts` — new
- `apps/website-builder/src/components/console/notify-preferences.tsx` — new
- `apps/website-builder/src/app/api/platform/notifications/preferences/route.ts` — new
- `apps/website-builder/src/components/console/notification-provider.tsx`
- `apps/website-builder/src/components/console/console-shell.tsx`
- `apps/website-builder/src/app/console/settings/profile/page.tsx`
- `apps/website-builder/src/lib/console/erp-strings.ts`
- `packages/i18n/src/messages/{ar,en,fr}.json` — `notifications.*`, 18 keys × 3
- `apps/website-builder/test/erp/notifications.test.ts` — 7 new tests

**Migration:** none. An absent `ProductSetting` row is the default preference.

**Risk:** low. The shell's read shares the unread count's connection and its
fallback — a failed read leaves an operator hearing their alerts rather than
sitting in silence.

**Not verifiable here:** whether the six signatures actually sound distinct
through a headset, and whether a real browser raises the desktop notification.
Both need a person with speakers on a real device; the synthesis is a note-for-
note port and the permission handling is asserted structurally.

---

### LP.10 The customer registry stops being read-only

[Opus 5]
Date: 7 August 2026
Summary: R5 (three of its four features) — the detail route and screen, the
correction, the export, and the eight filters that were missing.
`test/erp/registry.test.ts` is new at **21/21**; access 84 → **87**.

#### R5 — the most valuable asset in the business could be read and nothing else

A COD business runs its repeat-purchase campaigns out of the customer registry.
The platform had ONE searchable list: no detail route, no detail screen, no
correction, no export, and eight of the legacy's twelve filters missing — while
the schema carried five `imported*` columns and an `address` for features that
did not exist, which is a standing invitation to assume they work.

Four surfaces land: `GET /api/erp/clients/[id]` (the record plus its complete
order history), `PATCH` (the four correctable fields),
`GET /api/erp/clients/export` (the list as a CSV) and
`/console/erp/clients/[id]`.

#### The rule this slice is built around: a counter is the sum of events

`PATCH` writes exactly four fields — `name`, `wilaya`, `commune`, `address` —
the ones with no reliable automatic source. An address is never captured by an
order at all; a name or a wilaya arrives misspelled from a storefront and must be
fixable without waiting for the customer to order again.

**Every lifetime counter is refused BY NAME, not dropped** (D-LP.1). The registry
rests entirely on the claim that `deliveredOrders` is how many times one of this
customer's orders actually reached delivered; a hand-edited counter is a number
with no events behind it. So are the `imported*` columns — an import is a record
of what a spreadsheet said, and editing it makes it a record of nothing. A caller
sending `totalSpent` believes they are setting a lifetime spend, and a 200 that
silently does nothing is the same class of defect LP.1 fixed in `costPrice`.

**`phone` is refused too, and that is the load-bearing one.** It is the identity
key (`@@unique([tenantId, phone])`) and every order joins to this record BY
VALUE. Editing it would either collide with another customer or silently detach
the record from its own history.

#### `erp:clients:write` is new, and SENSITIVE

Added to the ERP manifest and to `SENSITIVE` as `*:clients:write`, beside the
read. Correcting an address changes where a courier drives, and a role that could
WRITE the registry without being able to READ it would be an incoherent grant. A
MANAGER therefore does not hold it by role — only OWNER/ADMIN, or a named grant —
and the correction form is rendered only where it holds (D-06.2), with a test
that gives a MANAGER `erp:clients:read` alone and asserts they see the record and
no form.

#### The filters: one from eight, in the module that validates them

`clientFilters` and `clientFilterFields` sit beside each other for the reason
`orderFilterFields` sits beside `orderFilters` (D-LP.3). `wilaya`, `minOrders`,
`minDelivered`, `since`, `until` are columns on `Client`; `product` and
`salesChannelName` are **properties of the customer's ORDERS**, because a
customer buys many products from many channels over a lifetime and no single
value on the client row could be right. They resolve to a phone set first
(`clientHistoryPhones`) and are ANDed in — the legacy did the same thing with an
`EXISTS` subquery on `orders.phoneNormalized = clients.phone`.

**`null` and `[]` are different answers there**, and the distinction is a real
defect avoided: `null` means "no history filter was asked for", an empty array
means "the filter matched no orders". Treating the second as the first would
silently return the whole registry for a filter that matched nothing.

**`niche` is deliberately absent** — it needs `CatalogProduct.niche`, which is
not a column on this platform yet (R12, slice 18). A filter over a field that
does not exist is a control that matches nothing.

#### The export shares LP.6's writer, and that is not tidiness

`toCsv` and `EXPORT_LIMIT` carry the two spreadsheet properties that are security
rather than polish: a cell beginning `=`, `+`, `-` or `@` is a FORMULA to Excel —
and a customer name arrives from a storefront, typed by a stranger — and the file
needs a UTF-8 BOM or every accented wilaya opens as mojibake. **The BOM test
asserts bytes**, because `Response.text()` strips one by specification and the
obvious assertion cannot fail.

D-LP.6.2 applies unchanged: the export IS the list, through the same
`clientFilters` and `clientHistoryPhones`, which is why the link lives on the
list rather than on a screen of its own. It carries the legacy's own column
names — including the three `Imported *` ones, so an old-CRM import is not
invisible in the export.

#### What the detail screen deliberately does NOT do

The legacy attached a full parcel timeline to every row of a customer's history,
which cost **two extra queries PER ORDER** (the carrier name and the event list).
A customer with forty orders was eighty round trips on a screen somebody opens to
read a phone number. The delivery outcome and the tracking number are on the
order row already, and the order detail — one click away — has the whole
timeline.

The history is also bounded at 200. A registry entry for a wholesaler can carry
hundreds of orders; this is a screen, and the export is the unbounded answer.

#### Files

- `apps/website-builder/src/app/api/erp/clients/[id]/route.ts` — new
- `apps/website-builder/src/app/api/erp/clients/export/route.ts` — new
- `apps/website-builder/src/app/console/erp/clients/[id]/page.tsx` — new
- `apps/website-builder/src/components/console/erp/client-write.tsx` — new
- `apps/website-builder/src/components/console/erp/client-export.tsx` — new
- `apps/website-builder/src/lib/erp/clients.ts` — filters, patch, history
- `apps/website-builder/src/app/api/erp/clients/route.ts`
- `apps/website-builder/src/app/console/erp/clients/page.tsx`
- `apps/website-builder/src/lib/console/erp-strings.ts`
- `packages/product-registry/src/manifests.ts` — `erp:clients:write`
- `packages/auth/src/rbac.ts` — `*:clients:write` is SENSITIVE
- `packages/i18n/src/messages/{ar,en,fr}.json` — `erp.clients.*`, 10 keys × 3
- `apps/website-builder/test/erp/registry.test.ts` — new, 21 tests
- `apps/website-builder/test/erp/access.test.ts` — 3 new surfaces

**Migration:** none. `erp:clients:write` is a new permission nobody holds yet;
an OWNER and an ADMIN get it by role glob, everybody else by grant.

**Risk:** low. Every write is confined to four columns by an allow-list, and the
counters the registry's value depends on are refused rather than filtered.

---

### LP.9 The bulk bar finishes the job — and a reason nobody could read

[Opus 5]
Date: 7 August 2026
Summary: R7 — `classify`, `assignFollowup`, `createShipments` and
`sendToDelivery`. Plus an authorization drift the slice exposed and a
"written and never read" defect it found. orders 40 → **58**, screens 148 → **152**.

#### R7 — the legacy dispatches eight bulk actions and this dispatched three

`createShipments` is the single highest-volume manager action in the building:
booking a day's confirmed orders one at a time is the difference between a
minute and an hour. `assignFollowup` is how a supervisor moves a difficult
customer to a senior agent, fifty at a time. `classify` is how a duplicate
campaign's worth of fake orders gets marked.

`export` and `print` are the legacy's other two and are deliberately **not**
restored as bulk actions: its versions mutate nothing and exist only to validate
ids for a client that then builds the file in the browser. LP.6 gave the export a
real server-side writer, and `POST /orders/export` with `ids` is already what the
ticked-rows download calls.

#### The drift the slice exposed: bulk `classify` was STRICTER than the single route

Before LP.9 the rule was "everything except `status` requires `seesWholeBook`".
That is right for `delete` and `assign` and wrong for `classify`:
`POST /orders/[id]/classify` is `erp:orders:write` plus ownership and nothing
more, so **an agent could mark one of their own orders fake and not fifty.**

`ACTION_RULES` now names the permission and the manager requirement per action,
each taken from the route that already does that one thing to one order —
`erp:shipments:write` for the two booking actions, because that is what
`POST /orders/[id]/shipment` checks and an agent booking a parcel for their own
confirmed order is ordinary work. Approximating that rule is how it drifted.

#### D-LP.5.1 applies, which is why booking is a second phase

`withTenant` opens a 15-second interactive transaction. Fifty parcels is fifty
times three HTTP round trips to somebody else's server; holding a pinned
connection across them would time out and roll back — **including the
`carrierCode` writes `sendToDelivery` had already made**, leaving orders neither
routed nor booked. Phase one resolves ownership and stamps the carrier inside the
transaction; phase two books through `afterCommit`, sequentially, because fifty
concurrent bookings is how a tenant gets rate-limited off a carrier's API.

**`BULK_BOOK_LIMIT = 50`, refused BY NAME above it** — the `EXPORT_LIMIT` rule
(LP.6). A manager who ticks 200 rows, gets 50 parcels and a success message has
150 orders they believe are booked. The constant lives in `lib/erp/orders.ts`
rather than in the route because the order list renders the number beside its own
control: one constant, one answer.

**A carrier refusal is reported per id, carrying the carrier's own code.**
"Forty-nine booked, one has a misspelled wilaya" is a one-minute fix; "one
failed" is not.

#### `assignFollowupAgent` — the manual half of R13

The counterpart to `autoAssignFollowup`, differing in exactly two ways, both of
which are the difference between an automation and an instruction:

- **It ignores `followupAutoAssign`.** That setting answers "should the system do
  this by itself"; a supervisor pressing the button has already answered it. The
  legacy makes the same distinction with `opts.auto || settings.followupAutoAssign`.
- **It overwrites an existing assignee.** `autoAssignFollowup` refuses to,
  because filling a gap must never overrule a decision. Moving a difficult
  customer to a senior agent IS the decision, and it is the whole business case.

A named person is still checked against `eligibleAgents` — the same rule the
automation uses. Handing work to somebody the API would refuse produces a queue
nobody can work and a missed-order counter climbing against a person who was
never able to act (D-06.6). It is refused per id rather than assigned, and an
empty value means AUTO (the legacy's `auto: !value`).

**It writes an audit row**, as the legacy's `db.audit('order', id,
'followup_assign', …)` does. "Who put this customer on Karim?" is exactly the
class of question N12 found had no answer.

#### The defect the slice found: a classification reason nobody could read

`POST /orders/[id]/classify` has written `fakeReason`, `fakeResponsible` and
`fakeAt` since Phase 5, and **nothing read any of them back.** They were not in
`ORDER_LIST_SELECT`, so the order read did not return them; the detail screen
showed a bare "fake" pill and the list showed a bare badge.

Marking an order fake is an accusation — it removes the order from the confirmed
count and `fakeResponsible` names a colleague — so "why" and "who says" are
precisely the parts somebody disputes. Found by building the action that writes
them fifty at a time. Both now render: on the detail beside the pill, and as the
list badge's tooltip, the same shape the note badge uses.

#### Files

- `apps/website-builder/src/app/api/erp/orders/bulk/route.ts` — rewritten around
  `ACTION_RULES` and the two-phase booking
- `apps/website-builder/src/lib/erp/assign.ts` — `assignFollowupAgent`
- `apps/website-builder/src/lib/erp/orders.ts` — `BULK_BOOK_LIMIT`, and the three
  classification columns in `ORDER_LIST_SELECT`
- `apps/website-builder/src/components/console/erp/order-bulk.tsx` — six controls
- `apps/website-builder/src/app/console/erp/orders/page.tsx`
- `apps/website-builder/src/app/console/erp/orders/[id]/page.tsx` — the reason
- `packages/i18n/src/messages/{ar,en,fr}.json` — `erp.write.*`, 5 keys × 3
- `apps/website-builder/test/erp/orders.test.ts` — 18 new tests
- `apps/website-builder/test/erp/screens.test.ts` — 4 new tests

**Migration:** none.

**Risk:** medium, and it is the booking path. A bulk run asks a carrier up to
fifty times inside one request; the caller waits, which is deliberate (D-LP.5.1
is not a background queue). The limit is enforced server-side and the control
disables above it. Booking is idempotent per order — the `@@unique([tenantId,
orderId])` on `Shipment` — so a repeated run returns the existing parcels rather
than duplicating them, and a test asserts it.

---

### LP.8 The row acts, and says enough to act on

[Opus 5]
Date: 6 August 2026
Summary: N9, N10, N21 and N22 — the four findings no route inventory could see,
because nothing was missing from the API. screens 140 → **148**.

#### N9 — the two highest-frequency operations in the building cost a page load each

The legacy list row and board card each carry four controls: a status select, an
agent select, a carrier select and an express toggle. The platform had **none of
them**. Moving an order to `confirmed`, or handing it to another agent, meant
opening the order, changing it, and coming back — once per order, in a screen
whose entire purpose is working through fifty of them. §6.1 measured the click
difference and it is not close.

`components/console/erp/order-row-actions.tsx` puts all four on the row, and
every one calls `PATCH /api/erp/orders/[id]` (D-06.1). That is not a convenience:
it is the same route the detail screen's edit panel calls, so a status moved to
`confirmed` from a list select **reserves stock, books a parcel and raises a
follow-up task**, because it goes through the door that does all of that. The
ERP's own comment on its list dropdown says why — two doors into `confirmed`
that do different things diverge, and the difference surfaces in whichever one is
used less.

**Which controls exist is decided by the predicates the ROUTE uses, per row.**
`status` and `expressDelivery` are `AGENT_WRITABLE`, so they are offered to
anyone holding `erp:orders:write` for whom `mayTouchOrder` is true. `agentUserId`
is a REASSIGNMENT field — `buildPatch` answers `403 FORBIDDEN_FIELD` for a
non-manager — and `carrierCode` is `MANAGER_WRITABLE`, so both are offered only
where `seesWholeBook` holds. An agent gets two controls; a manager gets four.

**`mayTouchOrder` is asked per row even though `orderScope` admits the same set.**
They are two separate rules, and a screen that assumes they agree is a screen
that breaks silently the day one of them changes.

**The one place optimistic UI is allowed, and why it is not a D-06.3 violation.**
A controlled `<select>` whose value is the server's snaps back the instant a
person picks something, for the length of the request. `draft` exists to stop
that and nothing is derived from it: the badges, the total and the status pill
all come from the server re-render, and a REFUSAL resets `draft` to the stored
value rather than leaving the browser showing a change that did not happen.

#### N10, N21 — the row carried 8 facts against 14, and the four missing were the four that decide

Measured in §3b: overdue, called, noted and flagged were all absent. Every one of
them is what an operator uses to choose the next order to open, so their absence
means opening orders to find out.

The row now carries the type badge (draft / abandoned cart / order — a cart
nobody completed is not an order somebody agreed to), the fake flag, the overdue
tag, a flagged-call badge, a note badge whose **tooltip is the note itself** (as
the legacy row does it), the sales channel with its platform and brand, the date
**and the time**, the product variant and quantity, the delivery status and
tracking number, and the money **broken down** — items, delivery, discount —
because a customer disputing 4,900 is disputing one of three numbers and a total
alone cannot be checked.

**`orderRowFacts` derives them in `lib/erp/orders.ts`, not on the page.** The
list, the board and the queue all need the same answer to "is this abandoned",
and three copies is three chances for one screen to disagree with another about
the same order. `overdue` takes `alertMinutes` as an argument rather than reading
settings, because the dashboard banner and the queue badge already judge against
the tenant's own threshold — a number invented here would be a fourth opinion.

**Overdue is never-called AND old, not "old".** An order somebody has phoned three
times is being worked however old it is, and colouring it red teaches operators
to ignore the colour.

**The two facts that live on `OrderCall` are fetched for the PAGE, not per row.**
`ORDER_LIST_SELECT` still carries no call history — attaching it per row is what
made the ERP's list quadratic (3,006 ms on 5,000 orders, PERF-02), and that
decision stands. The flagged set and the newest note are two bounded queries over
the fifty ids already on the page: not a join, not per row, and unaffected by how
many orders the tenant has.

#### N22 — the changed row flashes

`components/console/row-flash.ts` plus one CSS animation. It marks; it never
merges — nothing writes a value into a cell, which would be the second copy of
the truth D-06.3 forbids. The row's contents come from the server re-render; this
only says *look here*.

**It retries until the row exists**, bounded at 20 × 120 ms ≈ 2.4 s. That is what
makes it work for somebody ELSE's change: a live notification arrives, LP.7's
debounced `router.refresh()` re-renders the table 500 ms later, and looking once
would flash the stale row or nothing. Bounded because a notification about an
order on page 4 will never find a row, and an unbounded retry keeps a timer alive
for the life of the tab.

**No directive on that module, deliberately.** It touches the DOM and is imported
only from `"use client"` components. Marking it `"use client"` would make its
exports client *references* rather than functions — the trap recorded in
`edit-field.ts` and paid for once already in 6.3b.

`prefers-reduced-motion` keeps the highlight and drops the fade. Removing the
mark entirely would take the *information* away from the people who asked for
less motion, not just the animation.

#### The defect this slice introduced and the existing tests caught

The first build gave `OrderRowActions` its own `data-order-id`. The LP.3 paging
tests count rows with `body.match(/data-order-id="/g)`, so every count on the
order list **doubled** — 100 rows on a page of 50, and five paging assertions went
red at once. The attribute is now `data-row-order`, and the reason is recorded in
the component so it is not reintroduced. The row it belongs to already carries
the id; a control inside that row does not need its own copy.

#### Files

- `apps/website-builder/src/components/console/erp/order-row-actions.tsx` — new
- `apps/website-builder/src/components/console/row-flash.ts` — new
- `apps/website-builder/src/app/console/erp/orders/page.tsx`
- `apps/website-builder/src/lib/erp/orders.ts` — `ORDER_LIST_SELECT` widened,
  `orderRowFacts` added
- `apps/website-builder/src/lib/console/erp-strings.ts` — `rowActionStrings`
- `apps/website-builder/src/components/console/notification-provider.tsx` — flashes
  the entity a live notification names
- `apps/website-builder/src/app/globals.css` — the `row-flash` animation
- `packages/i18n/src/messages/{ar,en,fr}.json` — `erp.row.*`, 16 keys × 3
- `apps/website-builder/test/erp/screens.test.ts` — 8 new tests

**Migration:** none. `ORDER_LIST_SELECT` gained scalar columns that already
existed, so the API's list and detail responses are additively wider.

**Risk:** low. The row controls are additive and gated by the same functions the
route checks; the two page-scoped call queries are bounded by the page size.

---

### LP.12 Accountability — a counter that only rose, a flag nobody saw

[Opus 5]
Date: 6 August 2026
Summary: R14, R11, N11, N12 and R15, plus a defect N12 turned out to be hiding.
screens 130 → **140**, team 56 → **62**, access 82 → **84**.

#### R14 — the missed-order counter only ever went UP

The overdue sweep raises `missedOrders` every time an order sits with an agent
past `reassignMinutes` with no call logged, and `autoSuspend` locks the account
out at `suspendThreshold`. **Nothing could lower it.** So every agent eventually
trips auto-suspension with no way back except editing a `ProductSetting` row by
hand — a latent trap whose trigger is uptime.

`POST /api/erp/agents/[id]/reset-missed`, with an audit row, because forgiving an
accountability counter is exactly the act somebody should be able to ask about
later. **It does NOT reactivate**: clearing the count and lifting a lockout are
two decisions, and a supervisor may want the first while they have a
conversation. The response says what the suspension state still is, and the
control is offered only where the counter is above zero — D-06.2 is as much
about not offering a no-op as about not offering a refusal.

#### R11 — the flag was computed, stored, and shown nowhere

`OrderCall.suspicious` is written on every logged call shorter than the tenant's
`minCallSeconds` that was nevertheless marked confirmed. The whole point of that
setting is catching somebody who marks orders confirmed without really phoning,
and **the data was being collected where no screen showed it.**

Two readers now: a per-agent count on the roster that links straight to those
orders, and a `suspicious=true` filter in `orderFilters`.

**It is a FILTER rather than an Alerts screen, and that is a deviation from the
legacy worth stating.** In `orderFilters` it shares one vocabulary with the list,
the export and the analytics (D-LP.3), so "flagged calls for Alger this week" can
be narrowed further, handed to an export, or opened in analytics — none of which
a separate screen could do. The legacy's Alerts page can only ever show
"everything flagged, newest first".

#### N11 — the payroll report existed and nothing rendered it

`GET /api/erp/agents/payroll` was reachable only by hand-typing a URL. The roster
now shows what each person is owed for the current calendar month, under the
aligned proration rule LP.16b made shared — so the salary line here and the one
on a saved P&L cannot disagree.

#### N12 — and the defect underneath it: order edits were not audited at all

N12 said the audit route existed and the detail screen did not render it. Half
true. **`AuditEvent` exists, `GET /api/erp/audit` exists, `erp:audit:read` is a
declared permission — and no order mutation wrote a row.** There was nothing to
render. `PATCH /api/erp/orders/[id]` changes a price, a status, an assigned agent
and a delivery address; "who moved this order to confirmed?" had no answer on the
platform, only "it is confirmed".

The edit is recorded now, in the same transaction as the update so an edit that
rolls back leaves no record of having happened, and the trail is on the order
detail. **WHICH FIELDS, NOT WHAT THEY BECAME**: an order carries a customer's
name, phone number and address, and an audit table is read by anybody holding
`erp:audit:read`. The keys are the accountability; the values are on the order.

**And the test records an authorization question rather than deciding it.**
`erp:audit:read` is not on the SENSITIVE list, so every member holds it by role
glob and an agent DOES see the trail. The screen follows the ROUTE (D-06.2)
rather than inventing a stricter rule, and the test asserts the two agree in
whichever direction the permission goes. Whether that permission SHOULD be
sensitive is the same shape of question as N16 and belongs to its own review.

#### R15 — a locked-out colleague could not be recovered by anybody

Self-service change and nothing else: no reset, no forgot-password flow. In a
call centre that is a weekly event.

`POST /api/platform/team/members/[userId]/password`, on the PLATFORM team
surface rather than in the ERP, because identity is a platform concern. Behind
`targetMemberError` — the owner is immutable and nobody resets themselves, since
changing your own password is the profile screen, which asks for the current one.

**D-LP.12.1 — this one DOES destroy sessions, and suspension deliberately does
not.** D-07.2 keeps `destroySessionsForUser` away from suspension because it is
keyed on the PERSON and one person belongs to many companies. A password reset is
the opposite case for the same reason: the credential is global. Leaving old
sessions alive would mean the person who forgot the password still cannot get in
while whoever was already signed in on a shared handset stays signed in — which
is backwards, since "somebody else has my session" is one of the reasons a reset
gets asked for. The screen says so before the click.

The new password is never echoed, never logged, and never lands in the audit
payload — only that a reset happened, by whom, to whom, and how many sessions
went.

#### Files

New: `src/app/api/erp/agents/[id]/reset-missed/route.ts`,
`src/app/api/platform/team/members/[userId]/password/route.ts`.

Changed: `src/lib/erp/orders.ts` (the `suspicious` filter and its field),
`src/app/api/erp/orders/[id]/route.ts` (the audit write),
`src/app/console/erp/agents/page.tsx`,
`src/app/console/erp/orders/[id]/page.tsx`,
`src/components/console/erp/agent-write.tsx`,
`src/components/console/platform/team-screen.tsx`,
`src/lib/console/{erp-strings,platform-strings}.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json` (+11 keys each),
`test/erp/{helpers,screens,access}.test.ts`, `test/platform/team.test.ts`.

#### Migration

None. No schema change — `OrderCall.suspicious`, `AuditEvent` and the
`agent:<userId>` `ProductSetting` all already existed.

#### Risk

**Low**, with one behaviour addition worth naming: `PATCH /api/erp/orders/[id]`
now writes an `AuditEvent` per edit. That is one insert on a path that already
writes, in the same transaction, and it is append-only — but it means the audit
table grows with order edits rather than only with settings changes, which is the
point.

#### Verified

build clean · screens 140/140 · team 62/62 · access 84/84 · orders 40/40 ·
listing 30/30 · catalog 55/55 · i18n 18/18.

---

### LP.14 Carriers — the integration log gets its first writer

[Opus 5]
Date: 6 August 2026
Summary: `POST /carriers/[id]/test`, `POST /carriers/[id]/sync`,
`GET /carriers/[id]/logs` and `DELETE /carriers/[id]/status-mappings`, with the
controls for all four on the carriers screen. delivery 64 → **77**, access
78 → **82**. Closes **R3** and the second half of **R20**.

#### Three columns rendered by a screen and written by nothing

`Carrier.lastTestAt`, `lastTestOk` and `lastSyncAt` are on the schema, are
**rendered by `/console/erp/carriers`**, and had no writer anywhere. Every
carrier showed "never tested" forever — so an operator configuring a real ZR
Express integration had no way to find out whether the key worked except by
confirming a real order and watching for a parcel that might not appear.

And **`IntegrationLog` had no reader and no writer at all.** It was migrated in
Phase 3.2 with its indexes and its comment and never used. Without it the only
evidence of a failing integration is a parcel that did not book, and the only
diagnosis available to an operator is "try again".

#### `testConnection` is optional, and its absence is meaningful

The adapter contract gains an optional `testConnection`. ZR implements it as
`POST /territories/search` — the smallest call that proves BOTH halves of the
credentials, since `X-Api-Key` and `X-Tenant` are each required by it, and it is
the call every booking already makes first.

**It must be a READ.** A test that books a parcel to find out whether booking
works sends a real courier to a real address.

An adapter with nothing to ask falls back to a STRUCTURAL check **that says so in
its own message and returns `structural: true`**. Reporting a plain success would
be a green tick meaning "we did not look", on the screen an operator checks
BEFORE trusting the integration — the same class of lie as the fabricated
tracking numbers D-LP.2 removed.

#### No credential ever reaches the log

`lib/erp/integration-log.ts` is the only writer, and it redacts by KEY at any
depth rather than trusting each caller: the API key, the secret key, the webhook
secret, `Authorization`, `X-Api-Key` and `X-Tenant`. What is kept is what makes
the log useful — the URL, the adapter, the HTTP outcome, the carrier's own
refusal message. It is append-only like every other ledger here, and it
**never throws**: a logger that can fail the operation it is describing turns a
carrier hiccup into a 500.

#### D-LP.5.1 applies to both new calls, and to the sync most sharply

A test is one round trip and a sync is up to 25. Both run through
`afterCommit` — **plan in a transaction, call in none, record in a transaction**
— and the sync composes `refreshShipmentForOrder`, which is the exact function
the manual "ask the carrier" button uses. One ingest path, so a synced parcel
raises follow-up tasks and settles its outcome exactly as a pushed one does;
reimplementing the loop would have been a second ingest path and the half nobody
tested.

**`SYNC_BATCH = 25`**, the poll's own bound, and `capped: true` is in the
response — "25" looks like "all of them" to somebody with 200 open parcels.
Settled parcels are not asked about again: their outcome is permanent by design.

**A carrier that cannot be polled is refused by NAME.** ZR declares
`canPoll: false` because it publishes no tracking endpoint at all. Answering
"0 parcels updated" would be indistinguishable from "nothing has moved", which
is the LP.2 distinction, and the screen does not render the control (D-06.2).

#### R20's second half: a wrong status mapping was permanent

`POST` upserts, so a mapping could be CORRECTED — but one that should never have
existed could not be removed, and it went on translating a carrier's wording
into a CRM status on every event that arrived. `DELETE` is keyed on
`originalStatus` (the natural key the upsert already uses), is idempotent —
removing one that is not there is `removed: 0`, not a 404 — and **touches no
history**: `ShipmentEvent` keeps the carrier's original wording on every row, so
this changes what happens next and never rewrites what a parcel was recorded as
doing.

#### One robustness change that is not part of the feature

`ConsoleShell`'s unread-count read is now wrapped: a failure logs and renders
zero rather than 500-ing the page. LP.7 added one extra bound read to every
console render, the free-tier database's connection ceiling already surfaces as
**a 500 from a screen** rather than a test error (PROJECT_STATE, known
limitations), and a badge is not worth a page over.

#### Files

New: `src/lib/erp/integration-log.ts`,
`src/app/api/erp/carriers/[id]/{test,sync,logs}/route.ts`.

Changed: `src/lib/erp/carrier-contract.ts` (`testConnection`),
`src/lib/erp/carrier-zr.ts`,
`src/app/api/erp/carriers/[id]/status-mappings/route.ts` (`DELETE`),
`src/components/console/erp/carrier-write.tsx`,
`src/app/console/erp/carriers/page.tsx`,
`src/components/console/console-shell.tsx`,
`src/lib/console/erp-strings.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json` (+5 keys each),
`test/erp/{delivery,access}.test.ts`.

#### Migration

None. No schema change — every column and the whole `IntegrationLog` table
already existed and gain their first writer.

#### Risk

**Low.** Four additive routes, all `erp:shipments:write`. The only change to
existing behaviour is the shell's badge read becoming non-fatal, which strictly
reduces the ways a console page can fail.

#### Verified

build clean · delivery 77/77 · access 82/82 · screens 130/130 ·
notifications 41/41 · finance 38/38 · i18n 18/18.

---

### LP.17 The AI screen — a nav item that led to a 404

[Opus 5]
Date: 6 August 2026
Summary: `/console/erp/ai` exists. `test/erp/ai.test.ts` is new at **20/20**;
access 73 → **78**. Closes **R10** and the live 404 LP.0d recorded.

#### A nav item is a promise, and this one was broken in production

`packages/product-registry` ships an `ai` nav item for the ERP and **no screen
existed at that path**. Every member — the permission is held by role glob — saw
a menu item that answered 404. `screens.test.ts` enumerates screens by hand and
omitted this one, so nothing caught it.

**The first test in the new file is the general form of that defect**, and it is
the one worth keeping: it reads the MANIFEST and asserts every declared nav item
answers 200. A screen missing from a hand-written list is invisible; a nav item
that 404s is not, and now cannot be added.

#### What the screen honestly offers, which is not what the legacy's does

**The insights half is real and needs no provider at all**, because it is counts
rather than generation — the same figures `GET /api/erp/ai/insights` returns.

**The chat half is a sentence saying it is unavailable, not a box that fails on
submit.** `POST /api/erp/ai/chat` answers 501 by design: calling a model needs a
configured provider, a real key and an adapter layer, which is deployment
configuration rather than a port. A chat box that always errors says less than
the sentence does, and it is the same class of lie as the fabricated tracking
numbers D-LP.2 removed.

**The ceiling line is the CALLER's**, not the company's — `read_analytics` maps
to `erp:finance:read`, which is SENSITIVE (D-05.1) because it aggregates across
every order and ignores the record scope that limits an agent to their own queue.

#### R10's missing half: a provider could be created and never corrected

`POST /ai/providers` and `POST /ai/agents` existed and **nothing could edit or
remove what they created**. A provider added with a typo in its base URL was
permanent, and a key that leaked could not be rotated from the console.

`PUT`/`DELETE` on both, plus `POST /ai/providers/[id]/default`. Four rules, each
with a test that violates it:

- **`type` is not editable.** It decides which adapter would be used and what
  each field means; changing it in place turns a configured provider into a
  differently-shaped one carrying the old provider's credentials.
- **An empty `apiKey` is refused rather than treated as a way to blank one.** A
  provider with no key is indistinguishable from a broken one, and the failure
  would surface much later as a model call that fails.
- **Exactly one default**, cleared before it is set, in the same transaction —
  the shape `POST /carriers/[id]/default` uses. Two rows flagged default is a
  state no reader can resolve. A DEACTIVATED provider is refused by name rather
  than half-applied.
- **Deleting a provider does not cascade to its assistants.** An assistant is a
  prompt and a permission set somebody wrote; removing a billing account must
  not destroy it, and the screen shows it as unconfigured, which it now is.

**`/test` is deliberately NOT built, and the screen says so in the column where
it would appear.** Testing a provider means calling a model. A "test" button that
reported success without contacting anything is exactly the defect D-LP.2
removed from the carrier path. Recorded as Tier 4 slice 27.

#### The permission list is a REQUEST, and the form says so

An assistant's permissions are clamped per CALLER at use time
(`clampPermissions`), so an analytics assistant configured by a manager gives an
agent nothing extra. The checkbox list carries that sentence, because a list that
looks like a grant is how somebody talks themselves into believing an assistant
is a way around a permission.

#### Files

New: `src/app/console/erp/ai/page.tsx`,
`src/components/console/erp/ai-write.tsx`,
`src/app/api/erp/ai/providers/[id]/route.ts`,
`src/app/api/erp/ai/providers/[id]/default/route.ts`,
`src/app/api/erp/ai/agents/[id]/route.ts`, `test/erp/ai.test.ts`.

Changed: `src/lib/console/erp-strings.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json` (+27 keys each),
`test/erp/access.test.ts`.

#### Migration

None. No schema change — `AiProvider` and `AiAgent` already existed.

#### Risk

**Low.** One new screen behind a permission it checks itself, and five routes
that are all `erp:settings:write`. Nothing existing changed behaviour.

#### Verified

build clean · ai 20/20 (new) · access 78/78 · screens 130/130 · i18n 18/18.

---

### LP.13 Analytics — the number this business is managed by

[Opus 5]
Date: 6 August 2026
Summary: `GET /api/erp/analytics` and `/console/erp/analytics` are new, and the
dashboard gets back the three reaction-time figures it traded away.
`test/erp/analytics.test.ts` is new at **19/19**; access 72 → **73**. Closes
**R6**, **K1**, **N18** and **N20**.

#### The confirmation rate was computed nowhere on this platform

Not on the dashboard, not on any screen, not in any route. It is the number a
COD call centre is MANAGED by — how many of the people who ordered actually
agreed when somebody phoned — and the legacy leads its dashboard with it and
recomputes it across seven dimensions. Two agents with a 40% rate and a 75% rate
looked identical on every screen that existed.

#### Seven breakdowns, each a `groupBy` rather than a browser

Status · sales channel · product · wilaya · agent · **marketer/source** ·
delivery status, each with orders, confirmed, confirmation rate (with a bar),
cancellation rate and confirmed value. The legacy downloads the whole order book
into the browser and buckets it in JavaScript — PERF-02, and the reason its
analytics screen stops being usable past a few thousand orders. Here each
dimension is three indexed aggregates.

**N20 closes with the marketer table.** `marketer` and `source` are written by
the channel webhooks and were **read by nothing**, so a business that BUYS its
orders could not tell which campaign paid for itself.

#### Three properties that are easy to get wrong in plausible-looking ways

- **Orders are counted by creation, parcels by settlement.** A parcel ordered in
  March and delivered in April belongs to March's order count and April's
  delivered count. Folding either into the other gives a month that cannot be
  reconciled against anything. The legacy makes the same split deliberately.
- **N19 — both revenue figures are reported and NEITHER is called "revenue".**
  Confirmed value is what customers agreed to on the phone; delivered value is
  what the carrier actually paid. Under cash on delivery those are different
  numbers, the platform was right to sum the second, and reporting only one is
  what makes somebody comparing the two systems file a bug against the correct
  one. The page says so, in a sentence, under the tiles.
- **Never called is not "pending".** An order with three failed attempts is being
  worked and one with none is being ignored; a status count cannot tell them
  apart. It asks the `calls` relation rather than a denormalised counter no
  column maintains.

#### Who sees whose numbers — two gates, two questions

The route is `erp:orders:read` and the rows are RECORD-SCOPED by the same
`scopedWhere` the list and the export use, so an agent gets the analytics of
their own queue — including their own confirmation rate, which is what they are
measured on. The **by-agent** table needs `erp:agents:manage` and is withheld
otherwise: a league table of colleagues' rates is supervision data, the same rule
LP.6 applies to its `agents` export format and `notifySuspiciousCall` applies to
the agent it is about. The screen applies both gates itself, because a nav item
is a hint and the URL is typeable.

#### The dashboard gets its reaction time back (N18)

The confirmation rate under the confirmed count, a **never called** tile, and an
**overdue banner** — a banner rather than a tile, because a count of orders
nobody has phoned within the company's own `alertMinutes` is a queue that needs
draining, not furniture that reads zero all day. The threshold is the tenant's
`alertMinutes`, the same setting the queue screen's badge uses; two screens with
two thresholds would disagree about the same order. In-delivery, delivered and
customers stay — they were a genuine gain and this is not a rollback.

#### The window is the order list's own query string

`orderFilters` unchanged: `range=`, `since`/`until`, `status`, `wilaya`, the rest.
So "the confirmation rate for Alger last week" is the analytics view of a filter
somebody already applied on the list, and the two cannot disagree about what that
window contained (D-LP.3).

#### Files

New: `src/lib/erp/analytics.ts`, `src/app/api/erp/analytics/route.ts`,
`src/app/console/erp/analytics/page.tsx`, `test/erp/analytics.test.ts`.

Changed: `src/app/console/erp/page.tsx`,
`packages/product-registry/src/manifests.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json` (+19 keys each),
`test/erp/access.test.ts`.

#### Migration

None. No schema change — every figure is an aggregate over columns that already
existed, two of which had never been read.

#### Risk

**Low.** Purely additive: one new route, one new screen, three additions to a
dashboard. The heaviest query is seven dimensions × three aggregates, run
sequentially on the one interactive transaction rather than concurrently, for the
reason the payroll roster loop is sequential.

#### Verified

build clean · analytics 19/19 (new) · access 73/73 · screens 130/130 ·
orders 40/40 · notifications 41/41 · finance 38/38 · listing 30/30 ·
catalog 55/55 · i18n 18/18.

**And read off the running console against the demo tenant:** 8 orders,
**37.5% confirmation rate**, 12.5% cancellation, 21,400 DA confirmed against
4,200 DA delivered, a 50% delivery rate over two settled parcels, and all seven
breakdown tables rendering. The dashboard shows the rate beside the count and a
live overdue banner naming the company's own 60-minute threshold.

---

### LP.7 The notification provider — the console consumes its own transport

[Opus 5]
Date: 6 August 2026
Summary: M-16's entire transport gets its first consumer. A bell, a badge, a
panel and a toast in the console shell, plus a debounced `router.refresh()` that
makes the console live. notifications 33 → **41**, orders 38 → **40**. **Two
defects in shipped code were found by building the consumer**, and neither could
have been found any other way.

#### The dead machinery, and why it stayed dead

M-16 landed in three slices — storage with the audience resolved once at write
time, a live SSE stream with exact replay from `Last-Event-ID`, Web Push and a
service worker — with **33 contract tests**. Every one of them passed. Nothing in
the console called any of it. There was no bell, no badge, no panel and no
toast, so a signed-in operator was never told anything: not that an order
arrived, not that a parcel came back, not that a follow-up escalated. The second
pass corrected L1 and L2 from 🔵 IMPROVED to 🔴 MISSING for exactly this reason,
and NEXT_STEPS called it the largest piece of dead machinery in the repository.

#### What the provider owns — three things, and no more

`src/components/console/notification-provider.tsx`, mounted once in
`console-shell.tsx`:

- **The unread badge, whose count is the SERVER'S.** `unreadCount()` is read in
  the shell on every render and passed as a prop. It is deliberately not an
  in-memory counter incremented per arriving event: that counter is wrong the
  moment a second tab marks something read, wrong after a reconnect that
  replays, and wrong for anything raised while the tab was closed — which is the
  exact defect the M-16 audit found in the ERP.
- **A toast per LIVE arrival.** Replayed frames do not toast: they are the
  catch-up for a dropped connection, and fifty toasts on reconnect hide the one
  that matters. They still count toward the badge and still appear in the panel.
- **A debounced `router.refresh()` (500 ms).** This is the whole live-console
  story and the whole performance story at once. A carrier replaying a backlog
  produces dozens of events in a second, and each refresh re-renders a server
  tree that runs real queries.

**It does not merge an arriving notification into anything on screen.** That
would be a second copy of the truth living in the browser, and D-06.3 exists
because a confirmed call is money. The server re-renders and the screen shows
what the database holds.

**One subscription per session, not per screen** — the shell is on every console
page, and a provider per screen is N EventSource connections per tab, each of
which is a polling query. **And it is not ERP-shaped:**
`/api/platform/notifications` is one feed per person across every product, so a
row carries its `product` and the toast says which one raised it.

#### Defect 1 — a fresh subscription replayed the whole backlog AS LIVE

The stream took an empty cursor to mean "from the beginning", so a tab opening
with no `Last-Event-ID` was sent this account's entire backlog (up to the 50-row
bound) on its first poll, flagged `replayed: false`.

With nothing consuming the stream that was invisible. The moment a provider
toasted live arrivals it became a burst of toasts for last week's news **on every
page load**, with the one that mattered buried in it.

A client with no `Last-Event-ID` has just been server-rendered with the current
state — badge, list, screen — and is subscribing for what happens NEXT. History
is one `GET /api/platform/notifications` away and is what the panel already does.
`newestNotificationId()` is new; a resumed connection is untouched, so replay
from a real cursor stays exact.

#### Defect 2 — `POST /api/erp/orders` answered 500 in every seeded tenant

Found by creating an order through the console as `manager@demo.test`:
**`P2002` on `(tenantId, reference)`, a 500.**

The demo seed writes `ORD-0001`…`ORD-0006` directly and never touches
`TenantSequence`. So the counter did not exist, the upsert's `create` branch
started it at 1, and the very first order anybody created through the console
collided — permanently, because the next attempt produces 2, then 3, walking up
through every seeded number.

**It is not a seed problem.** Any path that writes a reference without going
through `nextReference` leaves the counter behind its data: a migration, a
restore, and the CSV import still on the roadmap (Tier 3 #19) would each do it.
And catching the `P2002` afterwards is not available — a unique violation aborts
the whole Postgres transaction, and every caller is already inside the one
`withTenant` opened, which is why NEXT_STEPS says not to catch it per-insert. So
the counter heals itself BEFORE the insert: when the row is absent it starts from
the highest reference already in use rather than from 1.

**Only a reference this scheme could have MINTED counts.** A company whose
imported numbers are `INV/2024/17` must not have them parsed into something the
counter jumps to, and a test asserts that one leaves the counter at ORD-0001.
The race is closed by the upsert itself: two callers may both compute the same
start, but one INSERT wins and the other conflicts into `update`, which
increments — neither observes a stale value. `seed-demo.ts` sets the counter too,
because a seed that leaves its own tenant in a state the application has to
repair is lying about what it produced.

#### Files

New: `src/components/console/notification-provider.tsx`.

Changed: `src/components/console/console-shell.tsx` (the badge count, the
product-name map, and the provider itself),
`src/app/api/platform/notifications/stream/route.ts`,
`src/lib/platform/notifications.ts` (`newestNotificationId`),
`src/lib/erp/ids.ts` (the self-healing counter),
`packages/db/scripts/seed-demo.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json` (+6 keys each),
`test/erp/{notifications,orders,helpers}.test.ts`.

#### Migration

None. No schema change.

#### Risk

**Low.** The provider is additive and renders only for a session with an active
tenant. The stream change makes a fresh subscription send strictly less than
before — a client that wants history has always had the list endpoint — and a
resumed one is byte-identical. The counter change adds one indexed read per
tenant on the first reference ever minted through it, and nothing afterwards.

#### Verified

build clean · notifications 41/41 · orders 40/40 · screens 130/130 ·
access 72/72 · listing 30/30 · catalog 55/55 · finance 38/38 · jobs 16/16 ·
assign 25/25 · console-shell 13/13 · team 56/56 · billing 19/19 · signup 10/10 ·
i18n 18/18.

**And driven by hand in a browser, which is how both defects were found.**
Signed in as `manager@demo.test`: a page load now produces **zero** stale toasts
where it produced a burst; creating an order answers **201 with `ORD-0007`**
where it answered 500; and with the tab left open and untouched, a second order
produced a live toast — *"New order ORD-0008 · Toast Probe — 0555636763 ·
Gestion des commandes"* — **within 700 ms**, with the badge moving 6 → 7 with no
reload.

---

### LP.16 The profit/loss calculator — every gap LP.0c measured, closed

[Opus 5]
Date: 6 August 2026
Summary: `LEGACY_PARITY.md` §7's seven gaps (**P1–P7**), implemented in four
steps. `test/erp/finance.test.ts` is new at **38/38** and `test/calc.test.ts` is
new at **20/20** — the first PURE suite in this app. delivery 61 → **64**,
access 68 → **72**. Three defects in shipped code are closed, and a fourth was
found while porting and is closed here too.

#### The four defects, because three of them were live answers rather than gaps

**1. A product whose name carried a `™` reported ZERO revenue.** `sales-summary`
resolved its orders with `where: { product: product.name }` — exact string
equality — where the legacy matched by external product id first and then by a
NORMALISED name. Every screen rendered, every number was a real number, and the
product had apparently never sold anything. BUG-02's shape exactly, and live on
a route that already ships.

**And the same line had a second failure nobody had looked for:** a catalogue row
with a NULL name passed `product: undefined` to Prisma, which is not a filter at
all — so a nameless product reported **the entire book's** delivered revenue as
its own.

**2. Every saved P&L record was missing its rent and salaries.** `fixedCosts` is
declared in `SETTINGS_SCHEMA`, validated by `validateSettings` and summed by
`prorate-fixed` — and **written by nothing**. `/console/erp/automation` builds
its controls with `spec.type !== "object" && spec.type !== "array"`, which is the
RIGHT rule and was chosen deliberately so a structured setting added later cannot
render as a checkbox; no other screen offered an editor. So the prorated figure
was `0` for every tenant, always. Not absent — zero, which reads as "there are
none".

**3. `periodType` was accepted and echoed back without being used.** Every window
got the day-count rule, so a week charged `7/30.44` of a month instead of a
quarter. The legacy's `÷4` looks arbitrary and is load-bearing: **four saved
weeks must tile into exactly one month**, because `aggregate` builds a month by
SUMMING four weekly records rather than recomputing one. `4 × 0.2300 = 0.92`, so
every aggregated month under-charged fixed costs by 8%, compounding to a full
month's rent missing per year — and invisible, because every individual number
looks plausible.

**4. Found while porting: the saved record disagreed with the screen that
produced it.** The legacy calculator computes `incidents` (returns + exchanges +
losses), subtracts it from every product's profit, shows the result in its
banner — and then does not send it, because `FinancialRecord` has no incidents
column. The stored `netProfit`, derived server-side as revenue minus the five
cost lines, came out HIGHER than the number the manager was looking at when they
pressed save, by exactly the incident total. One period, two answers, and the
permanent one was the optimistic one.

#### LP.16a — `sales-summary` can answer what the calculator asks

`src/lib/erp/product-match.ts` is new and holds the precedence rule:

1. **the channel's own link wins, and it is EXCLUSIVE** — if the order names an
   external product id and a `CatalogProductLink` resolves it, that link decides,
   *including by saying no*. A shop that renamed a listing must not have its
   sales reattributed by a name collision;
2. **otherwise the normalised name** — strip the trademark signs, fold the
   non-breaking space, collapse whitespace, trim, lowercase.

Accents and punctuation are deliberately NOT stripped: `Café` and `Cafe` are
plausibly two products, and guessing wrong attributes one product's revenue to
another — a worse failure than the zero this fixes, because it looks right.

The route now answers `returnedCount` (not returned at all before, so the one
figure that turns revenue into a return rate had to be typed from memory), splits
`avgPackagingCost` out of `avgBuyPrice`, and echoes `productName`, `since`,
`until`, `costTrackedUnits` and `costFallbackUnits`. The last two are the honesty
column: a margin computed 80% from today's flat price is a guess, and the route
could not say so.

**Why the split matters more than it looks.** The calculator multiplies BOTH the
buy price and the packaging cost by units. Filling the platform's old
`avgBuyPrice` — which folded packaging in — into the buy field and leaving the
packaging field alone **counted packaging twice**, and the resulting profit was
wrong in the safe-looking direction.

The per-order movement query also became one batched read; it was one query per
order inside a loop, which is a query count that grows with the window a manager
picks.

#### LP.16b — one proration rule, and the two settings nothing could write

`src/lib/erp/prorate.ts` is new: `prorateMonthlyAmount` (month unchanged, week
÷4, quarter ×3, year ×12, day ÷ the real length of THAT month, anything else
÷30.44 × days), `alignedRange` (Monday-to-Sunday weeks, the 1st to the 31st) and
`monthlyFixedTotal`.

**Both callers now share it.** `prorate-fixed` and the payroll routes each had
their own copy of the day-count half, so a rent and a salary — the same monthly
figure scaled onto the same week — came out at different fractions of a month.
The legacy had exactly one function for both and said why: *"ONE rule, one place,
instead of two copies that could drift apart."* `GET /agents/payroll` and
`GET /agents/[id]/payroll` now accept `periodType` and echo it; absent, they give
the day-count answer they always gave.

`prorate-fixed` also reads `startDate`/`endDate` — the names the calculator sends
— as well as `since`/`until`. It read only the latter and **defaulted to the last
30 days when they were absent**, so it answered confidently about a window nobody
asked about.

`components/console/erp/settings-structured.tsx` is new: a list editor for
`fixedCosts` and a map editor for `defaultCarrierByChannel`, both calling
`PUT /api/erp/settings` (D-06.1) and both rendered on `/console/erp/automation`.
**Not a JSON textarea** — a textarea accepts anything the server's
`typeof value === "object"` check allows, which is how a settings table becomes a
scratchpad: an amount typed with a letter O validates, saves, and contributes
nothing forever. The type filter that excluded them is untouched and a test
asserts it survived: the fix was the missing editors, not a change to the rule.

**And the map's reader was built too, so it is not a second write-only setting.**
`planShipment` resolves a carrier in three steps now — the order's own code, then
the sales channel's default, then the tenant's. An EXPLICIT code is still
honoured or refused and never quietly replaced; a channel default that matches no
active carrier falls through, because the map outlives the carrier row. Closes
half of R20.

#### LP.16c — `versions` and `aggregate`

`GET /api/erp/financial-records/versions` lists every save of ONE exact period,
newest first. All three parameters are required and none has a default: a version
list is only meaningful for one period, and defaulting the window answers a
question nobody asked with a list that looks authoritative.

`GET /api/erp/financial-records/aggregate` rolls saved sub-periods up —
week→month, month→quarter, month→year — touching no orders and no inventory. Two
properties that are arithmetic rather than polish:

- **one version per sub-period.** Records are insert-only, so a corrected week
  leaves two rows and summing both charges that week twice. Only the newest save
  of each distinct `(start, end)` counts — the same reading as "the current
  record for a period is whichever row is newest".
- **`covered: false` names what is missing.** A month built from three of its
  four weeks is not a month, and a silently-shorter total produces a business
  that believes it made more than it did. `no_smaller_unit` and
  `no_saved_sub_records` are distinguished, because "there is nothing smaller to
  add up" is a different fact from "those weeks made no money".

Nothing is persisted: a GET that wrote a permanent financial record would be a
GET with a side effect on the books. `POST` gained `productBreakdown`, stored as
strings so no figure in it becomes a float.

#### LP.16d — the screen

`/console/erp/calculator`, a new nav item gated on `erp:finance:read` (SENSITIVE,
D-05.1). **The legacy served this as a standalone HTML file with no authorization
on the page at all** — the whole company's margins, break-even points and carrier
shortfalls, behind a URL.

Everything §7 P7 listed: the A–G blocks, the exchange LIST (each exchange costs
what it costs, so it is not a count times a cost), ad spend in USD with an
explicit rate, the six KPIs including break-even-or-never, calendar-ALIGNED
period presets, the history panel and its CSV export with the legacy's thirteen
French column headings.

**The period is in the URL and the working sheet is not.** The A–G inputs are a
person thinking — they change per keystroke and most are never saved — so the
sheet is client state. The period is a link, because it decides what the SERVER
reads (the prorated fixed costs, this window's charges, the history) and because
a calculation somebody is about to save should be linkable to the colleague they
are arguing with about it.

**`src/lib/money.ts` is new: exact decimal arithmetic that runs in a browser.**
The legacy calculator is `Number(...)` end to end and its output is stored as a
company's permanent record of a month. `Prisma.Decimal` arrives through a
server-only package; sixty lines of scaled `bigint` is exact for plus, minus and
times on values with three decimal places and ships nothing. Assumption 7 of this
project says money is a Decimal formatted from its string form and never a JS
float, and a calculator is the last place to make an exception.

**The arithmetic lives in `src/lib/erp/calc.ts`, not in the component**, so it
can be tested by `node --test` with no build step — a `.tsx` module cannot be
imported by the type stripper, and an implementation only reachable through
rendered HTML is how a rounding error survives review.

`GET /api/erp/financial-records/export` returns the saved history as CSV, reusing
LP.6's `toCsv` (formula neutralisation, UTF-8 BOM) and its column-name-as-a-
contract reasoning.

#### Decisions

- **D-LP.16.1 — incidents are part of `productCosts` when a record is saved.**
  See defect 4. A returned or destroyed unit's cost is a cost of goods; folding
  it in makes the stored `netProfit` equal the total on the screen that produced
  it. The page says so above the button, and `test/calc.test.ts` asserts both the
  new agreement and the size of the legacy's overstatement.
- **D-LP.16.2 — the calculator is its own nav item, not a tab on Finance.** It is
  a working tool rather than a report: the thing a manager opens to decide
  whether a product line survives. Finance lists what was already stated.
- **D-LP.16.3 — aligned periods are a SECOND vocabulary, deliberately.**
  `alignedRange` gives Monday-to-Sunday weeks; `orderFilters`' `range=week` is a
  ROLLING seven days and is right for "what came in recently". Naming them the
  same thing would make them look interchangeable, and the tiling that
  `aggregate` depends on needs the aligned one.
- **`tsconfig` target ES2017 → ES2020.** A BigInt literal is a syntax error below
  ES2020. `noEmit` is on and `lib` was already `esnext`, so nothing emitted or
  type-visible changes — only whether `tsc` accepts the literal.

#### Files

New: `src/lib/erp/product-match.ts`, `src/lib/erp/prorate.ts`,
`src/lib/erp/calc.ts`, `src/lib/money.ts`,
`src/app/api/erp/financial-records/{versions,aggregate,export}/route.ts`,
`src/app/console/erp/calculator/page.tsx`,
`src/components/console/erp/{profit-calculator,settings-structured}.tsx`,
`test/erp/finance.test.ts`, `test/calc.test.ts`.

Changed: `src/app/api/erp/products/[id]/sales-summary/route.ts`,
`src/app/api/erp/financial-records/{route,prorate-fixed/route}.ts`,
`src/app/api/erp/agents/{payroll,[id]/payroll}/route.ts`,
`src/lib/erp/{agents,shipments}.ts`, `src/lib/console/erp-strings.ts`,
`src/app/console/erp/automation/page.tsx`,
`packages/product-registry/src/manifests.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json` (+65 keys each),
`apps/website-builder/tsconfig.json`,
`test/erp/{helpers,delivery,access}.test.ts`.

#### Migration

None. No schema change: `FinancialRecord.productBreakdown` and
`CatalogProductLink` already existed and gain their first writer and their first
reader respectively.

#### Risk

**Low, with one behaviour change that is visible in existing data.**
`avgBuyPrice` no longer includes packaging — any caller that added it to a
packaging figure was double-counting and now is not, and any caller that used it
alone as a full unit cost now reads low by the packaging amount. There is one
caller in the repo (the new calculator) and the field is documented on both
sides. The proration change makes a week's fixed costs 8.7% larger than before,
which is the correction, not a regression.

#### Verified

build clean · **finance 38/38** (new) · **calc 20/20** (new, pure) ·
delivery 64/64 · access 72/72 · catalog 55/55 · screens 130/130 · orders 38/38 ·
validation 29/29 · listing 30/30 · integrations 29/29 · order-split 8/8 ·
jobs 16/16 · assign 25/25 · notifications 33/33 · export 31/31 ·
team 56/56 · billing 19/19 · signup 10/10 · console-shell 13/13 ·
builder-api 22/22 · builder-sections 45/45 · storefront 22/22 ·
db 29/29 · auth 36/36 · ui 26/26 · i18n 18/18 · product-registry 36/36.

**And driven by hand in a browser**, because a green suite is not a working
screen: signed in as `manager@demo.test`, the sync button filled four product
blocks from real delivered orders — `Sac à Dos Antivol` came back with 1 unit,
4,200 DA, `avgBuyPrice` 2,100 and `avgPackagingCost` **200, separately** — and
`Écouteurs Bluetooth Pro` reported the returned parcel that `returnedCount` could
not answer before. Entering a 120,000 DA fixed cost moved the month's net profit
from +43,625 to −76,375, and switching to the aligned week showed **exactly
30,000** rather than 27,595.

---

### LP.0d The third pass — module by module, after Tier 1

[Opus 5]
Date: 6 August 2026
Summary: `LEGACY_PARITY.md` **§8** is new — every department and every
cross-cutting dimension walked on both sides, with Tier 1 complete. **No code was
written.** Six findings (**N18–N23**), one new slice that did not exist before,
and the verdict narrowed from "the consumer layer" to two named things.

#### A third instrument, because the first two answered different questions

The first pass counted **routes** and got five verdicts wrong. The second counted
**workflows** and found fourteen features no route inventory could see. This one
asks, per module: *what does a person's day look like on each side?*

**Five legacy screens still have no platform equivalent** — Stores, Analytics,
Alerts, Import, the profit calculator — and **one platform nav item leads to a
404** (`ai`). That is the shape of what is left, and it is smaller than the
scoreboard suggests, because the twelve screens that do exist are at or above
parity on rules, permissions, validation and jobs.

#### The finding that matters most

**N18 — the confirmation rate is computed nowhere on the platform.** The legacy
dashboard leads with it; its analytics screen recomputes it per status, channel,
product, wilaya, agent, marketer and delivery status. It is the number a COD call
centre is *managed by* — and the platform has neither the tile nor the screen.
Alongside it the dashboard lost the **never-called count** and the **overdue
banner**, which are the two with the shortest reaction time. The platform gained
in-delivery, delivered and customers, so this is a trade rather than a plain
regression — but the four that went are the four somebody acts on within the
hour.

**N19, recorded so nobody "fixes" the right answer:** legacy revenue sums
**confirmed** orders and the platform sums **delivered** ones. The platform is
correct — under cash on delivery a phone confirmation is not a sale, which
`settleOutcome` says in its own comment — and the two dashboards will therefore
never agree.

#### The rest

**N20** the analytics screen is one function called seven times, and
`marketer`/`source` are written by the channel webhooks and read by nothing, so
**ad attribution is uncomputable today**. **N21** the order row: 14 facts against
8, measured field by field, and the four missing ones are exactly the four that
decide what to do next — overdue, called, noted, flagged. **N22** the changed row
flashes for three seconds; the platform re-renders and marks nothing.

**N23 is the one that produces new work.** `fixedCosts` and
`defaultCarrierByChannel` are both declared, validated and read by real code, and
the automation screen excludes `array`/`object` settings **by type — which is the
right rule**, chosen deliberately so a structured setting added later cannot
render as a checkbox. The consequence is that both are unreachable by any
control. It is one missing pattern rather than two bugs: a list editor and a map
editor, **S**, closing half of §7 P3 and all of R20.

#### Three things confirmed as NOT gaps

**Keyboard shortcuts and context menus: neither system has any** — re-confirmed a
second time, because a reader arriving at a parity report looks for them. The
only key handlers on either side are Enter-to-submit on three inputs. **And
neither system has a chart**: the legacy's "bar" is a div width inside a table
cell. Recorded so nobody builds a charting layer to reach parity.

#### What it changes in the roadmap

LP.7 (the notification provider) stays first. **Analytics is worth more than its
Tier 3 position says** — the confirmation rate is absent from the dashboard as
well as from the missing screen, and every breakdown is a `groupBy` over one
table. And a **structured-settings editor** is added as a slice that did not
exist before this pass.

#### Files
`LEGACY_PARITY.md` (§8 new; N18–N23 added to §3b, which is retitled as the single
findings index; §1's verdict narrowed), `PROJECT_STATE.md`, `NEXT_STEPS.md`,
`CHANGELOG.md`.

#### Migration
None.

#### Risk
None — no code changed. What it removes is the risk of Tier 2 being planned
against §2's scoreboard, which counts features rather than departments and does
not say that five whole screens are absent or that the business's headline metric
is computed nowhere.

---

### LP.0c The Profit/Loss calculator, measured — and two defects it found

[Opus 5]
Date: 6 August 2026
Summary: `LEGACY_PARITY.md` **§7** is new — the 1,244-line legacy calculator read
line by line against the platform's finance surface. **No code was written.**
Seven gaps, two of them **defects live in shipped code with no calculator
anywhere near them**, and R9's own sizing corrected.

#### Why this was measured before it was built

R9 said the calculator was "especially cheap to fix relative to its value"
because "the API half is largely there". Measuring it says otherwise, and the
distance between those two statements is the reason LP.0b exists: a route
inventory sees four finance routes and concludes the backend is ready.

**`GET /api/erp/products/[id]/sales-summary` is the whole reason the calculator
can fill itself in, and it cannot answer two of the five questions the sync asks
it.** `syncProductFromCRM` overwrites exactly five fields; the platform has no
`returnedCount` and no `avgPackagingCost`, and its `avgBuyPrice` is
`(unitCost + packagingCost) / units` where the legacy's is `unitCost / units`.
The calculator multiplies BOTH by units, so filling one from the other **counts
packaging twice** — and the resulting profit is wrong in the direction nobody
investigates.

#### The two defects, neither of which needs a calculator to hurt

**A product with a `™` in its name reports zero revenue, today.**
`sales-summary` matches its orders with `where: { product: product.name }` —
exact string equality. The legacy matched by external product id first
(`findProductByExternalId`) and then by a NORMALISED name that strips `™®©` and
non-breaking spaces, collapses whitespace and lowercases. `/console/erp/products`
already calls this route, so a catalogue product whose name differs from its
orders by one invisible character shows `realCA: 0` and looks like a product
nobody has ever bought. That is BUG-02's exact shape.

**Every saved P&L record is missing its rent and salaries.** `fixedCosts` is a
declared setting and `prorate-fixed` sums it; **nothing writes it.** The
automation screen filters out `array` and `object` settings — which is the right
rule and was chosen deliberately — and no other screen offers one, so
`prorate-fixed` answers `{ monthlyTotal: "0", prorated: "0" }` for every tenant.
Zero reads as "there are none". The legacy edits that list ON the calculator
screen, which is why it never needed a general array editor.

#### The finding that explains an "arbitrary" legacy rule

The legacy prorates a month's fixed costs as **÷4 for a week, ×3 for a quarter,
×12 for a year**; the platform uses `monthly / 30.44 × days` for everything. The
legacy's rule looks careless and is not: `aggregate` builds a month by SUMMING
four saved weekly records, so four weeks must tile into exactly one month.
`4 × monthly/4 = monthly`; `4 × monthly/30.44×7 = 0.92 × monthly` — an 8%
under-charge every aggregated month, a full month's rent per year. The
platform's formula is the better answer for an arbitrary window and the wrong one
for an aligned one; both are needed, keyed on `periodType`, **which the platform's
route accepts and echoes back without using**. The calculator also sends
`startDate`/`endDate` where that route reads `since`/`until`.

#### What the slice becomes

Tier 3 slice 16 stands and grows a prerequisite: **16a** `sales-summary`
(returnedCount, packaging split out, the product match fixed) · **16b** a
fixed-cost editor and `periodType`-aware proration · **16c** `versions` and
`aggregate` · **16d** the screen. **16a is worth pulling forward on its own
merits** — it is a wrong answer on a screen that already ships.

Recorded in §7 alongside what the platform already does better and must keep:
`Decimal` money where the calculator is `+(el.value)` end to end, a FIFO cost
basis written in the same transaction as the level, `deliveryOutcome` actually
written, and a finance surface that is SENSITIVE where the legacy calculator is a
static HTML file with no authorization on the page at all.

#### Files
`LEGACY_PARITY.md` (§7 new; the R9 card marked superseded; two defects added to
§1), `PROJECT_STATE.md`, `NEXT_STEPS.md`, `CHANGELOG.md`.

#### Migration
None.

#### Risk
None — no code changed. The risk it removes is that slice 16 would have been
planned against R9's estimate, discovered `sales-summary` could not feed the
screen, and either widened mid-slice or shipped a calculator whose sync
double-counts packaging.

---

### LP.6 The order book leaves the building — **Tier 1 is complete**

[Opus 5]
Date: 6 August 2026
Summary: `GET`/`POST /api/erp/orders/export` and an export panel on the order
list. `test/erp/export.test.ts` is new at **31/31**; screens **123 → 130**,
access **65 → 68**. Restores R4 and the export half of R7 (B12). **The last
Tier 1 blocker.**

#### What was wrong

There was no CSV, no XLSX and **no file download anywhere on the platform**, so
a confirmed order could not leave the system by any route at all. That matters
more here than the sentence suggests: Excel is how an order reaches a carrier
with no API, which in this market is most of them — LP.5 registered exactly one
that has one. The legacy CRM built four files (ZR Express, Ecom Delivery,
Ecotrac, and a two-sheet performance report) and a fifth from the ticked rows.

#### D-LP.6.1 — CSV, not XLSX

The three carrier files are flat column lists; CSV is their natural shape and
every carrier portal and spreadsheet reads it. XLSX would put a parser/writer
dependency in the server bundle for one feature, and the only thing it buys is
the report's two SHEETS — which are two formats here (`orders`, `agents`).
LEGACY_PARITY R4 sizes it the same way. If a carrier is ever found that refuses
CSV, `toCsv` is the one function that changes.

#### D-LP.6.2 — the export IS the list, filtered the same way

The legacy exported `orders.filter(o => o.status === 'confirmed')` out of the
whole book it had already downloaded, so its Export screen could not honour
anything the operator had narrowed to — a wilaya, a date window, an agent. Here
the export takes the SAME query string the list does through the SAME
`orderFilters` and `scopedWhere`. One vocabulary (D-LP.3), and a test drives one
query string through both and asserts they agree on the count.

That is also why the controls live **on the order list** rather than on a screen
of their own: the file is what is on screen. It needs no new nav item, which
`packages/product-registry` would be right to refuse for what is an action on a
list rather than a place.

#### D-LP.6.3 — a carrier file is confirmed orders, and no caller can widen it

`status` is dropped from the parameters for `zr`/`ecom`/`ecotrac` and
`confirmed` is ANDed in afterwards; every other filter still applies. Handing a
courier an order nobody has confirmed is a real delivery attempt against a
customer who never agreed to one.

**Attacking the implementation found the hole in this**: the rule was applied to
the filter path and not to the SELECTION path, so `POST {format:'zr', ids:[…]}`
would have put an unconfirmed ticked row into a carrier file. Ticking is a
deliberate act and the rule is not about intent — it is about somebody driving
to a customer's door. Fixed, with a test that ticks one of each.

#### The spreadsheet is a hostile-input surface, and the ERP's was too

`client`, `product` and `note` arrive from a storefront checkout and from
channel webhooks — a stranger types them — and the file is opened by an operator
on their own machine. Excel evaluates a cell beginning `=`, `+`, `-` or `@`:
`=cmd|…` has been a working command-execution vector for years and
`=HYPERLINK(…&A1)` exfiltrates the row beside it. `csvCell` neutralises those
with a leading apostrophe, and **only for values that are not plainly numeric**,
so a `-500` refund is still a number a carrier's importer accepts. The legacy
was injectable in exactly the same way through `XLSX.utils.json_to_sheet`; this
is a deliberate improvement, not a port.

**And the file starts with a UTF-8 BOM.** Without one Excel reads it as the
machine's ANSI codepage, so every accented wilaya is mojibake and every Arabic
name is question marks — and the operator's conclusion is that the export is
broken. **The test for it asserts BYTES, not text**: `Response.text()` strips a
leading BOM by specification, so the obvious assertion passes whether or not the
byte was ever sent. It was written the obvious way first and caught by failing
against a server that was sending one.

#### Who may export what — two gates, two questions

The route is `erp:orders:read` and the rows are record-scoped, so an agent
exports their own queue and a manager exports the book — exactly what each
already reads on screen. **`agents` additionally needs `erp:agents:manage`**: it
is a league table of confirmation rates and suspicious-call counts, and
`notifySuspiciousCall` withholds the same fact from the agent it is about for
the same reason. `access.test.ts` gained the surface and a test that a
caller-supplied `agentUserId` cannot widen an export.

#### The bound, and how it was verified

`EXPORT_LIMIT = 10_000`, and over it is a named `TOO_MANY_ROWS` carrying the
real total and the limit — never a short file that looks complete, which is the
defect LP.3 spent a slice removing. It runs inside the transaction `withTenant`
opened, so a cap is not optional.

**No fixture can reach 10,001 orders, so this path is verified manually rather
than by contract test**, and the reproduction is recorded so it is not folklore:
lower `EXPORT_LIMIT` to 2, rebuild, confirm three orders, and
`GET …?format=zr` answers `422 {"code":"TOO_MANY_ROWS","total":3,"limit":2}`
while a filter matching two still builds the file. Done, observed, restored.

**The port race caught this run, exactly as documented.** The first attempt
reported the limit had not taken effect; the cause was starting the new server
without stopping the old one, so `/api/health` answered 200 from the stale
process and the check ran against the previous build. Stop node, build, THEN
start — it costs a cycle every time it is forgotten.

#### Files
`src/lib/erp/export.ts` (new — the formats, the CSV writer, `exportWhere`),
`src/app/api/erp/orders/export/route.ts` (new — GET for the filtered link, POST
for the ticked rows), `src/components/console/erp/order-export.tsx` (new),
`src/components/console/erp/order-bulk.tsx` (+`bulk-export`, the one control
here that fetches rather than using `useApiAction`, because the response is a
document and not the JSON envelope),
`src/app/console/erp/orders/page.tsx`, `src/lib/console/{erp-strings,action-errors}.ts`,
`test/erp/{export,screens,access}.test.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json` (seven keys).

#### Migration
None. No schema change, no new column, no new permission — the two gates are
permissions that already existed.

#### Risk
**A file of customers leaves the building**, which is the feature. It carries
exactly the rows the caller can already read (`scopedWhere`), it is capped, it
is `cache-control: no-store`, and the one format that reveals anything about
COLLEAGUES is gated on the permission that supervises people.

**Rate limiting still does not exist** (R16, Tier 4), and this is the most
expensive read on the surface to repeat — a 10,000-row build per request.
Recorded there rather than half-solved here.

**Verified live:** export **31/31** (new) · screens 123 → **130/130** ·
access 65 → **68/68** · delivery 61/61 · orders 38/38 · listing 30/30 ·
catalog 55/55 · validation 29/29 · assign 25/25 · jobs 16/16 ·
notifications 33/33 · integrations 29/29 · order-split 8/8 · team 56/56 ·
billing 19/19 · signup 10/10 · console-shell 13/13 · builder-api 22/22 ·
storefront 22/22 · builder-sections 45/45 · db 29/29 · auth 36/36 ·
product-registry 36/36 · ui 26/26 · i18n 18/18. Build clean.

---

### LP.5 The real ZR Express adapter — and the carrier leaves the transaction

[Opus 5]
Date: 6 August 2026
Summary: `zr` is a registered adapter that books real parcels. delivery
**39 → 61**, screens **121 → 123**. Closes the second half of R2 and the last
large Tier 1 blocker. The load-bearing change is not the adapter: it is
**D-LP.5.1**, which took every carrier call out of the request's database
transaction.

#### What was wrong

`ADAPTERS` held one entry, `mock`. LP.2 stopped an unregistered key from being
silently simulated; it did not give anybody a carrier to book with. Not one
parcel could reach ZR Express, Ecom or anyone else, and the ERP's 479-line ZR
adapter — live territory resolution, Svix webhooks, outbound parcel creation —
had no equivalent.

#### D-LP.5.1 — a carrier is not a database, and must not share its transaction

`withTenant` opens an interactive transaction whose timeout is 15 seconds
(TX_OPTIONS). Every carrier call ran inside it, which was harmless only because
the one registered adapter was a synchronous simulator. A ZR booking is three
HTTP round trips to somebody else's server.

**That is a data-integrity problem, not a performance one.** Booking is
triggered by CONFIRMING an order. `confirm.ts` promised "nothing here may fail
the confirmation" and enforced it with a `try/catch` — which does not save a
transaction that has already timed out, because every statement after it fails
too. A slow carrier would therefore have rolled back the call record, the status
change and the stock movement: an agent rang a customer, the customer said yes,
and the record disappears because a third party was busy.

So every carrier interaction is now three phases — **plan** in a transaction,
**call** in none, **record** in a transaction — and the phases are separate
exported functions so both callers compose the same `ingestEvents`, which is the
one property that file exists to hold. `bookAtCarrier` takes no `db` at all, so
a future caller cannot hand it one.

`tenantRoute` gained **`afterCommit(work)`**: work that runs once the
transaction has committed and released, before the response is sent, and may
replace the response. Purely additive — a handler that never calls it behaves
exactly as before. It is not a background queue: the response still waits,
because an operator who pressed "book the parcel" is owed the answer.

**The test that proves it** makes the stub carrier sleep 17 seconds — decisively
past the 15-second transaction timeout and inside the adapter's own 25-second
limit — and asserts a 201 and a stored shipment.

#### The adapter, and the one place it deliberately diverges from the ERP

`src/lib/erp/carrier-zr.ts`. Territory resolution is the part that is not
obvious: ZR identifies wilaya and commune by its own UUIDs, so the order's NAMES
are resolved at booking time against `POST /territories/search` rather than from
a 1,585-row map that goes stale the first time ZR reorganises a district. The
alias table (`Béjaïa`/`Bejaia`/`bjaia`) is ported verbatim, because the wilaya on
an order is typed by a customer or read down a phone.

**The commune must belong to the resolved wilaya, with no fallback — and the ERP
had one.** `zr.js` searched every returned territory "ignoring parentId (rare but
safe)" when the scoped lookup missed. It is not safe: Algerian commune names
repeat across wilayas, so that fallback books a real parcel to the right NAME in
the wrong PLACE. A courier drives to another province, the customer is never
called, and the order looks perfectly booked — the wrong-answer-that-looks-right
this whole slice's refusals exist to prevent. An unresolvable commune is a
one-minute spelling correction, and the refusal names the word to correct.

**The Svix check fails closed.** `verifySvixSignature` in the ERP returns
*accept* when the headers are absent, when no secret is configured, and from its
own `catch` — SEC-04 exactly. A configured secret here means a signature is
required and must verify, and a test drives both the unsigned and the forged
case and asserts nothing was written.

**A ZR parcel has no tracking number when it is booked** — ZR assigns it later
and delivers it on the first webhook. Three consequences, each of which would
otherwise have made the adapter useless: the delivery webhook finds a parcel by
`carrierReference` as well as by tracking number; `recordTrackingNumber` writes
the number once, on the first webhook that carries it; and `canPoll: false`
makes "ask the carrier" answer `CARRIER_NO_POLLING` rather than 200 with an
unchanged timeline, which is LP.2's distinction applied to the other side of the
question.

#### A failed booking is TOLD, not only logged

`notifyShipmentFailed` restores the ERP's `shipment_failed` push. Without it an
unbooked parcel is invisible: the confirmation succeeded, the order looks
normal, and nothing says the carrier was never told. The reason travels in the
body — "ZR Express does not know a wilaya called …" — because "booking failed"
is a support ticket and the actual sentence is a correction somebody makes in a
minute. The console gained the five carrier refusal codes it had no i18n keys
for, `UNKNOWN_ADAPTER` included: LP.2 shipped that code and the screen rendered
"that did not work" for it.

#### Two defects found by measuring, and one found by attacking

**`guessStatus` read "Sorti en livraison" as DELIVERED.** It tested
`/livr|deliver/` first and "livraison" contains "livr". So an unmapped carrier
reporting a parcel that had just left the depot settled the order as delivered —
`deliveryOutcome` written, client lifetime spend moved, product revenue moved,
delivered pay earned, none of it reversible because settlement is permanent by
design. Reachable from the one path that deliberately keeps this fallback: a
webhook PUSHED for a carrier with no registered adapter (D-LP.2). That is BUG-02
arriving from the other direction. `apps/erp/lib/statusMap.js` had the order
right; both halves are restored, and `refus|rejected` — dropped entirely by the
port, so every unmapped refusal resolved to "pending" — is back.

**`Shipment` had no unique on `(tenantId, orderId)`.** "One parcel per order" was
stated in three comments and enforced by a `findFirst` before a `create`, which
under READ COMMITTED lets two concurrent bookings both see nothing and both
insert — two parcels collected, one customer paying once. The window was
milliseconds while the carrier call sat inside the transaction; D-LP.5.1 made it
as long as the carrier takes to answer, so this slice is what has to close it.
The constraint is now real, `bookShipment` recovers from the P2002 by returning
the winner's shipment, and a test fires two bookings at one order concurrently
and asserts one parcel and one creation event. Recorded in `CONSTRAINTS.md`.

**The carrier create panel mounted on click.** `{open && …}` meant the offered
adapter list only existed after JavaScript ran — unassertable by a contract test
and unreadable to assistive tech, which is the rule D-06.4 already states. It was
the last write surface still breaking it, and registering a second adapter is
exactly when "which integrations can be chosen" became worth asserting. Now
`hidden`, like every other panel.

#### The console

Registering the adapter makes it selectable everywhere at once: `listAdapters`
drives the carriers dropdown, `isKnownAdapter` drives the LP.2 configuration
gate, and the "integration unavailable" badge disappears from any row already
naming `zr`. Two controls were added because ZR cannot be configured without
them: a **webhook secret** field — the route has accepted `webhookSecret` since
Phase 5 and no control ever sent one, so inbound updates could only ever be
UNSIGNED — and the **inbound webhook address** on the credentials panel, because
a secret nobody can pair with an address configures nothing.

#### What this slice deliberately did NOT do

The scheduled poll still calls the carrier inside the job's transaction. It is
bounded by `POLL_BATCH = 25`, it writes nothing a person is waiting on, and
**neither registered adapter reaches a network from there** — ZR declares
`canPoll: false` and refuses first. Moving it out means `runJob` stops receiving
a bound `db` and starts opening a binding per parcel, which is a change to the
job runner and both of its routes. Recorded as **N17** and grouped with the Ecom
adapter (Tier 3, slice 22), the first registered carrier that can be polled.

`zr-webhook` (the older inbound-only ZR integration) and `ecom` are not
registered. Both stay where the roadmap already put them.

#### Files
`src/lib/erp/carrier-zr.ts` (new, the adapter),
`src/lib/erp/carrier-contract.ts` (new — the adapter contract, split out because
an adapter cannot import the registry that imports it),
`src/lib/erp/carriers.ts` (registry, `guessStatus`, `webhookIdentifiers`,
`verifyCarrierWebhook`, `parseCarrierWebhook`),
`src/lib/erp/shipments.ts` (plan/call/record for booking and refreshing,
`recordTrackingNumber`, the P2002 recovery),
`src/lib/erp/{confirm,jobs,notify,webhooks}.ts`,
`src/lib/api/route.ts` (`afterCommit`),
`src/app/api/erp/orders/[id]/{route,call/route,shipment/route,shipment/refresh/route}.ts`,
`src/app/api/erp/webhooks/[tenant]/delivery/route.ts` (identify → authenticate →
interpret), `src/app/console/erp/carriers/page.tsx`,
`src/components/console/erp/carrier-write.tsx`,
`src/lib/console/{action-errors,erp-strings}.ts`,
`packages/db/prisma/schema/erp.prisma` + `packages/db/CONSTRAINTS.md`,
`test/erp/{delivery,screens}.test.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json` (five error keys, three carrier
keys).

#### Migration
**One schema change:** `@@unique([tenantId, orderId])` on `Shipment`, applied
with `prisma db push` after verifying zero duplicate groups on the live
database. RLS re-applied (47/47) and the preflight re-run. No data was altered.

#### Risk
**A booking now holds no database transaction while the carrier answers**, which
is the fix, and the cost is that two operators pressing the button at the same
moment can both reach the carrier before either writes. The database refuses the
second row; the duplicate parcel at the carrier is the honest, unavoidable price
of asking a third party outside a transaction, and it is logged by name.

**A ZR carrier with no webhook secret accepts unsigned payloads**, which is the
platform's existing posture for every channel that predates its secret, closable
with `REQUIRE_WEBHOOK_SIGNATURES=1`. **No ZR credentials exist here**, so the
adapter has never spoken to the real `api.zrexpress.app` — it is driven end to
end against a stub ZR server over real HTTP, exercising the territory search,
the auth headers, the parcel body, ZR's error shapes and the Svix envelope.

**Verified live:** delivery 39 → **61/61** · screens 121 → **123/123** ·
access 65/65 · orders 38/38 · jobs 16/16 · notifications 33/33 · catalog 55/55 ·
listing 30/30 · validation 29/29 · assign 25/25 · integrations 29/29 ·
order-split 8/8 · team 56/56 · billing 19/19 · signup 10/10 ·
console-shell 13/13 · builder-api 22/22 · storefront 22/22 ·
builder-sections 45/45 · db 29/29 · auth 36/36 · product-registry 36/36 ·
ui 26/26 · i18n 18/18. Build clean.

---

### LP.4 An order can be taken over the phone

[Opus 5]
Date: 6 August 2026
Summary: `OrderCreatePanel` on `/console/erp/orders`. screens **112 → 121**.
Restores N6, the last of the small Tier 1 blockers. Two new findings recorded
rather than silently fixed — see below.

#### What was wrong

`POST /api/erp/orders` has been contract-tested since Phase 5.2. It normalises
the number, creates the customer record, runs `autoAssignOnCreate` and raises a
notification — and **nothing called it from the console**. A manager with a
customer on the line had no way to enter the order. The legacy CRM opens this
modal from its main screen.

The second-pass review found it only because it stopped counting routes and
started counting workflows: on a route inventory, "create an order" looked
complete.

#### The field list is the route's

Every box names a key `CreateOrder` parses; none names a key it ignores, and a
test asserts both directions. A form with its own idea of the fields is the
second vocabulary LP.3 spent a slice removing — it goes stale silently, and it
shows up as a box somebody fills in that quietly does nothing.

**Two fields the route accepts and the panel deliberately does not offer**, each
stated on the component rather than silently missing:

- `deliveryMethod` — `'COD'` everywhere with no vocabulary to build options
  from. A free-text box would write values nothing downstream understands. The
  rule NEXT_STEPS §1 already records.
- `source` — set by the system to `"manual"`. An order claiming to have arrived
  from Shopify when it did not corrupts every channel report downstream.

**`carrierCode` is a select over the tenant's active carriers, not a text box.**
`createShipment` looks the code up and falls back to the DEFAULT carrier when it
matches nothing — so a typed code books the wrong carrier and says so nowhere.
Empty means "use the default", which is what the ERP did.

**`agentUserId` is offered only to somebody who sees the whole book** (D-06.2):
the route answers `403 FORBIDDEN_FIELD` for anybody else, so a control for it
would be one the API refuses. Absent, not disabled — a disabled select still
says "you nearly could". The panel itself is NOT withheld from an agent, because
the route accepts an order from one, and withholding a control the API accepts
is the other half of the same rule.

#### Two findings this slice surfaced, recorded not fixed

**N15 — the price breakdown is lost at entry.** The legacy modal captures unit
price, discount and shipping and DERIVES the total, so a manually-entered order
carries the same breakdown a storefront order does. `CreateOrder` accepts a flat
`price`. The four columns exist and are `MANAGER_WRITABLE`, so they are
reachable by a `PATCH` a second later but never at creation. Widening the create
route means deciding whether it derives the total or trusts it — a real design
question, and a separate slice.

**N16 — create and edit disagree about who may set a price.** `price` and
`carrierCode` are `MANAGER_WRITABLE` in `buildPatch` (an agent cannot change
them) and **ungated in `CreateOrder`** (an agent can set them on a new order).
One of the two is wrong. The panel follows the ROUTE, per D-06.2 — deciding
which rule is right is an authorization change and deserves its own review, not
a quiet edit inside a UI slice.

#### A test fixture repaired

`listing.test.ts` creates 120 orders through the API and never checked that any
of them succeeded, so one transient `P1001` during setup surfaced much later as
`total >= 120` failing — which reads as a paging bug and is not one. The fixture
now asserts each create and names the one that failed. Same principle the suite
already applies to its assertions, applied to its scaffolding.

#### Files
`src/components/console/erp/order-create.tsx` (new),
`src/app/console/erp/orders/page.tsx` (the panel, plus the carrier query and one
shared `statusChoices` where the status list had been built twice),
`src/lib/console/erp-strings.ts` (`orderCreateStrings`),
`test/erp/{screens,listing}.test.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json` (four keys under `erp.write`).

#### Migration
None. No route, schema or authorization changed — this slice is a caller for a
route that already existed.

#### Risk
**A create surface is reachable by anybody holding `erp:orders:write`**, which
is what the route has always allowed and what an agent needs to take a phone
order. The disabled submit mirrors the route's "a name or a number" rule as a
courtesy; the rule itself is still enforced on the server, and a test drives the
refusal directly so it cannot rot into a client-side-only check.

**Verified live:** screens 112 → 121/121 · listing 30/30 · orders 38/38 ·
access 65/65 · catalog 55/55 · delivery 39/39 · validation 29/29 ·
console-shell 13/13 · i18n 18/18. Build clean.

---

### LP.3 The lists become navigable — pagination, filters and search

[Opus 5]
Date: 6 August 2026
Summary: a shared `<Pager>` and `<FilterBar>`, and the ERP's lists wired to
them. screens **100 → 112**, listing **25 → 30**. Restores N1, N7, N8 and the
corrected B1 — the first Tier 1 slice from the re-ordered roadmap.

#### What was wrong

**Row 51 did not exist.** Every ERP screen was a hard-capped first-N read —
orders 50, clients 50, products 100, shipments 100 — with no next, no page
number and no total. The legacy CRM downloaded the whole book and filtered in
the browser, which is slow at 5,000 rows and is what PERF-02 was filed for; the
platform fixed the query side properly and then never built the navigation on
top of it. The data went from *slow to reach* to *impossible to reach*, which is
a worse outcome than the bug that was fixed.

**And nine filters had no controls.** `orderFilters` accepts status, agent,
follow-up agent, wilaya, channel, order type, classification, delivery outcome
and a date window — richer than the four the legacy had — reachable only by
hand-writing a query string. A capability nobody can find is not a capability.
The `search` the clients and products APIs accept had no box either.

#### Offset paging, not a cursor — a correction to this project's own proposal

LEGACY_PARITY §6.4(b) proposed cursor paging "because `skip`/`take` at page 200
is a sequential scan". That was wrong on the decisive point, and the report now
records the correction rather than the platform shipping something worse to
match it. A cursor cannot show **"page 3 of 27"**, and an operator asking how
many pending orders exist is asking a business question a next-arrow cannot
answer. More decisively: the API's `pagination()` helper is already
`page`/`pageSize`, so a screen paging by cursor would be a **second vocabulary
over the same rows** — the exact failure this slice exists to remove. The deep
scan is real and is bounded by the filter bar sitting beside it.

#### The vocabulary lives with the validator

`orderFilterFields` is exported from `lib/erp/orders.ts`, the same module as
`orderFilters`. A bar with its own list of fields is a second vocabulary that
goes stale the moment a filter is added — showing up not as an error but as a
capability nobody can find, which is the defect being fixed. **A test asserts it
both ways**: every offered control names a key `orderFilters` reads, and each
offered value is then exercised for real.

`agentUserId` is offered only to somebody who sees the whole book. `scopedWhere`
ANDs the scope in regardless, so for an agent the control could not change
anything — and a control that cannot work teaches the wrong model of what they
are allowed to see.

#### Named date windows, resolved in ONE place

`range=today|yesterday|week|month` joins `orderFilters` itself rather than being
turned into timestamps by the page. Had the screen done its own arithmetic, the
screen and an export would eventually disagree about what "today" contained.
Explicit `since`/`until` still win, and an unknown range is **ignored, not
refused** — a stale bookmark must render the list, the same rule `orderSort`
already applies to an unknown sort column.

`toBound` accepts both shapes a caller can send. The API's callers have always
sent epoch milliseconds; `<input type="date">` sends `YYYY-MM-DD`, and
`Number("2026-08-06")` is `NaN` — so the bar's own values would have produced an
Invalid Date and a query nobody could explain. `until` as a calendar date
resolves to end-of-day, because `lte 2026-08-06T00:00` silently drops a day's
orders and that is a figure somebody would then report.

#### Two defects the tests caught, and two assertions that were wrong

The page is **clamped to the real last page**: following a stale bookmark to
page 99 shows the last page, not an empty table — an empty table reads as "no
matches", which is a lie about the data. And the filter form carries a hidden
empty `page`, so applying a filter from page 3 cannot land on nothing.

Two of the new tests failed first and **both were the test, not the code**, which
is worth recording because the instinct is to "fix" the implementation:

- *"paging cannot widen an agent's scope"* expected an agent to see zero rows.
  They legitimately see **unassigned** orders — `orderScope`'s rule, so unclaimed
  work can be picked up. Rewritten to assert the real property: orders belonging
  to *another agent* are absent from every page, and the manager can reach them.
- *"a product search narrows the catalogue"* counted `data-product-id`, which is
  also carried by the row's archive button and the edit panel's submit. It was
  counting controls, not rows.

#### Files
`src/components/console/{pager.tsx,filter-bar.tsx,filter-field.ts}` (new),
`src/lib/erp/orders.ts` (`DATE_RANGES`, `toBound`, `rangeBounds`,
`orderFilterFields`, `range` in `orderFilters`),
`src/lib/console/erp-strings.ts` (`pagerStrings`, `filterStrings`),
`src/app/console/erp/{orders,clients,products,shipments}/page.tsx`,
`test/erp/{screens,listing}.test.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json` (`common.previous/next/pagePosition/
resultCount`, the `erp.filters` category).

#### Migration
None. Every filter this exposes was already implemented and tested; `range` is
additive and no existing caller changes.

#### Risk
**A count query per list page.** It runs against an index that already exists
(`@@index([tenantId, createdAt])` and friends) and buys the total an operator
needs. **A deep offset is a scan**, mitigated by the filter bar rather than by a
cursor — see the correction above. Nothing that worked before changes shape:
`since`/`until` still accept epoch milliseconds, and a screen with no `?page=`
renders exactly as it did.

**Verified live:** screens 112/112 · listing 30/30 · orders 38/38 ·
catalog 55/55 · access 65/65 · delivery 39/39 · validation 29/29 · i18n 18/18.
Build clean.

---

### LP.0b The second pass — the first review measured APIs, not workflows

[Opus 5]
Date: 6 August 2026
Summary: `LEGACY_PARITY.md` re-measured from `9d1f887` at the level of
**workflows** rather than routes — the SPA's 4,949 lines of JavaScript, the agent
PWA's live loop, the service worker, and every control on every screen.
**101 → 115 features. Five pass-1 verdicts corrected, fourteen features found.**
52 identical · 6 improved · 18 partial · 39 missing. No code changed.

#### The systematic error in the first pass

A feature was marked ✅ **when the endpoint existed and had contract tests.**
Several of those endpoints have no caller anywhere in the console. The first pass
caught exactly this in `IntegrationLog` — model migrated, zero callers — recorded
it as a one-off finding, and then did not look for the pattern anywhere else. It
is the dominant defect class in this port.

| Corrected | Was | Now |
|---|---|---|
| L1 live notification feed | 🔵 | **🔴** — M-16's transport (storage, audience, SSE with exact replay, Web Push, service worker, **33 tests**) has no consumer. No bell, no badge, no panel, no toast. An operator is never told anything. |
| L2 per-account read state | 🔵 | **🔴** — `unreadCount()` has no caller. |
| L3 Web Push | ✅ | **🟡** — sends, but with no in-app surface it is the ONLY possible channel, and VAPID is unset by default. |
| B3 create an order | ✅ | **🔴** — `POST /api/erp/orders` is tested and has no console control. A phone order cannot be entered. |
| B1 list + filter | ✅ | **🟡** — `orderFilters` supports nine filters, richer than the legacy's four, and the orders screen renders no filter form. |

#### The finding that changes the verdict

**There is no pagination anywhere in the console.** Orders 50, clients 50,
products 100, shipments 100, follow-up 100, queue 20 — no next, no page number,
no total. The legacy downloaded the whole book and filtered in the browser, which
is what PERF-02 was filed for; the platform fixed the query side properly (filter,
scope and page all in SQL) **and never built the navigation on top of it**. The
data went from *slow to reach* to *impossible to reach*. Row 51 does not exist.

#### The other thirteen, none of which a route inventory could see

Live console updates (the legacy re-renders on every SSE event and flashes the
changed row); the notification bell/badge/panel; **six typed Web Audio sounds**
with per-type toggles and a volume; desktop notifications; the order-list filter
bar; a search box on any list; inline row actions (agent, carrier, express and
status selects on the row itself); list information density (~14 facts per legacy
row against 8); the payroll report; the audit-log view; the offline app shell;
and the live follow-up countdown.

**Explicitly NOT a gap:** global keyboard shortcuts and context menus. Neither
system has any — the only key handlers in either client are Enter-to-submit on
three inputs. Recorded so nobody goes looking for shortcuts that never existed.

#### Workflow cost, measured

| Operation | Legacy | Platform |
|---|---|---|
| Reassign an order | 2 clicks | 4 |
| Change the carrier | 2 clicks | 4 |
| "Pending orders in Alger from yesterday" | 3 clicks | impossible from the UI |
| Enter a phone order | 2 clicks | impossible |
| Learn a new order arrived | 0 — sound + toast + the row appears | never, until reload |
| Reach the 60th order | 1 — scroll | impossible |

One cause: **D-06.1 was applied without ever building the list-level controls**,
so every mutation is a page navigation. The decision is right and does not
require that cost — a control in a table row still calls the route.

#### What the platform does better, recorded so it is not traded back

Nine things, in LEGACY_PARITY §6.3: query-side filtering and scoping (PERF-02),
three-layer tenant isolation, opaque revocable sessions, jobs out of the web
process, notification audiences decided at write time, `Decimal` money, atomic
client counters, the assignment rules that fix the ERP's `overdueFlaggedAt` bug,
and the contract-test discipline itself. **None of it may be given up to restore
the consumer layer.**

#### Two decisions re-opened

**Live updates.** Neither system has a working live console at scale — the legacy
fans out from an in-process map (wrong on two instances, lost on deploy), the
platform built the correct transport and stopped. Proposed: one
`<NotificationProvider>` in the shell owning a badge, a toast, and a **debounced
`router.refresh()`**, so a burst of carrier events costs one re-render. Keeps
every D-06 rule — server-rendered truth, event-driven invalidation, no optimistic
UI, no second write path.

**The offline shell.** 6.6e closed this on "a cache keyed by URL survives signing
out". That is true and too broad: a **shell-only** cache holds markup and CSS
identical for every tenant, leaks nothing, and is the difference between a
dropped 3G connection showing a stale screen and showing nothing — which is the
normal case for a field agent. Recommended for revisit with that narrower scope.

#### Roadmap re-ordered

By: production blockers → daily operator productivity → business value →
architectural dependencies → risk. Pagination moves to **first** (row 51 is
unreachable, and the shared `<Pager>`/`<FilterBar>` are a dependency of most of
what follows). The real ZR adapter moves back one place **deliberately**: it is
the highest-risk slice in the roadmap — network I/O inside a 15s transaction —
and the two slices ahead of it are low-risk and unblock daily work immediately.

#### Files
`LEGACY_PARITY.md` (§0b, §3b, §6 new; §1 and §4 rewritten; five rows corrected
in place so no table disagrees with the corrections), `PROJECT_STATE.md`,
`NEXT_STEPS.md`, `CHANGELOG.md`.

#### Migration
None.

#### Risk
None — no code changed. The risk this entry removes is the one it names: two
slices had been implemented against a roadmap built on an API inventory, and the
next one queued was the largest and riskiest while an operator still could not
enter an order, find one, or be told that one had arrived.

---

### LP.2 An unknown carrier adapter is refused, not mocked

[Opus 5]
Date: 6 August 2026
Summary: `getAdapter` returns **null** for an unregistered key instead of
falling back to `mock`, and every path that could act on one refuses by name.
delivery **33 → 39**, screens **99 → 100**. First half of R2; the real ZR
Express adapter is the second.

#### The defect

`ADAPTERS` holds one entry, `mock`. `getAdapter` ended
`?? mock`, so **any** key resolved to the simulator. The legacy ERP offers
twelve adapter keys in its dropdown and implements four for real, and
`Carrier.adapter` was a free-text column with no validation — so a tenant could
configure a carrier as `zr`, press "book parcel", and get:

- `mock.createShipment` inventing a `MOCK…` tracking number,
- a `201` and a shipment row,
- the tracking number written onto the order,
- and a `created` event on the timeline.

Nothing had been booked with anybody. **An order that booked successfully is one
nobody looks at again**, so the failure surfaced as a customer asking where their
parcel was. A wrong answer that looks right is worse than an error, and this one
is worse still because the second half compounds it: polling that shipment walked
a REAL parcel along the mock's synthetic six-step pipeline and **settled its
delivery outcome** — booking revenue, client lifetime spend and delivered-order
pay for a delivery that never happened. That is BUG-02's blast radius, reached
from the other direction.

#### Refused at both ends

**At configuration.** `POST /api/erp/carriers` and `PUT /api/erp/carriers/[id]`
refuse an unregistered `adapter` with `422 UNKNOWN_ADAPTER`. The message NAMES
the keys that do work — a bare "unknown adapter" is a dead end when twelve keys
exist in the operator's head and one exists here. Omitting `adapter` still
defaults to `mock`, so nothing that worked stopped working.

**At use.** A row can already hold a bad key — it predates the check, or a
deployment dropped an adapter it used to have — so `createShipment` and
`refreshShipment` refuse too, and the routes answer `422 UNKNOWN_ADAPTER`. The
refresh route says it out loud rather than answering 200 with an unchanged
timeline: "the carrier has no news" and "we cannot ask this carrier anything"
are different facts.

#### One deliberate exception — a webhook the carrier PUSHED

`mapCarrierStatus(key, original)` keeps the keyword fallback for an unregistered
adapter, and the inbound delivery webhook uses it. Interpreting a status string
cannot invent a parcel, and the carrier sent this event — dropping it would lose
a real delivery outcome to a configuration problem. A test asserts a pushed
`Livré au client` still settles the order while booking and polling refuse.

#### The screen says so on the row

`/console/erp/carriers` flags a carrier whose adapter is unavailable
(`data-known="false"`), because a row that looks identical to a working one is
how this stayed hidden. `pollCarriers` counts those shipments as **skipped**
rather than polled — reporting a healthy sweep over parcels nobody asked about
is the same class of lie.

#### Files
`src/lib/erp/carriers.ts` (`getAdapter` → nullable, `isKnownAdapter`,
`mapCarrierStatus`), `src/lib/erp/shipments.ts`, `src/lib/erp/jobs.ts`,
`src/app/api/erp/carriers/route.ts` (+`unknownAdapterMessage`),
`src/app/api/erp/carriers/[id]/route.ts`,
`src/app/api/erp/orders/[id]/shipment/route.ts`,
`src/app/api/erp/orders/[id]/shipment/refresh/route.ts`,
`src/app/api/erp/webhooks/[tenant]/delivery/route.ts`,
`src/app/console/erp/carriers/page.tsx`,
`test/erp/{helpers,delivery,screens}.test.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json` (`erp.carriers.adapterUnavailable`).

#### Migration
None. Existing rows are unchanged; a bad one is now visible and refused rather
than silently mocked.

#### Risk
**A tenant who had configured a carrier the platform cannot talk to now gets an
error where they previously got a fake success.** That is the fix. `mock` is
still the default and still the only registered adapter, so every existing
working configuration is untouched, and the contract suite — which drives `mock`
end to end — is unaffected.

**Verified live:** delivery 39/39 · screens 100/100 · access 65/65 · jobs 16/16 ·
catalog 55/55 · i18n 18/18. Build clean.

---

### LP.1 Product editing — the correction that was never possible

[Opus 5]
Date: 6 August 2026
Summary: `PATCH /api/erp/products/[id]` and the edit panel on
`/console/erp/products`. **Tier 1, slice 1** of the LEGACY_PARITY roadmap.
catalog **40 → 55**, screens **96 → 99**, access **63 → 65**. Restores R1.

#### What was wrong

`products/[id]/route.ts` exported `GET` and `DELETE` and nothing else, so a
product could be created and archived and **never corrected**. The legacy ERP
had `PUT /api/products/:id` and the port dropped it. Nothing caught that,
because a contract test attacks routes that exist and a route that is simply
absent has nothing to fail.

It mattered most for money. `costPrice` and `packagingCost` are the cost basis
every FIFO lot draws from, what delivered-order pay is computed against, what
`/sales-summary` reports and what every saved P&L record is built on. A typo at
creation was permanent, and it made every profit figure derived from it **wrong
rather than absent** — the failure mode this codebase already records twice in
the create path. Archive-and-recreate was the only workaround and it orphans
the movement ledger.

#### PATCH, not the ERP's PUT

Same reasoning as `PATCH /api/erp/orders/[id]`: a whole-resource write means a
console that reads the row, edits one box and sends the object back rewrites
every column, which is how a masked secret gets written over a real one
elsewhere here. A patch of named fields cannot do that, and a test asserts an
unnamed field survives.

#### D-LP.1 — `stock` and `variants` are REFUSED, which is stricter than the ERP

The ERP's PUT recomputed the flat `stock` column from whatever the caller sent.
On the platform stock is owned by the movement ledger: `applyMovement` writes
the level and its reason in one transaction, and that pairing is the only reason
the cost basis can be trusted. An edit that set a level directly would move
stock with no movement row behind it.

Both are **named refusals (422), not silently dropped fields**. A caller sending
`stock` believes they are setting a level, and answering 200 while doing nothing
is precisely the failure this whole slice exists to stop happening to
`costPrice`. Levels move through `/inventory/adjust` and `/stock-lots`; the
variant editor is its own surface (LEGACY_PARITY R12).

#### The timeline records what changed, not that a save happened

`CatalogProductEvent` has carried `field`, `oldValue` and `newValue` since M-03
and no route had ever written them. Ported from `saveProduct` in
`apps/erp/lib/db.js`, one row per **changed** field: `price_change`,
`cost_change`, `packaging_cost_change`, `brand_changed`. A save that changes
nothing writes nothing — a timeline that records every save is a timeline
nobody reads.

Money is compared through the `Decimal`, not the string and not the float:
`2000` and `2000.00` are the same price and must not produce an event. Tested
both ways. `supplier_changed` is in the ERP's set and absent here because
`CatalogProduct` has no `supplier` column yet; it lands with the column (R12).

#### An invalid batch changes nothing at all

`buildProductPatch` returns on the first problem, so a request carrying one good
field and one bad one stores neither. Same rule `validateSettings` holds, and
for the same reason: half-applying a rejected request is worse than refusing
it — the caller is told it failed and half of it happened anyway.

An EMPTY patch is a successful no-op, not a 422. A form that submits only what
somebody touched sends nothing when they touched nothing.

#### The screen

`ProductEditPanel` follows the panel this file already had: a server-rendered
product picker, then the fields for the selected product. The field descriptors
are built on the SERVER from `EditField`, and the inner component is keyed on
`editFingerprint` — so a save refreshes the page and the boxes come back holding
what was **stored**, not what was typed (D-06.3). The picker sits outside that
key, so a save does not throw away the selection.

Offered on the archived view too: archiving means "stop selling it", not "freeze
it", the route accepts the edit either way, and withholding a control the API
accepts is the converse half of D-06.2. There is no `stock` box and no variant
list, because the route refuses both — a control the API cannot honour is worse
than a missing one. Money is `inputMode="decimal"`, never `type="number"`.

#### Files
`src/lib/erp/catalog.ts` (new — `buildProductPatch`, `productChangeEvents`),
`src/app/api/erp/products/[id]/route.ts` (+PATCH),
`src/components/console/erp/catalog-write.tsx` (+`ProductEditPanel`,
`ProductEditFields`, `EditableProduct`, four `CatalogStrings` keys),
`src/lib/console/erp-strings.ts`, `src/app/console/erp/products/page.tsx`,
`test/erp/{catalog,screens,access}.test.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json` (`erp.write.editProduct`,
`erp.write.description`).

#### Migration
None. Every column this writes already existed, including the three on
`CatalogProductEvent` that had no writer.

#### Risk
A product's commercial fields are now mutable by anyone holding
`erp:products:write`, which is what the ERP always allowed. The two fields that
could have corrupted the ledger are refused rather than accepted, and every
change to a money field leaves a row nobody can edit or delete.

**Verified live:** catalog 55/55 · screens 99/99 · access 65/65 · listing 25/25 ·
console-shell 13/13 · i18n 18/18. Build clean.

---

### LP.0 The feature gap report — measuring the legacy CRM against the platform

[Opus 5]
Date: 6 August 2026
Summary: **LEGACY_PARITY.md** is new. Both implementations were read end to end
and compared feature by feature — **101 features**, each classified IDENTICAL /
IMPROVED / PARTIAL / MISSING, with a restoration roadmap ordered by business
value. **No code was written.** Phase 8 is deferred until parity is restored.

#### The result

| Class | Count |
|---|---|
| ✅ IDENTICAL | 55 |
| 🔵 IMPROVED | 8 |
| 🟡 PARTIAL | 14 |
| 🔴 MISSING | 24 |

**The platform cannot replace the legacy CRM in production today.** The order
pipeline is at or above parity; what is missing clusters in four places, and
three are hard blockers:

- **No real carrier adapter.** `ADAPTERS = { mock }` in `lib/erp/carriers.ts`.
  The legacy system ships four working adapters — `zr.js` alone is 479 lines
  with live territory resolution and outbound parcel creation. Worse than
  absent: `getAdapter` falls back to `mock` for any unknown key, so a carrier
  configured as `zr` books a fabricated `MOCK…` tracking number and reports
  success.
- **No product editing.** `products/[id]/route.ts` exports `GET` and `DELETE`
  only. A wrong `costPrice` is permanent, and it is the cost basis for FIFO
  lots, delivered-order pay, `/sales-summary` and every P&L record.
- **No export of any kind.** No CSV, no XLSX anywhere on the platform. The
  legacy Export screen is how confirmed orders reach carriers.
- **No client management.** Read-only list. No detail, no correction, no
  import — although `Client.importedTotalOrders` / `importedSource` /
  `importedAt` are in the schema for exactly that, unused.

#### Two defects the measurement found in shipped code

**`/console/erp/ai` is a live 404.** The ERP manifest ships an `ai` nav item
(`packages/product-registry/src/manifests.ts:89`) and no `console/erp/ai/page.tsx`
exists. `screens.test.ts` enumerates eight screens and does not include it, so
nothing catches it — an owner clicking "AI" in their own product's navigation
gets a not-found. PROJECT_STATE's claim that every nav item leads to a real
screen was off by one.

**`IntegrationLog` has zero callers.** The model was migrated (`erp.prisma:430`)
and nothing reads or writes it. `Carrier.lastTestAt` / `lastSyncAt` / `lastTestOk`
are selected by the API and rendered by `carriers/page.tsx:181` — and written by
nothing, because no test or sync route was ported. The column shows "—" forever.

#### Why the gaps were invisible

The same reason 6.5/6.6 kept finding Phase 5 gaps: **contract tests over HTTP
attack endpoints, and an endpoint that is simply absent has no test to fail.**
The ERP surface was declared complete by counting routes that exist, never by
diffing against the routes that existed before. This report is that diff:
123 legacy routes and 15 legacy screens against 60 platform route files and
12 screens.

#### Files
`LEGACY_PARITY.md` (new). `PROJECT_STATE.md`, `NEXT_STEPS.md`, `CHANGELOG.md`
updated to make parity restoration the current phase.

#### Migration
None. **The schema is already at parity** — all 27 legacy tables have a platform
home. Every gap is behaviour, and several are storage that exists with nothing
using it.

#### Risk
None — no code changed. The risk this entry records is the one it removes:
Phase 7 completed and Phase 8 was queued while the ERP could not book a parcel,
edit a product, or export an order.

---

## Phase 7 — The SaaS layer

### 7.3 Self-serve signup — the first public write path

[GLM-5.2]
Commit: `9a17d1d570f38176b0c456e753dea6e1bb9cf612`
Authoring model: GLM-5.2
Date: 6 August 2026
Summary: `POST /api/platform/signup` + `/console/signup`. A signed-out visitor can
now create a tenant, become its OWNER, and land in their console — signed in,
with a TRIALING subscription holding both products. `test/platform/signup.test.ts`
is new at **10/10**. **Phase 7.3 is complete; Phase 7 (the SaaS layer) is
complete.**

#### R-08 closed — the reserved-word list is enforced at creation

`Tenant.slug` is a public-namespace unique that appears in every storefront URL,
so a customer claiming `api` or `console` would shadow the platform for everyone.
A reserved-word list (`RESERVED_TENANT_SLUGS` + `isReservedSlug`) already guarded
the storefront READ path; this slice enforces it at CREATION — the half the
schema comment promised but no route implemented, because no creation route
existed. Signup imports `isReservedSlug` and refuses with `RESERVED_SLUG` before
`tenant.create`. A test exercises `api`, `console`, `login`, `signup`, `uploads`.

#### Four writes, two binding contexts

The four rows live in two RLS worlds: `Tenant` and `User` are platform-side (no
tenantId, no policy), so they are written through `asPlatform()`; `Membership`
and `Subscription` are tenant-scoped (RLS), so they are written through
`withTenant(newTenantId)` inside one transaction. The second half is atomic with
respect to itself; if it fails the tenant+user are orphaned (acceptable for a
first slice, rare in practice — the only failure is a concurrent slug collision
the unique constraint catches at the first `tenant.create`).

#### The refusal vocabulary

| Condition | Status | Code |
|---|---|---|
| reserved slug (R-08) | 422 | `RESERVED_SLUG` |
| not kebab-case / wrong length | 422 | `INVALID_INPUT` |
| slug already taken | 409 | `SLUG_TAKEN` |
| email already registered | 409 | `EMAIL_TAKEN` |
| weak/missing password or field | 422 | `INVALID_INPUT` |

The 404-not-403 rule does NOT apply here: this is a public CREATE, and telling a
signup that a slug or email is taken is necessary, not an oracle. One account per
email — the consultant case is one person in many companies via Membership, not
many accounts.

#### The new owner lands signed in

The route creates a session with `activeTenantId` = the new tenant and sets the
cookie — the same shape login uses. The caller's next request opens the console
straight into the company they just created. A signed-in visitor is not blocked:
they can sign up a second company (the new session replaces the old cookie).

#### Design decision: both products on trial

A fresh tenant starts with BOTH products on trial
(`['product.website-builder', 'product.erp']`). A trial that shows an empty
console teaches nothing, and the billing screen (7.2) lets the owner turn them
off. `Subscription.status` is left as the schema default `TRIALING` — NOT set to
`ACTIVE` the way the dev seed does.

#### Files
`apps/website-builder/src/lib/platform/signup.ts` (new),
`src/app/api/platform/signup/route.ts` (new),
`src/app/console/signup/page.tsx` (new),
`src/components/console/signup-form.tsx` (new),
`test/platform/signup.test.ts` (new),
`packages/i18n/src/messages/{en,fr,ar}.json` (the `signup` category).

#### Migration
None. `Tenant`, `User`, `Membership`, `Subscription` all existed; this slice is
the first route that creates them together.

#### Risk
**The signup endpoint is reachable by anyone, signed-out.** That is the design.
The slug is validated (kebab-case, reserved-checked, unique), the email is
unique, and the password has a floor. A deployment that exposes this endpoint
accepts that anybody can create a tenant — which is what "self-serve signup"
means.

**Verified live:** signup 10/10 · team 56/56 · billing 19/19 · access 63/63 ·
console-shell 13/13 · i18n 18/18. Build clean. End-to-end: POST signup → 201,
session cookie works (team members = 1), storefront at `/{slug}` → 200.

---

### Demo tenant — a fully working tenant for manual evaluation

[GLM-5.2]
Commit: `55fd590c7008e6d8fea1d6a4cfe1ad89724abb84`
Authoring model: GLM-5.2
Date: 5 August 2026
Summary: `npm run seed:demo --workspace @landingos/db` provisions one tenant
("demo") with an owner, a manager, two agents, a catalogue, inventory, six
orders in different states, a carrier with shipments and tracking events, a
follow-up task, notifications, a P&L record and the ERP automation settings.
Deterministic and idempotent. See **DEMO.md** for credentials, URLs and how to
recreate.

The seed writes platform rows (Tenant, User, Membership, Subscription,
ProductSetting) through `asPlatform()` and ERP domain rows (CatalogProduct,
StockLot, InventoryMovement, FulfillmentOrder, Client, Carrier, Shipment,
ShipmentEvent, FollowupTask, Notification, FinancialRecord,
TenantDeliveryPrice) through `withTenant(tenant.id)` — the same split every
request uses, because ERP tables are RLS-scoped and the platform is not.

Idempotent by delete-cascade-then-recreate: the script deletes any existing
`demo` tenant (the cascade wipes every scoped table) and rebuilds it, so
re-running never produces duplicates and never touches `seed:dev` tenants.

#### Files
`packages/db/scripts/seed-demo.ts` (new), `packages/db/package.json`
(`seed:demo` script), `DEMO.md` (new — credentials, URLs, recreate).

#### Migration
None. No schema change.

#### Risk
**The demo password is `devpassword123`.** A deployment that runs the demo seed
on a reachable database has created known-credential accounts. The seed is a
development tool, like `seed:dev`; it must not run against production.

**Verified live:** seed succeeds and is idempotent (run twice, no duplicates).
Build clean; server starts on :3000. Storefront `/demo` → 200. Console login →
200. Signed in as `owner@demo.test`: ERP orders (6), catalogue (4), team (4),
billing (200) all reachable through the API.

---

### 7.2 Billing — change entitlements and watch access follow

[GLM-5.2]
Commit: `96f10e956b87e734f37c9c6864cce0e78acc4295`
Authoring model: GLM-5.2
Date: 4 August 2026
Summary: A billing management surface — `GET /api/platform/billing` and `PUT
/api/platform/billing/entitlements`, plus `/console/settings/billing`. `test/
platform/billing.test.ts` is new at **19/19** (14 API + 5 screen). Deliberately
NOT a payment integration; the first slice is entitlement management only, and
the load-bearing test proves the property the slice exists for: **drop
`product.erp` and every ERP route 403s on the very next request.**

#### The domain was already done — this is the management half

`Subscription` holds `status` and `entitlements`, and every gate in the platform
already reads them fresh on every call: `can()` (via `resolveSession`, which
re-reads the subscription on every HTTP request), the worker's tick (`hasProduct`
inside `withTenant`), `assign` (`entitlementsOf`), and `notifications`
(`recipients`). So a write to `Subscription.entitlements` takes effect
immediately — no cache to bust, no session to re-issue, no event bus. This slice
is the UI over that row.

#### The load-bearing test

`drop product.erp and every ERP route 403s immediately`: an agent who could list
orders a moment ago is refused the moment the entitlement leaves the
subscription. The SAME session, on the very next request, is refused — the
entitlement gate in `can()` reads the fresh subscription, `productOf("erp:…")`
resolves to a product the tenant no longer holds, and the route 403s. And the
converse: add it back and access returns just as fast. This is the whole value
of the slice, verified live.

#### Unknown entitlements are refused, not silently stored

The set is validated against the registry's known product entitlements
(`productRegistry.list().map(p => p.entitlement)`). A typo or an invented key is
refused with `INVALID_INPUT`, because silently storing a key that nothing reads
hides the mistake. `seats.max:10` (from the schema's example comment) is refused
too — it is not a product entitlement the registry knows.

#### SENSITIVE, and not entitlement-gated

`platform:billing:*` is on the SENSITIVE list (no role glob reaches it; OWNER
and ADMIN hold it through `*`, a MANAGER does not decide what the company pays
for). Like the team surface it is NOT entitlement-gated (`productOf("platform:…")`
is null) — a company whose subscription lapsed still manages its own billing,
otherwise a bounced invoice removes the ability to fix the bounced invoice. A
test deletes the subscription row entirely and the read still works, reporting
empty entitlements.

#### The screen

`/console/settings/billing`, gated on `platform:billing:read` (a MEMBER gets
404). Shows the subscription status and a toggle per product; the toggles call
`PUT /api/platform/billing/entitlements` (D-06.1). A reader (read granted, no
write) sees the catalog with no toggles (D-06.2). The settings index links to it
only for someone who can read it.

#### Files
`apps/website-builder/src/lib/platform/billing.ts` (new),
`src/app/api/platform/billing/route.ts` (new),
`src/app/api/platform/billing/entitlements/route.ts` (new),
`src/app/console/settings/billing/page.tsx` (new),
`src/components/console/platform/billing-screen.tsx` (new),
`src/app/console/settings/page.tsx` (the billing section),
`src/lib/console/platform-strings.ts` (`billingStrings`),
`test/platform/billing.test.ts` (new),
`packages/i18n/src/messages/{en,fr,ar}.json` (the `billing` category).

#### Migration
None. `Subscription` and its fields all existed; this slice writes the row every
gate already reads.

#### Risk
**A billing admin can lock the company out of a product.** Dropping
`product.erp` takes effect on the next request, including for the admin
themselves — but `platform:billing:*` is not entitlement-gated, so the billing
screen itself stays reachable and the change is reversible. That is the design:
the ability to turn a product off must not depend on the product being on.

**No payment provider.** This slice changes entitlements by hand. A Stripe
webhook is a second slice that writes the SAME row this one does; nothing here
will need to change when it lands.

**Verified live:** billing 19/19 · team 56/56 · access 63/63 · console-shell
13/13 · i18n 18/18. Build clean (`✓ Compiled successfully`). One intermediate
run tripped the documented Neon `P1001` connection flake; green on re-run.

---

### 7.1c The team screen — Phase 7.1 is complete

[GLM-5.2]
Commit: `1104281`
Authoring model: GLM-5.2
Date: 4 August 2026
Summary: `/console/settings/team` renders the company's people and its outstanding
invitations, with write controls that call the existing `/api/platform/team/*`
routes directly. `test/platform/team.test.ts` goes 47 → **56/56** — nine new
tests for the screen, each asserting D-06.2 (a control is rendered only where
the API would accept it). **Phase 7.1 (team management) is complete.**

#### The screen, and what it cannot let you do

Gated on `platform:team:read` (SENSITIVE — a MANAGER running the call centre
does not see the page at all; 404, not 403). The write surface is gated again on
`platform:team:write`, so a reader (read granted by name, no write) sees the
list with no controls — the same shape as the ERP's carriers page for an agent
who holds no carrier route.

The controls call the routes 7.1a built — invite, revoke, change role, suspend,
reactivate, remove — and add NO write path of their own (D-06.1). Every refusal
the API makes is unreachable from the screen, because the control that would
trip it is not rendered (D-06.2):

- **The owner row has no suspend, remove or role-change control** — `OWNER_IMMUTABLE`.
- **The actor's own row has none of those either** — `SELF_TARGET`.
- **A member above the actor's ceiling has no role-change control** — the
  `grantableRoles` list is empty, because every option would trip
  `ROLE_ABOVE_SELF`. A MANAGER cannot promote an ADMIN; the select that would
  offer it is absent, not merely empty.
- **An accepted invitation has no revoke control** — the membership is the thing
  now (`ALREADY_ACCEPTED`).

These are computed server-side (`isSelf`, `isOwner`, ceiling-filtered
`grantableRoles`) and passed to the client, which holds no permission logic of
its own — the same shape as every write control in the ERP.

#### Two bugs the tests caught before the slice shipped

The first build had the role-change control rendering for a member above the
actor's ceiling, because `grantableRoles` included the member's *current* role
"so the select shows it as selected". That is wrong: a select whose only option
is the no-op is still a control the API refuses for every other choice, and
offering it is offering a promotion. The list is now strictly ceiling-filtered,
and a member above the actor gets an empty list and no control at all.

The second: the revoke button was gated on `invitation.path`, but the list
carries no token (D-07.3) so `path` is undefined for every row and the button
never rendered. Revoke now keys off `state === "open"` alone — which is the
actual rule, since an accepted invitation is the one state that refuses.

#### Files
`apps/website-builder/src/app/console/settings/team/page.tsx` (new),
`apps/website-builder/src/components/console/platform/team-screen.tsx` (new),
`apps/website-builder/src/lib/console/platform-strings.ts` (new — `teamStrings`),
`apps/website-builder/src/app/console/settings/page.tsx` (the team section,
visible only to `platform:team:read`),
`apps/website-builder/test/platform/team.test.ts` (9 new screen tests + helpers),
`packages/i18n/src/messages/{en,fr,ar}.json` (the `team` category, 38 keys).

#### Migration
None. No schema change, no RLS change — the screen reads through the same
`withTenant` binding every other console page uses.

#### Risk
**The role-change control needs JavaScript** (D-06.1's stated cost), and the
screen offers no control the API does not accept — verified by tests that assert
the *absence* of the suspend/remove/role-toggle on the owner row, the self row,
and an above-ceiling member. A reader sees the list with no controls at all.

**Verified live:** team 56/56 · access 63/63 · screens 96/96 · console-shell
13/13 · i18n 18/18 · auth 36/36 · product-registry 36/36 · db 29/29. Build clean
(`✓ Compiled successfully`). Two intermediate runs tripped the documented Neon
`P1001` connection flake (the first run after `builder:start`); both were green
on re-run and are the known limitation, not a regression.

---

### 7.1b Accepting an invitation — the link stops being a 404

[GLM-5.2]
Commit: `5a74372`
Authoring model: GLM-5.2
Date: 4 August 2026
Summary: The invitation link the team API issues (`/console/join/[token]`) now
resolves. `test/platform/team.test.ts` goes 39 → **47/47** — eight new tests for
the acceptance surface, each violating a documented rule. The load-bearing change
is a second RLS policy on `Invitation`, the `Membership` `_self` pattern applied to
a token rather than a user id.

#### The RLS layer — `withInvitationToken` and the token policy

`Invitation` is tenant-scoped, and the join flow resolves a token BEFORE any
tenant is bound — so an unbound `asPlatform().invitation.findUnique({ where: {
token } })` returns zero rows silently, the way RLS always denies. That is the
exact failure the 7.1a measurement verified by a direct `pg_policy` query, and it
is closed the way `Membership`'s circularity is closed for session resolution: a
second, narrower `FOR SELECT` policy (`tenant_isolation_token`, `USING ("token" =
current_setting('app.invitation_token', true))`) plus a `withInvitationToken(token,
work)` binding in `packages/db`. Postgres ORs permissive policies, so binding a
token opens exactly the one row whose token was presented and nothing else.

Verified live before anything was built on it: the binding resolves the one row
for a correct token, returns nothing for a wrong token, and `asPlatform()` still
returns nothing. Safe to add — `preflight`, `apply-rls`'s audit and
`isolation.test.ts` all key off the literal policy name `tenant_isolation`, so a
separately-named `FOR SELECT` policy leaves their counts untouched (confirmed:
db 29/29, preflight 9/9).

#### The acceptance endpoint is an API route, not a server action

A server action was the first shape tried and it failed in a way worth recording:
Next.js server actions are dispatched through a `Next-Action` header the server
embeds in the rendered form, so they are **not HTTP-addressable** and cannot be
contract-tested over `fetch` — a raw POST answers *"Failed to find Server Action"*.
Every other write surface on this platform is an API route with contract tests in
front of it (D-06.1), and acceptance is now the same: `POST /api/platform/
invitations/[token]/accept`, a plain route handler (NOT `tenantRoute` — the
accepter has no session and no active tenant) that calls `acceptInvitation` and
returns the standard envelope. The page renders GET for everyone and its accept
button calls the route via a small client component (`join-form.tsx`).

#### The design question, resolved and enforced

*Must the accepter be signed in as the invited address?* **No** — the 32-byte
token is the claim. Creating a `User` for an invitee who has none is self-serve
signup (7.3), and this slice refuses with `ACCOUNT_REQUIRED` rather than
half-building it. Accepting creates a `Membership` only, matched to an existing
`User` by the invitation's email.

#### Refusals are uniform across the oracle surface

Every non-open token — unknown, expired, revoked, and soft-deleted-tenant —
answers identically, because distinguishing them turns the endpoint into an
oracle for which addresses have been invited. `ALREADY_ACCEPTED`,
`ACCOUNT_REQUIRED` and `ALREADY_MEMBER` are distinct: by the time they apply the
caller holds the token, so answering precisely opens no oracle. A test exercises
all three indistinguishable cases and asserts they render the same message and
no accept control.

| Condition | Status | Code |
|---|---|---|
| unknown / expired / revoked / deleted-tenant | 404 | `INVITATION_NOT_FOUND` |
| already accepted | 409 | `ALREADY_ACCEPTED` |
| invited address has no `User` (7.3 owns creating one) | 409 | `ACCOUNT_REQUIRED` |
| accepter already a member of this tenant | 409 | `ALREADY_MEMBER` |

#### Idempotent by `acceptedAt`, and the membership writes are atomic

Accepting twice yields one membership: the second pass finds the row already
accepted and returns `ALREADY_ACCEPTED`. The membership insert, the
`acceptedAt` write and the audit event all happen inside one `withTenant`
transaction, so a crash between them cannot leave an accepted invitation with no
membership. Acceptance does NOT switch the accepter's active tenant (D-07.4:
landing is the person's operation), which the seeded-consultant test asserts —
the first membership survives and the original session still resolves.

#### Files
`packages/db/scripts/apply-rls.ts` (the `tenant_isolation_token` policy block),
`packages/db/src/tenant-client.ts` (`withInvitationToken` + `INVITATION_SETTING`),
`packages/db/src/index.ts` (export),
`apps/website-builder/src/lib/platform/team.ts` (`previewOrRefuse`,
`acceptInvitation`, `acceptInvitationInner`, `findInvitationByToken`,
`InvitationPreview`),
`apps/website-builder/src/app/api/platform/invitations/[token]/accept/route.ts` (new),
`apps/website-builder/src/app/console/join/[token]/page.tsx` (new),
`apps/website-builder/src/components/console/join-form.tsx` (new),
`apps/website-builder/test/platform/team.test.ts` (8 new tests + helpers),
`packages/i18n/src/messages/{en,fr,ar}.json` (the `join` category).

#### Migration
No Prisma migration. One `FOR SELECT` RLS policy on `Invitation`, applied by
`npm run rls --workspace @landingos/db` (DDL, idempotent). RLS audit unchanged:
47/47 across all four checks; preflight 9/9.

#### Risk
**The acceptance endpoint is reachable by anyone holding a token, signed-out.**
That is the design — the token IS the claim — and it is why the token is 32
random bytes and expires after seven days. A deployment that delivers these
links over an untrusted channel is delivering membership of a company; the
invite route already states `delivery: "none"` for exactly this reason.

**Acceptance does not create accounts.** An invited address with no `User` is
refused with `ACCOUNT_REQUIRED`; the recovery path is the person signing up
(7.3) and then opening the link. Stated in the refusal message, not simulated.

**Verified live:** team 47/47 (twice) · access 63/63 · console-shell 13/13 ·
builder-api 22/22 · builder-sections 45/45 · storefront 22/22 (website-builder
102/102) · i18n 18/18 · auth 36/36 · product-registry 36/36 · db 29/29 ·
preflight 9/9. Build clean (`✓ Compiled successfully`). End-to-end invite →
GET page → POST accept → membership-in-DB driven manually against the running
server at role MANAGER. The storefront run tripped the documented Neon `P1001`
flake in its `after` hook; all 22 of its tests passed.

**Not verified:** nothing is deployed; whether a real browser offers the accept
prompt over HTTPS is untested by construction.

---

### 7.1b (measurement) — the join flow, measured and designed

[GLM-5.2]
Commit: `1aab962` (baseline; no code in this entry — design only)
Authoring model: GLM-5.2
Date: 4 August 2026
Summary: Measured the codebase and the live database for the invitation-acceptance
slice, verified the load-bearing RLS claim from 7.1a, and locked the design. Stopped at
the safe boundary before writing any code. Working tree clean.

**What this entry is, and is not.** It records the measurement and the design decisions
so the next session implements from a locked plan and Opus can audit the reasoning. It
contains **no code change** — the working tree at `1aab962` is unchanged by this entry.
The implementation entry will follow under the same `7.1b` heading when the code lands.

#### The decisive measurement (run against the live Neon database)

`Invitation` has exactly one RLS policy:

```
policy: tenant_isolation
using:    ("tenantId" = current_setting('app.tenant_id', true))
with_check: ("tenantId" = current_setting('app.tenant_id', true))
cmd: *   (FOR ALL)
rls_enabled: true, rls_forced: true
```

There is **no token-based policy**. Therefore an unbound
`asPlatform().invitation.findUnique({ where: { token } })` — which the join flow would
naively write — returns **zero rows, silently**, the way RLS always denies. This is the
exact failure the 7.1a changelog warned about ("`asPlatform()` does not bypass RLS"),
now confirmed by query rather than by inference.

#### The fix is the `Membership` `_self` pattern, applied to `Invitation`

A second, narrower `FOR SELECT` policy keyed on the token, plus a `withInvitationToken`
binding in `packages/db`. Postgres ORs permissive policies, so binding
`app.invitation_token` opens exactly the one row whose token was presented and nothing
else — the same property `withUser` gives `Membership`. Verified safe to add: `preflight`,
`apply-rls`'s audit, and `isolation.test.ts` all key off the literal name
`tenant_isolation`, so a separately-named `tenant_isolation_token` policy leaves their
counts untouched.

#### The one real design question, resolved

*Must the accepter be signed in as the invited address?* **No.** The 32-byte token is
the claim; the invitation carries a role, not an identity (7.1a's own reasoning).
Requiring a matching session would force creating a `User` for an invitee who has none —
that is 7.3 self-serve signup, and half-building it here is forbidden by the slice's own
rules. So the join flow trusts the token, attaches the membership to an existing `User`
matched by email, and refuses with a stated `ACCOUNT_REQUIRED` code when no such user
exists rather than silently creating one.

#### Refusals are identical across the oracle surface

Expired, revoked, soft-deleted-tenant and unknown tokens all answer **404
`INVITATION_NOT_FOUND`** — distinguishing them would let an attacker probe which
addresses have been invited. `ALREADY_ACCEPTED`, `ACCOUNT_REQUIRED` and `ALREADY_MEMBER`
are different because the caller has already proved they hold the token, so answering
precisely opens no oracle. Full vocabulary and the predicted file list are in
NEXT_STEPS §7.1b.

#### Files
None modified. Measurement only, against:
`packages/db/scripts/apply-rls.ts`, `packages/db/src/tenant-client.ts`,
`packages/db/src/index.ts`, `packages/db/prisma/schema/platform.prisma`,
`packages/auth/src/{rbac,session,password,index}.ts`,
`apps/website-builder/src/lib/api/route.ts`, `src/lib/console/session.ts`,
`src/lib/platform/team.ts`, `src/app/api/platform/team/**`,
`src/app/console/{layout,page,login/page,actions}.tsx`,
`apps/website-builder/test/platform/team.test.ts`, `apps/website-builder/test/erp/helpers.ts`,
plus a direct `pg_policy` query against the live database.

#### Migration
None in this entry. The implementation will add one `FOR SELECT` policy on `Invitation`
via `npm run rls` (DDL, not a Prisma migration).

#### Risk
None introduced — no code changed. The risk the implementation must hold against is
recorded above: the refusal vocabulary must stay uniform across the oracle surface, and
the route must not use `tenantRoute`.

**Verified:** live `pg_policy` query on `Invitation`; clean working tree at `1aab962`.
**Not verified:** anything requiring the implementation (none exists yet).

---

### 7.1a The platform learns to have a team

`test/platform/team.test.ts` — a new suite, **39/39**. The first slice of Phase 7,
and the one the platform had already promised: `POST /api/erp/agents` has answered
501 with *"team members are invited from company settings, not from a product"*
since Phase 5.3, and until now that sentence named a surface that did not exist.
Every agent in the system was created by `seed:dev` or by a test fixture — the
ERP's agents screen could set somebody's pay rate and could not add them.

Six routes under `/api/platform/team/*`: list and issue invitations, revoke one,
list members, change a role, suspend, reactivate, remove.

#### The permission is SENSITIVE, and that is the whole shape of the feature

`platform:team:*` was already on the SENSITIVE list in `packages/auth` before this
slice, which means no role glob reaches it: OWNER and ADMIN hold it through a bare
`*` and everybody else needs it granted by name. Three tests assert the negative
space — a MEMBER cannot read the team even though `*:*:read` would otherwise
grant it, and neither can a MANAGER, because running a call centre day to day is
not the same job as deciding who works there.

It is also **not entitlement-gated**, because `productOf("platform:…")` is null. A
tenant whose subscription lapsed still manages its own people, and there is a test
for it: losing the team screen when the invoice bounces is how a company loses the
ability to remove whoever stopped paying.

#### Four decisions, each of which is a rule with a test that violates it

- **D-07.1 — OWNER is not a role this API hands out.** `Tenant` has exactly one
  owner and the schema says so in a comment rather than a constraint, so an
  assignable OWNER would silently produce two — both holding `*`, neither
  removable, no way back without a database edit. Excluding the value from the
  vocabulary means the invariant is held by what can be said rather than by a
  count query that races itself. Ownership transfer is a separate, deliberate
  operation and is not this.
- **D-07.2 — suspending somebody does NOT destroy their sessions**, and that is
  the design. `resolveSession` re-reads the membership on every request and copies
  `suspended` into the `AuthContext`, so the flag alone takes effect on the
  caller's very next call — which is precisely the property M-09 bought by paying
  a database read per request. `destroySessionsForUser` exists and would be the
  *wrong* tool: it is keyed on the user, not the membership, and one person
  belongs to many companies. A consultant suspended by one client would be signed
  out of the other, on a screen that never mentioned them. Two tests: the same
  token that worked a moment ago is refused and then comes back, and a suspension
  in one company leaves the same person's session in another untouched.
- **D-07.3 — an invitation token is returned once, by the call that creates it.**
  `listInvitations` carries state and never the secret, the way `createSession`
  hands back a raw token once and stores only its hash. There is no mail transport,
  so the link IS the delivery mechanism, and a list endpoint that hands it back
  turns *"who have we invited?"* — a question a team screen asks on every page
  load — into a live credential in a response body, a log and a browser cache. The
  recovery path for a mislaid link is revoke, then invite again, which produces a
  new token; that is the correct outcome, because a link that has been mislaid is
  a link that may have been seen.
- **D-07.4 — nobody acts on their own membership here.** It reads as three
  separate foot-guns — promoting yourself, suspending yourself, removing yourself
  — and is one rule: a team screen administers *other* people. Leaving a company
  is a real operation and a different one; it belongs to the person, with its own
  confirmation, not to a row in a list of colleagues.

And the rule that needed no decision, only enforcing: **the owner cannot be
demoted, suspended or removed by anybody, themselves included.** Four tests, one
per door, plus one that reads the list afterwards and finds them unchanged. The
ERP's "last manager" protection was this same rule one generation earlier, and it
existed because that system had been locked out of a tenant by exactly this.

There is deliberately **no "last administrator" check**, because there does not
need to be one: the owner is unremovable, so a tenant always has at least one
person holding `*`.

#### Refusals are codes, not statuses

Every guard returns `{ status, code, message }` and every test asserts the code.
A test that only checked for 403 would pass against a route that refused for the
wrong reason — which is how a permission gate quietly becomes the only thing
standing between an ADMIN and the owner's account. `ROLE_ABOVE_SELF` is the one
that matters most: without it, `platform:team:write` granted by name to a MANAGER
— which is the entire point of a SENSITIVE permission being grantable — would be
a route to ADMIN, by promotion or by invitation, and both doors are tested.

#### What this slice does NOT do, stated plainly

**An invitation cannot yet be accepted.** `GET/POST /console/join/[token]` is
7.1b and there is no screen. The invite route returns the link and reports
`delivery: "none"` — stated, not simulated, the same stance the AI surface takes
with its 501 — but following that link today is a 404.

And a finding that shapes 7.1b, recorded before it is forgotten: **`asPlatform()`
does not bypass RLS.** `Invitation` is tenant-scoped, and the join flow resolves a
token *before* any tenant is bound, so an unbound read returns zero rows —
silently, the way RLS always denies. The fix is the one `Membership` already
demonstrates: a second, narrower policy (`USING token = current_setting(...)`)
plus a `withInvitationToken` binding in `packages/db`, which opens exactly the one
row whose token was presented and nothing else.

#### Files
`apps/website-builder/src/lib/platform/team.ts` (new),
`src/app/api/platform/team/invitations/{route.ts,[id]/revoke/route.ts}` (new),
`src/app/api/platform/team/members/{route.ts,[userId]/route.ts,[userId]/suspend/route.ts,[userId]/reactivate/route.ts}` (new),
`test/platform/team.test.ts` (new).

Purely additive — no existing file was modified.

#### Migration
None. `Invitation`, `Membership`, `TenantRole` and `platform:team:*` all existed
already; this slice is the routes over them.

#### Risk
**There is no mail transport, and the address is not verified.** Whoever follows
the link is whoever received it; the invitation carries a role, not an identity.
That is why the token is 32 random bytes and why it expires after seven days. A
deployment that hands these links out over an untrusted channel is handing out
membership of a company.

**Verified live:** platform/team 39/39 (twice, on the exact committed source) ·
access 63/63 · website-builder 102/102. One run of the non-ERP suites tripped the
documented Neon `P1001` connection-limit flake — three of them in the server log —
and was green on re-run; see *Known bugs and limitations* in PROJECT_STATE.

---

## Phase 6 — The ERP interface

### 6.6f Stock moves again — and the reassessment of `apps/erp`

`catalog.test.ts` goes 31 → **40/40**. This closes the last functional
difference between the platform and `apps/erp`, and it was found by building
6.6a's shared confirm path rather than by any test.

#### The gap: `applyMovement` had one caller

`lib/erp/inventory.ts` has the whole FIFO machinery — `planConsumption`,
`planRestore`, lot draws, `MovementLotConsumption` — and Phase 5 ported all of
it. What it never ported was the two functions that CALL it on a status change.
So a confirmed order consumed no stock, a cancellation restored none, and
`reservationMode` sat on the automation screen since 6.3d being read by nothing.

Invisible to a contract test for the usual reason: `catalog.test.ts` attacks the
adjust endpoint and passes, and nothing asserted that *confirming an order* moves
stock — because until Phase 6.3 nothing on the platform could confirm one.

#### It moves once, and the guard is the ledger

A double-submitted button, a status set twice, `PATCH` and `/call` racing: a
`confirm` movement already recorded against this order means this has run. Same
shape as every job in `jobs.ts` — idempotent by what is already written, not by a
lock. A test confirms, un-confirms and re-confirms, and asserts one movement.

#### Cancelling returns stock to the lots it came from

Not to the newest lot and not to the cheapest. `planRestore` reads
`MovementLotConsumption` back, and anything else silently rewrites the cost basis
on every cancellation and the profit calculator stops being true with no error
anywhere. The test buys 3 at 1,000 and 5 at 2,000, confirms an order for 4,
cancels it, and asserts **both lots** are whole again — reading the exhausted
list as well as the active one, because a lot the reservation emptied moves
between them and looking only at `active` would pass while the cheap lot stayed
at zero.

#### The name is matched leniently, and a mismatch is loud

An order stores the product NAME — it arrives from a storefront, a webhook or a
keyboard, none of which knows the catalogue's key. A trademark symbol, a
non-breaking space or different casing must not silently stop stock moving, so
the match is on a normalised form, and a name matching nothing is **logged** and
does not fail the confirmation: the agent rang a customer and that has to be
recorded whether or not the catalogue has a row.

#### Two housekeeping jobs that existed and had no caller

Both found while re-measuring `apps/erp`'s in-process timers against the
platform, and both the same shape as the tick bug in 6.6b — a function that was
written, was correct, and was never called:

- **`pruneNotifications`** — written in 6.6c, called by nothing. The ERP pruned
  hourly, and 6.6c writes ONE ROW PER RECIPIENT, so an unbounded table matters
  more here than it did there. Now runs per tenant on every tick, before the
  entitlement check, because notifications are a platform service.
- **`purgeExpiredSessions`** — in `packages/auth` since M-09 **with no caller at
  all**. Runs once per tick, unscoped, because `Session` is one of the five
  tables with no RLS.

#### The reassessment

Every behaviour `apps/erp` has is now on the platform. The full table is in
PROJECT_STATE; the short version is that the four items this phase set out to
close — auto-assignment, carrier polling, notifications, installability — are
closed, and re-measuring turned up three more that were closed with them (stock
on confirm/cancel, notification retention, session purge).

What retiring it does **not** fix, and never would have: the platform still has
no cross-origin state-change refusal and no rate limiting. Those left the product
suite in 5.1 and were never on the platform, so keeping `apps/erp` does not give
them to it. They are Phase 8 work either way.

#### Files
`apps/website-builder/src/lib/erp/{inventory,confirm}.ts`,
`src/app/api/erp/orders/{route,[id]/route,[id]/call/route}.ts`,
`src/app/api/jobs/tick/route.ts`, `test/erp/catalog.test.ts`.

#### Migration
None.

#### Risk
**Stock will start moving on the next deploy.** Every order confirmed since the
platform took over has consumed nothing, so current stock figures are higher than
reality by whatever has been confirmed and not manually adjusted. `reservationMode`
defaults to `on_confirm`, so this is on by default — a deployment that wants a
stock count first should set it to `none`, reconcile, and switch it back.

There is no backfill, deliberately. Replaying every past confirmation through the
FIFO machinery would invent lot consumptions at today's cost basis for sales that
happened at last quarter's, which is worse than a one-time manual count.

**Verified live:** catalog 40/40 · notifications 33/33 · jobs 16/16 ·
orders 38/38 · assign 25/25 · delivery 33/33 · access 63/63 · validation 29/29 ·
listing 25/25 · integrations 29/29 · order-split 8/8 · screens 96/96 —
**435/435**. website-builder 102/102 · db 29/29 · auth 36/36 ·
product-registry 36/36 · ui 26/26 · i18n 18/18.

---

### 6.6e The console installs to a home screen — and can receive a push

`notifications.test.ts` goes 29 → **33/33**. The last of the four items
PROJECT_STATE listed as differences between the platform and `apps/erp`.

#### The service worker caches NOTHING, and that is the design

A service worker's usual job is an offline shell. This one deliberately has none
and does not intercept `fetch` at all, because **every page under `/console` is
server-rendered from a session-scoped database read**. A cache entry keyed by URL
is keyed by nothing else: the same `/console/erp/orders` is a different page for
a manager and for an agent, and different again for the next person to pick up a
shared handset in a call centre. Serving a cached copy would hand one tenant's
customer list to another person — through a mechanism that **survives signing
out**, because a cache is not a session.

Three more things a stale shell would break, all real here: a suspended member
must lose access on their very next request (M-09), an order's status is money,
and row-level security cannot enforce anything against a response the browser
never asks for.

A test asserts the absence — no `caches.open`, no `caches.match`, no `fetch`
listener — and names the file's header, so somebody adding an offline shell later
has to read the reasoning before the suite goes green again.

What the worker is FOR is the two things needing no cache: **installability**,
and **receiving a push**. Without it 6.6d's `pushToUsers` sends into nothing.

#### The manifest is on the console, not on the root

The root layout also serves the public storefront. Offering "install LandingOS
Console" to somebody's shopper is the wrong offer, and it would put the
platform's own name and icon on a page a tenant thinks of as their shop. Asserted
both ways.

#### Icons that actually exist, and are actually the size they claim

A manifest naming an icon that 404s fails installation with no message anybody
sees, and Chrome needs a 192 **and** a 512 **and** a maskable one or the prompt
silently never appears. The test fetches every icon the manifest names, checks
the PNG signature, and reads the width and height out of the IHDR to confirm they
match what the manifest declares.

The three PNGs are generated by a forty-line encoder rather than by adding an
image library to draw two squares — signature, IHDR, deflated RGBA scanlines,
IEND.

#### Files
`apps/website-builder/public/{manifest.webmanifest,sw.js}` (new),
`public/icons/{icon-192,icon-512,maskable-512}.png` (new),
`src/components/console/service-worker.tsx` (new),
`src/app/console/layout.tsx`, `test/erp/notifications.test.ts`.

#### Migration
None.

#### Risk
**Installability cannot be fully verified from a test suite.** These assertions
cover everything a machine can check — the manifest is served and complete, every
icon exists at its declared size, the worker registers and handles `push` and
`notificationclick`, and it caches nothing. Whether a given browser then OFFERS
the install prompt also depends on HTTPS and on engagement heuristics, and needs
a real device. Nothing is deployed yet, so that is untested by construction and
recorded rather than claimed.

**Web Push is end-to-end now but has never been exercised against a real push
service**, because that needs VAPID keys and a deployed origin. The send path,
the subscription store, the worker's `push` handler and the click handler are
each covered; the hop between them is a real network no test here can make.

**Verified live:** notifications 33/33 · screens 96/96 · access 63/63 ·
orders 38/38 · jobs 16/16 · assign 25/25 · delivery 33/33 · integrations 29/29 ·
validation 29/29 · listing 25/25 · catalog 31/31 · order-split 8/8 —
**426/426**. website-builder 102/102.

---

### 6.6d M-16 (part 2) — the live transport, and a phone that rings

`notifications.test.ts` goes 18 → **29/29**. M-16 is complete: storage,
audience, badge, producers, a live stream with replay, and Web Push.

#### The stream polls the database, and does not hold a transaction

Two decisions, and both are about not repeating something that works on exactly
one machine.

**It does not use `tenantRoute`.** That wrapper runs its handler inside
`withTenant`, which is an INTERACTIVE TRANSACTION — it pins a database
connection for as long as the handler runs, and an SSE handler runs for as long
as the tab is open. Ten agents with the console open would hold ten connections
all day against a pool sized for millisecond requests, and the symptom would be
"Can't reach database server" everywhere else in the product. The session is
resolved by hand here and each poll opens its own short binding.

**It polls the table rather than fanning out in process.** The ERP kept
`channel -> Set<writer>` in module memory, and its own changelog says what that
costs: correct on one instance, and "the fix at that point is Redis". This
platform is explicitly built for more than one instance — that is the whole
argument of M-15 — and an in-process fan-out would deliver a notification only to
the agents connected to the instance that served the write. Everybody else simply
never hears, exactly as if the event had not happened.

Polling is correct on one instance and on ten, needs no new infrastructure, and
makes replay **exact** rather than best-effort: "everything after id N" is a
query, not a buffer that may have been evicted. The cost is one indexed query per
connected client per interval (`NOTIFICATION_POLL_MS`, default 5s), and the
honest upgrade path is Postgres `LISTEN`/`NOTIFY` when that stops being cheap.
Recorded in NEXT_STEPS.

#### Replay, and ARCH-01

An SSE connection drops constantly in normal use — a phone locking, a tunnel
timing out, a redeploy — and `EventSource` reconnects silently with
`Last-Event-ID`. A test disconnects, raises a notification, reconnects from the
last id it saw and asserts the missed one arrives **flagged as a replay** so a
client can de-duplicate.

ARCH-01 is asserted too: two tabs both receive, and closing one does not kill the
other. The ERP held one writer per name, so a second tab evicted the first and
the close handler removed the shared entry regardless of which connection had
closed — closing either tab killed live updates for both. Here there is no shared
entry to evict: each connection is its own cursor over the same table.

#### Web Push

`web-push` (3.6.7), the dependency the ERP already had. Stored first, pushed
after: the feed is the record and the push is a doorbell, so a push that fails
changes nothing about what the console shows and a deployment with no VAPID keys
is fully functional — it simply does not ring anybody's phone.
`GET /api/platform/push` returns `null` for the key in that case, so a console
can say "push is unavailable" rather than failing inside `subscribe()` with a
browser error nobody can read.

**A subscription is stored against the CALLER.** The ERP's endpoint took
`{ agent, subscription }` from the request body, so anybody could register a
device to receive another person's notifications. A test posts a colleague's user
id alongside a subscription and asserts the row belongs to the caller.

A subscription the push service reports as 404 or 410 is deleted — the app was
uninstalled, the profile was wiped — and any other error is logged with the row
kept, because a push service having a bad five minutes is not a reason to
unsubscribe a working device.

**VAPID keys must be stable across deploys.** Generating a pair at boot reads as
convenient and invalidates every stored subscription on every restart, silently:
the browser keeps its subscription, the push service rejects the request, and
nobody's phone rings again. They are configuration —
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

#### Files
`apps/website-builder/src/app/api/platform/notifications/stream/route.ts` (new),
`src/app/api/platform/push/route.ts` (new),
`src/lib/platform/push.ts` (new), `src/lib/platform/notifications.ts`,
`test/erp/notifications.test.ts`, `apps/website-builder/package.json`.

#### Migration
M-16, part 2. No schema change — `PushSubscription` has existed since 3.2.

#### Risk
**Nothing receives a push yet.** The subscription is stored and the send is
implemented, but a browser only gets one through a **service worker**, and the
console has none — that is 6.6e, and until it lands Web Push is a registered
device nobody rings. The SSE stream is live and needs no service worker.

The stream's cost model is a poll per client. At a few dozen agents that is
tens of short queries a minute and unremarkable; at a few thousand it is the
thing to change first.

**Verified live:** notifications 29/29.

---

### 6.6c M-16 (part 1) — notifications become a platform service

`notifications.test.ts` is new at **18/18**, and it is the file
`apps/erp/test/notifications.test.js` was deferred against in Phase 5.1:
PORTING.md said porting it "against a transport that does not exist would encode
a contract nobody has designed". This is the design of the storage half. The live
transport is 6.6d.

#### A platform service, under `/api/platform`

`Notification` moved to `platform.prisma` in 3.2 because the vision names
notifications a shared service; this is the other half of that decision. One feed
per person spanning every product they use, one badge, and a `product` column so
a tenth product raises into it by calling `notify` rather than by building its
own. A product shipping its own feed would be N badges for one person — the same
mistake `packages/product-registry` refuses for a Settings nav item.

#### The audience is decided ONCE, at write time — one row per recipient

The ERP stored one row with a free-text `target` (`''` | `'manager'` | an agent's
name) and interpreted it on every read. **Every notification bug the audit found
lived in that interpretation.** `target` was accepted by `push()` and had no
column to land in, so the live hop was targeted and the stored row was not; and
`agent_overdue`, `agent_suspended`, `stale_orders`, `followup_overdue` and
`suspicious_call` were all stored with `target: null` — "everyone" — so an alert
about an agent's own missed order was stored for that agent to read.

Fanning out on write removes the class. A read is `targetUserId = me`: one
indexed predicate, no role logic, nothing to get wrong later. It is also what the
schema already expected — `@@index([tenantId, targetUserId, readAt])` is an index
for exactly this query, and `readAt` on the row is only meaningful when the row
belongs to one person.

The cost is rows, bounded by `pruneNotifications`. That is the right trade
against a read-time audience rule that has already leaked once.

#### An audience is a PERMISSION, never a role list

"Managers only" is not something the platform can evaluate: MANAGER, ADMIN and
OWNER all supervise, and a MEMBER with an explicit grant may too. So a producer
names the permission a recipient must hold and `can()` decides — the same
function the routes use. Two are used, and both are already `SENSITIVE`:

- `erp:agents:manage` — supervision **of people**: misconduct, accountability,
  suspensions. No role grants it implicitly, so it cannot reach an agent by
  accident.
- `erp:clients:read` — sees the **whole book**. Already the predicate
  `seesWholeBook` uses, so "supervisors of the work" means the same set here as
  everywhere else in the product.

Entitlement rides along inside `can`, so a tenant that dropped the ERP stops
receiving the ERP's alerts without anybody editing a membership.

#### There is no watermark to poison

The ERP's read state was a stored number per account, and an unclamped
`{"upToId": 999999999}` parked it in the future — suppressing that account's
badge until a million notifications had been raised. Marking read here is an
`updateMany` over rows that exist, so an id beyond the newest matches what exists
and nothing more, and the next notification is unread like any other. The test
asserts the **property** that clamping protected rather than the mechanism that
has gone, and junk (`-5`, `"abc"`, `null`, `{}`, `[]`, `true`) is a no-op that
leaves the account working.

#### The stale-order alert, and the end of the `alertMinutes` confusion

6.5b's sweep read `alertMinutes`; 6.6a moved it to `reassignMinutes` and said
`alertMinutes` belonged to a different ERP job. This is that job — the second of
the three loops in `apps/erp/lib/jobs.js` — and it closes the loop honestly.

The two are not redundant. The **sweep** is accountability: it counts a miss
against a named agent and can move the order. **Stale-orders** is a number on a
supervisor's screen — how much work is untouched right now, whoever it belongs to
and whether or not anybody is at fault. Different threshold, different audience,
different question. It is deliberately **not** idempotent by column guard,
because it writes no state to the orders and reports a live count; an "N are
waiting" signal that stops after the first pass is not a signal.

#### Every producer the ERP had

`new_order` on all three creation paths (typed in, storefront checkout, channel
webhook), `suspicious_call`, `delivery_update`, `followup_raised`,
`followup_overdue`, `stale_orders`, `agent_overdue`, `agent_suspended`.

One narrowed on purpose: an **unassigned** new order goes to everybody holding
`erp:orders:write` rather than to everybody in the company. The ERP broadcast to
all; a bookkeeper being told about each incoming order is noise, and noise is
what makes a feed stop being read.

Nothing raised here can fail the thing it is about — `notifyQuietly` logs and
returns. A confirmed call is not undone because nobody could be told about it.

#### Files
`apps/website-builder/src/lib/platform/notifications.ts` (new),
`src/lib/erp/notify.ts` (new),
`src/app/api/platform/notifications/{route,read/route}.ts` (new),
`src/lib/erp/{jobs,shipments,from-sale,webhooks}.ts`,
`src/app/api/erp/orders/route.ts`, `orders/[id]/call/route.ts`,
`test/erp/{notifications,jobs,helpers}.test.ts`.

#### Migration
M-16, part 1. **No schema change** — `Notification` has carried `product`,
`targetUserId`, `targetRole`, `readAt` and its index since 3.2.

#### Risk
**The live transport does not exist yet.** The feed is correct, per-account and
gated, and a console that wants it must poll. SSE with replay on reconnect, and
Web Push, are 6.6d — until then this is M-16's storage half and `apps/erp` is
still the only place an agent is *told* rather than having to look.

`stale-orders` repeats its alert on every pass while orders are waiting. That is
what the signal means, and `WORKER_INTERVAL_MS` governs how often; a deployment
that finds it noisy raises the interval or `alertMinutes` rather than adding
state nobody can see.

**Verified live:** notifications 18/18 · jobs 16/16 · delivery 33/33 ·
orders 38/38 · assign 25/25 · access 63/63 · validation 29/29 · listing 25/25 ·
catalog 31/31 · integrations 29/29 · order-split 8/8 · screens 96/96 —
**411/411**. website-builder 102/102.

---

### 6.6b The carrier poll — and the worker that had never run a job

The third of the ERP's three scheduled loops (`apps/erp/lib/jobs.js:28`), and the
last one with no platform equivalent. `delivery.test.ts` goes 26 → **33/33** and
`jobs.test.ts` 14 → **16/16**.

#### The important part of this slice is not the poll

**`services/worker` had never run a single job, and could not.** It was found by
running it — not by a test, because no test could see it:

```
[worker] 0 jobs over 0 tenants (300ms)
```

6.5b's tick selected each tenant's `subscription` as a nested relation on an
`asPlatform()` query. `Subscription` is one of the 47 RLS-scoped tables, and
`asPlatform()` is deliberately unbound — so every tenant came back with
`subscription: null`, the entitlement filter dropped all of them, and the
endpoint answered `{ tenants: 0 }`. The worker logged that as a quiet system and
carried on.

This is the failure PROJECT_STATE warns about in its **first paragraph**: *RLS
denies by returning zero rows, not by erroring.* Verified directly rather than
inferred — the same tenant read through `asPlatform()` gives `subscription:
null` and through `withTenant` gives
`{status: "ACTIVE", entitlements: [...]}`.

The entitlement is now read inside the binding, through **`hasProduct`** — the
same predicate the storefront checkout uses to decide whether to create a
fulfilment record, which `order-split.test.ts` already proves both ways. One
rule, two callers. `hasErp` is a one-line wrapper over it.

After the fix, against the running server:

```
[worker] 21 jobs over 7 tenants (8953ms)
```

#### Why no test caught it, and what now does

`jobs.test.ts` could only ever assert the **refusal**, because the dev server had
no `WORKER_SECRET` and the tick fails closed. The authorised half — every line
that actually does anything — had never been executed by anything.

`WORKER_SECRET` is now set in `apps/website-builder/.env` (gitignored, and the
test process and the server read the same file), and **`ERP_CONTRACT=strict`
refuses to run without it**, the same way it refuses to run against an unmounted
`/api/erp/*`. A contract suite that is allowed to stay silent about half an
endpoint is a contract suite that will be silent about the important half.

Two new tests: the tick with the right bearer actually escalates a staged task
and reports `ran === tenants × jobs`; and a tenant whose subscription has been
cancelled is skipped, so a company that stopped paying stops having its agents
chased and its carriers polled at our expense. The negative cases keep their
404s, and gained one — a bearer that is the real secret minus its last character,
which is what a timing probe looks like.

#### The poll itself

`pollCarriers` asks each carrier where its non-terminal parcels are. It exists
because in this market most carriers have no webhook at all: until now a parcel
sat at "created" until a person opened the order and pressed *ask the carrier*.

**It goes through `refreshShipment`, which is the point.** That feeds
`ingestEvents` — the one choke point where events are stored idempotently, the
delivery outcome is settled (BUG-02) and follow-up tasks are raised (6.5a). A
poll that fetched and wrote events itself would be a second ingest path, and the
half nobody tested would be the half deciding whether anybody rings a customer
whose parcel came back. A test drives a parcel all the way to `delivered`
through the job alone and asserts the outcome settles.

**`lastPolledAt` is the guard and the interval marker**, matched in the same
`updateMany` that writes it — so two workers, or a worker and a manager pressing
"run it now", cannot both call the carrier about one parcel. It is written
whether or not there was news, which is why it cannot be `updatedAt`: a poll that
found nothing must still count as a poll, or every quiet parcel is re-asked on
every tick. A settled parcel is never polled again — asserted, because otherwise
it is one request per delivered parcel per interval for the life of the company.

The batch is **25**, not the sweep's 200: each of these is a network round trip
to somebody else's server and it happens inside the transaction `withTenant`
opened, whose timeout is 15s. That the carrier call is inside a database
transaction at all is a real limitation of the current shape and is recorded in
NEXT_STEPS.

#### Files
`packages/db/prisma/schema/erp.prisma` (`Shipment.lastPolledAt` + its index),
`apps/website-builder/src/lib/erp/jobs.ts`, `src/lib/erp/from-sale.ts`,
`src/app/api/jobs/tick/route.ts`,
`test/erp/{delivery,jobs,helpers}.test.ts`, `apps/website-builder/.env`.

#### Migration
Additive: one nullable `TIMESTAMP(3)` column and one index. DDL rendered against
the live database and read before applying:

```sql
ALTER TABLE "Shipment" ADD COLUMN "lastPolledAt" TIMESTAMP(3);
CREATE INDEX "Shipment_tenantId_lastPolledAt_idx" ON "Shipment"("tenantId", "lastPolledAt");
```

No backfill: null means "never polled", which is what every existing row means
and what every new one starts as. RLS re-applied — 47 tables, 9 preflight checks
pass.

#### Risk
**A deployment must set `WORKER_SECRET` on both the platform and the worker, and
they must match.** They already had to; the difference is that the tick now does
something when they do. A deployment that has been running the worker since 6.5b
has been running nothing, and will start doing real work — including polling
carriers — the moment this ships.

The carrier call inside the tenant transaction is the shape to change next if a
real adapter is slow: the batch size is the mitigation, not the fix.

**Verified live:** delivery 33/33 · jobs 16/16 · access 63/63 · orders 38/38 ·
validation 29/29 · listing 25/25 · catalog 31/31 · integrations 29/29 ·
order-split 8/8 · screens 96/96 · assign 25/25 — **393/393**. website-builder
102/102 · db 29/29 · auth 36/36 · product-registry 36/36 · ui 26/26 · i18n 18/18.
And the worker itself, end to end: 21 jobs over 7 tenants.

---

### 6.6a Auto-assignment — who work lands on, and when it moves

The first of the four behaviours PROJECT_STATE listed as accepted differences
rather than blockers. `assign.test.ts` is new at **25/25**, and it covers all
three ERP behaviours at once because they share one rule: `autoAssign()` on a new
order, `assignFollowup()` on a confirmed one, and the reassignment branch of the
overdue sweep. Three copies of an eligibility rule is three places for somebody
to stay assignable after they have been suspended.

**Verified to bite.** The 25 tests were run against the pre-change build first:
**11 failed**. The 14 that passed are the ones asserting an *absence* — a
suspended agent receiving nothing, a manager's choice not being overruled — which
were trivially true when nothing was assigned at all, and which exist to stop the
new behaviour over-reaching.

#### D-06.5 — automatic assignment requires an explicit job role

The ERP treated a missing role as "confirmation agent"
(`a.role === 'confirmation' || a.role === 'both' || !a.role`). That was safe
there: every row in its `agents` table WAS a call-centre agent, because the table
existed for nothing else. `Membership` is not that table. It is **everybody in
the company** — the bookkeeper, the person who only uses the website builder, the
owner who signed up — and `jobRole` is null for all of them, so carrying the
fallback across would hand a customer's order to somebody who has never opened
the product.

The safe direction is the opposite of the usual one here. An agent who is not
offered work notices within a shift and asks; a customer whose order is sitting
with the accountant is a customer nobody rings.

#### D-06.6 — and the permission the route would check

A job role says what somebody does. It does not say whether the API will let
them. Eligibility therefore asks `can(..., "erp:orders:write")` — the same
function and the same permission `POST /orders/[id]/call` checks — because
assigning an order to somebody that route answers 403 for produces work nobody
can do and, once the sweep is running, a missed-order counter climbing against a
person who was never able to act.

This is D-06.2 turned around: *render a control only where the API would accept
it* becomes *never hand out work the API would refuse*. Entitlement rides along
inside `can`, so a lapsed ERP subscription has no eligible agents and assigns
nothing — the rule that already closes the routes, rather than a second one.

#### D-06.7 — the reassignment clock, and the runaway it prevents

The ERP cleared `overdueFlaggedAt` when it moved an order, while still computing
the deadline from `createdAt`, which never moves. So the very next tick found the
same order overdue, counted a miss against an agent who had held it for sixty
seconds, and moved it on again. **One ignored order would walk the whole roster
in minutes and, with `autoSuspend` on, lock everybody out.** BUG-01 meant that
code never executed in production, so nobody ever saw it.

`overdueFlaggedAt` is now both the guard and the clock: for an order that has
never been flagged the guard is `null`, and once one has changed hands the column
is the moment it did, with the next deadline measured from there. Re-arming
applies **only when `autoReassign` is on** — with it off the ERP flagged an order
exactly once, ever, and that is preserved, because nothing changed hands and
counting a second miss would punish one person twice for one failure.

Both halves are asserted: the order does not move twice inside one threshold and
one ignored order yields exactly one miss; and once the threshold passes again,
the new holder is accountable too.

#### A setting that would have done nothing

6.5b's sweep read `alertMinutes`. That is a **different ERP job** — the hourly
"N orders nobody has called" manager alert (`apps/erp/lib/jobs.js:61`), which is
also what the queue screen's overdue badge uses. The sweep's own threshold is
`reassignMinutes`, and the two had been conflated, so the number a manager
changes on the automation screen to control reassignment did nothing at all.

That is BUG-03's exact shape, and shipping auto-reassign on top of it would have
made it permanent and invisible. The sweep now reads `reassignMinutes`, and a
test pins the two settings *apart* — a short `alertMinutes` and a long
`reassignMinutes` — so it fails if the wrong one is read. `Number(...) || 5`
keeps the ERP's quirk that a stored 0 means five minutes: "flag everything
instantly" is not what a manager means by typing 0.

#### One confirm path, because there are two doors

An order reaches `confirmed` either by an agent logging a call or by somebody
setting the status directly, and the platform had re-introduced the exact
divergence the ERP warns about in a comment at `index.js:1685` — `/call` booked
the parcel and `PATCH` did not. Both now call `onOrderConfirmed`, which books and
assigns in one place. Asserted by confirming through `PATCH` and checking the
follow-up agent arrives.

Each step is caught and **logged** rather than swallowed: the agent has just rung
a customer and that has to be recorded whatever the carrier's API is doing, but
BUG-01 was a job whose only symptom was silence, and a bare `catch` is the same
defect waiting.

#### Every door, not just the front one

The ERP called `resolveAgent('')` on nine separate paths. Assignment is therefore
wired into all three creation paths here — the manual route, the storefront
bridge (M-05) and the inbound channel webhooks — because an order that arrives
assigned through one door and unassigned through another is a queue that owns
half its work depending on where the customer bought. On the storefront and
webhook paths a failure is caught and the order created unassigned: a roster
problem must never fail a customer's purchase, and a webhook that answers non-2xx
gets its endpoint disabled by the platform sending it.

#### Two things the ERP's own comment asked for and its code did not do

`workloadByAgent` was documented as "current **open** follow-up workload" and
counted every order the agent had ever been given, so balance was by lifetime
total and a newcomer received everything until they caught up. This counts orders
whose parcel has not settled, which is what the comment says.

And the sweep now requires an order to be **somebody's** responsibility
(`agentUserId` non-null and non-empty, as the ERP's own query did). The sweep
asks "has this person done their job"; an unassigned order has no such person,
and without the filter an order released into the unassigned queue would be
re-flagged for the rest of its life.

#### Two assertions in `packages/db` that had been red for two phases

Found while re-measuring the baseline, and unrelated to this slice except that a
red gate is a gate nobody reads. `packages/db` was **27/29**, not the 29/29
PROJECT_STATE recorded:

- **`FulfillmentOrder.salesOrderId`** — M-05's deliberate global unique, decided
  and written up in Phase 5.4 and never added to `GLOBAL_UNIQUES`. The allow-list
  *is* the mechanism for recording that decision, so the omission switched off
  the check that exists to make a missed constraint mechanical rather than a
  matter of vigilance.
- **`TenantSequence`** — reported as an unindexed tenant-scoped model since Phase
  5.2. A false positive: its `@@id([tenantId, name])` is backed by a unique btree
  index leading with `tenantId`, and the check only recognised a single-column
  `tenantId @id`. **Verified against the live database** rather than assumed —
  `CREATE UNIQUE INDEX "TenantSequence_pkey" … USING btree ("tenantId", name)`.

Both assertions demonstrably fire, which is how they were found.

#### Files
`apps/website-builder/src/lib/erp/assign.ts` (new),
`src/lib/erp/confirm.ts` (new), `src/lib/erp/jobs.ts`, `src/lib/erp/orders.ts`,
`src/lib/erp/from-sale.ts`, `src/lib/erp/webhooks.ts`,
`src/app/api/erp/orders/route.ts`, `orders/[id]/route.ts`,
`orders/[id]/call/route.ts`,
`test/erp/{assign,helpers,jobs,order-split}.test.ts`,
`packages/db/test/constraints.test.ts`, `packages/db/CONSTRAINTS.md`.

#### Migration
None. `followupAssignedAt` and `overdueFlaggedAt` already existed;
`followupAssignedAt` is now returned by the order read so a screen can show when
the handover happened.

#### Risk
**Auto-suspend can now be reached by a route it could not reach before.** With
`autoReassign` on, an order re-arms after each threshold, so one order that
nobody ever calls produces one miss per threshold rather than one miss ever —
which is the ERP's intent and the point of the feature, but it means
`suspendThreshold` is reachable faster than it was yesterday. Both `autoReassign`
and `autoSuspend` default to **false**; the ERP's own advice on turning BUG-01's
machinery on for the first time still applies — deploy with both off, watch a
day, then enable.

**Inventory is still not wired to confirmation.** `reserveOnConfirm` /
`releaseOnCancel` were never ported in Phase 5: `lib/erp/inventory.ts` has the
FIFO movement machinery and nothing calls it on a status change. Found while
building `confirm.ts`, stated rather than invented — it needs its own contract
tests over lot consumption, which is the part of this codebase most expensive to
get wrong. Recorded in NEXT_STEPS.

**Verified live:** assign 25/25 · jobs 14/14 · orders 38/38 · order-split 8/8 ·
access 63/63 · validation 29/29 · listing 25/25 · catalog 31/31 · delivery 26/26 ·
integrations 29/29 · screens 96/96 — **384/384**. website-builder 102/102 ·
db 29/29 · auth 36/36 · product-registry 36/36 · ui 26/26 · i18n 18/18.

---

### 6.5b M-15 — the scheduled work leaves the web process

The ERP ran its jobs on two `setInterval`s inside its web server. On a scaled
deployment that runs once per instance, so every miss is counted as many times
as there are instances. `jobs.test.ts` is new at **14/14**, and it is the file
`apps/erp/test/overdue-sweep.test.js` was deferred against in 5.1 — PORTING.md
said porting it "against a worker that does not exist would encode a contract
nobody has designed", and this is the design.

#### Idempotence instead of a lock

Every job is written so that running it twice — or on three instances at the
same moment — produces the same result as running it once, and each is **driven
twice by a test that asserts the second pass changes nothing.** That is stronger
than a lock: it needs no coordination, survives a crash mid-run, and cannot be
defeated by a deployment topology nobody told it about.

The mechanism is always a **column guard** matched in the same statement that
writes — `status: "open"` for escalation, `overdueFlaggedAt: null` for the
sweep. A second pass matches nothing because the first changed what it was
matching on. The sweep guards *twice*: once in the read and again in the
`updateMany`, so two instances that both selected a row have exactly one of them
count the miss.

#### BUG-01 is why this file is tested the way it is

The ERP's sweep threw `ReferenceError` on its first candidate of every run.
`setInterval` caught and logged it, so there was no symptom — and everything
downstream of that line, the missed-order counter and auto-suspend included, had
**never executed in production**. A job that fails silently is worse than one
that does not exist, which is why the tick logs per tenant and keeps going
rather than letting one tenant's bad data freeze everybody else's escalations.

#### Two bugs the tests caught before the code shipped

**`nightGraceMinutes` was applied to everything.** It is extra time for orders
that arrived *outside* working hours, so the overnight backlog is not all
flagged the instant the day starts — adding it to every order silently delayed
every flag by two hours, which is its default. It is now applied per order, to
the ones that actually arrived out of hours.

**A test that would pass by day and fail at night.** The sweep is gated on the
tenant's working hours (default 10–20) exactly as the ERP's was. The suite now
pins them open. A test that depends on the wall clock fails in CI at 2am and
nowhere else.

#### A type that could not represent a changed setting

`ErpSettings` derived its types from `DEFAULT_SETTINGS as const`, so
`autoSuspend` was typed as the literal `false` — its default — and
`settings.autoSuspend === true` was a compile error saying the two "have no
overlap". A stored `true` was unrepresentable. **A default is not a domain:** the
whole point of those rows is that a tenant changes them. The mapped type now
widens.

#### The worker holds no logic and no database connection

`services/worker` is a timer and an HTTP client, ~60 lines. Every job lives in
`src/lib/erp/jobs.ts` beside the domain code it uses, and both the worker's tick
and the manager's "run it now" go through the same `runJob`. A worker that
reimplemented any of it would be a second copy of rules the contract tests do
not reach — the same mistake D-06.1 refuses for write controls, in a process
nobody looks at.

`POST /api/jobs/tick` **fails closed**: with no `WORKER_SECRET` configured it
answers **404, not 401**, because "unauthorized" tells a stranger the endpoint is
there and worth guessing at. The comparison is length-checked and constant-time.
It is not reachable with a console session either — it is infrastructure, and it
sits beside `/api/health` rather than on the product's surface.

Which tenants it runs for comes from the **registry**: active subscription
holding the ERP's declared entitlement. A lapsed subscription stops the
scheduled work exactly as it stops the routes, and a tenth product's jobs would
join the loop by registering rather than by editing this file.

#### Files
`apps/website-builder/src/lib/erp/jobs.ts` (new),
`src/app/api/erp/jobs/[job]/route.ts` (new), `src/app/api/jobs/tick/route.ts` (new),
`src/lib/erp/settings.ts` (the widened type),
`services/worker/**` (new), root `package.json` (workspace + `npm run worker`),
`test/erp/{helpers,jobs}.test.ts`.

#### Migration
M-15. No schema change — `overdueFlaggedAt` and the `agent:<userId>`
ProductSetting already existed.

#### Risk
**Auto-reassign is not ported.** The ERP moved an overdue order to the
least-loaded eligible agent; that needs the same workload/eligibility logic as
`assignFollowup`, which is also unported, and the two belong together. The sweep
flags and counts; it does not move work. Recorded in NEXT_STEPS.

The tracking poll is likewise not scheduled — a parcel updates on a carrier
webhook or when somebody presses "ask the carrier". Also recorded.

**Verified live:** jobs 14/14 · delivery 26/26 · integrations 29/29 ·
orders 38/38.

---

### 6.5a The follow-up producer — carrier events raise tasks again

The half of the follow-up module Phase 5 never carried across. `delivery.test.ts`
goes 20 → **26/26**, and the module has a producer for the first time on the
platform: until now it could list, count and resolve tasks that nothing created.

#### One choke point, and only on a transition

`ingestEvents` serves both the tracking poll and the inbound carrier webhook, so
attaching there means neither path can raise a task the other does not.

It fires **only when the status actually changes**, which is stricter than the
ERP and deliberately so. The ERP raised from any report and relied on "one open
task per order" to dedupe — which re-raised after an agent had resolved one,
every time a carrier replayed its history, and carriers replay constantly.
Entering a problem state is the event worth ringing somebody about; being told
again that the parcel is still in it is not.

#### The rule is two-part because the mapped status is not the signal

`refused` and `returned` always require a call. Everything else is caught by
**the carrier's own wording**: Algerian carriers write "Client absent",
"Adresse erronée", "Reporté par le client" and map all of them onto whatever
their API calls "in progress", so the mapped status says nothing useful and the
original text says everything. Ported verbatim in behaviour, and both halves are
asserted — one test drives a CRM status, another drives wording that maps to
nothing in particular.

A test also drives an ordinary movement and asserts **nothing** is raised. A
queue that fills up with parcels moving normally is a queue nobody reads.

#### What the task carries

The countdown is the tenant's `followupReminderMinutes` — the setting the
automation screen edits. The reason keeps what the carrier said, because that is
what tells an agent why they are ringing. Assignment is the order's
`followupUserId`, and unassigned is fine: `loadOwnedFollowupTask` already treats
an unowned task as work anybody may pick up.

#### A gap the fixture found

`POST /api/erp/orders` accepts `agentUserId` and **not** `followupUserId` — a
follow-up agent is set by reassignment through `PATCH`, where `buildPatch` makes
both manager-only. That is consistent, but it means the ERP's `assignFollowup`
(workload-balanced auto-assignment of a follow-up agent on confirmation, behind
the `followupAutoAssign` setting) is **still not ported**. The degradation is
graceful — tasks are raised unassigned and anybody may take them — and it is
recorded in NEXT_STEPS rather than left to be discovered.

#### Files
`apps/website-builder/src/lib/erp/followup.ts` (new),
`src/lib/erp/shipments.ts`, `test/erp/delivery.test.ts`.

#### Migration
None.

#### Risk
Tasks are now raised and can be resolved, but **nothing escalates an unactioned
one to `overdue`** — that is the jobs loop, M-15, and it is the next slice.

**Verified live:** delivery 26/26.

---

### 6.4c Resolving a follow-up task — and what the port of it exposed

The route 6.4b asserted the absence of. `integrations.test.ts` goes 22 →
**29/29**, `access.test.ts` 62 → **63/63**, `screens.test.ts` 95 → **96/96**.

#### What the module is for

The follow-up module watches what carriers report. When a shipment reaches a
state needing a person — the customer was out, the address is wrong, they want
it another day — a task is raised against the order. An agent rings them, sorts
it out, and marks it done. That last step is what landed here.

#### The guard, and why it has one

Resolving asserts *I contacted this customer*. It is a claim about work done —
the same class of thing as logging a confirmed call — which is why the ERP
guarded it, in a comment worth keeping: an agent must not close out somebody
else's task, "whether by accident or to hide an overdue one".

`loadOwnedFollowupTask` mirrors `loadOwnedOrder`: whoever sees the whole book,
the person it is assigned to, or **anybody when it is assigned to nobody** — the
ERP's own `task.agent && task.agent !== user` rule, and the same reasoning that
lets an agent act on an unassigned order so work can be picked up rather than
only handed out.

**404, not the ERP's 403 `NOT_YOUR_TASK`.** Confirming the task exists and
belongs to a colleague is itself information, and 404 is the answer
`loadOwnedOrder` already gives to the same question. One rule that can drift
beats two. A test asserts the task is still `open` afterwards, so the refusal is
not cosmetic.

#### It settles once, and writes no second marker

A repeat press returns the task unchanged rather than moving `resolvedAt`, for
the reason `deliveryOutcome` settles once: when a customer was contacted is a
fact about the past.

The ERP also wrote `orders.callReminderStatus = 'done'` here. This deliberately
does not. On the platform the **task** is the source of truth — the follow-up
dashboard counts `FollowupTask.status` and nothing reads `callReminderStatus` at
all — so a parallel marker nothing consults would be the mirror image of BUG-02,
and two markers for one fact are two things that come to disagree.

#### A bug 6.4b shipped, found by writing this

The queue's follow-up panel filtered `status: "pending"`. The vocabulary is
**`open | done | overdue`** — what the schema declares and what the follow-up
dashboard has always counted. The panel was showing nothing and would have gone
on showing nothing. It now lists both unfinished states, because an *overdue*
task hidden from the agent's panel is precisely the one that goes unactioned.

#### And two gaps the port exposed, which are bigger

Building the resolver made it obvious that the platform has no **producer** and
no **escalator** for these tasks:

- **Nothing raises a follow-up task.** `onDeliveryStatus` in the ERP creates one
  when a carrier reports a status matching `CALL_REQUIRED_CRM_STATUSES`.
  `src/lib/erp/shipments.ts` ingests carrier events and settles
  `deliveryOutcome`, and contains **zero** references to follow-up. The module
  on the platform is a table, two reads and now a resolve — with no way for a
  task to come into existence.
- **Nothing escalates one to `overdue`.** That is `escalateOverdue()` on the
  ERP's jobs loop, and the platform runs **nothing on a timer at all** — no
  `setInterval`, no cron, no worker. M-15.

Neither is a 6.4 regression; both are Phase 5 porting gaps that only became
visible from the far end of the feature. They are why `apps/erp` still cannot be
retired — see PROJECT_STATE.

#### Files
`apps/website-builder/src/app/api/erp/followup/tasks/[id]/resolve/route.ts` (new),
`src/components/console/erp/followup-resolve.tsx` (new), `src/lib/erp/guard.ts`,
`src/app/console/erp/queue/page.tsx`,
`packages/i18n/src/messages/{en,fr,ar}.json`,
`test/erp/{helpers,access,integrations,screens}.test.ts`.

#### Migration
None. `FollowupTask.status` and `resolvedAt` already existed.

#### Risk
`apps/erp` **still cannot be retired**, and for a larger reason than before: the
follow-up module has no producer on the platform, and no scheduled work runs at
all. Both are documented with their scope in PROJECT_STATE.

**Verified live:** integrations 29/29 · access 63/63 · screens 96/96 ·
i18n 18/18.

---

### 6.4b Filters, the parcel line and the follow-up panel

The rest of what `agent.html` shows. `screens.test.ts` goes 90 → **95/95**.

#### The filters are a plain GET form

No client component, no JavaScript. The status select and the search box submit
to the same path and are read by the **same `orderFilters`** the API uses, so the
screen and the endpoint cannot interpret `?status=` differently — and the filter
survives a reload, a shared link and a browser back button, none of which client
state does.

#### Where the parcel is, without a modal

The ERP opened a tracking dialog. The full event timeline already lives on the
order detail, so the card carries the one line a customer actually rings back to
ask about — status plus tracking number — and links to the rest. It renders only
when a shipment exists, so an unbooked order shows nothing rather than an empty
dialog.

#### A settled order keeps the note and loses the call controls

The queue defaults to work still to be done; a terminal order appears only when
somebody filters for one. The ERP's card dropped the dial and the result buttons
there and kept the note, and that boundary is part of what is being ported —
changing a settled order is a deliberate act on the order detail, which has the
full call panel. `workable` comes from `TERMINAL_STATUSES`, so it cannot drift
from the set the queue filters on.

#### One scope rule, two callers

`followupScope` moved out of `api/erp/followup/tasks/route.ts` into
`lib/erp/scope.ts`, and the route now calls it. The screen calls the same
function rather than a copy: `hardening.test.js §7` exists because the ERP
accepted `?agent=` on this queue and honoured it, so an agent could list a
colleague's tasks by asking — and a screen that reimplemented the rule would be a
second chance to make that mistake, in the place nobody thinks to test.

`FollowupTask.orderId` is a plain column with no relation (M-06 did not invent a
foreign key the ERP never had), so the orders are fetched in a second query
inside the same tenant binding and joined in memory.

#### The panel is read-only, and the test says when to change that

`POST /followup/tasks/:id/resolve` exists in the ERP and has **no platform
route**. A resolve button would 404, so there is none, and the screen says so in
all three languages. The test asserts the *absence of the route* — it fails the
day one appears, with a message naming the panel and NEXT_STEPS as the things
that then need updating. A gap that announces its own closure beats a TODO.

#### Files
`apps/website-builder/src/lib/erp/scope.ts`,
`src/app/api/erp/followup/tasks/route.ts`,
`src/app/console/erp/queue/page.tsx`,
`src/components/console/erp/queue-card.tsx`,
`packages/i18n/src/messages/{en,fr,ar}.json`, `test/erp/screens.test.ts`.

#### Migration
None.

#### Risk
`apps/erp` **cannot yet be deleted**, for exactly one functional reason: nobody
can mark a follow-up task done on the platform. See *What still prevents
retiring `apps/erp`* in PROJECT_STATE for the full assessment, including the two
absences that are judgement calls rather than blockers.

**Verified live:** screens 95/95 · access 62/62 · listing 25/25 · i18n 18/18.

---

### 6.4a The confirmation agent's queue

The port of `apps/erp/agent.html` begins — the last thing that application
serves with no replacement. `screens.test.ts` goes 80 → **90/90**.

#### Measured first, and it was bigger than the note said

NEXT_STEPS described the app from a partial read. Reading all 1,172 lines found
seven surfaces, not three: the scoped queue, the call loop, notes, a **delivery
tracking modal**, a **follow-up task panel with a resolve button**, a
notification bell with **Web Push**, and an **AI assistant**. Three of those do
not port, and each is recorded below rather than faked.

#### One gesture, and the server does not get to block it

The whole application is: tap to dial, tap the outcome. The dial is a real
`tel:` anchor whose default is never prevented, with `POST /call-start` fired
alongside it.

That is the one place in the entire write surface where a request is not
awaited, and it is deliberate. `call-start` is what makes duration measurable
and duration is what makes the suspicious-call flag mean anything — but an agent
on a bad connection still has to be able to ring the customer. If the request
loses, the call still happens and `addCall` records it as `noStart`, which is
exactly the state that flag exists to describe. Blocking the dial to guarantee
the timestamp would trade the customer's phone call for a metric about it.

#### A screen, not a second application

The ERP's app had its own login screen and a stored server URL. Neither ports:
the platform session is a cookie on this origin. So this is `/console/erp/queue`
inside the console shell, and every control calls the routes the order detail
calls — no new write path, no second copy of the ownership guard.

#### Oldest first, in the query

The ERP downloaded every order and sorted client-side by three keys — overdue,
then pending, then newest. Oldest-first puts the same rows on top for the same
reason (the longest-waiting customer has waited longest) in one `ORDER BY`,
which is what PERF-02 was about. The overdue badge is still computed and shown;
it simply is not what decides the order.

#### Two constants became one derived set and one setting

`ACTIVE_STATUSES` is now **derived by subtracting the terminal ones** rather than
listed. The ERP wrote the seven out by hand in three places, which is three
places to forget when the call-centre invents an outcome — and `tentative3`
proves they do. Subtracting means a status added later lands in the queue by
default: an agent seeing an order they need not have called is a moment's
confusion, an order that silently never appears is a customer nobody rings.

**Overdue is judged against `alertMinutes`**, the tenant's own setting that the
overdue sweep already uses, not the ERP's hardcoded 60. A manager who shortens it
on the automation screen shortens it here. Asserted both ways — nothing overdue
at a week, everything overdue at a minute.

#### Files
`apps/website-builder/src/components/console/erp/queue-card.tsx` (new),
`src/app/console/erp/queue/page.tsx` (new), `src/lib/erp/orders.ts`,
`packages/product-registry/src/manifests.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json`, `test/erp/screens.test.ts`.

#### Migration
None.

#### Risk
Three surfaces of the ERP's app are **not** ported, none of them faked:

- **Notifications and Web Push** — M-16, no platform transport exists.
- **The AI assistant** — `ai/chat` answers 501 by design.
- **Resolving a follow-up task** — `POST /api/followup/tasks/:id/resolve` exists
  in the ERP, has **no platform route**, and is absent from `access.test.ts`'s
  inventory, so it was never ported in Phase 5. The queue can therefore show
  follow-up work but not action it. **This blocks retiring `apps/erp`** and is
  not something 6.4 should invent — a route without a contract test would be the
  one write path nothing covers.

Delivery tracking and the follow-up panel are 6.4b.

**Verified live:** screens 90/90 · access 62/62 · console-shell 13/13 ·
product-registry 36/36 · i18n 18/18.

---

### 6.3d Carriers, the books, the team and automation — Phase 6.3 is complete

The last four write surfaces. `screens.test.ts` goes 59 → **80/80**, and every
mutation the ERP's SPA can perform now has a control on the platform.

#### The name was the defect

The new screen was going to be `/console/erp/settings`. The product registry's
own test refused it before a line of it shipped:

> *A tenant with N products must still see ONE Settings, owned by the shell. A
> product that ships its own is the first step to N of them.*

That assertion is right, and the fix was not to work around it. Every key on the
page is a rule the ERP applies **by itself** — assign, confirm, reassign,
suspend, reserve, poll — so the screen is `/console/erp/automation` and the nav
item is "Automation". The stored rows are still `ProductSetting` and the route is
still `PUT /api/erp/settings`; only the thing a person sees was misnamed. A new
test asserts the shell's Settings link still appears exactly once.

#### A gap the tests found in shipped code

`erp:shipments:write` gates **every** carrier route, including the `GET` — the
whole surface is manager-only, because a carrier record is delivery
configuration. The nav has always hidden the item without it. The **page never
checked**, and it reads the database directly rather than through the API, so an
agent who typed the URL got every carrier's name, code, adapter and whether it
held credentials. Now gated in the page, 404 not 403, exactly as 6.2 did for
clients, finance and agents.

#### The keys still never reach the page — with a credential form on it

The carriers screen has never selected a credential and does not start now. What
it renders where one exists is the **mask**, four bullet characters, and two
independent things stop the form destroying a stored key: the component never
*sends* the mask or a blank, and `preserveSecrets` drops the mask server-side.
Either alone would do; both, because the failure is silent — nothing errors until
the next shipment fails to book.

`CARRIER_SECRET_MASK` moved into a directive-free module so the two sides
provably agree on it. Two copies of four bullets is two things that can quietly
stop matching, and the consequence of that is a real key overwritten with a
placeholder.

What is deliberately **not** offered is a way to clear a credential to empty. The
API accepts `null` for it, but a blank box is indistinguishable from "I did not
touch this". Deactivating the carrier is the control that means "stop using it".

#### Hidden, not unmounted

The collapsible panels render their contents always and toggle `hidden`. That is
not a test accommodation — mounting on click means the offered vocabulary only
exists after JavaScript runs, which makes "the offered set equals what the API
accepts" unassertable and leaves the options unreadable to assistive tech until
somebody clicks. Two tests failed on exactly this and were right to.

#### What each screen refuses to offer

- **A saved P&L has no edit and no delete**, because no such route exists: the
  older row *is* the record of what the business looked like when that
  calculation was made. A one-off charge is deletable. Both asserted.
- **Net profit and margin have no input.** The route derives them and ignores
  what the request claims — a contract test posts `999999` and expects `37000`.
  A box for either would be a field whose value the server throws away.
- **No control to suspend yourself, or the owner.** The API answers 422 to both;
  keeping the controls off the screen is what stops anyone meeting the refusal.
- **The platform role is not a job role.** The picker offers `confirmation`,
  `followup`, `both` and a test asserts `OWNER`/`ADMIN`/`MEMBER` are absent —
  `PATCH /agents/[id]` deliberately cannot set a platform role, because routing
  that through a product would let every product grant privileges in every other.
- **Structured settings have no control, decided by TYPE not by name.**
  `defaultCarrierByChannel` and `fixedCosts` need editors of their own; filtering
  on the declared type means one added later is excluded automatically instead of
  silently rendering as a checkbox.

#### One schema, one vocabulary

`SETTINGS_SCHEMA` and `PERIOD_TYPES` are now exported from the modules the routes
validate against, so the screens build their controls from them. A form with its
own list of fields is a second vocabulary that goes stale the moment a setting is
added — and the way that shows up is a control nobody can find rather than an
error anybody sees.

#### i18n

68 more keys across all three catalogues — the four write surfaces, 15 setting
labels, the job roles, the period types and the seven weekday abbreviations
(Sunday first, because that is what `getDay()` returns and what the config
stores).

#### Files
`apps/website-builder/src/components/console/erp/{carrier,finance,agent}-write.tsx`,
`settings-form.tsx`, `src/components/console/setting-field.ts` (all new),
`src/lib/erp/carrier-mask.ts` (new), `src/lib/erp/{carriers,settings}.ts`,
`src/lib/console/erp-strings.ts`,
`src/app/console/erp/{carriers,finance,agents}/page.tsx`,
`src/app/console/erp/automation/page.tsx` (new),
`src/app/api/erp/financial-records/route.ts`,
`packages/product-registry/src/manifests.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json`, `test/erp/screens.test.ts`.

#### Migration
None.

#### Risk
**Phase 6.3 is complete.** Every mutation the ERP's SPA performs has a control on
the platform, so `apps/erp` is no longer the only way to do anything a manager
does. What it still uniquely serves is the **agent PWA** (`agent.html`, 1,261
lines) — that is 6.4, and it is the last thing standing between here and deleting
`apps/erp`.

**Verified live:** screens 80/80 · access 62/62 · catalog 31/31 · delivery 20/20 ·
console-shell 13/13 · product-registry 36/36 · i18n 18/18.

---

### 6.3c The parcel, the catalogue and the stockroom

Three more surfaces. `screens.test.ts` goes 50 → **59/59**.

#### Three surfaces, three different permissions

`erp:shipments:write`, `erp:products:write`, `erp:inventory:write` — and an ERP
confirmation agent holds **none** of them. That is the point of this slice: the
gate is the permission each *route* checks, not one blanket "may write" flag.
An agent who logs calls and corrects their own orders still must not book
parcels, create products or move stock, and the ERP's own split said so first.

Each is asserted twice, in both directions: the control is absent from the
screen, and the API answers 403 for the same person.

#### Archive, never delete — said by the button

`DELETE /products/[id]` sets a flag, because a product is referenced by every
order that ever contained it, by its movement ledger and by its event timeline.
The control therefore says **Archive**, and the archived view offers **Restore**
rather than pretending the row is gone. The create panel is withheld from the
archived view: a new product would land somewhere invisible.

Both cost fields are on the create form, which is not padding. An earlier
version of that route dropped `costPrice` and `packagingCost`; nothing failed,
and the product simply appeared with a zero cost basis — which makes every
profit figure derived from it wrong rather than absent.

#### Stock moves by a delta and a reason. There is no box for a total.

"Stock is 15" tells nobody anything; "20 → 15, five damaged, recorded by this
person" is auditable. `POST /inventory/adjust` offers no way to set an absolute
figure, so neither does the panel — a field labelled "new quantity" would be a
control the API cannot honour. A test asserts the delta and reason inputs exist
and that no total input does.

The lot panel says on the page why lots exist at all — a purchase creates its
own lot at its own price and a sale consumes the oldest first, which is what
makes the reported margin the real one. And a **return carries no price field**,
because it rejoins stock at the product's existing cost basis rather than
inventing a purchase that never happened.

The variant picker clears when the product changes. Carrying the old name over
would send a variant the new product does not have, which the route answers 404
for — a self-inflicted refusal rather than a mistake anybody made.

#### One control at a time on the parcel

Booking is idempotent — a second call returns the existing shipment rather than
a second parcel — so offering **Book** again would not be dangerous, only a lie
about what the button does. Once a shipment exists the control becomes *ask the
carrier*, which is what refreshing is.

`NO_CARRIER` gets its own translated message rather than the generic
"that value was not accepted", because it names something the reader can go and
fix.

#### i18n

25 more keys in all three catalogues. Two that already existed —
`erp.inventory.change` and `.reason` — are reused rather than duplicated under
`erp.write`: one word, one key, or the two drift.

#### Files
`apps/website-builder/src/components/console/erp/catalog-write.tsx` (new),
`src/lib/console/erp-strings.ts` (new — one label bundle, two screens),
`src/components/console/erp/order-write.tsx` (`ParcelPanel`),
`src/lib/console/action-errors.ts`,
`src/app/console/erp/{products,inventory,orders/[id]}/page.tsx`,
`packages/i18n/src/messages/{en,fr,ar}.json`, `test/erp/screens.test.ts`.

#### Migration
None.

#### Risk
Carriers, finance, agents and settings still have no controls — 6.3d. `apps/erp`
remains the only way to configure a carrier, save a P&L or set a pay rate.

**Verified live:** screens 59/59 · access 62/62 · catalog 31/31 ·
delivery 20/20 · i18n 18/18.

---

### 6.3b Editing an order, reassigning it, and acting on many at once

The second write slice. `screens.test.ts` goes 39 → **50/50**.

#### The theme is the split, made visible

`buildPatch` writes some fields for anyone who may touch the order and others
only for a manager, and it refuses reassignment **loudly** rather than dropping
it. Every one of those distinctions now shows on the screen, because the
alternative is an agent typing into a box whose value is silently discarded:

- An agent's edit form carries the AGENT_WRITABLE fields — correcting the
  address on your own order is the job. `price`, `managerNote`, `marketer` and
  `brand` are **absent**, not disabled. `price` is what payroll and the profit
  calculator are computed from.
- The manager's form carries both halves, with the second captioned rather than
  merely present.
- **Reassignment is offered only where `seesWholeBook` is true** — the same
  predicate `buildPatch` uses to decide that 403. Keeping the control off the
  screen is what stops anyone meeting a refusal that exists so an agent cannot
  believe they picked up work. The test asserts both: no panel, and a 403 with
  `FORBIDDEN_FIELD` for the same person.

Three writable fields carry no control on purpose. `deliveryMethod` is `'COD'`
everywhere in the ERP and has no vocabulary, so a free-text box would invite
writing a value nothing downstream understands — a worse failure than no
control. `lineItems` is a JSON document. `unitPrice`/`subtotal`/`discount`/
`shippingCost` are the storefront's own arithmetic, and offering them beside
`price` would let the two disagree with nothing to reconcile them.

#### Money is never a `type="number"` input

A number input hands back a JS float, and 37 columns are `Decimal` precisely so
money never touches binary floating point (M-06). The last place that guarantee
can be lost is the box a person types into, so `price` is a text input with
`inputmode="decimal"`, and a test reads the rendered tag to prove it.

#### D-06.3, where it stops being a slogan

`PATCH` does not always store what was typed: `buildPatch` **normalises a phone
number**, because that value is the `Client` dedup key and `+213 555 12 34 56`
has to be the same customer as `0555123456`. Without a remount the box would go
on showing the typed form while the database held the normalised one — the
screen quietly lying about the field a customer record is keyed on.

The panel is therefore keyed on a fingerprint of the server's values. Derived
from the values rather than from `updatedAt` on purpose: an unrelated write — a
call logged in the panel above — bumps the timestamp, and remounting on that
would discard whatever somebody was halfway through typing.

#### The bulk selection is a form, not client state

The order list stays a **server** component and is passed to the bar as
`children`; the checkboxes are plain inputs read with `FormData`. The filter,
the scope and the page all stay in the query (PERF-02), and there is no second
copy of what is ticked to drift from what is on screen.

`POST /orders/bulk` refuses `delete` and `assign` for anyone `seesWholeBook` is
false for, so an agent is offered only the status change — asserted both by the
absent controls and by a 403 from the API for the action they were not offered.
The outcome is shown as a **count**, because the route reports per id: 49 of 50
is a result, not a failure, and the one that did not move is what a person needs.

#### A green build proving nothing, for the third time

`editFingerprint` first lived beside the component in the `"use client"` module.
A plain function exported from a client module is **not a function on the
server** — it is a client reference. The build succeeded and every request to
the order detail answered 500. It now lives in `components/console/edit-field.ts`
with no directive, imported from both sides, the same shape `action-errors.ts`
already had for the same reason.

#### The reassign picker, and what it is allowed to know

It lists memberships read inside the tenant binding, gated on `seesWholeBook` —
somebody who already sees every order's `agentUserId` learns nothing new from a
name beside it, and gating on `erp:agents:manage` instead would offer the
control to the wrong set of people in both directions. The select names its
fields rather than including the user record, which is how a password hash
arrived on a screen the first time (SEC-02); a test asserts no hash of any
generation appears, and another asserts a second tenant's people cannot.

#### i18n
26 more keys in all three catalogues — the edit form, assignment, and the bulk
bar.

#### Files
`apps/website-builder/src/components/console/edit-field.ts` (new),
`src/components/console/erp/order-bulk.tsx` (new),
`src/components/console/erp/order-write.tsx`,
`src/components/console/api-action.tsx` (`run` now returns the response data),
`src/app/console/erp/orders/{page,[id]/page}.tsx`,
`packages/i18n/src/messages/{en,fr,ar}.json`, `test/erp/screens.test.ts`.

#### Migration
None.

#### Risk
The parcel, inventory, products, carriers, finance, agents and settings still
have no controls — 6.3c and 6.3d. `apps/erp` remains the only way to do those.

**Verified live:** screens 50/50 · access 62/62 · listing 25/25 ·
validation 29/29 · console-shell 13/13 · i18n 18/18.

---

### 6.3a The screens start writing — the call surface

Every ERP screen was read-only: each mutation had a route and a passing contract
test, and no control. This is the first of them — the agent's working loop.
Start the call, log what happened, record something that was not a call, mark an
order fake. `screens.test.ts` goes 31 → **39/39**.

#### D-06.1 — a control calls the API route, it does not get its own write path

The builder's order detail already shows the alternative and its cost: its
server action re-declares `VALID_TRANSITIONS` in the page with a comment saying
it "mirrors the API route exactly" — a promise, not a mechanism.

A server action here would be a **second write path**, and a second write path
needs its own copy of the permission gate, the ownership guard and the
validation. The read screens deliberately avoided that by calling
`mayTouchOrder` and `orderScope` rather than reimplementing them. This is the
same rule for writes, and it matters more: the copy would not merely drift, it
would be the half nobody tested. 6.3a therefore adds **no authorization code at
all** — the write path is the path 266 contract tests already attack.

The cost, stated: these controls need JavaScript where the rest of the console
does not. That is the trade NEXT_STEPS predicted.

#### D-06.2 — the control is rendered only where the API would accept it

A plain `MEMBER` reaches `erp:orders:read` through the `*:*:read` glob and can
open the order; nothing reaches `erp:orders:write`, which an agent holds by
explicit grant. So the panels are gated on the permission itself, resolved with
`can()` — the same function `tenantRoute` calls — and the test asserts both
halves: no controls on the page, and a 403 from the API for the same person.

Absence is **stated** rather than silent. Somebody who can read an order but not
work it should learn that from the page, not from a button that 403s.

#### D-06.3 — no optimistic UI, and the panel proves it

A confirmed call is money: it moves the status, it is what an agent is paid per,
and it is what the suspicious-call flag watches. So nothing is guessed. On
success the router refreshes and the server component re-renders from the
database; the control stays busy until that arrives, which is why the refresh is
wrapped in a transition rather than fired and forgotten.

The call panel renders `pendingCallStart` as stored, so a second tab and a
colleague see the same thing. Once a call is running the **start button is
gone** — pressing it again would overwrite the start time the suspicious flag
rests on.

#### What is deliberately NOT gated

The result buttons are offered whether or not a call was started. `POST /call`
accepts that and **flags** it (`noStart`), so hiding the control would refuse
work the API allows and strand an agent who forgot to press start with no way to
record a call they really made. The screen says what happens instead.

Never offer a control the API will refuse; equally, never withhold one it
accepts. The tests assert both directions — the offered set equals
`CALL_RESULTS` exactly, and every one of the eight is then logged for real.

#### The picker found a gap three phases of read screens could not

`tentative1`, `tentative2` and `tentative3` are first-class ERP statuses — they
are in `ORDER_STATUSES`, in `CALL_RESULTS` and in the attempts matrix — and they
were **missing from the console's status registry entirely**. Nothing had ever
reached a tentative state, so every read screen rendered correctly; the moment a
result picker existed, three of its eight buttons came back labelled "Unknown".

Added to `CONFIRMATION_STATUS` with one tone for all three, not the ERP's
escalating yellow → orange → rust: each means the same thing to whoever is
looking at the queue — call this person back — and the attempt number is already
in the label. That is the reasoning `DELIVERY_STATUS` already follows.

`tokens.test.ts` refused the new keys, because its shape assertion allowed no
digits. Widened to `[a-zA-Z][a-zA-Z0-9]*` on the leaf, with the reason recorded
in place: the property is "a label is a key, not a human string", and it still
bites — "Attempt 1" has a space and no dots.

#### Refusals in the reader's language

The API's `message` is English, written for whoever reads a log. A screen cannot
show it. `lib/console/action-errors.ts` maps the machine-readable **code** to an
i18n key, which is what a code is for and lets a route improve its wording
without changing what an agent reads. It is deliberately **not** `server-only`,
unlike its neighbours: it is the contract between the envelope and the control,
both sides import it, and it reaches nothing. That boundary was found by the
build, which refused a `"use client"` module importing a `server-only` one.

#### i18n

40 keys across all three catalogues — the write surface, a shared `common.error`
vocabulary, the five note types and the three tentative statuses. The tentative
labels are the ERP's own (`مبدئي 1` / `Tentative 1`). A test renders the same
control in two locales and asserts neither shows a raw key or "Unknown".

#### Files
`packages/ui/src/status.ts` + `test/tokens.test.ts`,
`packages/i18n/src/messages/{en,fr,ar}.json`,
`apps/website-builder/src/lib/console/action-errors.ts` (new),
`src/components/console/api-action.tsx` (new),
`src/components/console/erp/order-write.tsx` (new),
`src/app/console/erp/orders/[id]/page.tsx`, `test/erp/screens.test.ts`.

#### Migration
None.

#### Risk
Still read-only: editing an order, reassigning it, bulk actions, the parcel,
inventory, products, carriers, finance, agents and settings. `apps/erp` remains
the only way to do those, so it cannot be retired yet. Those are 6.3b–d.

**Verified live:** screens 39/39 · access 62/62 · orders 38/38 ·
console-shell 13/13 · ui 26/26 · i18n 18/18.

---

### 6.2 The rest of the ERP's screens

Eight more: customers, products, inventory, shipments, carriers, follow-up,
finance, agents. Every item in the ERP's navigation now leads somewhere real,
and `screens.test.ts` goes 13 → **31/31**.

#### Gated, not merely unlinked

A nav item is a hint. The URL is typeable. So the three sensitive screens —
customers, finance, agents — check the permission in the page itself rather than
trusting the menu to have hidden the link, and the tests type the URL as an
agent and expect **404**:

- **Customers** is every customer's name, phone number, address and lifetime
  spend in one scrollable list — the single most sensitive screen in the
  product, and why D-05.1 made `erp:clients:read` sensitive.
- **Finance** is the company's P&L.
- **Agents** needs `erp:agents:manage`, which no role grants implicitly.

The nav also hides what the caller cannot open, so an agent is never offered a
link that would 404 — but the gate is the page, not the menu.

#### No screen renders a credential

The carriers screen does not mask keys — it **never selects them**. A value that
is not loaded cannot be leaked by a logger, by a spread, or by a column somebody
adds to the table next year, and these keys book real parcels at the tenant's
expense. What it shows instead is whether credentials *exist*, because a
configured carrier and an unconfigured one look identical otherwise.

The agents screen carries no password material at all — SEC-02's original defect
was `GET /api/agents` returning every password in cleartext, and the select
names its fields rather than including the user record, so a hash cannot arrive
by accident the way it did the first time.

#### What the screens say about the rules underneath

- **Inventory judges low stock per VARIANT.** A shoe with 200 units is not fine
  if 199 are size 45.
- **The movement ledger offers no edit**, because no such route exists. Each row
  carries where stock was and where it went.
- **Finance says on the page** that records are kept forever and never edited —
  a manager looking for an edit button should learn why there is not one.
- **One-off charges are deletable and saved records are not**, which is the
  asymmetry the schema encodes: a P&L is a statement somebody made, a van repair
  typed in wrong is data entry.
- **The job role is shown separately from the access role**, because the ERP
  kept them separate so a follow-up agent could also be a manager.

#### i18n

65 more keys across all three catalogues — 109 ERP screen strings in total.
Arabic and French in the operational register the staff use.

#### Files
`src/app/console/erp/{clients,products,inventory,shipments,carriers,follow-up,finance,agents}/page.tsx`,
`packages/i18n/src/messages/{en,fr,ar}.json`, `test/erp/screens.test.ts`.

#### Migration
None.

#### Risk
The screens are READ-ONLY. Every mutation the ERP's SPA can perform — logging a
call, adjusting stock, editing a carrier — has a route and a contract test, but
no control on the new screens yet. `apps/erp` therefore cannot be retired: it is
still the only way to *do* anything. That is 6.3, along with the agent PWA.

**Verified live:** screens 31/31 · access 62/62 · console-shell 13/13 ·
i18n 18/18.

---

### 6.1 The ERP gets real screens

`/console/erp` was served by the generic `[product]` route with an honest
placeholder that said its screens were ported in a later milestone. This is that
milestone: an overview, the order book, and the order detail an agent works in.

A static segment wins over a dynamic sibling in Next, so these files simply take
those paths and nothing about the platform changed to let them — which is the
property the registry exists to protect.

#### What a screen can get wrong that an API cannot

The permission check can exist in the route and not in the render. So the
screens use the SAME functions the API uses — `mayTouchOrder`, `orderScope`,
`seesWholeBook` — rather than their own copies, and the tests assert the read
path refuses what the write path refuses:

- An agent opening a colleague's order gets **404**, not 403 and not a page.
  Confirming it exists and belongs to someone else is itself information, and it
  is the answer the platform already gives for another tenant's row.
- The **manager note is not rendered** for an agent. `PATCH` has always refused
  to let an agent write it; a screen that displays it would leak through the
  read path what the write path was protecting.
- An agent's **overview counts their own queue**, through `orderScope`. Showing
  a company-wide total they cannot act on would be both a leak and a lie about
  their workload.
- The customer-count tile is **absent** for an agent, not zero (D-05.1). A zero
  is a lie that reads as a fact about the business.

#### A test whose example expired

`console-shell.test.ts` asserted "a product with no page of its own is still
fully served", using the ERP — which shipped a manifest and nothing else. Phase
6.1 removes that example by design, and no shipped product exercises the
fallback end to end any more.

Rather than delete the coverage or pretend, it split in two. The property that
still holds and matters more — **navigation comes from the manifest, not from a
list hardcoded in a product's screens** — is now asserted on the ERP's REAL
screen, which is stronger than asserting it on a placeholder built to be
replaced. The fallback's resolution logic is asserted at the registry level,
where it needs no spare product.

That required `data-nav` on the shell's own nav links. It had only ever been
emitted by the placeholder, which meant the property stopped being checkable for
any product that grew real pages — exactly backwards.

#### i18n

44 ERP screen keys in all three catalogues. Arabic and French are the
operational register the staff actually use, not literal translations. Every
user-facing string is a key; the parity test enforces it.

#### Files
`src/app/console/erp/{page,orders/page,orders/[id]/page}.tsx`,
`src/components/console/console-nav.tsx`,
`packages/i18n/src/messages/{en,fr,ar}.json`,
`test/erp/screens.test.ts` (new), `test/console-shell.test.ts`.

#### Migration
None.

#### Risk
`apps/erp` still runs and still serves the old SPA. Retiring it needs the
remaining screens — clients, products, inventory, carriers, finance, agents —
and the agent PWA. Those are 6.2 onward.

**Verified live:** screens 13/13 · console-shell 13/13 (was 12; the split adds
one) · access 62/62 · builder-api 22/22 · i18n 18/18.

---

## Phase 5 — The ERP onto the platform

### 5.4 The order split (M-05) — Phase 5 is complete

`SalesOrder` and `FulfillmentOrder` have existed as names since 3.2. This is the
relationship, and the end of Phase 5: **235/235 contract tests pass** against a
live server.

#### The webhook between two products in one database

A storefront checkout wrote the sale and then fired an unawaited `order.created`
webhook, which the ERP received over HTTP and turned into its own order. That
was right when the ERP was a separate Express application with a separate
database. It is wrong now — both records live in the same Postgres, reachable
from the same transaction — and going over the network to get from one to the
other means the sale can be recorded while the fulfilment record is not, with
nothing to reconcile them and **no error anybody sees**, because the call was
fire-and-forget by design.

Now it is one transaction. Either the customer has an order and the call-centre
has something to confirm, or neither happened.

**The webhook stays**, and becomes purely what it was also always serving as:
the tenant-facing integration, a company subscribing their own endpoint to their
own events. Still unawaited, for the original reason — somebody else's server
being down is not a reason to fail a customer's checkout.

#### Neither product is privileged

A tenant with the builder and not the ERP still sells; the fulfilment record is
simply not created. Checked through the registry, so nothing in the checkout
path enumerates products. Asserted both ways: the sale succeeds, and no
fulfilment record is invented for them.

#### The money is copied, not recomputed

The sale is what the customer agreed to pay. Recalculating totals on the ERP
side would let tomorrow's price change alter an order already placed — which is
the whole reason `SalesOrder` is an immutable snapshot in the first place.

#### One exception to M-04, stated

`salesOrderId` is unique **globally**, not per tenant. M-04 rescoped every
constraint because human-meaningful values — a slug, a phone number, an order
number — legitimately repeat across companies. A cuid does not, and per-tenant
scoping here would buy nothing while implying two tenants might share a sales
order id. The foreign key still cannot cross a tenant boundary: RLS `WITH CHECK`
sees to that, and a test proves it.

#### Files
`packages/db/prisma/schema/{erp,builder}.prisma`,
`apps/website-builder/src/lib/erp/from-sale.ts`,
`src/app/api/storefront/[tenant]/orders/route.ts`,
`test/erp/order-split.test.ts` (new — the one contract file with no ERP
ancestor, because the case could not exist before).

#### Migration
M-05. Additive: one column, one unique index, one foreign key. DDL rendered and
read before applying. RLS re-verified — 47 tables, 9 preflight checks.

#### Risk
Phase 5 is done. The ERP's SPA is still Phase 6, and `apps/erp` still runs
standalone — it is now a UI in front of an API that has been superseded, and
retiring it is Phase 6's first act, not this phase's.

**Verified live, each file on its own:** access 62/62 · orders 38/38 ·
validation 29/29 · listing 25/25 · catalog 31/31 · delivery 20/20 ·
integrations 22/22 · order-split 8/8 — **235/235**. Storefront 22/22 unaffected.

---

### 5.3 (part 3) Sales channels, webhooks, AI and follow-up — the surface is complete

`integrations.test.ts` goes 0 -> **22/22** and `access.test.ts` 48 -> **62/62**.
Every one of the 227 ported contract tests now passes.

#### D-05.5 — the webhook URL had to gain a tenant

The ERP's endpoint was `/webhook/store/:storeId`, and Phase 5.1 wrote the
contract test in that shape. It cannot work here: `SalesChannel` is
tenant-scoped and carries RLS, so an unbound client reads **nothing** from it —
a channel id alone cannot be resolved before a tenant is bound, and the lookup
and the binding are circular.

Reading the channel with the migration role would bypass RLS, and making that
exception on the one endpoint a stranger can reach is the worst possible place
for it. An unscoped token table — the way `Session` is looked up by token hash
before a tenant is known — is genuinely good and costs a migration plus a second
mechanism doing what the URL already can. The path carries the tenant instead,
exactly like `/api/storefront/[tenant]/...`, which is what this platform already
does for every anonymous tenant-scoped endpoint.

The slug identifies; it does not authorise. Knowing it gets a caller as far as
the signature check and no further. The test file records the change and why.

#### SEC-04, fail closed

`verifySignature` returns a verdict for every combination rather than falling
through any of them — the original bug was `if (secret && sig)`, so omitting the
header skipped verification entirely, and an empty string did too. The HMAC is
computed over the RAW bytes: re-serialising parsed JSON changes key order and
whitespace, fails genuine webhooks, and the usual fix for that is to stop
verifying.

Everything answers **200**. A rejected payload is acknowledged, not refused:
platforms retry non-2xx with backoff and eventually disable the endpoint, so a
401 punishes the tenant whose integration then stops working while telling the
forger which guess was wrong. Nothing is written and no signal is given.

#### SEC-03, and the clamp is a route now

The AI surface is behind `tenantRoute`, including the streaming endpoint that
was unauthenticated and — with `agentId` omitted — fell back to an assistant
holding every permission including `read_customers`.

An assistant's stored permission list is a **request, not a grant**. What it
gets is the intersection with what the CALLER already holds, so an assistant
cannot become a way to exceed your own access by asking a model to fetch what
you could not fetch yourself — a particularly bad route, because the answer
arrives as prose with no audit trail. `read_analytics` maps to `erp:finance:read`
and is therefore unreachable for an agent (D-05.1); `read_customers` does not,
because an agent needs the phone number and their orders are already scoped.

The ERP could only assert the clamp at unit level, because its HTTP surface
never exposed the resolved set — the one security boundary in the feature was
untestable from outside. `GET /api/erp/ai/permissions` returns it.

#### Two boundaries recorded rather than implemented

`POST /api/erp/agents` exists and is gated, but answers 501: adding a person to
the company is a PLATFORM action. The ERP's version created an account because
the ERP owned identity; it does not any more (M-02), and routing it through a
product would give every product a way to create accounts in every other one.
The route exists rather than 404ing because the authorization contract has to be
complete — a refusal is a stronger, testable statement than an absent path.

`ai/chat`, `ai/chat/stream` and `ai/insights/deep` answer 501 for the same
reason: calling a model is deployment configuration, not a port, but leaving
those paths unrouted would put a hole in the "every AI route requires a session"
contract exactly where the original vulnerability was.

#### One harness change

`erp:ai:use` joined the ERP agent's explicit grants. No role glob reaches a
`:use` action — `*:*:read` and `*:*:write` do not match it — so without it an
agent gets 403 on the whole AI surface, which is a different product from the
one being ported. `erp:clients:read` and `erp:finance:read` are still absent,
which is what makes the permission clamp observable.

#### Files

`src/lib/erp/webhooks.ts`, `webhook-route.ts`, `ai.ts`;
`src/app/api/erp/sales-channels/*`, `webhooks/[tenant]/*` (4 routes),
`ai/*` (8 routes), `followup/*` (2 routes), and a gated `POST` on `agents`.

#### Migration

None.

#### Risk

Phase 5.4 (M-05, the SalesOrder/FulfillmentOrder relationship) is the only part
of Phase 5 still outstanding. The 501 routes are deliberate and named above.

**Verified live, each file on its own:** access 62/62 · orders 38/38 ·
validation 29/29 · listing 25/25 · catalog 31/31 · delivery 20/20 ·
integrations 22/22 — **227/227**.

---

### 5.3 (part 2) Carriers, shipments, and BUG-02's write

`delivery.test.ts` goes 0 -> **20/20** and `access.test.ts` 45 -> **48/62**.

#### The write that was missing

`deliveryOutcome` and `deliveryOutcomeAt` were READ in eight places in the ERP
and WRITTEN in none. Nothing errored. The profit calculator, delivered-pay
payroll, customer lifetime spend and product revenue were all permanently zero,
and every screen rendered perfectly while showing a company that had apparently
never sold anything. `lib/erp/shipments.ts` is the write; everything downstream
already read the column, which is exactly why the defect stayed invisible.

Settled **once**, from the carrier's own event time. Later polls cannot move it,
so a corrected feed cannot silently rewrite last quarter's revenue; and the
moment is the carrier's, not the clock's, so a backlog replayed a week late does
not book every delivery into the wrong period.

#### The mock carrier's state had to move

The ERP held each parcel's progress in a module-level `Map` keyed by tracking
number - fine for one process, wrong twice over here: lost on every deploy, and
two instances would disagree about the same parcel. Progress is derived from the
stored event history instead. The parcel is at step N because N events exist,
which is true in any process and survives a restart.

#### Three defects the tests caught, in order

**Event times from `Date.now()` defeated the idempotency key.** Each poll
produced fresh timestamps, so `(shipment, eventTime, originalStatus)` never
matched and the timeline doubled on every refresh. Anchored to the booking time
instead.

**Catching P2002 inside a transaction does not work.** A unique violation
ABORTS the surrounding Postgres transaction, so every statement after the first
duplicate fails with 25P02 - and `withTenant` has already opened that
transaction, so there is no smaller scope to lose. Replaced with
`createMany({ skipDuplicates: true })`, which is `ON CONFLICT DO NOTHING` and
does not abort.

**A minute between steps put "delivered" five minutes in the future.** Every
report downstream filters by a date range ending now, so the parcel settled
while payroll and product revenue still showed zero - BUG-02's exact symptom,
reproduced by the simulator built to prove BUG-02 was fixed. One second between
steps.

#### And one process defect worth recording

Twice, a rebuild was verified against the **previous** build: the old server
still held :3000, the new `next start` lost the port race silently, and
`/api/health` answered 200 from the stale process. It cost a full debugging
cycle chasing a bug that was already fixed. `next start` serves a prebuilt app -
stop node, build, start, in that order, every time. NEXT_STEPS now says so.

#### Ported

Carrier CRUD with secrets masked on read and preserved when the mask is sent
back; per-tenant status mappings; the mock adapter; shipment booking, idempotent
event intake and settlement; auto-booking on confirm; and the product sales
summary, which costs delivered units from what the FIFO movements actually
recorded rather than from today's purchase price.

#### Files

`src/lib/erp/carriers.ts`, `src/lib/erp/shipments.ts`;
`src/app/api/erp/carriers/*` (4 routes), `orders/[id]/shipment` and
`shipment/refresh`, `products/[id]/sales-summary`.

#### Migration

None.

#### Risk

Sales channels, inbound webhooks, follow-up and the AI surface remain unbuilt -
the 14 remaining `access.test.ts` failures name exactly those, and
`integrations.test.ts` is still red.

**Verified live, each file on its own:** delivery 20/20, catalog 31/31,
orders 38/38, validation 29/29, listing 25/25, access 48/62. Running several
files back to back still trips the documented Neon connection limit.

---

### 5.3 (part 1) Products, inventory, agents and the books

Four more surfaces on the platform, each verified against a running server
rather than a compiled one. `catalog.test.ts` goes 0 → **31/31** and
`access.test.ts` 34 → **45/62**.

#### FIFO, and the lock the ERP did not have

Purchase prices move. A variant restocked twice at 1,000 and 2,000 does not have
"a" cost — it has two, and which one a sale consumed decides whether that sale
made money. That is why `StockLot` exists and why every consuming movement
records exactly which lots it drew from.

The part that is easy to get wrong, and is asserted by a test that cancels an
order: a cancellation returns stock to the **same** lots the original
reservation consumed, read back from `MovementLotConsumption` — not to the
newest lot, and not to the cheapest. Anything else silently rewrites the cost
basis on every cancellation and the profit calculator stops being true without
a single error.

**`SELECT … FOR UPDATE` on the lot rows before planning against them.** The ERP
planned and adjusted in two steps with no lock: correct under SQLite's single
writer, a lost update on Postgres. Two orders confirming the same variant at
once both read `qtyRemaining = 5`, both take 5, and ten units are sold from a
batch of five. NEXT_STEPS flagged this class explicitly; this is the fix.

#### D-05.4 — where per-member ERP data lives

The ERP's `agents` table became User + Membership in M-02, but a few of its
columns were never about identity: pay rates, weekly days off, the missed-order
counter. Columns on `Membership` were rejected outright — that is a PLATFORM
model and it must never learn what an ERP payroll rate is, or the table grows a
section per product. A dedicated ERP table was rejected as a migration, an RLS
policy and a foreign key into platform identity for a small bag of settings.

They live in `ProductSetting`, keyed `agent:<userId>` — the table that exists
precisely so a product can store configuration without a new one, already
tenant-scoped and RLS-covered. A tenth product needing per-member configuration
uses it unchanged.

#### Rules that came across because they are the design

- **Archive, not delete.** A product is referenced by every order that contained
  it and by its own ledger; deleting it either cascades that history away or
  leaves it pointing at nothing.
- **Financial records are INSERT-ONLY.** Saving a period twice inserts; the older
  row stays as a record of what the business looked like AT THE TIME. A manager
  who recalculates March in June wants both answers, because the difference is
  usually a returned parcel and worth explaining.
- **`netProfit` is derived, never taken from the request.** A test posts
  `netProfit: 999999` and expects 37000 back.
- **Unexpected charges ARE deletable**, unlike the records beside them. A saved
  P&L is a statement somebody made; a van repair typed in wrong is data entry.
- **Low stock is evaluated per VARIANT.** A shoe with 200 units is not fine if
  199 of them are size 45.
- **Suspension takes effect on the next request** — the reason M-09 chose
  server-side sessions. Suspending yourself, and suspending the owner, are both
  refused: the first ends the session doing the suspending.

#### Files
`src/lib/erp/inventory.ts`, `src/lib/erp/agents.ts`;
`src/app/api/erp/products/*` (7 routes), `inventory/low-stock`,
`agents/*` (6 routes), `financial-records/*`, `unexpected-charges/*`.

#### Migration
None. Schema unchanged since 5.2.

#### Risk
Carriers, shipments, sales channels, webhooks and the AI surface are still
unbuilt — the 17 remaining `access.test.ts` failures name exactly those, and
`delivery.test.ts` and `integrations.test.ts` are still red for the same reason.

**Verified live:** catalog 31/31, orders 38/38, validation 29/29, listing 25/25,
access 45/62.

---

### 5.2 The data layer, and three things the tests found first

`apps/erp/lib/db.js` is 3,568 lines and ~130 exported functions over 14 domains.
This milestone ports the foundation and the first vertical slice — orders,
customers, settings, audit — end to end: repository **and** routes, so every
claim below is checked against a running server rather than a compiled one.

**Sequencing changed, deliberately.** NEXT_STEPS had 5.2 build every repository
and 5.3 add every route. Done that way nothing is verifiable until both finish,
which is the exact position PROJECT_STATE warns about twice. Vertical slices
mean each commit has passing tests behind it.

#### D-05.1 resolved — the customer registry and the books are not ordinary reads

`*:clients:read` and `*:finance:read` joined `SENSITIVE` in
`packages/auth/src/rbac.ts`. The ERP treated both as manager-only; the
platform's `*:*:read` glob would have handed every customer's phone number and
lifetime spend, and the company's P&L, to every member of the tenant. Stated as
product-agnostic globs like every other rule there, so a tenth product inherits
it. A `MANAGER` now needs them by name — the accepted cost, and it reads
correctly.

#### D-05.2 — the id scheme raced

The ERP numbered orders by counting rows and probing upward for a free slot.
Two concurrent creates read the same count and race for the same primary key —
invisible under SQLite's single writer, a question of load on Postgres. Now one
atomic increment on a per-tenant `TenantSequence` row. Postgres sequences were
rejected: they are global objects, so per-tenant numbering would mean creating
DDL at signup that the application role deliberately cannot perform.

#### D-05.3 — and then the ids collided, which is why the tests moved first

`ORD-0042` was the ERP's **primary key**. That cannot survive multi-tenancy:
`id` is a global unique index, so the second tenant to create their first order
collides with the first tenant's `ORD-0001` and the insert fails outright.

It was found by a contract test creating an order in a second tenant, before
any of it shipped — which is the entire argument for Phase 5.1 landing before
Phase 5.2, demonstrated rather than asserted.

Resolved by splitting the two roles the column was doing: `id` is a cuid,
`reference` is `ORD-0042` and unique **per tenant**. A global counter was
rejected because the gaps would be a live readout of how much business a
neighbouring tenant is doing; a compound primary key was rejected because it
drags compound foreign keys through every relation pointing at an order.

#### Ported

`src/lib/erp/` — ids, phone normalisation, Decimal/BigInt serialisation, the
record-level order scope, the per-order ownership guard, ERP settings on
`ProductSetting`, the order repository and the customer registry.

Three behaviours came across unchanged because they are the design:

- **Lifetime counters are EVENT counts, not snapshots.** `confirmedOrders` does
  not go back down when an order is later cancelled. Making them agree with a
  live `COUNT(*)` looks like a bug fix and destroys the history.
- **Deleting an order never touches the customer record.**
- **`suspicious` is a nullable Boolean.** null means "not evaluated", which is
  what a standalone note is; folding it to false reclassifies unassessed history
  as clean.

And one changed on purpose: the counters use `increment` — `SET x = x + 1` in
SQL — where the ERP read the row, added one and wrote the total back. Safe under
a single writer, a lost update the moment two webhook deliveries for one
customer land together, which is the ordinary case.

#### Two defects avoided by writing them down

**BigInt throws.** `JSON.stringify(1n)` is a TypeError, not a fallback, and six
ERP models use BigInt ids. Any route returning one would 500 on its first real
request. `toJson` handles it centrally.

**`(db as any)` was never necessary.** Probed it: `db.fulfillmentOrder` typechecks
on `TenantDb` today. Those casts are what hid the nested-`$transaction` bug in
Phase 4.4. The entire ERP layer is written without one.

#### Files
`packages/auth/src/rbac.ts` + tests (32 → 36).
`packages/db/prisma/schema/platform.prisma` — `TenantSequence`.
`packages/db/prisma/schema/erp.prisma` — cuid defaults on 10 models,
`reference` on `FulfillmentOrder` and `CatalogProduct`.
`packages/product-registry/src/manifests.ts` — `erp:settings:write`,
`erp:audit:read`, `erp:products:read`, `erp:finance:write` declared.
`apps/website-builder/src/lib/erp/` (8 modules), `src/app/api/erp/` (13 routes),
`src/lib/api/route.ts` — `apiError` gained a machine-readable `extra`.

#### Migration
Additive only: two `ADD COLUMN`, two `CREATE UNIQUE INDEX`, one new table. DDL
rendered and read before applying. RLS re-applied — **47 tables**, up from 46,
and preflight's 9 checks pass.

#### Risk
Only orders, clients, settings and audit exist. `access.test.ts` is 34/62
because 28 of its assertions name routes Phase 5.3 has not built —
products, inventory, carriers, shipments, finance, agents, follow-up, AI. That
count is the remaining scope, stated rather than hidden.

**Verified against a running server:** orders 38/38, validation 29/29,
listing 25/25 — 92/92 on the built surface. auth 36, product-registry 36, db 29.

---

### 5.1 The ERP's tests move first (M-18)

The ERP's 298 tests are the only meaningful coverage the more complex of the two
products has. They move **before** any ERP logic, so the routes written in 5.3
are written against a contract that already exists rather than the contract
being written afterwards to describe whatever got built.

#### What ported, and what deliberately did not

227 tests across seven files, plus `test/erp/PORTING.md` recording every
decision — including the ones where the answer was no. A test dropped without a
recorded reason is indistinguishable from a test that was forgotten, and three
of the thirteen source files genuinely do not port:

`indexes.test.js` is `EXPLAIN QUERY PLAN` against SQLite's `sqlite_master` and
`packages/db` already asserts the Postgres equivalent. `backfill.test.js` is a
one-time migration that M-06 has already performed and that cannot run again.
`harness.test.js` tests the child-process SQLite harness itself — the platform
harness spawns nothing and has no write-ahead log.

Two more are **deferred with the migration that unblocks them**, not abandoned:
`notifications.test.js` (~20 tests) and `overdue-sweep.test.js` (~12) wait on
M-16 and M-15. Porting them against a transport and a worker that do not exist
would encode a contract nobody has designed yet, and getting that wrong is worse
than the stated gap.

#### The port found a collision the code could not

**D-05.1 — the ERP's manager/agent split does not survive the role globs.** The
ERP treated the customer registry and the finance screens as manager-only and
asserted it directly. On the platform, `MEMBER` and `VIEWER` both carry `*:*:read`,
which grants `erp:clients:read` and `erp:finance:read` to every member of the
tenant — every customer's phone number and lifetime spend, and the company's
profit and loss, handed to a confirmation agent. That is precisely the exposure
SEC-02 closed.

Neither system is wrong. It is two authorization models meeting: the ERP's was
binary and hand-listed, the platform's is a glob over a vocabulary products
declare. **Nothing detects the collision except a test that knew the old
boundary** — which is the entire argument for moving the tests first, and it
paid for itself before a single route was written.

The affected tests assert the ERP's boundary and are marked `D-05.1` in place.
They fail until 5.3 decides. Recommendation, recorded in PORTING.md: add
`*:clients:read` and `*:finance:read` to `SENSITIVE` in `packages/auth/src/rbac.ts`,
which is product-agnostic and already exists for exactly this class.

#### Two guarantees left the ERP and have no platform home yet

Both were real and tested in the ERP: the **cross-origin state-change refusal**
(`CSRF_ORIGIN` — CORS stops an attacker reading a response, not the request
happening) and **rate limiting** (per-IP and per-account login throttling,
case-insensitive so casing cannot reset the counter, plus an API backstop that
exempts the event stream and inbound carrier webhooks). Neither belongs in a
product suite; both are now recorded gaps rather than lost ones.

#### The suite states its own absence

The harness probes `/api/erp/orders` on start-up. An unmatched Next route is a
404 and a mounted `tenantRoute` without a session is a 401, so that one
difference is the whole probe — no health endpoint to remember to add. Until
5.3 the suite skips with the reason printed; `ERP_CONTRACT=strict` turns the
skip into a failure, which is what CI should do from the moment 5.3 starts.

Each test is skipped individually rather than by skipping its `describe`,
because node reports a skipped suite as `tests 0` — the ported tests would
vanish from the run rather than appear as skipped, and nobody could tell from
the output whether the directory held 227 tests or none. It reports
`tests 227, skipped 227`.

#### Files
`apps/website-builder/test/erp/` — `PORTING.md`, `helpers.ts`, and
`access`, `orders`, `validation`, `catalog`, `listing`, `delivery`,
`integrations` `.test.ts`.
`apps/website-builder/package.json` — the test glob became `test/**/*.test.ts`.
Passing two separate glob arguments to `node --test` did **not** union them and
silently ran only the first, which would have left the entire directory
unexecuted while the run looked healthy.
`apps/website-builder/tsconfig.json` — `allowImportingTsExtensions`, because
Node's native type stripping requires the extension on a relative import and the
workspace packages already re-export that way. Safe under `noEmit`. Incidentally
cleared 10 pre-existing errors (99 → 82).

#### Migration
M-18. No schema change, no runtime change.

#### Risk
The suite is skipped, so it proves nothing until 5.3 mounts the routes — which
is the point, but it means the contract is currently a claim rather than a
verified fact. The counting fix and `ERP_CONTRACT=strict` exist so that stays
visible. Suite totals unchanged where they run: website-builder 101 pass, db 29,
and the 227 ported tests reported as skipped.

---

## Phase 4 — One front door

### 4.4 The builder moves onto the platform

Every builder screen and API route now runs on the shared shell, the unified
schema and the platform session. The legacy dashboard is untouched and still
responding, as required.

#### What measuring first changed
Eleven of the thirteen dashboard pages turned out to be **client components
that fetch `/api`**. The port was therefore overwhelmingly an API-layer job,
and the pages followed their data — a very different plan from the
page-by-page rewrite the phase description implied.

#### One abstraction, deliberately
`tenantRoute(permission, handler)` resolves the session, refuses without an
active tenant, checks the permission, and runs the work bound to that tenant.
Thirty routes writing that by hand is thirty chances to forget the binding —
and forgetting it does not fail loudly, it returns an **empty list**, because
row-level security denies by returning no rows. The permission is a parameter
and nothing in it knows which products exist.

#### Ported
**21 API routes** — landings and all eight editor sections, categories, sales
orders with the state machine, abandoned checkouts, store settings, delivery
prices, themes, and webhooks + Meta pixels as **platform** surfaces.
**9 screens** — builder overview, pages, orders, order detail, categories,
abandoned, page creation, and the landing editor; plus platform settings:
index, profile, store profile, delivery prices, integrations.

**79 end-to-end tests**, every one attacking a boundary rather than trusting
it. Not one ported route contains `where: { tenantId }` — the binding does it
and the database enforces it, which is only worth claiming because the tests
try to break it from every direction.

#### The rules came across with the data
A port that keeps the shape and drops the rules is not a port. Each is asserted
by violating it: an old price at or below the current one, a duplicate variant,
a rating outside 1–5, hiding a field the courier needs, leaving a product with
no delivery method, publishing something with no title or price, and every
illegal order transition including re-opening a cancelled one.

#### The editor was moved, not rewritten
54 components and ~5,000 lines. `BuilderApiProvider` injects the API base, so
the same files serve both mounts — legacy on `/api/landings` under its JWT,
console on `/api/builder/landings` under the platform session. The default is
the legacy path, so mounting in the console was an addition rather than an edit
to something working. When the legacy dashboard retires, this collapses to a
constant.

#### Defects found
**Nested `$transaction` threw at runtime.** `withTenant` has already opened one
and Prisma does not nest, so the client it returns has no `$transaction` at
all. The `TenantDb` type says exactly this — the `as any` casts used to reach
dynamic models defeated the check that would have caught it at compile time.

**The platform connection was not using Neon's pooler.** `setup-roles` derived
the app URL from the owner URL *after* converting it to the direct endpoint, so
every request — dev server and every parallel test process — went through the
endpoint with the hard connection cap. It presented as an intermittent "Can't
reach database server" that looked exactly like a flaky isolation test, which
is the worst way for a misconfiguration to appear. Both URLs now derive from
the original and each states its endpoint.

**Reference data was never restored after the 3.3 reset.** 58 wilayas and 537
baladias. Checkout resolves a delivery price by wilaya, so an empty table means
an order form that renders perfectly and offers nowhere to deliver to. A test
asking for the wilaya list surfaced it; `seed:reference` now owns it.

**`/api/landings/[id]/delivery-prices` is dead code.**
`db.landingDeliveryPrice` is `undefined`, so it throws on every call. Nothing
references it — per-landing prices were superseded by global ones.

**A nav bug only real rendering caught.** Every item whose href prefixed the
current path was marked `aria-current`, so "Overview" was highlighted on every
screen.

#### Still on the legacy stack
The **public storefront** — `/l/[slug]`, category pages, checkout, draft-order
capture — and the legacy auth routes that serve it. These are customer-facing
and move in 4.5 along with tenant-aware public routing (M-17).

**Suite totals.** ERP 298 (297 pass, 1 skipped) · website-builder 79 · auth 32
· db 29 · i18n 18 · product-registry 36 · ui 26.

---

## Phase 3 — Platform foundations

### 3.3 Tenant isolation, verified against a real database

The first milestone validated against live PostgreSQL 18.4 rather than offline.

#### R-05 resolved — and it needed a second database role
**What.** Prisma can bind a tenant per transaction. Nine preflight checks pass.
**Why it took a probe.** The first run failed **five of five** isolation checks,
and the cause was not Prisma: Neon's default role, `neondb_owner`, carries
`BYPASSRLS`. A role with that attribute ignores row-level security entirely —
`FORCE ROW LEVEL SECURITY` does nothing and policies are never consulted. Had
the probe been skipped, the isolation suite would have gone green while
enforcing **nothing**, which is the exact false-confidence failure R-01 exists
to prevent and strictly worse than having no suite at all.
**Resolution.** Two roles, which production needed anyway:
`neondb_owner` for migrations and DDL (owns the tables, never serves a
request), and `landingos_app` for everything the application does —
`NOBYPASSRLS`, owner of nothing, so RLS genuinely applies.
**Files.** `scripts/preflight.ts`, `scripts/setup-roles.ts` (both new).
**Note.** The attributes are *verified*, not asserted: Postgres allows only a
superuser to change `SUPERUSER` or `BYPASSRLS` — even to turn them off — so an
`ALTER ROLE` fails against any managed provider. `CREATE ROLE` already defaults
to both being off.

#### Two findings that would otherwise have been silent
**Writes were not constrained.** A policy with only `USING` governs what a
tenant can *see*. Without `WITH CHECK`, tenant A can `INSERT` a row stamped
with tenant B's id — invisible to A afterwards, and very visible to the victim.
Every policy now carries both clauses.

**`SET` would have leaked across the connection pool.** A bare `SET`, or
`set_config(..., false)`, persists on a pooled connection, so the next request
to borrow it reads another tenant's rows. `set_config(..., true)` gives true
`SET LOCAL` semantics; proven not to survive its transaction, and proven again
under concurrency by the isolation suite.

#### Layer 3 — row-level security (M-07)
**What.** `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy
with `USING` and `WITH CHECK` on **all 46 tenant-scoped tables**.
**Why derived, not listed.** `scripts/apply-rls.ts` discovers the tables from
the live database by looking for a `tenantId` column, so a table added by a
later migration is covered the next time it runs rather than only if someone
remembers. It refuses to finish if a table has no `tenantId` and is not on an
explicit, justified exemption list.
**Not scoped, by design.** `Tenant`, `User`, `Session` — all three are part of
resolving *who the caller is*, which necessarily happens before a tenant is
known — and `Wilaya`, `Baladia`, which are platform reference data shared by
every tenant.

#### Layer 2 — the tenant-bound client
**What.** `src/tenant-client.ts` — `withTenant()`, `forTenant()`,
`asPlatform()`.
**Why it exists at all, given layer 3.** "The database refused" is a 0-row
result, not an error. Without this layer a forgotten filter is a page that
silently renders empty rather than a bug anyone notices.
**What it deliberately does not do.** It does not add `where: { tenantId }`.
That would be a second, weaker copy of a rule the database already enforces,
and the two would eventually disagree. The tenant binding *is* the filter.
Cross-tenant work goes through `asPlatform()` — named so it cannot appear in a
diff unnoticed.

#### R-01 — the isolation suite
**What.** 18 tests covering structural and behavioural isolation: every scoped
table checked in `pg_catalog`; reads, writes, updates, deletes and tenant
reassignment attempted across the boundary; raw SQL (where layer 2 does not
apply); a deliberately hostile `WHERE 1=1 OR tenantId = '<other>'`; sequential
and **concurrent** interleaved access; and per-tenant uniqueness — two tenants
holding the same landing-page slug and the same customer phone number.
**Verified to fail.** Disabling RLS on a **single** table trips **10 failures**
across every category. A green isolation suite that cannot go red proves
nothing, so this was checked rather than assumed.

#### The development database was not empty
**What.** The provided Neon database held the deployed website-builder's
pre-tenant schema and 783 rows, including **12 orders with real customer names,
phones and addresses**. `prisma db push` refused, since `tenantId` cannot be
added to populated tables without a default.
**Resolution.** Surfaced with alternatives (a Neon branch, a second database);
the user confirmed the data was disposable and consented explicitly to the
reset. All 783 rows were exported to the scratchpad first, so the content
survives even though the database did not.
**Risk.** A credential for this database was accidentally printed into the
working transcript during inspection. **It must be rotated**, along with the
`AUTH_SECRET` and `DATABASE_URL` still sitting in 8 commits of imported
website-builder history.

#### Applied schema
51 tables, 157 indexes, 8 enums live. The offline predictions held: **37
numeric money columns, 0 `double precision`**, 46 tables carrying `tenantId`.

**Suite totals.** ERP 298 (297 pass, 1 skipped) · db 29 · product-registry 35.

---

### 3.2 Unified schema (`packages/db`)

One Prisma schema for the whole platform: **51 tables, 87 indexes, 36 foreign
keys, 8 enums**. Split across a schema folder by domain — `platform` (10
models), `builder` (19), `erp` (22) — because one file for fifty models is one
nobody reads twice. Neither application is wired to it; that is 3.3 and later.

#### Platform models (M-01)
**What.** `Tenant`, `TenantDomain`, `User`, `Membership`, `Session`,
`Invitation`, `Subscription`, `AuditEvent`, `Notification`, `ProductSetting`.
**Why two of those are load-bearing.**

`User` is **global**, not per-tenant — one person, one login, however many
companies they belong to. That is what lets a session switch tenants without
signing in again, and it replaces both the builder's single-row `Admin` and the
ERP's `agents.name` TEXT primary key. Supporting a user in two companies costs
nothing now and is close to impossible to retrofit once `userId` and `tenantId`
have been conflated across forty tables.

`Subscription.entitlements` is a **string set**, not a boolean column per
product. A column per product is exactly the hardcoding the platform must not
do: a tenth product would need a migration, and "any combination of products"
would become 2ⁿ schema states instead of a set.

#### ERP domain ported from SQLite (M-06)
**What.** 27 SQLite tables became 22 models. Five did not survive, each for a
stated reason: `agents` and `sessions` are superseded by `User`/`Membership`/
`Session` (M-02); `audit_log` by the platform `AuditEvent`; `notifications`
moved to the platform, where the vision puts them and where the builder can
reach them; `settings` became `ProductSetting`, keyed by product so a tenth
product stores its configuration without a new table.

**Type conversions.** `REAL` → `Decimal`, `INTEGER` epoch-ms → `DateTime`,
`0/1` → `Boolean`, JSON-in-`TEXT` → `Json`, `AUTOINCREMENT` → identity. Verified
in the generated DDL: **0 `DOUBLE PRECISION` columns, 37 `DECIMAL`**. Money no
longer touches binary floating point anywhere — which mattered most in the FIFO
cost lots and margin calculations that feed permanent financial records, where
float drift compounds.

**Identity.** The ERP referenced people by NAME (`agent`, `actor`, `actorName`)
because `agents.name` was a primary key. Every one is now a user id. Where the
column records who did something in an append-only history, it is a plain id
with **no foreign key** — that history must stay readable and truthful even if
the user row is later purged, and a cascade or a SetNull would quietly rewrite
the past.

**Renames.** Three SQLite names were ambiguous on a platform and would mislead:
`products` → `CatalogProduct` (on this platform "product" also means an
application module), `providers` → `Carrier` (the AI provider registry sits
beside it), `stores` → `SalesChannel` (the builder's `StoreSettings` is a
different thing entirely).

#### M-04 — every unique constraint has a recorded decision
**What.** `CONSTRAINTS.md` gives a verdict for every unique constraint in either
product — *per-tenant*, *platform-global*, or *public-namespace* — with the
reasoning, and `test/constraints.test.ts` asserts the schema matches.
**Why.** The architecture called a missed constraint the subtlest failure mode
in the programme and committed to a mitigation that is *mechanical, not
vigilant*. This is that mechanism: it asserts every business model has a
`tenantId`, every unique is scoped or explicitly exempted, every index leads
with `tenantId`, no column is `Float`, and no timestamp is an integer.
**Verified to bite.** A globally-unique slug trips two assertions and a `Float`
money column a third. It also caught a real omission during this work —
`PushSubscription.endpoint` was documented as deliberately global but missing
from the allow-list.

The most dangerous one in the port is `Client.phone`, now
`@@unique([tenantId, phone])`. Two tenants will absolutely have a customer with
the same number; left global, the second tenant either cannot create the client
or merges into the first tenant's record and reads their order history.

#### Decisions the merge forced earlier than the roadmap scheduled
**Order naming.** Both products have a model called `Order` and one schema
cannot hold two, so the M-05 *names* land now: `SalesOrder` (immutable
commercial snapshot) and `FulfillmentOrder` (mutable operational record). Only
the names. The relationship between them, and replacing the webhook with an
in-process domain event, stay in Phase 5.4 — adopting the target names now
avoids renaming every reference twice.

**Notification placement.** Not forced by a collision, and worth flagging as a
judgement call: it sits in `platform.prisma` because the vision names
notifications a shared service, the builder has none, and the ERP's table was
already product-agnostic in shape. Only the table is placed — unifying the SSE
and Web Push channels is S-06 in Phase 7.4.

#### Verification
**No Postgres on this machine**, so the schema is verified two ways that need no
database: `prisma validate`, and `prisma migrate diff --from-empty` rendering
the whole schema to real DDL. A schema that produces valid `CREATE TABLE` output
is a schema that can be deployed. **What is still unverified: the schema has
never been applied to a live Postgres, and no query has ever run against it.**
- `packages/db` — 11 tests, schema validates, DDL generates.
- ERP — 298 tests, 297 pass, 1 skipped, 0 failures. Unchanged.
- product-registry — 35/35.
- website-builder — still builds, all 34 pages.

---

### 3.1a Made the test suite a reliable gate

#### The harness left write-ahead logs unrecovered
**What.** `startServer().stop()` now resolves only once the server process has
actually exited, and then folds that server's WAL back into its database file.
**Why.** Two defects, one visible consequence.

`stop()` resolved on a 3-second timer whether or not the child had exited, so a
test could begin reading a database another process was still writing to. That
3s was also shorter than the server's own 8-second shutdown cap (`index.js`),
so the escalation could SIGKILL it partway through the `wal_checkpoint(TRUNCATE)`
that keeps the file clean.

More important, the checkpoint cannot be relied on at all: on Windows
`child.kill()` maps to `TerminateProcess`, so the SIGTERM handler never runs and
the `-wal` file is always left needing recovery. That matters because **seven
test files reopen the database after stopping a server, and nine of those opens
pass `{ readonly: true }`** — and a readonly SQLite connection *cannot* recover
a WAL, because replaying the log needs write access. A database left mid-log
fails to open, which better-sqlite3 reports as `SQLITE_ERROR`.

Usually the log is empty, or SQLite's auto-checkpoint has already folded it in,
and nothing is noticed. It takes enough unflushed frames at the moment of the
kill — which is exactly why the only file ever seen to fail was
`indexes.test.js`, the one that seeds 800 orders.

**Files.** `apps/erp/test/helpers.js`, `apps/erp/test/harness.test.js` (new).
**Migration.** None. No test logic changed: the fix is in the harness, so all
nine call sites are covered without any of them being edited.
**Risk.** Low. `stop()` can now reject if a process survives SIGKILL, which is a
real problem worth surfacing loudly rather than resolving and letting a later
test fail somewhere that explains nothing.

**Honesty about what this proves.** The original failure was never reproduced —
8 full runs, 72 stress iterations at 6-way concurrency, and 4 isolated runs of
the offending file all stayed green, and the one observed failure coincided with
a fresh `npm install` still churning I/O. So this is not a fix verified against
a reproduction. What it is: a real, demonstrable defect, consistent with the
observed error code and with why that particular file was the one to fail. The
new `harness.test.js` assertion that no WAL is left needing recovery **fails
against the pre-fix harness and passes after**, so the defect itself is proven
and now guarded. Post-fix the full suite ran clean 10 times out of 10.

#### Tests for the harness itself
**What.** `apps/erp/test/harness.test.js` — 5 tests covering the two guarantees
`stop()` makes: the process is really gone, and the database it leaves behind
opens cleanly for any later connection including a readonly one.
**Why.** This suite is the gate for every milestone in the platform work, so the
thing the gate is built on needs its own coverage. Its absence is why a harness
defect spent this long looking like a bug in the code under test.

**Suite total.** 298 tests, 297 pass, 1 skipped, 0 failures.

---

### 3.1 Monorepo foundation

Goal: one workspace holding both products, with no business logic changed and
no regressions. Multi-tenancy is explicitly **not** started here.

#### The repository became an npm workspace
**What.** The root is now a private workspace over `apps/*` and `packages/*`.
The ERP moved from the repository root to `apps/erp`; the website-builder was
imported into `apps/website-builder`.
**Why.** No shared package can exist until there is somewhere for it to live.
Everything from Phase 3.2 onward (`@landingos/db`, `@landingos/auth`,
`@landingos/ui`) depends on this.
**Files.** `package.json` (new root), `apps/erp/**` (moved), `apps/website-builder/**`
(imported), `.gitignore`, `apps/erp/.gitignore` (new).
**Migration.** None — no schema, no data, no business logic touched.
**Risk.** Low, and verified: the ERP needed **zero source changes**. `lib/db.js`
derives its data directory from `__dirname` and `test/helpers.js` resolves the
server it spawns the same way, so both followed the move unaided.

#### Both histories preserved
**What.** The website-builder came in via `git subtree add`, carrying all 65 of
its commits rather than landing as one opaque snapshot. The ERP's 57 files were
moved with `git mv` and are recorded as renames.
**Why.** Losing history on either side would make every future `git blame` on
this codebase useless — during the phase where the most code gets rewritten.
**Note.** `git log --follow` does not cross the subtree boundary. Pre-merge
builder history is reached from the merge's second parent:
`git log 8008b92^2 -- <path/inside/the/old/repo>`.

#### Ignore rules split by product
**What.** The root `.gitignore` now carries only universal patterns; product
-specific rules live in `apps/<product>/.gitignore`.
**Why.** Not tidiness. Ignore patterns match relative to the file declaring
them, so a root pattern reaches into every product that will ever exist. The
builder's `.gitignore` carries a bare `test` pattern — at the root it would
have untracked the ERP's entire 293-test suite silently, with no error and no
diff.
**Files.** `.gitignore`, `apps/erp/.gitignore` (new), `.dockerignore` (new, root).
**Risk.** This class of mistake is invisible until something is missing.

#### A tracked secrets file was carried in, and untracked
**What.** `apps/website-builder/.env` was **tracked** in the source repository —
committed before the `.env*` rule was added, and git keeps tracking what it
already tracks — so the import brought a live `DATABASE_URL` and `AUTH_SECRET`
into this repository as a tracked file. It is now untracked and ignored; the
file remains on disk so the app still runs.
**Why.** A credential in version control is a credential that has to be assumed
compromised.
**Migration.** None in code. **Action required:** the values appear in 8 commits
of imported history and must be **rotated** — untracking stops further exposure
but does not remove what is already recorded. Whether to scrub the imported
history is a separate decision; it is only worthwhile if those commits never
reached another remote.
**Risk.** High until rotated.

#### Install-script policy became platform-wide
**What.** `allowScripts` moved to the root manifest and now names every package
that does real install-time work.
**Why.** npm honours `allowScripts` only at the workspace root and merely warns
when it appears inside a workspace. The ERP's existing `better-sqlite3` entry
therefore silently subjected **every other product** to script approval. Prisma's
client generation was blocked by exactly this, and the first build in the
workspace failed at "Collecting page data" with `@prisma/client did not
initialize yet`.
**Files.** `package.json`, `apps/erp/package.json`.
**Risk.** `@parcel/watcher` and `es5-ext` are deliberately left unapproved.

#### The Prisma client is no longer an install side-effect
**What.** `prebuild` and `predev` run `prisma generate` explicitly.
**Why.** The client used to appear as a side-effect of `@prisma/client`'s
postinstall. In a workspace that postinstall is subject to root script policy
and to hoisting, so the client could silently not exist. Generating it from the
build makes it depend on the build.
**Files.** `apps/website-builder/package.json`.

#### Docker rebuilt for a workspace build context
**What.** The build context is now the repository root. `npm ci` is filtered to
the one workspace; the standalone output paths moved; the entrypoint `cd`s into
the product; `railway.json` and `.dockerignore` moved to the root; the pinned
npm version was corrected from 10.9.4 to 11.16.0.
**Why.** The lockfile now lives at the root, so a build with the product
directory as context has nothing to install from. The standalone bundle also
changed shape — verified against a real build, the server is now at
`.next/standalone/apps/website-builder/server.js`, one level deeper than the
old `COPY` and the old `exec node server.js` expected. The npm pin had inverted:
the lockfile is regenerated by npm 11, and 10.9.4 is precisely the version that
cannot read it — the same failure the original comment documented, with the
sides swapped.
**Files.** `apps/website-builder/Dockerfile`, `apps/website-builder/docker-entrypoint.sh`,
`apps/website-builder/next.config.ts`, `railway.json` (moved to root),
`.dockerignore` (moved to root), `apps/website-builder/package-lock.json` (deleted,
superseded by the root lockfile).
**Risk.** **Unverified — Docker is not installed on the development machine.**
Every `COPY` source was checked to resolve from the new context, the standalone
layout was confirmed against a real build, and `npm ci --workspace
@landingos/website-builder --include-workspace-root` was run locally (lockfile
validates; `better-sqlite3` correctly excluded; `next` present). The image
itself has not been built. Confirm before the next deploy with:
`docker build -f apps/website-builder/Dockerfile -t landingos-builder .`

#### `outputFileTracingRoot` pinned
**What.** `next.config.ts` names the workspace root explicitly.
**Why.** Next infers it from lockfile position, and that inference decides the
*shape* of `.next/standalone`. Since the Dockerfile and entrypoint hard-code
that shape, a silent change in inference relocates the server and the container
starts failing with `MODULE_NOT_FOUND`.

#### `packages/product-registry` — the product-module contract
**What.** A new package defining what a product *is*: id, i18n name keys, icon,
base path, billing entitlement, declared permissions, navigation, and status.
The registry validates manifests at construction and answers the questions the
shell, the router and billing each need — without any of them knowing which
products exist. Ships with 35 tests.
**Why.** The approved architecture put `builder/` and `erp/` in the shell as
first-class directories, which hardcodes exactly the two-product assumption the
platform must not make. A product is now a manifest the shell discovers, not a
folder it knows about. The decisive test registers a product that does not
exist (`email-marketing`) and asserts routing, entitlement and navigation all
work with **no platform code changed**; another asserts all 8 combinations of
three products resolve correctly, including none and all.
**Files.** `packages/product-registry/**` (new).
**Migration.** None. Consumed by nobody in 3.1 — this is the foundation Phase
4's shell reads.
**Risk.** None; it is additive and isolated. Authored in TypeScript with no
build step: Node 24 strips types natively so `node --test` runs the suite
directly, and Next transpiles workspace packages, so both consumers read source.

#### The ERP test script was broken by Node 24
**What.** `node --test test/` → `node --test "test/*.test.js"`.
**Why.** Node 24 no longer resolves a bare directory there and exits
`MODULE_NOT_FOUND`, so `npm test` failed while every test in it passed. Every
milestone gate in this phase depends on that command.
**Files.** `apps/erp/package.json`.

#### Verification
- ERP — **293 tests, 292 pass, 1 skipped, 0 failures**, unchanged from baseline.
- product-registry — **35 tests, 35 pass**.
- website-builder — `next build` compiles and generates all 34 pages.
- ERP boots from `apps/erp`, serves `/app` and `/agent`, and still returns 401
  on unauthenticated API calls.
- website-builder boots and serves `/login` (200). `/api/health` reports
  `Database unreachable` — its own graceful DB-down path, not a crash. The
  configured Neon instance is not reachable from this machine and `.env` was
  never modified, so this is environmental; it is the one item not fully
  verified end to end.

#### Known issue carried forward
**What.** `apps/erp/test/indexes.test.js` is load-sensitive: it boots a WAL-mode
SQLite server, stops it, and immediately reopens the file, while
`test/helpers.js:142` SIGKILLs the child after 3s. Under the CPU contention of
parallel test files that timeout becomes reachable, leaving an unrecovered
`-wal` and a `SQLITE_ERROR` on reopen.
**Measured.** 4/4 passes in isolation; failed once in roughly four full-suite
runs. **Pre-existing — not caused by the move.**
**Why it matters.** The suite is the gate for every milestone in this phase, and
a gate that fails intermittently cannot distinguish a real regression from
noise. Should be fixed before 3.2 leans on it further.

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

---

## Phase 1 — notifications

The audit found this subsystem built twice and connected once. Rows were written
to the database and never read back by anything, so the persisted half was dead
code and every notification vanished on refresh. `target` was accepted by
`push()` but had no column to land in, so the live hop was targeted and the
stored row was not. The badge was a bare in-memory counter, and the `read` flag
was global — one person opening their panel marked everything read for everyone.

#### Recipient targeting
`notifications.target` added (`NULL`/`''` = everyone, `'manager'` = managers only,
`'<name>'` = that agent plus managers), matching `broadcast(payload, target)`
exactly so the live and stored paths cannot disagree about audience. Every
producer was audited: `agent_overdue`, `agent_suspended`, `stale_orders`,
`followup_overdue` and `suspicious_call` are now **manager-only** — they were
stored with `target: null`, meaning an alert about an agent's own missed order
was stored for that agent to read. Delivery notifications go to the order's
follow-up or confirming agent.

#### Read state and badge counts
Replaced the global `read` flag with a per-account watermark
(`agents.lastReadNotificationId`). Unread is "visible to me AND id > my
watermark" — one indexed comparison, no join table to grow. The watermark only
ever moves forward, and is clamped to the newest existing id: an unclamped
`{"upToId": 999999999}` parked it in the future and silently suppressed that
account's badge until a million notifications had been raised (found by probing,
not by the tests).

The badge now counts **only stored notifications**. It previously incremented on
every SSE frame including transient data-changed events, so it drifted away from
the server's total — verified in a browser showing 16 against a real unread of 6.

#### Persistence and history
Both clients call `GET /api/notifications` on boot and `POST
/api/notifications/read` when the panel opens. History and the correct badge now
survive a refresh, a restart and a different device. `beforeId` paginates.
`pruneNotifications()` runs hourly (5000 rows, `NOTIFICATION_RETENTION`) — the
table had no retention policy and grew forever, while being a feed rather than
an audit record (`audit_log` is that).

#### Events that were never stored at all
`new_order`, `abandoned_cart` and `suspicious_call` were broadcast-only, so the
single most important event in the system disappeared on refresh and anything
arriving while the console was closed was never seen. All three are stored
notifications now. The broadcast type stays **unprefixed** so existing client
branches keep working; what marks an event as storable is the presence of
`notificationId`, which is also the only thing the badge counts.

#### SSE reliability
The stream now emits `id:` lines for stored notifications, and on reconnect
replays everything missed — via the browser's own `Last-Event-ID` header or an
explicit `?lastEventId=`. An SSE connection drops constantly in normal use (a
phone locking, a tunnel timing out, a redeploy) and every notification raised in
that window used to be lost from the live feed and, since nothing read the
table, lost entirely. Clients de-duplicate replays by id.

#### XSS
`renderNotifList` in both clients interpolated `title` and `body` straight into
`innerHTML`. Those strings are built from webhook-supplied customer names, so a
customer called `<img src=x onerror=…>` executed script in the manager console —
which, before authentication existed, was already a fully privileged context.
Both now escape every field. Verified in a browser: the payload renders as text,
no elements are created, nothing executes.

**Tests.** 24 covering persistence across restart, pagination, manager-only
targeting (asserting the agent an alert is *about* cannot see it), per-account
unread counts, badge survival across refresh, watermark monotonicity and
clamping, live delivery with ids, replay after reconnect, two tabs receiving
independently, one tab closing without killing the other, unauthenticated
subscription refusal, XSS-safety of both renderers, and retention.

**Test count: 212, all passing.**

---

## Phase 2 — High priority

#### PERF-01 — the missing indexes
**What.** Twelve indexes across `orders`, `order_calls` and `shipments`, created
individually rather than as one statement batch, plus a one-time `ANALYZE`.
**Why.** The busiest table in the system had exactly one index
(`phoneNormalized`). Every status filter, per-agent lookup, webhook dedup and
the `ORDER BY createdAt DESC` on the main list was a full table scan. Worse,
`order_calls` had none at all — SQLite does not index a `FOREIGN KEY`
automatically — so `attachCalls()` scanned the entire calls table once **per
order**, making `GET /api/orders` quadratic. The frontend calls it on every SSE
event and again every 30 seconds.

**Measured on 5,000 orders with call history** (`node test/bench/orders-bench.js`):

| | before | after | |
|---|---|---|---|
| `loadOrdersData()` — what `GET /api/orders` runs | 3006.2 ms | 290.5 ms | **10.3×** |
| `listOverdueUnansweredOrders()` — the sweep | 440.8 ms | 33.9 ms | **13.0×** |
| `getOrdersByDeliveryOutcome()` — profit calc | 1.1 ms | 0.1 ms | **11×** |
| `computeAgentPayroll()` — one agent | 2.7 ms | 0.6 ms | **4.5×** |

Query plans went from `SCAN orders | USE TEMP B-TREE FOR ORDER BY` to
`SCAN orders USING INDEX idx_orders_created`, and the per-order call lookup from
a full scan to `SEARCH order_calls USING INDEX idx_order_calls_order`.

**Files.** `lib/db.js`, `test/indexes.test.js` (new), `test/bench/orders-bench.js` (new).
**Migration.** Index creation only — no column or row changes. SQLite builds them
on first boot after the upgrade; on a large table that is a few seconds, once.
**Risk.** Low. Each index is created in its own statement with its own
`try`/`catch`: an index over a column that does not exist would otherwise abort
the whole batch and take the process down at boot, turning a missing
optimisation into an outage. A failure now logs and the server still starts.
**Tests.** 16 — index existence, planner behaviour per query (asserting on query
plans rather than wall-clock, which would be flaky on shared CI), unchanged API
results and ordering, and an upgrade test that strips the indexes from a real
database and confirms boot restores them with the rows intact.

*Note: `GET /api/orders` is still 290 ms at 5,000 orders because it returns the
entire table and attaches call history row by row. Pagination is PERF-02, next.*

#### DEAD-01 and diagnostic PII logging
**What.** Deleted `lib/index.js` (2,333 lines), the stray zero-byte `{try{return`
file, `_probe.py`, and the `saveProducts()` no-op stub. Replaced six diagnostic
log lines that dumped customer data with one redacted line that fires only when
address resolution actually fails.
**Why.** `lib/index.js` was a stale copy of the entire server — 102 routes against
the live 117 — that nothing required and that could not have worked if anything
did (its `require('./lib/db')` resolves to `lib/lib/db`). It was 17% of the repo
by line count and actively dangerous: the next person to grep for a route would
find two copies and might edit the wrong one.
The three `RAW … WEBHOOK PAYLOAD (diagnostic)` lines wrote entire inbound webhook
bodies to stdout, and the three Shopify `DEBUG` lines wrote the raw address block
and every note attribute — names, phone numbers, addresses — on every order. All
six were commented "remove once confirmed" and shipped. What made them useful was
knowing *which* fields arrived and whether resolution succeeded, not their
contents, so the replacement logs field presence and the attribute *names* only,
and only when `resolvedWilaya` came back empty.
**Files.** `lib/index.js`, `_probe.py`, `{try{return` (deleted); `index.js`.
**Migration.** None. **Risk.** None — nothing referenced any of it.

#### Graceful shutdown (turns `jobs.stop()` from dead code into working code)
**What.** `SIGTERM`/`SIGINT` now stop the background timers, tell live SSE clients
to reconnect, let in-flight requests finish, checkpoint the WAL back into the
database file, and exit — with an 8-second cap so a stuck connection cannot hang
the process.
**Why.** The audit listed `jobs.stop()` as dead code. It was not dead, it was
unwired — nothing ever called it. A container host sends `SIGTERM` on every
redeploy and `SIGKILL`s shortly after, so the process was dying mid-request,
leaving SSE clients holding a socket that would never produce another event, and
could be killed between a write and its WAL checkpoint. Folding the WAL back in
also means a cold copy of `crm.db` is complete and consistent, which matters for
the backup story.
**Files.** `index.js`.
**Migration.** None.
**Risk.** Low. **Caveat, stated plainly:** Node on Windows does not deliver
`SIGTERM` — `child.kill()` maps to `TerminateProcess`, which kills without
running any handler — so this could not be exercised on the development machine.
The behavioural test is **skipped on win32 with that reason recorded**, and a
source-level test asserts the handler is wired to `jobs.stop()`, `server.close()`
and the WAL checkpoint. It will run for real on the Linux host.

#### Mass assignment on `PUT /api/orders/:id` and `PUT /api/settings`
**What.** Order updates now go through a three-tier field whitelist
(agent-writable / manager-writable / not client-writable at all), and settings
are validated against a typed schema with ranges, rejecting unknown keys.
**Why.** Both routes spread `req.body` straight into storage.

*Orders.* Verified against a running server: a single
`PUT {"deliveryOutcome":"delivered","price":999999}` **fabricated 999,999 of
client lifetime revenue**, because `upsertClientFromOrder()` correctly treats the
transition into `delivered` as a real sale. The same field drives delivered-pay
payroll and the profit calculator, so this was financial data corruption from one
API call. `phoneNormalized`, `shipmentId`, `overdueFlaggedAt`, `pendingCallStart`,
`shopifyId` and `source` were equally writable — all machine-derived state owned
by specific code paths.
Rejected fields are dropped and logged rather than 400'd, because the existing
edit screen sends whole order objects back and failing those would break it.
The post-update broadcast now reads the *filtered* patch, so a rejected `agent`
can no longer trigger a reassignment notification for a reassignment that did not
happen.

*Settings.* `{"totallyMadeUpKey":"yes","autoSuspend":"not-a-boolean",
"suspendThreshold":-5}` was stored verbatim. The type confusion is the dangerous
part: `if (s.autoSuspend)` is **true for the string `"false"`**, so a typo would
silently switch on automatic account suspension. An impossible working-hours
window is refused at entry too — it previously made the overdue sweep match no
hour at all, which `isWithinWorkingHours()` handles by failing open and logging,
discoverable only weeks later. Settings changes are now audited.
**Files.** `index.js`, `test/validation.test.js` (new).
**Migration.** None. **Risk.** Low, but note the whitelist is deliberately
conservative: if a legitimate client field turns out to be missing, it will be
silently dropped and logged as `ignored non-writable fields on update` — grep for
that line after deploying.
**Tests.** 23.

#### BUG-03 — the follow-up auto-assign setting did nothing
**What.** The two confirm paths no longer pass `{ auto: true }`.
**Why.** `assignFollowup()` checks `opts.auto || settings.followupAutoAssign`, and
both callers passed `auto: true` unconditionally — so the expression
short-circuited before it ever read the setting. Turning the toggle off in
Settings had no effect: a follow-up agent was assigned on every confirmation
regardless. Explicit manual assignment (the bulk action and
`POST /api/followup/assign`) still overrides, as it should.
**Files.** `index.js`. **Migration.** None.
**Risk.** *Behaviour change, in the direction the setting always claimed.*
`followupAutoAssign` defaults to `false`, so after deploying, confirmations will
stop auto-assigning follow-up agents until the toggle is switched on. If the team
has been relying on that assignment happening, turn it on.

#### Rate limiting and security headers
**What.** New `lib/ratelimit.js` (a fixed-window counter, ~40 lines, no
dependency). Two limiters on login — per client address and **per account name**
— plus a wide backstop on the rest of `/api`. Six security headers.
**Why.** Login was completely unthrottled. Every attempt costs a real scrypt
derivation, so it was both a credential-stuffing surface and a cheap way to burn
the server's CPU. The per-account limiter matters separately: a per-IP limit
alone misses a distributed attempt against one account, and a per-account limit
alone would let one attacker lock out everyone. Verified live: ten `401`s then
`429`s, with a `Retry-After`, while a *different* account can still sign in.
The SSE stream is exempt from the backstop (one long-lived connection, not a
request rate) and `/webhook` is a separate mount, so a carrier replaying a
backlog is never throttled off.
Headers are hand-written rather than via helmet — six values this app can state
exactly, versus a dependency. `X-Frame-Options: SAMEORIGIN` rather than `DENY`
because `index.html` iframes the profit calculator. No CSP yet: both clients rely
on inline scripts and handlers, so a guessed policy would either break them or be
meaningless. That belongs with the frontend rebuild.
**Files.** `lib/ratelimit.js` (new), `index.js`, `test/ratelimit.test.js` (new),
`test/helpers.js`.
**Migration.** None. Tunable via `LOGIN_RATE_LIMIT` (30/15min),
`LOGIN_ACCOUNT_RATE_LIMIT` (10/15min), `API_RATE_LIMIT` (600/min).
**Risk.** **Known limitation, stated plainly:** the counters live in this
process's memory. On the single instance this deploys to that is correct, but
behind more than one instance each keeps its own count, so the effective limit
multiplies, and a restart clears everything. The fix at that point is Redis, and
it belongs with the same work that moves SSE fan-out off in-process state.
**Tests.** 15, including that per-account throttling cannot be reset by changing
the capitalisation of the name.

#### PERF-02 — filtered, paginated orders in SQL
**What.** `db.queryOrders()` and `db.countOrdersByStatus()`, exposed as
`GET /api/orders?limit=&offset=&status=&agent=&wilaya=&since=&until=&search=&sort=&dir=`
and `GET /api/orders/stats`.
**Why.** `GET /api/orders` returned the entire table with every call attached —
291 ms on 5,000 orders *after* the indexes — and the console re-ran it on every
SSE event and again every 30 seconds. All the filtering the UI does was
happening in the browser over that full download.

| on 5,000 orders | |
|---|---|
| `loadOrdersData()` (whole table) | 291 ms |
| `queryOrders({limit:50})` | **0.7 ms** |
| `queryOrders({status, limit:50})` | 0.8 ms |
| `queryOrders({search})` | 6.1 ms |
| `countOrdersByStatus()` | 0.6 ms |

Call history is deliberately not attached to a list page — joining it per row is
what made the old path quadratic, and the list only renders the count, so
`callCount` is returned instead. The detail view is unchanged.
The record-level scope is pushed **into** the query rather than applied to the
result: filtering a page afterwards would silently return short pages, and the
total would count rows the caller cannot see.
**Files.** `lib/db.js`, `index.js`, `test/pagination.test.js` (new),
`test/bench/orders-bench.js`.
**Migration.** None.
**Risk.** Low, and deliberately backward-compatible: with **no** query parameters
the endpoint still returns a bare array, because a browser holding a cached copy
of the old client calls it that way and changing the shape would break every open
tab the moment this deploys. That legacy path is still the slow one and now logs
when it serves more than 500 rows.
**Tests.** 23 — paging without gaps or repeats, the 200-row cap, filter
composition, case-insensitive search, whitelisted sorting, SQL-injection
attempts through `sort` and `search`, scope applied in-query (asserting pages
stay full), the stats endpoint, and the legacy shape.

#### PERF-03 — the write path re-read the row five times
**What.** `patchOrder()` hands its already-read row down to `saveOrder()` as the
before-state, and the client/product lifetime upserts are skipped when no field
they depend on changed.
**Why.** A single field change called `getOrder()` **five** times — for the patch
merge, for `before`, twice to feed the two stat upserts, and once to return —
each re-reading the row and its call history, then rewrote all ~50 columns.
Pressing "Call" (which sets one timestamp) did all of that.
**Files.** `lib/db.js`. **Migration.** None.
**Risk.** Low, but worth naming: the skip is driven by `STAT_RELEVANT_FIELDS`
(status, deliveryOutcome, price, phone, product, quantity, shopifyProductId). If
a future counter starts depending on another field, it must be added to that list
or its stats will silently stop updating. Measured gain is modest — 2.4 ms → 2.3 ms
on the call-button path, since the cost is dominated by the transaction commit
rather than the reads. Kept because it removes the read amplification, not for
the milliseconds.

#### The console no longer re-downloads on every event
**What.** `fetchOrders()` de-duplicates in-flight requests and coalesces a burst
into at most one follow-up; the 30-second poll skips while the tab is hidden and
catches up on `visibilitychange`.
**Why.** It is called from 27 places, including once per SSE event, so a busy
minute meant dozens of full downloads of the order table, each followed by a full
re-render. **Verified in a browser: 15 concurrent calls now produce 2 network
requests.**
**Files.** `index.html`.
**Risk.** Low — no caller changed.
**Not done, and why:** the console still fetches the list *whole*, because every
filter, sort and statistic in it is computed client-side over one `orders` array.
Moving it onto the paginated endpoint means rewriting that pipeline, which
belongs with splitting the 4,600-line file up rather than being bolted on here.
The server side is ready and tested for when that happens.

#### Backend features that had no UI
The audit listed nine routes with no caller in any client. Two were repaired in
Phase 1 (the notification list and read-sync). The rest, resolved:

| route | outcome |
|---|---|
| `GET/PUT /api/stores/:id/default-carrier` | **Exposed** — a dropdown in the store modal, populated from the live provider registry so a newly added carrier appears without a code change. |
| `POST /api/followup/assign` | **Exposed** — an assign button on every Suivi row, offering each follow-up-capable agent plus "auto" to re-run the workload-balanced choice. |
| `POST /api/abandoned` | **Removed** — superseded by the per-store checkout and contact webhooks, which do the same job with signature verification and platform-aware parsing. |
| `GET /api/financial-records/versions` | Kept as an API. The append-only version history is real, but surfacing it needs a drill-down the calculator does not have; it belongs with that page's rework. |
| `GET /api/agents/:name/payroll` | Kept. The bulk endpoint covers the UI; the single-agent form is a reasonable API to leave in place. |
| `POST /api/ai/chat` | Kept — the non-streaming fallback for a provider that cannot stream. |
| `GET /api/statuses` | Kept. Wiring the clients to it would mean rewriting how both render status labels, which belongs with the frontend work. |

**Why it mattered.** Per-store default carrier and manual follow-up assignment
were *fully built and completely unreachable* — the manager could not use
features that already existed and were being maintained.
**Files.** `index.html`, `index.js`.
**Risk.** Low. Both were verified in a browser: the carrier dropdown populates,
saves, and reads back on reopen; the assign button renders on every Suivi row and
the assignment persists.

*Note: `POST /api/followup/assign` is manager-only as of the Phase 1 review, so
the new button is a manager action — which is what it should be.*
