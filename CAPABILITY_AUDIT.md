# CAPABILITY_AUDIT — backend capability with no reachable UI (and the inverse)

**Date:** 10 August 2026 · **Method:** the AUDIT.8 question widened one layer.
`orphans.test.ts` asks "which column does nothing NAME"; this audit asks
"which column/table/route does the backend serve that **no operator or tenant
can reach through a screen**" — and the inverse, "which does nothing serve at
all". Mechanical sweep first (schema × API routes × console/editor source ×
storefront source, name-check per layer, same parser as orphans.test.ts),
then **every candidate hand-verified in the source and, where it mattered, in
the running app**. ERP feature gaps stay owned by `LEGACY_PARITY.md`; this
audit adds only the orphan-class findings there.

Each entry states WHAT EXISTS vs WHAT IS MISSING. Nothing here weakens tenant
isolation, entitlement, or permission gates — several entries exist precisely
because those systems are ahead of their UI.

---

## §1 BUILD — the backend is real, the control is missing

**B1. Benefits + FAQ (= LB.12), the fullest example of the class.**
EXISTS: `LandingFeature` + `LandingFAQ` tables (RLS-covered, cascade-owned by
the page); storefront renderers built and styled (`mock-data.ts` still carries
their demo content); duplicate route copies nothing for them.
MISSING: any API route (`landings/[id]/features|faqs` do not exist), any
editor section, and the two mappers hardcode them away —
`toPreviewState`/`toLandingPageData` (`lib/landing/mappers.ts:243,252`) and
`preview-to-landing.ts:58,60` emit `features: []`, `faqs: []` always.
A merchant cannot state a product benefit or answer a question. **Slice 1.**

**B2. The LandingSetting display toggles — stored, honoured nowhere a
merchant can see.** Verified per toggle:
| Toggle | API accepts | Template consumes | Editor control |
|---|---|---|---|
| `showReviews` / `showFAQ` / `showFeatures` | yes | **no** — sections render purely on data presence | **none** |
| `floatingWhatsapp` | yes | **no** — no floating component exists; no storefront file names "whatsapp" at all | **none** |
| `countdownEnabled` | yes | **no** — no countdown component, and no end-date column to count to | **none** |
| `freeShipping` | yes | **YES — checkout zeroes shipping** (`storefront/[tenant]/orders/route.ts:109`) | **none** |
| `stickyBuyButton` | yes | yes (`sticky-buy-button.tsx`) | **none** |
`freeShipping` is the sharpest: a working money-affecting capability no
merchant can switch on. **Slice 2:** a display/behaviour editor section wiring
`freeShipping`, `stickyBuyButton`, `showReviews/FAQ/Features` (with the
template taught to honour the three `show*`), and `floatingWhatsapp` gets its
storefront component (number from `StoreSettings.whatsapp`).
`countdownEnabled` needs a target date **column** — recorded, not built (see
§4).

**B3. Categories: full CRUD API, read-only screen.**
EXISTS: `POST/GET /api/builder/categories`, `PATCH/DELETE …/[id]` (validated,
permission-gated); a console list screen; `Category.icon/coverImage/sortOrder/
isVisible` columns.
MISSING: any create/edit/hide/delete control (the screen greps clean of
forms and fetches); `coverImage` is accepted by the API and **rendered by
nothing** — not even the storefront category page. **Slice 3** (UI onto the
existing routes; coverImage either gets its storefront render there or joins
§2).

**B4. Store settings: the screen edits nine fields, the model holds fourteen.**
EXISTS: `StoreSettings` columns all accepted by `PUT /api/builder/settings/
store`; `logo` is rendered by the storefront, `favicon` consumed by lib
metadata.
MISSING: controls for `logo`/`favicon` (an upload route exists at
`/api/builder/upload` — the pieces just aren't joined), and **no storefront
renderer for any social link** (facebook/instagram/tiktok/whatsapp are
editable and shown to no customer; `telegram` additionally has no field).
**Slice 4:** logo/favicon controls + a storefront footer/social strip;
telegram gets its field there or joins §2.

**B5. Custom domains (the audit's seed example, confirmed exactly).**
EXISTS: `TenantDomain` with `verificationToken`/`isPrimary`; a complete SAFE
read path — `tenantByDomain` refuses unverified rows; the bare-domain root
already routes a verified domain to its storefront (commit `acbc96a`).
MISSING: everything write-side — no route names the model, no screen adds a
domain, nothing mints a token, nothing checks DNS, nothing sets `verifiedAt`
or `isPrimary`. **Slice 5:** settings screen + routes (add → token shown as
DNS TXT record → verify via DNS lookup → primary). Security-sensitive: the
verify step is what stops hostname theft; the existing refuse-unverified read
path must stay the gate.

**B6. Sessions: the write side quietly got built; the screen didn't.**
EXISTS: `Session.lastSeenAt` IS now written (throttled touch,
`packages/auth/src/session.ts:181` — the orphans exemption's "design question"
got answered); `destroySessionsForUser` exists; userAgent/ip stored.
MISSING: any "your active sessions" UI (profile screen) and any
sign-out-other-sessions control. **Slice 6.** (The orphans exemption for
`lastSeenAt` is now misleading — its scan only reads `apps/…/src`, which is
why it still passes. Fix the exemption text in the same slice.)

**B7. Version history / undo (= half of LB.14).**
EXISTS: nothing — confirmed: no version/history table in the schema; every
editor save is a destructive overwrite.
MISSING: the table, the write hook, the restore path, the UI. **L-size,
needs a schema addition** (a `LandingPageVersion` snapshot-on-save/publish).
Queued LAST tonight; if unreached it stays recorded here with this shape.

**B8. ERP: `financial-records/versions` route with no viewer.** The finance
screen never calls it; record versioning is invisible to the operator who has
it. Recorded for the ERP queue (LEGACY_PARITY owns prioritisation).

**B9. Tenant display defaults are frozen at signup.** `Tenant.locale/
currency/timezone/name` — **no `tenant.update` call exists anywhere** in api
or lib. `timezone` is read (formatting); nothing can ever change it. Small
slice: owner-gated fields on the general settings screen. **Slice 7.**

## §2 REMOVE — declared/stored, served to nobody (record, do NOT build)

**R1. `LandingPage.facebookPixel` + `LandingPage.webhookUrl`.** Zero readers,
zero writers (every source hit is ERP carrier vocabulary or generated client
types). Superseded by `TrackingIntegration` and `WebhookEndpoint`. →
Recorded for a coordinated column-drop migration (NOT executed tonight:
schema drops sequence against the production push).

**R2. The legacy Meta-pixel chain, now removable end to end.**
`MetaPixelConfig` (schema comment: *"remove the model once no deployment
holds rows"* — **production is the clean `landingos_prod`, zero rows: the
condition is met**), its console CRUD routes `/api/platform/integrations/
meta-pixels[/–id]` (called by NO UI — the "remains visible in the console"
claim is false, nothing renders them), the storefront aggregation route
`/api/storefront/[tenant]/meta-pixels` (its client, `meta-pixel-loader.tsx`,
was already deleted as mounted-by-nothing), and `StoreSettings.
metaBrowserPixelId` (settable only via raw API, consumed only by that dead
route). The modern path — `TrackingIntegration` rows server-rendered into
`TrackingScripts` — has the console screen and the storefront injection.
→ Recorded for removal as one slice: routes + model + column + exemptions.

**R3. Existing dead-both-sides exemptions stand** (`Carrier.customFields`,
`SalesChannel.webhookConfig`) — unchanged, reasons still true.

## §3 UNCALLED ROUTES — verified verdicts

| Route | Verdict |
|---|---|
| `/api/builder/categories`, `…/[id]` | kept — becomes called by B3 |
| `/api/builder/settings/store`, `…/delivery-prices` | **dual-write-path smell**: both screens save via server actions instead; the routes are the B-08 "writes through the API" path and are exercised by suites. Decide ONE path per resource when next touched; recorded, not urgent |
| `/api/builder/abandoned`, `/api/builder/themes` | API surface for suites/automation; screens server-render. Themes POST waits on M-19 (§4) |
| `/api/storefront/[tenant]/meta-pixels`, `/api/platform/integrations/meta-pixels[/…]` | dead — §2 R2 |
| `/api/erp/ai/chat`, `chat/stream`, `conversations/[id]`, `agents/enabled`, `permissions`, `insights/deep` | **not orphans** — 501-by-design family, the console deliberately shows "chat unavailable" instead of a broken box |
| `/api/erp/clients/filter-options`, `/api/erp/orders/stats`, `/api/erp/followup/dashboard`, `/api/erp/sales-channels/adapters` | uncalled by any UI or the worker — legacy-parity API ports whose screens server-render instead. Recorded as removal candidates pending a worker/API-consumer check in the ERP queue |
| `/api/health`, `/api/platform/push` | external consumers (monitoring; sw.js receives, the SW registration subscribes) — fine |

## §4 RECORDED, NOT TONIGHT'S WORK (and why)

- **`Subscription.seats/external*/trial*/period*`** — the existing AUDIT.8
  exemptions hold: billing-provider integration and seat enforcement are
  product decisions (pricing, provider choice). Untouched per the standing
  instruction not to weaken billing/entitlement.
- **Template registry (M-19).** One hardcoded layout; `LandingTheme` is
  colour-only; **no tenant has any way to obtain a theme row at all** (no
  seeding, no create UI, no copy-built-in flow) — the templates screen's
  empty state is honest about it. Whether built-ins are seeded per tenant at
  signup, and what a real layout system is, are product decisions —
  **user's call**, flagged.
- **`countdownEnabled`** — needs a `countdownEndsAt` column to mean anything;
  schema addition bundled with whichever slice the user wants it in.
- **Web Push / LB.11 real-credential smoke** — need a real device/real
  credentials; unchanged from BUILDER_HANDOFF §11.

## §5 EXECUTION QUEUE (tonight, in order)

1. B1 Benefits+FAQ end to end (LB.12)
2. B2 Display/behaviour toggles (incl. freeShipping, whatsapp component)
3. B3 Categories management UI
4. B4 Store settings completion + storefront socials
5. B5 Custom domains console flow
6. B9 Tenant display defaults
7. B6 Sessions screen
8. B7 Version history (if the night lasts)

Each slice: measure → fix → test → verify in the running app → commit →
update the owning docs. §2 removals and §4 decisions are NOT executed.
