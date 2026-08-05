# Changelog

Work driven by the engineering audit of 1 August 2026. Findings are referenced
by their audit IDs (`SEC-01`, `BUG-02`, `PERF-01`, …). From Phase 3 onward,
work follows the LandingOS platform architecture and references its migration
and risk IDs (`M-01`, `R-08`, …).

Format: newest first. Each entry records **what** changed, **why**, the **files**
touched, any **migration**, and any **risk**.

---

## Phase 7 — The SaaS layer

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
