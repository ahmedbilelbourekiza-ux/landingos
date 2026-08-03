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
