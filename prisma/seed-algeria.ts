// Seeds the Wilaya + Baladia tables with the Algeria administrative dataset.
// Idempotent — safe to run multiple times (upserts by wilaya code, checks
// baladia existence before insert).
//
// Exported so the master seed (prisma/seed.ts) can call it in order.

import { db } from "../src/lib/db";
import { algeriaWilayas } from "./algeria-data";

export async function seedAlgeria() {
  let baladiaId = 1;

  for (const w of algeriaWilayas) {
    const wilayaId = parseInt(w.code, 10);
    await db.wilaya.upsert({
      where: { code: w.code },
      create: { id: wilayaId, code: w.code, name: w.name, nameAr: w.nameAr },
      update: { name: w.name, nameAr: w.nameAr },
    });

    for (const baladiaName of w.baladias) {
      const existing = await db.baladia.findFirst({
        where: { name: baladiaName, wilayaId },
        select: { id: true },
      });
      if (!existing) {
        await db.baladia.create({
          data: { id: baladiaId, name: baladiaName, wilayaId },
        });
        baladiaId++;
      }
    }
  }

  const wilayaCount = await db.wilaya.count();
  const baladiaCount = await db.baladia.count();
  console.log(`  ✓ ${wilayaCount} wilayas, ${baladiaCount} baladias seeded`);
}

// Backwards-compatible CLI entry point (bun prisma/seed-algeria.ts).
async function main() {
  console.log("Seeding Algeria wilayas + baladias...");
  await seedAlgeria();
  console.log("Done.");
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
