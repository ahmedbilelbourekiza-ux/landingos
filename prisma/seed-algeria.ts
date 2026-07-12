// Seeds the Wilaya + Baladia tables with the Algeria administrative dataset.
// Run with: bunx tsx prisma/seed-algeria.ts
// Idempotent — safe to run multiple times (upserts by wilaya code).

import { db } from "../src/lib/db";
import { algeriaWilayas } from "./algeria-data";

async function main() {
  console.log("Seeding Algeria wilayas + baladias...");

  let baladiaId = 1;

  for (const w of algeriaWilayas) {
    const wilayaId = parseInt(w.code, 10);
    await db.wilaya.upsert({
      where: { code: w.code },
      create: { id: wilayaId, code: w.code, name: w.name, nameAr: w.nameAr },
      update: { name: w.name, nameAr: w.nameAr },
    });

    for (const baladiaName of w.baladias) {
      // Check if baladia already exists for this wilaya
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
  console.log(`Done. ${wilayaCount} wilayas, ${baladiaCount} baladias seeded.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
