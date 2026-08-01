import { PrismaClient } from "@prisma/client";

// Single shared Prisma client. In development, Next.js reloads modules on
// every request, which would otherwise spawn a new PrismaClient each time
// and exhaust database connections. We stash the instance on globalThis so
// hot-reloads reuse the same client.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
