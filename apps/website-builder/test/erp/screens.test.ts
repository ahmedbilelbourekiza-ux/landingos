import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_COOKIE } from '@landingos/auth';

import {
  skip, BASE, phone, makeTenant, makeMember, makeErpTenant, cleanup,
  contractTest as test,
  type Caller,
} from './helpers.ts';

/* =============================================================================
 * test/erp/screens.test.ts — Phase 6.1.
 *
 * The ERP's first real screens, rendered.
 *
 * These assert on HTML rather than JSON because a screen can be wrong in ways
 * an API cannot: the data is correct and the page shows somebody else's, or the
 * permission check exists in the route and not in the render. Phase 4.4 found a
 * nav bug this way that no API test could have — every item whose href prefixed
 * the current path was marked `aria-current`, so "Overview" was highlighted on
 * every screen.
 *
 * The load-bearing one is the last group: a screen is a READ, and reading a
 * colleague's order is the privacy half of the defect hardening.test.js §3 was
 * written for. The API refuses it; the page must too, with the same answer.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;
let builderOnly: Caller;

/** Orders created in the fixture, by who owns them. */
let mine = '';
let theirs = '';

const page = (path: string, token?: string) =>
  fetch(BASE + path, {
    redirect: 'manual',
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });

const html = async (path: string, token?: string) => {
  const res = await page(path, token);
  return { status: res.status, body: await res.text() };
};

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('screens');

  const builderTenant = await makeTenant('screens-builder', ['product.website-builder']);
  builderOnly = await makeMember(builderTenant, { role: 'OWNER' });

  const make = async (body: Record<string, unknown>) =>
    (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Screen Customer', phone: phone(), price: 4900, product: 'Screen Widget',
      wilaya: 'Alger', commune: 'Bab Ezzouar', ...body,
    })).body.data.id as string;

  mine = await make({ agentUserId: acme.agent.userId });
  theirs = await make({ client: 'Private Customer', agentUserId: acme.other.userId });

  // A call, so the history and the attempts grid have something to render.
  await acme.agent.api('POST', `/api/erp/orders/${mine}/call-start`, {});
  await acme.agent.api('POST', `/api/erp/orders/${mine}/call`, { result: 'no_answer' });
});

after(async () => {
  if (skip) return;
  await cleanup();
});

describe('the ERP has real screens now', () => {
  test('the overview renders inside the shell, not the placeholder', async () => {
    const r = await html('/console/erp', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-overview-tiles"/);
    assert.match(r.body, /data-testid="product-switcher"/, 'it is inside the console shell');
    assert.doesNotMatch(
      r.body,
      /Its screens are ported in/,
      'the honest placeholder has been replaced by the thing it promised',
    );
  });

  test('taking /console/erp did not take the fallback from anything else', async () => {
    // A static segment wins over the dynamic sibling, so this file claims
    // /console/erp and the [product] route keeps serving every other path it
    // resolves. The builder has its own index too, so what is checked here is
    // that neither product's screens broke the other's — the registry-level
    // proof that the fallback still resolves lives in console-shell.test.ts,
    // which is where it can be asserted without a product to spare.
    const r = await html('/console/builder', builderOnly.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-nav="pages"/, "the builder's own menu, from its manifest");
    assert.ok(!/data-nav="shipments"/.test(r.body), "and not the ERP's");
  });

  test('the orders list renders this tenant’s orders', async () => {
    const r = await html('/console/erp/orders', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-orders-table"/);
    assert.match(r.body, /Screen Customer/);
  });

  test('an order detail renders its history and the nine attempt slots', async () => {
    const r = await html(`/console/erp/orders/${mine}`, acme.agent.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="order-calls"/);
    assert.match(r.body, /data-testid="order-attempts"/);

    const slots = (r.body.match(/data-slot="\d"/g) ?? []).length;
    assert.equal(slots, 9, 'the grid shows the remaining attempts, not just the used ones');
    assert.match(r.body, /data-used="true"/, 'the logged call fills a slot');
  });

  test('status renders through the shared token system', async () => {
    // The tone comes from @landingos/ui, so a pending ERP order looks like the
    // equivalent state anywhere else on the platform (decision D3).
    const r = await html('/console/erp/orders', acme.manager.token);
    assert.match(r.body, /data-status="pending"/);
    assert.match(r.body, /var\(--/, 'colour comes from a token, never a literal');
  });

  test('exactly one navigation item is marked as current', async () => {
    // The Phase 4.4 bug: a prefix match lit up "Overview" on every screen, so
    // aria-current stopped meaning anything.
    const r = await html('/console/erp/orders', acme.manager.token);
    const current = (r.body.match(/aria-current="page"/g) ?? []).length;
    assert.equal(current, 1, `expected one current nav item, found ${current}`);
  });
});

describe('the screens enforce what the API enforces', () => {
  test('an agent cannot open a colleague’s order', async () => {
    // 404, not 403: confirming it exists and belongs to someone else is itself
    // information, and it is the answer the platform gives for another
    // tenant's row too.
    const r = await page(`/console/erp/orders/${theirs}`, acme.agent.token);
    assert.equal(r.status, 404);
  });

  test('a manager can', async () => {
    const r = await html(`/console/erp/orders/${theirs}`, acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /Private Customer/);
  });

  test('the manager note is not rendered for an agent', async () => {
    await acme.manager.api('PATCH', `/api/erp/orders/${mine}`, { managerNote: 'internal only' });

    const asAgent = await html(`/console/erp/orders/${mine}`, acme.agent.token);
    assert.equal(asAgent.status, 200);
    assert.ok(
      !asAgent.body.includes('internal only'),
      'a field the write path refuses must not leak through the read path',
    );

    const asManager = await html(`/console/erp/orders/${mine}`, acme.manager.token);
    assert.match(asManager.body, /internal only/);
  });

  test('the agent’s overview counts only their own queue', async () => {
    const r = await html('/console/erp', acme.agent.token);
    assert.match(r.body, /data-testid="erp-scope"/);
    // The customer registry is D-05.1 sensitive, so its tile is absent for an
    // agent — absent rather than zero, which would read as a fact.
    assert.ok(!r.body.includes('data-tile="customers"'));

    const manager = await html('/console/erp', acme.manager.token);
    assert.match(manager.body, /data-tile="customers"/);
  });

  test('a tenant without the ERP gets 404, not an empty shell', async () => {
    const r = await page('/console/erp', builderOnly.token);
    assert.equal(r.status, 404);
  });

  test('an anonymous visitor is sent to sign in', async () => {
    const r = await page('/console/erp/orders');
    assert.equal(r.status, 307);
    assert.match(r.headers.get('location') ?? '', /\/console\/login/);
  });

  test('another tenant’s order id is a 404 on the screen too', async () => {
    const beta = await makeErpTenant('screens-beta');
    const betaOrder = (await beta.manager.api('POST', '/api/erp/orders', {
      client: 'Beta Only', phone: phone(),
    })).body.data.id;

    const r = await page(`/console/erp/orders/${betaOrder}`, acme.manager.token);
    assert.equal(r.status, 404);
  });
});
