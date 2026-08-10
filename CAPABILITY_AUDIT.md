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
A merchant cannot state a product benefit or answer a question. **Slice 1 —
DONE 10 Aug** (and the measurement deepened it: the FAQ **and Reviews**
storefront renderers were mounted by NOTHING — saved reviews travelled in the
data payload and rendered nowhere — and BenefitsList hardcoded four badges.
All mounted now, benefits data-driven with the badges as fallback, `show*`
gating honoured, builder-sections 54/54, verified through the live editor and
public page).

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
merchant can switch on. **Slice 2 — DONE 10 Aug:** a new Display editor
section drives the five toggles through the order-form route (which had
accepted them since the port); `freeShipping` joined the Shipping section
(the route already took it); `floatingWhatsapp` got its storefront component
(number plumbed from `StoreSettings.whatsapp` by the page query, wa.me
normalisation 0→213); the editor preview honours the toggles live. Tests:
builder-sections 56/56 (toggle persistence through both routes), storefront
30/30 (the freeShipping money contract — total excludes the delivery charge —
and the WhatsApp render/absence contract). Live-verified through the real
editor and store-settings screens. `countdownEnabled` needs a target date
**column** — recorded, not built (see §4).

**B3. Categories: full CRUD API, read-only screen.**
EXISTS: `POST/GET /api/builder/categories`, `PATCH/DELETE …/[id]` (validated,
permission-gated); a console list screen; `Category.icon/coverImage/sortOrder/
isVisible` columns.
MISSING: any create/edit/hide/delete control (the screen greps clean of
forms and fetches); `coverImage` is accepted by the API and **rendered by
nothing** — not even the storefront category page. **Slice 3 — DONE 10 Aug:**
create form (auto-slug from the name, the API's charset enforced while
typing), visibility toggle and two-step inline delete on each row, all gated
on the same `pages:write` permission the routes check, i18n'd in en/fr/ar
(builder.categories.*). New tests: the screen offers the controls to a
writer, and delete releases pages (SetNull) instead of taking them along —
builder-sections 58/58, i18n parity 20/20. Live-verified in the Arabic
console. `coverImage`/`icon` stay accept-only with no render — reclassified
to §2 as removal candidates unless a storefront category redesign claims
them.

**B4. Store settings: the screen edits nine fields, the model holds fourteen.**
EXISTS: `StoreSettings` columns all accepted by `PUT /api/builder/settings/
store`; `logo` is rendered by the storefront, `favicon` consumed by lib
metadata.
MISSING: controls for `logo`/`favicon` (an upload route exists at
`/api/builder/upload` — the pieces just aren't joined), and **no storefront
renderer for any social link** (facebook/instagram/tiktok/whatsapp are
editable and shown to no customer; `telegram` additionally has no field).
**Slice 4 — DONE 10 Aug, and the measurement made it a defect fix:** the
landing template's nav and footer rendered THE PLATFORM'S brand — the
LandingOS wordmark linking to "/", "© LandingOS" — on every tenant's
customer-facing page. Now the tenant's identity flows into the template
(`StorefrontStoreData` from the page query): nav brand + logo linking to
their own storefront root, footer with name/description/social links
(handle→canonical-URL normalisation) and their © line, platform mark only as
the no-settings-row fallback. Console: `telegram` field added; `logo`/
`favicon` are FILE inputs handled inside the server action via the same
`storeImage` the upload route uses (same caps, same per-tenant prefix), with
previews and remove boxes. `favicon` finally has a consumer — the storefront
layout's metadata serves it on every page (its only prior "lib" hit was a
reserved-filename list, i.e. nothing). Tests: storefront 32/32 (identity
renders when set, platform fallback when no row). Live-verified: /demo/clogs
wears "Demo Trading Co." in nav and footer.

**B5. Custom domains (the audit's seed example, confirmed exactly).**
EXISTS: `TenantDomain` with `verificationToken`/`isPrimary`; a complete SAFE
read path — `tenantByDomain` refuses unverified rows; the bare-domain root
already routes a verified domain to its storefront (commit `acbc96a`).
MISSING: everything write-side — no route names the model, no screen adds a
domain, nothing mints a token, nothing checks DNS, nothing sets `verifiedAt`
or `isPrimary`. **Slice 5 — DONE 10 Aug:** `/api/platform/domains` (list,
claim with 128-bit token), `[id]` (delete, make-primary — verified rows
only, exclusive per tenant), `[id]/verify` (TXT lookup at
`_landingos-verify.<domain>`, exact token match, nothing else writes
`verifiedAt`); hostname normalisation refuses the platform's own surfaces
(`*.onrender.com`, localhost) and junk; a Settings → Domains screen with
DNS instructions (TXT proof + CNAME pointer), i18n'd en/fr/ar. Gated on new
`platform:domains:manage`, added to rbac's SENSITIVE list — OWNER/ADMIN
only, the same tier as billing. New suite `platform/domains` 9/9 (refusals,
cross-tenant 404s, manager 403/404, failed-verify-writes-nothing,
primary-exclusivity); team 63/63 and billing 19/19 re-proven after the rbac
change. The POSITIVE DNS path is untestable without real DNS — recorded in
the suite header, same honest class as carrier endpoints. The read path
(`tenantByDomain` refusing unverified rows) is untouched. Live-verified:
claim → token + instructions → clean verify failure → delete.

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
