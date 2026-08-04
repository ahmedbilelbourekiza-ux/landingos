# Next Steps

**Phase 5 and Phase 6 are complete. Phase 7 has started — see §7.**
**7.1 (team management: API + acceptance + screen) is COMPLETE.**
**THE NEXT TASK IS 7.2: billing. See §7.2.**
Immediate tasks to continue from the Phase 7.1c commit. Full context is in
`PROJECT_STATE.md` — read its "Read this first" section before starting.

---

## 0. Before writing any code

```bash
npm install
npm run builder:build
npm run builder:start
```

**Stop node, build, THEN start — in that order, every time.** `next start`
serves a PREBUILT app, so a new route needs a rebuild; and if the old server
still holds :3000 the new one loses the port race *silently* while
`/api/health` keeps answering 200 from the stale process. That cost a full
debugging cycle in 5.3, twice.

Confirm the baseline per suite. The aggregate run is flaky for infrastructure
reasons — see *Known limitations* — so judge these one at a time:

```bash
npm test --workspace @landingos/db                 # 29
npm test --workspace @landingos/auth               # 36
npm test --workspace @landingos/product-registry   # 36
npm test --workspace @landingos/website-builder    # 102 + 266 ERP contract
npm test --workspace @landingos/erp                # 298 (the legacy stack)
```

The ERP contract suite needs the server up. Run it in strict mode, which turns
a skip into a failure, from `apps/website-builder`:

```bash
ERP_CONTRACT=strict node --env-file=.env --test --test-concurrency=1 "test/erp/access.test.ts"
```

Expect **435/435** across the TWELVE files: access 63 · orders 38 ·
validation 29 · listing 25 · catalog 40 · delivery 33 · integrations 29 ·
order-split 8 · screens 96 · jobs 16 · assign 25 · notifications 33.

The platform contract suite lives beside it and runs the same way — **56/56**
(team management 7.1a + invitation acceptance 7.1b + team screen 7.1c):

```bash
ERP_CONTRACT=strict node --env-file=.env --test --test-concurrency=1 "test/platform/team.test.ts"
```

It imports the harness from `../erp/helpers.ts` on purpose. That file is the
app's contract-test harness, not the ERP's; tenants, members, sessions and the
skip-with-a-reason machinery are product-agnostic, and the directory name is
historical in the same way `apps/website-builder` is.

`ERP_CONTRACT=strict` also requires **`WORKER_SECRET`** in
`apps/website-builder/.env`, matching whatever the server was started with.
Without it `POST /api/jobs/tick` answers 404 to everybody and only its refusal
can be tested — which is how 6.5b shipped a tick that could never run a job.

---

## 1. Phase 6.3 is done — what it built

**Every mutation the ERP's SPA can perform now has a control on the platform.**
Twelve screens, all writable where the API allows it:

| Action | Route it calls | Screen |
|---|---|---|
| Start a call, log its result | `POST orders/[id]/call-start`, `/call` | order detail |
| Add a note · classify as fake | `POST orders/[id]/note`, `/classify` | order detail |
| Edit an order, reassign it | `PATCH orders/[id]` | order detail |
| Bulk status / assign / delete | `POST orders/bulk` | order list |
| Book / refresh a parcel | `POST orders/[id]/shipment`, `/refresh` | order detail |
| Create / archive / restore a product | `POST products`, `DELETE`, `/unarchive` | products |
| Adjust stock, add a lot | `POST products/[id]/inventory/adjust`, `/stock-lots` | inventory |
| Configure a carrier, default, status mappings | `POST/PUT carriers`, `/default`, `/status-mappings` | carriers |
| Save a P&L, add / delete a one-off charge | `POST financial-records`, `unexpected-charges` | finance |
| Pay rates, days off, suspend / reactivate | `PATCH agents/[id]`, `/days-off`, `/suspend` | agents |
| Automation rules | `PUT settings` | **automation** (new) |

**`/console/erp/automation`, not `/settings`.** `packages/product-registry`
refuses a product nav item named `settings` — a tenant with N products must still
see ONE Settings, owned by the shell. The name was the defect: every key on that
screen is a rule the ERP applies by itself.

### The pattern to follow for any new write surface

The write primitive is `src/components/console/api-action.tsx`
(`useApiAction`, `ActionError`, `ActionButton`); the field descriptors are in
`src/components/console/{edit-field,setting-field}.ts`; the worked examples are
the five files in `src/components/console/erp/`.

**Anything both sides need goes in a directive-free module.** A value exported
from a `"use client"` module is a client reference on the server, and calling it
throws at runtime while the build succeeds — that cost a cycle in 6.3b.

- **D-06.1. A control calls the API route.** No server actions for product
  writes. A server action is a second write path needing its own copy of the
  permission gate, the ownership guard and the validation — and that copy is the
  half no contract test covers. The builder's order detail shows the cost: it
  re-declares `VALID_TRANSITIONS` in the page.
- **D-06.2. Render a control only where the API would accept it** — decided with
  the same function the route checks (`can`, `mayTouchOrder`, `seesWholeBook`),
  never a second opinion. An agent must not see a reassign control, a delete
  button on a saved P&L, or an edit on a movement. **And the converse:** do not
  withhold a control the API accepts. Logging a result with no call-start is
  allowed and flagged, so the button stays. State the absence on the page rather
  than leaving a reader guessing.
- **D-06.3. No optimistic UI.** A confirmed call is money. `router.refresh()` on
  success, inside a transition, and the control stays busy until the server
  component re-renders.
- **Client components hold no strings and no vocabularies.** Both arrive as
  props from the server, which reads them from the same `lib/erp` modules the
  routes validate against. `lib/console/action-errors.ts` turns the envelope's
  `code` into an i18n key — the API's `message` is English, for a log.
- **Test the control surface both ways.** The offered set must equal what the
  API accepts, and each offered value must then be exercised for real. That is
  how 6.3a found `tentative1/2/3` missing from the status registry.
- **A form that a write can change must be keyed on the server's values**, so a
  refresh remounts it on what was stored. `buildPatch` normalises a phone
  number; without the key the box goes on showing what was typed.
- **Money is a text input with `inputmode="decimal"`, never `type="number"`** —
  a number input hands back a JS float and these columns are `Decimal` (M-06).
- **Leave a field off rather than guess its vocabulary.** `deliveryMethod` is
  `'COD'` everywhere and has no options, so a free-text box would write values
  nothing downstream understands. Where a vocabulary *does* exist, export it from
  the module the route validates against (`SETTINGS_SCHEMA`, `PERIOD_TYPES`,
  `JOB_ROLES`, `CALL_RESULTS`) — a form with its own list goes stale silently.
- **Exclude by TYPE, not by a list of names.** The automation screen skips the
  structured settings because their declared type has no editor, so one added
  later is excluded automatically instead of rendering as a checkbox.
- **A collapsible panel is `hidden`, never unmounted.** Mounting on click means
  the offered vocabulary only exists after JavaScript runs — unassertable by a
  contract test and unreadable to assistive tech until somebody clicks.
- **A screen that reads the database directly must apply the permission its API
  equivalent applies.** 6.3d found the carriers page rendering for an agent who
  could not call a single carrier route. A nav item is a hint; the URL is
  typeable; the gate belongs on the page.
- **A product must never ship a nav item the platform owns** — `settings`,
  `profile`, `billing`, `team`, `notifications`. The registry asserts it.

---

## 2. NEXT — 6.4, the agent PWA, and retiring `apps/erp`

**This is the current task.** All 1,172 lines of `apps/erp/agent.html` were read
in 6.4a; this table is the measurement, not a guess.

### Done — 6.4a and 6.4b

`/console/erp/queue`. The scoped queue over `ACTIVE_STATUSES`, oldest first;
tap-to-dial as a real `tel:` anchor with `call-start` fired alongside; the eight
result buttons; the five note types; the overdue badge judged against the
tenant's `alertMinutes`; a plain GET filter form read by `orderFilters`; the
parcel's status and tracking number on the card; and the follow-up panel,
read-only.

### Does not port, and must not be faked

- **Login screen and stored server URL.** The platform session is a cookie on
  this origin; there is nothing to port to.
- **Notifications and Web Push** — M-16 (§3). No platform transport exists.
- **AI assistant** — `ai/chat` answers 501 by design (§5).

### Done in 6.4c — resolving a follow-up task

`POST /api/erp/followup/tasks/[id]/resolve`. Guarded by
`loadOwnedFollowupTask` (whole book, own, or unassigned — the ERP's rule with
the platform's 404), settles once, and writes no second marker. Seven contract
tests in `integrations.test.ts`.

It also found that 6.4b's panel filtered `status: "pending"` when the vocabulary
is `open | done | overdue`, so it was showing nothing.

---

## 2b. THE NEXT TASK — what actually blocks deleting `apps/erp`

Building the resolver exposed two **Phase 5 porting gaps**. Neither is visible
to a contract test over HTTP, because both are code that runs *between* routes.

### (1) DONE in 6.5a — carrier events raise tasks

`raiseFollowupTask` in `src/lib/erp/followup.ts`, attached to `ingestEvents` —
the one choke point both the tracking poll and the inbound webhook pass through.
Fires only on a status TRANSITION, which is stricter than the ERP: replayed
history no longer re-raises a task an agent has resolved. Both halves of
`statusRequiresCall` ported (the CRM status list and the keyword fallback over
the carrier's own wording). Six contract tests in `delivery.test.ts`.

A task raised here carries the order's `followupUserId`, and unassigned is fine
— `loadOwnedFollowupTask` treats an unowned task as work anybody may pick up.
6.6a closed the other half: `autoAssignFollowup` now sets that field on
confirmation, so a task raised later already names somebody.

### (2) DONE in 6.5b — M-15, the scheduled work

`src/lib/erp/jobs.ts` holds follow-up escalation and the overdue sweep, both
**idempotent by column guard** rather than by lock, each driven twice by a test
that asserts the second pass changes nothing. Two ways to run them:

- `POST /api/erp/jobs/[job]` — `erp:settings:write`, the caller's own tenant.
  A manager's "run it now", and what makes any of this contract-testable: a
  timer is not something a test can wait for.
- `POST /api/jobs/tick` — `WORKER_SECRET`, every entitled tenant. **Fails
  closed with 404**, not 401. `services/worker` calls it on an interval and
  holds no business logic and no database connection.

```bash
WORKER_TARGET=http://127.0.0.1:3000 WORKER_SECRET=... npm run worker
```

### (3) DONE in 6.6a — auto-assignment

`src/lib/erp/assign.ts` is the one eligibility-and-workload rule behind all three
ERP behaviours: `autoAssignOnCreate` (behind `autoAssign`, on all three creation
paths), `autoAssignFollowup` (behind `followupAutoAssign`, on both confirm
paths), and reassignment inside the overdue sweep (behind `autoReassign`).
25 contract tests in `assign.test.ts`, **11 of which were verified to fail
against the pre-change build.**

Three decisions, in PROJECT_STATE: **D-06.5** an explicit `jobRole` is required
(`Membership` is everybody in the company, not a staff table); **D-06.6**
eligibility also asks `can(..., "erp:orders:write")`, so automation never hands
out work the API would refuse; **D-06.7** `overdueFlaggedAt` is both the guard
and the clock, which is what stops one ignored order walking the whole roster in
minutes.

`onOrderConfirmed` in `src/lib/erp/confirm.ts` is now the single confirm path for
both doors into `confirmed` — `/call` and `PATCH` had diverged, which is the
exact defect the ERP records at `index.js:1685`.

**The sweep's threshold is `reassignMinutes`, not `alertMinutes`.** They are
different ERP jobs and 6.5b conflated them.

### (4) DONE in 6.6b — the carrier poll, and a worker that had never worked

`pollCarriers` in `src/lib/erp/jobs.ts`, driven by `trackingPollMinutes` and
guarded by the new `Shipment.lastPolledAt` column — which is both the interval
marker and the idempotency guard, matched in the same `updateMany` that writes
it. It calls `refreshShipment`, so it feeds the same `ingestEvents` a webhook
does: one ingest path, so a polled parcel raises follow-up tasks and settles its
outcome exactly as a pushed one does.

**And the thing worth remembering from this slice:** `services/worker` had never
run a job. 6.5b's tick read `Subscription` through `asPlatform()`, which is
unbound, and that table is RLS-scoped — so every tenant looked unentitled and the
tick answered `{ tenants: 0 }`, which the worker logged as a quiet system. It was
found by **running the worker**, because no test could reach the authorised half
of a route that fails closed on a dev server with no secret.

The entitlement is now read inside the binding via `hasProduct` — the same
predicate the storefront checkout uses. `WORKER_SECRET` is required by
`ERP_CONTRACT=strict`, and two tests exercise the authorised path: it escalates a
real task, and a cancelled subscription is skipped.

**The limitation to fix if a real carrier adapter is slow:** the carrier call
happens inside the transaction `withTenant` opened, whose timeout is 15s. The
batch size (25) is the mitigation, not the fix. Doing the HTTP outside the
transaction and ingesting inside it is the shape to move to.

---

## 2c. NOTHING BLOCKS DELETING `apps/erp` — the 6.6f reassessment

Every behaviour it has is on the platform. The full table is in PROJECT_STATE
under *What still prevents retiring `apps/erp`*; both deferred test files are
discharged rather than abandoned (`overdue-sweep.test.js` → `jobs.test.ts`,
`notifications.test.js` → `notifications.test.ts`, which also covers the SSE half
of `delivery-outcome.test.js`).

The three things still true, and **none is caused by deleting it**:

1. **No cross-origin state-change refusal, and no rate limiting** (§4). Both left
   the product suite in 5.1 because neither belongs in one, and neither was ever
   on the platform — so keeping `apps/erp` running does not give them to it.
2. **Web Push has never crossed a real push service**, and installability needs a
   real device over HTTPS. Nothing is deployed, so both are untested by
   construction rather than by omission.
3. **The AI assistant answers 501 by design** (§5).

### DECISION: not yet — it stays as the reference implementation

Taken after the 6.6f reassessment. Nothing depends on it and nothing imports from
it; it is kept because **four end-to-end reads of that directory during this port
each found something the platform was missing**, and Phases 7 and 8 will read it
again — billing and team management touch `agents`, `sessions` and the settings
surface, and hardening needs its rate limiter and `CSRF_ORIGIN` check as worked
examples.

**Re-assess after Phase 7, Phase 8 and production readiness are complete.**

### The checklist for when that moment comes

One commit that touches nothing else, so the diff is a pure removal and a revert
is one command. Then:

- `package.json` — drop `apps/erp` from the workspace globs if they are explicit,
  and `better-sqlite3` from `allowScripts`, which nothing else needs.
- PROJECT_STATE's *Legacy still remaining* section and its suite totals
  (929 → 682, since the 298 go with the directory).
- `apps/website-builder/test/erp/PORTING.md` references files that will be gone.
  Keep the reasoning and say where each went.

That directory has been read end to end four times during this port — 6.4a for
the agent PWA, 6.5a for the follow-up producer, 6.6a for assignment, 6.6f for the
in-process timers — and **each read found something the platform was missing**.
Weigh that before the last working copy goes behind a `git show`.

## 7. Phase 7, the SaaS layer — IN PROGRESS

**Phase 6 is complete.** Every ERP behaviour is on the platform (6.6f), and
`apps/erp` is kept as the reference implementation until Phase 7, Phase 8 and
production readiness are done — see §2c.

**7.1a is done** (the team API), **7.1b is done** (invitation acceptance) and
**7.1c is done** (the team screen). **Phase 7.1 is complete.**
**7.2 is the next task** — billing, below.

Phase 7 is what turns the platform from *a thing two seeded tenants use* into a
product somebody can buy. Three pieces, in this order, and the order is the
argument:

### 7.1a — DONE. The team API.

Six routes under `/api/platform/team/*`, 39 contract tests in
`test/platform/team.test.ts`, purely additive — no existing file was modified.

| Route | What it does |
|---|---|
| `GET/POST /api/platform/team/invitations` | list · invite by address and role |
| `POST .../invitations/[id]/revoke` | withdraw one; idempotent |
| `GET /api/platform/team/members` | the company, plus `assignableRoles` |
| `PATCH .../members/[userId]` | change a role |
| `POST .../members/[userId]/{suspend,reactivate}` | |
| `DELETE .../members/[userId]` | remove the membership, never the person |

The rules, all enforced and each with a test that violates it: the owner cannot
be demoted, suspended or removed by anybody including themselves; nobody hands
out more access than they hold (by promotion *or* by invitation — both doors are
tested); nobody acts on their own membership; suspension takes effect on the next
request and is per-company, not per-person; an invitation is replaced rather than
duplicated; the token is shown once. Four decisions — **D-07.1** to **D-07.4** —
are recorded in PROJECT_STATE.

**Every guard returns a CODE, and every test asserts it.** A test that only
checks for 403 passes against a route that refused for the wrong reason.

### 7.1b — THE NEXT TASK. Accepting an invitation.

7.1a issues links that lead to a 404. This closes that.

- `GET /console/join/[token]` — show who is inviting, to what company, in what
  role. **Before a session exists**, so it must render for a signed-out visitor.
- `POST /console/join/[token]` — accept. Creates a `Membership`; the `User` may
  already exist (one person, many companies — the seeded consultant is exactly
  this case and must keep working). Sets `acceptedAt`.

**Start here, because it is the part that is not obvious:**

> **`asPlatform()` does not bypass RLS.** The app role is not the database owner,
> so an unbound read of `Invitation` returns **zero rows, silently** — RLS denies
> by returning nothing, not by erroring. Resolving a token before a tenant is
> bound therefore needs the pattern `Membership` already demonstrates in
> `packages/db/scripts/apply-rls.ts`:
>
> - a second, narrower policy on `Invitation` —
>   `FOR SELECT USING ("token" = current_setting('app.invitation_token', true))`
> - a `withInvitationToken(token, work)` binding in
>   `packages/db/src/tenant-client.ts`, alongside `withUser`
> - `npm run rls --workspace @landingos/db` to apply it, then re-run the
>   preflight
>
> It opens exactly the row whose token was presented and nothing else. Do not
> reach for it to sidestep a tenant binding — like `withUser`, it grants a
> strictly narrower view, not a wider one.

**The rules for this slice, each needing a test that violates it:**

- **An expired, revoked or already-accepted token is refused IDENTICALLY.** A
  different answer per case turns the endpoint into an oracle for which addresses
  have been invited and which have joined.
- **An invitation is not an account.** Accepting creates a `Membership` only. If
  no `User` holds that address, this slice must not create one — that is 7.3,
  self-serve signup. Say so; do not half-build it.
- **The address on the invitation is not proof of identity.** Whoever follows the
  link is whoever received it. Decide explicitly whether accepting requires being
  signed in as *that* address, and write the reasoning down — it is the one real
  design question in the slice.
- **Accepting twice creates one membership.** Idempotent by `acceptedAt`, the
  same shape as every job in `jobs.ts`.
- **A token for a soft-deleted tenant is refused**, like every other bad token.

### 7.1b — DONE (GLM-5.2)

**Implemented and verified.** `test/platform/team.test.ts` 39 → **47/47**. The
invitation link (`/console/join/[token]`) now resolves: a GET renders the preview
for a signed-out visitor, and `POST /api/platform/invitations/[token]/accept`
creates the membership. Every rule above has a test that violates it.

**What landed:**
- A second RLS policy on `Invitation` (`tenant_isolation_token`, `FOR SELECT` on
  the token) plus `withInvitationToken(token, work)` in `packages/db` — the
  `Membership` `_self` pattern applied to a token. Verified live: resolves exactly
  one row, wrong token → nothing, unbound → nothing.
- `POST /api/platform/invitations/[token]/accept` — a plain route, NOT
  `tenantRoute` (the accepter has no session/tenant). A server action was tried
  first and rejected: server actions are not HTTP-addressable, so they cannot be
  contract-tested over `fetch` (every other write surface is an API route — D-06.1).
- The page renders GET for everyone and its accept button calls the route via a
  small client component (`components/console/join-form.tsx`).
- The one design question, resolved: the accepter need NOT be signed in as the
  invited address. The token is the claim. No `User` is created (that is 7.3);
  an address with no account is refused `ACCOUNT_REQUIRED`.
- Refusals uniform across the oracle surface: unknown / expired / revoked /
  deleted-tenant → `404 INVITATION_NOT_FOUND`; `ALREADY_ACCEPTED`,
  `ACCOUNT_REQUIRED`, `ALREADY_MEMBER` distinct.
- Idempotent by `acceptedAt`; membership + acceptedAt + audit in one transaction.
- Acceptance does NOT switch the active tenant (D-07.4) — the seeded-consultant
  test asserts both memberships survive and the original session still resolves.

**Verified live:** team 47/47 · access 63/63 · website-builder 102/102 · i18n
18/18 · auth 36/36 · product-registry 36/36 · db 29/29 · preflight 9/9. Build
clean. End-to-end invite → GET → POST → membership-in-DB driven manually. Full
reasoning in CHANGELOG §7.1b; the measurement that locked the design is preserved
below.

### 7.1b — measured and designed (GLM-5.2, commit `1aab962`)

**Status: design complete, no code written.** Stopped at the safe boundary after
measurement so the next session implements from a locked design. Everything below was
verified against the live database or the committed source, not inferred. Working tree
clean at the stop.

**The one real design question is RESOLVED — the accepter need NOT be signed in as the
invited address.** Possession of the 32-byte token is the claim (7.1a already reasoned
this: "the invitation carries a role, not an identity"). Requiring a matching signed-in
session would force creating a `User` for an invitee who has none — that is 7.3
self-serve signup, and this slice must not half-build it. So the join flow treats the
token as the claim and creates a `Membership` only.

**The RLS fix is the first thing to land, and it is verified-necessary.** Measured live:
`Invitation` carries exactly one policy (`tenant_isolation`, `FORCE`d), so an unbound
`asPlatform().invitation.findUnique({ where: { token } })` returns **zero rows silently**.
Apply the `Membership` `_self` pattern:

1. `packages/db/scripts/apply-rls.ts` — add a `tenant_isolation_token` block beside the
   `Membership` `_self` block: `FOR SELECT USING ("token" = current_setting('app.invitation_token', true))`.
2. `packages/db/src/tenant-client.ts` — add `INVITATION_SETTING = 'app.invitation_token'`
   and `withInvitationToken(token, work)`, shaped exactly like `withUser`.
3. `packages/db/src/index.ts` — export `withInvitationToken`.
4. `npm run rls --workspace @landingos/db` then re-run the preflight.

**The route is a page, not a `tenantRoute`.** `tenantRoute` requires a session + active
tenant and binds `withTenant` — all three are false for a signed-out invitee. Mirror
`/console/login/page.tsx`: a `page.tsx` under `/console/join/[token]/` that renders GET
for everyone and handles POST (a server action or a same-file handler). It may read
`getConsoleSession()` for a "signed in as X" banner but must never require it.

**The refusal vocabulary (every non-open state refuses IDENTICALLY, to avoid an oracle):**

| Condition | Status | Code |
|---|---|---|
| token resolves to no row (unknown / revoked / expired / wrong-tenant-via-deleted-tenant) | 404 | `INVITATION_NOT_FOUND` |
| invitation already `accepted` | 409 | `ALREADY_ACCEPTED` |
| the invited address has no `User` (7.3 owns creating one) | 409 | `ACCOUNT_REQUIRED` |
| the accepting user is already a member of this tenant | 409 | `ALREADY_MEMBER` |

Note the deliberate collapse: **expired, revoked, soft-deleted-tenant, and unknown token
all answer the same 404**, because distinguishing them turns the endpoint into an oracle
for which addresses have been invited. `accepted` and the two membership states are
different because the caller already proved they hold the token, so no oracle is opened.

**Idempotence:** accepting twice yields exactly one membership, guarded by `acceptedAt`
(precedence `accepted > revoked > expired > open`, from `invitationState` in `team.ts`).
The membership insert is the final write; `acceptedAt` is set in the same
`withInvitationToken` transaction, so a double-submit or a `PATCH`/POST race settles once.

**Acceptance writes (all inside the one `withInvitationToken` transaction the GET already
opened — OR a fresh one on POST, but never `asPlatform` for the writes):**
- `membership.create({ data: { tenantId: invitation.tenantId, userId, role: invitation.role } })`
  — `role` is trusted from the row (it passed `assignableRoleError` at issue time); never
  re-validate against an actor ceiling, there is no actor.
- `invitation.update({ where: { id }, data: { acceptedAt: new Date() } })` — only if null.
- `auditEvent.create({ ..., product: PLATFORM_PRODUCT, entity: "invitation", entityId, action: "accept", payload: { email } })` — never the token.
- Do **not** destroy/create sessions here. The invitee's session (if any) is their own;
  landing them in the new tenant is `switchTenant`'s job and is a separate concern.

**Files this slice will touch (predicted, for the audit trail):**
- `packages/db/src/tenant-client.ts` (+ export), `packages/db/src/index.ts`,
  `packages/db/scripts/apply-rls.ts` — the RLS binding + policy (the load-bearing change).
- `apps/website-builder/src/lib/platform/team.ts` — add `acceptInvitation(db, token, ...)` if
  the logic deserves a named helper (the reads/writes are small; a helper keeps the route thin).
- `apps/website-builder/src/app/console/join/[token]/page.tsx` (new) — GET + POST.
- `apps/website-builder/test/platform/team.test.ts` — new `describe` block for acceptance,
  following the existing fixture pattern (`invite()` then POST to `/console/join/[token]`).
- `packages/i18n/src/messages/{en,fr,ar}.json` — a `join` category (every string is a key).
- No `apps/erp` change. No schema migration (the policy is DDL applied by `npm run rls`).

**Verification the next session must run, in order:**
1. `npm run rls --workspace @landingos/db` then `npm run preflight --workspace @landingos/db` (9 checks).
2. `npm test --workspace @landingos/db` (29) — confirms the policy change broke nothing.
3. Stop node → `npm run builder:build` → `npm run builder:start` (Windows DLL lock + port race).
4. `ERP_CONTRACT=strict node --env-file=.env --test --test-concurrency=1 "test/platform/team.test.ts"` — expect 39 → ~48+.
5. Re-run a neighbouring suite (`test/erp/access.test.ts`, 63) to confirm no regression.

### 7.1c — DONE (GLM-5.2)

**Implemented and verified.** `test/platform/team.test.ts` 47 → **56/56** — nine
new screen tests. `/console/settings/team` renders the company's people and its
outstanding invitations, gated on `platform:team:read` (a MANAGER gets 404).

**D-06.2 enforced:** every refusal the API makes is unreachable from the screen,
because the control that would trip it is not rendered — the owner row has no
suspend/remove/role-change (`OWNER_IMMUTABLE`), the actor's own row has none
(`SELF_TARGET`), a member above the actor's ceiling has no role-change
(`ROLE_ABOVE_SELF`, via strictly ceiling-filtered `grantableRoles`), and an
accepted invitation has no revoke (`ALREADY_ACCEPTED`). The write surface is
gated again on `platform:team:write`, so a reader sees the list with no controls.

**The controls call the routes 7.1a built** (D-06.1) — invite, revoke, change
role, suspend, reactivate, remove — and add no write path of their own.

**Two bugs the tests caught:** (1) the role-change control rendered for an
above-ceiling member because `grantableRoles` included the member's current role
— fixed to strictly ceiling-filter, empty list = no control; (2) revoke was
gated on `invitation.path` which the list never carries — fixed to key off
`state === "open"`. See CHANGELOG §7.1c.

**Verified live:** team 56/56 · access 63/63 · screens 96/96 · console-shell
13/13 · i18n 18/18 · auth 36/36 · product-registry 36/36 · db 29/29. Build clean.
**Phase 7.1 (team management) is complete.**

### 7.2 — Billing

`Subscription` holds `status` and an `entitlements` string set, and every gate in
the platform already reads it — `can()`, the worker's tick, `hasProduct`. So the
domain is done and what is missing is the *management*: a screen showing what a
tenant has, and a way to change it.

Deliberately NOT a payment integration in the first slice. The valuable half is
**changing entitlements and watching access follow**, which is already testable:
drop `product.erp` and every ERP route 403s, the scheduled work skips the tenant,
and the nav item disappears. A Stripe webhook is a second slice on top.

### 7.3 — Self-serve signup

Create a tenant, its OWNER, and a TRIALING subscription in one transaction. The
slug is the hard part and it is already recorded as **R-08**: `Tenant.slug` is a
public-namespace unique that appears in every storefront URL, so it needs a
reserved-word list (`api`, `console`, `login`, `admin`, `_next`, …) or a customer
can claim a path the platform routes on.

### What Phase 7 must not do

- Do not give a product a way to create accounts. That is M-02, and the 501 on
  `POST /api/erp/agents` exists to state it.
- Do not put a team or billing nav item inside a product. The registry refuses
  it, and the reason is that a tenant with N products must still see ONE of each.
- Do not weaken `SENSITIVE`. `platform:team:*` and `platform:billing:*` are on it
  so that MANAGER — who runs a call centre day to day — does not by default get
  to decide who works there or what the company pays for.

---

## 3. The migrations Phase 5 left, with what they owe

| id | Scope | Owes |
|---|---|---|
| **M-15** | **DONE — 6.5b and 6.6b.** Jobs → `services/worker`; all three of the ERP's scheduled loops have a platform equivalent. | Discharged. `test/erp/jobs.test.ts` supersedes `overdue-sweep.test.js`, asserting the same behaviours plus the idempotence a scheduled job needs — and, since 6.6b, the authorised half of the tick that had never been executed. |
| **M-16** | **DONE — 6.6c, 6.6d, 6.6e.** Storage, audience, per-account read state, every producer, a live SSE stream with exact replay, Web Push, and the service worker that receives it. | Discharged: `test/erp/notifications.test.ts` (33 tests) supersedes `notifications.test.js` and covers the SSE half of `delivery-outcome.test.js`. |
| **M-14** | ERP images → R2. | — |
| **M-19** | Template registry. The storefront has one hardcoded template with colour-only themes. | — |
| **—** | **DONE in 6.6f.** Stock reservation on confirm/cancel, plus the notification-retention and expired-session prunes that existed with no caller. | Discharged: 9 contract tests over FIFO lot consumption in `catalog.test.ts`. |

---

## 4. Two guarantees that still need a platform owner

Both were real and tested in the ERP and have no equivalent here. Neither
belongs in a product suite, which is why they left it in 5.1:

1. **Cross-origin state changes.** The ERP refused a POST carrying an
   unrecognised `Origin` with `CSRF_ORIGIN`. CORS stops an attacker *reading* a
   cross-site response; it does not stop the request happening. `/api/builder/*`
   and `/api/erp/*` have no such check.
2. **Rate limiting.** Login throttling per IP *and* per account, keyed
   case-insensitively so casing cannot reset the counter, plus a general API
   backstop that exempts the event stream and inbound carrier webhooks (carriers
   replay backlogs and must never be throttled off).

---

## 5. Deliberate 501s, so nobody reads them as gaps

- `POST /api/erp/agents` — inviting a person is a PLATFORM action (M-02).
  Gated first, so an agent is still refused; a manager is told where it lives.
- `POST /api/erp/ai/chat`, `GET /api/erp/ai/chat/stream`,
  `POST /api/erp/ai/insights/deep` — calling a model needs a configured provider
  and a real key, which is deployment configuration. Gated first, because
  leaving them unrouted would put a hole in "every AI route requires a session"
  exactly where SEC-03 was.

---

## 6. Not blocking, but do them when convenient

- **Rotate the two credentials** listed under *Security actions* in
  PROJECT_STATE. Needs a human.
- **Verify the Docker image** — never built:
  `docker build -f apps/website-builder/Dockerfile -t landingos-builder .`
- **Replace the `(db as any)` casts** in the Phase 4.4 builder routes. The
  entire ERP layer is written without one — `db.fulfillmentOrder` typechecks on
  `TenantDb` — so the pattern is proven; it is only the older routes left.
- **Rename `apps/website-builder`.** It hosts the whole platform. The end of
  Phase 6, when `apps/erp` is deleted and there is exactly one app, is the
  moment — if ever.

---

## Do not

- Do not weaken tenant isolation to make something pass.
- Do not add `where: { tenantId }` — the binding already does it.
- Do not assume only two products exist.
- Do not trust a green build; verify against the running server.
- Do not "fix" a contract test by relaxing its assertion. It asserts the
  boundary the ERP shipped with; giving that up is a decision to record, not an
  assertion to edit.
- Do not put a per-tenant sequential number in a primary key (D-05.3).
- Do not add `(db as any)`. Typed model access works; the casts are what hid the
  nested-`$transaction` bug.
- Do not catch P2002 per-insert inside a transaction. A unique violation aborts
  the whole Postgres transaction; use `createMany({ skipDuplicates: true })`.
