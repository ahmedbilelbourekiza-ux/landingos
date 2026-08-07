import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_COOKIE } from '@landingos/auth';

import {
  skip, BASE, uid, phone, makeErpTenant, makeMember, cleanup,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/import.test.ts — LP.19, closing R5's import and R17's.
 *
 * A new tenant's history arrives as a file, and the platform had no door for it
 * — while the schema carried five `imported*` columns, an `importedSource` and
 * an `importedAt` that nothing could write.
 *
 * Three properties every test here defends, because each is a way an import can
 * quietly destroy a business's records:
 *
 *   1. AN IMPORT NEVER OVERWRITES A REAL VALUE, and never touches a lifetime
 *      counter. Those are the sum of order events; a file is not an order event.
 *   2. THE IMPORTED FIGURES ARE WRITTEN ONCE. A second import must not double
 *      them.
 *   3. RUNNING A FILE TWICE MUST NOT DOUBLE THE HISTORY. An operator who is not
 *      sure whether the first import worked runs it again.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;

const screen = async (path: string, token: string) => {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  return { status: res.status, body: await res.text() };
};

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('import');
});

after(async () => {
  if (skip) return;
  await cleanup();
});

const clientCsv = (rows: string[]) =>
  ['Name,Phone,Wilaya,Commune,Address,Total Orders,Delivered,Total Spent', ...rows].join('\r\n');

describe('the CSV parser handles what a real export contains', () => {
  test('a quoted comma, a doubled quote and an embedded newline all survive', async () => {
    // Half of what a customer file contains is quoting. A `split(",")` agrees
    // with a broken writer and silently shifts every column after the first
    // quoted comma.
    const p = phone();
    const csv = [
      'Name,Phone,Address',
      `"Ali, ""Le Grand""",${p},"Rue 5${'\n'}Bab Ezzouar"`,
    ].join('\r\n');

    const r = await acme.manager.api('POST', '/api/erp/clients/import', {
      mode: 'commit', csv, source: 'quoting',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.created, 1);

    const list = await acme.manager.api('GET', `/api/erp/clients?search=${p}`);
    const client = list.body.data.items[0];
    assert.equal(client.name, 'Ali, "Le Grand"');
    assert.match(client.address, /Bab Ezzouar/);
  });

  test('a file exported from here can be imported back into here', async () => {
    // The round trip. Our own export writes a UTF-8 BOM (Excel needs it), so a
    // parser that does not strip it names the first header `﻿Name` and every
    // column after it is unmapped.
    const staged = await makeErpTenant(`round-${uid()}`);
    await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Round Trip', phone: phone(), price: 1000, wilaya: 'Alger',
    });
    const exported = String(
      (await staged.manager.api('GET', '/api/erp/clients/export')).body,
    );
    assert.ok(exported.startsWith('﻿') || exported.includes('Name,Phone'), 'the export shape changed');

    const other = await makeErpTenant(`round2-${uid()}`);
    const r = await other.manager.api('POST', '/api/erp/clients/import', {
      mode: 'commit', csv: exported, source: 'round trip',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.created, 1, 'the BOM or the headers broke the round trip');
  });
});

describe('a customer import never overwrites what is already there (R5)', () => {
  test('preview writes nothing and commit writes what preview said', async () => {
    const staged = await makeErpTenant(`prev-${uid()}`);
    const csv = clientCsv([`Amina,${phone()},Alger,Bab Ezzouar,Rue 1,4,3,12000`]);

    const preview = await staged.manager.api('POST', '/api/erp/clients/import', {
      mode: 'preview', csv,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.created, 1);
    assert.equal((await staged.manager.api('GET', '/api/erp/clients')).body.data.total, 0,
      'a preview wrote to the database');

    const commit = await staged.manager.api('POST', '/api/erp/clients/import', {
      mode: 'commit', csv,
    });
    assert.equal(commit.body.data.created, 1, 'the commit disagreed with the preview');
    assert.equal((await staged.manager.api('GET', '/api/erp/clients')).body.data.total, 1);
  });

  test('the mode is REQUIRED — there is no default', async () => {
    // The failure mode of a defaulted `commit` is a spreadsheet written into a
    // live registry by somebody who meant to look at it first.
    const r = await acme.manager.api('POST', '/api/erp/clients/import', {
      csv: clientCsv([`X,${phone()},,,,,,`]),
    });
    assert.equal(r.status, 422);
  });

  test('imported figures land in their OWN columns, never the live counters', async () => {
    const staged = await makeErpTenant(`cols-${uid()}`);
    const p = phone();
    await staged.manager.api('POST', '/api/erp/clients/import', {
      mode: 'commit', csv: clientCsv([`Historic,${p},Oran,,,9,7,45000`]), source: 'old CRM',
    });

    const client = (await staged.manager.api('GET', `/api/erp/clients?search=${p}`))
      .body.data.items[0];
    assert.equal(client.importedTotalOrders, 9);
    assert.equal(client.importedDeliveredOrders, 7);
    assert.equal(client.importedSource, 'old CRM');
    assert.ok(client.importedAt);
    // The live counters are the sum of order events, and a file is not one.
    assert.equal(client.totalOrders, 0, 'an import moved a LIVE counter');
    assert.equal(client.deliveredOrders, 0);
    assert.equal(String(client.totalSpent), '0');
  });

  test('an existing REAL value is never replaced; a blank one is filled', async () => {
    const staged = await makeErpTenant(`merge-${uid()}`);
    const p = phone();
    // An order creates the client with a name and a wilaya and no address.
    await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Observed Name', phone: p, price: 1000, wilaya: 'Alger',
    });

    const r = await staged.manager.api('POST', '/api/erp/clients/import', {
      mode: 'commit',
      csv: clientCsv([`Imported Name,${p},Oran,Bir El Djir,12 Rue A,5,5,20000`]),
    });
    assert.equal(r.body.data.merged, 1);
    assert.equal(r.body.data.created, 0);

    const client = (await staged.manager.api('GET', `/api/erp/clients?search=${p}`))
      .body.data.items[0];
    assert.equal(client.name, 'Observed Name', 'a real name was replaced by an imported one');
    assert.equal(client.wilaya, 'Alger', 'a real wilaya was replaced');
    assert.equal(client.address, '12 Rue A', 'a BLANK field must be filled');
  });

  test('the imported figures are written ONCE, and a second import does not double them', async () => {
    const staged = await makeErpTenant(`once-${uid()}`);
    const p = phone();
    const csv = clientCsv([`Twice,${p},,,,6,4,30000`]);

    await staged.manager.api('POST', '/api/erp/clients/import', {
      mode: 'commit', csv, source: 'first',
    });
    await staged.manager.api('POST', '/api/erp/clients/import', {
      mode: 'commit', csv: clientCsv([`Twice,${p},,,,99,99,999999`]), source: 'second',
    });

    const client = (await staged.manager.api('GET', `/api/erp/clients?search=${p}`))
      .body.data.items[0];
    assert.equal(client.importedTotalOrders, 6, 'a second import overwrote the first');
    assert.equal(client.importedSource, 'first');
  });

  test('a row with no phone is skipped BY ROW NUMBER, not silently', async () => {
    const staged = await makeErpTenant(`nophone-${uid()}`);
    const r = await staged.manager.api('POST', '/api/erp/clients/import', {
      mode: 'commit',
      csv: clientCsv([`Good,${phone()},,,,,,`, 'Bad,,,,,,,']),
    });
    assert.equal(r.body.data.created, 1);
    assert.equal(r.body.data.skipped, 1);
    // +2 for the header and for counting from one, so a person can find it.
    assert.deepEqual(r.body.data.skippedRows, [{ row: 3, reason: 'no_phone' }]);
  });

  test('a file whose phone column was not recognised says SO, not "all skipped"', async () => {
    // Otherwise every row is skipped with `no_phone`, which reads as "the data
    // is bad" rather than "the mapping is wrong".
    const r = await acme.manager.api('POST', '/api/erp/clients/import', {
      mode: 'preview',
      csv: 'Nom complet,Numero de contact\nAli,0555112233',
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'NO_PHONE_COLUMN');
    assert.ok(Array.isArray(r.body.error.headers), 'it must show what it saw');
  });

  test('an explicit column map wins over the automatic one', async () => {
    const staged = await makeErpTenant(`map-${uid()}`);
    const p = phone();
    const r = await staged.manager.api('POST', '/api/erp/clients/import', {
      mode: 'commit',
      csv: `Nom complet,Numero de contact\nMapped,${p}`,
      columns: { 'Nom complet': 'name', 'Numero de contact': 'phone' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.created, 1);
    const client = (await staged.manager.api('GET', `/api/erp/clients?search=${p}`))
      .body.data.items[0];
    assert.equal(client.name, 'Mapped');
  });

  test('a header with no meaning is IGNORED, not refused', async () => {
    // Real exports carry a dozen columns nobody wants; refusing over "Accepts
    // Marketing" would be a wall in front of a migration.
    const staged = await makeErpTenant(`extra-${uid()}`);
    const r = await staged.manager.api('POST', '/api/erp/clients/import', {
      mode: 'commit',
      csv: `Name,Phone,Accepts Marketing,Tags\nExtra,${phone()},yes,vip`,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.created, 1);
  });

  test('an empty file is named rather than reported as zero created', async () => {
    const r = await acme.manager.api('POST', '/api/erp/clients/import', {
      mode: 'preview', csv: 'Name,Phone\n',
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'EMPTY_FILE');
  });

  test('it needs erp:clients:write, which is SENSITIVE', async () => {
    const reader = await makeMember(acme.tenantId, {
      role: 'MANAGER', permissions: ['erp:clients:read'],
    });
    const r = await reader.api('POST', '/api/erp/clients/import', {
      mode: 'preview', csv: clientCsv([`X,${phone()},,,,,,`]),
    });
    assert.equal(r.status, 403);
  });

  test('a commit leaves an audit row with the counts', async () => {
    const staged = await makeErpTenant(`audit-${uid()}`);
    await staged.manager.api('POST', '/api/erp/clients/import', {
      mode: 'commit', csv: clientCsv([`Audited,${phone()},,,,,,`]), source: 'sheet',
    });
    const audit = await staged.manager.api(
      'GET', '/api/erp/audit?entity=client&entityId=import',
    );
    assert.equal(audit.status, 200);
    assert.ok(audit.body.data.items.length > 0, 'a bulk write on the customer surface left no trail');
    assert.equal(audit.body.data.items[0].payload.created, 1);
  });
});

describe('an order import does not double the history (R17)', () => {
  const orderCsv = (rows: string[]) =>
    ['Name,Phone,Billing Name,Shipping Province,Lineitem name,Lineitem quantity,Total', ...rows]
      .join('\r\n');

  test('it creates orders, mints references and populates the registry', async () => {
    const staged = await makeErpTenant(`ord-${uid()}`);
    const p1 = phone();
    const r = await staged.manager.api('POST', '/api/erp/orders/import', {
      mode: 'commit',
      csv: orderCsv([`#1001,${p1},Karim,Alger,Widget,2,4900`]),
      source: 'shopify export',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.created, 1);

    const orders = await staged.manager.api('GET', '/api/erp/orders');
    const order = orders.body.data.items[0];
    assert.ok(order.reference, 'an imported order must carry a number a customer can read back');
    assert.equal(order.client, 'Karim');
    assert.equal(order.wilaya, 'Alger');
    assert.equal(order.quantity, 2);
    assert.equal(order.source, 'shopify export', 'an imported order must not look like a fresh one');

    // D-LP.19.4: it went through `createOrder`, so the registry knows.
    const clients = await staged.manager.api('GET', `/api/erp/clients?search=${p1}`);
    assert.equal(clients.body.data.total, 1, 'the customer registry did not learn about the import');
  });

  test('running the same file twice creates nothing the second time', async () => {
    // The property that matters most. An operator who is not sure whether the
    // first import worked runs it again, and doubling the history also doubles
    // every customer's lifetime counters — which are append-only.
    const staged = await makeErpTenant(`dedup-${uid()}`);
    const csv = orderCsv([`#2001,${phone()},Amina,Oran,Gadget,1,2500`]);

    const first = await staged.manager.api('POST', '/api/erp/orders/import', {
      mode: 'commit', csv,
    });
    assert.equal(first.body.data.created, 1);
    assert.equal(first.body.data.dedupBy, 'externalId');

    const second = await staged.manager.api('POST', '/api/erp/orders/import', {
      mode: 'commit', csv,
    });
    assert.equal(second.body.data.created, 0);
    assert.equal(second.body.data.duplicates, 1);
    assert.equal((await staged.manager.api('GET', '/api/erp/orders')).body.data.total, 1);
  });

  test('a repeated id WITHIN one file counts once', async () => {
    // A Shopify export repeats the order row per line item.
    const staged = await makeErpTenant(`multi-${uid()}`);
    const p = phone();
    const r = await staged.manager.api('POST', '/api/erp/orders/import', {
      mode: 'commit',
      csv: orderCsv([
        `#3001,${p},Sami,Alger,First Item,1,5000`,
        `#3001,,,,Second Item,1,`,
      ]),
    });
    assert.equal(r.body.data.created, 1, 'a multi-line-item order became two orders');
    assert.equal(r.body.data.duplicates, 1);
  });

  test('a file with no id column says its dedup is WEAKER rather than implying it is not', async () => {
    const staged = await makeErpTenant(`weak-${uid()}`);
    const r = await staged.manager.api('POST', '/api/erp/orders/import', {
      mode: 'preview',
      csv: `Customer,Phone,Product,Total\nNoId,${phone()},Thing,100`,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.dedupBy, 'phone+total');
  });

  test('a preview writes nothing', async () => {
    const staged = await makeErpTenant(`opre-${uid()}`);
    const r = await staged.manager.api('POST', '/api/erp/orders/import', {
      mode: 'preview',
      csv: orderCsv([`#4001,${phone()},Prev,Alger,Thing,1,100`]),
    });
    assert.equal(r.body.data.created, 1);
    assert.equal((await staged.manager.api('GET', '/api/erp/orders')).body.data.total, 0);
  });

  test('an imported order raises NO notification', async () => {
    // D-LP.19.5. Importing two years of history would push two years of "new
    // order" alerts at everybody holding `erp:orders:write` — and LP.11's
    // ka-ching would fire a thousand times.
    const staged = await makeErpTenant(`quiet-${uid()}`);
    const before = (await staged.manager.api('GET', '/api/platform/notifications?limit=50'))
      .body.data.items.length;

    await staged.manager.api('POST', '/api/erp/orders/import', {
      mode: 'commit',
      csv: orderCsv([
        `#5001,${phone()},A,Alger,Thing,1,100`,
        `#5002,${phone()},B,Alger,Thing,1,100`,
        `#5003,${phone()},C,Alger,Thing,1,100`,
      ]),
    });

    const after = (await staged.manager.api('GET', '/api/platform/notifications?limit=50'))
      .body.data.items.length;
    assert.equal(after, before, 'an import notified somebody');
  });

  test('another tenant’s orders are unreachable through the dedup lookup', async () => {
    // The dedup asks "does an order with this externalId exist" — bound and
    // RLS-scoped, so a colliding id in another company must not suppress a row.
    const a = await makeErpTenant(`ta-${uid()}`);
    const b = await makeErpTenant(`tb-${uid()}`);
    const csv = orderCsv([`#SHARED,${phone()},X,Alger,Thing,1,100`]);

    await a.manager.api('POST', '/api/erp/orders/import', { mode: 'commit', csv });
    const second = await b.manager.api('POST', '/api/erp/orders/import', { mode: 'commit', csv });
    assert.equal(second.body.data.created, 1, 'another tenant’s id suppressed this one');
  });

  test('it needs erp:orders:write', async () => {
    const reader = await makeMember(acme.tenantId, { role: 'MEMBER' });
    const r = await reader.api('POST', '/api/erp/orders/import', {
      mode: 'preview', csv: 'Phone\n0555112233',
    });
    assert.ok(r.status === 403 || r.status === 404, `unexpected ${r.status}`);
  });
});

describe('both imports are reachable from a screen', () => {
  test('the customer registry offers one', async () => {
    const r = await screen('/console/erp/clients', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-client-import"/);
    assert.match(r.body, /data-testid="erp-client-import-preview"/);
    assert.match(r.body, /data-testid="erp-client-import-commit"/);
  });

  test('the order list offers one', async () => {
    const r = await screen('/console/erp/orders', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-order-import"/);
  });

  test('a reader without the write permission gets neither control', async () => {
    const reader = await makeMember(acme.tenantId, {
      role: 'MANAGER', permissions: ['erp:clients:read'],
    });
    const r = await screen('/console/erp/clients', reader.token);
    assert.equal(r.status, 200, 'they may still read the list');
    assert.ok(!/data-testid="erp-client-import"/.test(r.body));
  });
});
