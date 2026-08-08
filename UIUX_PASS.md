# UIUX_PASS — the dedicated UI/UX refinement pass

**Date:** 8 August 2026 · **Baseline:** `1f988b5` (master, clean tree, post-LB.10)
**Scope:** presentation and product quality across the ERP console, the Builder
console and the editor. No business logic, no tracking/webhook/database
architecture, no RBAC/RLS, no deployment configuration was changed. Nothing was
deployed and nothing was pushed.

This document is the handoff for THIS pass and is deliberately separate from
`BUILDER_HANDOFF.md` (the product handoff) and `UI_UX_AUDIT.md` (the Phase UI
measurement). Read those for the platform's history; read this for what the
UI/UX pass changed and what it left.

---

## 1. What the audit actually found

The brief expected an empty dashboard, grey typography and an unpolished dark
mode. The live audit (real browser, light+dark, 375/768/desktop, fr/ar) found
that the **ERP console is already strong** — Phase UI built the design system
(tokens, surfaces, focus, density, tables) and Phase PM rebuilt the ERP
dashboard as an operational screen. Those findings did not reproduce there.

Where the product stopped looking commercial was the **Builder console and
editor**, which the LB phase made *work* end to end but never brought onto the
design system's standards. And the two worst findings were functional, visible
only in the running page — the exact class (`BUILDER_AUDIT` §3: vocabulary
drift across a boundary, green suites throughout) this project has caught nine
times:

1. **Saved variants arrived in the editor with every option label blank.**
   `toPreviewState.groupVariants` (`src/lib/landing/mappers.ts`) emitted
   `options[].value` (the DB column) where the editor's `VariantGroup`
   vocabulary is `options[].label`, and no group `id`. Observed live: a
   published page with real variants ("Couleur: Noir/Blanc", "Garantie:
   Standard/Étendue") opened with empty option inputs, the preview rendered
   every option as "—", and re-saving was blocked by the section's own "every
   option needs a label" validation until the merchant retyped everything.
   The rename now happens exactly once, in the mapper, with a comment naming
   the rule.
2. **Every published page showed "Unsaved Changes" the moment it opened.**
   Each editor section lifts its initial values to the workspace in a mount
   effect, and the workspace counted those mount-time lifts as edits. Fixed by
   arming the unsaved tracking in the workspace's own mount effect — child
   effects run before the parent's on mount, so the initial lifts pass through
   unarmed and the first REAL edit is the first one counted
   (`edit-workspace.tsx`).

Both fixes were verified in the running editor afterwards: labels load, the
preview names the options, the badge stays away until something is touched.

---

## 2. What changed in the ERP

Deliberately little — the ERP had two dedicated passes already. Two additions:

- **The order detail gained its sticky summary strip (PM.9).** Eleven sections
  and ~2,600px of page put the status and the primary action a screen apart.
  A sticky strip under the console header now carries the reference, status
  pill, customer, phone, total and an "Actions" jump link to the write panels
  (`#erp-order-write`, with `scroll-mt` so the target does not hide under the
  sticky bars). Verified sticking at 64px on scroll, wrapping cleanly at
  375px, no horizontal overflow. The sticky offset uses the `_`-separated
  `calc()` form — the Tailwind rule Phase UI documented.
- **Notification rows now carry their timestamp.** `createdAt` had been on
  every feed row since M-16 and was rendered nowhere, so "suspicious call"
  from ten minutes ago and from last Tuesday read identically. The panel now
  formats it client-side (time-only for today, date+time otherwise) in the
  console's locale, passed as a prop like every other string
  (`notification-provider.tsx`, `console-shell.tsx`).

Reviewed and deliberately NOT changed: the dashboard (PM.1 already gives it
attention/KPIs/trend/rankings), tables (UI.2), typography and the
grey-vs-disabled distinction (PM.6 closed it at token level, verified live),
navigation grouping (manifest-declared since UI.1).

## 3. What changed in the Builder

- **The overview was rebuilt as a merchant's morning screen** — the same
  argument as PM.1, applied to this product. It had been four bare tiles, one
  labelled "Delivered" while showing revenue. Now: (1) a **Needs attention**
  panel — new orders to confirm, abandoned carts holding a phone number,
  unpublished drafts — rendering only non-zero items, each linking to the
  screen that handles it, with a success notice when clear; (2) correct KPI
  tiles (pages/published, orders/delivered, abandoned, **Delivered revenue**
  properly labelled); (3) a **Recent orders** list, each row opening its
  record; (4) a first-run empty state with a "Create a page" CTA when the
  workspace has no pages. Order figures are gated on
  `website-builder:orders:read` — the permission the destination screens check
  (D-PM.A).
- **Every builder table got real column headers.** The lists had reused
  whatever nav i18n key was lying around: the orders list's quantity column
  was headed "Create", its total "Orders", its destination "Delivery prices";
  the pages list's price column said "Delivery prices"; four screens hardcoded
  English "Status". All headers now name what the cell holds, from new
  `builder.pages.col*` / `builder.orders.col*` / `builder.abandoned.colSeen` /
  `common.status` keys, translated in en/fr/ar.
- **The pages list** shows `updatedAt` (was `createdAt`) under the status,
  uses `PageHeader`, and renders a real first-run empty state with a create
  CTA instead of a bare table shell.
- **The orders list finally links to the order detail.** The detail screen has
  existed since the port and the list never opened it — it was reachable only
  from a notification or by typing the URL. The customer cell is the row's
  door now.
- **The order detail** moved onto the shared primitives (`PageHeader` with
  breadcrumb, `Section`, `DescriptionList`) and its nine hardcoded English
  labels ("Phone", "History", "This order has reached a final state.", …) are
  i18n keys. The terminal-state sentence carries a `data-final-state` hook and
  the contract suite asserts the hook rather than the English wording.
- **Templates** explains itself when empty: what a theme is, where it is
  chosen, and that themes appear here with a live colour sample — instead of
  one muted "No data" line. No create control, because authoring themes is
  genuinely not a capability yet (M-19).
- **The new-page form's** labels, hints and validation messages are i18n keys
  (`builder.newPage.*`), and the screen has a breadcrumb.
- **The console front door** ("Choose an application to open.") and the
  product switcher's empty state are translated.
- **The language selector applies itself on change** (found from a real user
  report after the pass shipped). Choosing a language in the header dropdown
  did NOTHING until the small ✓ icon beside it was also clicked — the form
  only submitted on that second step, so "switching to Arabic" silently
  switched nothing, while every scripted verification had clicked the button
  and passed. The select now calls `form.requestSubmit()` on change; the ✓
  stays for the pre-hydration path, so the no-JS guarantee is intact. Two
  regression tests in `console-shell.test.ts` pin the server half (each
  `locale` cookie renders its language and direction, with the switcher
  showing the cookie's own value; an unknown cookie falls back rather than
  500s); the client half — dropdown alone, no ✓ — was driven in a real
  browser through en → ar → fr → en, each leg changing cookie, `lang`, `dir`
  and the rendered text.

## 4. What changed in the design system

Nothing structural — that was the right outcome, not an omission. The system
Phase UI built (tokens, surfaces, elevation, focus, `PageHeader`/`Section`/
`Stat`/`EmptyState`/`DescriptionList`, `.ui-btn`/`.ui-control`) was complete;
the builder screens simply were not using it. This pass brought them ONTO it,
which is what "every screen feels like one product" required. Additions were
confined to the i18n catalogues: ~60 new keys under `builder.*` and `common.*`,
in all three locales, with the parity suite green.

## 5. What changed in the dashboards

- ERP dashboard: nothing — audited against the brief's checklist and it
  already answers it (alerts with destinations, period KPIs with comparisons,
  trend, agent/carrier/product rankings, stock alerts, recent orders).
- Builder overview: rebuilt (see §3).

## 6. What changed in the Builder preview

- The variant fix (§1) is most of it: the preview now renders the real option
  names and prices instead of a column of "—".
- **The hero empty state teaches instead of shrugging** — "No hero image yet /
  Add one in Images & Media — it becomes the top of the page and the social
  share image" instead of a bare icon in a grey box.
- **The two permanently-disabled buttons under the preview are gone.**
  "Refresh" refreshed nothing (the preview is live state); "Open" now renders
  only when the page is published, as a real link to the public page.
- `preview-placeholder.tsx` ("Live preview coming soon") was dead code
  imported by nothing and is deleted.
- The full-fidelity drawer preview (real `LandingTemplate` + theme) was
  already correct and is untouched.

## 7. Responsive QA

Measured in the running page (document `scrollWidth` vs `clientWidth`, per
screen), not inferred:

| Width | Result |
|---|---|
| 375px | No horizontal overflow on: builder overview, pages, orders, order detail, templates, editor (casque page), ERP dashboard, ERP orders (table scrolls inside its own container), ERP order detail (strip wraps to three rows and stays sticky) |
| 390px | Same layout tier as 375 — no distinct breakpoint between them in the system; spot-checked via 375 + desktop |
| 768px | Sidebar appears (`md:`); tables gain room; no overflow observed |
| Desktop (1280) | All screens verified during the walkthrough |

The mobile drawer (UI.1) covers navigation below 768px; the editor's preview
moves to the drawer sheet on small screens as before.

## 8. Light/dark QA

Both themes drive from one token set (`packages/ui/src/tokens.css`), and every
new element uses tokens (`bg-surface-raised`, `toneVars`, `shadow-e2`) — so
the new surfaces were verified in both themes rather than restyled per theme:
builder overview (attention cards, tiles, recent list), order summary strip,
templates empty state, notification timestamps. The editor inherits the same
tokens (measured: page `oklch(0.14)`-ground, raised cards, readable inputs in
dark). No hardcoded colours were added; the two amber/emerald literals in the
editor's status badges predate this pass and are recorded in §11.

## 9. Tests before / after

Baselines are LB.10's recorded numbers plus a fresh pre-change run of
builder-sections (50/50 against the untouched build). All runs per file,
`ERP_CONTRACT=strict`, against the running rebuilt server.

| Suite | Before | After |
|---|---|---|
| `builder-sections` | 50/50 | **50/50** |
| `builder-api` | 23/23 (LB.10) | **23/23** |
| `console-shell` | 14/14 (LB.10) | **16/16** (two locale-resolution regression tests added with the switcher fix below) |
| ERP `screens` | 173/173 (PM) | **173/173** |
| `packages/i18n` | 20/20 | **20/20** (with ~60 new keys, parity asserted) |

One red run is recorded rather than hidden, per the house rule: the first
`screens` run cancelled all 173 in its before-hook on *"Can't reach database
server at ep-…neon.tech"* — the documented Neon transient, nothing to do with
the changes — and passed 173/173 on the immediate rerun.

One assertion was UPDATED, not weakened: the builder order detail's
terminal-state sentence became an i18n key, so
`assert.match(html, /final state/i)` became
`assert.match(html, /data-final-state=/)` — the same property (the limitation
is stated on the page), asserted structurally instead of against English
wording.

**And the suite caught a defect in this pass's own first build — recorded
because the method matters more than the fix.** The rebuilt builder overview
initially fired nine parallel counts through `forTenant`, each opening its own
binding; the manifest nav-walk test (LB.4's guard) failed it with a 500 on the
documented Neon connection limit, twice, reproducibly — while the same page
rendered fine in a quiet browser. The fix is D-PM.1.3 applied to this product:
ONE `withTenant` binding, and one `groupBy` per table answering what four
counts asked.

**A correction this document owes its reader.** The first version of this
section claimed the post-fix 50/50 ran "against the rebuilt server". It had
not: the rebuild had silently failed (see §10) and that green run executed
against the UNFIXED overview on a quieter connection pool — which also says
the nav-walk failure is load-sensitive rather than deterministic. The claim
became true only after the failure was found and the real rebuild shipped:
against build `b6K_s8UJn8I1fq5N42rmZ` (the one carrying every change in this
document) the suite ran 49/50 once — the single 500 being a media `PUT` on a
route this pass never touched, the shared-Neon one-off pattern — and 50/50 on
the immediate rerun, with the browser walkthrough repeated against that same
build.

## 10. Build

Final build: `b6K_s8UJn8I1fq5N42rmZ`, exit 0 **read from the command's real
exit code**, standalone mirrored byte-for-byte, served and verified end to end
in the browser (the build id was confirmed IN the served HTML).

Three operational traps this pass hit, each worth more than the fixes:

1. **A piped build lies about failing.** `npm run builder:build | tail -3`
   reports the PIPE's exit code — tail's, which is 0 — so a build that failed
   instantly (wrong cwd: `builder:build` exists only in the ROOT manifest)
   read as "completed, exit 0", and a server restart then served the PREVIOUS
   build with every suite green against it. Found only because the running
   product was checked against the working tree. Never pipe a build; read its
   real exit code, and verify the BUILD_ID changed.
2. **A shell whose cwd is inside `.next` blocks the next build.** Windows
   locks a directory that is any process's working directory, so `next build`
   dies with `EBUSY: rmdir .next\server` if an inspection shell is still
   sitting there. `cd` out before rebuilding.
3. **A `builder:start` racing the build's standalone copy** can catch a
   half-written `node_modules` in the bundle — if the server dies with
   `MODULE_NOT_FOUND` inside `.next/standalone/node_modules/next`, delete
   `.next/standalone` and rebuild; never kill a build mid-tracing.

## 11. Remaining issues and missing backend capabilities

Honestly out of scope for a UI pass, each needing its own slice:

1. **Notification titles are English at any locale** ("New order ORD-0024").
   The text is authored at WRITE time by the notifiers and stored as strings,
   so the console cannot translate it. Making them locale-aware means storing
   a key + params instead of prose — a backend change to M-16's writers.
2. **The editor speaks English** (54 components: section titles, hints,
   validation). Recorded as LB.13 in NEXT_STEPS; this pass deliberately did
   not start a 54-component translation mid-flight. The editor is at least
   internally consistent, and the storefront-facing half is already Arabic.
3. **Benefits and FAQ are honest "Coming Soon" stubs** — LB.12; routes and
   editor sections do not exist, so no UI could represent them truthfully.
4. **Templates depend on seeded theme rows.** The acme tenant has none, so the
   gallery shows the (new) empty state. Whether built-in themes should be
   seeded per tenant at signup is a product/backend decision (M-19).
5. **Analytics has no period comparison** — PM.10; the arithmetic exists in
   `lib/erp/dashboard.ts` and wiring it is a slice of its own (it is also the
   slowest screen, and `performance()`'s single-pass `groupBy` is the fix).
6. **`settings/integrations` and `settings/delivery-prices` body copy** is
   still English (~15 strings) — UI.7's residue, a translation task.
7. **Abandoned-cart drafts with an empty-string phone** count as "with a
   phone" in the overview's attention card if a capture ever writes `""`;
   observed data writes null, so this is theoretical.

## 12. REMAINING UI/UX WORK

In rough order of value:

| # | Item | Size | Why |
|---|---|---|---|
| 1 | Editor i18n (LB.13) | M | The largest remaining "one product" gap: an ar/fr console opens an English editor |
| 2 | Notification write-time i18n (§11.1) | M | The bell is translated; what it says is not |
| 3 | Analytics comparisons + `performance()` consolidation (PM.10) | S | Wiring that exists; also a 3.7s → ~2s screen |
| 4 | `ConsoleShell` into `console/layout.tsx`, then `loading.tsx` per segment (UI.6) | M | Still the only thing blocking real route-level loading states |
| 5 | Builder orders list: pagination + filters | M | The ERP lists page and filter; the builder's are capped first-50 reads — same `<Pager>`/`<FilterBar>` primitives, one afternoon each |
| 6 | Quick search on a phone (PM.11) | S | Still `hidden md:block`; a drawer search item is the likely shape |
| 7 | Editor money inputs off `type="number"` (LB.15) | S | D-06 style residue in the pricing section |
| 8 | UI.7 settings i18n residue (§11.6) | S | Translation, not design |
| 9 | Editor status badges onto tone tokens | S | Two Tailwind literals (amber/emerald) predate this pass; harmless but off-system |
| 10 | Calculator step structure (UI.8) | M | Unchanged: tokens yes, shape no |

---

## Method note for the next session

Every defect this pass fixed was found by USING the running product, not by
reading it — the variant drift and the unsaved-badge lie were invisible to 151
green tests because both live between the browser and the API. The pass ends
the way the project's own rule demands: rebuilt, re-driven in a real browser
at two widths, two themes and two locales, suites re-run per file.
