/* =============================================================================
 * @landingos/worker — M-15.
 *
 * The ERP ran its scheduled work on two `setInterval`s inside its web process.
 * On a scaled deployment that runs once per instance, so every miss is counted
 * as many times as there are instances. This is the fix, and the shape of it is
 * the point:
 *
 *   THIS PROCESS HOLDS NO BUSINESS LOGIC AND NO DATABASE CONNECTION.
 *
 * It is a timer and an HTTP client, ~60 lines. Every job lives in
 * `apps/website-builder/src/lib/erp/jobs.ts`, beside the domain code it uses and
 * covered by `test/erp/jobs.test.ts`. A worker that reimplemented any of it
 * would be a second copy of rules the contract tests do not reach — the same
 * mistake D-06.1 refuses for write controls, in a process nobody looks at.
 *
 * WHY IT IS STILL SAFE TO RUN SEVERAL OF THESE. The jobs are idempotent by
 * column guard rather than by lock: a second pass matches nothing because the
 * first changed what it was matching on. So two workers, or a worker plus a
 * manager pressing "run now", cannot double-count a miss. That property is
 * asserted in the contract suite, not assumed here.
 *
 * Configuration, both required — it refuses to start without them rather than
 * looping quietly against nothing:
 *   WORKER_TARGET   the platform's origin, e.g. https://app.landingos.example
 *   WORKER_SECRET   must equal the platform's; the tick 404s otherwise
 *   WORKER_INTERVAL_MS   optional, default 60000
 * ========================================================================== */

const target = process.env.WORKER_TARGET;
const secret = process.env.WORKER_SECRET;
const intervalMs = Number(process.env.WORKER_INTERVAL_MS) || 60_000;

if (!target || !secret) {
  console.error(
    "[worker] WORKER_TARGET and WORKER_SECRET are both required. Refusing to start.",
  );
  process.exit(1);
}

let running = false;

/**
 * One pass.
 *
 * `running` is not a lock — the jobs do not need one — it only stops a slow tick
 * from overlapping itself and piling up requests when the platform is briefly
 * unresponsive.
 */
async function tick(): Promise<void> {
  if (running) {
    console.warn("[worker] previous tick still in flight, skipping this one");
    return;
  }
  running = true;
  const started = Date.now();

  try {
    const res = await fetch(`${target}/api/jobs/tick`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });

    if (!res.ok) {
      // A 404 here almost always means the secrets do not match: the tick fails
      // CLOSED and looks like an absent endpoint on purpose.
      console.error(`[worker] tick answered ${res.status}${res.status === 404 ? " — check WORKER_SECRET" : ""}`);
      return;
    }

    const body = (await res.json()) as { tenants?: number; ran?: number; failed?: number };
    const took = Date.now() - started;
    if (body.failed) {
      console.warn(`[worker] ${body.ran} jobs over ${body.tenants} tenants, ${body.failed} failed (${took}ms)`);
    } else {
      console.log(`[worker] ${body.ran} jobs over ${body.tenants} tenants (${took}ms)`);
    }
  } catch (error) {
    // Never rethrow: an unhandled rejection would take the process down and the
    // scheduled work would stop until somebody noticed. The next tick retries.
    console.error("[worker] tick failed", error);
  } finally {
    running = false;
  }
}

const timer = setInterval(tick, intervalMs);
// One immediately, so a deploy does not wait a whole interval to do anything.
void tick();

console.log(`[worker] started — ticking ${target} every ${intervalMs}ms`);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} — stopping`);
    clearInterval(timer);
    // In flight work is left to finish; the jobs are idempotent, so a tick cut
    // short is simply repeated by whoever starts next.
    process.exit(0);
  });
}
