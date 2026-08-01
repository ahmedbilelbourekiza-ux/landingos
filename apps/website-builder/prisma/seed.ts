// Master seed script.
//
// Runs all seeders in order:
//   1. seed-admin    — default admin (admin/admin123) + store settings singleton
//   2. seed-themes   — built-in landing themes
//   3. seed-algeria  — 58 wilayas + baladias
//
// Usage:
//   npx prisma db seed
//
// This is configured in package.json under "prisma": { "seed": "tsx prisma/seed.ts" }
// so `npx prisma db seed` executes it automatically via tsx (no manual tsx
// command needed). Every seeder is idempotent — safe to re-run.

import { seedAdmin } from "./seed-admin";
import { seedThemes } from "./seed-themes";
import { seedAlgeria } from "./seed-algeria";

async function main() {
  console.log("=== LandingOS master seed ===\n");

  console.log("[1/3] Seeding admin + store settings...");
  await seedAdmin();
  console.log("");

  console.log("[2/3] Seeding themes...");
  await seedThemes();
  console.log("");

  console.log("[3/3] Seeding Algeria wilayas + baladias...");
  await seedAlgeria();
  console.log("");

  console.log("=== All seeds completed successfully ===");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    const { db } = await import("../src/lib/db");
    await db.$disconnect();
  });
