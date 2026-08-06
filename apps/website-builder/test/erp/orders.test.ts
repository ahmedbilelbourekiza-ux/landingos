import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  skip, phone, makeErpTenant, cleanup, stampReferenceWithoutCounter,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/orders.test.ts
 *
 * Ported from apps/erp/test/regression.test.js (orders lifecycle) and
 * apps/erp/test/hardening.test.js §3 (per-order authorization).
 *
 * The lifecycle half locks in behaviour that already worked and must keep
 * working through the port. The authorization half is the more important one:
 * scoping the order LIST was cosmetic, because every per-order route took the
 * id straight from the URL with no ownership check. Any agent could read, edit,
 * reassign or log a call against any order — and logging a confirmed call on
 * someone else's order is payroll fraud, not a privacy nuisance.
 *
 * A port that keeps the shape and drops the rules is not a port, so each rule
 * is asserted by violating it.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('orders');
});

after(async () => {
  if (skip) return;
  await cleanup();
});

/** Create an order as the manager and return its id. */
async function newOrder(extra: Record<string, unknown> = {}) {
  const r = await acme.manager.api('POST', '/api/erp/orders', {
    client: 'Test Client', phone: phone(), price: 1000, ...extra,
  });
  assert.equal(r.status, 201, `order creation failed: ${JSON.stringify(r.body)}`);
  return r.body.data.id as string;
}

const read = async (id: string) =>
  (await acme.manager.api('GET', `/api/erp/orders/${id}`)).body.data;

/* -----------------------------------------------------------------------------
 * Lifecycle
 * -------------------------------------------------------------------------- */

describe('an order is created and normalised', () => {
  test('creation returns the order with a generated id', async () => {
    const r = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Test Client', phone: '+213555123456',
      product: 'Widget', quantity: 2, price: 4000,
      wilaya: 'Alger', commune: 'Bab Ezzouar',
    });
    assert.equal(r.status, 201);
    assert.ok(r.body.data.id, 'an id was assigned');
    assert.equal(r.body.data.status, 'pending');
  });

  test('the phone is normalised to the local form', async () => {
    // phoneNormalized is the dedup key against Client. If +213555123456 and
    // 0555123456 normalise differently, one customer becomes two records and
    // their lifetime history splits in half.
    const r = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Normalise Me', phone: '+213555123456', price: 100,
    });
    assert.equal(r.body.data.phone, '0555123456');
  });

  test('an order with no client or phone is refused', async () => {
    const r = await acme.manager.api('POST', '/api/erp/orders', { product: 'X' });
    assert.equal(r.status, 422);
  });

  test('money comes back as a decimal string, never a float', async () => {
    // 37 numeric columns and 0 double precision (M-06). A price that arrives as
    // a JS number has already lost the guarantee the column type provides.
    const id = await newOrder({ price: 4999.99 });
    const order = await read(id);
    assert.equal(typeof order.price, 'string', 'Decimal is serialised as a string');
    assert.equal(order.price, '4999.99');
  });

  test('the new order appears in the list', async () => {
    const id = await newOrder();
    const r = await acme.manager.api('GET', '/api/erp/orders?pageSize=200');
    assert.ok(r.body.data.items.some((o: { id: string }) => o.id === id));
  });
});

describe('calls move the order through its states', () => {
  test('call-start then a valid result moves the status', async () => {
    const id = await newOrder();
    assert.equal((await acme.manager.api('POST', `/api/erp/orders/${id}/call-start`, {})).status, 200);
    const r = await acme.manager.api('POST', `/api/erp/orders/${id}/call`, {
      result: 'confirmed', note: 'customer agreed',
    });
    assert.equal(r.status, 200);
    assert.equal((await read(id)).status, 'confirmed');
  });

  test('an unknown call result is refused, and says what is valid', async () => {
    const id = await newOrder();
    const r = await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'bogus' });
    assert.equal(r.status, 422);
    assert.ok(Array.isArray(r.body.error.valid ?? r.body.error.details),
      'the caller is told which results exist');
  });

  test('a short call is flagged suspicious in the audit trail', async () => {
    const id = await newOrder();
    await acme.manager.api('POST', `/api/erp/orders/${id}/call-start`, {});
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' });

    const audit = (await acme.manager.api('GET', `/api/erp/orders/${id}/audit`)).body.data;
    assert.equal(audit.calls.length, 1);
    assert.equal(audit.calls[0].suspicious, true, 'a sub-threshold call is flagged');
  });

  test('a result logged with no call-start is flagged too', async () => {
    const id = await newOrder();
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'cancelled' });
    const audit = (await acme.manager.api('GET', `/api/erp/orders/${id}/audit`)).body.data;
    assert.equal(audit.calls[0].suspicious, true);
    assert.equal(audit.calls[0].noStart, true);
  });

  test('suspicious is nullable, so "not evaluated" stays distinct from "fine"', async () => {
    // OrderCall.suspicious is a nullable Boolean by design (M-06): 0/1/null in
    // SQLite carried three states and the third meant "never assessed". Folding
    // it to false would silently reclassify unassessed history as clean.
    const id = await newOrder();
    await acme.manager.api('POST', `/api/erp/orders/${id}/note`, {
      noteType: 'client_called_back', note: 'client rang us',
    });
    const audit = (await acme.manager.api('GET', `/api/erp/orders/${id}/audit`)).body.data;
    assert.notEqual(audit.calls[0].suspicious, false, 'a note is not a judged call');
  });

  test('a standalone note never sets a result or moves the status', async () => {
    const id = await newOrder();
    const r = await acme.manager.api('POST', `/api/erp/orders/${id}/note`, {
      noteType: 'client_called_back', note: 'client rang us',
    });
    assert.equal(r.status, 200);
    const audit = (await acme.manager.api('GET', `/api/erp/orders/${id}/audit`)).body.data;
    assert.equal(audit.calls[0].result, null);
    assert.equal(audit.currentStatus, 'pending', 'a note must not change status');
  });

  test('an invalid note type is refused', async () => {
    const id = await newOrder();
    const r = await acme.manager.api('POST', `/api/erp/orders/${id}/note`, { noteType: 'nope', note: 'x' });
    assert.equal(r.status, 422);
  });

  test('an invalid status on update is refused', async () => {
    const id = await newOrder();
    const r = await acme.manager.api('PATCH', `/api/erp/orders/${id}`, { status: 'not-a-status' });
    assert.equal(r.status, 422);
  });

  test('the attempts matrix has nine slots', async () => {
    const id = await newOrder();
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'no_answer' });
    const r = await acme.manager.api('GET', `/api/erp/orders/${id}/attempts`);
    assert.equal(r.body.data.matrix.length, 9);
    assert.equal(r.body.data.totalCalls, 1);
  });

  test('call history is append-only', async () => {
    // Every call attempt is a permanent record. A route that lets one be
    // rewritten or removed would make the suspicious-call flag — and the
    // payroll it feeds — negotiable after the fact.
    const id = await newOrder();
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'no_answer' });
    const audit = (await acme.manager.api('GET', `/api/erp/orders/${id}/audit`)).body.data;
    const callId = audit.calls[0].id;

    for (const [method, path] of [
      ['DELETE', `/api/erp/orders/${id}/calls/${callId}`],
      ['PATCH', `/api/erp/orders/${id}/calls/${callId}`],
    ] as const) {
      const r = await acme.manager.api(method, path, { result: 'confirmed' });
      assert.ok(r.status === 404 || r.status === 405,
        `${method} ${path} returned ${r.status} — call history must not be editable`);
    }
  });
});

describe('classification is orthogonal to status', () => {
  test('classifying an order as fake does not touch its status', async () => {
    // It is its own column for exactly this reason: a confirmed order that
    // turns out to be fake is still confirmed, and collapsing the two would
    // lose one of the facts.
    const id = await newOrder();
    await acme.manager.api('POST', `/api/erp/orders/${id}/call-start`, {});
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' });

    const r = await acme.manager.api('POST', `/api/erp/orders/${id}/classify`, {
      classification: 'fake', reason: 'duplicate', responsible: 'agent',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.classification, 'fake');
    assert.equal(r.body.data.status, 'confirmed', 'classifying must not touch status');
  });

  test('an unknown classification is refused', async () => {
    const id = await newOrder();
    const r = await acme.manager.api('POST', `/api/erp/orders/${id}/classify`, { classification: 'weird' });
    assert.equal(r.status, 422);
  });
});

/* -----------------------------------------------------------------------------
 * hardening.test.js §3 — per-order authorization
 *
 * The list scope is not the boundary. THIS is.
 * -------------------------------------------------------------------------- */

describe('per-order authorization', () => {
  let victimOrder = '';
  let ownOrder = '';
  let unassigned = '';

  before(async () => {
    if (skip) return;
    victimOrder = await newOrder({ client: 'Private Customer', price: 9999, agentUserId: acme.other.userId });
    ownOrder = await newOrder({ client: 'Mine', agentUserId: acme.agent.userId });
    unassigned = await newOrder({ client: 'Nobody' });
  });

  const SUBROUTES: ReadonlyArray<readonly [string, string, unknown?]> = [
    ['GET', '/audit'],
    ['GET', '/attempts'],
    ['GET', '/shipment'],
    ['PATCH', '', { managerNote: 'tampered' }],
    ['POST', '/call', { result: 'confirmed' }],
    ['POST', '/call-start', {}],
    ['POST', '/note', { noteType: 'other', note: 'x' }],
    ['POST', '/classify', { classification: 'fake' }],
  ];

  for (const [method, suffix, body] of SUBROUTES) {
    test(`an agent cannot ${method} another agent’s order${suffix}`, async () => {
      // 404, not 403. Confirming the order exists is itself information, and
      // it is the same rule that applies across the tenant boundary — one rule
      // rather than two is what stops the two drifting apart.
      const r = await acme.agent.api(method, `/api/erp/orders/${victimOrder}${suffix}`, body);
      assert.equal(r.status, 404, `${method} /api/erp/orders/:id${suffix} must be refused`);
    });
  }

  test('and the victim’s order was genuinely left untouched', async () => {
    const o = await read(victimOrder);
    assert.equal(o.agentUserId, acme.other.userId, 'still assigned to the victim');
    assert.equal(o.status, 'pending', 'no call result was recorded');
    assert.notEqual(o.managerNote, 'tampered');
    assert.notEqual(o.classification, 'fake');
  });

  test('an agent CAN work their own order', async () => {
    assert.equal((await acme.agent.api('GET', `/api/erp/orders/${ownOrder}/audit`)).status, 200);
    assert.equal((await acme.agent.api('POST', `/api/erp/orders/${ownOrder}/call-start`, {})).status, 200);
    assert.equal(
      (await acme.agent.api('POST', `/api/erp/orders/${ownOrder}/call`, { result: 'confirmed' })).status,
      200,
    );
  });

  test('an agent CAN pick up an unassigned order', async () => {
    assert.equal((await acme.agent.api('GET', `/api/erp/orders/${unassigned}/audit`)).status, 200);
  });

  test('an agent cannot reassign an order to themselves', async () => {
    // Self-assignment is how an agent would harvest the unassigned queue ahead
    // of everyone else, and it is a manager's decision.
    const r = await acme.agent.api('PATCH', `/api/erp/orders/${unassigned}`, {
      agentUserId: acme.agent.userId,
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'FORBIDDEN_FIELD');
  });

  test('a manager is unaffected by any of it', async () => {
    assert.equal((await acme.manager.api('GET', `/api/erp/orders/${victimOrder}/audit`)).status, 200);
    assert.equal(
      (await acme.manager.api('PATCH', `/api/erp/orders/${victimOrder}`, { managerNote: 'ok' })).status,
      200,
    );
  });

  test('a non-existent order is a 404, not a 403 that confirms nothing exists', async () => {
    assert.equal((await acme.agent.api('GET', '/api/erp/orders/ORD-9999/audit')).status, 404);
    assert.equal((await acme.manager.api('GET', '/api/erp/orders/ORD-9999/audit')).status, 404);
  });
});

/* -----------------------------------------------------------------------------
 * Bulk operations
 * -------------------------------------------------------------------------- */

describe('bulk operations report per-id results', () => {
  test('a partial failure is reported per id rather than failing the batch', async () => {
    const a = await newOrder({ client: 'B1' });
    const b = await newOrder({ client: 'B2' });
    const r = await acme.manager.api('POST', '/api/erp/orders/bulk', {
      ids: [a, b, 'ORD-9999'], action: 'status', value: 'no_answer',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.processed, 3);
    assert.equal(r.body.data.succeeded, 2);
    assert.equal(r.body.data.results.find((x: { id: string }) => x.id === 'ORD-9999').ok, false);
  });

  test('a missing ids array is refused', async () => {
    const r = await acme.manager.api('POST', '/api/erp/orders/bulk', { action: 'status', value: 'pending' });
    assert.equal(r.status, 422);
  });

  test('bulk cannot reach another tenant’s orders', async () => {
    // The most valuable thing a bulk endpoint can be pointed at. It takes a
    // list of ids from the client, which is exactly the shape that invites
    // someone to paste ids they were never given.
    const beta = await makeErpTenant('bulk-beta');
    const theirs = (await beta.manager.api('POST', '/api/erp/orders', {
      client: 'Beta Order', phone: phone(),
    })).body.data.id;

    const r = await acme.manager.api('POST', '/api/erp/orders/bulk', {
      ids: [theirs], action: 'delete',
    });
    assert.equal(r.status, 200, 'the request is well-formed; the id simply does not exist here');
    assert.equal(r.body.data.succeeded, 0);

    const still = await beta.manager.api('GET', `/api/erp/orders/${theirs}`);
    assert.equal(still.status, 200, 'and the order is still there');
  });

  test('an agent’s bulk action cannot reach orders they cannot see', async () => {
    const theirs = await newOrder({ agentUserId: acme.other.userId });
    const r = await acme.agent.api('POST', '/api/erp/orders/bulk', {
      ids: [theirs], action: 'status', value: 'cancelled',
    });
    assert.equal(r.body?.data?.succeeded ?? 0, 0, 'record scoping applies to bulk too');
    assert.equal((await read(theirs)).status, 'pending');
  });
});

/* -----------------------------------------------------------------------------
 * Deletion
 * -------------------------------------------------------------------------- */

describe('deleting an order', () => {
  test('a manager can delete one', async () => {
    const id = await newOrder();
    assert.equal((await acme.manager.api('DELETE', `/api/erp/orders/${id}`)).status, 200);
    assert.equal((await acme.manager.api('GET', `/api/erp/orders/${id}`)).status, 404);
  });

  test('an agent cannot', async () => {
    const id = await newOrder({ agentUserId: acme.agent.userId });
    assert.equal((await acme.agent.api('DELETE', `/api/erp/orders/${id}`)).status, 403);
    assert.equal((await acme.manager.api('GET', `/api/erp/orders/${id}`)).status, 200);
  });

  test('the customer record survives it', async () => {
    // Deliberate, and the ERP asserted it too: a customer's identity and
    // lifetime history outlive any individual order.
    const number = phone();
    const id = await newOrder({ client: 'Survivor', phone: number });
    await acme.manager.api('DELETE', `/api/erp/orders/${id}`);

    const r = await acme.manager.api('GET', `/api/erp/clients?search=${number}`);
    assert.equal(r.body.data.items.length, 1, 'client history survives order deletion');
  });
});

/* -----------------------------------------------------------------------------
 * LP.7 — the reference counter has to survive data it did not mint
 *
 * Found by creating an order through the console in the seeded demo tenant:
 * `POST /api/erp/orders` answered **500** with `P2002` on
 * `(tenantId, reference)`. The seed writes ORD-0001…ORD-0006 directly and never
 * touches `TenantSequence`, so the counter did not exist, the upsert started it
 * at 1, and the first order anybody created collided — permanently, walking up
 * through every seeded number on each retry.
 *
 * It is NOT a seed problem. Any path that writes a reference without going
 * through `nextReference` leaves the counter behind the data: a migration, a
 * restore, and the CSV import still on the roadmap. Catching the P2002
 * afterwards is not available either — a unique violation aborts the whole
 * Postgres transaction, and every caller is already inside the one `withTenant`
 * opened — so the counter has to heal itself BEFORE the insert.
 * -------------------------------------------------------------------------- */

describe('order numbering survives references it did not mint', () => {
  test('a tenant whose numbers were imported can still create an order', async () => {
    const seeded = await makeErpTenant('refs');

    const first = await seeded.manager.api('POST', '/api/erp/orders', {
      client: 'Imported', phone: phone(), price: 1000,
    });
    assert.equal(first.status, 201);

    // Exactly the state a seed, an import or a restore leaves behind: a
    // reference the counter has never seen, and no counter row at all.
    await stampReferenceWithoutCounter(seeded.tenantId, first.body.data.id, 'ORD-0099');

    const next = await seeded.manager.api('POST', '/api/erp/orders', {
      client: 'After the import', phone: phone(), price: 2000,
    });
    assert.equal(next.status, 201, 'this answered 500 with P2002 before LP.7');
    assert.equal(next.body.data.reference, 'ORD-0100', 'and it continues from the data, not from 1');

    // And the counter is a counter again, not a one-off repair.
    const after = await seeded.manager.api('POST', '/api/erp/orders', {
      client: 'And again', phone: phone(), price: 3000,
    });
    assert.equal(after.body.data.reference, 'ORD-0101');
  });

  test('a reference this scheme could not have minted does not move the counter', async () => {
    // A company whose imported numbers are `INV/2024/17` must not have them
    // parsed into something the counter jumps to. Only `ORD-<digits>` counts.
    const other = await makeErpTenant('refs-alien');
    const first = await other.manager.api('POST', '/api/erp/orders', {
      client: 'Alien', phone: phone(), price: 1000,
    });
    await stampReferenceWithoutCounter(other.tenantId, first.body.data.id, 'INV/2024/17');

    const next = await other.manager.api('POST', '/api/erp/orders', {
      client: 'Next', phone: phone(), price: 2000,
    });
    assert.equal(next.status, 201);
    assert.equal(next.body.data.reference, 'ORD-0001', 'nothing ORD-shaped existed to continue from');
  });
});
