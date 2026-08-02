/* =============================================================================
 * Development seed — the exit criterion for Phase 3.4.
 *
 * "A seed script provisions two tenants and three users, one of whom belongs to
 * both. The isolation suite passes against every table."
 *
 * The user in both tenants is the point. A person working with two companies
 * costs nothing to support now and is close to impossible to retrofit once
 * userId and tenantId have been conflated across forty tables — so the seed
 * exercises it from the first day rather than leaving it theoretical.
 *
 * The two tenants also hold DIFFERENT subscriptions: one buys both products,
 * one buys only the ERP. That makes "subscribe to any combination" a thing the
 * development database actually demonstrates, instead of a claim in a document.
 *
 * Idempotent. Run:  npm run seed:dev --workspace @landingos/db
 * ========================================================================== */

import { PrismaClient } from '../prisma/client/index.js';
import { hashPassword } from '@landingos/auth';

const db = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });

/* A well-known development password. Never a default in production: the
 * platform has no bootstrap path that invents credentials, precisely so a
 * deployment cannot inherit one. */
const DEV_PASSWORD = 'devpassword123';

async function main() {
  if (!process.env.MIGRATE_DATABASE_URL) {
    throw new Error('MIGRATE_DATABASE_URL is required — the seed writes across tenants');
  }

  const passwordHash = await hashPassword(DEV_PASSWORD);

  // --- Tenants ------------------------------------------------------------
  const acme = await db.tenant.upsert({
    where: { slug: 'acme' },
    update: {},
    create: { slug: 'acme', name: 'Acme Trading', locale: 'ar', currency: 'DZD' },
  });

  const beta = await db.tenant.upsert({
    where: { slug: 'beta-shop' },
    update: {},
    create: { slug: 'beta-shop', name: 'Beta Shop', locale: 'fr', currency: 'DZD' },
  });

  // --- Subscriptions ------------------------------------------------------
  // Acme buys the bundle; Beta buys only the ERP. Nothing about the platform
  // changes between the two — the difference is entirely these strings.
  await db.subscription.upsert({
    where: { tenantId: acme.id },
    update: { entitlements: ['product.website-builder', 'product.erp', 'seats.max:10'] },
    create: {
      tenantId: acme.id,
      plan: 'bundle',
      status: 'ACTIVE',
      seats: 10,
      entitlements: ['product.website-builder', 'product.erp', 'seats.max:10'],
    },
  });

  await db.subscription.upsert({
    where: { tenantId: beta.id },
    update: { entitlements: ['product.erp', 'seats.max:3'] },
    create: {
      tenantId: beta.id,
      plan: 'erp-only',
      status: 'ACTIVE',
      seats: 3,
      entitlements: ['product.erp', 'seats.max:3'],
    },
  });

  // --- Users --------------------------------------------------------------
  const users = [
    { email: 'owner@acme.test', name: 'Amina Ould', locale: 'ar' },
    { email: 'agent@acme.test', name: 'Sara Benali', locale: 'ar' },
    { email: 'consultant@landingos.test', name: 'Yacine Meziane', locale: 'fr' },
  ];

  const created: Record<string, { id: string }> = {};
  for (const u of users) {
    created[u.email] = await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name, locale: u.locale },
      create: { ...u, passwordHash, mustChangePassword: false },
    });
  }

  // --- Memberships --------------------------------------------------------
  const memberships = [
    { tenantId: acme.id, userId: created['owner@acme.test'].id, role: 'OWNER' as const, permissions: [] },
    {
      tenantId: acme.id,
      userId: created['agent@acme.test'].id,
      role: 'MEMBER' as const,
      // A confirmation agent: reads and works orders, and nothing else. The
      // ERP's own distinction between the JOB and the PRIVILEGE, preserved.
      permissions: ['erp:orders:write'],
      jobRole: 'confirmation',
    },
    // The same person, in both companies, with a different role in each. This
    // is the case the whole identity model exists to make possible.
    {
      tenantId: acme.id,
      userId: created['consultant@landingos.test'].id,
      role: 'VIEWER' as const,
      permissions: [],
    },
    {
      tenantId: beta.id,
      userId: created['consultant@landingos.test'].id,
      role: 'ADMIN' as const,
      permissions: [],
    },
  ];

  for (const m of memberships) {
    await db.membership.upsert({
      where: { tenantId_userId: { tenantId: m.tenantId, userId: m.userId } },
      update: { role: m.role, permissions: m.permissions, jobRole: (m as any).jobRole ?? null },
      create: { ...m, jobRole: (m as any).jobRole ?? null },
    });
  }

  // --- Report -------------------------------------------------------------
  const report = await db.tenant.findMany({
    where: { slug: { in: ['acme', 'beta-shop'] } },
    include: {
      subscription: true,
      memberships: { include: { user: { select: { email: true } } } },
    },
    orderBy: { slug: 'asc' },
  });

  console.log('\nseeded:\n');
  for (const t of report) {
    const ents = (t.subscription?.entitlements as string[]) ?? [];
    const products = ents.filter((e) => e.startsWith('product.')).map((e) => e.replace('product.', ''));
    console.log(`  ${t.name}  (/${t.slug})`);
    console.log(`    products: ${products.join(', ') || 'none'}`);
    for (const m of t.memberships) {
      console.log(`    ${m.role.padEnd(7)} ${m.user.email}`);
    }
    console.log('');
  }

  const shared = report[0]?.memberships
    .map((m) => m.user.email)
    .filter((e) => report[1]?.memberships.some((n) => n.user.email === e));
  console.log(`  in both tenants: ${shared?.join(', ') || 'none'}`);
  console.log(`  password for every seeded user: ${DEV_PASSWORD}\n`);
}

main()
  .catch((e) => {
    console.error('seed failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
