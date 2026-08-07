import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/* =============================================================================
 * services/worker — AUDIT.9, and the first test this process has ever had.
 *
 * It is ~90 lines and holds no business logic, which is why it was never
 * tested: every job lives in `apps/website-builder/src/lib/erp/jobs.ts` and is
 * covered by `test/erp/jobs.test.ts`. But the ~90 lines it does hold decide
 * WHETHER ANY OF THAT RUNS AT ALL, and one of them was wrong.
 *
 * THE DEFECT. `fetch` has no default timeout. A platform that accepts the
 * connection and never answers held `running` true forever; every later tick
 * logged "previous tick still in flight, skipping this one" and the scheduled
 * work stopped permanently. The only evidence was a warn line once an interval,
 * which reads exactly like a tick that is merely slow. The file's own `catch`
 * says "the next tick retries" — with no deadline there was no next tick.
 *
 * WHY A REAL PROCESS AND A REAL SERVER. The thing under test is a timer, a
 * fetch and a boolean, and the failure is about what happens BETWEEN ticks. A
 * unit test of `tick()` cannot see it: the bug is that the second call is
 * skipped. So this runs the worker as its own process against a server that
 * deliberately never answers, and reads what it says.
 * ========================================================================== */

const WORKER = path.join(import.meta.dirname, '..', 'src', 'index.ts');
const SECRET = 'audit9-secret';

/** A server whose /api/jobs/tick accepts the connection and never responds. */
function blackHole(): Promise<{ port: number; hits: () => number; close: () => Promise<void> }> {
  let hits = 0;
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer((req) => {
    hits += 1;
    // No `res.end()`, ever. This is the case the deadline exists for.
    req.socket.setKeepAlive(true);
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({
        port,
        hits: () => hits,
        close: () => new Promise((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}

function runWorker(env: Record<string, string>): {
  child: ChildProcess;
  output: () => string;
} {
  let output = '';
  const child = spawn(process.execPath, [WORKER], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (c) => { output += String(c); });
  child.stderr?.on('data', (c) => { output += String(c); });
  return { child, output: () => output };
}

/** Wait for `predicate`, or give up. Polling, because output arrives async. */
async function until(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return predicate();
}

describe('the worker refuses to start without its configuration', () => {
  test('no target and no secret is a refusal, not a quiet loop', async () => {
    // Stated in the file: it refuses "rather than looping quietly against
    // nothing", because a worker that logs nothing looks identical to a worker
    // with nothing to do.
    const { child, output } = runWorker({ WORKER_TARGET: '', WORKER_SECRET: '' });
    const code = await new Promise<number | null>((r) => child.on('exit', r));
    assert.equal(code, 1, 'an unconfigured worker started anyway');
    assert.match(output(), /required/i);
  });
});

describe('a tick that never answers does not stop the scheduled work (AUDIT.9)', () => {
  let hole: Awaited<ReturnType<typeof blackHole>>;
  let worker: ReturnType<typeof runWorker>;

  before(async () => {
    hole = await blackHole();
  });

  after(async () => {
    worker?.child.kill('SIGKILL');
    await hole?.close();
  });

  test('it aborts on its deadline and says so', async () => {
    worker = runWorker({
      WORKER_TARGET: `http://127.0.0.1:${hole.port}`,
      WORKER_SECRET: SECRET,
      WORKER_INTERVAL_MS: '500',
      // The floor is 30s, so this is set explicitly — the point is the
      // behaviour, and a 30-second test is a test people disable.
      WORKER_TIMEOUT_MS: '2000',
    });

    const aborted = await until(() => /did not answer within/.test(worker.output()), 15_000);
    assert.ok(
      aborted,
      `the worker never gave up on a request nobody answered:\n${worker.output()}`,
    );
  });

  test('and then it tries again, which is the whole point', async () => {
    /* Before the deadline existed, `running` stayed true and every later tick
       logged "previous tick still in flight". A SECOND request reaching the
       server is the proof that the guard released and the interval resumed —
       and it is a thing no unit test of `tick()` could observe, because the
       defect is in the call that never happens. */
    const before = hole.hits();
    const retried = await until(() => hole.hits() > before, 15_000);
    assert.ok(
      retried,
      `only ${hole.hits()} request(s) ever arrived — the worker gave up for good:\n${worker.output()}`,
    );
  });

  test('a hung platform never reads as a healthy quiet one', async () => {
    // The failure mode this replaces was silent-looking. Whatever else it does,
    // it must not look like a normal pass.
    const text = worker.output();
    assert.ok(
      !/\d+ jobs over \d+ tenants/.test(text),
      'a hung tick reported a completed pass',
    );
  });
});
