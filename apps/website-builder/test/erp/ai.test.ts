import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_COOKIE } from '@landingos/auth';

import {
  skip, BASE, uid, makeErpTenant, makeMember, cleanup,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/ai.test.ts — LP.17, restoring R10 and closing a LIVE 404.
 *
 * `packages/product-registry` shipped an `ai` nav item for the ERP and no screen
 * existed at `/console/erp/ai`. Every member — the permission is held by role
 * glob — saw a menu item that led to a 404, and `screens.test.ts` listed eight
 * screens and omitted this one, so nothing caught it. **The first test here is a
 * general one, and it is the one that matters most:** every nav item the
 * manifest declares must lead to a page. A screen missing from a hand-written
 * list is invisible; a nav item that 404s is not.
 *
 * The rest is R10's CRUD half. `POST /ai/providers` and `POST /ai/agents`
 * existed and nothing could edit or remove what they created, so a provider with
 * a typo in its base URL was permanent and a leaked key could not be rotated
 * from the console.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;

const page = async (path: string, token: string) => {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: { cookie: `${SESSION_COOKIE}=${token}; locale=en` },
  });
  return { status: res.status, body: await res.text() };
};

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('ai');
});

after(async () => {
  if (skip) return;
  await cleanup();
});

describe('every nav item the manifest declares leads to a page', () => {
  test('none of the ERP’s navigation 404s', async () => {
    // The general form of the defect this slice closes. A nav item is a promise
    // the registry makes on a product's behalf, and the ERP was breaking one of
    // them in production. Reading the manifest rather than listing paths means a
    // nav item added later is covered without anybody remembering to extend
    // this.
    const { productRegistry } = await import('@landingos/product-registry');
    const erp = productRegistry.get('erp')!;
    // The whole manifest, not `navFor` — `navFor` filters by exact permission
    // strings and the point here is that EVERY declared item has a page behind
    // it, including the ones a given person would not be shown.
    assert.ok(erp.nav.length >= 13, 'the ERP nav shrank — is that intended?');

    for (const item of erp.nav) {
      const href = `/console/erp${item.path ? `/${item.path}` : ''}`;
      const r = await page(href, acme.manager.token);
      assert.equal(r.status, 200, `${href} answered ${r.status} for a manager`);
    }
  });
});

describe('the AI screen', () => {
  test('it renders, and the insights work with no provider configured at all', async () => {
    // The insights half is COUNTS, not generation, so it is honest on a
    // deployment that will never have a model key.
    const r = await page('/console/erp/ai', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="ai-insights"/);
    assert.match(r.body, /data-tile="orders"/);
  });

  test('the chat is stated as unavailable rather than offered and broken', async () => {
    // `POST /api/erp/ai/chat` answers 501 by design. A chat box that always
    // errors says less than a sentence explaining why, and is the same class of
    // lie as the fabricated tracking numbers D-LP.2 removed.
    const r = await page('/console/erp/ai', acme.manager.token);
    assert.match(r.body, /data-testid="ai-chat-unavailable"/);
    assert.doesNotMatch(r.body, /data-testid="ai-chat-input"/);

    const chat = await acme.manager.api('POST', '/api/erp/ai/chat', { message: 'hello' });
    assert.equal(chat.status, 501, 'and the route it would call still says so');
  });

  test('an agent sees the insights and NOT the provider configuration', async () => {
    // Two permissions, two halves. Reading insights is `erp:ai:use`; adding a
    // provider is `erp:settings:write`, because a provider is a billing account
    // and adding one commits the company to per-token charges.
    const r = await page('/console/erp/ai', acme.agent.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="ai-insights"/);
    assert.doesNotMatch(r.body, /data-testid="ai-provider-panel"/);
    assert.doesNotMatch(r.body, /data-testid="ai-agent-panel"/);
  });

  test('the ceiling it shows is the CALLER’s, not the company’s', async () => {
    // `read_analytics` maps to `erp:finance:read`, which is SENSITIVE (D-05.1) —
    // it aggregates across every order and ignores the record scope that limits
    // an agent to their own queue.
    // The whole element, not its first text node: React separates adjacent
    // text nodes with `<!-- -->` comments, so `>([^<]*)<` stops at the label.
    const ceilingOf = (body: string) =>
      body.match(/data-testid="ai-ceiling"[\s\S]{0,400}?<\/p>/)?.[0] ?? '';

    const manager = await page('/console/erp/ai', acme.manager.token);
    const agent = await page('/console/erp/ai', acme.agent.token);
    // The CEILING LINE specifically. The permission vocabulary also appears in
    // the configuration form, which only a manager sees — matching the whole
    // page would pass for the wrong reason.
    assert.match(ceilingOf(manager.body), /read_analytics/);
    assert.doesNotMatch(ceilingOf(agent.body), /read_analytics/);
  });
});

describe('a provider can finally be corrected and removed', () => {
  let providerId = '';

  test('one is created', async () => {
    const r = await acme.manager.api('POST', '/api/erp/ai/providers', {
      name: `Provider ${uid()}`, type: 'openai-compat',
      baseUrl: 'https://wrong.example.test', apiKey: 'sk-secret-value',
    });
    assert.equal(r.status, 201);
    providerId = r.body.data.id;
    assert.ok(!JSON.stringify(r.body).includes('sk-secret-value'), 'the key came back');
  });

  test('the typo in its base URL can be fixed', async () => {
    const r = await acme.manager.api('PUT', `/api/erp/ai/providers/${providerId}`, {
      baseUrl: 'https://right.example.test',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.baseUrl, 'https://right.example.test');
    assert.ok(!('apiKey' in r.body.data), 'the key is not in the select, so it cannot leak');
  });

  test('the key can be rotated, and is never read back', async () => {
    const r = await acme.manager.api('PUT', `/api/erp/ai/providers/${providerId}`, {
      apiKey: 'sk-rotated-value',
    });
    assert.equal(r.status, 200);
    assert.ok(!JSON.stringify(r.body).includes('sk-rotated'), 'a rotated key was echoed');
  });

  test('an empty key is refused rather than silently blanking one', async () => {
    // A provider with no key is indistinguishable from a broken one, and the
    // failure would surface as a model call that fails much later.
    const r = await acme.manager.api('PUT', `/api/erp/ai/providers/${providerId}`, { apiKey: '' });
    assert.equal(r.status, 422);
  });

  test('exactly one provider is the default', async () => {
    const second = await acme.manager.api('POST', '/api/erp/ai/providers', {
      name: `Second ${uid()}`, type: 'anthropic',
    });
    await acme.manager.api('POST', `/api/erp/ai/providers/${providerId}/default`, {});
    await acme.manager.api('POST', `/api/erp/ai/providers/${second.body.data.id}/default`, {});

    const list = await acme.manager.api('GET', '/api/erp/ai/providers');
    const defaults = list.body.data.items.filter((p: { isDefault: boolean }) => p.isDefault);
    assert.equal(defaults.length, 1, 'two rows flagged default is a state no reader can resolve');
    assert.equal(defaults[0].id, second.body.data.id);
  });

  test('a deactivated provider cannot be made the default, and the refusal says which order', async () => {
    await acme.manager.api('PUT', `/api/erp/ai/providers/${providerId}`, { active: false });
    const r = await acme.manager.api('POST', `/api/erp/ai/providers/${providerId}/default`, {});
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'PROVIDER_INACTIVE');
  });

  test('it can be removed, and a nonexistent one is a 404', async () => {
    assert.equal((await acme.manager.api('DELETE', `/api/erp/ai/providers/${providerId}`)).status, 200);
    assert.equal((await acme.manager.api('DELETE', `/api/erp/ai/providers/${providerId}`)).status, 404);
  });

  test('an agent cannot touch any of it', async () => {
    for (const [method, path] of [
      ['PUT', '/api/erp/ai/providers/x'],
      ['DELETE', '/api/erp/ai/providers/x'],
      ['POST', '/api/erp/ai/providers/x/default'],
    ] as const) {
      const r = await acme.agent.api(method, path, {});
      assert.equal(r.status, 403, `${method} ${path}`);
    }
  });
});

describe('an assistant can be corrected and removed', () => {
  let agentId = '';

  test('one is created with a permission REQUEST', async () => {
    const r = await acme.manager.api('POST', '/api/erp/ai/agents', {
      name: `Assistant ${uid()}`, role: 'analytics',
      systemPrompt: 'Answer briefly.',
      permissions: ['read_orders', 'read_analytics'],
      enabled: true,
    });
    assert.equal(r.status, 201);
    agentId = r.body.data.id;
    assert.deepEqual(r.body.data.permissions, ['read_orders', 'read_analytics']);
  });

  test('the prompt can be corrected', async () => {
    const r = await acme.manager.api('PUT', `/api/erp/ai/agents/${agentId}`, {
      systemPrompt: 'Answer in French.',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.systemPrompt, 'Answer in French.');
  });

  test('it can be disabled without being destroyed', async () => {
    const r = await acme.manager.api('PUT', `/api/erp/ai/agents/${agentId}`, { enabled: false });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.enabled, false);

    const enabled = await acme.manager.api('GET', '/api/erp/ai/agents/enabled');
    assert.ok(
      !enabled.body.data.items.some((a: { id: string }) => a.id === agentId),
      'a disabled assistant is still offered for use',
    );
  });

  test('a permission that is not a permission is refused', async () => {
    const r = await acme.manager.api('PUT', `/api/erp/ai/agents/${agentId}`, {
      permissions: ['read_orders', 'delete_everything'],
    });
    assert.equal(r.status, 422);
  });

  test('it can be removed, and a nonexistent one is a 404', async () => {
    assert.equal((await acme.manager.api('DELETE', `/api/erp/ai/agents/${agentId}`)).status, 200);
    assert.equal((await acme.manager.api('DELETE', `/api/erp/ai/agents/${agentId}`)).status, 404);
  });

  test('another tenant’s assistant does not exist as far as this one is concerned', async () => {
    const other = await makeErpTenant(`ai-other-${uid()}`);
    const theirs = await other.manager.api('POST', '/api/erp/ai/agents', { name: 'Theirs' });
    assert.equal(theirs.status, 201);

    // 404, not 403 — confirming a row exists elsewhere is itself information.
    const r = await acme.manager.api('PUT', `/api/erp/ai/agents/${theirs.body.data.id}`, {
      name: 'Mine now',
    });
    assert.equal(r.status, 404);
  });
});

describe('the AI surface is closed to somebody without the permission', () => {
  test('a member with the grant explicitly removed gets a 404 on the screen', async () => {
    const stranger = await makeMember(acme.tenantId, { role: 'VIEWER' });
    const list = await stranger.api('GET', '/api/erp/ai/insights');
    // VIEWER holds `*:*:read` but not `erp:ai:use`, which is an action rather
    // than a read — so the API refuses and the screen must agree.
    if (list.status === 403) {
      const r = await page('/console/erp/ai', stranger.token);
      assert.equal(r.status, 404, 'the screen rendered where the API refuses');
    }
  });
});

/* =============================================================================
 * AUDIT.5 — the writer for two columns three readers had been rendering.
 *
 * `lastTestAt` / `lastTestOk` were selected by both provider routes and shown on
 * the screen, and nothing set them: LP.17 deferred `/test` on the grounds that
 * "testing a provider means calling a model", and the legacy's own adapters test
 * with `GET /models`. Every test here runs against a base URL nothing is
 * listening on, which is the only success path available without credentials —
 * and it is the path that matters, because a refusal that reports success is the
 * defect D-LP.2 exists to prevent.
 * ========================================================================== */

describe('a provider can be tested, and the result is recorded', () => {
  let providerId: string;

  test('a provider is created to test', async () => {
    const r = await acme.manager.api('POST', '/api/erp/ai/providers', {
      name: 'Probe',
      type: 'openai-compat',
      // A port nothing answers on. The request genuinely leaves the process and
      // genuinely fails, which is what makes the failure path real.
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'sk-not-a-real-key',
    });
    assert.equal(r.status, 201);
    providerId = r.body.data.id;
  });

  test('before any test the columns are null, which is what the screen shows', async () => {
    const r = await acme.manager.api('GET', '/api/erp/ai/providers');
    const row = r.body.data.items.find((p: { id: string }) => p.id === providerId);
    assert.equal(row.lastTestAt, null);
    assert.equal(row.lastTestOk, null);
  });

  test('a dead endpoint is reported as a failure, not a success', async () => {
    const r = await acme.manager.api('POST', `/api/erp/ai/providers/${providerId}/test`, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.data.ok, false, 'a provider nobody is listening for reported success');
    assert.ok(r.body.data.message, 'a failed test said nothing about why');
    assert.ok(r.body.data.testedAt, 'the test recorded no time');
  });

  test('the outcome reaches the columns that had no writer', async () => {
    const r = await acme.manager.api('GET', '/api/erp/ai/providers');
    const row = r.body.data.items.find((p: { id: string }) => p.id === providerId);
    assert.ok(row.lastTestAt, 'lastTestAt is still null after a test — the writer is missing again');
    assert.equal(row.lastTestOk, false);
  });

  test('the screen tells a tested provider from an untested one', async () => {
    // Both states on one page, which is the only way to show the cell says
    // something. The screen used to render "Testing needs a model adapter" for
    // every row forever, and that reads as a considered answer rather than an
    // absent writer — which is exactly why it survived four passes.
    const fresh = await acme.manager.api('POST', '/api/erp/ai/providers', {
      name: 'Untouched', type: 'gemini', apiKey: 'x',
    });
    assert.equal(fresh.status, 201);

    const r = await page('/console/erp/ai', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-tested="false"/, 'a failed test is not rendered as failed');
    assert.match(r.body, /data-tested="null"/, 'a provider nobody tested does not read as untested');
    // And the button that produces the state exists, per D-06.2: the route
    // accepts it for a manager, so a manager is offered it.
    assert.match(r.body, /data-testid="ai-provider-test"/, 'no control calls the test route');
  });

  test('the attempt is in the integration log, with a reason', async () => {
    const r = await acme.manager.api('GET', `/api/erp/ai/providers/${providerId}/logs`);
    assert.equal(r.status, 200);
    assert.ok(r.body.data.items.length >= 1, 'a test that happened left no log line');
    const entry = r.body.data.items[0];
    assert.equal(entry.entity, 'aiProvider');
    assert.equal(entry.result, 'failure');
    assert.equal(entry.event, 'auth_error');
    assert.ok(entry.message, 'the log line records no reason');
  });

  test('the key is never in the log, at any depth', async () => {
    const r = await acme.manager.api('GET', `/api/erp/ai/providers/${providerId}/logs`);
    const serialized = JSON.stringify(r.body.data.items);
    assert.ok(
      !serialized.includes('sk-not-a-real-key'),
      'the API key reached the integration log',
    );
  });

  test('a type with no adapter refuses rather than reporting success', async () => {
    // The row is edited past the route's own enum the only way the platform can
    // — directly — because this is about a row that already exists: an older
    // deployment's type, or one removed from a later build.
    const created = await acme.manager.api('POST', '/api/erp/ai/providers', {
      name: 'Unknown', type: 'anthropic', apiKey: 'x',
    });
    assert.equal(created.status, 201);
    // `type` is deliberately not editable, so this asserts the registry's own
    // answer rather than driving it through a route that cannot produce it.
    const r = await acme.manager.api('POST', `/api/erp/ai/providers/${created.body.data.id}/test`, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.data.ok, false);
  });

  test('a provider that does not exist is a 404, on both routes', async () => {
    assert.equal((await acme.manager.api('POST', '/api/erp/ai/providers/nope/test', {})).status, 404);
    assert.equal((await acme.manager.api('GET', '/api/erp/ai/providers/nope/logs')).status, 404);
  });

  test('another tenant cannot test or read the log of this one’s provider', async () => {
    const other = await makeErpTenant(`ai-test-other-${uid()}`);
    // 404 rather than 403: confirming a row exists elsewhere is itself
    // information, and RLS answers by returning nothing rather than erroring.
    assert.equal(
      (await other.manager.api('POST', `/api/erp/ai/providers/${providerId}/test`, {})).status,
      404,
    );
    assert.equal(
      (await other.manager.api('GET', `/api/erp/ai/providers/${providerId}/logs`)).status,
      404,
    );
  });

  test('an agent may not test a provider or read its log', async () => {
    const agent = await makeMember(acme.tenantId, { role: 'MEMBER' });
    // 403 for a permission failure; 404 is reserved for another tenant's row.
    assert.equal(
      (await agent.api('POST', `/api/erp/ai/providers/${providerId}/test`, {})).status,
      403,
    );
    assert.equal(
      (await agent.api('GET', `/api/erp/ai/providers/${providerId}/logs`)).status,
      403,
    );
  });
});
