/* =============================================================================
 * Demo seed — a fully working tenant for manual evaluation.
 *
 * Creates one tenant ("demo") with an OWNER, a manager, two agents, a sample
 * catalogue, inventory, customers, orders in several states, a carrier, a
 * shipment with tracking events, follow-up tasks, notifications, a financial
 * record and the ERP automation settings. Deterministic and idempotent: running
 * it twice produces the same state, never a duplicate.
 *
 * WHY THIS EXISTS ALONGSIDE seed-dev. seed-dev provisions the two-tenant,
 * three-user identity cases the platform's own tests depend on. This script
 * provisions a rich ERP dataset a person can click through — the thing that
 * turns "the build is green" into "I can see it working".
 *
 * IDEMPOTENCE STRATEGY. Platform rows (Tenant, User, Membership, Subscription,
 * ProductSetting) are upserted on stable keys (slug, email, tenantId+userId,
 * tenantId+product+key). ERP domain rows are tenant-scoped, so they are written
 * through `withTenant`, and because ERP rows do not all have natural unique
 * keys the script deletes the tenant's ERP rows first and recreates them. The
 * tenant delete cascades every scoped table, so a single `tenant.delete` +
 * `tenant.create` is the clean slate.
 *
 * Run:  npm run seed:demo --workspace @landingos/db
 * ========================================================================== */

import { PrismaClient } from '../prisma/client/index.js';
import { withTenant } from '../src/tenant-client.ts';
import { hashPassword } from '@landingos/auth';

const db = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });

const DEMO_PASSWORD = 'devpassword123';
const SLUG = 'demo';

async function main() {
  if (!process.env.MIGRATE_DATABASE_URL) {
    throw new Error('MIGRATE_DATABASE_URL is required — the seed writes across tenants');
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // --- Clean slate --------------------------------------------------------
  // Delete any existing demo tenant; the cascade wipes every scoped row so the
  // ERP data is recreated deterministically. Then recreate the tenant.
  const existing = await db.tenant.findUnique({ where: { slug: SLUG } });
  if (existing) {
    await db.tenant.delete({ where: { id: existing.id } });
  }

  const tenant = await db.tenant.create({
    data: { slug: SLUG, name: 'Demo Trading Co.', locale: 'ar', currency: 'DZD' },
  });

  // --- Subscription -------------------------------------------------------
  // Both products, ACTIVE — the demo is a paying customer, not a trial.
  await db.subscription.create({
    data: {
      tenantId: tenant.id,
      plan: 'bundle',
      status: 'ACTIVE',
      seats: 10,
      entitlements: ['product.website-builder', 'product.erp', 'seats.max:10'],
    },
  });

  // --- Users + memberships ------------------------------------------------
  // An owner, a manager (ADMIN with the agents-manage job), and two agents —
  // one confirmation, one follow-up. The owner is the company's admin; the
  // manager runs the call centre; the agents work orders.
  const people = [
    { email: 'owner@demo.test', name: 'Leila Hadj', role: 'OWNER' as const, perms: [] as string[], jobRole: null },
    { email: 'manager@demo.test', name: 'Karim Saadi', role: 'ADMIN' as const, perms: [] as string[], jobRole: 'both' },
    { email: 'agent@demo.test', name: 'Sara Benali', role: 'MEMBER' as const, perms: ['erp:orders:write', 'erp:ai:use'], jobRole: 'confirmation' },
    { email: 'followup@demo.test', name: 'Yacine Meziane', role: 'MEMBER' as const, perms: ['erp:orders:write', 'erp:ai:use'], jobRole: 'followup' },
  ];

  const userIds: Record<string, string> = {};
  for (const p of people) {
    // A prior run may have left the user (the tenant cascade does not reach
    // User — it is global). Upsert on email.
    const u = await db.user.upsert({
      where: { email: p.email },
      update: { name: p.name, passwordHash, deletedAt: null },
      create: { email: p.email, name: p.name, passwordHash, mustChangePassword: false },
    });
    userIds[p.email] = u.id;
  }

  // Memberships are tenant-scoped — write through the binding.
  await withTenant(tenant.id, async (tx) => {
    for (const p of people) {
      await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId: userIds[p.email],
          role: p.role,
          permissions: p.perms,
          jobRole: p.jobRole,
        },
      });
    }
  });

  // All ERP domain data — written through the tenant binding.
  await withTenant(tenant.id, async (tx) => {
    const anyTx = tx as any;

    // --- ERP automation settings -------------------------------------------
    // One ProductSetting row holding the whole settings object, the way
    // PUT /api/erp/settings stores it.
    await anyTx.productSetting.upsert({
      where: { tenantId_product_key: { tenantId: tenant.id, product: 'erp', key: 'settings' } },
      update: {},
      create: {
        tenantId: tenant.id,
        product: 'erp',
        key: 'settings',
        value: {
          autoAssign: true,
          minCallSeconds: 40,
          alertMinutes: 60,
          autoCreateShipment: true,
          trackingPollMinutes: 15,
          followupAutoAssign: true,
          followupReminderMinutes: 120,
          reservationMode: 'on_confirm',
          autoReassign: false,
          reassignMinutes: 5,
          autoSuspend: false,
          suspendThreshold: 5,
          workHoursStart: 10,
          workHoursEnd: 20,
          nightGraceMinutes: 120,
          fixedCosts: [],
        },
      },
    });

    // --- Catalogue ---------------------------------------------------------
    const products = [
      { reference: 'P-001', name: 'Écouteurs Bluetooth Pro', sku: 'EB-PRO', brand: 'SoundMax', price: 3500, cost: 1800 },
      { reference: 'P-002', name: 'Montre Connectée Sport', sku: 'MC-SPORT', brand: 'TechWear', price: 8900, cost: 5200 },
      { reference: 'P-003', name: 'Chargeur Rapide 65W', sku: 'CR-65W', brand: 'PowerUp', price: 1800, cost: 700 },
      { reference: 'P-004', name: 'Sac à Dos Antivol', sku: 'SD-ANTI', brand: 'UrbanSafe', price: 4200, cost: 2100 },
    ];
    const productIds: Record<string, string> = {};
    for (const p of products) {
      const row = await anyTx.catalogProduct.create({
        data: {
          tenantId: tenant.id,
          reference: p.reference,
          name: p.name,
          sku: p.sku,
          brand: p.brand,
          price: p.price,
          costPrice: p.cost,
          packagingCost: 200,
          stock: 0,
          threshold: 5,
          archived: false,
        },
      });
      productIds[p.reference] = row.id;
    }

    // --- Inventory (lots + movements) --------------------------------------
    // Two lots per product so the FIFO machinery has something to draw from.
    for (const p of products) {
      const pid = productIds[p.reference];
      // Lot 1: cheaper, older, partially consumed.
      const lot1 = await anyTx.stockLot.create({
        data: {
          tenantId: tenant.id,
          productId: pid,
          unitCost: p.cost - 100,
          packagingCost: 200,
          qtyOriginal: 50,
          qtyRemaining: 30,
          source: 'purchase',
        },
      });
      // Lot 2: newer, full.
      await anyTx.stockLot.create({
        data: {
          tenantId: tenant.id,
          productId: pid,
          unitCost: p.cost,
          packagingCost: 200,
          qtyOriginal: 40,
          qtyRemaining: 40,
          source: 'purchase',
        },
      });
      // An initial movement recording the stock-in.
      await anyTx.inventoryMovement.create({
        data: {
          tenantId: tenant.id,
          productId: pid,
          delta: 50,
          prevQty: 0,
          newQty: 50,
          reason: 'initial',
          unitCost: p.cost - 100,
        },
      });
      // Update the product's aggregate stock.
      await anyTx.catalogProduct.update({
        where: { id: pid },
        data: { stock: 70 },
      });
      void lot1;
    }

    // --- Carrier -----------------------------------------------------------
    const carrier = await anyTx.carrier.create({
      data: {
        tenantId: tenant.id,
        name: 'Yalidine Express',
        code: 'yalidine',
        adapter: 'yalidine',
        apiEnabled: true,
        webhookEnabled: true,
        isDefault: true,
        active: true,
      },
    });

    // --- Customers ---------------------------------------------------------
    const customers = [
      { phone: '0551123456', name: 'Ahmed Boudjelal', wilaya: 'Alger', commune: 'Bab Ezzouar' },
      { phone: '0661987654', name: 'Fatima Zohra', wilaya: 'Oran', commune: 'Es Senia' },
      { phone: '0770456123', name: 'Mohamed Cherif', wilaya: 'Constantine', commune: 'El Khroub' },
      { phone: '0552345987', name: 'Nadia Belkacem', wilaya: 'Sétif', commune: 'El Eulma' },
      { phone: '0667890123', name: 'Sofiane Brahimi', wilaya: 'Annaba', commune: 'Bouchegouf' },
    ];
    for (const c of customers) {
      await anyTx.client.create({
        data: {
          tenantId: tenant.id,
          phone: c.phone,
          phoneDisplay: c.phone,
          name: c.name,
          wilaya: c.wilaya,
          commune: c.commune,
          totalOrders: 1,
          confirmedOrders: 1,
        },
      });
    }

    // --- Orders in several states ------------------------------------------
    const agent = userIds['agent@demo.test'];
    const followup = userIds['followup@demo.test'];
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 86400_000);

    const orders = [
      // 1. Pending — brand new, unassigned, waiting for a call.
      {
        reference: 'ORD-0001', status: 'pending', client: 'Ahmed Boudjelal', phone: '0551123456',
        product: 'Écouteurs Bluetooth Pro', qty: 1, price: 3500, wilaya: 'Alger', commune: 'Bab Ezzouar',
        createdAt: daysAgo(0), agentUserId: null,
      },
      // 2. Confirmed — agent called, customer said yes, parcel booked.
      {
        reference: 'ORD-0002', status: 'confirmed', client: 'Fatima Zohra', phone: '0661987654',
        product: 'Montre Connectée Sport', qty: 1, price: 8900, wilaya: 'Oran', commune: 'Es Senia',
        createdAt: daysAgo(1), agentUserId: agent, deliveryStatus: 'created', trackingNumber: 'YD-100023',
      },
      // 3. In transit — carrier picked it up.
      {
        reference: 'ORD-0003', status: 'confirmed', client: 'Mohamed Cherif', phone: '0770456123',
        product: 'Chargeur Rapide 65W', qty: 2, price: 3600, wilaya: 'Constantine', commune: 'El Khroub',
        createdAt: daysAgo(2), agentUserId: agent, deliveryStatus: 'in_progress', trackingNumber: 'YD-100045',
      },
      // 4. Delivered — settled, terminal.
      {
        reference: 'ORD-0004', status: 'delivered', client: 'Nadia Belkacem', phone: '0552345987',
        product: 'Sac à Dos Antivol', qty: 1, price: 4200, wilaya: 'Sétif', commune: 'El Eulma',
        createdAt: daysAgo(5), agentUserId: agent, deliveryStatus: 'delivered',
        deliveryOutcome: 'delivered', deliveryOutcomeAt: daysAgo(3), trackingNumber: 'YD-100067',
      },
      // 5. Cancelled — customer refused on delivery.
      {
        reference: 'ORD-0005', status: 'cancelled', client: 'Sofiane Brahimi', phone: '0667890123',
        product: 'Écouteurs Bluetooth Pro', qty: 1, price: 3500, wilaya: 'Annaba', commune: 'Bouchegouf',
        createdAt: daysAgo(4), agentUserId: agent, deliveryStatus: 'returned',
        deliveryOutcome: 'returned', deliveryOutcomeAt: daysAgo(2), trackingNumber: 'YD-100088',
      },
      // 6. Confirmed with a follow-up task — the carrier reported a problem.
      {
        reference: 'ORD-0006', status: 'confirmed', client: 'Ahmed Boudjelal', phone: '0551234567',
        product: 'Montre Connectée Sport', qty: 1, price: 8900, wilaya: 'Alger', commune: 'Hydra',
        createdAt: daysAgo(3), agentUserId: agent, followupUserId: followup,
        deliveryStatus: 'in_progress', trackingNumber: 'YD-100099',
        callReminderStatus: 'pending', callReminderDue: new Date(now + 3600_000),
      },
    ];

    const orderIds: Record<string, string> = {};
    for (const o of orders) {
      const row = await anyTx.fulfillmentOrder.create({
        data: {
          tenantId: tenant.id,
          reference: o.reference,
          status: o.status,
          client: o.client,
          phone: o.phone,
          phoneNormalized: o.phone,
          city: o.wilaya,
          wilaya: o.wilaya,
          commune: o.commune,
          product: o.product,
          quantity: o.qty,
          price: o.price,
          unitPrice: o.price,
          subtotal: o.price,
          shippingCost: 500,
          agentUserId: o.agentUserId,
          carrierId: carrier.id,
          deliveryMethod: 'COD',
          deliveryStatus: o.deliveryStatus ?? null,
          deliveryOutcome: o.deliveryOutcome ?? '',
          deliveryOutcomeAt: o.deliveryOutcomeAt ?? null,
          trackingNumber: o.trackingNumber ?? null,
          followupUserId: o.followupUserId ?? null,
          callReminderStatus: o.callReminderStatus ?? '',
          callReminderDue: o.callReminderDue ?? null,
          createdAt: o.createdAt,
        },
      });
      orderIds[o.reference] = row.id;
    }

    // --- Shipments + tracking events (for the in-transit and delivered orders)
    const withTracking = [
      { ref: 'ORD-0002', status: 'created', events: [{ s: 'created', d: 'Parcel registered' }] },
      { ref: 'ORD-0003', status: 'in_progress', events: [
        { s: 'created', d: 'Parcel registered' },
        { s: 'picked_up', d: 'Picked up from warehouse' },
        { s: 'in_transit', d: 'In transit to destination' },
      ] },
      { ref: 'ORD-0004', status: 'delivered', events: [
        { s: 'created', d: 'Parcel registered' },
        { s: 'picked_up', d: 'Picked up from warehouse' },
        { s: 'in_transit', d: 'In transit to destination' },
        { s: 'delivered', d: 'Delivered to customer' },
      ] },
      { ref: 'ORD-0006', status: 'in_progress', events: [
        { s: 'created', d: 'Parcel registered' },
        { s: 'picked_up', d: 'Picked up from warehouse' },
        { s: 'client_absent', d: 'Client absent — follow-up required' },
      ] },
    ];
    for (const t of withTracking) {
      const order = orders.find((o) => o.reference === t.ref)!;
      const ship = await anyTx.shipment.create({
        data: {
          tenantId: tenant.id,
          orderId: orderIds[t.ref],
          carrierId: carrier.id,
          trackingNumber: order.trackingNumber,
          crmStatus: t.status,
        },
      });
      for (const ev of t.events) {
        await anyTx.shipmentEvent.create({
          data: {
            tenantId: tenant.id,
            shipmentId: ship.id,
            crmStatus: ev.s,
            originalStatus: ev.s,
            description: ev.d,
            eventTime: new Date(now - 86400_000),
          },
        });
      }
    }

    // --- Follow-up tasks ---------------------------------------------------
    // One open task on the order whose carrier reported "client absent".
    await anyTx.followupTask.create({
      data: {
        tenantId: tenant.id,
        orderId: orderIds['ORD-0006'],
        type: 'call_customer',
        status: 'open',
        agentUserId: followup,
        reason: 'Client absent — carrier reported delivery attempt failed',
        dueAt: new Date(now + 3600_000),
      },
    });

    // --- Notifications -----------------------------------------------------
    // A new-order notification for the agents, and a delivery update for the
    // manager. The audience is one row per recipient (M-16).
    await anyTx.notification.create({
      data: {
        tenantId: tenant.id,
        product: 'erp',
        type: 'new_order',
        title: 'New order',
        body: `Order ORD-0001 is waiting to be confirmed.`,
        targetUserId: agent,
      },
    });
    await anyTx.notification.create({
      data: {
        tenantId: tenant.id,
        product: 'erp',
        type: 'delivery_update',
        title: 'Delivery problem',
        body: `ORD-0006: carrier reports "Client absent".`,
        targetUserId: userIds['manager@demo.test'],
      },
    });

    // --- Financial record (last month's P&L) -------------------------------
    const monthStart = new Date(now - 30 * 86400_000);
    const monthEnd = new Date(now);
    await anyTx.financialRecord.create({
      data: {
        tenantId: tenant.id,
        periodType: 'month',
        startDate: monthStart,
        endDate: monthEnd,
        revenue: 487000,
        productCosts: 196000,
        shippingCosts: 32000,
        advertisingCosts: 45000,
        fixedExpenses: 28000,
        unexpectedExpenses: 5000,
        netProfit: 181000,
        margin: 37,
        source: 'manual',
        notes: 'Demo P&L for the last 30 days',
      },
    });

    // --- A delivery price for wilaya 16 (Alger) ----------------------------
    const algiers = await db.wilaya.findFirst({ where: { code: '16' } });
    if (algiers) {
      await anyTx.tenantDeliveryPrice.upsert({
        where: { tenantId_wilayaId: { tenantId: tenant.id, wilayaId: algiers.id } },
        update: {},
        create: { tenantId: tenant.id, wilayaId: algiers.id, homePrice: 500, deskPrice: 300 },
      });
    }
  });

  // --- Report -------------------------------------------------------------
  console.log('\ndemo tenant seeded:\n');
  console.log(`  slug:   /${SLUG}`);
  console.log(`  url:    http://127.0.0.1:3000/${SLUG}`);
  console.log(`  console: http://127.0.0.1:3000/console\n`);
  console.log('  credentials (password for all: %s):', DEMO_PASSWORD);
  for (const p of people) {
    console.log('    %-22s  %s%s', p.email, p.role, p.jobRole ? ` (${p.jobRole})` : '');
  }
  console.log('\n  data: 4 products, 4 customers, 6 orders (pending → delivered → cancelled),');
  console.log('        1 carrier, 4 shipments with tracking events, 1 follow-up task,');
  console.log('        2 notifications, 1 financial record, ERP automation settings.\n');
}

main()
  .catch((e) => {
    console.error('demo seed failed:', e.message);
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
