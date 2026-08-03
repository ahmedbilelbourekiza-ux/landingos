# Next Steps

**Phase 5 is complete; Phase 6.3c is done.** Immediate tasks to continue from
the Phase 6.3c commit. Full context is in `PROJECT_STATE.md` — read its "Read
this first" section before starting.

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

Expect **294/294** across the nine files: access 62 · orders 38 ·
validation 29 · listing 25 · catalog 31 · delivery 20 · integrations 22 ·
order-split 8 · screens 59.

---

## 1. Phase 6.3 — the write surfaces

Every ERP screen exists. **6.3a–c made the order book, the catalogue and the
stockroom workable**; four screens are still read-only. Each mutation below
already has a route and a passing contract test; what is missing is the control.
That is the rest of 6.3, and it is why `apps/erp` cannot be deleted yet — it is
still the only way to do these four.

### Done — 6.3a, 6.3b and 6.3c

| Action | Route it calls | Screen |
|---|---|---|
| Start a call, log its result | `POST orders/[id]/call-start`, `/call` | order detail |
| Add a note | `POST orders/[id]/note` | order detail |
| Classify as fake | `POST orders/[id]/classify` | order detail |
| Edit an order, reassign it | `PATCH orders/[id]` | order detail |
| Bulk status / assign / delete | `POST orders/bulk` | order list |
| Book / refresh a parcel | `POST orders/[id]/shipment`, `/refresh` | order detail |
| Create / archive / restore a product | `POST products`, `DELETE`, `/unarchive` | products |
| Adjust stock, add a lot | `POST products/[id]/inventory/adjust`, `/stock-lots` | inventory |

### Remaining — all of it is 6.3d

| Action | Route it calls | Screen | Permission |
|---|---|---|---|
| Configure a carrier, set the default, map statuses | `POST/PUT carriers`, `/default`, `/status-mappings` | carriers | `erp:shipments:write` |
| Save a P&L, add / delete a one-off charge | `POST financial-records`, `unexpected-charges`, `DELETE …/[id]` | finance | `erp:finance:write` |
| Pay rates, days off, suspend / reactivate | `PATCH agents/[id]`, `/days-off`, `/suspend`, `/reactivate` | agents | `erp:agents:manage` |
| ERP settings | `PUT settings` | **new screen** | `erp:settings:write` |

Two things 6.3d must get right, both already asserted by tests it must not break:

- **A carrier's keys are never selected**, let alone rendered. The carriers
  screen shows *that* credentials exist. The API masks them on read and
  preserves the stored secret when the mask is sent back, so an edit form must
  send the mask unchanged rather than a blank.
- **A saved financial record has no delete or edit** — it is append-only and the
  screen says so. A one-off charge *is* deletable. That asymmetry is the schema's
  and `screens.test.ts` already asserts the absent control.

### The pattern 6.3a established — follow it

The write primitive is `src/components/console/api-action.tsx`
(`useApiAction`, `ActionError`, `ActionButton`); the field descriptor and
`editFingerprint` are in `src/components/console/edit-field.ts`; the worked
examples are `src/components/console/erp/{order-write,order-bulk}.tsx`.

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
  nothing downstream understands.

---

## 2. Then 6.4 — the agent PWA, and retiring `apps/erp`

The confirmation agent's phone app (`apps/erp/agent.html`, 1,261 lines) is the
last thing `apps/erp` serves that has no replacement. Once it does, delete
`apps/erp` — it is a UI in front of an API that has been superseded, and every
screen it has is covered by a contract test against the platform.

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
