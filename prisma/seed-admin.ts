import { db } from "../src/lib/db";
import bcrypt from "bcryptjs";

async function main() {
  console.log("Seeding admin + store settings...");

  // Seed admin
  const passwordHash = await bcrypt.hash("admin123", 10);
  await db.admin.upsert({
    where: { username: "admin" },
    create: { username: "admin", passwordHash },
    update: {},
  });
  console.log("Admin seeded: username=admin password=admin123");

  // Seed store settings singleton
  await db.storeSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
  console.log("Store settings seeded.");

  await db.$disconnect();
}

main().catch(console.error);
