import { NextResponse, type NextRequest } from "next/server";

import { asPlatform, withTenant } from "@landingos/db";
import { productRegistry } from "@landingos/product-registry";

import { JOBS, runJob } from "@/lib/erp/jobs";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The worker's tick — M-15.
 *
 * `services/worker` calls this on an interval. It is the ONLY thing that runs
 * the scheduled jobs across every tenant, and it is deliberately the thinnest
 * possible surface: the jobs themselves live beside the domain code they use,
 * and both this and the manager's "run it now" button go through the same
 * `runJob`, so a scheduled pass cannot behave differently from a manual one.
 *
 * WHY A PLATFORM ROUTE AND NOT A PRODUCT ONE. It iterates tenants, so it cannot
 * be tenant-scoped by a session — there is no session. `/api/erp/*` is the
 * product's authenticated surface; this is infrastructure, and it sits beside
 * `/api/health` where infrastructure belongs.
 *
 * IT FAILS CLOSED. With no `WORKER_SECRET` configured it answers 404, not 401 —
 * an unconfigured deployment should look like it has no such endpoint, because
 * saying "unauthorized" tells a stranger the endpoint is there and worth
 * guessing at. The comparison is length-checked and constant-time for the same
 * reason `verifySignature` is.
 *
 * ONE TENANT'S FAILURE DOES NOT STOP THE PASS. Each tenant is run in its own
 * `withTenant`, and an error is recorded against that tenant and the loop
 * continues. The alternative is one tenant with bad data freezing everybody
 * else's escalations — which is exactly the shape of BUG-01, where one throw
 * meant the sweep never reached anything.
 * ========================================================================== */

function authorised(req: NextRequest): boolean {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return false;

  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (provided.length !== secret.length) return false;

  // Constant-time: a length-safe comparison that does not leak how much of the
  // secret was right through timing.
  let diff = 0;
  for (let i = 0; i < secret.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const erp = productRegistry.get("erp");
  if (!erp) return NextResponse.json({ ran: [], tenants: 0 });

  // Unscoped, and named so it is obvious in a diff. Enumerating tenants is the
  // one thing this endpoint exists to do, and it is why it cannot use a
  // tenant-bound client to start with.
  const active = await asPlatform().tenant.findMany({
    where: { deletedAt: null, status: "ACTIVE" },
    select: {
      id: true,
      subscription: { select: { status: true, entitlements: true } },
    },
  });

  // Only tenants that have actually bought the product whose jobs these are: a
  // lapsed subscription stops the scheduled work exactly as it stops the routes,
  // without anybody maintaining a second list.
  //
  // Filtered here rather than in the WHERE because `entitlements` is a Json
  // column — a set, not a relation — and because reading the entitlement off the
  // MANIFEST is what keeps this file from naming a product. A tenth product's
  // jobs would join this loop by registering, not by editing it.
  const tenants = active.filter((tenant) => {
    if (tenant.subscription?.status !== "ACTIVE") return false;
    const held = tenant.subscription.entitlements;
    return Array.isArray(held) && held.includes(erp.entitlement);
  });

  const results: Array<{ tenantId: string; job: string; ok: boolean; detail?: unknown }> = [];

  for (const tenant of tenants) {
    for (const job of JOBS) {
      try {
        const result = await withTenant(tenant.id, (db) => runJob(db, tenant.id, job));
        results.push({ tenantId: tenant.id, job, ok: true, detail: result });
      } catch (error) {
        // Logged with the tenant, and the pass continues.
        console.error(`[worker] ${job} failed for ${tenant.id}`, error);
        results.push({ tenantId: tenant.id, job, ok: false });
      }
    }
  }

  return NextResponse.json({
    tenants: tenants.length,
    ran: results.length,
    failed: results.filter((r) => !r.ok).length,
  });
}
