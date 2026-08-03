# Next Steps

**Phase 5 is complete. Phase 6.3 is complete. Phase 6.4 is in progress.**
Immediate tasks to continue from the Phase 6.4a commit. Full context is in
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

Expect **359/359** across the TEN files: access 63 · orders 38 ·
validation 29 · listing 25 · catalog 31 · delivery 26 · integrations 29 ·
order-split 8 · screens 96 · jobs 14.

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

**Still not ported, and stated rather than hidden:** `assignFollowup` — the
ERP's workload-balanced auto-assignment of a follow-up agent on confirmation,
behind the `followupAutoAssign` setting. Tasks are raised unassigned instead,
which `loadOwnedFollowupTask` treats as work anybody may pick up. Graceful, but
it is a behaviour difference.

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

**Not ported, and stated rather than hidden:** auto-reassign of an overdue
order, and the tracking poll. The first needs the same workload/eligibility
logic as `assignFollowup` — do them together. The second is a job nobody has
written; the machinery to schedule it now exists.

### `apps/erp` can now be retired

Nothing it does is unavailable on the platform. PROJECT_STATE carries the full
assessment; what retiring it costs, and should be accepted deliberately:
no auto-assignment (either kind), no carrier polling on a timer, no
notifications (M-16), and not installable. None is functionality a person
invokes.

`overdue-sweep.test.js` is superseded by `test/erp/jobs.test.ts`.
`notifications.test.js` is not, and after deletion is recoverable only from git
history — port it with M-16 or copy it out first.

Its 298 tests go with the directory. They tested the Express stack; `test/erp/`
tests the platform. See `apps/website-builder/test/erp/PORTING.md` for what was
deliberately not carried across and why — and note M-15 and M-16 below still owe
two of those files a home.

Its 298 tests go with it. They tested the Express stack; `test/erp/` tests the
platform. See `apps/website-builder/test/erp/PORTING.md` for what was
deliberately not carried across and why — and note M-15 and M-16 below still owe
two of those files a home.

---

## 3. The migrations Phase 5 left, with what they owe

| id | Scope | Owes |
|---|---|---|
| **M-15** | Jobs → `services/worker`. The overdue sweep and tracking poll are in-process `setInterval`s in `apps/erp`; on a scaled deployment they run once per instance and double-count every miss. `services/` exists and is empty. | Port `apps/erp/test/overdue-sweep.test.js` (~12 tests), deferred in 5.1. |
| **M-16** | Notification unification. The table already moved to `platform.prisma`; the transport — SSE, per-account read watermark, replay on reconnect, Web Push — has no platform equivalent. | Port `apps/erp/test/notifications.test.js` (~20 tests) and the SSE half of `delivery-outcome.test.js`, both deferred in 5.1. |
| **M-14** | ERP images → R2. | — |
| **M-19** | Template registry. The storefront has one hardcoded template with colour-only themes. | — |

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
