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

const ROOT = path.join(__dirname, '..');

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
    stop: () => new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill();
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 3000);
    }),
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
