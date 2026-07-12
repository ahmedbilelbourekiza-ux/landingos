import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-response";
import { siteConfig } from "@/config/site";

// Lightweight health check. Proves the API layer, the env/config wiring, and
// the database connection are all alive. Useful as a deployment probe and as
// the first thing to hit when debugging.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return ok({
      status: "ok",
      service: siteConfig.name,
      version: siteConfig.version,
      time: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[health] database unreachable:", error);
    return serverError("Database unreachable");
  }
}
