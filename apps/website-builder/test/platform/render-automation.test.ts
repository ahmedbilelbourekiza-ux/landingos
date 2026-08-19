import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

import {
  buildAddDomainRequest,
  buildGetDomainRequest,
  storeRenderCredential,
  readRenderCredential,
  RENDER_CREDENTIAL_KEY,
} from '../../src/lib/platform/render-domains.ts';

/* =============================================================================
 * LB.14c option (b) — the Render domain automation, against a LOCAL STUB.
 *
 * ⚠ Nothing here contacts Render. The credential row's own apiBase points at
 * an ephemeral local server (the AiProvider/ZR-carrier pattern), so the suite
 * pins the whole path — encrypted storage, the verified+primary trigger, the
 * bearer wire shape, the bounded certificate poll, the recorded state, and
 * the silence when unconfigured — with zero external calls and no real key
 * anywhere.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;

const stamp = Date.now();

const CFG = {
  apiKey: 'rnd-test-secret-14c',
  serviceId: 'srv-stub',
  apiBase: 'http://127.0.0.1:9/api',
};

describe('the Render wire shapes (pure)', () => {
  test('add: POST custom-domains with the bearer key and the hostname', () => {
    const wire = buildAddDomainRequest(CFG, 'shop.acme.dz');
    assert.equal(wire.url, 'http://127.0.0.1:9/api/v1/services/srv-stub/custom-domains');
    assert.equal(wire.method, 'POST');
    assert.equal(wire.headers.authorization, 'Bearer rnd-test-secret-14c');
    assert.deepEqual(wire.body, { name: 'shop.acme.dz' });
  });

  test('get: the per-domain read, encoded, defaulting to the real API base', () => {
    const wire = buildGetDomainRequest({ apiKey: 'k', serviceId: 's x' }, 'shop.acme.dz');
    assert.equal(
      wire.url,
      'https://api.render.com/v1/services/s%20x/custom-domains/shop.acme.dz',
    );
    assert.equal(wire.method, 'GET');
  });
});

describe('the automation end to end (stubbed)', { skip }, () => {
  let tenantId = '';
  const userIds: string[] = [];
  let ownerToken = '';

  let stub: Server | null = null;
  interface Hit { method: string; path: string; auth: string | undefined }
  const hits: Hit[] = [];
  // The stub's certificate story: how many GETs answer "not yet" before
  // "verified". Reset per test.
  const behaviour = { pendingGets: 0 };
  let gets = 0;

  async function api(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        cookie: `${SESSION_COOKIE}=${ownerToken}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  }

  const domainRow = (id: string) =>
    withTenant(tenantId, (tx) =>
      (tx as any).tenantDomain.findUnique({
        where: { id },
        select: { renderState: true, renderDetail: true, renderSyncedAt: true },
      }),
    );

  async function makeVerifiedDomain(host: string): Promise<string> {
    return withTenant(tenantId, async (tx) => {
      const row = await (tx as any).tenantDomain.create({
        data: {
          tenantId,
          domain: host,
          verificationToken: `tok-${stamp}`,
          verifiedAt: new Date(),
        },
        select: { id: true },
      });
      return row.id;
    });
  }

  before(async () => {
    if (skip) return;

    stub = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        hits.push({ method: req.method ?? '', path: req.url ?? '', auth: req.headers.authorization });
        res.setHeader('content-type', 'application/json');
        if (req.method === 'POST') {
          res.statusCode = 201;
          res.end(JSON.stringify({ name: 'ok' }));
          return;
        }
        gets += 1;
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            gets > behaviour.pendingGets
              ? { verificationStatus: 'verified' }
              : { verificationStatus: 'unverified' },
          ),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      stub!.once('error', reject);
      stub!.listen(0, '127.0.0.1', resolve);
    });
    const stubBase = `http://127.0.0.1:${(stub!.address() as AddressInfo).port}`;

    const t = await asPlatform().tenant.create({
      data: { slug: `render-${stamp}`, name: 'Render Automation' },
    });
    tenantId = t.id;
    await withTenant(tenantId, (tx) =>
      (tx as any).subscription.create({
        data: { tenantId, status: 'ACTIVE', entitlements: ['product.website-builder'] },
      }),
    );
    const u = await asPlatform().user.create({
      data: {
        email: `render-${stamp}@landingos.test`,
        name: 'owner',
        passwordHash: await hashPassword('x'),
      },
    });
    userIds.push(u.id);
    await withTenant(tenantId, (tx) =>
      (tx as any).membership.create({ data: { tenantId, userId: u.id, role: 'OWNER' } }),
    );
    ownerToken = (await createSession(u.id, tenantId)).token;

    // The credential the RUNNING SERVER will read — its apiBase is the stub.
    await storeRenderCredential({ ...CFG, apiBase: stubBase });
  });

  after(async () => {
    if (skip) return;
    await asPlatform().platformCredential
      .delete({ where: { key: RENDER_CREDENTIAL_KEY } })
      .catch(() => {});
    for (const id of userIds) {
      await destroySessionsForUser(id);
      await withTenant(tenantId, (tx) =>
        (tx as any).membership.deleteMany({ where: { userId: id } }),
      );
      await asPlatform().user.delete({ where: { id } }).catch(() => {});
    }
    if (tenantId) await deleteTenant(tenantId).catch(() => {});
    await disconnect();
    if (stub) await new Promise<void>((resolve) => stub!.close(() => resolve()));
  });

  test('the credential is ENCRYPTED at rest, and reads back whole', async () => {
    const row = await asPlatform().platformCredential.findUnique({
      where: { key: RENDER_CREDENTIAL_KEY },
      select: { value: true },
    });
    assert.ok(row);
    // The meta/crypto shape, never the plaintext.
    assert.match(row!.value, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
    assert.ok(!row!.value.includes('rnd-test-secret-14c'));
    const cfg = await readRenderCredential();
    assert.equal(cfg?.apiKey, 'rnd-test-secret-14c');
    assert.equal(cfg?.serviceId, 'srv-stub');
  });

  test('marking a verified domain primary fires the automation: add + poll + recorded state', async () => {
    behaviour.pendingGets = 1; // one "not yet", then verified — the poll must survive it.
    gets = 0;
    const id = await makeVerifiedDomain(`shop-a-${stamp}.example.dz`);

    const res = await api('PATCH', `/api/platform/domains/${id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // The stub saw the ADD with the decrypted bearer key, then ≥2 GETs.
    const add = hits.find((h) => h.method === 'POST');
    assert.ok(add, 'the add call must have fired');
    assert.equal(add!.auth, 'Bearer rnd-test-secret-14c');
    assert.ok(add!.path.includes('/v1/services/srv-stub/custom-domains'));
    assert.ok(hits.filter((h) => h.method === 'GET').length >= 2, 'the certificate poll must retry');

    const row = await domainRow(id);
    assert.equal(row.renderState, 'certificate_issued');
    assert.ok(row.renderSyncedAt);
  });

  test('a certificate still pending when the bounded poll ends is an honest resting state', async () => {
    behaviour.pendingGets = 99; // never verifies inside the budget
    gets = 0;
    const id = await makeVerifiedDomain(`shop-b-${stamp}.example.dz`);
    const res = await api('PATCH', `/api/platform/domains/${id}`);
    assert.equal(res.status, 200);
    const row = await domainRow(id);
    assert.equal(row.renderState, 'certificate_pending');
  });

  test('UNCONFIGURED: the merchant action succeeds, nothing is called, nothing recorded', async () => {
    await asPlatform().platformCredential.delete({ where: { key: RENDER_CREDENTIAL_KEY } });
    try {
      const hitsBefore = hits.length;
      const id = await makeVerifiedDomain(`shop-c-${stamp}.example.dz`);
      const res = await api('PATCH', `/api/platform/domains/${id}`);
      assert.equal(res.status, 200, 'the automation must never fail the merchant');
      assert.equal(hits.length, hitsBefore, 'no call without a credential');
      const row = await domainRow(id);
      assert.equal(row.renderState, null);
    } finally {
      const cfg = { ...CFG, apiBase: `http://127.0.0.1:${(stub!.address() as AddressInfo).port}` };
      await storeRenderCredential(cfg);
    }
  });

  test('an unverified domain still cannot become primary — the trigger is unreachable', async () => {
    const id = await withTenant(tenantId, async (tx) => {
      const row = await (tx as any).tenantDomain.create({
        data: { tenantId, domain: `shop-d-${stamp}.example.dz`, verificationToken: 't' },
        select: { id: true },
      });
      return row.id;
    });
    const hitsBefore = hits.length;
    const res = await api('PATCH', `/api/platform/domains/${id}`);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NOT_VERIFIED');
    assert.equal(hits.length, hitsBefore);
  });
});
