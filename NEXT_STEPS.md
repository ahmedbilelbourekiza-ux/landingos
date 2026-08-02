# Next Steps

**Phase 5 is complete; Phase 6 has started.** Immediate tasks to continue from
the Phase 6.1 commit. Full context is in `PROJECT_STATE.md` — read its "Read
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
npm test --workspace @landingos/website-builder    # 102 + 248 ERP contract
npm test --workspace @landingos/erp                # 298 (the legacy stack)
```

The ERP contract suite needs the server up. Run it in strict mode, which turns
a skip into a failure, from `apps/website-builder`:

```bash
ERP_CONTRACT=strict node --env-file=.env --test --test-concurrency=1 "test/erp/access.test.ts"
```

Expect **248/248** across the nine files: access 62 · orders 38 ·
validation 29 · listing 25 · catalog 31 · delivery 20 · integrations 22 ·
order-split 8 · screens 13.

---

## 1. Phase 6.2 — the rest of the ERP's screens

6.1 landed the overview, the order book and the order detail, and with them the
pattern to copy:

- **Server components.** `requireProduct("erp", path)` → `withTenant` →
  `ConsoleShell` → `DataTable`. See `src/app/console/erp/orders/page.tsx`.
- **Reuse the API's own functions** for filtering and scope — `orderFilters`,
  `scopedWhere`, `mayTouchOrder` — so a screen and its endpoint cannot
  interpret the same query differently, or disagree about who may see a row.
- **Every string is an i18n key**, in all three catalogues. The parity test
  enforces it; add keys to `en`, `fr` and `ar` together.
- **Status colour comes from `@landingos/ui`**, never a literal.

Screens still to build, in the order the ERP's own nav lists them:

| Screen | Route | Behind it |
|---|---|---|
| Customers | `console/erp/clients` | `erp:clients:read` — sensitive (D-05.1) |
| Products | `console/erp/products` | catalogue, cost basis, variants |
| Inventory | `console/erp/inventory` | stock lots, the movement ledger, low stock |
| Shipments | `console/erp/shipments` | tracking, timeline |
| Carriers | `console/erp/carriers` | credentials MASKED on read |
| Follow-up | `console/erp/follow-up` | the Suivi queue and its five buckets |
| Finance | `console/erp/finance` | records are INSERT-ONLY; nothing offers an edit |
| Agents | `console/erp/agents` | roster and payroll; no password material, ever |

Two rules the screens inherit from the API and must not quietly drop:

- **Never render what the write path refuses.** The manager note is the worked
  example — an agent cannot write it and must not see it. Carrier and AI
  credentials are the same class, and worse: they are masked in the API
  response, so a screen that renders the raw row would be the only place they
  leak.
- **Absent, not zero**, for a figure the caller may not see. A zero reads as a
  fact about the business.

---

## 2. Then 6.3 — the agent PWA, and retiring `apps/erp`

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
