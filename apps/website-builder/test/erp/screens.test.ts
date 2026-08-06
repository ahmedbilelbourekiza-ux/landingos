import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_COOKIE } from '@landingos/auth';

import {
  skip, BASE, uid, phone, makeTenant, makeMember, makeErpTenant, makeFollowupTask, cleanup,
  setCarrierAdapter, slugOf, setAgentMissed,
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

  test('the ticked rows can be exported, by anyone the table is offered to', async () => {
    // LP.6. The export route is `erp:orders:read` and record-scoped — an agent
    // exports their own queue, which is what they are already looking at — so
    // withholding it would be the other half of D-06.2 broken.
    const asAgent = await html('/console/erp/orders', acme.agent.token);
    assert.match(asAgent.body, /data-testid="bulk-export"/);
  });
});

/* -----------------------------------------------------------------------------
 * LP.6 — the order book leaves the building
 * -------------------------------------------------------------------------- */

describe('the order list can produce a file', () => {
  test('the export panel offers every format the route accepts', async () => {
    const r = await html('/console/erp/orders', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-order-export"/);
    for (const format of ['zr', 'ecom', 'ecotrac', 'orders', 'agents']) {
      assert.match(r.body, new RegExp(`data-testid="export-${format}"`), `no link for ${format}`);
    }
  });

  test('the links carry the filters that are on screen', async () => {
    // The legacy's Export screen sat somewhere else and could only ever export
    // "all confirmed" — whatever an operator had narrowed to on the order list
    // was not something that page could see. Here the file IS the filtered list.
    const r = await html('/console/erp/orders?wilaya=Oran&range=today', acme.manager.token);
    assert.match(r.body, /href="\/api\/erp\/orders\/export\?[^"]*wilaya=Oran/);
    assert.match(r.body, /href="\/api\/erp\/orders\/export\?[^"]*range=today/);
  });

  test('a carrier link never carries a status, because it cannot honour one', async () => {
    // D-LP.6.3: the three carrier formats force `confirmed`. A link that
    // carried `status=pending` would promise a file the route will not build.
    const r = await html('/console/erp/orders?status=pending', acme.manager.token);
    const zr = /href="(\/api\/erp\/orders\/export\?[^"]*format=zr)"/.exec(r.body);
    assert.ok(zr, 'the ZR link must be present');
    assert.ok(!zr![1].includes('status='), `the ZR link must not carry a status: ${zr![1]}`);

    // The report format is about the book rather than a delivery run, so it
    // does keep the filter.
    const report = /href="(\/api\/erp\/orders\/export\?[^"]*format=orders)"/.exec(r.body);
    assert.ok(report![1].includes('status=pending'));
  });

  test('no link carries the page number', async () => {
    const r = await html('/console/erp/orders?page=2', acme.manager.token);
    const link = /href="(\/api\/erp\/orders\/export\?[^"]*format=zr)"/.exec(r.body);
    assert.ok(link);
    assert.ok(!link![1].includes('page='), 'a paged export is a silent truncation');
  });

  test('the agent report is absent for somebody the route would refuse', async () => {
    // `erp:agents:manage` is SENSITIVE — it is a league table of confirmation
    // rates and suspicious-call counts. Absent, not disabled: a disabled link
    // still says "you nearly could".
    const asAgent = await html('/console/erp/orders', acme.agent.token);
    assert.match(asAgent.body, /data-testid="export-zr"/, 'the carrier files are still offered');
    assert.ok(!/data-testid="export-agents"/.test(asAgent.body));
  });

  test('the counts say what the links would produce', async () => {
    const r = await html('/console/erp/orders', acme.manager.token);
    assert.match(r.body, /data-testid="export-confirmed-count"/);
    assert.match(r.body, /data-testid="export-filtered-count"/);
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

/* -----------------------------------------------------------------------------
 * LP.4 — an order can be taken over the phone
 *
 * `POST /api/erp/orders` has been contract-tested since Phase 5.2 and until now
 * nothing called it from the console, so a manager with a customer on the line
 * had no way to enter the order. The interesting assertions here are the two
 * about the CONTROL SURFACE matching the route: every box names a key the route
 * parses, and the one field the route refuses from an agent has no box for one.
 * -------------------------------------------------------------------------- */

describe('an order can be created from the console', () => {
  test('a manager gets the panel, with every field the route parses', async () => {
    const r = await html('/console/erp/orders', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-order-create"/);
    assert.match(r.body, /data-testid="order-create-submit"/);

    // Each of these is a key `CreateOrder` reads. A box for anything else would
    // be a field somebody fills in that quietly does nothing.
    for (const name of [
      'client', 'phone', 'wilaya', 'commune', 'city',
      'product', 'productVariant', 'quantity', 'price',
      'status', 'carrierCode', 'note',
    ]) {
      assert.match(r.body, new RegExp(`id="new-order-${name}"`), `${name} must have a box`);
    }
  });

  test('the two fields the route does NOT accept have no box', async () => {
    const r = await html('/console/erp/orders', acme.manager.token);
    // `deliveryMethod` is 'COD' everywhere with no vocabulary to build options
    // from; `source` is set by the system, because an order claiming to have
    // come from Shopify when it did not corrupts every channel report.
    assert.ok(!/id="new-order-deliveryMethod"/.test(r.body));
    assert.ok(!/id="new-order-source"/.test(r.body));
  });

  test('assignment is offered to a manager and withheld from an agent', async () => {
    // D-06.2, and the route is the reason: `agentUserId` from somebody who does
    // not see the whole book answers 403 FORBIDDEN_FIELD, so a control for it
    // would be one the API refuses.
    const asManager = await html('/console/erp/orders', acme.manager.token);
    assert.match(asManager.body, /id="new-order-agentUserId"/);

    const asAgent = await html('/console/erp/orders', acme.agent.token);
    assert.ok(!/id="new-order-agentUserId"/.test(asAgent.body));
    // But the panel itself is there: the route accepts an order from an agent,
    // and withholding a control the API accepts is the other half of D-06.2.
    assert.match(asAgent.body, /data-testid="erp-order-create"/);
  });

  test('the refusal the panel prevents is still enforced by the route', async () => {
    // The disabled button is a courtesy. The rule lives on the server, and a
    // test that only checked the button would pass against a route that had
    // stopped enforcing it.
    const r = await acme.manager.api('POST', '/api/erp/orders', { product: 'No contact' });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INVALID_INPUT');
  });

  test('an agent naming an assignee is refused, loudly', async () => {
    // Refused rather than dropped: silently ignoring it would let an agent
    // believe they had assigned work that nobody was given.
    const r = await acme.agent.api('POST', '/api/erp/orders', {
      client: 'Mine now', phone: phone(), agentUserId: acme.other.userId,
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'FORBIDDEN_FIELD');
  });

  test('a reader gets no panel at all', async () => {
    // `erp:orders:write` is what the route checks and what decides the panel.
    const reader = await makeMember(acme.tenantId, { role: 'VIEWER' });
    const r = await html('/console/erp/orders', reader.token);
    if (r.status === 200) {
      assert.ok(!/data-testid="erp-order-create"/.test(r.body));
    }
    assert.equal(
      (await reader.api('POST', '/api/erp/orders', { client: 'Nope' })).status, 403,
      'and the route refuses them too',
    );
  });

  test('the carrier list offers the tenant’s own codes, not free text', async () => {
    // `createShipment` looks the code up and falls back to the DEFAULT when it
    // matches nothing, so a typed code books the wrong carrier and says so
    // nowhere. The options are the tenant's active carriers.
    const code = `oc${uid()}`;
    await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Offered Carrier', code, adapter: 'mock',
    });

    const r = await html('/console/erp/orders', acme.manager.token);
    assert.match(r.body, /id="new-order-carrierCode"/);
    assert.ok(r.body.includes(`value="${code}"`), 'the tenant’s carrier is an option');
    assert.ok(!/name="carrierCode"[^>]*type="text"/.test(r.body), 'and it is not a text box');
  });

  test('another tenant’s carriers are not offered', async () => {
    const beta = await makeErpTenant('order-create-beta');
    const theirs = `bt${uid()}`;
    await beta.manager.api('POST', '/api/erp/carriers', {
      name: 'Theirs', code: theirs, adapter: 'mock',
    });
    const r = await html('/console/erp/orders', acme.manager.token);
    assert.ok(!r.body.includes(theirs), 'the binding scopes the select like everything else');
  });

  test('a created order appears in the list, from the database', async () => {
    // D-06.3 end to end: no optimistic row. The order is on the screen because
    // it is stored, which is also what proves the panel calls the real route
    // rather than a second write path.
    const name = `Phone order ${uid()}`;
    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: name, phone: phone(), product: 'Widget', quantity: '2', price: '3500',
      wilaya: 'Alger', status: 'pending',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.source, 'manual', 'the system sets the source');
    assert.equal(String(created.body.data.price), '3500');
    assert.equal(created.body.data.quantity, 2);

    const r = await html(
      `/console/erp/orders?search=${encodeURIComponent(name)}`, acme.manager.token,
    );
    assert.ok(r.body.includes(name), 'and it is on the screen');
  });
});

/* -----------------------------------------------------------------------------
 * LP.3 — the lists are navigable
 *
 * Every ERP screen was a hard-capped first-N read with no next, no page number
 * and no total: row 51 did not exist as far as the console was concerned. And
 * `orderFilters` accepted nine filters that had no control anywhere, so the
 * answer to "pending orders in Alger from yesterday" was to hand-write a URL.
 *
 * The load-bearing test in here is `a filter survives paging` — losing the
 * filter on "next" is the classic defect in a pager and it is invisible in
 * review, because page 1 always looks right.
 * -------------------------------------------------------------------------- */

describe('a list can be paged and filtered', () => {
  let bulk: Awaited<ReturnType<typeof makeErpTenant>>;
  const PAGE = 50;
  const EXTRA = 4;                       // enough to spill onto page 2
  let alger = '';

  before(async () => {
    if (skip) return;
    bulk = await makeErpTenant('paging');
    alger = `Alger-${uid()}`;
    // Sequential on purpose: the fixture is the point of the test, and firing
    // 54 concurrent creates at the free-tier database is how the documented
    // P1001 shows up as a "pager bug".
    for (let i = 0; i < PAGE + EXTRA; i += 1) {
      await bulk.manager.api('POST', '/api/erp/orders', {
        client: `Pager ${i}`, phone: phone(), price: 1000,
        wilaya: i < 3 ? alger : 'Oran',
      });
    }
  });

  const rowsOf = (body: string) => (body.match(/data-order-id="/g) ?? []).length;
  const idsOf = (body: string) =>
    [...body.matchAll(/data-order-id="([^"]+)"/g)].map((m) => m[1]);

  test('page one holds a full page and offers a next', async () => {
    const r = await html('/console/erp/orders', bulk.manager.token);
    assert.equal(r.status, 200);
    assert.equal(rowsOf(r.body), PAGE, 'a full page');
    assert.match(r.body, /data-testid="erp-orders-pager"/);
    assert.match(r.body, /data-testid="erp-orders-pager-next"/, 'there is more to see');
    assert.match(r.body, /data-testid="erp-orders-pager-prev-disabled"/, 'and nothing before it');
    assert.match(r.body, new RegExp(`data-total="${PAGE + EXTRA}"`), 'the total is stated');
  });

  test('page two holds the rows page one did not', async () => {
    // The whole point. Before LP.3 these rows were unreachable from the console
    // by any means — there was no control and no query parameter that worked.
    const one = await html('/console/erp/orders', bulk.manager.token);
    const two = await html('/console/erp/orders?page=2', bulk.manager.token);
    assert.equal(two.status, 200);
    assert.equal(rowsOf(two.body), EXTRA);

    const first = new Set(idsOf(one.body));
    const second = idsOf(two.body);
    assert.ok(second.length > 0);
    assert.ok(second.every((id) => !first.has(id)), 'no row may appear on both pages');
    assert.match(two.body, /data-testid="erp-orders-pager-next-disabled"/, 'and that is the end');
  });

  test('a filter survives paging, and paging resets on apply', async () => {
    // Losing the filter on "next" is the classic pager defect and it is
    // invisible in review because page 1 looks right. Asserted by reading the
    // link the pager actually renders.
    const r = await html(`/console/erp/orders?wilaya=${alger}`, bulk.manager.token);
    assert.equal(rowsOf(r.body), 3, 'the filter reached the query');
    assert.ok(
      !/data-testid="erp-orders-pager-next"[^>]*>/.test(r.body),
      'three results is one page',
    );

    // And the form carries an empty `page`, so applying a filter from page 3
    // cannot land on an empty table that reads as "no matches".
    assert.match(r.body, /<input type="hidden" name="page" value=""/);
  });

  test('a stale bookmark past the end shows the last page, not an empty table', async () => {
    // An empty table reads as "no matches", which is a lie about the data.
    const r = await html('/console/erp/orders?page=99', bulk.manager.token);
    assert.equal(r.status, 200);
    assert.equal(rowsOf(r.body), EXTRA, 'clamped to the real last page');
  });

  test('the filter bar offers exactly what orderFilters reads', async () => {
    // Both directions, the rule 6.3a established. A control for a key the
    // endpoint ignores is a lie; a key with no control is what this slice was
    // built to fix.
    const r = await html('/console/erp/orders', bulk.manager.token);
    for (const name of [
      'search', 'status', 'agentUserId', 'wilaya', 'orderType',
      'classification', 'deliveryOutcome', 'range', 'since', 'until',
    ]) {
      assert.match(r.body, new RegExp(`id="filter-${name}"`), `${name} must have a control`);
    }
  });

  test('every offered filter value actually narrows the list', async () => {
    // The other half: an option that matches nothing because the value is wrong
    // renders perfectly and does nothing.
    const all = rowsOf((await html('/console/erp/orders', bulk.manager.token)).body);
    const pending = await html('/console/erp/orders?status=pending', bulk.manager.token);
    assert.ok(rowsOf(pending.body) > 0 && rowsOf(pending.body) <= all);

    const none = await html('/console/erp/orders?status=delivered', bulk.manager.token);
    assert.equal(rowsOf(none.body), 0, 'and a status nothing holds returns nothing');
  });

  test('a named date range narrows to the same window the API would', async () => {
    // Resolved inside `orderFilters`, so the screen and the endpoint cannot
    // disagree about what "today" contained.
    const today = await html('/console/erp/orders?range=today', bulk.manager.token);
    assert.equal(rowsOf(today.body), PAGE, 'everything was created just now');

    const yesterday = await html('/console/erp/orders?range=yesterday', bulk.manager.token);
    assert.equal(rowsOf(yesterday.body), 0, 'and none of it yesterday');
  });

  test('an unknown range is ignored rather than refused', async () => {
    // A stale bookmark carrying a range that no longer exists must render the
    // list, the same way `orderSort` treats an unknown sort column.
    const r = await html('/console/erp/orders?range=fortnight', bulk.manager.token);
    assert.equal(r.status, 200);
    assert.equal(rowsOf(r.body), PAGE);
  });

  test('the agent filter is not offered to somebody who cannot use it', async () => {
    // `scopedWhere` ANDs the scope in regardless, so for an agent the control
    // could not change anything — and a control that cannot work teaches the
    // wrong model of what they are allowed to see.
    const r = await html('/console/erp/orders', bulk.agent.token);
    assert.equal(r.status, 200);
    assert.ok(!/id="filter-agentUserId"/.test(r.body));
    assert.match(r.body, /id="filter-status"/, 'but their own filters are there');
  });

  test('paging cannot widen an agent’s scope', async () => {
    // The attack the pager makes newly possible: a second page is a SECOND
    // query, and a scope applied only to the first would leak the rest.
    //
    // The fixture orders are unassigned, and an agent may see those — that is
    // `orderScope`'s rule so unclaimed work can be picked up. So the leak has to
    // be tested against orders that belong to SOMEBODY ELSE.
    const theirs: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const created = await bulk.manager.api('POST', '/api/erp/orders', {
        client: `Not yours ${i}`, phone: phone(), price: 1000,
        agentUserId: bulk.other.userId,
      });
      theirs.push(created.body.data.id);
    }

    for (const page of ['', '?page=2', '?page=3']) {
      const r = await html(`/console/erp/orders${page}`, bulk.agent.token);
      assert.equal(r.status, 200);
      const seen = new Set(idsOf(r.body));
      for (const id of theirs) {
        assert.ok(!seen.has(id), `page "${page || '1'}" leaked a colleague's order`);
      }
    }

    // And the manager, who does see the whole book, can reach them — otherwise
    // this test passes against a screen that shows nobody anything.
    const asManager = [
      ...idsOf((await html('/console/erp/orders', bulk.manager.token)).body),
      ...idsOf((await html('/console/erp/orders?page=2', bulk.manager.token)).body),
    ];
    assert.ok(theirs.every((id) => asManager.includes(id)), 'the manager sees them');
  });

  test('clients and products are paged and searchable too', async () => {
    const c = await html('/console/erp/clients', bulk.manager.token);
    assert.match(c.body, /data-testid="erp-clients-pager"/);
    assert.match(c.body, /id="filter-search"/);

    const p = await html('/console/erp/products', bulk.manager.token);
    assert.match(p.body, /data-testid="erp-products-pager"/);
    assert.match(p.body, /id="filter-search"/);

    const s = await html('/console/erp/shipments', bulk.manager.token);
    assert.match(s.body, /data-testid="erp-shipments-pager"/);
  });

  test('a product search narrows the catalogue', async () => {
    const name = `Findable ${uid()}`;
    const other = `Hidden ${uid()}`;
    await bulk.manager.api('POST', '/api/erp/products', { name, price: 10 });
    await bulk.manager.api('POST', '/api/erp/products', { name: other, price: 10 });

    const r = await html(
      `/console/erp/products?search=${encodeURIComponent(name)}`, bulk.manager.token,
    );
    assert.equal(r.status, 200);
    // Asserted on the NAMES, not on a count of `data-product-id`: that attribute
    // is also carried by the row's archive button and by the edit panel's submit,
    // so counting it counts controls rather than rows.
    assert.ok(r.body.includes(name), 'the match is shown');
    assert.ok(!r.body.includes(other), 'and the one that does not match is not');
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
    assert.ok(!/data-testid="erp-product-edit"/.test(r.body));

    assert.equal(
      (await acme.agent.api('POST', '/api/erp/products', { name: 'Nope' })).status,
      403,
    );
  });

  test('a manager gets the edit panel, holding what the server stored', async () => {
    // The panel's boxes are keyed on the server's values (D-06.3), so they must
    // be in the HTML rather than fetched after mount — a value that only exists
    // once JavaScript runs is unassertable here and unreadable to assistive
    // tech until somebody clicks.
    const name = `Editable ${uid()}`;
    await acme.manager.api('POST', '/api/erp/products', {
      name, sku: `sku-${uid()}`, price: 1200, costPrice: 700, packagingCost: 25,
    });

    const r = await html('/console/erp/products', acme.manager.token);
    assert.match(r.body, /data-testid="erp-product-edit"/);
    assert.match(r.body, /data-testid="product-edit-submit"/);
    assert.match(r.body, /id="edit-costPrice"/, 'the cost basis must be correctable');
    // The panel edits one product at a time and the picker is server-rendered,
    // so the new product is an OPTION; the boxes hold whichever is selected.
    assert.ok(r.body.includes(`>${name}</option>`), 'the product is offered for editing');
    assert.match(
      r.body,
      /id="edit-name"[^>]*value="[^"]+"/,
      'the boxes are prefilled from the database, not left blank',
    );
  });

  test('the archived view offers the edit panel too', async () => {
    // Archiving means "stop selling it", not "freeze it", and the route accepts
    // the edit either way — so withholding the control would hide a write the
    // API allows (D-06.2, the converse half).
    const id = (await acme.manager.api('POST', '/api/erp/products', {
      name: `Archived editable ${uid()}`, costPrice: 500,
    })).body.data.id as string;
    assert.equal((await acme.manager.api('DELETE', `/api/erp/products/${id}`)).status, 200);

    const r = await html('/console/erp/products?archived=true', acme.manager.token);
    assert.match(r.body, /data-testid="erp-product-edit"/);
  });

  test('a carrier naming an unavailable integration says so on its row', async () => {
    // LP.2. Said on the row rather than discovered when a parcel fails to book:
    // a carrier whose adapter this deployment does not have can neither book
    // nor poll, and a row that looks identical to a working one is how that
    // stays hidden until a customer asks where their parcel is.
    const good = (await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Works', code: `ok${uid()}`, adapter: 'mock',
    })).body.data;
    const stale = (await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Stale integration', code: `br${uid()}`, adapter: 'mock',
    })).body.data;
    // `yalidine`, not `zr`: LP.5 registered ZR Express, so it is a working
    // integration now and no longer an example of a missing one.
    await setCarrierAdapter(acme.tenantId, stale.id, 'yalidine');

    const r = await html('/console/erp/carriers', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-adapter="yalidine" data-known="false"/, 'the broken one is flagged');
    assert.ok(
      r.body.includes(`data-adapter="mock" data-known="true"`),
      'and the working one is not',
    );
    assert.ok(good.id && stale.id);
  });

  test('the edit panel offers no stock box, because the API refuses one', async () => {
    // D-06.2 in the other direction: a control the route would refuse is worse
    // than a missing one, because pressing it teaches the wrong model of where
    // stock comes from.
    await acme.manager.api('POST', '/api/erp/products', { name: `No stock box ${uid()}` });
    const r = await html('/console/erp/products', acme.manager.token);
    assert.ok(!/id="edit-stock"/.test(r.body), 'stock moves through the ledger, not a form box');
    assert.ok(!/id="edit-variants"/.test(r.body));
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

  test('the adapter picker offers every integration this deployment has, including ZR', async () => {
    // LP.5. The picker is built from the live registry, so registering an
    // adapter makes it selectable everywhere at once — this is the half that
    // turns "the ZR code exists" into "a manager can choose it".
    const r = await html('/console/erp/carriers', acme.manager.token, 'en');
    assert.match(r.body, /id="carrier-adapter"/);
    assert.match(r.body, /<option value="mock"/);
    assert.match(r.body, /<option value="zr"/, 'ZR Express must be selectable');
  });

  test('a webhook secret can be set, and the address to give the carrier is on the page', async () => {
    // The route has accepted `webhookSecret` since Phase 5 and no control ever
    // sent one, so a carrier's inbound updates could only ever be UNSIGNED —
    // the same tested-endpoint-with-no-caller defect this restoration keeps
    // finding. ZR signs every webhook, so a secret nobody can set is a
    // signature nobody can check.
    const r = await html('/console/erp/carriers', acme.manager.token, 'en');
    assert.match(r.body, /data-testid="carrier-webhook-url"/, 'the inbound address must be shown');
    assert.match(
      r.body,
      new RegExp(`value="/api/erp/webhooks/${await slugOf(acme.tenantId)}/delivery"`),
      'and it must be this tenant’s own endpoint',
    );

    // The write half: a secret set through the form is stored and masked.
    const created = (await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Signed Carrier', code: `sg${uid()}`, adapter: 'zr',
      webhookSecret: 'whsec_screen_test_value',
    })).body.data;
    assert.equal(created._hasCredentials, true, 'a webhook secret counts as a credential');

    const back = await html('/console/erp/carriers', acme.manager.token);
    assert.ok(!back.body.includes('whsec_screen_test_value'), 'and it never reaches the page');
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

/* -----------------------------------------------------------------------------
 * Phase 6.4a — the confirmation agent's queue
 *
 * The port of `apps/erp/agent.html`, which is the last thing that application
 * served with no replacement. The whole app is one gesture — tap to dial, tap
 * the outcome — so these assert that the gesture is present, correctly scoped,
 * and calls the routes the contract already covers.
 * -------------------------------------------------------------------------- */

describe('the agent has a queue to work', () => {
  let mineActive = '';
  let mineDone = '';

  const newOrder = async (body: Record<string, unknown> = {}) =>
    (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Queue Customer', phone: phone(), price: 2400, product: 'Queue Widget',
      wilaya: 'Alger', commune: 'Bab Ezzouar', ...body,
    })).body.data.id as string;

  before(async () => {
    if (skip) return;
    mineActive = await newOrder({ agentUserId: acme.agent.userId });
    mineDone = await newOrder({ agentUserId: acme.agent.userId });
    await acme.agent.api('POST', `/api/erp/orders/${mineDone}/call`, { result: 'confirmed' });
  });

  test('it renders inside the console shell, not as a second application', async () => {
    // The ERP's app had its own login screen and a stored server URL. Neither
    // ports: the platform session is a cookie on this origin.
    const r = await html('/console/erp/queue', acme.agent.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-queue"/);
    assert.match(r.body, /data-testid="product-switcher"/, 'inside the shell');
    assert.match(r.body, /data-nav="queue"/);
  });

  test('the queue holds what is still to be called, and not what is done', async () => {
    const r = await html('/console/erp/queue', acme.agent.token);
    assert.match(r.body, new RegExp(`data-order-id="${mineActive}"`), 'a pending order is missing');
    assert.ok(
      !new RegExp(`data-order-id="${mineDone}"`).test(r.body),
      'a confirmed order is still in the call queue',
    );
  });

  test('an agent sees only their own queue', async () => {
    // The same `orderScope` the list and the API use — not a second opinion.
    const theirs = await newOrder({ client: 'Not Mine', agentUserId: acme.other.userId });

    const asAgent = await html('/console/erp/queue', acme.agent.token);
    assert.ok(
      !new RegExp(`data-order-id="${theirs}"`).test(asAgent.body),
      "a colleague's order appeared in the agent's queue",
    );

    // A manager sees the whole book, which is what `seesWholeBook` means.
    const asManager = await html('/console/erp/queue', acme.manager.token);
    assert.match(asManager.body, new RegExp(`data-order-id="${theirs}"`));
  });

  test('the dial control is a real tel: link carrying the number', async () => {
    // The gesture the whole app exists for. An anchor, so the phone dials even
    // with no network — `call-start` rides along rather than gating it.
    const detail = await acme.agent.api('GET', `/api/erp/orders/${mineActive}`);
    const number = detail.body.data.phone as string;

    const r = await html('/console/erp/queue', acme.agent.token);
    const dial = r.body.match(
      new RegExp(`<a[^>]*data-testid="queue-dial"[^>]*data-order-id="${mineActive}"[^>]*>`),
    )?.[0] ?? '';
    assert.notEqual(dial, '', 'no dial control on the card');
    assert.match(dial, new RegExp(`href="tel:${number}"`), `dial rendered as ${dial}`);
  });

  test('the result buttons are the same vocabulary the API accepts', async () => {
    const r = await html('/console/erp/queue', acme.agent.token);
    const offered = [
      ...new Set(
        [...r.body.matchAll(/data-result="([^"]+)"/g)].map((m) => m[1]),
      ),
    ].sort();
    assert.deepEqual(offered, [...CALL_RESULTS].sort());
    assert.ok(!offered.includes('pending'), 'offered a result the API would refuse');
  });

  test('the note types are on the card too, without a tap', async () => {
    // Hidden, not unmounted (D-06.4) — the vocabulary is in the document.
    const r = await html('/console/erp/queue', acme.agent.token);
    assert.match(r.body, /data-testid="queue-note-panel"/);
    for (const type of NOTE_TYPES) {
      assert.match(r.body, new RegExp(`<option value="${type}"`), `no note type ${type}`);
    }
  });

  test('overdue is judged against the tenant’s own alert threshold', async () => {
    // The ERP hardcoded 60 minutes in three places. The platform has the
    // setting the overdue sweep already uses, so shortening it on the
    // automation screen shortens it here too.
    assert.equal(
      (await acme.manager.api('PUT', '/api/erp/settings', { alertMinutes: 10080 })).status,
      200,
      'could not widen the threshold',
    );
    const wide = await html('/console/erp/queue', acme.agent.token);
    assert.ok(!/data-overdue="true"/.test(wide.body), 'nothing should be overdue at a week');

    assert.equal(
      (await acme.manager.api('PUT', '/api/erp/settings', { alertMinutes: 1 })).status,
      200,
    );
    const tight = await html('/console/erp/queue', acme.agent.token);
    assert.match(tight.body, /data-overdue="true"/, 'a never-called order should be overdue at 1m');
    assert.match(tight.body, /data-testid="queue-overdue"/);
  });

  test('logging a call from the queue moves the order out of it', async () => {
    // Pressing a result button is exactly this request; the queue then shows
    // the server's answer rather than a guess at it (D-06.3).
    const id = await newOrder({ agentUserId: acme.agent.userId });
    const before = await html('/console/erp/queue', acme.agent.token);
    assert.match(before.body, new RegExp(`data-order-id="${id}"`));

    assert.equal(
      (await acme.agent.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' })).status,
      200,
    );

    const after = await html('/console/erp/queue', acme.agent.token);
    assert.ok(
      !new RegExp(`data-order-id="${id}"`).test(after.body),
      'a confirmed order is still in the call queue',
    );
  });

  test('a reader without erp:orders:write gets no queue at all', async () => {
    // A queue you cannot work is the order list, which already exists.
    const reader = await makeMember(acme.tenantId, { role: 'MEMBER' });
    assert.equal((await page('/console/erp/queue', reader.token)).status, 404);

    const r = await html('/console/erp', reader.token);
    assert.ok(!/data-nav="queue"/.test(r.body), 'no link to a screen that would 404');
  });

  /* --- 6.4b --------------------------------------------------------------- */

  test('the filters round-trip through the URL and work without JavaScript', async () => {
    // A plain GET form, read by the SAME `orderFilters` the API uses — so the
    // screen and the endpoint cannot interpret `?status=` differently.
    const r = await html('/console/erp/queue', acme.agent.token);
    const form = r.body.match(/<form[^>]*data-testid="erp-queue-filters"[^>]*>/)?.[0] ?? '';
    assert.notEqual(form, '', 'no filter form on the queue');
    // A GET form, so the filters are in the URL and survive a reload. Matched
    // without assuming attribute order, which is React's business and not a
    // property worth pinning.
    assert.match(form, /method="get"/i, `filters rendered as ${form}`);
    assert.match(r.body, /name="status"/);
    assert.match(r.body, /name="search"/);
  });

  test('filtering to a terminal status shows settled orders, without call controls', async () => {
    // The queue defaults to work still to be done; a settled order appears only
    // when somebody asks for one — to answer "where is my parcel?". The ERP's
    // card dropped the dial and the results there and kept the note.
    const r = await html('/console/erp/queue?status=confirmed', acme.agent.token);
    assert.equal(r.status, 200);
    assert.match(r.body, new RegExp(`data-order-id="${mineDone}"`), 'the confirmed order is missing');
    assert.ok(
      !new RegExp(`data-testid="queue-dial"[^>]*data-order-id="${mineDone}"`).test(r.body),
      'a settled order was offered the dial',
    );
    assert.ok(
      !new RegExp(`data-result="[^"]+"[^>]*data-order-id="${mineDone}"`).test(r.body),
      'a settled order was offered the result buttons',
    );
    // The note stays, as it did in the ERP.
    assert.match(r.body, /data-testid="queue-note-toggle"/);
  });

  test('search narrows the queue through the same filter the API uses', async () => {
    const needle = `Findable${uid()}`;
    const found = await newOrder({ client: needle, agentUserId: acme.agent.userId });

    const hit = await html(
      `/console/erp/queue?search=${encodeURIComponent(needle)}`, acme.agent.token,
    );
    assert.match(hit.body, new RegExp(`data-order-id="${found}"`));
    assert.ok(
      !new RegExp(`data-order-id="${mineActive}"`).test(hit.body),
      'search did not narrow the queue',
    );
  });

  test('a parcel’s state is on the card once one exists', async () => {
    const carrierCode = `qc${uid()}`;
    await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Queue Carrier', code: carrierCode, adapter: 'mock',
    });
    const id = await newOrder({ agentUserId: acme.agent.userId, carrierCode });

    const before = await html('/console/erp/queue', acme.agent.token);
    assert.ok(
      !new RegExp(`data-order-id="${id}"[\\s\\S]{0,2000}?data-testid="queue-delivery"`).test(before.body),
      'a delivery line appeared before anything was booked',
    );

    const booked = await acme.manager.api('POST', `/api/erp/orders/${id}/shipment`, {});
    assert.ok([200, 201].includes(booked.status), `booking answered ${booked.status}`);

    const after = await html('/console/erp/queue', acme.agent.token);
    assert.match(after.body, /data-testid="queue-delivery"/);
  });

  test('the follow-up panel offers the control the route now backs', async () => {
    // 6.4b asserted this route's ABSENCE, so that the gap would announce its
    // own closure. 6.4c closed it: the panel has a resolve control, and it is
    // the same one-request-per-press shape as every other write on the queue.
    const orderId = await newOrder({ agentUserId: acme.agent.userId });
    const task = await makeFollowupTask(acme.tenantId, {
      orderId, agentUserId: acme.agent.userId,
    });

    const r = await html('/console/erp/queue', acme.agent.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-queue-followup"/, 'no follow-up panel');
    assert.match(
      r.body,
      new RegExp(`data-testid="followup-resolve"[^>]*data-followup-id="${task.id}"`),
      'no resolve control for the agent’s own task',
    );

    // And pressing it is this request.
    assert.equal(
      (await acme.agent.api('POST', `/api/erp/followup/tasks/${task.id}/resolve`, {})).status,
      200,
    );

    // The panel then shows the server's answer: a done task is not outstanding.
    const after = await html('/console/erp/queue', acme.agent.token);
    assert.ok(
      !new RegExp(`data-followup-id="${task.id}"`).test(after.body),
      'a resolved task is still listed as outstanding',
    );
  });

  test('the panel lists the states that still need a person', async () => {
    // `open | done | overdue` is the schema's vocabulary and what the follow-up
    // dashboard already counts. An OVERDUE task hidden from the agent's panel is
    // precisely the one that goes unactioned, so both unfinished states show.
    const orderId = await newOrder({ agentUserId: acme.agent.userId });
    const task = await makeFollowupTask(acme.tenantId, {
      orderId, agentUserId: acme.agent.userId, type: 'escalation',
    });
    await acme.manager.api('POST', `/api/erp/followup/tasks/${task.id}/resolve`, {});

    const r = await html('/console/erp/queue', acme.agent.token);
    assert.ok(
      !new RegExp(`data-followup-id="${task.id}"`).test(r.body),
      'a done task is still on the panel',
    );
  });

  test('another tenant’s queue is not reachable through this one', async () => {
    const beta = await makeErpTenant('queue-beta');
    const betaOrder = (await beta.manager.api('POST', '/api/erp/orders', {
      client: 'Beta Queue', phone: phone(),
    })).body.data.id as string;

    const r = await html('/console/erp/queue', acme.manager.token);
    assert.ok(
      !new RegExp(`data-order-id="${betaOrder}"`).test(r.body),
      "another tenant's order reached this queue",
    );
  });
});

/* -----------------------------------------------------------------------------
 * LP.12 — the accountability surface: a counter that only rose, a flag nobody
 * could see, a payroll report nothing rendered, and an audit trail with no
 * screen
 * -------------------------------------------------------------------------- */

describe('the missed-order counter can finally be reset (R14)', () => {
  test('it is cleared, the previous value is reported, and an audit row is written', async () => {
    // THE TRAP THIS CLOSES: the overdue sweep raises `missedOrders` and
    // `autoSuspend` locks the account out at `suspendThreshold`, and NOTHING
    // could lower it — so every agent eventually trips auto-suspension with no
    // way back except editing a ProductSetting row by hand. It is latent, and
    // uptime is what triggers it.
    const staged = await makeErpTenant(`missed-${uid()}`);

    // Stage the state the sweep produces. There is no route that raises the
    // counter directly, which is exactly why it needs staging.
    await setAgentMissed(staged.tenantId, staged.agent.userId, 4);

    const before = await staged.manager.api('GET', '/api/erp/agents');
    const row = before.body.data.items.find((a: { userId: string }) => a.userId === staged.agent.userId);
    assert.equal(row.missedOrders, 4);

    const r = await staged.manager.api(
      'POST', `/api/erp/agents/${staged.agent.userId}/reset-missed`, {},
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.data.missedOrders, 0);
    assert.equal(r.body.data.was, 4, 'the reset does not say what it forgave');

    const after = await staged.manager.api('GET', '/api/erp/agents');
    assert.equal(
      after.body.data.items.find((a: { userId: string }) => a.userId === staged.agent.userId).missedOrders,
      0,
    );

    const audit = await staged.manager.api(
      'GET', `/api/erp/audit?entity=agent&entityId=${staged.agent.userId}`,
    );
    assert.ok(
      audit.body.data.items.some((e: { action: string }) => e.action === 'reset-missed'),
      'forgiving an accountability counter left no record',
    );
  });

  test('it does NOT reactivate a suspended account', async () => {
    // Two decisions, not one. A supervisor may want the count forgiven and the
    // account still locked while they have a conversation.
    const staged = await makeErpTenant(`missed-susp-${uid()}`);
    await setAgentMissed(staged.tenantId, staged.agent.userId, 9);
    await staged.manager.api('POST', `/api/erp/agents/${staged.agent.userId}/suspend`, {});

    const r = await staged.manager.api(
      'POST', `/api/erp/agents/${staged.agent.userId}/reset-missed`, {},
    );
    assert.equal(r.body.data.suspended, true, 'the lockout was silently lifted');
  });

  test('somebody who is not on this team is a 404, and an agent is refused', async () => {
    assert.equal(
      (await acme.manager.api('POST', '/api/erp/agents/not-a-user/reset-missed', {})).status,
      404,
    );
    assert.equal(
      (await acme.agent.api('POST', `/api/erp/agents/${acme.other.userId}/reset-missed`, {})).status,
      403,
    );
  });

  test('the control is offered only where there is something to reset', async () => {
    // D-06.2 is as much about not offering a no-op as about not offering a
    // refusal: a counter already at zero has no action behind the button.
    const staged = await makeErpTenant(`missed-ui-${uid()}`);
    const clean = await html('/console/erp/agents', staged.manager.token);
    assert.equal(clean.status, 200);
    assert.doesNotMatch(clean.body, /data-testid="agent-reset-missed"/);

    await setAgentMissed(staged.tenantId, staged.agent.userId, 3);
    const dirty = await html('/console/erp/agents', staged.manager.token);
    assert.match(dirty.body, /data-testid="agent-reset-missed"/);
    assert.match(dirty.body, /data-missed="3"/);
  });
});

describe('the suspicious-call flag finally has a reader (R11)', () => {
  test('a short confirmed call is flagged, and the order is findable by it', async () => {
    // The whole point of `minCallSeconds` is catching somebody who marks orders
    // confirmed without really phoning. The flag was computed and stored on
    // every call and surfaced NOWHERE.
    const staged = await makeErpTenant(`flag-${uid()}`);
    await staged.manager.api('PUT', '/api/erp/settings', { minCallSeconds: 3600 });

    const created = await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Rushed', phone: phone(), price: 1000, agentUserId: staged.agent.userId,
    });
    const id = created.body.data.id;
    await staged.agent.api('POST', `/api/erp/orders/${id}/call-start`, {});
    await staged.agent.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' });

    const flagged = await staged.manager.api('GET', '/api/erp/orders?suspicious=true');
    assert.ok(
      flagged.body.data.items.some((o: { id: string }) => o.id === id),
      'the filter does not find an order carrying a flagged call',
    );

    // And it narrows: an order with no flagged call is not in that list.
    const plain = await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Unrushed', phone: phone(), price: 1000,
    });
    const still = await staged.manager.api('GET', '/api/erp/orders?suspicious=true');
    assert.ok(
      !still.body.data.items.some((o: { id: string }) => o.id === plain.body.data.id),
      'the filter is not filtering',
    );
  });

  test('the roster shows a per-agent count that links to those orders', async () => {
    const staged = await makeErpTenant(`flag-ui-${uid()}`);
    await staged.manager.api('PUT', '/api/erp/settings', { minCallSeconds: 3600 });
    const created = await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Rushed Two', phone: phone(), price: 1000, agentUserId: staged.agent.userId,
    });
    await staged.agent.api('POST', `/api/erp/orders/${created.body.data.id}/call-start`, {});
    await staged.agent.api('POST', `/api/erp/orders/${created.body.data.id}/call`, { result: 'confirmed' });

    const r = await html('/console/erp/agents', staged.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-flagged="1"/);
    assert.match(r.body, /suspicious=true/, 'the count does not lead anywhere');
  });

  test('the filter is offered on the order list, in the one filter vocabulary', async () => {
    // D-LP.3: it lives in `orderFilters` rather than on an Alerts screen of its
    // own, so "flagged calls for Alger this week" can be narrowed further,
    // exported, or opened in analytics — none of which a separate screen could.
    const r = await html('/console/erp/orders', acme.manager.token);
    assert.match(r.body, /name="suspicious"/);
  });
});

describe('the payroll report is rendered somewhere (N11)', () => {
  test('the roster shows what each person is owed for the current month', async () => {
    // `GET /api/erp/agents/payroll` existed and NOTHING rendered it, so the
    // numbers somebody is actually paid were reachable only by hand-typing a URL.
    const staged = await makeErpTenant(`pay-${uid()}`);
    await staged.manager.api('PATCH', `/api/erp/agents/${staged.agent.userId}`, {
      baseSalaryMonthly: 48000, payPerConfirmedOrder: 0, payPerDeliveredOrder: 0,
    });

    const r = await html('/console/erp/agents', staged.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, new RegExp(`data-pay="${staged.agent.userId}"`));
    // A whole month under the aligned rule is the salary unchanged — the same
    // rule a rent is prorated by since LP.16b, so the two cannot disagree.
    assert.match(r.body, /48[\s  ,.]?000/);
  });
});

describe('an order carries its own audit trail (N12)', () => {
  test('a manager sees who changed what; the trail is not invented', async () => {
    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Audited', phone: phone(), price: 2000,
    });
    const id = created.body.data.id;
    await acme.manager.api('PATCH', `/api/erp/orders/${id}`, { managerNote: 'checked' });

    const r = await html(`/console/erp/orders/${id}`, acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="order-audit"/);
    assert.match(r.body, /data-audit-action="/, 'the trail rendered empty for an order that was edited');
  });

  test('the screen follows the ROUTE’s permission, not a second opinion', async () => {
    // D-06.2: the section is gated on `erp:audit:read`, which is what
    // `GET /api/erp/audit` checks — and which every member holds by role glob,
    // because it is not on the SENSITIVE list. So an agent DOES see it, and the
    // screen agrees with the API rather than inventing a stricter rule.
    //
    // Whether `erp:audit:read` SHOULD be sensitive is an authorization question
    // of the same shape as N16, not a rendering one: it is recorded rather than
    // decided here.
    const mine = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Agent Order', phone: phone(), price: 500, agentUserId: acme.agent.userId,
    });
    const id = mine.body.data.id;

    const viaApi = await acme.agent.api('GET', `/api/erp/audit?entity=order&entityId=${id}`);
    const r = await html(`/console/erp/orders/${id}`, acme.agent.token);
    assert.equal(r.status, 200, 'the agent must still see their own order');
    assert.equal(
      /data-testid="order-audit"/.test(r.body),
      viaApi.status === 200,
      'the screen and the route disagree about who may read the trail',
    );
  });
});
