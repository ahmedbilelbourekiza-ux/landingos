import { db } from "../src/lib/db";
import bcrypt from "bcryptjs";

// Seed the default admin account (admin/admin123) + store settings singleton.
//
// IMPORTANT — the seeded password is a default that MUST be changed on first
// login. The `mustChangePassword: true` flag enforces this: the dashboard
// redirects to /dashboard/profile and disables navigation until the password
// is changed. We never silently overwrite an existing admin's password or
// security flags — only the create path sets the defaults.
//
// Exported so the master seed (prisma/seed.ts) can call it in order. Also
// runnable standalone for backwards compatibility.
export async function seedAdmin() {
  // Credentials are configurable via env vars. Defaults are intentionally the
  // documented local-preview pair (admin/admin123) so nothing changes for
  // existing devs. In production, set ADMIN_USERNAME + ADMIN_PASSWORD on the
  // host to secure the account — the upsert below seeds those values into the
  // database on first boot.
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  // If a custom password was provided via env, the account is considered
  // already-secured (mustChangePassword=false). The default password still
  // forces a change on first login.
  const mustChange =
    process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD !== "admin123"
      ? false
      : true;

  const passwordHash = await bcrypt.hash(password, 10);
  await db.admin.upsert({
    where: { username },
    create: {
      username,
      passwordHash,
      mustChangePassword: mustChange,
    },
    update: {}, // do NOT reset an existing admin's password or flags
  });
  console.log(
    `  ✓ Admin seeded: username=${username} password=${"*".repeat(password.length)} (mustChange=${mustChange})`,
  );

  await db.storeSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
  console.log("  ✓ Store settings singleton seeded");
}

// Backwards-compatible CLI entry point (bun prisma/seed-admin.ts).
if (require.main === module) {
  seedAdmin()
    .catch(console.error)
    .finally(() => db.$disconnect());
}
