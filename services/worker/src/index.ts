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
 *   WORKER_TIMEOUT_MS    optional, default 10 × the interval — see AUDIT.9
 * ========================================================================== */

const target = process.env.WORKER_TARGET;
const secret = process.env.WORKER_SECRET;
const intervalMs = Number(process.env.WORKER_INTERVAL_MS) || 60_000;

/* AUDIT.9 — WHY THE REQUEST NEEDS A DEADLINE OF ITS OWN.
 *
 * `fetch` has no default timeout. Without one, a platform that accepts the
 * connection and never answers holds `running` true forever: every subsequent
 * tick logs "previous tick still in flight, skipping this one" and **the
 * scheduled work stops permanently.** The only evidence is a warn line
 * repeating once an interval, which reads like the tick is merely slow.
 *
 * That is precisely the outcome the `catch` below exists to prevent — its
 * comment says "the scheduled work would stop until somebody noticed. The next
 * tick retries" — and with no deadline there IS no next tick. An unbounded
 * request defeated the guarantee the file states.
 *
 * TEN INTERVALS, not one. The tick legitimately takes longer than an interval
 * on a large deployment: it iterates every entitled tenant and `tracking-poll`
 * reaches real carriers. A deadline near the interval would abort healthy work
 * and turn a slow pass into no pass at all. Ten is far beyond any honest pass
 * and far short of forever.
 *
 * THE FLOOR APPLIES TO THE DERIVED DEFAULT AND NOT TO AN EXPLICIT SETTING, and
 * the test caught the first version doing the opposite. A tiny interval — the
 * suite drives one — must not make the deadline the flaky part, which is what
 * the floor is for. But a value somebody typed is an instruction, and clamping
 * it silently means an operator sets `WORKER_TIMEOUT_MS` and watches nothing
 * change. An override that is quietly ignored is worse than no override.
 */
const explicitDeadline = Number(process.env.WORKER_TIMEOUT_MS);
const deadlineMs = explicitDeadline > 0
  ? explicitDeadline
  : Math.max(intervalMs * 10, 30_000);

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
      // AUDIT.9. See `deadlineMs`. Aborting frees `running` in the `finally`,
      // so the next interval genuinely retries rather than skipping forever.
      signal: AbortSignal.timeout(deadlineMs),
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
    //
    // AUDIT.9: a timeout is named rather than lumped in with every other
    // failure, because the two need different things done about them. "The
    // platform did not answer in 10 minutes" means look at the platform; a
    // connection refused means look at WORKER_TARGET.
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      console.error(
        `[worker] tick did not answer within ${deadlineMs}ms — aborted so the next one can run. `
        + "If this repeats, the platform is not completing a pass: check its logs, "
        + "and WORKER_TIMEOUT_MS if the deployment is genuinely large.",
      );
      return;
    }
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
