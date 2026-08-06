import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_COOKIE } from '@landingos/auth';

import {
  skip, uid, phone, makeErpTenant, makeAgent, cleanup, BASE,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/export.test.ts — LP.6, restoring R4.
 *
 * There is no legacy test file to port: the ERP's four export builders lived in
 * `index.html` and ran in the browser over an already-downloaded order book, so
 * nothing server-side ever asserted them. This suite is written from those four
 * builders read line by line — the column NAMES are a contract with somebody
 * else's importer, and a renamed header is a file a carrier rejects while
 * looking perfectly fine to us.
 *
 * Three things it attacks rather than confirms:
 *
 *   - THE FILTER CONTRACT. An export that interprets `?status=` differently
 *     from the list that offered the control is the second-vocabulary failure
 *     D-LP.3 spent a slice removing. Asserted by driving the same query string
 *     through both.
 *   - SCOPE. An export is the largest read on this surface and it leaves the
 *     building. An agent's file must contain their queue and a colleague's must
 *     not be in it; another tenant's must be unreachable at all.
 *   - THE SPREADSHEET ITSELF. A customer name arriving from a storefront is a
 *     stranger's text landing in an operator's Excel — `=cmd|…` is a working
 *     command-execution vector — and a missing BOM turns every accented wilaya
 *     into mojibake, which reads as "the export is broken".
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;
let carrierCode = '';

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('export');

  carrierCode = `xc${uid()}`;
  const created = await acme.manager.api('POST', '/api/erp/carriers', {
    name: 'Export Carrier', code: carrierCode, adapter: 'mock',
  });
  assert.equal(created.status, 201);
});

after(async () => {
  if (skip) return;
  await cleanup();
});

/* -----------------------------------------------------------------------------
 * Reading a CSV back
 *
 * A real parser rather than `split(',')`, because half of what these tests are
 * checking is the QUOTING — a note containing a comma, a name containing a
 * quote — and a splitter would silently agree with a broken writer.
 * -------------------------------------------------------------------------- */

function parseCsv(text: string): string[][] {
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

interface Csv {
  readonly status: number;
  readonly headers: string[];
  readonly rows: string[][];
  readonly raw: string;
  readonly disposition: string;
  readonly contentType: string;
  /** header name → column index */
  readonly at: (name: string) => number;
  /** every row, as a name → value record */
  readonly records: Record<string, string>[];
}

async function download(format: string, query = ''): Promise<Csv> {
  const r = await acme.manager.api(
    'GET',
    `/api/erp/orders/export?format=${format}${query}`,
  );
  return asCsv(r);
}

function asCsv(r: { status: number; body: any; headers: Headers }): Csv {
  const raw = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  const parsed = r.status === 200 ? parseCsv(raw) : [];
  const headers = parsed[0] ?? [];
  const rows = parsed.slice(1);
  const at = (name: string) => {
    const i = headers.indexOf(name);
    assert.notEqual(i, -1, `no "${name}" column in [${headers.join(', ')}]`);
    return i;
  };
  return {
    status: r.status,
    headers,
    rows,
    raw,
    disposition: r.headers.get('content-disposition') ?? '',
    contentType: r.headers.get('content-type') ?? '',
    at,
    records: rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))),
  };
}

/** An order, optionally driven all the way to confirmed. */
async function order(over: Record<string, unknown> = {}, confirm = true) {
  const created = await acme.manager.api('POST', '/api/erp/orders', {
    client: `Export Buyer ${uid()}`, phone: phone(),
    wilaya: 'Alger', commune: 'Bab Ezzouar',
    product: 'Montre', productVariant: 'Noir', quantity: 2, price: 4500,
    carrierCode, ...over,
  });
  assert.equal(created.status, 201, `order creation failed: ${JSON.stringify(created.body)}`);
  const id = created.body.data.id as string;

  if (confirm) {
    await acme.manager.api('POST', `/api/erp/orders/${id}/call-start`, {});
    const call = await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' });
    assert.equal(call.status, 200);
  }
  return { id, reference: created.body.data.reference as string };
}

/* -----------------------------------------------------------------------------
 * The carrier files
 * -------------------------------------------------------------------------- */

describe('a confirmed order can leave the building', () => {
  test('the ZR file has ZR’s own columns, in ZR’s own order', async () => {
    // The headers ARE the contract: a carrier's importer matches on them, so
    // they are the ERP's strings exactly — French, no accents added, no
    // translation. A localised header is a file the carrier rejects while
    // looking perfectly correct to whoever exported it.
    const made = await order({ client: 'Amina Zerrouki', note: 'Sonner deux fois' });

    const csv = await download('zr');
    assert.equal(csv.status, 200);
    assert.deepEqual(csv.headers, [
      'Nom', 'Tel', 'Tel2', 'Wilaya', 'Commune', 'Produit', 'Qte', 'Prix', 'Note',
    ]);

    const row = csv.records.find((r) => r.Nom === 'Amina Zerrouki');
    assert.ok(row, `the confirmed order is missing from the file: ${csv.raw.slice(0, 400)}`);
    assert.equal(row!.Wilaya, 'Alger');
    assert.equal(row!.Commune, 'Bab Ezzouar');
    assert.equal(row!.Qte, '2');
    assert.equal(row!.Note, 'Sonner deux fois');
    // Always empty, and present. ZR's importer reads by position as well as by
    // name, so a dropped column shifts every field after it.
    assert.equal(row!.Tel2, '');
    assert.ok(made.id);
  });

  test('the phone is the local 0X… form a carrier’s importer expects', async () => {
    await order({ client: 'Local Number', phone: '+213555112233' });
    const row = (await download('zr')).records.find((r) => r.Nom === 'Local Number');
    assert.ok(row);
    assert.equal(row!.Tel, '0555112233');
  });

  test('the product carries its variant, the way the ERP wrote it', async () => {
    await order({ client: 'With Variant', product: 'Casque', productVariant: 'Bleu' });
    const row = (await download('zr')).records.find((r) => r.Nom === 'With Variant');
    assert.equal(row!.Produit, 'Casque - Bleu');
  });

  test('the delivery instruction wins over the general note', async () => {
    // `shippingNote || note` is the ERP's own precedence and it matters: the
    // Note column is what a courier reads at the door, and a manager's internal
    // note is not that.
    const made = await order({ client: 'Two Notes', note: 'internal' });
    await acme.manager.api('PATCH', `/api/erp/orders/${made.id}`, { shippingNote: 'Étage 3, porte gauche' });

    const row = (await download('zr')).records.find((r) => r.Nom === 'Two Notes');
    assert.equal(row!.Note, 'Étage 3, porte gauche');
  });

  test('Ecom and Ecotrac have their own columns, and Ecotrac has no quantity', async () => {
    await order({ client: 'Both Formats' });

    const ecom = await download('ecom');
    assert.deepEqual(ecom.headers, [
      'Nom', 'Telephone', 'Wilaya', 'Commune', 'Produit', 'Quantite', 'Prix', 'Remarque',
    ]);

    const ecotrac = await download('ecotrac');
    assert.deepEqual(ecotrac.headers, [
      'Nom Complet', 'Mobile', 'Wilaya', 'Commune', 'Designation', 'Montant', 'Note',
    ]);
    // Ecotrac's own shape, not an omission on our side.
    assert.ok(!ecotrac.headers.includes('Quantite'));
    assert.ok(ecom.records.some((r) => r.Nom === 'Both Formats'));
    assert.ok(ecotrac.records.some((r) => r['Nom Complet'] === 'Both Formats'));
  });

  test('money is the stored decimal, never a float', async () => {
    // M-06 made 37 money columns `numeric`. A price that reaches a spreadsheet
    // as 4499.989999999999 is that migration undone at the last step, and the
    // number a carrier collects in cash.
    await order({ client: 'Exact Price', price: '4499.99' });
    const row = (await download('zr')).records.find((r) => r.Nom === 'Exact Price');
    assert.equal(row!.Prix, '4499.99');
  });
});

/* -----------------------------------------------------------------------------
 * The file, as a file
 * -------------------------------------------------------------------------- */

describe('the response is a file, not a page', () => {
  test('it downloads, as CSV, under a dated name', async () => {
    const csv = await download('zr');
    assert.match(csv.contentType, /text\/csv/);
    assert.match(csv.contentType, /charset=utf-8/);
    assert.match(csv.disposition, /^attachment;/);
    assert.match(csv.disposition, /filename="ZR_Export_\d{4}-\d{2}-\d{2}\.csv"/);
  });

  test('it starts with a BOM, or Excel shows mojibake', async () => {
    // Without one, Excel reads the file as the machine's ANSI codepage: every
    // accented wilaya and every Arabic customer name comes out as noise, and
    // the operator's conclusion is that the export is broken.
    //
    // ASSERTED ON THE BYTES, not through `res.text()`. The WHATWG decoder
    // strips a leading BOM by specification, so a text-based assertion here
    // passes whether or not the byte was ever sent — a test that cannot fail,
    // guarding the three bytes Excel decides the whole file encoding from.
    await order({ client: 'Aïcha Benmokhtar', wilaya: 'Béjaïa' });

    const res = await fetch(`${BASE}/api/erp/orders/export?format=zr`, {
      headers: { cookie: `${SESSION_COOKIE}=${acme.manager.token}` },
    });
    assert.equal(res.status, 200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xef, 0xbb, 0xbf], 'no UTF-8 BOM');

    const text = new TextDecoder('utf-8').decode(bytes);
    assert.ok(text.includes('Aïcha Benmokhtar'), 'and the accents must survive');
    assert.ok(text.includes('Béjaïa'));
  });

  test('a comma, a quote and a newline survive the round trip', async () => {
    const made = await order({ client: 'Ali, "Le Grand"' });
    await acme.manager.api('PATCH', `/api/erp/orders/${made.id}`, {
      shippingNote: 'Rue 5, "porte bleue"',
    });

    const row = (await download('zr')).records.find((r) => r.Nom === 'Ali, "Le Grand"');
    assert.ok(row, 'a quoted field must parse back to exactly what went in');
    assert.equal(row!.Note, 'Rue 5, "porte bleue"');
  });

  test('a formula-shaped customer name cannot execute in a spreadsheet', async () => {
    // `client` arrives from a storefront checkout — a stranger types it — and
    // this file is opened by an operator on their own machine. Excel evaluates
    // a cell beginning `=`, `+`, `-` or `@`; `=cmd|…` has been a working
    // command-execution vector for years, and `=HYPERLINK(…&A1)` exfiltrates
    // the row next to it. The ERP was injectable in exactly the same way
    // through XLSX.utils.json_to_sheet.
    await order({ client: '=cmd|\' /c calc\'!A1' });

    const csv = await download('zr');
    const row = csv.records.find((r) => r.Nom.includes('cmd|'));
    assert.ok(row, 'the row must still be exported');
    assert.ok(row!.Nom.startsWith("'"), `the formula must be neutralised, got ${row!.Nom}`);
  });

  test('a negative total is still a number, not neutralised text', async () => {
    // The neutraliser must not mangle the values it was not written for: a
    // leading `-` on a price is a refund, and `'-500` in a Montant column is a
    // file the carrier's importer rejects.
    await order({ client: 'Refunded', price: '-500' });
    const row = (await download('ecotrac')).records.find((r) => r['Nom Complet'] === 'Refunded');
    assert.equal(row!.Montant, '-500');
  });

  test('nothing matching still produces a valid file with its headers', async () => {
    // An empty file with headers says "there were none". A 404 or an empty body
    // says "something went wrong", and the two need different reactions.
    const csv = await download('zr', '&wilaya=Nowhere-At-All');
    assert.equal(csv.status, 200);
    assert.deepEqual(csv.headers[0], 'Nom');
    assert.equal(csv.rows.length, 0);
  });
});

/* -----------------------------------------------------------------------------
 * The filter contract
 * -------------------------------------------------------------------------- */

describe('the export is the list, filtered the same way', () => {
  test('a filter narrows the export exactly as it narrows the list', async () => {
    // One vocabulary (D-LP.3). An export with its own idea of what a filter
    // means goes wrong silently and shows up as a carrier being handed the
    // wrong day's orders.
    const wilaya = `Wx${uid()}`;
    await order({ client: 'In The Filter', wilaya });
    await order({ client: 'Outside The Filter', wilaya: 'Oran' });

    const list = await acme.manager.api('GET', `/api/erp/orders?wilaya=${wilaya}&status=confirmed`);
    const csv = await download('zr', `&wilaya=${wilaya}`);

    assert.equal(csv.rows.length, list.body.data.total, 'the file and the list must agree on the count');
    assert.ok(csv.records.some((r) => r.Nom === 'In The Filter'));
    assert.ok(!csv.records.some((r) => r.Nom === 'Outside The Filter'));
  });

  test('a carrier file is confirmed orders, whatever status the caller asks for', async () => {
    // D-LP.6.3. Handing a courier an order nobody has confirmed is a real
    // delivery attempt against a customer who never agreed to one.
    const tag = `Ux${uid()}`;
    await order({ client: 'Never Called', wilaya: tag }, false);
    await order({ client: 'Confirmed One', wilaya: tag });

    const asked = await download('zr', `&wilaya=${tag}&status=pending`);
    assert.equal(asked.rows.length, 1, 'status=pending must not widen a carrier file');
    assert.equal(asked.records[0].Nom, 'Confirmed One');
  });

  test('the report format DOES honour a status filter', async () => {
    // The performance report is about the book, not about a delivery run, so
    // the rule above deliberately does not apply to it.
    const tag = `Rx${uid()}`;
    await order({ client: 'Report Pending', wilaya: tag }, false);
    await order({ client: 'Report Confirmed', wilaya: tag });

    const all = await download('orders', `&wilaya=${tag}`);
    assert.equal(all.rows.length, 2);

    const pending = await download('orders', `&wilaya=${tag}&status=pending`);
    assert.equal(pending.rows.length, 1);
    assert.equal(pending.records[0].Client, 'Report Pending');
  });

  test('a named date window resolves the same way it does for the list', async () => {
    const tag = `Dx${uid()}`;
    await order({ client: 'Today Order', wilaya: tag });

    const csv = await download('zr', `&wilaya=${tag}&range=today`);
    assert.equal(csv.rows.length, 1);

    const lastMonth = await download('zr', `&wilaya=${tag}&range=yesterday`);
    assert.equal(lastMonth.rows.length, 0, 'yesterday must not contain today’s order');
  });

  test('the page number is ignored — an export is not page 3', async () => {
    const tag = `Px${uid()}`;
    await order({ client: 'Paged A', wilaya: tag });
    await order({ client: 'Paged B', wilaya: tag });

    const csv = await download('zr', `&wilaya=${tag}&page=3&pageSize=1`);
    assert.equal(csv.rows.length, 2, 'a paged export would be a silent truncation');
  });

  test('an unknown format is refused, and the refusal names the valid set', async () => {
    const r = await acme.manager.api('GET', '/api/erp/orders/export?format=yalidine');
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INVALID_INPUT');
    assert.ok(Array.isArray(r.body.error.valid), 'the valid formats travel with the refusal');
    assert.ok(r.body.error.valid.includes('zr'));
  });
});

/* -----------------------------------------------------------------------------
 * Scope and permission
 * -------------------------------------------------------------------------- */

describe('an export cannot take out more than the caller can see', () => {
  test('an agent exports their own queue and not a colleague’s', async () => {
    // The property is "another AGENT's orders are absent", not "an agent sees
    // only what is assigned to them" — `orderScope` deliberately shows an agent
    // UNASSIGNED orders so unclaimed work can be picked up, and a test that
    // expected otherwise would be asserting a rule this product does not have.
    // LP.3 made exactly this mistake in the paging suite; the note is here so
    // the third person does not.
    const tag = `Sx${uid()}`;
    const colleague = await makeAgent(acme.tenantId);

    const mine = await order({ client: 'Agent Owned', wilaya: tag });
    await acme.manager.api('PATCH', `/api/erp/orders/${mine.id}`, { agentUserId: acme.agent.userId });
    const theirs = await order({ client: 'Colleague Owned', wilaya: tag });
    await acme.manager.api('PATCH', `/api/erp/orders/${theirs.id}`, { agentUserId: colleague.userId });

    const csv = asCsv(await acme.agent.api('GET', `/api/erp/orders/export?format=zr&wilaya=${tag}`));
    assert.equal(csv.status, 200, 'an agent may export what they can read');
    assert.ok(csv.records.some((r) => r.Nom === 'Agent Owned'));
    // `scopedWhere` ANDs the record scope in — the same rule the list applies,
    // and the reason an export cannot be used to widen what somebody can see.
    assert.ok(!csv.records.some((r) => r.Nom === 'Colleague Owned'), 'a colleague’s order leaked');
  });

  test('another tenant’s orders are not in anybody’s file', async () => {
    const beta = await makeErpTenant('export-beta');
    const betaCarrier = `bx${uid()}`;
    await beta.manager.api('POST', '/api/erp/carriers', { name: 'Beta', code: betaCarrier, adapter: 'mock' });
    const theirs = await beta.manager.api('POST', '/api/erp/orders', {
      client: 'Beta Customer', phone: phone(), wilaya: 'Oran', price: 1000, carrierCode: betaCarrier,
    });
    assert.equal(theirs.status, 201);

    const csv = await download('orders');
    assert.ok(!csv.raw.includes('Beta Customer'), 'a second tenant’s customer reached this file');
  });

  test('the agent report needs the permission that supervises people', async () => {
    // It is a league table of confirmation rates and suspicious-call counts.
    // `notifySuspiciousCall` withholds the same fact from the agent it is about,
    // for the same reason: telling somebody they were flagged tells them what
    // to change.
    assert.equal((await acme.agent.api('GET', '/api/erp/orders/export?format=agents')).status, 403);
    assert.equal((await acme.manager.api('GET', '/api/erp/orders/export?format=agents')).status, 200);
  });

  test('a signed-out visitor gets nothing', async () => {
    const res = await fetch(`${BASE}/api/erp/orders/export?format=zr`, { redirect: 'manual' });
    assert.equal(res.status, 401);
  });
});

/* -----------------------------------------------------------------------------
 * The performance report
 * -------------------------------------------------------------------------- */

describe('the performance report', () => {
  test('it carries the call count, the suspicious count and the latest note', async () => {
    const tag = `Cx${uid()}`;
    const made = await order({ client: 'Called Twice', wilaya: tag }, false);

    // Two calls, the second with a note. No `call-start` on either, which is
    // what the suspicious rule flags: a result logged without a call.
    await acme.manager.api('POST', `/api/erp/orders/${made.id}/call`, { result: 'no_answer' });
    await acme.manager.api('POST', `/api/erp/orders/${made.id}/call`, {
      result: 'confirmed', note: 'Rappeler après 18h',
    });

    const csv = await download('orders', `&wilaya=${tag}`);
    const row = csv.records.find((r) => r.Client === 'Called Twice');
    assert.ok(row, `the order is missing: ${csv.raw.slice(0, 400)}`);
    assert.equal(row!.Calls, '2');
    assert.equal(row!.LatestNote, 'Rappeler après 18h', 'the LATEST note, not the first');
    assert.ok(Number(row!.Suspicious) >= 1, 'a result with no call-start is suspicious');
  });

  test('the ID column is the number a human reads, not a cuid', async () => {
    const tag = `Ix${uid()}`;
    const made = await order({ client: 'Referenced', wilaya: tag });
    const row = (await download('orders', `&wilaya=${tag}`)).records.find(
      (r) => r.Client === 'Referenced',
    );
    assert.equal(row!.ID, made.reference);
    assert.notEqual(row!.ID, made.id);
  });

  test('the carrier column is the carrier’s name, not its code', async () => {
    const tag = `Nx${uid()}`;
    await order({ client: 'Has Carrier', wilaya: tag });
    const row = (await download('orders', `&wilaya=${tag}`)).records.find(
      (r) => r.Client === 'Has Carrier',
    );
    assert.equal(row!.Delivery, 'Export Carrier');
  });

  test('the agents sheet computes a confirmation rate over the same filtered set', async () => {
    const tag = `Ax${uid()}`;
    const a = await order({ client: 'Rate A', wilaya: tag });
    const b = await order({ client: 'Rate B', wilaya: tag }, false);
    for (const id of [a.id, b.id]) {
      await acme.manager.api('PATCH', `/api/erp/orders/${id}`, { agentUserId: acme.agent.userId });
    }

    const csv = await download('agents', `&wilaya=${tag}`);
    assert.deepEqual(csv.headers, ['Agent', 'Total', 'Confirmed', 'Rate', 'Suspicious']);
    const row = csv.records[0];
    assert.ok(row, `no agent row: ${csv.raw}`);
    assert.equal(row.Total, '2');
    assert.equal(row.Confirmed, '1');
    assert.equal(row.Rate, '50%');
  });
});

/* -----------------------------------------------------------------------------
 * The ticked rows
 * -------------------------------------------------------------------------- */

describe('exporting a selection', () => {
  test('the file contains exactly the ids that were sent', async () => {
    const wanted = await order({ client: 'Picked' });
    await order({ client: 'Not Picked' });

    const r = await acme.manager.api('POST', '/api/erp/orders/export', {
      format: 'orders', ids: [wanted.id],
    });
    const csv = asCsv(r);
    assert.equal(csv.status, 200);
    assert.equal(csv.rows.length, 1);
    assert.equal(csv.records[0].Client, 'Picked');
    assert.match(csv.disposition, /filename="CRM_Report_Orders_/);
  });

  test('an id from another tenant produces no row, and no oracle', async () => {
    // Silently absent rather than refused: a refusal naming the id would
    // confirm the row exists somewhere, which is the same reasoning behind
    // 404-not-403 everywhere else on this surface.
    const beta = await makeErpTenant('export-sel-beta');
    const betaCarrier = `sb${uid()}`;
    await beta.manager.api('POST', '/api/erp/carriers', { name: 'Beta', code: betaCarrier, adapter: 'mock' });
    const theirs = (await beta.manager.api('POST', '/api/erp/orders', {
      client: 'Beta Selected', phone: phone(), price: 900, carrierCode: betaCarrier,
    })).body.data.id as string;

    const mine = await order({ client: 'Mine Selected' });
    const csv = asCsv(
      await acme.manager.api('POST', '/api/erp/orders/export', {
        format: 'orders', ids: [mine.id, theirs],
      }),
    );
    assert.equal(csv.status, 200);
    assert.equal(csv.rows.length, 1);
    assert.equal(csv.records[0].Client, 'Mine Selected');
  });

  test('ticking an unconfirmed row does not put it in a carrier file', async () => {
    // The rule holds however the rows were chosen. Ticking is a deliberate act
    // and the constraint is not about intent: a courier collecting an order
    // nobody confirmed is a real visit to a customer who never agreed to one.
    const pending = await order({ client: 'Ticked But Pending' }, false);
    const ready = await order({ client: 'Ticked And Confirmed' });

    const csv = asCsv(
      await acme.manager.api('POST', '/api/erp/orders/export', {
        format: 'zr', ids: [pending.id, ready.id],
      }),
    );
    assert.equal(csv.status, 200);
    assert.equal(csv.rows.length, 1);
    assert.equal(csv.records[0].Nom, 'Ticked And Confirmed');

    // The report format has no such rule, so the same selection is both rows.
    const report = asCsv(
      await acme.manager.api('POST', '/api/erp/orders/export', {
        format: 'orders', ids: [pending.id, ready.id],
      }),
    );
    assert.equal(report.rows.length, 2);
  });

  test('an unbounded selection is refused', async () => {
    const r = await acme.manager.api('POST', '/api/erp/orders/export', {
      format: 'orders',
      ids: Array.from({ length: 201 }, (_, i) => `id-${i}`),
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INVALID_INPUT');
  });

  test('an empty selection is refused rather than exporting everything', async () => {
    // The failure this catches is the worst possible shape: a "export what I
    // ticked" button that ticks nothing and hands back the whole book.
    const r = await acme.manager.api('POST', '/api/erp/orders/export', {
      format: 'orders', ids: [],
    });
    assert.equal(r.status, 422);
  });
});
