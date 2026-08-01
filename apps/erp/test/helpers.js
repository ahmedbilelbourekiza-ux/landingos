/* =============================================================================
 * test/helpers.js — integration-test harness.
 *
 * Boots the REAL server as a child process against a THROWAWAY database, so
 * tests exercise the actual route handlers, the actual SQLite layer, and the
 * actual background jobs — not mocks. Every run gets its own database file
 * (CRM_DB_PATH), so tests can never read or damage real data.
 * ========================================================================== */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fold a stopped server's write-ahead log back into its database file.
 *
 * index.js installs a SIGTERM handler that runs `wal_checkpoint(TRUNCATE)` on
 * the way out, but it cannot be relied on here: on Windows `child.kill()` maps
 * to TerminateProcess, so the handler never runs at all, and the -wal file is
 * left needing recovery.
 *
 * That matters because seven test files reopen the database after stopping the
 * server, and nine of those opens pass `{ readonly: true }`. A readonly
 * connection CANNOT recover a WAL — replaying the log needs write access — so
 * a database left mid-log fails to open, which better-sqlite3 reports as
 * SQLITE_ERROR. Most of the time the log is empty or SQLite's auto-checkpoint
 * has already folded it in and nothing is noticed; it takes enough unflushed
 * frames at the moment of the kill, which is why the only file ever seen to
 * fail was indexes.test.js — the one that seeds 800 orders.
 *
 * Doing it once here fixes the whole class, rather than asking nine call sites
 * to remember. Deliberately best-effort: a test that actually depends on this
 * database will fail on its own terms with a clearer message than anything
 * thrown from a cleanup helper.
 */
async function checkpointDatabase(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      // Read-write on purpose — this open is what performs the recovery.
      const db = new Database(dbPath);
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } finally {
        db.close();
      }
      return;
    } catch {
      // Windows can keep a file handle for a few milliseconds after the owning
      // process is gone.
      await sleep(20 * (attempt + 1));
    }
  }
}

/* Every test server bootstraps this manager, and startServer() signs in as it
 * before returning — so a test that is not ABOUT authentication does not have
 * to think about it, while tests that are can use { noCookies: true } to make
 * an anonymous call. */
const ADMIN = { name: 'boss', password: 'supersecret123' };

/**
 * Start a server instance on its own port and database.
 * @param {Object} env   extra environment variables for this instance
 * @param {Object} opts  { autoLogin }  set autoLogin:false to stay anonymous
 * @returns {Promise<{base:string, stop:Function, logs:Function, api:Function}>}
 */
async function startServer(env = {}, opts = {}) {
  const port = 3000 + Math.floor(Math.random() * 20000);
  const dbPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-')),
    'crm.db'
  );

  const child = spawn(process.execPath, [path.join(ROOT, 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      CRM_DB_PATH: dbPath,
      NODE_ENV: 'test',
      ADMIN_USERNAME: ADMIN.name,
      ADMIN_PASSWORD: ADMIN.password,
      // The suite signs in far more often than a human would. Real limits are
      // exercised deliberately in test/ratelimit.test.js, which sets its own.
      LOGIN_RATE_LIMIT: '100000',
      LOGIN_ACCOUNT_RATE_LIMIT: '100000',
      API_RATE_LIMIT: '100000',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (d) => { output += d.toString(); });
  child.stderr.on('data', (d) => { output += d.toString(); });

  const base = `http://127.0.0.1:${port}`;

  // Wait for the health endpoint rather than a fixed sleep.
  const deadline = Date.now() + 20000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (code ${child.exitCode}):\n${output}`);
    }
    try {
      const r = await fetch(base + '/', { signal: AbortSignal.timeout(1000) });
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`server did not start:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  /** fetch wrapper returning { status, body }. Carries a session cookie jar. */
  const jar = new Map();
  async function api(method, urlPath, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (jar.size && !opts.noCookies) {
      headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const r = await fetch(base + urlPath, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeout || 15000),
    });
    // Only a cookie-carrying call may WRITE to the jar. Without this, signing
    // in as a second account via as()/noCookies overwrote the shared session
    // and silently downgraded every later call in the file.
    if (!opts.noCookies) {
      for (const raw of (r.headers.getSetCookie?.() || [])) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    }
    const text = await r.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: r.status, body: parsed, headers: r.headers };
  }

  /** Sign in and keep the session cookie in this instance's jar. */
  async function login(name = ADMIN.name, password = ADMIN.password) {
    const r = await api('POST', '/api/auth/login', { name, password });
    if (r.status !== 200) throw new Error(`login failed for ${name}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  /** A caller bound to a different account, with its own bearer token. */
  async function as(name, password) {
    const r = await api('POST', '/api/auth/login', { name, password }, { noCookies: true });
    if (r.status !== 200) throw new Error(`login failed for ${name}: ${r.status} ${JSON.stringify(r.body)}`);
    const token = r.body.token;
    return {
      user: r.body.user,
      token,
      api: (method, urlPath, body, o = {}) => api(method, urlPath, body, {
        ...o, noCookies: true, headers: { ...(o.headers || {}), Authorization: `Bearer ${token}` },
      }),
    };
  }

  if (opts.autoLogin !== false) await login();

  return {
    base,
    api,
    login,
    as,
    admin: ADMIN,
    jar,
    logs: () => output,
    dbPath,
    /**
     * Stop the server and leave its database in a state any later connection
     * can open — including a readonly one.
     *
     * Resolves only once the process has ACTUALLY exited. The previous version
     * resolved on a 3s timer whether or not the child was gone, so a test could
     * start reading a database another process was still writing to. Worse, 3s
     * is shorter than the server's own 8s shutdown cap (index.js), so the
     * escalation could SIGKILL it midway through the very checkpoint that keeps
     * the file clean.
     */
    stop: async () => {
      await new Promise((resolve, reject) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();

        let settled = false;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          clearTimeout(escalate);
          clearTimeout(backstop);
          fn(arg);
        };

        child.once('exit', () => finish(resolve));
        child.kill();

        // Give the graceful path room to finish before forcing it.
        const escalate = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
        }, 10000);

        // Surviving SIGKILL is a real problem. Say so, rather than resolving
        // and letting the next test fail somewhere that explains nothing.
        const backstop = setTimeout(
          () => finish(reject, new Error('test server did not exit after SIGKILL')),
          20000,
        );
      });

      await checkpointDatabase(dbPath);
    },
  };
}

/** Poll `fn` until it returns truthy or the timeout expires. */
async function waitFor(fn, { timeout = 10000, interval = 150, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

const uid = () => crypto.randomBytes(4).toString('hex');

module.exports = { startServer, waitFor, uid };
