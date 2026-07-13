import { db } from "../src/lib/db";
import bcrypt from "bcryptjs";

// Seed the default admin account (admin/admin123).
//
// IMPORTANT — the seeded password is a default that MUST be changed on first
// login. The `mustChangePassword: true` flag enforces this: the dashboard
// redirects to /dashboard/profile and disables navigation until the password
// is changed. We never silently overwrite an existing admin's password or
// security flags — only the create path sets the defaults.
async function main() {
  console.log("Seeding admin + store settings...");

  const passwordHash = await bcrypt.hash("admin123", 10);
  await db.admin.upsert({
    where: { username: "admin" },
    create: {
      username: "admin",
      passwordHash,
      mustChangePassword: true,
    },
    update: {}, // do NOT reset an existing admin's password or flags
  });
  console.log("Admin seeded: username=admin password=admin123 (must change on first login)");

  await db.storeSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
  console.log("Store settings seeded.");

  await db.$disconnect();
}

main().catch(console.error);
