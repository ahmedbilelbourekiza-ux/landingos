import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { JOBS, runJob, type JobName } from "@/lib/erp/jobs";

export const dynamic = "force-dynamic";

type Params = { job: string };

/**
 * Run one scheduled job now, for the caller's own tenant.
 *
 * `erp:settings:write`, the same permission the automation screen takes, because
 * this is the same kind of act: the sweep moves other people's missed-order
 * counters and can suspend accounts. It is not something an agent does.
 *
 * WHY A ROUTE AT ALL, when the point of M-15 is that these run on a timer.
 * Two reasons, and the second is the load-bearing one:
 *
 *   1. A manager needs to be able to say "run it now" after changing a
 *      threshold, rather than waiting out an interval to see what it does.
 *   2. **A timer is not something a contract test can wait for.** The ERP drove
 *      its sweep by shortening `CRM_SWEEP_INTERVAL_MS` on a child process, which
 *      is why `overdue-sweep.test.js` could not be ported in 5.1 — there was
 *      nothing to shorten. This is what it is ported against.
 *
 * The worker calls the same `runJob`, so neither path can drift from the other.
 */
export const POST = tenantRoute<Params>(
  "erp:settings:write",
  async ({ session, params, afterCommit }) => {
    if (!(JOBS as readonly string[]).includes(params.job)) {
      // The valid set travels with the refusal, so a caller never has to guess
      // — the same shape `POST /orders/[id]/call` uses for a bad result.
      return apiError(404, "NO_SUCH_JOB", `"${params.job}" is not a job.`, {
        valid: [...JOBS],
      });
    }

    /* LP.22 / N17 — RUN AFTER THIS REQUEST'S TRANSACTION COMMITS.
     *
     * `tenantRoute` runs a handler inside a 15-second interactive transaction,
     * and `tracking-poll` now reaches a real carrier (the Ecom adapter is the
     * first registered one that can be polled). `runJob` opens its own
     * bindings, and handing it this one would be exactly the thing D-LP.5.1
     * removed from booking.
     *
     * The response still waits for the answer — `afterCommit` is not a
     * background queue, and whoever pressed "run it now" is owed the result. */
    const tenantId = session.auth!.tenantId;
    afterCommit(async () => apiOk(await runJob(tenantId, params.job as JobName)));

    // Replaced by the step above in every ordinary case. Reached only if it
    // threw — which `tenantRoute` logs — and a job whose outcome is unknown
    // must not read as one that succeeded.
    return apiError(500, "JOB_FAILED", "The job did not complete.");
  },
);
