# FEATURE_PASS — 12 August 2026, the dead-code deletion and the feature queue

**Status: DEPLOYED TO PRODUCTION 12 Aug 2026 (evening), user-approved — the
range `b767928..e3939e9` including this pass, LB.25, LB.26 and the LB.20
migration. `HANDOFF_PRODUCTION.md` §1 is the deploy record.** The lines below
describe the state as of the session itself; the hold banners in §4/§5 are
each superseded by a dated update in place. Original status at time of
writing: local only, feature commits `93c4f00..e49ba19` on `master`,
`origin/main` at `b767928`.

**Method:** the standing order, per slice — measure → fix → test → verify live
in the running app → commit → document, before starting the next.

> **Read §5 first.** It carries three decisions taken AFTER this session:
> LB.20's production migration was **held off, then executed 12 Aug 2026
> with user approval** (see the update in §5), LB.23 is **decided but
> blocked** on a Meta Developer App, and LB.24 is **on hold**.

**Where else this pass is recorded.** This file is the session-level record —
the defect list, the database state, the decisions. The per-slice history lives
where the project's other slices live, and was backfilled on 12 Aug:
`PROJECT_STATE.md` (tracking table, *After the phase was declared complete*)
and `NEXT_STEPS.md` (queue rows plus a narrative section per slice, in the shape
LP.16 uses). `CHANGELOG.md` carries the entry with the migration and risk.

---

## §1 WHAT SHIPPED

| Slice | What it is | Suites |
|---|---|---|
| **LB.16** | The ten dead legacy components, deleted | i18n 22 · builder-sections 58 · console-shell 20 · storefront 32 · builder-api 23 · hardening 12 · webhooks 10 · tracking 15 |
| **LB.17** | Back-navigation on the ERP client and product detail screens | erp/screens 173 |
| **LB.18** | The finance module can be switched off per tenant | erp/finance 44 · erp/screens 173 · registry 36 |
| **LB.19** | Product categories in the ERP catalogue | erp/catalog 75 |
| **LB.20** | Per-product delivery pricing (schema + API + storefront + editor) | builder-sections 72 · storefront 32 · packages/db 33 |
| **LB.21** | Landing pages publish into the ERP catalogue | builder-sections 72 |
| **LB.22** | A storefront theme generated from a product image | builder-sections 72 |

Every suite above was run per file against the running server, and every slice
was verified by driving the real screen — not by reading the code.

---

## §2 WHAT EACH SLICE ACTUALLY DID

### LB.16 — the ten dead components (PART 1)

Re-confirmed unreachable three ways before deleting: a repo-wide search for the
filenames; a second for their exported SYMBOLS, because a file can be imported
under a name that does not match its path; and a fresh import-graph walk from
every entry under `app/`. Every hit was one of the ten importing another, or a
mention in a document.

The i18n guard's exemption for `media-picker-dialog.tsx` went **with the file**
rather than into an empty set — its own comment said deleting the file should
delete the line. `components/landings/` now holds exactly one thing: `edit/`.

**Left, deliberately:** `toListItem` in `mappers.ts` and the `LandingListItem`
type are now fully orphaned. `toListItem` was in fact **already dead before this
deletion** — nothing imported it. `VariantGroup`/`VariantOption` in the same
module stay live, so `mock-landings.ts` must not be deleted wholesale. A smaller
separate cleanup, not a widening of a deletion the instruction named exactly.

### LB.17 — the way back out of a record

The report was "opening a client has no way back". The measurement was sharper:
there WAS a link — 44×20 px of muted text reading "Clients", no arrow, no
"back", sitting **after** the title and after the dial button, measured at
x=294 beside an `h1` at x=16. It reads as a tag ON the record, not navigation
OFF it.

**The check you asked for found the cause.** `PageHeader`'s own comment says its
breadcrumb exists "to replace three different hand-written back links (the order
detail's, the client detail's, and the product detail's absence)" — UI.22 built
the primitive and migrated only the order detail. Both screens use it now, so
all four list-then-detail pairs in the console navigate the same way.

### LB.18 — the finance module becomes optional

The mechanism already existed: `ProductSetting` keyed (tenant, product, key),
a route that validates against `SETTINGS_SCHEMA`, and a settings screen that
builds its controls **from that same table** — so declaring `financeEnabled`
made the switch appear, labelled and translated, with no edit to the page.

Four things make "removed" mean something: the nav loses Finance **and** the
Calculator (it writes the records the books are made of); both screens 404 on a
typed URL; all nine finance handlers refuse with `FINANCE_DISABLED`; and
**nothing is deleted** — `FinancialRecord` is append-only by design, so a switch
that shredded it would be the one irreversible action on this platform. The
regression test switches the module off around a real saved record and asserts
it is still there after switching back on.

The shell is handed **ids**, never knowledge. `hiddenNavIds` is product-agnostic;
that "finance" and "calculator" are one module lives in `lib/erp/settings.ts`
and is applied by the ERP's own segment layout. A `switch (product.id)` in the
shell is exactly what the manifest contract exists to prevent.

### LB.19 — product categories

Half the request was already done: `LandingPage` has had a `Category` relation,
a management screen and a picker since B3. Products had free text with nothing
around it.

**I did not convert it to a relation**, and that is a decision — see §5.

One duplication closed on the way: the products screen and `GET
/api/erp/products` each built their `where` by hand under a comment promising
they could not disagree. Both call `productWhere` now, and a test asserts the
screen and the route return the same set for the same query string.

### LB.20 — per-product delivery pricing

**You asked me to check the schema first.** It did not support this:
`TenantDeliveryPrice` is unique on `(tenantId, wilayaId)`, so a company had
exactly one price per destination.

A second table rather than a nullable `landingPageId` on the first, because the
existing uniqueness is what makes "the company's price for Alger" a single fact,
and a nullable column would make NULL mean "default" — and Postgres NULLs are
not equal to each other, so the constraint would stop preventing duplicate
defaults.

**The load-bearing part is that one function answers both questions.** Two
endpoints read delivery prices — `/wilayas` fills the destination dropdown,
`/orders` prices the sale — and each built its own query. A per-product price
reaching one and not the other would bill customers something other than what
they were shown, and no suite over either route alone would notice. Verified
live: a 1500 override on a 2900 product produced an order totalling **4400**,
not the 3300 the company rate would have given.

### LB.21 — publishing into the catalogue

`CatalogProductLink` already models "this catalogue row IS that external
product", so it is the idempotency key. **Adoption** is the part that protects
an existing catalogue: a naive importer gives a merchant who already typed their
products in TWO rows per product, and two rows answering to one normalised name
make every order naming it attributable to **neither**.

The Manager's own columns survive an import — `costPrice`, `packagingCost`,
`stock`, `threshold`, `supplier` are facts a manager maintains, and resetting a
cost basis to zero would corrupt every profit figure derived from it.

### LB.22 — a theme from the product image

The hard part is not finding the colours; it is that the result must be
**readable**. A generated theme that puts white text on a pale yellow buy button
ships a broken storefront and the merchant finds out from their conversion rate.
The two colours that carry text are chosen by WCAG contrast; the test asserts
≥ 4.5 on both pairs, computing the ratio independently of the implementation.

An image with nothing to take (a white cutout) is **refused**, because inventing
a plausible theme from no evidence is the worst outcome — it looks like it
worked.

---

## §3 DEFECTS FOUND AND FIXED ALONG THE WAY

Nine, none of which was the feature I was building:

| | Where | Found by |
|---|---|---|
| A schema `@@unique` that omitted `tenantId` | `LandingDeliveryPrice` | the repo's own `constraints.test.ts` refused it |
| A formatting **function** passed Server → Client, 500ing the pages screen | `publish-to-erp` | the server log, after I wasted probes on the wrong hypothesis |
| An effect keyed on `useBuilderApi()`, which returns a new closure per render — so unsaved rows vanished | `shipping-section` | driving the real control; needs two renders, invisible to unit tests |
| A stale `.next/standalone` after an `EBUSY` build, so a "verification" ran an older bundle | build loop | BUILD_ID vs. what the page actually rendered |
| Two screens rendering a raw `<h1>` instead of `PageHeader` | ERP client + product detail | LB.17's measurement |
| The screen/route `where` duplication | products list | reading both while adding a filter |
| A test run piped through `grep \| head` printing ✖ against passing tests | dev loop | a 173/173 suite reporting "pass 0" |
| `packages/db`'s own suite has no `--env-file`, unlike the app's | dev loop | a P1001 that was really a missing env var |
| `erp/tracking` needs the stub bases to pass | dev loop | 12/15 that was environment, not regression |

---

## §4 THE DATABASE

**Dev only. Production untouched, and I have not run anything against it.**

`prisma db push` ran twice against **`neondb`** (confirmed by name before each
run; `packages/db/.env` does not name `landingos_prod`), followed by
`npm run rls` — **48 → 49 tenant-scoped tables**, all four checks 49/49.

> ### ✔ UPDATE 12 Aug 2026 (evening): THE HOLD WAS LIFTED AND THE MIGRATION RAN
>
> **User-approved and executed against `landingos_prod` before the app
> deploy: diff previewed (one table only), push confirmed on the right
> datasource, RLS 49/49, table empty. `HANDOFF_PRODUCTION.md` §1 is the
> record. The paragraphs below are the historical hold as written.**
>
> **(historical) Do not touch production. The dev-only state stands until further notice.**
>
> `LandingDeliveryPrice` is a new table and it exists in **`neondb` (dev) only**.
> The migration is *deliberately* being held off — this is a decision, not an
> oversight, and not a step anybody should "finish" on their own initiative.
>
> The consequence to understand while it is held: **LB.20's code must not reach
> production either.** Deploying it without the table is a runtime error on the
> checkout path — the money path. Since nothing in this pass is deployed and
> `origin/main` is untouched, holding the migration and holding the deploy are
> the same act today.
>
> When the hold is lifted, the two steps, against production, in this order:
>
> ```bash
> npm run push --workspace @landingos/db
> npm run rls  --workspace @landingos/db
> ```
>
> Expect `49/49` on all four RLS checks (it was 48/48). **Neither has been run
> against production.**

**Demo-tenant state I changed and did not fully restore**, all in `neondb`:

- Three catalogue products now exist, created from the demo tenant's own
  published pages by LB.21's first run. Legitimate, and left so the feature is
  visible on review.
- One generated theme ("Phone") from LB.22, left for the same reason.
- The demo page `cmslzzfz70000bs01di9pimga` had its gallery replaced with one
  working image. Its previous rows pointed at uploads that **do not exist on
  this machine** — the first theme generation correctly refused with a 404
  because of it. `seed:demo` restores them if you want.

Everything else I touched was put back: product categories cleared, delivery
overrides cleared, the finance switch returned to on, unsaved editor state
discarded.

---

## §5 WHAT IS NOT BUILT, AND THE CALLS THAT WERE MADE

> **The three items below were decided AFTER this session, in a separate
> conversation.** The decisions are recorded here because this file is the
> record a fresh session reads; the measurement under each one is from the
> session itself and still stands.

### ~~On hold: LB.20's production migration~~ — EXECUTED 12 Aug 2026 (user-approved)

**UPDATE: the hold was lifted with explicit approval and the migration ran
against production before the app deploy — `HANDOFF_PRODUCTION.md` §1. The
paragraphs below are the historical decision as written.**

**(historical) Decision: the production database migration is deliberately
held off for now. The dev-only state stands until further notice.**

`LandingDeliveryPrice` exists in `neondb` (dev) only. This is not an oversight
and not a step to "finish" on your own initiative — the code is written, tested
and verified locally, and the migration is being withheld on purpose.

Because LB.20's code cannot run without the table, **holding the migration and
holding the deploy are the same act**: nothing from this pass is deployed and
`origin/main` is untouched, so there is nothing to reconcile. When the hold is
lifted, §4 carries the two commands and the expected `49/49`.

### Blocked on credentials: LB.23 — Facebook Ads linking

**Decision: build REAL ad-spend attribution via a Meta app + OAuth — not merely
store an account id.** The scoping question the session could not answer has
been answered, and it went to the valuable reading.

**Status: not started. Waiting on the user.** The work cannot begin until a
Meta Developer App exists, because none of it can be built or verified without
one. What is needed:

- a Meta Developer App with the **Marketing API** product added;
- **App ID and App Secret**;
- a **redirect URI** registered for the OAuth flow;
- the **`ads_read`** permission;
- possibly **App Review and Business verification**, depending on how the app
  is used and who it is used by.

What the session measured, still current: `TrackingIntegration` already carries
the Meta pixel + CAPI token (encrypted, `provider: 'meta'`) and has a
`google-ads` provider slot, but **nothing anywhere stores an ad ACCOUNT id** —
`grep` for `adAccount|act_` returns nothing. The destination for the spend is
`FinancialRecord.advertisingCosts`, which a manager currently types by hand.

This is the same honest gate LB.11 records for tracking credentials: it is
untestable on this machine by construction, and that is a property of the
integration rather than a gap in the plan.

**The rejected alternative, recorded so it is not revisited by accident:**
storing the account id alone is an afternoon's work and produces a field
nothing reads — the shape this codebase repeatedly catalogues as a defect ("a
column with a writer and no reader is not done; it is a feature nobody can
use"). It was not shipped as a stand-in for the real thing.

### On hold: LB.24 — AI landing page generator

**Decision: deliberately on hold. Not started.**

The measurement stands and is worth keeping, because it is most of the head
start. The infrastructure already exists and is better than expected:
`AiProvider` (type, baseUrl, encrypted apiKey, model, temperature, maxTokens,
timeout), `AiAgent`, `AiConversationMessage`, provider CRUD routes, and a
console screen. `POST /api/erp/ai/chat` is a **deliberate 501** —
`NO_AI_PROVIDER` when none is configured, `NOT_IMPLEMENTED` otherwise — with a
comment explaining that a box which always fails is worse than a stated gap.

The shape, when it is picked up: a provider-agnostic call built on
`AiProvider`, a prompt that produces the editor's own `PreviewState` shape,
validation of the model's output against the same zod schemas the sections
already use, and a control on the create screen. A genuine slice, and the
largest of the nine originally requested.

**Why the session stopped rather than starting it:** two defects had been
introduced in one slice (§3, rows 2 and 3) and caught only by driving the app.
That is the signal to stop adding surface, not to add the biggest piece of it.

### Decisions I made on your behalf

1. **Product categories stayed free text** (LB.19). The schema states an explicit
   reasoned decision against relations for `niche`/`category`/`supplier`: "a
   niche list is a handful of words per tenant, and a Supplier table would be a
   migration plus RLS plus a management screen for something no route needs to
   join on." Overturning that unasked would have meant a migration on a live
   shared database plus a backfill. I closed the gap the decision left open —
   the field was unguided — instead. **Reversible:** a relation can still be
   added later, and the free-text values are the data it would migrate from.
2. **"Delete the finance module" hides, and destroys nothing** (LB.18). A
   request to stop being shown something is not a request to shred the P&L.
   Reversible by definition, and the test proves it.
3. **The ERP product detail was fixed too**, not just noted (LB.17). You asked
   me to check whether the pattern repeated and note it; the fix was the same
   three lines on a screen I was already in, and leaving a known-identical
   defect unfixed would have been worse.
4. **LB.20's editor UI went into the Shipping section**, saving with the
   methods rather than on its own button — "desk only, and dearer in Adrar" is
   one thought.
5. **LB.22's generated theme is a real row**, not a preview, because
   `LandingPage.themeId` is a relation and a theme that is not a row cannot be
   selected.

### Still open from before this session

`EDITOR_I18N.md` §3 carries three unresolved items from LB.13 — the dead `rtl:`
Tailwind variant (three existing usages emit no CSS), `ui/sheet.tsx`'s
physically-positioned close button, and the redundant French shipping gloss.
None was touched here.
