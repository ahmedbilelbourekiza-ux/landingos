/* =============================================================================
 * test/hardening.test.js — regression tests for defects found by REVIEWING the
 * Phase 1 work, not by the audit.
 *
 * Every test here corresponds to something that was actually broken and was
 * demonstrated against a running server before it was fixed. They exist so the
 * same class of mistake cannot come back.
 * ========================================================================== */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { startServer, uid } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { if (srv) await srv.stop(); });

/* ---------------------------------------------------------------------------
 * 1. Static serving published the whole application directory, including the
 *    live database. This was introduced BY the Phase 1 work and was strictly
 *    worse than the unauthenticated API it replaced.
 * ------------------------------------------------------------------------- */
describe('static serving exposes only the client assets', () => {
  const mustNotBeServed = [
    '/crm.db', '/crm.db-wal', '/crm.db-shm',
    '/lib/db.js', '/lib/auth.js', '/lib/providers/zr.js',
    '/index.js', '/package.json', '/package-lock.json',
    '/CHANGELOG.md', '/.env', '/.gitignore',
    '/test/helpers.js', '/test/auth.test.js',
  ];

  for (const p of mustNotBeServed) {
    test(`${p} is not downloadable`, async () => {
      const r = await fetch(srv.base + p);
      assert.notEqual(r.status, 200, `${p} MUST NOT be served — it leaks data or source`);
    });
  }

  test('path traversal cannot escape the icons directory', async () => {
    for (const p of ['/icons/../crm.db', '/icons/%2e%2e/crm.db', '/icons/..%2fcrm.db']) {
      const r = await fetch(srv.base + p);
      assert.notEqual(r.status, 200, `${p} must not resolve outside icons/`);
    }
  });

  const mustBeServed = ['/index.html', '/agent.html', '/manifest.json', '/service-worker.js', '/app', '/agent'];
  for (const p of mustBeServed) {
    test(`${p} is still served`, async () => {
      assert.equal((await fetch(srv.base + p)).status, 200);
    });
  }
});

/* ---------------------------------------------------------------------------
 * 2. Express matches routes case-insensitively, but the authorization table
 *    matched with case-sensitive regexes — so changing the capitalisation of
 *    the URL bypassed every manager-only rule.
 * ------------------------------------------------------------------------- */
describe('authorization cannot be bypassed by changing letter case', () => {
  let agent;
  const name = 'CaseProbe ' + uid();

  before(async () => {
    await srv.api('POST', '/api/agents', { name, pass: 'caseprobe123', role: 'confirmation' });
    agent = await srv.as(name, 'caseprobe123');
  });

  const variants = [
    ['POST', '/api/AGENTS', { name: 'bypass-' + uid() }],
    ['POST', '/api/Agents', { name: 'bypass-' + uid() }],
    ['PUT', '/api/Settings', { minCallSeconds: 1 }],
    ['PUT', '/api/SETTINGS', { minCallSeconds: 1 }],
    ['POST', '/api/Providers', { name: 'x', code: 'c' + uid() }],
    ['GET', '/api/Financial-Records', undefined],
    ['POST', '/api/Orders/Bulk', { ids: ['ORD-0001'], action: 'delete' }],
  ];

  for (const [method, p, body] of variants) {
    test(`${method} ${p} does not reach the handler as an agent`, async () => {
      const { status } = await agent.api(method, p, body);
      assert.ok(status === 403 || status === 404,
        `${method} ${p} returned ${status} — an agent must not get through`);
    });
  }

  test('no bypass agent was actually created', async () => {
    const { body } = await srv.api('GET', '/api/agents');
    assert.ok(!body.some((a) => a.name.startsWith('bypass-')), 'a bypass created an account');
  });

  test('the correctly-cased route still works for a manager', async () => {
    const n = 'Legit ' + uid();
    assert.equal((await srv.api('POST', '/api/agents', { name: n, pass: 'legit12345' })).status, 200);
  });
});

/* ---------------------------------------------------------------------------
 * 3. Scoping the ORDER LIST was cosmetic: every per-order route took the id
 *    from the URL with no ownership check, so any agent could read, edit,
 *    reassign or log a call against any order. Logging a confirmed call on
 *    someone else's order is payroll fraud.
 * ------------------------------------------------------------------------- */
describe('per-order authorization', () => {
  let intruder, victimOrder, ownOrder, unassignedOrder;
  const intruderName = 'Intruder ' + uid();
  const victimName = 'Victim ' + uid();

  before(async () => {
    await srv.api('POST', '/api/agents', { name: intruderName, pass: 'intruder123', role: 'both' });
    await srv.api('POST', '/api/agents', { name: victimName, pass: 'victim12345', role: 'both' });
    intruder = await srv.as(intruderName, 'intruder123');

    victimOrder = (await srv.api('POST', '/api/orders', {
      client: 'Private Customer', phone: '0555' + Math.floor(100000 + Math.random() * 899999),
      price: 9999, agent: victimName,
    })).body;
    ownOrder = (await srv.api('POST', '/api/orders', {
      client: 'Mine', phone: '0555' + Math.floor(100000 + Math.random() * 899999), agent: intruderName,
    })).body;
    unassignedOrder = (await srv.api('POST', '/api/orders', {
      client: 'Nobody', phone: '0555' + Math.floor(100000 + Math.random() * 899999),
    })).body;
  });

  const denied = (p, method = 'GET', body) => async () => {
    const { status } = await intruder.api(method, `/api/orders/${victimOrder.id}${p}`, body);
    assert.equal(status, 403, `${method} /api/orders/:id${p} must be refused`);
  };

  test('cannot read another agent’s audit trail', denied('/audit'));
  test('cannot read another agent’s attempts matrix', denied('/attempts'));
  test('cannot read another agent’s shipment', denied('/shipment'));
  test('cannot edit another agent’s order', denied('', 'PUT', { managerNote: 'tampered' }));
  test('cannot log a call on another agent’s order', denied('/call', 'POST', { result: 'confirmed' }));
  test('cannot start a call on another agent’s order', denied('/call-start', 'POST', {}));
  test('cannot add a note to another agent’s order', denied('/note', 'POST', { noteType: 'other', note: 'x' }));
  test('cannot classify another agent’s order', denied('/classify', 'POST', { classification: 'fake' }));

  test('the victim’s order was genuinely left untouched', async () => {
    const { body } = await srv.api('GET', '/api/orders');
    const o = body.find((x) => x.id === victimOrder.id);
    assert.equal(o.agent, victimName, 'still assigned to the victim');
    assert.equal(o.status, 'pending', 'no call result was recorded');
    assert.notEqual(o.managerNote, 'tampered');
  });

  test('an agent CAN still work their own order', async () => {
    assert.equal((await intruder.api('GET', `/api/orders/${ownOrder.id}/audit`)).status, 200);
    assert.equal((await intruder.api('POST', `/api/orders/${ownOrder.id}/call-start`, {})).status, 200);
    assert.equal((await intruder.api('POST', `/api/orders/${ownOrder.id}/call`, { result: 'confirmed' })).status, 200);
  });

  test('an agent CAN pick up an unassigned order', async () => {
    assert.equal((await intruder.api('GET', `/api/orders/${unassignedOrder.id}/audit`)).status, 200);
  });

  test('an agent cannot reassign an order to themselves', async () => {
    const { status, body } = await intruder.api('PUT', `/api/orders/${unassignedOrder.id}`, { agent: intruderName });
    assert.equal(status, 403);
    assert.equal(body.code, 'FORBIDDEN_FIELD');
  });

  test('a manager is unaffected by any of it', async () => {
    assert.equal((await srv.api('GET', `/api/orders/${victimOrder.id}/audit`)).status, 200);
    assert.equal((await srv.api('PUT', `/api/orders/${victimOrder.id}`, { managerNote: 'ok' })).status, 200);
  });

  test('a non-existent order is a 404, not a 403 that confirms nothing', async () => {
    assert.equal((await intruder.api('GET', '/api/orders/ORD-9999/audit')).status, 404);
  });
});

/* ---------------------------------------------------------------------------
 * 4. The password migration defaulted hasPassword to true, so blank-password
 *    accounts — the exact thing the flag exists to surface — reported as fine.
 * ------------------------------------------------------------------------- */
describe('blank-password accounts survive migration flagged', () => {
  test('a legacy plaintext database migrates with hasPassword set correctly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-legacy-'));
    const dbPath = path.join(dir, 'crm.db');

    // Stage a pre-auth database: plaintext passwords, one of them empty.
    const seed = new Database(dbPath);
    seed.exec('CREATE TABLE agents (name TEXT PRIMARY KEY, pass TEXT)');
    seed.prepare('INSERT INTO agents(name,pass) VALUES(?,?)').run('WithPass', 'theirRealPassword');
    seed.prepare('INSERT INTO agents(name,pass) VALUES(?,?)').run('BlankPass', '');
    seed.close();

    const s = await startServer({ CRM_DB_PATH: dbPath });
    try {
      const { body } = await s.api('GET', '/api/agents');
      const withPass = body.find((a) => a.name === 'WithPass');
      const blank = body.find((a) => a.name === 'BlankPass');

      assert.equal(withPass.hasPassword, true);
      assert.equal(blank.hasPassword, false,
        'a blank-password account must be visibly flagged — this is what the manager acts on');

      // The legacy password must still work after being hashed…
      assert.equal((await s.api('POST', '/api/auth/login',
        { name: 'WithPass', password: 'theirRealPassword' }, { noCookies: true })).status, 200);
      // …and must now be stored as a hash, not plaintext.
      const check = new Database(dbPath, { readonly: true });
      const row = check.prepare('SELECT pass FROM agents WHERE name = ?').get('WithPass');
      check.close();
      assert.ok(row.pass.startsWith('scrypt$'));
      assert.ok(!row.pass.includes('theirRealPassword'));

      assert.ok(s.logs().includes('BLANK PASSWORD'), 'the operator is warned loudly at boot');
    } finally {
      await s.stop();
    }
  });
});

/* ---------------------------------------------------------------------------
 * 5. Login cost ~100-200ms of BLOCKED event loop per attempt (scryptSync), and
 *    accepted a password of any length up to the 25MB body limit.
 * ------------------------------------------------------------------------- */
describe('login cannot stall the server', () => {
  test('an enormous password is rejected without doing enormous work', async () => {
    const started = Date.now();
    const { status } = await srv.api('POST', '/api/auth/login',
      { name: srv.admin.name, password: 'x'.repeat(2 * 1024 * 1024) }, { noCookies: true });
    assert.equal(status, 401);
    assert.ok(Date.now() - started < 5000, 'a 2MB password must not take seconds');
  });

  test('the server keeps answering while passwords are being hashed', async () => {
    // Fire a burst of failing logins, and time an unrelated request alongside.
    const burst = Array.from({ length: 8 }, () =>
      srv.api('POST', '/api/auth/login', { name: srv.admin.name, password: 'wrong' }, { noCookies: true }));

    const started = Date.now();
    const health = await fetch(srv.base + '/');
    const elapsed = Date.now() - started;
    await Promise.all(burst);

    assert.equal(health.status, 200);
    assert.ok(elapsed < 2000,
      `health check took ${elapsed}ms during a login burst — the event loop is blocked`);
  });

  test('an unknown account takes comparable time to a wrong password', async () => {
    const time = async (name) => {
      const t0 = Date.now();
      await srv.api('POST', '/api/auth/login', { name, password: 'wrong-password' }, { noCookies: true });
      return Date.now() - t0;
    };
    await time(srv.admin.name);                       // warm the decoy hash
    const known = await time(srv.admin.name);
    const unknown = await time('definitely-no-such-account-' + uid());
    const ratio = Math.max(known, unknown) / Math.max(1, Math.min(known, unknown));
    assert.ok(ratio < 6, `timing differs too much (known ${known}ms vs unknown ${unknown}ms)`);
  });
});

/* ---------------------------------------------------------------------------
 * 6. CORS stops an attacker READING a cross-site response; it does not stop the
 *    request happening. With ALLOWED_ORIGINS set the cookie is SameSite=None,
 *    so the browser would attach it to a forged POST.
 * ------------------------------------------------------------------------- */
describe('cross-origin state changes are refused', () => {
  test('a POST from an unrecognised Origin is blocked', async () => {
    const before = (await srv.api('GET', '/api/orders')).body.length;
    const cookie = [...srv.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

    const r = await fetch(srv.base + '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: cookie },
      body: JSON.stringify({ client: 'Forged', phone: '0555000000' }),
    });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'CSRF_ORIGIN');
    assert.equal((await srv.api('GET', '/api/orders')).body.length, before, 'nothing was created');
  });

  test('a same-origin POST still works', async () => {
    const { status } = await srv.api('POST', '/api/orders',
      { client: 'Legit', phone: '0555121212' }, { headers: { Origin: srv.base } });
    assert.equal(status, 200);
  });

  test('a caller with no Origin header (curl, carrier webhook) still works', async () => {
    const { status } = await srv.api('POST', '/api/orders', { client: 'Curl', phone: '0555131313' });
    assert.equal(status, 200);
  });

  test('reads are never blocked by the origin check', async () => {
    const cookie = [...srv.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(srv.base + '/api/orders', {
      headers: { Origin: 'https://evil.example', Cookie: cookie },
    });
    // CORS still stops the attacker reading it; the request itself is harmless.
    assert.equal(r.status, 200);
  });
});

/* ---------------------------------------------------------------------------
 * 7. The same client-supplied-filter mistake, in two more places.
 * ------------------------------------------------------------------------- */
describe('follow-up and client data are scoped too', () => {
  let agent;
  const name = 'Scoped ' + uid();

  before(async () => {
    await srv.api('POST', '/api/agents', { name, pass: 'scoped12345', role: 'both' });
    agent = await srv.as(name, 'scoped12345');
  });

  test('the customer registry is manager-only', async () => {
    assert.equal((await agent.api('GET', '/api/clients')).status, 403);
    assert.equal((await agent.api('GET', '/api/clients/filter-options')).status, 403);
    assert.equal((await srv.api('GET', '/api/clients')).status, 200, 'a manager still reads it');
  });

  test('the Suivi dashboard is manager-only', async () => {
    assert.equal((await agent.api('GET', '/api/followup/dashboard')).status, 403);
    assert.equal((await srv.api('GET', '/api/followup/dashboard')).status, 200);
  });

  test('an agent cannot list another agent’s follow-up queue', async () => {
    const other = 'Other ' + uid();
    await srv.api('POST', '/api/agents', { name: other, pass: 'otherfu12345', role: 'followup' });

    // A task belonging to someone else.
    const { body: o } = await srv.api('POST', '/api/orders', { client: 'FU', phone: '0555404040', agent: other });
    await srv.api('POST', '/api/followup/assign', { orderId: o.id, agent: other });

    const { body } = await agent.api('GET', `/api/followup/tasks?agent=${encodeURIComponent(other)}`);
    assert.ok(body.items.every((t) => t.agent === name),
      'the query parameter is ignored — only your own tasks come back');
  });
});

/* ---------------------------------------------------------------------------
 * 8. Dead code removal and graceful shutdown (Phase 2).
 * ------------------------------------------------------------------------- */
describe('dead code is gone and shutdown is clean', () => {
  test('the duplicate server file no longer exists', () => {
    const fsx = require('node:fs');
    const p = require('node:path').join(__dirname, '..', 'lib', 'index.js');
    assert.ok(!fsx.existsSync(p),
      'lib/index.js was a 2,333-line stale copy of the whole server');
  });

  test('no raw webhook payloads or address debug lines are logged', () => {
    const fsx = require('node:fs');
    const src = fsx.readFileSync(require('node:path').join(__dirname, '..', 'index.js'), 'utf8');
    for (const marker of ['RAW WEBHOOK PAYLOAD', 'RAW CHECKOUT WEBHOOK', 'RAW CONTACT WEBHOOK',
                          'DEBUG address payload', 'DEBUG note_attributes']) {
      assert.ok(!src.includes(marker), `${marker} dumps customer PII to stdout`);
    }
  });

  test('the SIGTERM handler is wired to jobs.stop and a WAL checkpoint', () => {
    // Source-level assertion, because the behavioural test below cannot run
    // here — see its skip reason.
    const fsx = require('node:fs');
    const src = fsx.readFileSync(require('node:path').join(__dirname, '..', 'index.js'), 'utf8');
    const handler = src.slice(src.indexOf('const shutdown = (signal)'));
    assert.ok(handler.includes('jobs.stop()'), 'background timers are stopped');
    assert.ok(handler.includes('wal_checkpoint(TRUNCATE)'), 'the WAL is folded back into the database');
    assert.ok(handler.includes('server.close('), 'in-flight requests are allowed to finish');
    assert.ok(/for \(const signal of \['SIGTERM', 'SIGINT'\]\)/.test(src), 'both signals are handled');
  });

  /* Node on Windows does not deliver SIGTERM: child.kill() maps to
   * TerminateProcess, which kills unconditionally without running any handler.
   * The behaviour is real and matters on the Linux host this deploys to, but it
   * cannot be exercised from this machine, so the test states that rather than
   * pretending to pass. */
  test('SIGTERM shuts the server down cleanly and checkpoints the database',
    { skip: process.platform === 'win32' ? 'SIGTERM is not deliverable on Windows' : false },
    async () => {
      const s = await startServer();
      await s.api('POST', '/api/orders', { client: 'Before Shutdown', phone: '0555878787' });

      await s.stop();                       // sends SIGTERM
      await new Promise((r) => setTimeout(r, 400));

      assert.ok(s.logs().includes('shutdown complete'),
        `the shutdown handler did not run. log tail:
${s.logs().slice(-600)}`);

      // The data written before shutdown is intact in a cold copy of the file.
      const cold = new Database(s.dbPath, { readonly: true });
      const row = cold.prepare("SELECT client FROM orders WHERE phone = '0555878787'").get();
      cold.close();
      assert.equal(row.client, 'Before Shutdown', 'nothing was lost on shutdown');
    });
});
