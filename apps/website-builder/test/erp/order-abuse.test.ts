import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { withTenant, asPlatform } from '@landingos/db';

import {
  skip, uid, phone, makeErpTenant, slugOf,
  storefront, checkout, draftToken, cleanup,
  contractTest as test,
  type Storefront,
} from './helpers.ts';
import {
  hashClientIp,
  rulesFrom,
  windowStart,
  anyRuleArmed,
  SHARED_NETWORK_DEVICE_FLOOR,
} from '../../src/lib/erp/order-abuse.ts';
import { checkoutMessage, CHECKOUT_CATALOGUES } from '../../src/lib/storefront/checkout-messages.ts';

/* =============================================================================
 * test/erp/order-abuse.test.ts — SEC.12.
 *
 * THE THREAT these tests are written against: one person at one machine
 * placing order after order with a fresh name, phone and address every time.
 * Sabotage, not fraud — nobody wants the goods, they want the call-centre's
 * day burned and the delivery statistics poisoned.
 *
 * That is why the phone key cannot carry this feature and why the device and
 * network keys exist. It is also why the most important assertions here are
 * the NEGATIVE ones: a rule that catches the saboteur and also catches four
 * real customers behind a carrier NAT is worse than no rule, because the badge
 * gets ignored inside a fortnight.
 *
 * The pure half runs with no server (the calc.ts rule); the rest drives the
 * real checkout route.
 * ========================================================================== */

let erp: Awaited<ReturnType<typeof makeErpTenant>>;
let erpSlug = '';
let shop: Storefront;

/** Point one tenant's rules wherever a test needs them. */
async function configure(settings: Record<string, unknown>) {
  await withTenant(erp.tenantId, async (db) => {
    for (const [key, value] of Object.entries(settings)) {
      await db.productSetting.upsert({
        where: { tenantId_product_key: { tenantId: erp.tenantId, product: 'erp', key } },
        create: { tenantId: erp.tenantId, product: 'erp', key, value: value as never },
        update: { value: value as never },
      });
    }
  });
}

/** Everything off, so one test's configuration cannot leak into the next. */
const ALL_OFF = {
  orderAbuseDeviceMode: 'off',
  orderAbuseNetworkMode: 'off',
  orderAbusePhoneMode: 'off',
  orderAbuseWindowMinutes: 1440,
};

/** A checkout carrying a device token, which the helper does not send. */
async function order(
  extra: { device?: string; phone?: string; name?: string; ip?: string } = {},
) {
  const res = await fetch(`${process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000'}/api/storefront/${erpSlug}/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // SEC.10 reads this when the deployment trusts Cloudflare, which the
      // suite's server does; it is how a test gives each "customer" its own
      // address without needing a second machine.
      ...(extra.ip ? { 'cf-connecting-ip': extra.ip } : {}),
    },
    body: JSON.stringify({
      landingPageId: shop.page.id,
      customerName: extra.name ?? `Buyer ${uid()}`,
      phone: extra.phone ?? phone(),
      wilayaId: shop.wilaya.id,
      baladiaName: shop.baladiaName,
      address: '12 Rue de Test',
      quantity: 1,
      shippingMethod: 'HOME',
      draftToken: draftToken(),
      ...(extra.device ? { deviceToken: extra.device } : {}),
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const reviewOf = (salesOrderId: string) =>
  withTenant(erp.tenantId, (db) =>
    db.fulfillmentOrder.findUnique({
      where: { salesOrderId },
      select: { reviewReason: true, reviewFlaggedAt: true, classification: true, status: true, agentUserId: true },
    }),
  );

before(async () => {
  if (skip) return;
  erp = await makeErpTenant('abuse');
  erpSlug = await slugOf(erp.tenantId);
  shop = await storefront(erp.tenantId);
  await configure(ALL_OFF);
});

after(async () => {
  if (skip) return;
  await cleanup();
});

/* -----------------------------------------------------------------------------
 * Pure — no server, no database.
 * -------------------------------------------------------------------------- */

describe('SEC.12 pure — hashing, rules, window', () => {
  test('the address is hashed, never recoverable, and stable', () => {
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 'test-secret-for-hashing';
    try {
      const a = hashClientIp('41.100.1.5');
      const b = hashClientIp('41.100.1.5');
      const c = hashClientIp('41.100.1.6');
      assert.equal(a, b, 'the same address groups with itself');
      assert.notEqual(a, c, 'different addresses do not collide');
      assert.ok(a && !a.includes('41.100'), 'the address must not survive into the hash');
      assert.match(a!, /^[0-9a-f]{32}$/);

      // A different key gives a different pseudonym — which is why rotating
      // AUTH_SECRET breaks historical grouping, and why that is documented.
      process.env.AUTH_SECRET = 'a-different-secret';
      assert.notEqual(hashClientIp('41.100.1.5'), a);
    } finally {
      if (previous === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previous;
    }
  });

  test('no address means no bucket, rather than everyone sharing one', () => {
    assert.equal(hashClientIp(null), null);
    assert.equal(hashClientIp(''), null);
    assert.equal(hashClientIp('   '), null);
  });

  test('the shipped defaults are device=block, network=flag, phone=off', () => {
    const rules = rulesFrom({});
    assert.deepEqual(
      rules.map((r) => [r.key, r.mode, r.max]),
      [['device', 'off', 3], ['network', 'off', 3], ['phone', 'off', 3]],
      'with NO settings supplied every key is off — the fail-safe direction',
    );

    // The real defaults come from DEFAULT_SETTINGS, which readSettings overlays.
    const shipped = rulesFrom({
      orderAbuseDeviceMode: 'block',
      orderAbuseNetworkMode: 'flag',
      orderAbusePhoneMode: 'off',
    });
    assert.deepEqual(shipped.map((r) => r.mode), ['block', 'flag', 'off']);
  });

  test('junk modes and counts fall back rather than throwing at a customer', () => {
    const rules = rulesFrom({
      orderAbuseDeviceMode: 'BLOCK!!' as never,
      orderAbuseDeviceMax: -4 as never,
      orderAbuseNetworkMax: 2.5 as never,
    });
    assert.equal(rules[0].mode, 'off', 'an unknown mode disarms rather than guessing');
    assert.equal(rules[0].max, 3);
    assert.equal(rules[1].max, 3, 'a fractional count is not a count');
  });

  test('anyRuleArmed keeps the ordinary path free of queries', () => {
    assert.equal(anyRuleArmed({}), false);
    assert.equal(anyRuleArmed({ orderAbuseDeviceMode: 'off', orderAbuseNetworkMode: 'off' }), false);
    assert.equal(anyRuleArmed({ orderAbuseNetworkMode: 'flag' }), true);
  });

  test('the window is minutes back from now, and defaults to a day', () => {
    const now = new Date('2026-08-23T12:00:00Z');
    assert.equal(windowStart({}, now).toISOString(), '2026-08-22T12:00:00.000Z');
    assert.equal(
      windowStart({ orderAbuseWindowMinutes: 60 }, now).toISOString(),
      '2026-08-23T11:00:00.000Z',
    );
  });

  test('every checkout refusal speaks every locale', () => {
    const codes = Object.keys(CHECKOUT_CATALOGUES.en);
    for (const [locale, catalogue] of Object.entries(CHECKOUT_CATALOGUES)) {
      for (const code of codes) {
        const text = (catalogue as Record<string, string>)[code];
        assert.ok(text && text.trim().length > 0, `${locale}.${code} is missing`);
      }
    }
    // Arabic is the fallback for a shop whose locale we do not speak, and the
    // fallback must never be the English string.
    assert.equal(checkoutMessage('kl', 'ORDER_REFUSED'), CHECKOUT_CATALOGUES.ar.ORDER_REFUSED);
    assert.equal(checkoutMessage(null, 'ORDER_REFUSED'), CHECKOUT_CATALOGUES.ar.ORDER_REFUSED);
    assert.equal(checkoutMessage('fr', 'UNDELIVERABLE'), CHECKOUT_CATALOGUES.fr.UNDELIVERABLE);
  });

  test('the refusal never tells the customer what the limit is', () => {
    for (const catalogue of Object.values(CHECKOUT_CATALOGUES)) {
      const text = catalogue.ORDER_REFUSED;
      assert.ok(!/\d/.test(text), `"${text}" leaks a number a saboteur could tune against`);
      assert.ok(
        !/too many|trop de|كثير/i.test(text),
        `"${text}" accuses the customer instead of pointing at a human`,
      );
    }
  });
});

/* -----------------------------------------------------------------------------
 * The device key — BLOCK by default.
 * -------------------------------------------------------------------------- */

describe('SEC.12 device key — one browser, many invented customers', () => {
  test('THE SABOTEUR: a third order from the same device is refused outright', async () => {
    await configure({ ...ALL_OFF, orderAbuseDeviceMode: 'block', orderAbuseDeviceMax: 3 });
    const device = `dev-${uid()}`;

    /* Every order a different person on paper — which is exactly the attack.
     * `max: 3` ALLOWS three and refuses the fourth: the setting is how many
     * the window permits, not the ordinal that trips. */
    for (const name of ['Ahmed', 'Yacine', 'Karim']) {
      const r = await order({ device, name: `${name} ${uid()}` });
      assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.body)}`);
    }

    const fourth = await order({ device, name: `Sofiane ${uid()}` });
    assert.equal(fourth.status, 403, JSON.stringify(fourth.body));
    assert.equal(fourth.body.error.code, 'ORDER_REFUSED');

    // Refused BEFORE anything was written: no sale, no ERP row, no courier.
    const sales = await withTenant(erp.tenantId, (db) =>
      (db as any).salesOrder.count({ where: { deviceToken: device } }),
    );
    assert.equal(sales, 3, 'the blocked attempt wrote nothing');
  });

  test('the refusal is in the shop language, and names no number', async () => {
    await configure({ ...ALL_OFF, orderAbuseDeviceMode: 'block', orderAbuseDeviceMax: 1 });
    const device = `dev-${uid()}`;
    await order({ device });
    const blocked = await order({ device });

    assert.equal(blocked.status, 403);
    const message = blocked.body.error.message as string;
    assert.equal(message, CHECKOUT_CATALOGUES.ar.ORDER_REFUSED, 'the fixture tenant is Arabic');
    assert.ok(!/[A-Za-z]{4,}/.test(message), 'no English leaking onto an RTL page');
  });

  test('in FLAG mode the sale completes and the ERP row carries the reason', async () => {
    await configure({ ...ALL_OFF, orderAbuseDeviceMode: 'flag', orderAbuseDeviceMax: 1 });
    const device = `dev-${uid()}`;
    await order({ device });
    const flagged = await order({ device });

    assert.equal(flagged.status, 201, 'flagging refuses nothing');
    const row = await reviewOf(flagged.body.data.id);
    assert.equal(row!.reviewReason, 'device');
    assert.ok(row!.reviewFlaggedAt instanceof Date);

    // The human verdict column is untouched, and the row stays workable.
    assert.equal(row!.classification, '', 'a rule must never write the fake verdict');
    assert.equal(row!.status, 'pending', 'it stays in the normal queue');
  });

  test('a DIFFERENT device is a different customer and is unaffected', async () => {
    await configure({ ...ALL_OFF, orderAbuseDeviceMode: 'block', orderAbuseDeviceMax: 1 });
    await order({ device: `dev-${uid()}` });
    const other = await order({ device: `dev-${uid()}` });
    assert.equal(other.status, 201, 'one saboteur must not close the shop');
  });

  test('a missing device token is never held against a customer', async () => {
    // Private browsing sends none. Three orders, no token, block mode armed.
    await configure({ ...ALL_OFF, orderAbuseDeviceMode: 'block', orderAbuseDeviceMax: 1 });
    for (let i = 0; i < 3; i++) {
      const r = await order({});
      assert.equal(r.status, 201, `tokenless order ${i + 1} must go through`);
    }
  });

  test('off means off — no counting, no flag, whatever the volume', async () => {
    await configure(ALL_OFF);
    const device = `dev-${uid()}`;
    for (let i = 0; i < 4; i++) {
      const r = await order({ device });
      assert.equal(r.status, 201);
      assert.equal((await reviewOf(r.body.data.id))!.reviewReason, null);
    }
  });
});

/* -----------------------------------------------------------------------------
 * The network key — FLAG, and the discriminator that makes it safe.
 * -------------------------------------------------------------------------- */

describe('SEC.12 network key — and the carrier it must not punish', () => {
  test('many orders from ONE device on one address are flagged', async () => {
    await configure({ ...ALL_OFF, orderAbuseNetworkMode: 'flag', orderAbuseNetworkMax: 2 });
    const ip = `41.111.${Math.floor(Math.random() * 250) + 1}.9`;
    const device = `dev-${uid()}`;

    await order({ ip, device });
    await order({ ip, device });
    const third = await order({ ip, device });

    assert.equal(third.status, 201, 'the network key flags, it does not block');
    const row = await reviewOf(third.body.data.id);
    assert.ok(row!.reviewReason?.includes('network'), `expected network, got ${row!.reviewReason}`);
  });

  test('THE ONE THAT MATTERS: the same volume from MANY devices is left alone', async () => {
    /* A carrier NAT. Same public address, different real customers behind it.
     * Counting them together would punish each for the others — the shared
     * bucket failure SEC.10 was fixed for, one layer up. */
    await configure({ ...ALL_OFF, orderAbuseNetworkMode: 'flag', orderAbuseNetworkMax: 2 });
    const ip = `41.222.${Math.floor(Math.random() * 250) + 1}.9`;

    /* Exactly at the boundary and one past it. The THIRD customer is the one
     * that used to fail: only two devices were on record when they arrived, so
     * the address did not yet look shared and they were flagged for being
     * early. The requesting device now counts toward that evidence. */
    const placed: Array<{ status: number; body: any }> = [];
    for (let i = 0; i < SHARED_NETWORK_DEVICE_FLOOR + 1; i++) {
      placed.push(await order({ ip, device: `dev-${uid()}` }));
    }

    for (const [i, r] of placed.entries()) {
      assert.equal(r.status, 201, `customer ${i + 1} refused`);
      const row = await reviewOf(r.body.data.id);
      assert.equal(
        row!.reviewReason,
        null,
        `customer ${i + 1} was flagged for sharing a carrier address with strangers`,
      );
    }
  });

  test('both keys tripping names both, so an agent sees the whole picture', async () => {
    await configure({
      ...ALL_OFF,
      orderAbuseDeviceMode: 'flag',
      orderAbuseDeviceMax: 1,
      orderAbuseNetworkMode: 'flag',
      orderAbuseNetworkMax: 1,
    });
    const ip = `41.133.${Math.floor(Math.random() * 250) + 1}.9`;
    const device = `dev-${uid()}`;
    await order({ ip, device });
    const second = await order({ ip, device });

    const row = await reviewOf(second.body.data.id);
    assert.equal(row!.reviewReason, 'device+network');
  });

  test('block on the device key still blocks even when network only flags', async () => {
    await configure({
      ...ALL_OFF,
      orderAbuseDeviceMode: 'block',
      orderAbuseDeviceMax: 1,
      orderAbuseNetworkMode: 'flag',
      orderAbuseNetworkMax: 1,
    });
    const ip = `41.144.${Math.floor(Math.random() * 250) + 1}.9`;
    const device = `dev-${uid()}`;
    await order({ ip, device });
    const second = await order({ ip, device });
    assert.equal(second.status, 403, 'any blocking key blocks');
  });
});

/* -----------------------------------------------------------------------------
 * The phone key — unarmed by default, and cross-channel when armed.
 * -------------------------------------------------------------------------- */

describe('SEC.12 phone key — the one the saboteur defeats, kept for the case he is not', () => {
  test('it is OFF by default, so randomised phones cost nothing to nobody', async () => {
    await configure(ALL_OFF);
    const number = phone();
    for (let i = 0; i < 3; i++) {
      const r = await order({ phone: number });
      assert.equal((await reviewOf(r.body.data.id))!.reviewReason, null);
    }
  });

  test('armed, it flags a repeated number and folds spacing the way the ERP does', async () => {
    await configure({ ...ALL_OFF, orderAbusePhoneMode: 'flag', orderAbusePhoneMax: 2 });
    const digits = phone();
    const spaced = digits.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4');

    await order({ phone: digits });
    await order({ phone: spaced });
    const third = await order({ phone: digits });

    const row = await reviewOf(third.body.data.id);
    assert.ok(
      row!.reviewReason?.includes('phone'),
      'a spaced number is the same customer, as normalizePhone already decides everywhere else',
    );
  });

  test('a randomised phone defeats it — which is why the device key exists', async () => {
    await configure({ ...ALL_OFF, orderAbusePhoneMode: 'flag', orderAbusePhoneMax: 1 });
    for (let i = 0; i < 3; i++) {
      const r = await order({ phone: phone() });
      assert.equal(
        (await reviewOf(r.body.data.id))!.reviewReason,
        null,
        'stated plainly: the phone key cannot see this attack',
      );
    }
  });
});

/* -----------------------------------------------------------------------------
 * The interaction that made these two ship together.
 * -------------------------------------------------------------------------- */

describe('SEC.12 x SEC.11 — a retry is not a second order', () => {
  test('THE LOAD-BEARING ORDER: six retries do not spend the abuse budget', async () => {
    /* Without idempotency in front, six retries of ONE purchase are six rows
     * and a threshold of three refuses a customer for a network problem we
     * caused. This is the assertion that pins the ordering. */
    await configure({ ...ALL_OFF, orderAbuseDeviceMode: 'block', orderAbuseDeviceMax: 3 });
    const device = `dev-${uid()}`;
    const token = draftToken();
    const number = phone();

    const base = {
      landingPageId: shop.page.id,
      customerName: 'Retry Under Throttle',
      phone: number,
      wilayaId: shop.wilaya.id,
      baladiaName: shop.baladiaName,
      address: '12 Rue de Test',
      quantity: 1,
      shippingMethod: 'HOME',
      draftToken: token,
      deviceToken: device,
    };
    const send = () =>
      fetch(`${process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000'}/api/storefront/${erpSlug}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(base),
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

    const results = await Promise.all(Array.from({ length: 6 }, send));
    for (const r of results) {
      assert.notEqual(r.status, 403, 'a retry storm must never look like sabotage');
      assert.equal(r.body.success, true, JSON.stringify(r.body));
    }
    assert.equal(new Set(results.map((r) => r.body.data.id)).size, 1, 'one order');

    const sales = await withTenant(erp.tenantId, (db) =>
      (db as any).salesOrder.count({ where: { deviceToken: device } }),
    );
    assert.equal(sales, 1, 'one row, so one unit of budget spent');

    // And the budget really is intact: two more genuine purchases still pass.
    assert.equal((await order({ device })).status, 201);
    assert.equal((await order({ device })).status, 201);
  });
});

/* -----------------------------------------------------------------------------
 * Reachability — the LB.23b lesson.
 * -------------------------------------------------------------------------- */

describe('SEC.12 reachability — the flag exists on the RENDERED screen', () => {
  test('the badge, the filter, and the by-device view are all really there', async () => {
    await configure({ ...ALL_OFF, orderAbuseDeviceMode: 'flag', orderAbuseDeviceMax: 1 });
    const device = `dev-${uid()}`;
    await order({ device });
    const flagged = await order({ device });
    assert.equal(flagged.status, 201);

    const screen = async (query: string) => {
      const res = await fetch(
        `${process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000'}/console/erp/orders${query}`,
        { redirect: 'manual', headers: { cookie: `landingos_session=${erp.manager.token}; locale=en` } },
      );
      return { status: res.status, html: await res.text() };
    };

    /* A route test cannot see that nothing reaches the route — LB.23b shipped
     * seventeen passing route tests for a feature no screen could reach, and
     * LB.23d had to go back for the button. So these assertions are against
     * the rendered HTML. */
    const list = await screen('');
    assert.equal(list.status, 200);
    assert.ok(list.html.includes('data-badge="review"'), 'the badge renders on the row');
    assert.ok(
      list.html.includes('data-review-reason="device"'),
      'and it names which rule fired, not just that one did',
    );
    assert.ok(list.html.includes('name="review"'), 'the filter control is on the screen');

    // The filter narrows to flagged rows and keeps the flagged one.
    const filtered = await screen('?review=any');
    assert.equal(filtered.status, 200);
    assert.ok(filtered.html.includes('data-badge="review"'), 'the flagged order survives its own filter');

    // Q7's investigation view: every order this browser ever placed.
    const byDevice = await screen(`?deviceToken=${encodeURIComponent(device)}`);
    assert.equal(byDevice.status, 200);
    assert.ok(
      byDevice.html.includes('data-badge="review"'),
      'the by-device view finds the orders that share a browser',
    );

    // A device nobody used returns the screen, empty of these rows — proving
    // the filter FILTERS rather than being ignored.
    const empty = await screen(`?deviceToken=dev-nobody-${uid()}`);
    assert.equal(empty.status, 200);
    assert.ok(!empty.html.includes('data-badge="review"'), 'an unknown device matches nothing');
  });
});

describe('SEC.12 reachability — the SETTINGS screen really offers the controls', () => {
  test('all seven knobs render, with real labels and real option text', async () => {
    /* "Declaring the keys in SETTINGS_SCHEMA is the whole UI" is a claim about
     * a screen, so it is asserted against the screen. It was very nearly
     * wrong: that page labelled every enum option with a HARDCODED
     * `erp.settings.reservation.<value>` key, so the first new enum setting
     * would have thrown MISSING_MESSAGE and taken the settings screen down
     * with a 500 — a latent trap left by there having only ever been one enum. */
    const res = await fetch(
      `${process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000'}/console/erp/automation`,
      { redirect: 'manual', headers: { cookie: `landingos_session=${erp.manager.token}; locale=en` } },
    );
    assert.equal(res.status, 200, 'the settings screen still renders at all');
    const html = await res.text();

    for (const key of [
      'orderAbuseWindowMinutes',
      'orderAbuseDeviceMode', 'orderAbuseDeviceMax',
      'orderAbuseNetworkMode', 'orderAbuseNetworkMax',
      'orderAbusePhoneMode', 'orderAbusePhoneMax',
    ]) {
      assert.ok(html.includes(key), `${key} has no control on the settings screen`);
    }

    // The labels resolved rather than falling back to the raw key, and the
    // mode options read as words rather than as "off"/"flag"/"block".
    assert.ok(html.includes('Max orders per device'), 'the device count is labelled');
    assert.ok(html.includes('Refuse the order'), 'the block option has its own wording');
    assert.ok(html.includes('Flag for review'), 'and so does the flag option');
    assert.ok(
      !html.includes('erp.settings.orderAbuse'),
      'an unresolved translation key must never reach the page',
    );
  });
});

/* -----------------------------------------------------------------------------
 * Isolation.
 * -------------------------------------------------------------------------- */

describe('SEC.12 isolation — one company cannot spend another company budget', () => {
  test('the same device in another tenant is counted separately', async () => {
    await configure({ ...ALL_OFF, orderAbuseDeviceMode: 'block', orderAbuseDeviceMax: 1 });
    const other = await makeErpTenant('abuse-other');
    const otherSlug = await slugOf(other.tenantId);
    const otherShop = await storefront(other.tenantId);

    const device = `dev-${uid()}`;
    assert.equal((await order({ device })).status, 201);
    assert.equal((await order({ device })).status, 403, 'blocked in the configured tenant');

    // The other tenant never armed anything, and RLS means the count could not
    // have seen these rows even if it had.
    const res = await fetch(
      `${process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000'}/api/storefront/${otherSlug}/orders`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          landingPageId: otherShop.page.id,
          customerName: 'Neighbour',
          phone: phone(),
          wilayaId: otherShop.wilaya.id,
          baladiaName: otherShop.baladiaName,
          address: '1 rue',
          quantity: 1,
          shippingMethod: 'HOME',
          deviceToken: device,
        }),
      },
    );
    assert.equal(res.status, 201, 'a neighbour tenant is unaffected');
  });

  test('a tenant without the ERP is never judged, and never crashes trying', async () => {
    // The rules live in ERP settings and write to an ERP row. A builder-only
    // tenant has neither, so the whole engine must sit out rather than half-run.
    const builderOnly = await asPlatform().tenant.create({
      data: { slug: `abuse-builder-${uid()}`, name: 'Builder Only' },
    });
    await withTenant(builderOnly.id, (db) =>
      (db as any).subscription.create({
        data: { tenantId: builderOnly.id, status: 'ACTIVE', entitlements: ['product.website-builder'] },
      }),
    );
    const theirShop = await storefront(builderOnly.id);
    const theirSlug = builderOnly.slug;
    const device = `dev-${uid()}`;

    for (let i = 0; i < 4; i++) {
      const res = await fetch(
        `${process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000'}/api/storefront/${theirSlug}/orders`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            landingPageId: theirShop.page.id,
            customerName: `Builder Buyer ${i}`,
            phone: phone(),
            wilayaId: theirShop.wilaya.id,
            baladiaName: theirShop.baladiaName,
            address: '1 rue',
            quantity: 1,
            shippingMethod: 'HOME',
            deviceToken: device,
          }),
        },
      );
      assert.equal(res.status, 201, `builder-only order ${i + 1} must go through`);
    }
  });
});
