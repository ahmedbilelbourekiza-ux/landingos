import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_COOKIE } from '@landingos/auth';

import {
  skip, BASE, uid, phone, makeTenant, makeMember, makeErpTenant, cleanup,
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

const page = (path: string, token?: string, locale?: string) => {
  // The console has no locale segment in its URLs (R-08) — the choice is a
  // cookie, which is what the locale switcher writes. Passing one here makes a
  // label assertion deterministic instead of depending on Arabic being the
  // default.
  const cookie = [
    token ? `${SESSION_COOKIE}=${token}` : '',
    locale ? `locale=${locale}` : '',
  ].filter(Boolean).join('; ');
  return fetch(BASE + path, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  });
};

const html = async (path: string, token?: string, locale?: string) => {
  const res = await page(path, token, locale);
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

/* -----------------------------------------------------------------------------
 * Phase 6.2 — the rest of the ERP's screens
 * -------------------------------------------------------------------------- */

describe("every screen in the ERP's navigation renders", () => {
  const SCREENS = [
    ['clients', '/console/erp/clients', 'erp-clients-table'],
    ['products', '/console/erp/products', 'erp-products-table'],
    ['inventory', '/console/erp/inventory', 'erp-low-stock-table'],
    ['shipments', '/console/erp/shipments', 'erp-shipments-table'],
    ['carriers', '/console/erp/carriers', 'erp-carriers-table'],
    ['follow-up', '/console/erp/follow-up', 'erp-followup-table'],
    ['finance', '/console/erp/finance', 'erp-finance-table'],
    ['agents', '/console/erp/agents', 'erp-agents-table'],
  ] as const;

  for (const [id, path, testId] of SCREENS) {
    test(`${id} renders inside the shell`, async () => {
      const r = await html(path, acme.manager.token);
      assert.equal(r.status, 200, path);
      assert.match(r.body, new RegExp(`data-testid="${testId}"`));
      assert.match(r.body, /data-testid="product-switcher"/, 'inside the console shell');
    });
  }

  test('each screen marks exactly its own nav item as current', async () => {
    // The Phase 4.4 bug, checked across the whole product rather than on one
    // page: a prefix match lights up the index everywhere and aria-current
    // stops meaning anything.
    for (const [, path] of SCREENS) {
      const r = await html(path, acme.manager.token);
      const current = (r.body.match(/aria-current="page"/g) ?? []).length;
      assert.equal(current, 1, `${path} had ${current} current nav items`);
    }
  });
});

describe('the sensitive screens are gated, not merely unlinked', () => {
  // A nav item is a hint; the URL is typeable. Each of these checks the page
  // itself refuses, rather than trusting the menu to have hidden the link.
  const SENSITIVE = [
    ['clients', '/console/erp/clients'],
    ['finance', '/console/erp/finance'],
    ['agents', '/console/erp/agents'],
  ] as const;

  for (const [id, path] of SENSITIVE) {
    test(`an agent typing the ${id} URL gets 404`, async () => {
      const r = await page(path, acme.agent.token);
      assert.equal(r.status, 404, path);
    });
  }

  test('and a manager reaches all three', async () => {
    for (const [, path] of SENSITIVE) {
      assert.equal((await page(path, acme.manager.token)).status, 200, path);
    }
  });

  test('the ERP nav hides what the caller cannot open', async () => {
    const r = await html('/console/erp', acme.agent.token);
    assert.ok(!/data-nav="clients"/.test(r.body), 'no link to a screen that would 404');
    assert.ok(!/data-nav="finance"/.test(r.body));
    assert.ok(!/data-nav="agents"/.test(r.body));
    assert.match(r.body, /data-nav="orders"/, 'but their own work is there');
  });
});

describe('no screen renders a credential', () => {
  test('the carriers screen shows THAT a key exists, never the key', async () => {
    const secret = `sk-carrier-${Date.now()}`;
    await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Screen Carrier', code: `sc${uid()}`, adapter: 'mock',
      apiKey: secret, secretKey: `${secret}-2`,
    });

    const r = await html('/console/erp/carriers', acme.manager.token);
    assert.equal(r.status, 200);
    assert.ok(!r.body.includes(secret), 'the API key must not reach the page');
    assert.ok(!r.body.includes(`${secret}-2`), 'nor the secret key');
    // What a person actually needs to know: a configured carrier and an
    // unconfigured one look identical otherwise.
    assert.match(r.body, /data-configured="true"/);
  });

  test('the agents screen carries no password material (SEC-02)', async () => {
    const r = await html('/console/erp/agents', acme.manager.token);
    assert.equal(r.status, 200);
    assert.ok(!r.body.includes('passwordHash'), 'not even the field name');
    assert.ok(!/\$argon2|scrypt\$|\$2[aby]\$/.test(r.body), 'and no hash of any generation');
  });
});

describe('money and figures render correctly', () => {
  test('a Decimal reaches the page as a formatted string, not a float', async () => {
    // 37 numeric columns and zero double precision (M-06). The last place that
    // guarantee can be lost is the one place a person reads it.
    const r = await html('/console/erp/orders', acme.manager.token);
    assert.equal(r.status, 200);
    assert.ok(!/4900\.0000000001/.test(r.body), 'no binary-float artefact');
    assert.match(r.body, /tabular-nums/, 'figures line up down the column');
  });

  test('the finance screen states that records are never edited', async () => {
    // The append-only rule, said on the screen rather than only in the schema —
    // a manager looking for an edit button should learn why there is not one.
    const r = await html('/console/erp/finance', acme.manager.token);
    assert.match(r.body, /data-testid="erp-finance-table"/);
    assert.ok(!/>\s*Delete\s*</.test(r.body), 'no delete control for a saved record');
  });
});

/* -----------------------------------------------------------------------------
 * Phase 6.3a — the write surfaces
 *
 * Until now every ERP screen was read-only: each mutation had a route and a
 * passing contract test, and no control. These assert the CONTROL SURFACE, which
 * is the half an API test cannot reach —
 *
 *   - a control exists wherever the API would accept it, and
 *   - no control exists where the API would refuse.
 *
 * The behaviour behind each button is already covered by orders.test.ts; a
 * button is a `fetch` to a route those tests attack from every direction. What
 * is new here is the offer, and an offer the server will refuse is worse than no
 * offer at all — it teaches an agent that the console is unreliable.
 * -------------------------------------------------------------------------- */

/** Every result POST /call accepts. Deliberately written out rather than
 *  imported: `src/lib/erp/orders.ts` is `server-only` and would throw here, and
 *  a contract test asserting the vocabulary the ERP shipped with is exactly what
 *  this directory is for. */
const CALL_RESULTS = [
  'no_answer', 'callback', 'confirmed', 'cancelled',
  'tentative1', 'tentative2', 'tentative3', 'unreachable',
];

const NOTE_TYPES = [
  'client_called_back', 'complaint', 'address_change', 'client_instructions', 'other',
];

describe('the order detail can be worked, not only read', () => {
  let workable = '';
  let reader: Caller;
  let readerOrder = '';

  const newOrder = async (body: Record<string, unknown> = {}) =>
    (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Write Customer', phone: phone(), price: 3200, product: 'Write Widget',
      wilaya: 'Alger', commune: 'Bab Ezzouar', ...body,
    })).body.data.id as string;

  before(async () => {
    if (skip) return;
    workable = await newOrder({ agentUserId: acme.agent.userId });

    // A plain MEMBER: `*:*:read` reaches erp:orders:read, so they can OPEN the
    // order, and nothing reaches erp:orders:write. That combination is the
    // whole reason the panels are gated on the permission rather than on
    // whether the page rendered.
    reader = await makeMember(acme.tenantId, { role: 'MEMBER' });
    readerOrder = await newOrder({ agentUserId: reader.userId });
  });

  test('the agent who owns the order gets the write panels', async () => {
    const r = await html(`/console/erp/orders/${workable}`, acme.agent.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-order-write"/);
    assert.match(r.body, /data-testid="erp-call-panel"/);
    assert.match(r.body, /data-testid="erp-note-panel"/);
    assert.match(r.body, /data-testid="erp-classify-panel"/);
  });

  test('the result buttons are exactly the vocabulary the API accepts', async () => {
    const r = await html(`/console/erp/orders/${workable}`, acme.agent.token);
    const offered = [...r.body.matchAll(/data-result="([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(offered, [...CALL_RESULTS].sort());
    // `pending` is where an order STARTS, not an outcome. It is in
    // ORDER_STATUSES and not in CALL_RESULTS, and POST /call answers 422 —
    // so a button for it would be a control the API refuses.
    assert.ok(!offered.includes('pending'), 'offered a result the API would refuse');
  });

  test('and every one of them really is accepted', async () => {
    // The other direction, which is the one that matters: the screen must not
    // be offering a button that 403s or 422s. Each result is logged for real
    // against a throwaway order.
    const id = await newOrder({ agentUserId: acme.agent.userId });
    for (const result of CALL_RESULTS) {
      const r = await acme.agent.api('POST', `/api/erp/orders/${id}/call`, { result });
      assert.equal(r.status, 200, `the screen offers "${result}" and the API refused it`);
    }
  });

  test('the note panel offers exactly the note types the API accepts', async () => {
    const r = await html(`/console/erp/orders/${workable}`, acme.agent.token);
    const options = [...r.body.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    for (const type of NOTE_TYPES) {
      assert.ok(options.includes(type), `no control for note type "${type}"`);
    }
  });

  test('the three tentative results have real labels, in every locale', async () => {
    // They are first-class ERP statuses — ORDER_STATUSES, CALL_RESULTS and the
    // attempts matrix all carry them — and they were missing from the console's
    // status registry entirely until a result picker rendered three buttons
    // labelled "Unknown". Nothing had reached a tentative state before, so no
    // read screen could have shown it.
    for (const [locale, unknown] of [['en', 'Unknown'], ['fr', 'Inconnu']] as const) {
      const r = await html(`/console/erp/orders/${workable}`, acme.agent.token, locale);
      assert.equal(r.status, 200);
      for (const n of [1, 2, 3]) {
        const button = new RegExp(`data-result="tentative${n}"[^>]*>([^<]*)<`);
        const label = r.body.match(button)?.[1] ?? '';
        assert.notEqual(label.trim(), '', `tentative${n} has no label in ${locale}`);
        assert.notEqual(label.trim(), unknown, `tentative${n} is unlabelled in ${locale}`);
        assert.ok(!label.includes('status.'), `tentative${n} leaked a raw key in ${locale}`);
      }
    }
  });

  test('a reader without erp:orders:write gets no controls, and is told why', async () => {
    const r = await html(`/console/erp/orders/${readerOrder}`, reader.token);
    assert.equal(r.status, 200, 'they can read it — the glob grants erp:orders:read');
    assert.ok(!/data-testid="erp-order-write"/.test(r.body), 'but nothing to press');
    assert.ok(!/data-result="/.test(r.body));
    assert.match(r.body, /data-testid="erp-order-readonly"/, 'absence is stated, not silent');

    // And the API agrees, which is the point of gating on the permission the
    // route checks rather than on anything the page knows.
    const refused = await reader.api('POST', `/api/erp/orders/${readerOrder}/call`, {
      result: 'confirmed',
    });
    assert.equal(refused.status, 403);
  });

  test('the call panel shows the server’s state, never a guess at it', async () => {
    const id = await newOrder({ agentUserId: acme.agent.userId });

    const before = await html(`/console/erp/orders/${id}`, acme.agent.token);
    assert.match(before.body, /data-testid="call-start"/);
    assert.ok(!/data-testid="call-running"/.test(before.body));

    // Pressing "start" is exactly this request. A confirmed call is money, so
    // the panel renders `pendingCallStart` as the database holds it — which is
    // also what makes a second tab, or a colleague, see the same thing.
    assert.equal(
      (await acme.agent.api('POST', `/api/erp/orders/${id}/call-start`, {})).status,
      200,
    );

    const after = await html(`/console/erp/orders/${id}`, acme.agent.token);
    assert.match(after.body, /data-testid="call-running"/);
    assert.ok(
      !/data-testid="call-start"/.test(after.body),
      'starting twice would overwrite the start time the suspicious flag rests on',
    );
    // The results stay offered throughout: POST /call accepts a result with no
    // start and FLAGS it, so withholding the control would refuse work the API
    // allows and strand an agent who forgot to press start.
    assert.match(after.body, /data-result="confirmed"/);
  });

  test('classification offers the opposite of whatever is true now', async () => {
    const id = await newOrder({ agentUserId: acme.agent.userId });

    const clean = await html(`/console/erp/orders/${id}`, acme.agent.token);
    assert.match(clean.body, /data-testid="classify-fake"/);
    assert.ok(!/data-testid="classify-clear"/.test(clean.body));

    await acme.agent.api('POST', `/api/erp/orders/${id}/classify`, {
      classification: 'fake', reason: 'duplicate', responsible: 'marketing',
    });

    const marked = await html(`/console/erp/orders/${id}`, acme.agent.token);
    assert.match(marked.body, /data-testid="classify-clear"/);
    assert.ok(!/data-testid="classify-fake"/.test(marked.body));
    assert.match(marked.body, /data-testid="order-fake"/, 'and the badge agrees');
  });
});

/* -----------------------------------------------------------------------------
 * Phase 6.3b — editing, reassigning, and the list's bulk actions
 *
 * The theme of this block is the SPLIT: `buildPatch` writes some fields for
 * anybody who may touch the order and others only for a manager, and refuses
 * reassignment LOUDLY rather than dropping it. Every one of those distinctions
 * has to be visible on the screen, or an agent types into a box whose value is
 * silently discarded.
 * -------------------------------------------------------------------------- */

describe('an order can be edited, and only where the API allows it', () => {
  let owned = '';

  const newOrder = async (body: Record<string, unknown> = {}) =>
    (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Edit Customer', phone: phone(), price: 5500, product: 'Edit Widget',
      wilaya: 'Alger', commune: 'Bab Ezzouar', ...body,
    })).body.data.id as string;

  before(async () => {
    if (skip) return;
    owned = await newOrder({ agentUserId: acme.agent.userId });
  });

  test('an agent gets the fields they may write and none of the ones they may not', async () => {
    const r = await html(`/console/erp/orders/${owned}`, acme.agent.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-edit-panel"/);

    // AGENT_WRITABLE: correcting the address on your own order is the job.
    for (const field of ['client', 'phone', 'wilaya', 'commune', 'city', 'product', 'quantity']) {
      assert.match(r.body, new RegExp(`id="edit-${field}"`), `no control for "${field}"`);
    }

    // MANAGER_WRITABLE: `price` is what payroll and the profit calculator are
    // computed from. `buildPatch` DROPS it silently for an agent, so a box they
    // could type into would swallow the change without a word.
    for (const field of ['price', 'managerNote', 'marketer', 'brand']) {
      assert.ok(
        !new RegExp(`id="edit-${field}"`).test(r.body),
        `an agent was offered the manager-only field "${field}"`,
      );
    }
  });

  test('and a manager gets both halves', async () => {
    const r = await html(`/console/erp/orders/${owned}`, acme.manager.token);
    assert.match(r.body, /id="edit-client"/);
    assert.match(r.body, /id="edit-price"/);
    assert.match(r.body, /id="edit-managerNote"/);
  });

  test('money is never a number input', async () => {
    // A number input hands back a JS float, and 37 columns are Decimal
    // precisely so money never touches binary floating point (M-06). The last
    // place that guarantee can be lost is the box a person types into.
    const r = await html(`/console/erp/orders/${owned}`, acme.manager.token);
    const priceInput = r.body.match(/<input[^>]*id="edit-price"[^>]*>/)?.[0] ?? '';
    assert.notEqual(priceInput, '', 'no price control found');
    assert.ok(!/type="number"/.test(priceInput), `price rendered as ${priceInput}`);
    assert.match(priceInput, /inputmode="decimal"/i);
  });

  test('an agent gets no reassign control, and the API would refuse it anyway', async () => {
    const r = await html(`/console/erp/orders/${owned}`, acme.agent.token);
    assert.ok(!/data-testid="erp-reassign-panel"/.test(r.body));

    // Reassignment is the ONE field refused loudly rather than dropped, so that
    // an agent cannot believe they picked up work. Keeping the control off the
    // screen is what stops a person ever meeting that 403.
    const refused = await acme.agent.api('PATCH', `/api/erp/orders/${owned}`, {
      agentUserId: acme.other.userId,
    });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, 'FORBIDDEN_FIELD');
  });

  test('a manager gets the picker, listing this tenant’s people and no others', async () => {
    const r = await html(`/console/erp/orders/${owned}`, acme.manager.token);
    assert.match(r.body, /data-testid="erp-reassign-panel"/);
    assert.match(r.body, /id="agentUserId"/);
    assert.match(r.body, /id="followupUserId"/);

    for (const userId of [acme.agent.userId, acme.other.userId, acme.manager.userId]) {
      assert.ok(r.body.includes(userId), `the picker is missing ${userId}`);
    }

    // A membership is tenant-scoped and the binding is what enforces it, so a
    // second tenant's people cannot appear — asserted rather than assumed,
    // because this is the one screen that lists PEOPLE.
    const beta = await makeErpTenant('reassign-beta');
    const fresh = await html(`/console/erp/orders/${owned}`, acme.manager.token);
    assert.ok(
      !fresh.body.includes(beta.agent.userId),
      "another tenant's member appeared in the picker",
    );
  });

  test('the form re-renders on what the server stored, not on what was typed', async () => {
    // `buildPatch` NORMALISES a phone number, because that value is the Client
    // dedup key and `+213 555 12 34 56` must be the same customer as
    // `0555123456`. So a PATCH does not always store what was sent — and the
    // box has to show the stored form afterwards, or the screen is quietly
    // lying about the field a customer record is keyed on.
    const id = await newOrder({ agentUserId: acme.agent.userId });
    const typed = '+213 555 12 34 56';

    const r = await acme.manager.api('PATCH', `/api/erp/orders/${id}`, { phone: typed });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.phone, '0555123456', 'the server normalised it');

    const screen = await html(`/console/erp/orders/${id}`, acme.manager.token);
    const input = screen.body.match(/<input[^>]*id="edit-phone"[^>]*>/)?.[0] ?? '';
    assert.match(input, /value="0555123456"/, `the form shows ${input}`);
    assert.ok(!input.includes(typed), 'it must not still show the typed form');
  });

  test('no password material reaches the picker (SEC-02)', async () => {
    const r = await html(`/console/erp/orders/${owned}`, acme.manager.token);
    assert.ok(!r.body.includes('passwordHash'), 'not even the field name');
    assert.ok(!/\$argon2|scrypt\$|\$2[aby]\$/.test(r.body), 'and no hash of any generation');
  });
});

describe('the order list can act on many rows at once', () => {
  test('a writer gets the bar and a checkbox per row', async () => {
    const r = await html('/console/erp/orders', acme.agent.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-bulk-bar"/);
    assert.match(r.body, /name="orderId"/, 'the selection is a form, not client state');
    assert.match(r.body, /data-testid="erp-orders-table"/, 'and the table is still rendered');
  });

  test('status is offered to any writer; assign and delete are not', async () => {
    // `POST /orders/bulk` refuses `delete` and `assign` for anyone
    // `seesWholeBook` is false for, and says so explicitly.
    const asAgent = await html('/console/erp/orders', acme.agent.token);
    assert.match(asAgent.body, /data-testid="bulk-status-apply"/);
    assert.ok(!/data-testid="bulk-delete"/.test(asAgent.body));
    assert.ok(!/data-testid="bulk-assign-apply"/.test(asAgent.body));

    const asManager = await html('/console/erp/orders', acme.manager.token);
    assert.match(asManager.body, /data-testid="bulk-status-apply"/);
    assert.match(asManager.body, /data-testid="bulk-delete"/);
    assert.match(asManager.body, /data-testid="bulk-assign-apply"/);
  });

  test('and the API agrees with what each of them was offered', async () => {
    const id = (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Bulk Customer', phone: phone(), agentUserId: acme.agent.userId,
    })).body.data.id as string;

    assert.equal(
      (await acme.agent.api('POST', '/api/erp/orders/bulk', {
        ids: [id], action: 'status', value: 'callback',
      })).status,
      200,
      'the agent was offered a status change and the API refused it',
    );
    assert.equal(
      (await acme.agent.api('POST', '/api/erp/orders/bulk', {
        ids: [id], action: 'delete',
      })).status,
      403,
      'the agent was not offered delete, and this is why',
    );
  });

  test('a reader without erp:orders:write gets no bar and no checkboxes', async () => {
    const reader = await makeMember(acme.tenantId, { role: 'MEMBER' });
    const r = await html('/console/erp/orders', reader.token);
    assert.equal(r.status, 200, 'they can still read the list');
    assert.ok(!/data-testid="erp-bulk-bar"/.test(r.body));
    assert.ok(!/name="orderId"/.test(r.body), 'no control implies no selection');
  });
});

/* -----------------------------------------------------------------------------
 * Phase 6.3c — the parcel, the catalogue and the stockroom
 *
 * Three surfaces, three DIFFERENT permissions — `erp:shipments:write`,
 * `erp:products:write`, `erp:inventory:write` — none of which an ERP
 * confirmation agent holds. That is the point of this block: the gate is the
 * permission each ROUTE checks, not one blanket "may write" flag, and an agent
 * who can work an order still must not book parcels or correct stock.
 * -------------------------------------------------------------------------- */

describe('the parcel can be booked from the order it belongs to', () => {
  test('a manager gets the control; an agent does not', async () => {
    const id = (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Parcel Customer', phone: phone(), agentUserId: acme.agent.userId,
    })).body.data.id as string;

    const asManager = await html(`/console/erp/orders/${id}`, acme.manager.token);
    assert.equal(asManager.status, 200);
    assert.match(asManager.body, /data-testid="erp-parcel-panel"/);
    assert.match(asManager.body, /data-testid="parcel-book"/, 'nothing booked yet');
    assert.ok(!/data-testid="parcel-refresh"/.test(asManager.body), 'nothing to refresh');

    // An agent holds erp:orders:write by explicit grant and NOT
    // erp:shipments:write — which is the ERP's own split: a confirmation agent
    // logs calls, they do not book parcels.
    const asAgent = await html(`/console/erp/orders/${id}`, acme.agent.token);
    assert.equal(asAgent.status, 200);
    assert.match(asAgent.body, /data-testid="erp-call-panel"/, 'they can still work it');
    assert.ok(!/data-testid="erp-parcel-panel"/.test(asAgent.body));

    assert.equal(
      (await acme.agent.api('POST', `/api/erp/orders/${id}/shipment`, {})).status,
      403,
      'and the API agrees with what they were not offered',
    );
  });

  test('once a parcel exists the control becomes "ask the carrier"', async () => {
    // Booking is idempotent — a second call returns the existing shipment — so
    // offering it again would not be dangerous, only a lie about the button.
    const carrierCode = `pc${uid()}`;
    await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Parcel Carrier', code: carrierCode, adapter: 'mock',
    });
    const id = (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Booked Customer', phone: phone(), carrierCode,
    })).body.data.id as string;

    const booked = await acme.manager.api('POST', `/api/erp/orders/${id}/shipment`, {});
    assert.ok([200, 201].includes(booked.status), `booking answered ${booked.status}`);

    const r = await html(`/console/erp/orders/${id}`, acme.manager.token);
    assert.match(r.body, /data-testid="parcel-refresh"/);
    assert.ok(!/data-testid="parcel-book"/.test(r.body));
  });
});

describe('the catalogue can be added to and archived', () => {
  test('a manager gets the create panel and a per-row archive control', async () => {
    await acme.manager.api('POST', '/api/erp/products', {
      name: `Archivable ${uid()}`, sku: `sku-${uid()}`, price: 1200, costPrice: 700,
    });

    const r = await html('/console/erp/products', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-product-create"/);
    assert.match(r.body, /data-testid="product-archive"/);
    // Archive, never delete. A product is referenced by every order that
    // contained it and by its own ledger.
    assert.ok(!/data-testid="product-delete"/.test(r.body));
  });

  test('the archived view offers restore instead, and no create', async () => {
    const id = (await acme.manager.api('POST', '/api/erp/products', {
      name: `Archived ${uid()}`,
    })).body.data.id as string;
    assert.equal((await acme.manager.api('DELETE', `/api/erp/products/${id}`)).status, 200);

    const r = await html('/console/erp/products?archived=true', acme.manager.token);
    assert.match(r.body, /data-testid="product-restore"/);
    assert.ok(!/data-testid="product-archive"/.test(r.body));
    assert.ok(
      !/data-testid="erp-product-create"/.test(r.body),
      'a new product would land somewhere invisible',
    );
  });

  test('an agent gets neither, and the API refuses them too', async () => {
    const r = await html('/console/erp/products', acme.agent.token);
    assert.equal(r.status, 200, 'the catalogue is readable by role glob');
    assert.ok(!/data-testid="erp-product-create"/.test(r.body));
    assert.ok(!/data-testid="product-archive"/.test(r.body));

    assert.equal(
      (await acme.agent.api('POST', '/api/erp/products', { name: 'Nope' })).status,
      403,
    );
  });
});

describe('stock moves by a delta and a reason, and the screen says so', () => {
  before(async () => {
    if (skip) return;
    await acme.manager.api('POST', '/api/erp/products', {
      name: `Stockable ${uid()}`, stock: 40, threshold: 5, costPrice: 600,
    });
  });

  test('a manager gets both stockroom panels', async () => {
    const r = await html('/console/erp/inventory', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-adjust-panel"/);
    assert.match(r.body, /data-testid="erp-lot-panel"/);
    assert.match(r.body, /id="adjust-product"/, 'and something to act on');
  });

  test('there is no way to type an absolute quantity', async () => {
    // `POST /inventory/adjust` takes a DELTA and a REASON and offers no way to
    // set a total, because "stock is 15" is not auditable and "20 → 15, five
    // damaged, by this person" is. A box labelled "new quantity" would be a
    // control the API cannot honour.
    const r = await html('/console/erp/inventory', acme.manager.token);
    assert.match(r.body, /id="adjust-delta"/);
    assert.match(r.body, /id="adjust-reason"/);
    assert.ok(!/id="adjust-total"|id="adjust-newQty"/.test(r.body));
  });

  test('the movement ledger still offers no edit', async () => {
    // Append-only, and no such route exists.
    const r = await html('/console/erp/inventory', acme.manager.token);
    assert.match(r.body, /data-testid="erp-movements-table"/);
    assert.ok(!/data-movement-edit/.test(r.body));
  });

  test('an agent gets no stockroom controls, and the API refuses them', async () => {
    const r = await html('/console/erp/inventory', acme.agent.token);
    assert.equal(r.status, 200);
    assert.ok(!/data-testid="erp-adjust-panel"/.test(r.body));
    assert.ok(!/data-testid="erp-lot-panel"/.test(r.body));

    const product = (await acme.manager.api('GET', '/api/erp/products')).body.data.items[0];
    assert.ok(product, 'fixture product missing');
    assert.equal(
      (await acme.agent.api('POST', `/api/erp/products/${product.id}/inventory/adjust`, {
        delta: -1, reason: 'nope',
      })).status,
      403,
    );
  });
});

/* -----------------------------------------------------------------------------
 * Phase 6.3d — carriers, the books, the team, and the ERP's own settings
 *
 * The last four write surfaces, and the three most careful ones on the product.
 * Each has something the screen must NOT offer, and each of those absences is
 * asserted here rather than trusted:
 *
 *   - a carrier's real key, anywhere on the page;
 *   - an edit or delete on a saved financial record;
 *   - suspending yourself or the owner;
 *   - a control for a setting whose type has no editor.
 * -------------------------------------------------------------------------- */

describe('carriers can be configured without their keys reaching the page', () => {
  let carrierId = '';
  const secret = `sk-live-${Date.now()}`;

  before(async () => {
    if (skip) return;
    carrierId = (await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Write Carrier', code: `wc${uid()}`, adapter: 'mock',
      apiKey: secret, secretKey: `${secret}-2`,
    })).body.data.id as string;
  });

  test('a manager gets the create panel and per-row controls', async () => {
    const r = await html('/console/erp/carriers', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-carrier-create"/);
    assert.match(r.body, /data-testid="carrier-keys-toggle"/);
    assert.match(r.body, /data-testid="carrier-mappings-toggle"/);
    // Deactivate, not delete: shipments reference their carrier and the
    // relation is SetNull, so deleting would orphan historical parcels.
    assert.match(r.body, /data-testid="carrier-deactivate"/);
    assert.ok(!/data-testid="carrier-delete"/.test(r.body));
  });

  test('and no credential reaches the page, with the controls on it', async () => {
    // The 6.2 guarantee, re-asserted now that the screen has a form whose
    // fields are FOR credentials. The mask is four bullets; the key is not
    // selected at all.
    const r = await html('/console/erp/carriers', acme.manager.token);
    assert.ok(!r.body.includes(secret), 'the API key reached the page');
    assert.ok(!r.body.includes(`${secret}-2`), 'the secret key reached the page');
    assert.match(r.body, /data-configured="true"/, 'but it says one exists');
  });

  test('a saved key survives a round trip through the form', async () => {
    // The form sends only what was typed — the mask and a blank are both "leave
    // it" — and `preserveSecrets` drops the mask on the server. Either alone
    // would do; this asserts the outcome rather than the mechanism.
    const before = await acme.manager.api('GET', `/api/erp/carriers/${carrierId}`);
    assert.equal(before.body.data._hasCredentials, true);

    // What the form posts when somebody opens it, changes nothing, and saves.
    await acme.manager.api('PUT', `/api/erp/carriers/${carrierId}`, { name: 'Renamed Carrier' });

    const after = await acme.manager.api('GET', `/api/erp/carriers/${carrierId}`);
    assert.equal(after.body.data.name, 'Renamed Carrier');
    assert.equal(after.body.data._hasCredentials, true, 'the stored key was destroyed');
  });

  test('the mapping picker offers CRM statuses and nothing else', async () => {
    await acme.manager.api('POST', `/api/erp/carriers/${carrierId}/status-mappings`, {
      originalStatus: 'LIVRE AU CLIENT', crmStatus: 'delivered',
    });

    const r = await html('/console/erp/carriers', acme.manager.token, 'en');
    assert.match(r.body, /data-mapping="LIVRE AU CLIENT"/, 'the taught wording is shown');
    // A select, not a free-text box: the CRM side has a fixed vocabulary and a
    // typed value would map a carrier's wording onto a status nothing
    // downstream understands.
    assert.match(r.body, /id="map-crm-/);
    for (const crm of ['delivered', 'returned', 'in_transit']) {
      assert.match(r.body, new RegExp(`<option value="${crm}"`), `no option for ${crm}`);
    }
  });

  test('an agent gets no carrier controls, and the API refuses them', async () => {
    // `erp:shipments:write` gates the whole carrier surface — including GET —
    // so an agent does not even reach the screen.
    assert.equal((await page('/console/erp/carriers', acme.agent.token)).status, 404);
    assert.equal(
      (await acme.agent.api('POST', '/api/erp/carriers', { name: 'x', code: `x${uid()}` })).status,
      403,
    );
  });
});

describe('the books can be written, and a saved record still cannot be', () => {
  test('a manager gets the record and charge panels', async () => {
    const r = await html('/console/erp/finance', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-record-panel"/);
    assert.match(r.body, /data-testid="erp-charge-panel"/);
  });

  test('net profit and margin have no input, because the server derives them', async () => {
    // A contract test posts `netProfit: 999999` and expects 37000 back. A box
    // for it would be a field whose value the server throws away.
    const r = await html('/console/erp/finance', acme.manager.token);
    assert.match(r.body, /id="fin-revenue"/);
    assert.match(r.body, /id="fin-productCosts"/);
    assert.ok(!/id="fin-netProfit"/.test(r.body), 'net profit is not an input');
    assert.ok(!/id="fin-margin"/.test(r.body), 'nor is margin');
  });

  test('money is never a number input on this screen either', async () => {
    const r = await html('/console/erp/finance', acme.manager.token);
    for (const id of ['fin-revenue', 'charge-amount']) {
      const tag = r.body.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
      assert.notEqual(tag, '', `no control found for ${id}`);
      assert.ok(!/type="number"/.test(tag), `${id} rendered as ${tag}`);
      assert.match(tag, /inputmode="decimal"/i);
    }
  });

  test('a saved record offers no edit and no delete; a charge offers a delete', async () => {
    const day = Date.UTC(2026, 6, 1);
    const saved = await acme.manager.api('POST', '/api/erp/financial-records', {
      periodType: 'month', startDate: day, endDate: day + 86_400_000,
      revenue: 50000, productCosts: 13000,
    });
    assert.equal(saved.status, 201);

    const charge = await acme.manager.api('POST', '/api/erp/unexpected-charges', {
      label: 'Van repair', amount: 4500,
    });
    assert.equal(charge.status, 201);

    const r = await html('/console/erp/finance', acme.manager.token);
    assert.match(r.body, /data-testid="erp-finance-table"/);
    // The asymmetry the schema encodes: a P&L is a statement somebody made, a
    // van repair typed in wrong is data entry.
    assert.match(r.body, /data-testid="charge-remove"/);
    assert.ok(!/data-record-delete|data-record-edit/.test(r.body), 'a record must not be editable');
  });

  test('an agent reaches neither the screen nor the routes', async () => {
    // erp:finance:read is SENSITIVE (D-05.1) — the company's P&L.
    assert.equal((await page('/console/erp/finance', acme.agent.token)).status, 404);
    assert.equal(
      (await acme.agent.api('POST', '/api/erp/unexpected-charges', {
        label: 'nope', amount: 1,
      })).status,
      403,
    );
  });
});

describe('the team can be configured, within what the API allows', () => {
  test('a manager gets the edit panel and a suspend control for others', async () => {
    const r = await html('/console/erp/agents', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="agent-edit-toggle"/);
    assert.match(
      r.body,
      new RegExp(`data-testid="agent-suspend"[^>]*data-user-id="${acme.agent.userId}"`),
      'no suspend control for a colleague',
    );
  });

  test('but no control to suspend themselves', async () => {
    // The API answers 422 CANNOT_SUSPEND_SELF: suspending yourself ends the
    // session doing the suspending and leaves nobody able to undo it. Keeping
    // the control off the screen is what stops anybody meeting that refusal.
    const r = await html('/console/erp/agents', acme.manager.token);
    const own = new RegExp(
      `data-testid="agent-suspend"[^>]*data-user-id="${acme.manager.userId}"`,
    );
    assert.ok(!own.test(r.body), 'a manager was offered a control to suspend themselves');

    const refused = await acme.manager.api(
      'POST', `/api/erp/agents/${acme.manager.userId}/suspend`,
    );
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error.code, 'CANNOT_SUSPEND_SELF');
  });

  test('the job roles offered are exactly the ones the API accepts', async () => {
    const r = await html('/console/erp/agents', acme.manager.token);
    for (const role of ['confirmation', 'followup', 'both']) {
      assert.match(r.body, new RegExp(`<option value="${role}"`), `no option for ${role}`);
    }
    // The JOB, not the privilege — the ERP kept them separate so a follow-up
    // agent could also be a manager, and PATCH deliberately cannot set a
    // platform role.
    for (const notARole of ['OWNER', 'ADMIN', 'MEMBER']) {
      assert.ok(
        !new RegExp(`<option value="${notARole}"`).test(r.body),
        `the platform role ${notARole} was offered as a job role`,
      );
    }
  });

  test('pay rates round-trip through the panel', async () => {
    const r = await acme.manager.api('PATCH', `/api/erp/agents/${acme.agent.userId}`, {
      jobRole: 'followup', baseSalaryMonthly: '42000', payPerConfirmedOrder: '55',
    });
    assert.equal(r.status, 200);

    const screen = await html('/console/erp/agents', acme.manager.token);
    const input = screen.body.match(
      new RegExp(`<input[^>]*id="agent-baseSalaryMonthly-${acme.agent.userId}"[^>]*>`),
    )?.[0] ?? '';
    assert.match(input, /value="42000"/, `the panel shows ${input}`);
    assert.ok(!screen.body.includes('passwordHash'), 'still no password material (SEC-02)');
  });

  test('an agent cannot reach the screen at all', async () => {
    // erp:agents:manage is SENSITIVE — no role grants it implicitly.
    assert.equal((await page('/console/erp/agents', acme.agent.token)).status, 404);
  });
});

describe('the ERP has an automation screen, which is not a second Settings', () => {
  test('the product does not ship a nav item the platform owns', async () => {
    // `packages/product-registry` refuses `id: 'settings'` outright: a tenant
    // with N products must still see ONE Settings, owned by the shell. The
    // rename to "automation" is not a workaround — every key on the screen is a
    // rule the ERP applies by itself, which is what it should have been called.
    const r = await html('/console/erp', acme.manager.token);
    assert.match(r.body, /data-nav="automation"/);
    assert.ok(!/data-nav="settings"/.test(r.body), 'a product must not own Settings');
    // And the shell's own Settings link is still there, once.
    assert.equal((r.body.match(/href="\/console\/settings"/g) ?? []).length, 1);
  });

  test('a manager gets a control for every setting that has one', async () => {
    const r = await html('/console/erp/automation', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-settings-form"/);
    assert.match(r.body, /data-testid="product-switcher"/, 'inside the console shell');

    // The five booleans, a number, and the one enum — read from the schema the
    // route validates against, so a setting added later gets a control without
    // anyone editing the screen.
    for (const key of [
      'autoAssign', 'autoCreateShipment', 'autoReassign', 'autoSuspend',
      'followupAutoAssign', 'minCallSeconds', 'workHoursStart', 'workHoursEnd',
      'reservationMode',
    ]) {
      assert.match(r.body, new RegExp(`data-setting="${key}"`), `no control for ${key}`);
    }
  });

  test('the structured settings have no control, by type not by name', async () => {
    // `defaultCarrierByChannel` is a map and `fixedCosts` a list; each needs an
    // editor of its own, and a JSON textarea would accept anything the server's
    // `typeof value === "object"` check allows.
    const r = await html('/console/erp/automation', acme.manager.token);
    assert.ok(!/data-setting="defaultCarrierByChannel"/.test(r.body));
    assert.ok(!/data-setting="fixedCosts"/.test(r.body));
  });

  test('the reservation picker offers exactly the accepted values', async () => {
    const r = await html('/console/erp/automation', acme.manager.token);
    for (const mode of ['immediate', 'on_confirm', 'none']) {
      assert.match(r.body, new RegExp(`<option value="${mode}"`), `no option for ${mode}`);
    }
    assert.equal(
      (await acme.manager.api('PUT', '/api/erp/settings', { reservationMode: 'nonsense' })).status,
      422,
      'and a value it does not offer is refused',
    );
  });

  test('a stored value is what the form shows', async () => {
    assert.equal(
      (await acme.manager.api('PUT', '/api/erp/settings', { minCallSeconds: 55 })).status,
      200,
    );
    const r = await html('/console/erp/automation', acme.manager.token);
    const input = r.body.match(/<input[^>]*id="set-minCallSeconds"[^>]*>/)?.[0] ?? '';
    assert.match(input, /value="55"/, `the form shows ${input}`);
    // The route's own bounds, on the control.
    assert.match(input, /max="3600"/);
  });

  test('an agent gets neither the link nor the page', async () => {
    const asAgent = await html('/console/erp', acme.agent.token);
    assert.ok(!/data-nav="automation"/.test(asAgent.body), 'no link to a screen that would 404');
    assert.equal((await page('/console/erp/automation', acme.agent.token)).status, 404);
  });
});
