# Demo Tenant — Manual Evaluation

[GLM-5.2]
A fully working demo tenant for clicking through the platform end to end.
Deterministic and idempotent — the seed script creates the same state every
time and can be re-run without producing duplicates.

---

## Quick start

```bash
# 1. From the repo root, provision roles + schema + reference data (once):
npm run setup:roles  --workspace @landingos/db
npm run push         --workspace @landingos/db
npm run rls          --workspace @landingos/db
npm run seed:reference --workspace @landingos/db

# 2. Seed the demo tenant:
npm run seed:demo --workspace @landingos/db

# 3. Build and start the platform:
npm run builder:build
npm run builder:start      # serves on http://127.0.0.1:3000
```

Then open **http://127.0.0.1:3000/console** and sign in with any account below.

---

## Demo credentials

**Password for every account:** `devpassword123`

| Email | Role | ERP job | What you can see |
|---|---|---|---|
| `owner@demo.test` | OWNER | — | Everything: console, ERP, builder, team, billing, settings |
| `manager@demo.test` | ADMIN | both | The ERP's full management surface (orders, agents, finance, automation) |
| `agent@demo.test` | MEMBER | confirmation | The agent queue — tap-to-dial, log calls, the working screen |
| `followup@demo.test` | MEMBER | followup | Follow-up tasks, the agent queue |

The **owner** is the account to use for a full walkthrough. The **agent** shows
the scoped call-centre experience. Sign in as each to see how the platform's
role model changes what a person reaches.

---

## URLs

| Surface | URL |
|---|---|
| Console (sign in) | http://127.0.0.1:3000/console |
| Storefront (the demo shop) | http://127.0.0.1:3000/demo |
| Login page | http://127.0.0.1:3000/console/login |
| Team management | http://127.0.0.1:3000/console/settings/team |
| Billing | http://127.0.0.1:3000/console/settings/billing |
| ERP overview | http://127.0.0.1:3000/console/erp |
| Agent queue | http://127.0.0.1:3000/console/erp/queue |

---

## What the demo contains

The `demo` tenant (Demo Trading Co.) holds a realistic ERP dataset:

- **4 products** with inventory: Écouteurs Bluetooth, Montre Connectée, Chargeur
  Rapide, Sac à Dos — each with two stock lots (FIFO) and an initial movement.
- **4 customers** across Alger, Oran, Constantine, Sétif, Annaba.
- **6 orders** in different states:
  - `ORD-0001` — pending, unassigned, waiting for a call.
  - `ORD-0002` — confirmed, parcel booked, tracking "created".
  - `ORD-0003` — confirmed, in transit (3 tracking events).
  - `ORD-0004` — delivered (settled, terminal, 4 tracking events).
  - `ORD-0005` — cancelled (customer refused, returned).
  - `ORD-0006` — confirmed, carrier reported "Client absent", has an open
    follow-up task and a pending call reminder.
- **1 carrier** (Yalidine Express, default, active) with 4 shipments and their
  tracking-event timelines.
- **1 follow-up task** (open, assigned to the follow-up agent).
- **2 notifications** (a new-order alert for the agent, a delivery-problem alert
  for the manager).
- **1 financial record** (last month's P&L: 487 000 DZD revenue, 37 % margin).
- **ERP automation settings** (auto-assign on, reservation on confirm, working
  hours 10–20, etc.).
- **1 delivery price** (Alger wilaya: 500 home / 300 desk).
- **Subscription**: bundle plan, ACTIVE, both products, 10 seats.

---

## How to recreate / reset

The seed is idempotent. Re-running it deletes the `demo` tenant (the cascade
wipes every scoped row) and recreates it from scratch:

```bash
npm run seed:demo --workspace @landingos/db
```

This does not touch the `seed:dev` tenants (`acme`, `beta-shop`) or any other
tenant — only the one whose slug is `demo`.

---

## Verified

The demo was verified live on 5 August 2026 (GLM-5.2):
- `npm run seed:demo` succeeds and is idempotent (run twice, no duplicates).
- Build clean (`✓ Compiled successfully`); server starts on :3000.
- Storefront at `/demo` returns 200.
- Console login at `/console/login` returns 200.
- Signed in as `owner@demo.test`: ERP orders (6), catalogue (4), team (4),
  billing (200) all reachable through the API.
