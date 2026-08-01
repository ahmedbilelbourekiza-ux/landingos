# M-04 — Unique-constraint decisions

Every unique constraint in either product, with an explicit decision. The
architecture calls M-04 the subtlest failure mode in the programme, and the
mitigation it commits to is *mechanical, not vigilant*: enumerate every
constraint and record a decision for each, then enforce it with a test rather
than with care.

A constraint left global when it should be per-tenant means tenant B cannot use
a slug because tenant A took it — a support ticket that looks like a bug and is
a data-model error. A constraint rescoped when it should have stayed global
means two rows collide, or a lookup by that key crosses the tenant boundary and
returns another company's data.

Three verdicts are possible:

| Verdict | Meaning |
|---|---|
| **per-tenant** | Unique within a tenant. The constraint gains `tenantId`. |
| **platform-global** | Unique across the whole platform, deliberately. |
| **public-namespace** | Globally unique *because it is publicly addressable* — a URL or a value issued by an outside system. |

`prisma/schema/*.prisma` must match this table, and
`test/constraints.test.ts` asserts that it does.

---

## Website Builder

| Constraint | Was | Verdict | Reason |
|---|---|---|---|
| `LandingPage.slug` | global | **per-tenant** | Decision D2 put tenants at a path prefix (`/acme/product`), so the slug only has to be unique inside a tenant. Left global, the first customer would claim every good slug for everyone. |
| `Category.slug` | global | **per-tenant** | Same reasoning; categories are tenant content. |
| `LandingSetting.landingPageId` | global | **platform-global** | Corrected during implementation. It is a 1:1, and Prisma requires the referencing field *itself* to be `@unique` for a one-to-one — `@@unique([tenantId, landingPageId])` does not satisfy that. It is also the right answer regardless: the column references a globally unique cuid, so global uniqueness already means exactly "one setting per page". The model still carries `tenantId` as a column so RLS can filter it without a join. |
| `GlobalDeliveryPrice.wilayaId` | global | **per-tenant** | Badly named today: these are *this store's* prices per wilaya, not the platform's. Global would mean one tenant's delivery pricing silently applied to every other. |
| `DraftOrder.token` | global | **public-namespace** | A random id the storefront generates per visit and sends from an unauthenticated endpoint. It is the upsert key before any session exists, so it must resolve without knowing the tenant. Random 128-bit values do not collide. |
| `Wilaya.code` | global | **platform-global** | Algerian administrative codes 01–58. Reference data owned by the platform and shared by every tenant — not tenant content. |
| `Admin.username` | global | **removed** | Superseded by `User.email`. See M-02. |
| `StoreSettings.id = "singleton"` | singleton | **per-tenant** | The literal `"singleton"` primary key becomes one row per tenant, keyed by `tenantId`. |

## ERP / CRM

| Constraint | Was | Verdict | Reason |
|---|---|---|---|
| `clients.phone` | global unique index | **per-tenant** | The most dangerous one in the list. Two tenants will absolutely have a customer with the same phone number — it is the dedup key for a *customer registry*. Left global, the second tenant to see that number either fails to create the client or, worse, merges into the first tenant's record and reads their order history. |
| `agents.name` (TEXT PK) | global | **removed** | Identity moves to `User.email` (platform-global) plus `Membership`. Display name stops being identity — two tenants will both employ a "Sara". See M-02. |
| `settings.key` (TEXT PK) | global | **per-tenant** | A key/value table with no tenant column is one tenant's configuration applied to all of them. |
| `providers.code` | global | **per-tenant** | Carrier short codes (`zr`, `ecom`). Each tenant configures their own carriers and will reuse the same well-known codes. |
| `status_mappings(providerId, originalStatus)` | scoped by provider | **per-tenant** | Already indirectly scoped, since `providerId` will be tenant-scoped. `tenantId` is added to the constraint anyway so correctness does not depend on a join, and so the index leads with the column every query filters on. |
| `shipment_events(shipmentId, eventTime, originalStatus)` | scoped by shipment | **per-tenant** | The dedupe key for an append-only event log. Same reasoning as above. |
| `push_subscriptions.endpoint` | global | **public-namespace** | A URL issued by the browser's push service, unique by construction. Scoping it per-tenant would let the same physical device register twice and receive duplicate notifications. |
| All `id` primary keys | global | **platform-global** | Opaque identifiers — cuid, or bigint identity where the table used `INTEGER PRIMARY KEY AUTOINCREMENT`. Never guessable, never user-facing, so global uniqueness is free and makes cross-table references unambiguous. |

## Platform

| Constraint | Verdict | Reason |
|---|---|---|
| `Tenant.slug` | **public-namespace** | Appears in every public URL under D2 (`/acme/...`), so it shares a namespace with the platform's own routes. Must additionally be checked against a reserved-word list — see risk R-08. |
| `TenantDomain.domain` | **public-namespace** | A linked custom domain resolves to exactly one tenant. Two tenants claiming one hostname is unresolvable by definition. |
| `User.email` | **platform-global** | One person, one login, across every company they belong to. This is what makes a single account able to switch tenants without signing in again. |
| `Membership(tenantId, userId)` | **per-tenant** | One membership per person per tenant. |
| `Invitation.token` | **public-namespace** | Random, and followed from an email link before any session exists. |
| `Invitation(tenantId, email)` | **per-tenant** | One outstanding invitation per address per tenant. |
| `Session.id` | **platform-global** | The SHA-256 of the token handed to the client — never the token itself, so a database leak cannot be replayed. Carried over from the ERP's existing design. |
| `Subscription.tenantId` | **per-tenant** | One subscription per tenant. |

---

## Two decisions the merge forced earlier than planned

**The order models had to be named now.** Both products have a model called
`Order`, and one Prisma schema cannot hold two. The architecture scheduled that
split for Phase 5.4 (M-05), but the *naming* cannot wait: the builder's becomes
`SalesOrder` (the immutable commercial snapshot) and the ERP's becomes
`FulfillmentOrder` (the mutable operational record). Only the names land here.
The relationship between them, and replacing the webhook with an in-process
domain event, stay in Phase 5 as planned — adopting the target names now simply
avoids renaming every reference twice.

**Two ERP tables are not ported at all.** `agents` and `sessions` are superseded
by the platform's `User`, `Membership` and `Session` (M-02). Porting them would
create a second identity system inside the same database, which is the specific
outcome M-02 exists to prevent.

---

## Deliberately global — the short list

Everything else is per-tenant. These are the only constraints that are *not*,
and each is here for a stated reason:

- `Wilaya.code`, and the reference tables — platform-owned shared data.
- `User.email` — the identity that spans tenants.
- `Session.id`, `Invitation.token`, `DraftOrder.token`, `push_subscriptions.endpoint` — random or externally issued values, resolved before a tenant is known.
- `Tenant.slug`, `TenantDomain.domain` — the public routing namespace.
- Primary keys.
