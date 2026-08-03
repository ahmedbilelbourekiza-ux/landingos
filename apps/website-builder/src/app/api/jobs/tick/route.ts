import { NextResponse, type NextRequest } from "next/server";

import { asPlatform, withTenant } from "@landingos/db";
import { productRegistry } from "@landingos/product-registry";

import { JOBS, runJob } from "@/lib/erp/jobs";
import { hasProduct } from "@/lib/erp/from-sale";

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
  if (!erp) return NextResponse.json({ tenants: 0, ran: 0, failed: 0 });

  // Unscoped, and named so it is obvious in a diff. Enumerating tenants is the
  // one thing this endpoint exists to do, and it is why it cannot use a
  // tenant-bound client to start with. `Tenant` is one of the five tables with
  // no RLS, so this read is legal without a binding — and it is the ONLY read
  // here that is.
  const active = await asPlatform().tenant.findMany({
    where: { deletedAt: null, status: "ACTIVE" },
    select: { id: true },
  });

  const results: Array<{ tenantId: string; job: string; ok: boolean }> = [];
  let entitled = 0;

  for (const tenant of active) {
    // THE ENTITLEMENT IS READ INSIDE THE BINDING, and this is the whole of the
    // bug 6.5b shipped. The first version selected `subscription` as a nested
    // relation on the `asPlatform()` query above — but `Subscription` is one of
    // the 47 RLS-scoped tables, so an unbound client reads NOTHING from it. Every
    // tenant came back with `subscription: null`, the filter dropped all of them,
    // and the tick answered `{ tenants: 0 }` — which the worker logged as
    // "0 jobs over 0 tenants", indistinguishable from a quiet system. The
    // scheduled work never ran once.
    //
    // It is the failure PROJECT_STATE warns about in its first paragraph: RLS
    // denies by returning zero rows, not by erroring. `hasProduct` now says in
    // its own contract that it must be given a bound client.
    const held = await withTenant(tenant.id, (db) => hasProduct(db, erp.id));
    if (!held) continue;
    entitled += 1;

    for (const job of JOBS) {
      try {
        // One transaction per job rather than one per tenant: the tracking poll
        // makes carrier calls, and three jobs sharing a 15s transaction is how a
        // slow carrier takes the escalations down with it.
        await withTenant(tenant.id, (db) => runJob(db, tenant.id, job));
        results.push({ tenantId: tenant.id, job, ok: true });
      } catch (error) {
        // Logged with the tenant, and the pass continues.
        console.error(`[worker] ${job} failed for ${tenant.id}`, error);
        results.push({ tenantId: tenant.id, job, ok: false });
      }
    }
  }

  return NextResponse.json({
    tenants: entitled,
    ran: results.length,
    failed: results.filter((r) => !r.ok).length,
  });
}
