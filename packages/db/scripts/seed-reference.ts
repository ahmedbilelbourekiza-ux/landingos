/* =============================================================================
 * Platform reference data — the 58 Algerian wilayas and their communes.
 *
 * NOT tenant-scoped: these are facts about the country, shared by every tenant,
 * and among the only rows in the database with no tenantId and no RLS policy.
 *
 * Their absence is quiet and awful. Checkout resolves a delivery price by
 * wilaya, so with an empty table every order form offers no destinations and
 * every price lookup returns nothing — a storefront that renders perfectly and
 * cannot take an order. The database reset in 3.3 dropped them and nothing put
 * them back; a Phase 4.4 test asking for the wilaya list is what surfaced it.
 *
 * Ids follow the legacy seed exactly — a wilaya's id is its official code
 * parsed as an integer, and baladias are numbered sequentially in dataset
 * order — so anything already referencing them still resolves.
 *
 * Idempotent. Run:  npm run seed:reference --workspace @landingos/db
 * ========================================================================== */

import { PrismaClient } from '../prisma/client/index.js';
import { algeriaWilayas } from '../../../apps/website-builder/prisma/algeria-data.ts';

const db = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });

async function main() {
  if (!process.env.MIGRATE_DATABASE_URL) {
    throw new Error('MIGRATE_DATABASE_URL is required — reference data is platform-owned');
  }

  let baladiaId = 1;
  const baladiaRows: { id: number; name: string; wilayaId: number }[] = [];

  for (const w of algeriaWilayas) {
    const wilayaId = parseInt(w.code, 10);
    await db.wilaya.upsert({
      where: { code: w.code },
      create: { id: wilayaId, code: w.code, name: w.name, nameAr: w.nameAr ?? null },
      update: { name: w.name, nameAr: w.nameAr ?? null },
    });

    for (const name of w.baladias) {
      baladiaRows.push({ id: baladiaId++, name, wilayaId });
    }
  }

  // One statement rather than 1500 round trips for data that never changes.
  // skipDuplicates makes a re-run a no-op instead of a conflict.
  await db.baladia.createMany({ data: baladiaRows, skipDuplicates: true });

  console.log(`wilayas: ${await db.wilaya.count()}   baladias: ${await db.baladia.count()}`);
}

main()
  .catch((e) => {
    console.error('seed-reference failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
