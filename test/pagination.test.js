/* =============================================================================
 * test/pagination.test.js — audit PERF-02.
 *
 * GET /api/orders returned the entire table with every call attached: 291 ms on
 * 5,000 orders even after the indexes, re-run on every SSE event and again
 * every 30 seconds. Filtered pagination in SQL is 0.7 ms for a page of 50.
 *
 * The scope must be applied INSIDE the query — filtering a page afterwards
 * would silently return short pages — so these tests check paging and
 * record-level access together, not separately.
 * ========================================================================== */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { startServer, uid } = require('./helpers');

let srv, agent;
const agentName = 'Pager ' + uid();
const otherName = 'Other ' + uid();
const TOTAL = 120;

before(async () => {
  srv = await startServer();
  await srv.api('POST', '/api/agents', { name: agentName, pass: 'pagerpass12', role: 'both' });
  await srv.api('POST', '/api/agents', { name: otherName, pass: 'otherpass12', role: 'both' });
  agent = await srv.as(agentName, 'pagerpass12');

  // Seeded directly: 120 orders through the API would be slow and this is
  // about the read path, not the write path.
  const db = new Database(srv.dbPath);
  const insert = db.transaction(() => {
    for (let i = 1; i <= TOTAL; i++) {
      db.prepare(`INSERT INTO orders (id, client, phone, wilaya, product, price, agent, status, createdAt, lineItems)
        VALUES (?,?,?,?,?,?,?,?,?,'[]')`).run(
        'PG-' + String(i).padStart(4, '0'),
        i % 10 === 0 ? 'Findable Customer' : 'Client ' + i,
        '0555' + String(100000 + i),
        i % 2 ? 'Alger' : 'Oran',
        'Product ' + (i % 5),
        1000 + i,
        i % 3 === 0 ? agentName : (i % 3 === 1 ? otherName : ''),
        i % 4 === 0 ? 'confirmed' : 'pending',
        Date.now() - i * 60000);
    }
  });
  insert();
  db.close();
});
after(async () => { if (srv) await srv.stop(); });

describe('paging', () => {
  test('a page is limited and reports the full total', async () => {
    const { status, body } = await srv.api('GET', '/api/orders?limit=25');
    assert.equal(status, 200);
    assert.equal(body.items.length, 25);
    assert.ok(body.total >= TOTAL, 'total counts the whole filtered set, not the page');
    assert.equal(body.limit, 25);
    assert.equal(body.offset, 0);
    assert.equal(body.hasMore, true);
  });

  test('offset walks the list without gaps or repeats', async () => {
    const seen = new Set();
    let offset = 0;
    for (;;) {
      const { body } = await srv.api(`GET`, `/api/orders?limit=40&offset=${offset}`);
      for (const o of body.items) {
        assert.ok(!seen.has(o.id), `${o.id} appeared twice across pages`);
        seen.add(o.id);
      }
      if (!body.hasMore) break;
      offset += 40;
      if (offset > 1000) throw new Error('paging did not terminate');
    }
    const { body: all } = await srv.api('GET', '/api/orders?limit=200');
    assert.ok(seen.size >= all.total, 'every row was reachable by paging');
  });

  test('the limit is capped so a caller cannot ask for everything', async () => {
    const { body } = await srv.api('GET', '/api/orders?limit=99999');
    assert.ok(body.items.length <= 200, 'capped at 200');
    assert.equal(body.limit, 200);
  });

  test('call history is not attached to a list page', async () => {
    // Joining it per row is what made the old path quadratic; the list only
    // renders the count.
    const { body } = await srv.api('GET', '/api/orders?limit=5');
    for (const o of body.items) {
      assert.deepEqual(o.calls, [], 'no per-row call history');
      assert.equal(typeof o.callCount, 'number', 'the count is there instead');
    }
  });

  test('a single order still comes back with its full call history', async () => {
    const { body: o } = await srv.api('POST', '/api/orders', { client: 'WithCalls', phone: '0555242424' });
    await srv.api('POST', `/api/orders/${o.id}/call`, { result: 'no_answer' });
    const { body: audit } = await srv.api('GET', `/api/orders/${o.id}/audit`);
    assert.equal(audit.calls.length, 1, 'the detail view is unaffected');
  });
});

describe('filtering', () => {
  const count = async (qs) => (await srv.api('GET', '/api/orders?' + qs)).body;

  test('by status', async () => {
    const c = await count('status=confirmed&limit=200');
    assert.ok(c.items.length > 0);
    assert.ok(c.items.every((o) => o.status === 'confirmed'));
  });

  test('by agent', async () => {
    const c = await count('agent=' + encodeURIComponent(agentName) + '&limit=200');
    assert.ok(c.items.every((o) => o.agent === agentName));
  });

  test('by wilaya', async () => {
    const c = await count('wilaya=Oran&limit=200');
    assert.ok(c.items.every((o) => o.wilaya === 'Oran'));
  });

  test('by date range', async () => {
    const since = Date.now() - 10 * 60000;
    const c = await count('since=' + since + '&limit=200');
    assert.ok(c.items.every((o) => o.createdAt >= since));
  });

  test('search matches client, phone, id and product', async () => {
    assert.ok((await count('search=Findable&limit=200')).total >= 12, 'by client name');
    assert.ok((await count('search=0555100005&limit=200')).total >= 1, 'by phone');
    assert.ok((await count('search=PG-0005&limit=200')).total >= 1, 'by order id');
    assert.ok((await count('search=Product 3&limit=200')).total > 0, 'by product');
  });

  test('search is case-insensitive', async () => {
    const a = await count('search=findable&limit=200');
    const b = await count('search=FINDABLE&limit=200');
    assert.equal(a.total, b.total);
    assert.ok(a.total > 0);
  });

  test('filters compose, and total reflects the filtered set', async () => {
    const c = await count('status=pending&wilaya=Alger&limit=10');
    assert.ok(c.items.every((o) => o.status === 'pending' && o.wilaya === 'Alger'));
    assert.ok(c.total >= c.items.length);
    const unfiltered = await count('limit=10');
    assert.ok(c.total < unfiltered.total, 'filtering narrows the total, not just the page');
  });

  test('sorting is whitelisted and an unknown column falls back safely', async () => {
    const { body: asc } = await srv.api('GET', '/api/orders?limit=5&sort=price&dir=asc');
    for (let i = 1; i < asc.items.length; i++) {
      assert.ok(asc.items[i].price >= asc.items[i - 1].price);
    }
    const { status } = await srv.api('GET', '/api/orders?limit=5&sort=price;DROP TABLE orders--');
    assert.equal(status, 200, 'an injection attempt is ignored, not executed');
    const { body: alive } = await srv.api('GET', '/api/orders?limit=1');
    assert.ok(alive.total > 0, 'the table is still there');
  });

  test('a search value cannot inject SQL', async () => {
    const { status } = await srv.api('GET', "/api/orders?search=' OR 1=1--&limit=200");
    assert.equal(status, 200);
    const { body } = await srv.api('GET', "/api/orders?search=' OR 1=1--&limit=200");
    assert.equal(body.total, 0, 'it is treated as a literal string, matching nothing');
  });
});

describe('scoping applies inside the query, not after it', () => {
  test('an agent paging through sees only their own and unassigned orders', async () => {
    let offset = 0;
    let checked = 0;
    for (;;) {
      const { body } = await agent.api('GET', `/api/orders?limit=25&offset=${offset}`);
      for (const o of body.items) {
        assert.ok(o.agent === agentName || o.followupAgent === agentName || !o.agent,
          `${o.id} belongs to ${o.agent} and must not be visible`);
        checked++;
      }
      // A full page means the scope was applied in SQL; filtering afterwards
      // would leave short pages.
      if (body.hasMore) assert.equal(body.items.length, 25, 'pages are full, so the scope is in the query');
      if (!body.hasMore) break;
      offset += 25;
      if (offset > 1000) throw new Error('paging did not terminate');
    }
    assert.ok(checked > 0);
  });

  test('the agent total excludes other people’s orders', async () => {
    const { body: mine } = await agent.api('GET', '/api/orders?limit=1');
    const { body: all } = await srv.api('GET', '/api/orders?limit=1');
    assert.ok(mine.total < all.total, 'the total is scoped too, not just the rows');
  });

  test('an agent cannot widen the scope with an agent filter', async () => {
    const { body } = await agent.api('GET', '/api/orders?agent=' + encodeURIComponent(otherName) + '&limit=200');
    assert.equal(body.items.length, 0, 'the scope wins over a caller-supplied filter');
  });
});

describe('order stats endpoint', () => {
  test('counts by status without returning any rows', async () => {
    const { status, body } = await srv.api('GET', '/api/orders/stats');
    assert.equal(status, 200);
    assert.ok(body.total > 0);
    assert.ok(body.pending > 0);
    assert.equal(body.items, undefined, 'no rows, just counts');
  });

  test('it honours filters', async () => {
    const { body } = await srv.api('GET', '/api/orders/stats?wilaya=Oran');
    const { body: all } = await srv.api('GET', '/api/orders/stats');
    assert.ok(body.total < all.total);
  });

  test('it is scoped for an agent', async () => {
    const { body: mine } = await agent.api('GET', '/api/orders/stats');
    const { body: all } = await srv.api('GET', '/api/orders/stats');
    assert.ok(mine.total < all.total);
  });

  test('it is not mistaken for an order id', async () => {
    // /orders/stats matches the per-order route pattern; without an explicit
    // exemption the ownership gate would look up an order called "stats".
    const { status } = await agent.api('GET', '/api/orders/stats');
    assert.equal(status, 200);
  });
});

describe('the legacy unpaginated shape still works', () => {
  test('no parameters returns a bare array, as the old client expects', async () => {
    const { status, body } = await srv.api('GET', '/api/orders');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'a cached old client must not break on deploy');
    assert.ok(body.length > 0);
    assert.ok(Array.isArray(body[0].calls), 'and it still carries call history');
  });

  test('the legacy path is still scoped', async () => {
    const { body } = await agent.api('GET', '/api/orders');
    assert.ok(body.every((o) => o.agent === agentName || o.followupAgent === agentName || !o.agent));
  });
});
