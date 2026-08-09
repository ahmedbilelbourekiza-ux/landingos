import { NextResponse } from "next/server";

import { asPlatform } from "@landingos/db";

import { siteConfig } from "@/config/site";
import { getR2Config } from "@/lib/r2";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Deployment health check.
 *
 * Named as the healthcheckPath in railway.json, so what this reports decides
 * whether a deploy is accepted. It therefore checks the things whose absence
 * would leave the platform looking alive and being useless.
 *
 * The database probe now uses the PLATFORM connection. It previously used the
 * legacy client, which meant the check could pass against a database no page
 * reads from — a green light on a broken deploy.
 *
 * Reference data is checked too. With no wilayas, every storefront renders
 * perfectly and can take no orders: checkout resolves a delivery price by
 * wilaya and finds nothing. That is precisely the failure a health check
 * exists to catch and a page-level smoke test would miss.
 *
 * Only resolved modes are reported — never credentials, bucket names or hosts.
 * ========================================================================== */

export async function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await asPlatform().$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (error) {
    healthy = false;
    checks.database = "unreachable";
    console.error("[health] database unreachable", error);
  }

  if (checks.database === "ok") {
    try {
      const wilayas = await asPlatform().wilaya.count();
      // The count, not a boolean: the number is what tells an operator whether
      // the seed ran partially.
      checks.referenceData =
        wilayas > 0 ? `${wilayas} wilayas` : "MISSING — run seed:reference";
      if (wilayas === 0) healthy = false;
    } catch {
      healthy = false;
      checks.referenceData = "unreadable";
    }

    /* WHO the connection is matters as much as WHETHER it works. The bound
     * client deliberately writes no `where: { tenantId }` — row-level
     * security is the layer that scopes every query — so a runtime role with
     * BYPASSRLS serves EVERY tenant's rows to every signed-in tenant, while
     * "database: ok" smiles. That exact misconfiguration ran in production:
     * one tenant's order list rendered sixty tenants' ORD-0001. The health
     * check now names the role's standing, and a bypassing role is UNHEALTHY,
     * so a deploy with the owner credential is refused instead of accepted. */
    try {
      const [role] = await asPlatform().$queryRaw<{ bypasses: boolean }[]>`
        SELECT (rolbypassrls OR rolsuper) AS bypasses
        FROM pg_roles WHERE rolname = current_user`;
      if (role?.bypasses) {
        healthy = false;
        checks.isolation = "BYPASSED — the runtime role ignores RLS; use the landingos_app credential";
      } else {
        checks.isolation = "rls";
      }
    } catch {
      // Not fatal on its own: pg_roles is readable by every role, so this
      // failing means something stranger than a wrong credential.
      checks.isolation = "unknown";
    }
  }

  // Uploads on local disk survive nothing on an ephemeral host, so this is
  // reported rather than merely configured.
  checks.uploads = getR2Config() ? "r2" : "local disk (not durable)";

  return NextResponse.json(
    {
      success: healthy,
      data: { service: siteConfig.name, version: siteConfig.version, checks },
    },
    { status: healthy ? 200 : 503 },
  );
}
