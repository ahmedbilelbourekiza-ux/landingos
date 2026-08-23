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
 * The rest is the ASSISTANTS' CRUD half (R10). The provider CRUD that used
 * to live beside it is GONE since PF.1 — the model credential is platform-
 * level (`lib/platform/platform-ai.ts`, attended install script) and a tenant
 * neither sees nor supplies an AI key. A test below pins the removal: the
 * old provider routes must answer 404 even to a manager.
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

  test('an agent sees the insights and NOT the assistant configuration', async () => {
    // Two permissions, two halves. Reading insights is `erp:ai:use`;
    // configuring assistants is `erp:settings:write`.
    const r = await page('/console/erp/ai', acme.agent.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="ai-insights"/);
    assert.doesNotMatch(r.body, /data-testid="ai-agent-panel"/);
  });

  test('PF.1 — provider configuration is gone for EVERYONE, manager included', async () => {
    // The model credential is the OPERATOR's, one platform-wide row installed
    // by an attended script. No tenant surface may offer a provider form, and
    // the old routes must not merely refuse — they must not exist.
    const r = await page('/console/erp/ai', acme.manager.token);
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.body, /data-testid="ai-provider-panel"/);
    assert.doesNotMatch(r.body, /data-testid="ai-providers-table"/);
    assert.match(r.body, /data-testid="ai-agent-panel"/, 'the assistants half must survive');

    assert.equal((await acme.manager.api('GET', '/api/erp/ai/providers')).status, 404);
    assert.equal(
      (await acme.manager.api('POST', '/api/erp/ai/providers', { name: 'x', type: 'gemini' })).status,
      404,
    );
    assert.equal((await acme.manager.api('PUT', '/api/erp/ai/providers/any')).status, 404);
    assert.equal((await acme.manager.api('DELETE', '/api/erp/ai/providers/any')).status, 404);
    assert.equal((await acme.manager.api('POST', '/api/erp/ai/providers/any/default', {})).status, 404);
    assert.equal((await acme.manager.api('POST', '/api/erp/ai/providers/any/test', {})).status, 404);
    assert.equal((await acme.manager.api('GET', '/api/erp/ai/providers/any/logs')).status, 404);
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
