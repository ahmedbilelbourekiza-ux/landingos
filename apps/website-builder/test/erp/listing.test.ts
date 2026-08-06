import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  skip, phone, makeErpTenant, cleanup,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/listing.test.ts
 *
 * Ported from apps/erp/test/pagination.test.js (audit PERF-02).
 *
 * GET /api/orders returned the entire table with every call attached: 291 ms on
 * 5,000 orders even after the indexes, re-run on every SSE event and again
 * every 30 seconds. Filtered pagination in SQL is 0.7 ms for a page of 50.
 *
 * The point the original file makes, and the reason it is one file rather than
 * two: the scope must be applied INSIDE the query. Filtering a page after the
 * fact silently returns short pages, so paging and record-level access have to
 * be tested together or the bug hides between them.
 *
 * One test did NOT come across. The ERP kept a legacy unpaginated shape — no
 * parameters returned a bare array — so a cached copy of the old vanilla SPA
 * would not break on deploy. There is no cached old client on a new API
 * surface, and carrying two response shapes forward would make the platform
 * envelope optional. See PORTING.md.
 * ========================================================================== */

const TOTAL = 120;

let acme: Awaited<ReturnType<typeof makeErpTenant>>;
let beta: Awaited<ReturnType<typeof makeErpTenant>>;

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('listing');
  beta = await makeErpTenant('listing-beta');

  // The ERP seeded 120 rows straight into SQLite because this is about the read
  // path, not the write path. Here they go through the API: there is no second
  // way in that RLS would not see, and a direct insert would have to name the
  // tenant itself — which is the one thing no test in this suite does.
  for (let i = 1; i <= TOTAL; i++) {
    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: i % 10 === 0 ? 'Findable Customer' : `Client ${i}`,
      phone: '0555' + String(100000 + i),
      wilaya: i % 2 ? 'Alger' : 'Oran',
      product: `Product ${i % 5}`,
      price: 1000 + i,
      agentUserId: i % 3 === 0 ? acme.agent.userId : (i % 3 === 1 ? acme.other.userId : undefined),
      status: i % 4 === 0 ? 'confirmed' : 'pending',
    });
    // Checked, because 120 unchecked writes is 120 chances to build the wrong
    // fixture. One transient P1001 during setup used to surface much later as
    // `total >= 120` failing, which reads as a paging bug and is not one — the
    // suite's own principle, applied to its scaffolding.
    assert.equal(
      created.status, 201,
      `fixture order ${i} of ${TOTAL} was not created: ${JSON.stringify(created.body)}`,
    );
  }

  // One order in the other tenant, to prove the totals below are not merely
  // "everything in the table".
  await beta.manager.api('POST', '/api/erp/orders', { client: 'Beta Only', phone: phone() });
});

after(async () => {
  if (skip) return;
  await cleanup();
});

const list = async (qs = '') =>
  (await acme.manager.api('GET', `/api/erp/orders${qs ? '?' + qs : ''}`)).body.data;

/* -----------------------------------------------------------------------------
 * Paging
 * -------------------------------------------------------------------------- */

describe('paging', () => {
  test('a page is limited and reports the full filtered total', async () => {
    const r = await acme.manager.api('GET', '/api/erp/orders?pageSize=25');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.items.length, 25);
    assert.ok(r.body.data.total >= TOTAL, 'total counts the whole filtered set, not the page');
    assert.equal(r.body.data.pageSize, 25);
    assert.equal(r.body.data.page, 1);
  });

  test('paging walks the list without gaps or repeats', async () => {
    const seen = new Set<string>();
    for (let page = 1; ; page++) {
      const data = await list(`pageSize=40&page=${page}`);
      for (const o of data.items) {
        assert.ok(!seen.has(o.id), `${o.id} appeared twice across pages`);
        seen.add(o.id);
      }
      if (data.items.length === 0 || seen.size >= data.total) break;
      if (page > 25) throw new Error('paging did not terminate');
    }
    assert.equal(seen.size, (await list('pageSize=1')).total, 'every row was reachable by paging');
  });

  test('the page size is capped so a caller cannot ask for everything', async () => {
    const data = await list('pageSize=99999');
    assert.ok(data.items.length <= 100, 'capped');
    assert.ok(data.pageSize <= 100, `pageSize was ${data.pageSize}`);
  });

  test('a nonsense page or size does not crash the route', async () => {
    for (const qs of ['pageSize=-1', 'page=0', 'page=-5', 'pageSize=abc', 'page=abc']) {
      const r = await acme.manager.api('GET', `/api/erp/orders?${qs}`);
      assert.equal(r.status, 200, qs);
      assert.ok(r.body.data.items.length >= 0);
    }
  });

  test('call history is not attached to a list page', async () => {
    // Joining it per row is what made the old path quadratic. The list renders
    // a count, so a count is what it gets.
    const data = await list('pageSize=5');
    for (const o of data.items) {
      assert.ok(!Array.isArray(o.calls) || o.calls.length === 0, 'no per-row call history');
      assert.equal(typeof o.callCount, 'number', 'the count is there instead');
    }
  });

  test('a single order still comes back with its full call history', async () => {
    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'WithCalls', phone: phone(),
    });
    const id = created.body.data.id;
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'no_answer' });

    const audit = (await acme.manager.api('GET', `/api/erp/orders/${id}/audit`)).body.data;
    assert.equal(audit.calls.length, 1, 'the detail view is unaffected');
  });
});

/* -----------------------------------------------------------------------------
 * Filtering
 * -------------------------------------------------------------------------- */

describe('filtering', () => {
  test('by status', async () => {
    const data = await list('status=confirmed&pageSize=100');
    assert.ok(data.items.length > 0);
    assert.ok(data.items.every((o: { status: string }) => o.status === 'confirmed'));
  });

  test('by agent', async () => {
    const data = await list(`agentUserId=${acme.agent.userId}&pageSize=100`);
    assert.ok(data.items.length > 0);
    assert.ok(data.items.every((o: { agentUserId: string }) => o.agentUserId === acme.agent.userId));
  });

  test('by wilaya', async () => {
    const data = await list('wilaya=Oran&pageSize=100');
    assert.ok(data.items.every((o: { wilaya: string }) => o.wilaya === 'Oran'));
  });

  test('by date range', async () => {
    const since = Date.now() - 10 * 60000;
    const data = await list(`since=${since}&pageSize=100`);
    assert.ok(data.items.every((o: { createdAt: string }) => new Date(o.createdAt).getTime() >= since));
  });

  test('a date bound is accepted as epoch ms OR as a calendar date (LP.3)', async () => {
    // The API's callers have always sent epoch milliseconds. The filter bar's
    // `<input type="date">` sends `YYYY-MM-DD`, and `Number("2026-08-06")` is
    // NaN — so before LP.3 the bar's own values would have produced an Invalid
    // Date and a query nobody could explain. Both shapes, one parser.
    const now = new Date();
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const byDate = await list(`since=${iso(now)}&pageSize=100`);
    const byEpoch = await list(
      `since=${new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()}&pageSize=100`,
    );
    assert.equal(byDate.total, byEpoch.total, 'the two spellings must mean the same window');
    assert.ok(byDate.total > 0, 'and today is not empty');
  });

  test('`until` as a calendar date includes that whole day', async () => {
    // `lte 2026-08-06T00:00` silently drops a day's orders, which is a figure a
    // manager would then report. The legacy appended T23:59:59.999 for the same
    // reason.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const data = await list(`until=${today}&pageSize=100`);
    assert.ok(data.total > 0, 'orders created today must fall inside "until today"');
  });

  test('a named range resolves in the SAME function the screen reads (LP.3)', async () => {
    // The whole reason `range` is resolved inside `orderFilters` rather than on
    // the page: a screen doing its own arithmetic would eventually disagree
    // with an export about what "today" contained.
    const today = await list('range=today&pageSize=100');
    assert.ok(today.total > 0);

    const yesterday = await list('range=yesterday&pageSize=100');
    assert.equal(yesterday.total, 0, 'nothing in this fixture was created yesterday');

    const week = await list('range=week&pageSize=100');
    assert.ok(week.total >= today.total, 'a wider window cannot hold fewer');
  });

  test('an unknown range is ignored, not refused', async () => {
    // Same rule as an unknown sort column: a stale bookmark renders the list.
    const all = await list('pageSize=100');
    const bogus = await list('range=fortnight&pageSize=100');
    assert.equal(bogus.total, all.total);
  });

  test('an explicit bound beats a named range', async () => {
    // A caller who states both means the bound. Asserted because the opposite
    // precedence looks equally reasonable in review and is wrong.
    const data = await list(`range=yesterday&since=${Date.now() - 10 * 60000}&pageSize=100`);
    assert.ok(data.total > 0, 'the explicit `since` must win over `range=yesterday`');
  });

  test('search matches client, phone, id and product', async () => {
    assert.ok((await list('search=Findable&pageSize=100')).total >= 12, 'by client name');
    assert.ok((await list('search=0555100005&pageSize=100')).total >= 1, 'by phone');
    assert.ok((await list('search=Product 3&pageSize=100')).total > 0, 'by product');
  });

  test('search is case-insensitive, as it was on SQLite', async () => {
    // Postgres LIKE is case-sensitive where SQLite's was not. Without an
    // explicit mode this silently stops matching after the port — the search
    // box keeps working for anyone who types the same capitalisation as the
    // stored value, which is most of the time, which is why it survives review.
    const lower = await list('search=findable&pageSize=100');
    const upper = await list('search=FINDABLE&pageSize=100');
    assert.ok(lower.total > 0);
    assert.equal(lower.total, upper.total);
  });

  test('filters compose, and the total reflects the filtered set', async () => {
    const filtered = await list('status=pending&wilaya=Alger&pageSize=10');
    assert.ok(filtered.items.every(
      (o: { status: string; wilaya: string }) => o.status === 'pending' && o.wilaya === 'Alger',
    ));
    const all = await list('pageSize=10');
    assert.ok(filtered.total < all.total, 'filtering narrows the total, not just the page');
  });

  test('sorting is whitelisted and an injection attempt is ignored, not executed', async () => {
    const asc = await list('pageSize=5&sort=price&dir=asc');
    for (let i = 1; i < asc.items.length; i++) {
      assert.ok(Number(asc.items[i].price) >= Number(asc.items[i - 1].price));
    }

    const r = await acme.manager.api(
      'GET', '/api/erp/orders?pageSize=5&sort=' + encodeURIComponent('price;DROP TABLE "FulfillmentOrder"--'),
    );
    assert.equal(r.status, 200, 'an unknown column falls back rather than erroring');
    assert.ok((await list('pageSize=1')).total > 0, 'the table is still there');
  });

  test('a search value cannot inject SQL', async () => {
    const data = await list('search=' + encodeURIComponent("' OR 1=1--") + '&pageSize=100');
    assert.equal(data.total, 0, 'it is treated as a literal string, matching nothing');
  });

  test('a hostile raw filter cannot widen the tenant scope', async () => {
    // The specific attack packages/db already proves at the database layer,
    // asserted again here at the route layer because the two are different
    // code paths and only one of them has been reviewed for it.
    for (const value of ["' OR 1=1--", "1=1 OR tenantId='" + beta.tenantId, '%']) {
      const data = await list('search=' + encodeURIComponent(value) + '&pageSize=200');
      assert.ok(!data.items.some((o: { client: string }) => o.client === 'Beta Only'),
        `search=${value} reached another tenant`);
    }
  });
});

/* -----------------------------------------------------------------------------
 * The property this file exists for
 * -------------------------------------------------------------------------- */

describe('the scope is applied inside the query, not after it', () => {
  test('an agent paging through sees only their own and unassigned orders', async () => {
    let checked = 0;
    for (let page = 1; ; page++) {
      const r = await acme.agent.api('GET', `/api/erp/orders?pageSize=25&page=${page}`);
      const data = r.body.data;
      for (const o of data.items) {
        assert.ok(
          o.agentUserId === acme.agent.userId
            || o.followupUserId === acme.agent.userId
            || !o.agentUserId,
          `${o.id} belongs to ${o.agentUserId} and must not be visible`,
        );
        checked++;
      }
      // A full page while more remain means the scope was applied in SQL.
      // Filtering afterwards leaves short pages, which is the whole tell.
      if (checked < data.total) {
        assert.equal(data.items.length, 25, 'pages are full, so the scope is in the query');
      }
      if (data.items.length === 0 || checked >= data.total) break;
      if (page > 25) throw new Error('paging did not terminate');
    }
    assert.ok(checked > 0);
  });

  test('the agent total excludes other people’s orders', async () => {
    const mine = (await acme.agent.api('GET', '/api/erp/orders?pageSize=1')).body.data;
    const all = await list('pageSize=1');
    assert.ok(mine.total < all.total, 'the total is scoped too, not just the rows');
  });

  test('an agent cannot widen the scope with an agent filter', async () => {
    const r = await acme.agent.api(
      'GET', `/api/erp/orders?agentUserId=${acme.other.userId}&pageSize=100`,
    );
    assert.equal(r.body.data.items.length, 0, 'the scope wins over a caller-supplied filter');
    assert.equal(r.body.data.total, 0, 'and so does the total');
  });

  test('the tenant scope is likewise in the query', async () => {
    const mine = await list('pageSize=1');
    const theirs = (await beta.manager.api('GET', '/api/erp/orders?pageSize=1')).body.data;
    assert.ok(mine.total >= TOTAL);
    assert.equal(theirs.total, 1, "the other tenant sees exactly its own one order");
  });
});

/* -----------------------------------------------------------------------------
 * Stats
 * -------------------------------------------------------------------------- */

describe('the stats endpoint counts without returning rows', () => {
  test('it reports counts by status and no rows at all', async () => {
    const r = await acme.manager.api('GET', '/api/erp/orders/stats');
    assert.equal(r.status, 200);
    assert.ok(r.body.data.total > 0);
    assert.ok(r.body.data.pending > 0);
    assert.equal(r.body.data.items, undefined, 'no rows, just counts');
  });

  test('it honours filters', async () => {
    const filtered = (await acme.manager.api('GET', '/api/erp/orders/stats?wilaya=Oran')).body.data;
    const all = (await acme.manager.api('GET', '/api/erp/orders/stats')).body.data;
    assert.ok(filtered.total < all.total);
  });

  test('it is scoped for an agent', async () => {
    const mine = (await acme.agent.api('GET', '/api/erp/orders/stats')).body.data;
    const all = (await acme.manager.api('GET', '/api/erp/orders/stats')).body.data;
    assert.ok(mine.total < all.total);
  });

  test('it is scoped by tenant', async () => {
    const theirs = (await beta.manager.api('GET', '/api/erp/orders/stats')).body.data;
    assert.equal(theirs.total, 1);
  });

  test('"stats" is not mistaken for an order id', async () => {
    // /orders/stats matches the per-order route pattern. Without an explicit
    // exemption the ownership gate looks up an order called "stats", fails to
    // find one, and 404s a working endpoint.
    assert.equal((await acme.agent.api('GET', '/api/erp/orders/stats')).status, 200);
  });
});
