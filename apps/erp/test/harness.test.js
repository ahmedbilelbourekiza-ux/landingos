/* =============================================================================
 * test/harness.test.js — tests for the test harness itself.
 *
 * The suite is the gate for every milestone of the platform work, so the thing
 * the gate is built on needs its own coverage. These assert the two guarantees
 * startServer().stop() makes, both of which were previously untrue and produced
 * a rare, load-sensitive failure in indexes.test.js that looked like a bug in
 * the code under test.
 * ========================================================================== */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const { startServer } = require('./helpers');

describe('stop() guarantees the server process is gone', () => {
  test('the port is free immediately after stop() resolves', async () => {
    const srv = await startServer();
    const base = srv.base;

    // Alive beforehand.
    const before = await fetch(base + '/', { signal: AbortSignal.timeout(5000) });
    assert.equal(before.ok, true, 'server should answer before stop()');

    await srv.stop();

    // stop() used to resolve on a timer, so this could still succeed — the
    // process was alive and serving after the harness said it had stopped.
    await assert.rejects(
      () => fetch(base + '/', { signal: AbortSignal.timeout(2000) }),
      'nothing should still be listening once stop() has resolved',
    );
  });

  test('stop() is idempotent', async () => {
    const srv = await startServer();
    await srv.stop();
    await srv.stop(); // must not hang or throw
  });
});

describe('stop() leaves the database openable by any later connection', () => {
  /* The regression this file exists for. A readonly SQLite connection cannot
   * recover a write-ahead log — that needs write access — so a database left
   * mid-WAL by a killed server fails to open readonly at all, reported as
   * SQLITE_ERROR. Nine opens across seven test files do exactly this. */

  test('a readonly connection opens cleanly after a write-heavy run', async () => {
    const srv = await startServer();

    // Generate real WAL traffic. indexes.test.js seeds 800 orders, which is
    // why it was the only file that ever surfaced this; 300 is plenty to leave
    // frames unflushed without making this test slow.
    for (let i = 0; i < 300; i++) {
      await srv.api('POST', '/api/orders', {
        client: 'WAL-' + i,
        phone: '05550' + String(i).padStart(5, '0'),
      });
    }

    const dbPath = srv.dbPath;
    await srv.stop();

    // The operation that used to fail.
    const ro = new Database(dbPath, { readonly: true });
    try {
      const n = ro.prepare('SELECT COUNT(*) c FROM orders').get().c;
      assert.equal(n, 300, 'every written row survived the shutdown');
    } finally {
      ro.close();
    }
  });

  test('no write-ahead log is left needing recovery', async () => {
    const srv = await startServer();
    for (let i = 0; i < 50; i++) {
      await srv.api('POST', '/api/orders', { client: 'C' + i, phone: '0555100' + i });
    }
    const dbPath = srv.dbPath;
    await srv.stop();

    // wal_checkpoint(TRUNCATE) leaves the -wal file at zero length if it
    // exists at all. A non-empty one means frames are still only in the log,
    // which is precisely the state a readonly open cannot deal with.
    const wal = dbPath + '-wal';
    if (fs.existsSync(wal)) {
      assert.equal(fs.statSync(wal).size, 0, 'the WAL should be truncated, not left with frames');
    }
  });

  test('the database is readable after two servers share one file', async () => {
    // The shape indexes.test.js uses: boot, stop, inspect, boot again on the
    // same path. Each stop() must hand over a clean file.
    const first = await startServer();
    await first.api('POST', '/api/orders', { client: 'Legacy', phone: '0555000111' });
    const dbPath = first.dbPath;
    await first.stop();

    const between = new Database(dbPath, { readonly: true });
    const seen = between.prepare('SELECT COUNT(*) c FROM orders').get().c;
    between.close();
    assert.equal(seen, 1);

    const second = await startServer({ CRM_DB_PATH: dbPath });
    try {
      const { body } = await second.api('GET', '/api/orders');
      assert.ok(body.find((o) => o.client === 'Legacy'), 'the row survived both boots');
    } finally {
      await second.stop();
    }

    const after = new Database(dbPath, { readonly: true });
    try {
      assert.equal(after.prepare('SELECT COUNT(*) c FROM orders').get().c, 1);
    } finally {
      after.close();
    }
  });
});
