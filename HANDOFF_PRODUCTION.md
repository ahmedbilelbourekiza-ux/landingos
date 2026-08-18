# HANDOFF_PRODUCTION — deployment and production state

**Written:** 9 August 2026, ~19:00 UTC · **Updated:** 14 August 2026 —
**everything through LB.41 IS DEPLOYED** (`c3b1917`; see §1, newest record
first: LB.41 the settings-screen locale fix, LB.40 `robots.txt`, then LB.35b,
LB.38+LB.39, LB.37 and the LB.31–LB.36 range on 13 Aug. LB.35's migration was
applied on 13 Aug as a database action on its own; the LB.13–LB.26 deploy +
LB.20 migration are the 12 August record below) · **For:**
the next conversation/agent picking this project up. Read this FIRST for anything
touching production; `PROJECT_STATE.md` (platform history),
`BUILDER_HANDOFF.md` (product) and `UIUX_PASS.md` (the UI/UX + mobile passes)
remain the deep references.

---

## 1. CURRENT PRODUCTION STATE

> ### 🛑 READ FIRST — 17 Aug 2026: DEV MOVED TO A SEPARATE NEON PROJECT, AND BOTH DATABASES ARE NAMED `neondb`
>
> **All local development, testing and audit work now goes to a NEW Neon
> project. The old project — which holds `landingos_prod` — is SUSPENDED ON
> ITS COMPUTE QUOTA and is off-limits to development activity, by the user's
> explicit instruction.**
>
> | | Host prefix | Database | Use |
> |---|---|---|---|
> | **DEV** | `ep-gentle-sky-b1rahhl0` (direct) / `-pooler` (pooled) | `neondb` | Everything local: suites, fixtures, audits |
> | **PROD — do not connect** | `ep-summer-shadow-a2ks6nf8` | `landingos_prod` (and the old dev `neondb`) | Production only; quota-suspended |
>
> **⚠️ The database NAME no longer distinguishes them — the old dev database
> and the new dev database are both called `neondb`. Identify by HOST, always.**
> Any older note in this file or in `PROJECT_STATE.md` saying "`neondb` is dev"
> predates the split and is ambiguous; it means the OLD project's `neondb`.
>
> **The new dev database was set up fresh on 17 Aug** by the documented recipe
> (`apps/website-builder/DEPLOY.md` §"Preparing a database"): `setup:roles` →
> `push` → `rls` → `seed:reference`. Verified: **RLS 49/49** (enabled + FORCE +
> policy + WITH CHECK, 5 expected unscoped tables), 58 wilayas / 537 baladias,
> the full isolation preflight all-PASS, and local `/api/health` green with
> `isolation: rls`. **It contains 0 tenants and 0 users — `seed:demo` was
> deliberately NOT run**, so `owner@demo.test` and the `acme` tenant do not
> exist there; build a fixture or run `seed:demo` before anything needing a
> signed-in user. Production was confirmed healthy and unaffected at the time
> of the switch (`database: ok`, 58 wilayas, `isolation: rls`, storefront 200).
>
> **Consequence for §1's outstanding live verifications:** the phone-dedup
> order test, the two console-screen checks, and the identity of the page that
> carried `/0` all require `landingos_prod`, which is now off-limits. They are
> **closed-unverified**, not pending.

> ### ⚠ SEVEN LOCAL COMMITS ARE QUEUED, NOT PUSHED — 18 Aug 2026 (overnight session + the user's reviews), AND THE BATCH CARRIES ONE MIGRATION
>
> **`main` is now seven commits ahead of `origin/main` (`12d805e..`), all
> local, per the session's explicit no-push instruction. The push/deploy
> decision is the user's.** In order:
>
> | Commit | What |
> |---|---|
> | `00d446a` | **LB.55** — the muted surface/ink pair, chosen by WCAG arithmetic (the four live contrast failures: 2.47/3.98/3.93 → 7.16/12.11/9.46, verified on a dedima-palette fixture). Expect **a11y 100 on a WARM run** after deploy. No migration |
> | `7b57bcd` | **AN.1** — first-party page views + traffic-source attribution (beacon → server-derived channel → order snapshot → the console "Traffic" screen). Optional env `VISIT_RATE_LIMIT` (default 120/5min/IP) |
> | `85ba416` | **JS.1** — the storefront stops shipping next-intl/ICU, both toasters and next-themes (they moved to `console/layout.tsx`); dead `category-product-grid.tsx` deleted. **Modern-phone payload 296→261KB gz, HTML 565→481KB.** No migration |
> | `f24f094` | The night's records + the **LB.14a.2 proposal** (front-door split, linchpin proven empirically — NEXT_STEPS §LB.14a.2; deliberately not built, decision is the user's) |
> | `3da5b55` | **AN.2** — the user's decisions on AN.1's open questions: 30-day visit retention (amortised on writes + on the Traffic-screen read + the worker tick) and unique/returning visitors (localStorage id, session-scoped verdict, raw COUNT(DISTINCT)). Funnel + utm_campaign approved-not-urgent, recorded in NEXT_STEPS §AN.1 |
> | `5d81b0f` | **§BH scoping** — deep in-page behavior tracking + AI recommendations, measured and proposed at the user's request (NEXT_STEPS §BH) |
> | *(BH.1+2)* | **BH.1+BH.2** — the user's §BH decisions built: per-page opt-in behavior capture (viewId + ten nullable columns on the visit row, `LandingSetting.behaviorTracking`, the collector + exit beacon, server-enforced opt-in) and the computed behavior table on the Traffic screen. WhatsApp taps are NOT conversions. **BH.3 (the AI slice) is BLOCKED on a spend-quota system by the user's decision** — the quota is now a shared need with LB.24's generator, worth scoping as its own piece |
>
> **⚠ THE ONE MIGRATION, for AN.1+AN.2+BH.1 TOGETHER** (nothing has reached
> production, so the three slices are one schema delta): production
> `db push` (preview with `migrate diff` first — expect `StorefrontVisit`
> incl. `isReturning`, `viewId @unique` and the ten behavior columns; 2
> nullable `SalesOrder` columns; `LandingSetting.behaviorTracking`) →
> `apply-rls` (RLS **49 → 50** — BH.1 adds no table) → the app deploy, in
> the LB.20 order, each step user-approved. Applied to DEV in full (host
> `ep-gentle-sky` confirmed in every push output; dev RLS 50/50). The
> `--accept-data-loss` prompt dev raised is the generic nullable-unique
> warning on an EXISTING table — production creates the table whole and
> will not prompt.
>
> Suites at the final tree: storefront **90** · builder-sections **75** ·
> console-shell **20** · erp/screens **172** · tracking **16** · i18n **22**
> · theme-contrast **10** (new) · traffic-source **14** (new). The dev DB
> now holds the seeded `demo` tenant (`seed:demo` run 18 Aug — the fresh
> project had no users; `owner@demo.test`/devpassword123 works again) plus
> a published `demo-landing` page as permanent dev furniture. **The "216
> historical test tenants" cleanup item is CLOSED-IMPOSSIBLE:** they live
> only in the old quota-suspended project (off-limits); the new dev DB was
> measured at exactly 1 tenant (`demo`) after the night's suite runs — the
> LB.27 hooks are doing their job.
>
> ### ✔ SEC.1–SEC.5 + SA.1 ARE DEPLOYED — 17 Aug 2026: the security-audit fixes, confirmed at Render on 18 Aug
>
> **`origin/main` is `d26074c`**, and **`d26074c` is the live deploy** —
> Render deploy `dep-da1hn3u1egvs73a8digg`, created 14:32:47 UTC, **live
> 14:35:35 UTC on 17 Aug 2026** (build 2m48s, trigger `new_commit`), with
> every earlier deploy `deactivated`. Range **`c3d911d..d26074c`, six
> commits**, 25 files. **Rollback point: `c3d911d`.** The local checkout's
> HEAD is byte-identical to the deployed SHA (`d26074c1a0e164…`).
>
> **No migration**: zero `.prisma` diffs across the range. ⚠️ The
> authoritative check — `prisma migrate diff` drift against the deployed
> database — **was NOT run**, because `landingos_prod` is now off-limits
> (see the block above). The file-level check plus the previous deploy's
> verified-empty state is the basis for this claim; treat it as strong but
> not the drift proof the last three records carried.
>
> **How liveness was established, and why it took the Render API.** This
> range has **no publicly observable marker**: every one of the six commits
> touches either a server-only module (`lib/digits.ts`, `lib/erp/phone.ts`,
> `lib/tracking/events.ts`, `lib/storefront/delivery.ts`) or an
> authenticated console surface (the create form, the notification stream,
> the four builder write routes). No storefront chunk, header, or public
> response differs between `c3d911d` and `d26074c`, and `/api/health`
> reports only `version: 0.1.0` with no commit SHA. Chunk-hash comparison,
> the free-shipping quote probe, and the notification-stream probe were all
> tried and all fail for that structural reason. **Settled read-only via
> `GET /v1/services/srv-d9jn1kkm0tmc73bb8nt0/deploys` with the user's
> explicit permission.**
>
> **What is DEPLOYED but NOT verified end to end, and now cannot be here:**
> the SEC.1 phone-dedup check (two orders, same number in two numeral
> systems, confirming ONE `Client` row) is covered by unit tests but was
> never run against a live page; the SEC.4 create-screen notice and the
> SA.1 Arabic-title refusal are authenticated-console checks. All three
> need `landingos_prod`. **Closed-unverified, not pending.**

> ### ✔ LB.24 + LB.54 ARE DEPLOYED — 16 Aug 2026 (night): the AI landing generator and the digit-only-slug fix
>
> **`origin/main` is `c722050`** (`1dbe119..c722050`, five commits —
> LB.24's three fast-forwarded, LB.54's two rebased on top with doc
> conflicts resolved keep-both — **no migration**: zero `.prisma` diffs
> in the range AND `prisma migrate diff` re-run against the deployed
> tree's datamodels answered "empty migration" for BOTH schemas).
> **Rollback point: `1dbe119`.** Pushed 23:36 UTC, user-approved.
>
> **Pre-push baselines** (captured from the deployed tree — this
> environment has had no route to production all day, egress 403):
> `ai-generate-panel`/`ai-generate-unavailable` testids: **zero
> occurrences** in the deployed source; the letter rule on slugs:
> **absent** (a digit-only slug was accepted — the /0 mechanism was
> reproduced end to end earlier this session on the local production
> build behind a verified fixture domain, including the domain sitemap
> emitting `/0`).
>
> **The full battery on the exact merged tree, all green — sixteen
> suites, 475 tests, every count at its recorded value:** storefront 76
> · builder-sections 74 · builder-api **49** (was 42 — the digit-slug
> refusals) · builder-ai **19** (new — includes the 16.5s slow-model
> transaction test) · tracking 15 · console-shell 20 · hardening 13 ·
> webhooks 10 · calc 28 · platform/domains 14 · platform/team 63 ·
> platform/workspace 4 · platform/sessions 2 · erp/ai 31 · i18n 22 ·
> packages/db 35. Local Postgres verified online at both ends of the
> run (it had been reaped mid-battery once; that run was discarded and
> re-run, not patched). Fixtures swept to zero tenants.
>
> **LIVE verification owed (whoever first has a browser on the domain):**
> 1. `/console/builder/pages/new` shows the AI section — expect the
>    `ai-generate-unavailable` notice, NOT the panel: production has no
>    `AiProvider` row, so the generate route answers 501
>    `NO_AI_PROVIDER` and **zero API spend is possible** until a key is
>    deliberately configured at `/console/erp/ai`. No real generation
>    was attempted anywhere — the suites exercise a local stub.
> 2. Create a page titled Arabic + digit (e.g. «ساعة برو 0») leaving the
>    address blank — expect the refusal message asking for an address
>    with at least one letter, NOT a silent page at `/0`.
> 3. Which real page carried the digit slug historically, and the
>    already-distributed `/0` links decision (redirect slice vs
>    re-pointing ads) — NEXT_STEPS §LB.54.
> 4. Still owed from the afternoon: warm PSI after-numbers for
>    LB.51–LB.53 (the API quota answered 429 all session, ~220 attempts).
>
> ### ✔ LB.51 + LB.52 + LB.53 ARE DEPLOYED — 16 Aug 2026 (afternoon): the TTFB census, the gallery-warming trade, the price contrast
>
> **`origin/main` is `d915c77`** (`831c48d..d915c77`, six commits — five
> feature commits fast-forwarded from `claude/perf-ttfb-images-2otrah`
> plus that branch's records commit — **no migration**: the range's only
> schema diff is the `relationJoins` generator preview flag, re-verified
> before the push). **Rollback point: `831c48d`.** Pushed 13:28 UTC.
>
> **What WAS verified, honestly.** The deploy-session environment could
> not reach production (egress 403 on `selliora1.com`/`onrender.com` —
> the same policy that boxed in the build session), and the PageSpeed
> API's shared-IP anonymous quota answered 429 on every attempt, before
> and after the push. So this deploy's verification is: **all nine suites
> green at recorded counts on the exact deployed tree** (storefront 76 ·
> builder-sections 74 · tracking 15 · builder-api 42 · console-shell 20 ·
> hardening 13 · platform/domains 14 · platform/team 63 · packages/db
> 35), in a harness built from scratch in that container (local Postgres
> 16, both databases, RLS roles verified NOBYPASSRLS, reference seed, the
> standalone production build — the same artifact Render runs). Suite
> reds along the way were harness knobs the code documents
> (`CHECKOUT_RATE_LIMIT`, the tracking stub bases), not regressions.
>
> **What is OWED, live (first session that can reach PSI or the page):**
> warm PSI runs on `selliora1.com/dedima` — expect image-delivery
> ~226KiB → ~113KiB (ONE deliberate forward warm remains), **accessibility
> 100** (this marker only exists on the new build — it doubles as the
> deploy-liveness check), `server-response-time` shedding ≈12 × the
> Render↔Neon RTT; judge WARM runs only (a deploy wipes the
> image-optimizer cache — LB.48's discovery). Plus the LB.35b page-subset
> behaviour re-checked live once (tracking resolution moved into the
> page's own transaction — same functions, new call path) and one checkout
> end to end. The pre-push baseline of record is the LB.48–50 block below
> (same build, same morning). The three hosting-layer TTFB questions
> (Render spin-down, Neon scale-to-zero, region pairing) remain the
> user's — NEXT_STEPS §LB.51.
>
> ### ✔ LB.48 + LB.49 + LB.50 ARE DEPLOYED — 16 Aug 2026: the perf trio
>
> **`origin/main` is `1067984`** (`cf5c554..1067984`, three commits, **no
> migration**). **Rollback point: `cf5c554`.** Live 2m48s after the push.
> Markers all PUBLIC on `selliora1.com/dedima`, baselines captured BEFORE:
>
> | Marker | Before | After |
> |---|---|---|
> | stylesheet links / inline `<style>` (LB.50) | 2 / 0 | **0 / 1** |
> | gallery CSS-fade div + framer `AnimatePresence` in served chunks (LB.49) | 0 / present | **1 / ZERO across every chunk** |
> | `href="/__domain__"` brand link (LB.48) | 1 | **0** (brand links `/`) |
>
> **Live interactions verified in a real browser on the domain:** the
> gallery neighbours' full-size images fetched with ZERO interaction
> (lookahead working), the description image warmed post-load, and a
> thumbnail click swapped the hero within 350ms from cache.
>
> **The Lighthouse story, honestly:** TBT 1,380 → **520–850ms** and SI 2.8
> → **2.4–2.5s** across warm runs (the framer + inlineCss wins are real);
> perf 68–77 vs 69 before, LCP 3.3–3.8s vs 3.0 — LCP on this page is
> dominated by the Render dyno's TTFB (0.9–1.8s between runs), not by
> anything the template does.
>
> **⚠ OPERATIONAL DISCOVERY, record-worthy: a deploy WIPES the
> image-optimizer cache.** The first Lighthouse run after this deploy
> scored **47 with LCP 10.6s — Load Time 8.8s on the hero** — because
> every `/_next/image` variant re-transforms cold on the new container
> (sharp over an 882KB source on a shared CPU), and warm reruns
> immediately returned to 77/3.3s. **This is almost certainly what the
> user's original PSI report (66/6.5s/10.2s) measured** — PSI runs once,
> often shortly after a deploy. Judge production perf only on WARM runs,
> and consider warming the real store's hero variants after each deploy.
>
> Regression sweep intact: absolute canonical + og:image on the domain ·
> bare robots sitemap · platform host untouched · wilayas-404 `no-store` ·
> root 307 · health green.
>
> ### ✔ LB.47 IS DEPLOYED — 16 Aug 2026: metadata URLs are absolute, og:image stops naming localhost
>
> **`origin/main` is `933f95b`** (`9acaf00..933f95b`, one commit, **no
> migration**). **Rollback point: `9acaf00`.** Live 2m49s after the push.
> All markers PUBLIC, baselines captured on the REAL page BEFORE pushing:
>
> | Marker on `selliora1.com/dedima` | Before | After |
> |---|---|---|
> | canonical | relative `/dedima` (PSI: invalid) | **`https://selliora1.com/dedima`** |
> | `og:image` | **`http://localhost:10000/uploads/...`** (imageless social previews since LB.37) | **`https://selliora1.com/uploads/...`**; twitter:image absolute too |
> | `localhost:10000` refs in served HTML | **4** | **0** |
>
> The platform host flipped identically (`https://landingos.onrender.com/bebezzouar/dedima`
> canonical, zero localhost). **Regression sweep intact:** landing markers on
> dedima and robe · bare robots sitemap + sitemap locs on the custom domain ·
> console `noindex` · root 307 · wilayas-404 `no-store` · health green. No
> fixture was needed anywhere.
>
> **The same slice's investigation, recorded in CHANGELOG §LB.47:** the PSI
> 66/6.5s/10.2s report on dedima is the harness, not a regression — same
> page, controlled method: dedima 69/LCP 3.0s ≈ robe 69/3.6s, LB.44 intact,
> TTFB equal across hosts. Real residuals: the JS-diet backlog (§5.4) and
> `force-dynamic` TTFB (LB.14a.2). Meta description: mechanism complete,
> dedima's three source fields all null — merchant data.
>
> ### ✔ LB.46 IS DEPLOYED — 16 Aug 2026: View and Copy Link speak the tenant's domain
>
> **`origin/main` is `da971fb`** (`a8f871e..da971fb`, one commit, **no
> migration**). **Rollback point: `a8f871e`.** Live 2m28s after the push.
> The marker is AUTHED, so two throwaway prod fixtures carried it, baselines
> captured BEFORE pushing:
>
> | Fixture | Before | After |
> |---|---|---|
> | W — verified PRIMARY fake domain, published page | View href = platform path, domain href **0** | View href = **`https://<domain>/marker-page`**, platform href **0**; the editor's payload carries the same URL as `publicPath` |
> | N — no domain, published page | platform path | **platform path, unchanged**, zero domain leakage |
>
> **Regression sweep intact:** `selliora1.com/robe` still the landing page ·
> its robots still names the bare sitemap · platform `/bebezzouar/robe`
> landing page · root 307 · wilayas-404 `no-store` · health green. Both
> fixtures swept to zero remnants across all six row kinds; the three real
> tenants and the one real domain row (`selliora1.com`, primary) untouched.
>
> The real store's console now shows View → `https://selliora1.com/robe`
> and Copy Link copies the same — the user can see it directly.
>
> ### ✔ LB.45 IS DEPLOYED — 16 Aug 2026: the first custom domain works end to end
>
> **`origin/main` is `0aa0eae`** (`cc87b0b..0aa0eae`, one commit, **no
> migration** — no schema path in the range). **Rollback point: `cc87b0b`.**
> Live 2m28s after the push. Baselines captured on the REAL custom domain
> BEFORE pushing — the first deploy verifiable on a merchant's own hostname:
>
> | Marker on `selliora1.com` | Before | After |
> |---|---|---|
> | `/robe` | store-home markup, `landing-fade-up` **0** | **the landing page** — `landing-fade-up` 1, canonical `/robe`, title `robe · selliora16`, order form (inputs + wilaya select + submit) |
> | `/category/watches` | **404** | **200** (empty listing — correct: `robe.categoryId` is null; the merchant never assigned it. Clickable cards are pinned by the suite's fixture test, and the HOME's card links `/robe`) |
> | `/` | **307 → `/bebezzouar`** | **200**, home, 1 bare `/robe` card link, 0 platform-shaped links |
> | `robots.txt` Sitemap | `…/bebezzouar/sitemap.xml` | **`https://selliora1.com/sitemap.xml`** |
> | `/sitemap.xml` | (would 404) | **200**, bare absolute `<loc>`s |
>
> **Platform-host regression sweep after, all nine intact:** `/bebezzouar/robe`
> still the landing page · bare `/robe` still 404 · root 307 → console ·
> platform robots zero Sitemap lines + console Disallow · wilayas-404
> `no-store` · console login 200 + `noindex` · the platform sitemap still
> emits the PREFIXED shape (`storefrontHref` per host, as designed) · a
> forged `X-Forwarded-Host` still cannot put a sitemap on the platform
> robots · health green.
>
> No fixture was needed on production — every marker is public on the real
> domain. (A local `manual-cd.test` fixture domain in `neondb` was created
> and removed during diagnosis.)
>
> ### ✔ LB.42 + LB.43 + LB.44 ARE DEPLOYED — 15 Aug 2026 (evening)
>
> **`origin/main` is `4742554`** (`3fc1ade..4742554`, five commits: LB.42 the
> write-panel i18n + its record, the LB.11-closure record, LB.43
> `event_source_url`, LB.44 the storefront LCP fix — **no migration**, proven
> by `migrate diff` against `landingos_prod` returning *"This is an empty
> migration."* before the push). **Rollback point: `3fc1ade`.** Live 2m08s
> after the push.
>
> **LB.44, verified on the REAL public page `/bebezzouar/robe`, baseline
> captured BEFORE pushing:**
>
> | Marker | Before | After |
> |---|---|---|
> | `style="opacity:0"` wrappers in served HTML | **2** | **0** |
> | `<link rel="preload" as="image">` | **2** (hero + competing description image) | **1** (hero only) |
> | `fetchpriority="high"` | **0** | **2** (preload + img) |
> | `landing-fade-up` | **0** | **1** |
>
> **The real before/after Lighthouse run (same page, same machine, same
> method):** performance **50 → 75**, LCP **5.8s → 3.4s**, TBT **1,770 →
> 460ms** — and the phase the fix targeted, **Render Delay: 2,479ms (43%) →
> 34ms (1%)**. What remains of LCP is TTFB (1.5s on this run — the
> `force-dynamic` + Render dyno problem LB.14a.2 owns) and simulated network
> Load Time; both documented open items, not regressions.
>
> **LB.42, verified with a throwaway prod fixture (session cookie +
> `locale=fr`) on `/console/settings/integrations`:** `Signing secret` 1→**0**,
> `Confirmer la suppression` 0→**4**, `Envoyer un test` 0→**2**, `Libellé`
> 5→**10**, `Send test` 0 throughout; **`Pixel ID` ×1 and `Conversions API
> access token` ×1 REMAIN, deliberately** (Meta's own dashboard terms). A bare
> `Label` grep is the WRONG check — it counts camelCase prop names
> (`pendingLabel`) in the RSC flight payload, which grew BECAUSE the panels
> now take words as props. Grep visible strings, not substrings.
>
> **LB.43 has no public marker by design** — pinned by the tracking suite's
> four stub assertions; its live proof arrives with the next real order's
> event in Meta showing `event_source_url`.
>
> **Regression sweep after, all intact:** health green · wilayas-404
> `no-store` (LB.14a) · pixel config `no-store` · robots.txt Disallow
> console/api with zero Sitemap lines (LB.40) · `/bebezzouar/sitemap.xml` 200
> xml, 3 URLs (LB.39) · root 307 → console · console `noindex` + storefront
> `robe · selliora16` with `index, follow` (LB.37) · LB.41's fr settings
> screens (`Nom de la boutique` ×3, zero `Store name`, `Géré par` intact).
>
> Cleanup: fixture swept to **zero remnants** (sessions, membership,
> subscription cascaded with the tenant; user deleted separately), the three
> real tenants (`bebezzouar`, `alaa`, `union`) untouched, health green.
>
> **Same session, before the deploy: LB.11 closed and the image pipeline
> confirmed.** The user's real pixel + CAPI token on `bebezzouar` delivered
> Purchase ×2 / Lead ×2 to Meta (CHANGELOG §LB.11). The upload pipeline was
> measured end-to-end: a 13.9MB file refused with `FILE_TOO_LARGE` BEFORE any
> processing, a 3000×3000 upload stored at exactly 2000×2000 (q82, original
> format kept for alpha), gallery and description images share the one
> `storeImage` + serve-time `/_next/image` WebP path — **no code change was
> needed.** One user-side action remains open: the pixel's **Traffic
> Permissions allow-list blocks `landingos.onrender.com`**, so browser pixel
> events are dropped on every device (Meta's own console warning names it);
> the user must allow the domain in Events Manager.
>
> ### ✔ LB.41 IS DEPLOYED — 14 Aug 2026
>
> **`origin/main` is `c3b1917`** (`ce883f1..c3b1917`, three commits — the
> locale fix plus its two doc records, **no migration**). Live 2m50s after the
> push. Baseline captured on a throwaway production fixture BEFORE pushing,
> using a FRENCH session against an Arabic-default tenant:
>
> | Marker | Before | After |
> |---|---|---|
> | `Store name` (English leaking onto a French account) | **1** | **0** |
> | `Nom de la boutique` | **0** | **1** |
> | integrations header `Managed by` → `Géré par` | **0** | **1** |
>
> All three locales verified on the live screens: fr *Nom de la boutique /
> Enregistrer*, ar *اسم المتجر / حفظ*, en unchanged; integrations headings and
> status cells translated in fr and ar.
>
> **One `Managed by` remains in the served HTML and it is EXPECTED** — the
> `<th>` is now `Géré par`; the leftover is the `<label>` inside the create
> panel (`components/console/platform/tracking-write.tsx`), one of the six
> strings §LB.41 records as deliberately not fixed. Check the `<th>`, not a
> bare grep, before concluding the deploy missed something.
>
> **Regression sweep after:** health green · LB.40's robots.txt unchanged ·
> LB.14a's wilayas `no-store` · LB.37's console `noindex` · root 307 ·
> `/console/settings/store` and `/console/settings/integrations` both 200 with
> the form still rendering · `/console`, builder pages, team, profile and
> domains all 200. Fixture swept with `deleteTenant` (3 rows, 2 passes); the
> three real tenants untouched.
>
> ### ✔ LB.40 IS DEPLOYED — 14 Aug 2026
>
> **`origin/main` is `0286f99`** (`c89b19b..0286f99`, two commits, **no
> migration**). Live 2m45s after the push. Baseline captured on a throwaway
> production fixture BEFORE pushing:
>
> | Marker | Before | After |
> |---|---|---|
> | `Googlebot` in `/robots.txt` | **1** (the old static file) | **0** |
> | `Bingbot` / `Twitterbot` / `facebookexternalhit` | present | **0** |
> | `Disallow: /console/` | **0** | **1** |
> | `Disallow: /api/` | **0** | **1** |
> | `Sitemap:` on the platform host | absent | **absent** (correct — naming one would be the tenant roster) |
>
> A forged `X-Forwarded-Host` was re-checked against production and still adds
> no `Sitemap` line. **The custom-domain branch could NOT be exercised in
> production and that is expected, not a gap:** Render answers 403 at the edge
> for any hostname not configured on the service, so a verified custom domain
> cannot reach the app at all yet (LB.14c). It is covered by tests locally,
> both the verified and the unverified case.
>
> **Full regression sweep after the deploy, all intact:** health green on four
> checks · LB.14a's five cache paths unchanged (`no-store` on the quote and
> thank-you, `max-age=60` on the public page, console and root untouched) ·
> LB.37's console `noindex` and a storefront serving `index, follow` with the
> merchant's own `<title>` · LB.39's sitemap listing home + visible category +
> published page · LB.38's Delete control offered on the order-free page ·
> LB.35b's `tracking-mode-all` present in the editor.
>
> ### ✔ LB.35b IS DEPLOYED — 13 Aug 2026 (late night)
>
> **`origin/main` is `407854a`** (`2c75c3c..407854a`, two commits, **no
> migration**). Live 2m30s after the push. Baseline captured on a throwaway
> production fixture BEFORE pushing:
>
> | Marker | Before | After |
> |---|---|---|
> | `tracking-mode-all` in the editor | **0** | **1** |
> | `tracking-mode-choose` | **0** | **1** |
> | Integrations description | *"Tracking pixels and webhooks."* | *"Which of your tracking pixels report this page."* |
>
> **Then driven for real in the production editor**, not just read out of the
> markup: switched to "choose" (both active pixels arrived pre-ticked, the
> inactive one listed and marked `inactif`), unticked TikTok Oran, saved. The
> production database stored `["<Compte Alger id>"]`, and **the production
> storefront then served that pixel and not the other** — the inactive one
> stayed out throughout, since the resolver filters `isActive` first.
>
> **One thing checked because it looked wrong and was not.** The Arabic phrase
> "the whole workspace" still appears after the deploy. It is NOT the deleted
> signpost — `integrationsBody` is gone from the payload entirely. The match is
> `settings.integrationsHint`, a different key on the settings screen, which
> should stay. Worth knowing before someone greps for it and concludes the
> deletion failed.
>
> Cleanup: `deleteTenant` swept 6 rows in 2 passes, fixture user removed
> separately, both real tenants untouched, storefront and sitemap now 404.
> Health green; LB.14a's wilayas marker, LB.37's console `noindex` and LB.39's
> sitemap route all re-checked and intact.
>
> ### ✔ LB.38 + LB.39 ARE DEPLOYED — 13 Aug 2026 (late night)
>
> **`origin/main` is `964755b`** (`2f009aa..964755b`, four commits, **no
> migration** — nothing under `packages/db/prisma` in the range). Live 3m10s
> after the push. Three baselines were captured on a throwaway fixture BEFORE
> pushing, and all three flipped:
>
> | Marker | Before | After |
> |---|---|---|
> | `/{tenant}/sitemap.xml` | **404** (no route) | **200** `application/xml`, 4 URLs |
> | `page-delete` in the pages list | **0** | **3** — the three order-free rows |
> | `HAS_ORDERS` in the error map | **unmapped** | **mapped** |
>
> **LB.39 on production:** absolute `https://` URLs on the real host; home,
> visible category and published pages listed; **hidden-cat, secret-draft,
> retired-item, the `published:true`+`status:DRAFT` half-state, and thank-you
> all absent**; `Cache-Control: private, max-age=60, must-revalidate`
> inherited from LB.14a's rule exactly as the route's comment says it should
> be; unknown tenant 404.
>
> **LB.38 on production, per row:** Half State (0 orders) delete YES · Secret
> Draft (0) YES · **BBB Has Orders (1) delete NO, archive YES** · AAA Never
> Sold (0) YES. Then exercised both paths for real: `DELETE` on the order-free
> page **succeeded and removed it from the DATABASE** (state afterwards lists
> four pages, none of them it — not an archived fifth), and `DELETE` on the
> page with an order **refused 409 `HAS_ORDERS`** naming Archive.
>
> **The two slices agree with each other, which is the check worth keeping:**
> the sitemap re-fetched straight after the delete had dropped that page,
> because both read the same publication predicate rather than two copies of
> it.
>
> Cleanup: `deleteTenant` swept 9 rows in 2 passes, fixture user removed
> separately, 0 landing pages left, both real tenants untouched, storefront
> and its sitemap now 404. Health green; LB.14a's wilayas marker and LB.37's
> console `noindex` both re-checked and intact.
>
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
| `a8f871e..da971fb` | **16 Aug 2026: LB.46** — the console's View and Copy Link speak the tenant's verified primary domain (`isPrimary` finally gets its reader; `lib/console/public-page-url.ts`). One commit, no migration. Verified with two prod fixtures: the with-domain screen flipped to the domain href (editor payload included), the no-domain screen unchanged, zero cross-tenant leakage |
| `cc87b0b..0aa0eae` | **16 Aug 2026: LB.45** — a custom domain's paths are the shop's own (host-conditioned rewrites inserting a `__domain__` sentinel; sitemap + robots speak the bare shape via `storefrontHref`). One commit, no migration. Verified on the REAL domain `selliora1.com`: `/robe` flipped from store-home to the landing page with the order form, `/category/watches` 404→200, root 307→200, robots naming the bare sitemap; nine platform-host regression checks intact |
| `3fc1ade..4742554` | **15 Aug 2026 (evening): LB.42 + LB.43 + LB.44** — write-panel i18n (+two guard fixes), server events carry `event_source_url`, and the storefront LCP fix (the whole-page framer fade deleted; CSS entrance; `fetchPriority="high"` hero; description images all lazy). Five commits, fast-forward, no migration (empty `migrate diff` against `landingos_prod` before the push). Verified by the PUBLIC LB.44 marker flips on the real page + a throwaway-fixture authed check of LB.42 + a real Lighthouse before/after (50→75, LCP 5.8→3.4s, Render Delay 2,479→34ms) |
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
   comparisons (PM.10), builder list pagination, UI.7 settings i18n
   residue, calculator step structure (UI.8), bulk-bar mobile collapse (it
   scrolls away now but is still a tall card when reached), and the three
   decisions in `EDITOR_I18N.md` §3 (the dead `rtl:` Tailwind variant,
   `ui/sheet.tsx`'s physical close-button edge, the redundant French shipping
   gloss). **Benefits/FAQ (LB.12) is DONE** — it was left on this list in
   error and is removed here. **LB.11 is CLOSED (15 Aug):** the user's real
   pixel + CAPI token on the real store (`selliora16`), two live checkout
   orders, and Meta's dataset stats recording **Purchase ×2, Lead ×2**
   server-side — CHANGELOG §LB.11 has the record, including why the user's
   own manual check looked like a failure (no test code → Test events tab
   empty; stats lag ~35 min; their browser's pixel blocked).

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
- Anything involving the worker, Web Push on a real device, or real carrier
  endpoints — unchanged from BUILDER_HANDOFF §11's honest list. **Real
  tracking credentials are NO LONGER on this list:** LB.11 closed 15 Aug —
  the user's real Meta pixel + CAPI token on `selliora16`, Purchase ×2 and
  Lead ×2 confirmed received by Meta's dataset stats (CHANGELOG §LB.11).

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
3. **Confirm `origin/main` still equals `d26074c`** (`git fetch && git log
   --oneline origin/main -1`) — if it moved, someone else deployed; re-read
   the situation before assuming this document's state. **The check that
   tells you whether anything is waiting:
   `git diff origin/main <your local branch> -- apps packages`. Empty means no
   application code is queued; non-empty means something is.** Do not trust the commit
   COUNT any
   handoff quotes — this one said "sixteen" and the real answer was eighteen
   by the time it was read. Derive it: `git rev-list --count origin/main..main`.
   **The local branch is now `main`, tracking `origin/main`** (renamed from
   `master` on 17 Aug, so a plain `git pull` works — older notes here saying
   `master` predate that).
   **To confirm what is actually LIVE rather than merely pushed**, the
   authority is the Render API, read-only:
   `GET https://api.render.com/v1/services/srv-d9jn1kkm0tmc73bb8nt0/deploys?limit=5`
   with `Authorization: Bearer <render key>` — the entry whose `status` is
   `live` carries the deployed `commit.id`. **Use this whenever the range has
   no public marker**, which is the normal case for server-only or
   console-only work; `/api/health` cannot answer the question (no SHA).
   The stale worktree at `.claude/worktrees/interesting-herschel-ceeb8f` sits
   at `fecc4ff`, an ancestor of master — fully merged, and it still holds its
   own stale copies of these docs saying "not deployed". It can be removed.
4. **SEVEN LOCAL COMMITS ARE QUEUED as of 18 Aug — see the ⚠ block at the
   top of §1: LB.55, AN.1, JS.1, the night's docs, AN.2, the §BH scoping,
   and BH.1+BH.2. ⚠ ONE migration for the batch (AN.1+AN.2+BH.1
   together): db push + apply-rls 49→50 BEFORE the app deploy. BH.3 is
   blocked on a spend-quota system by the user's decision. The push is
   the user's decision.** Before that batch: SEC.1–SEC.5 + SA.1
   DEPLOYED 17 Aug as
   `c3d911d..d26074c`, live 14:35:35 UTC, confirmed at Render on 18 Aug
   (§1's top block has the full record, including the three checks that are
   now closed-UNVERIFIED because `landingos_prod` is off-limits).
   LB.24+LB.54 DEPLOYED 16 Aug (night) as
   `1dbe119..c722050` (§1's top block has the record and the owed live
   checks), LB.51+LB.52+LB.53 earlier the same day (afternoon) as
   `831c48d..d915c77`; §1's top block has the record, including what is
   still OWED live (warm PSI after-numbers, the LB.35b subset re-check, a
   checkout e2e) because that deploy session had no route to production.
   LB.48+LB.49+LB.50 went the same morning as `cf5c554..1067984`; that
   record holds the operational discovery that a deploy wipes the
   image-optimizer cache (judge production Lighthouse only on WARM runs —
   the cold first run after that deploy scored 47/LCP 10.6s and the warm
   rerun 77/3.3s, which is also the likely explanation of the user's
   original PSI 66/6.5s report).**
   Everything LB.42–LB.50 shipped over the 15–16 Aug weekend; §1 has each
   record. `git diff origin/main master -- apps packages` is the check
   that nothing is waiting; no migration is pending. LB.45
   went earlier the same day (`cc87b0b..0aa0eae`), LB.42–LB.44 the evening
   before (`3fc1ade..4742554`). `git diff origin/main master -- apps
   packages` is the check that nothing is waiting; no migration is
   pending. One data note for the user: `/category/watches` lists empty
   because the `robe` page has `categoryId: null` — assigning the page to
   the category in the editor fills the listing; not a defect.

   **LB.41** (`94b6a40`) shipped on 14 Aug as `ce883f1..c3b1917`, and **LB.40** (`f1e38bf`) earlier the same day as
   `c89b19b..0286f99`. Neither carries a migration; both verified live — §1 has the records.

   **LB.35b** (`dd4edac`) shipped on 13 Aug
   (late night) as `2c75c3c..407854a`, no migration, verified live — §1 has
   the record.

   **LB.38** (`a70f588`) and **LB.39** (`dbe1cf0`) shipped together on 13 Aug
   (late night) as `2f009aa..964755b`, no migration, verified live — §1 has
   the record. Everything before them shipped earlier the same night
   — LB.31–LB.36 + LB.15 + LB.14a/b/c (`bd6d664..d6a56b1`) and LB.37
   (`fcbd1e5`). §1 has the records, the markers and the corrections they
   produced. No migration is pending; RLS is 49/49.
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
