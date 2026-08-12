import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createProductRegistry,
  ProductRegistryError,
  productRegistry,
  builtInProducts,
  erp,
  websiteBuilder,
} from '../src/index.ts';
import type { ProductManifest } from '../src/index.ts';

/* A product that does not exist. Several tests below mount it to prove the
 * platform needs no change to accept one. */
const emailMarketing: ProductManifest = {
  id: 'email-marketing',
  nameKey: 'product.emailMarketing.name',
  descriptionKey: 'product.emailMarketing.description',
  icon: 'mail',
  basePath: '/email',
  entitlement: 'product.email-marketing',
  permissions: ['email:read', 'email:campaigns:send'],
  nav: [
    { id: 'overview', titleKey: 'email.nav.overview', path: '', icon: 'layout-dashboard' },
    { id: 'campaigns', titleKey: 'email.nav.campaigns', path: 'campaigns', icon: 'send', permission: 'email:campaigns:send' },
  ],
  status: 'planned',
};

describe('the built-in registry', () => {
  test('holds exactly the products that ship today', () => {
    assert.deepEqual(
      productRegistry.list().map((p) => p.id).sort(),
      ['erp', 'website-builder'],
    );
  });

  test('neither product is privileged over the other', () => {
    // Equal standing is a product requirement, so it is asserted rather than
    // left to convention: same shape, same kind of entitlement, both stable.
    for (const p of builtInProducts) {
      assert.equal(p.status, 'stable');
      assert.ok(p.entitlement.startsWith('product.'));
      assert.ok(p.nav.length > 0, `${p.id} must contribute navigation`);
    }
  });

  test('platform surfaces are not duplicated into product navigation', () => {
    // A tenant with N products must still see ONE Settings, owned by the
    // shell. A product that ships its own is the first step to N of them.
    const platformOwned = ['settings', 'profile', 'billing', 'team', 'notifications'];
    for (const p of builtInProducts) {
      for (const item of p.nav) {
        assert.ok(
          !platformOwned.includes(item.id),
          `${p.id} declares "${item.id}", which the platform owns`,
        );
      }
    }
  });
});

describe('entitlements decide which products a tenant has', () => {
  test('a tenant subscribed to only the website builder sees only it', () => {
    const enabled = productRegistry.enabledFor(['product.website-builder']);
    assert.deepEqual(enabled.map((p) => p.id), ['website-builder']);
    assert.equal(productRegistry.isEnabled('erp', ['product.website-builder']), false);
  });

  test('a tenant subscribed to only the ERP sees only it', () => {
    const enabled = productRegistry.enabledFor(['product.erp']);
    assert.deepEqual(enabled.map((p) => p.id), ['erp']);
    assert.equal(productRegistry.isEnabled('website-builder', ['product.erp']), false);
  });

  test('a tenant on the bundle sees both', () => {
    const enabled = productRegistry.enabledFor(['product.erp', 'product.website-builder']);
    assert.deepEqual(enabled.map((p) => p.id).sort(), ['erp', 'website-builder']);
  });

  test('a tenant with no subscription sees nothing, and nothing throws', () => {
    assert.deepEqual(productRegistry.enabledFor([]), []);
  });

  test('an unrelated entitlement unlocks nothing', () => {
    assert.deepEqual(productRegistry.enabledFor(['product.something-else']), []);
  });

  test('isEnabled is false for a product that does not exist', () => {
    assert.equal(productRegistry.isEnabled('nope', ['product.erp']), false);
  });
});

describe('routing resolves a path to its owning product', () => {
  test('a product index and its sub-paths both resolve', () => {
    assert.equal(productRegistry.resolveByPath('/erp')?.id, 'erp');
    assert.equal(productRegistry.resolveByPath('/erp/orders')?.id, 'erp');
    assert.equal(productRegistry.resolveByPath('/builder/pages/abc')?.id, 'website-builder');
  });

  test('a platform path belongs to no product', () => {
    assert.equal(productRegistry.resolveByPath('/settings/team'), undefined);
    assert.equal(productRegistry.resolveByPath('/login'), undefined);
  });

  test('a prefix that merely starts the same does not match', () => {
    // /erpx is not inside /erp. Without the separator check it would be.
    assert.equal(productRegistry.resolveByPath('/erpx'), undefined);
    assert.equal(productRegistry.resolveByPath('/builderesque/x'), undefined);
  });

  test('the longer basePath wins when one is a prefix of another', () => {
    const r = createProductRegistry([
      { ...erp, id: 'a', basePath: '/shop', entitlement: 'e.a' },
      { ...erp, id: 'b', basePath: '/shop-pro', entitlement: 'e.b' },
    ]);
    assert.equal(r.resolveByPath('/shop-pro/x')?.id, 'b');
    assert.equal(r.resolveByPath('/shop/x')?.id, 'a');
  });
});

describe('navigation is filtered by permission', () => {
  test('an item with no permission is always visible', () => {
    const nav = productRegistry.navFor('erp', []);
    assert.ok(nav.some((i) => i.id === 'overview'));
    assert.ok(nav.some((i) => i.id === 'products'));
  });

  test('a permission-gated item is hidden without the grant', () => {
    const nav = productRegistry.navFor('erp', []);
    assert.ok(!nav.some((i) => i.id === 'agents'));
  });

  test('granting the permission reveals exactly that item', () => {
    const nav = productRegistry.navFor('erp', ['erp:agents:manage']);
    assert.ok(nav.some((i) => i.id === 'agents'));
    // The finances screen (id `calculator` since LB.25) needs erp:finance:read.
    assert.ok(!nav.some((i) => i.id === 'calculator'), 'unrelated grants stay hidden');
  });

  test('an unknown product yields no navigation rather than throwing', () => {
    assert.deepEqual(productRegistry.navFor('nope', ['anything']), []);
  });

  test('every permission referenced by nav is declared by its product', () => {
    // Otherwise the roles UI cannot offer the grant that would reveal the item.
    for (const p of builtInProducts) {
      for (const item of p.nav) {
        if (!item.permission) continue;
        assert.ok(
          p.permissions.includes(item.permission),
          `${p.id} nav "${item.id}" needs "${item.permission}", which ${p.id} does not declare`,
        );
      }
    }
  });

  test('every permission is namespaced with its product id EXACTLY', () => {
    // Exact, with no allowance for near-misses. This assertion previously
    // tolerated `builder:*` on a product whose id is `website-builder`, and
    // that gap was not cosmetic: authorization resolves a permission to its
    // product by splitting on the first colon, so a permission whose prefix is
    // not a registered product id resolves to nothing and skips the
    // entitlement gate entirely. Builder permissions were reachable by a
    // tenant that had never bought the builder.
    for (const p of builtInProducts) {
      for (const perm of p.permissions) {
        assert.ok(
          perm.startsWith(p.id + ':'),
          `"${perm}" must start with "${p.id}:" or it cannot be entitlement-gated`,
        );
      }
    }
  });

  test('a permission prefix always names a registered product', () => {
    const ids = new Set(builtInProducts.map((p) => p.id));
    for (const p of builtInProducts) {
      for (const perm of p.permissions) {
        assert.ok(ids.has(perm.split(':')[0]), `"${perm}" names no registered product`);
      }
    }
  });
});

describe('malformed manifests fail at construction, not at first click', () => {
  const bad = (m: Partial<ProductManifest>, expected: RegExp) => {
    assert.throws(
      () => createProductRegistry([{ ...websiteBuilder, ...m }]),
      (e: Error) => e instanceof ProductRegistryError && expected.test(e.message),
    );
  };

  test('duplicate product id', () => {
    assert.throws(
      () => createProductRegistry([websiteBuilder, websiteBuilder]),
      /duplicate product id/,
    );
  });

  test('two products claiming the same basePath', () => {
    assert.throws(
      () => createProductRegistry([erp, { ...websiteBuilder, basePath: '/erp' }]),
      /claimed by more than one product/,
    );
  });

  test('two products claiming the same entitlement', () => {
    assert.throws(
      () => createProductRegistry([erp, { ...websiteBuilder, entitlement: erp.entitlement }]),
      /subscribing to one would silently unlock the other/,
    );
  });

  test('a basePath reserved by the platform', () => {
    bad({ basePath: '/settings' }, /reserved basePath/);
    bad({ basePath: '/api' }, /reserved basePath/);
  });

  test('a malformed basePath', () => {
    bad({ basePath: 'builder' }, /leading slash/);
    bad({ basePath: '/builder/' }, /trailing slash|leading slash/);
    bad({ basePath: '/Builder' }, /lowercase|leading slash/);
  });

  test('a malformed product id', () => {
    bad({ id: 'Website_Builder' }, /kebab-case/);
    bad({ id: '' }, /kebab-case/);
  });

  test('a product with no entitlement could never be unlocked', () => {
    bad({ entitlement: '' }, /declares no entitlement/);
  });

  test('an absolute nav path, which would escape the product', () => {
    bad(
      { nav: [{ id: 'x', titleKey: 't', path: '/orders', icon: 'i' }] },
      /must not start with a slash/,
    );
  });

  test('duplicate nav ids within one product', () => {
    bad(
      {
        nav: [
          { id: 'dup', titleKey: 'a', path: 'a', icon: 'i' },
          { id: 'dup', titleKey: 'b', path: 'b', icon: 'i' },
        ],
      },
      /duplicate nav id/,
    );
  });
});

describe('the platform does not assume how many products exist', () => {
  // This is the requirement the whole package exists to satisfy: going from
  // two products to three must touch the new product's files and nothing
  // else. Every assertion below runs against a registry built by ADDING a
  // manifest — no platform code is modified anywhere in this block.

  test('a third product registers with no change to platform code', () => {
    const r = createProductRegistry([...builtInProducts, emailMarketing]);
    assert.equal(r.list().length, 3);
    assert.equal(r.get('email-marketing')?.basePath, '/email');
  });

  test('it routes, entitles and navigates like any other product', () => {
    const r = createProductRegistry([...builtInProducts, emailMarketing]);
    assert.equal(r.resolveByPath('/email/campaigns')?.id, 'email-marketing');
    assert.deepEqual(
      r.enabledFor(['product.email-marketing']).map((p) => p.id),
      ['email-marketing'],
    );
    assert.deepEqual(
      r.navFor('email-marketing', ['email:campaigns:send']).map((i) => i.id),
      ['overview', 'campaigns'],
    );
  });

  test('any combination of three products resolves correctly', () => {
    const r = createProductRegistry([...builtInProducts, emailMarketing]);
    const keys = { erp: 'product.erp', wb: 'product.website-builder', em: 'product.email-marketing' };
    const combos: [string[], string[]][] = [
      [[], []],
      [[keys.erp], ['erp']],
      [[keys.wb], ['website-builder']],
      [[keys.em], ['email-marketing']],
      [[keys.erp, keys.wb], ['erp', 'website-builder']],
      [[keys.erp, keys.em], ['email-marketing', 'erp']],
      [[keys.wb, keys.em], ['email-marketing', 'website-builder']],
      [[keys.erp, keys.wb, keys.em], ['email-marketing', 'erp', 'website-builder']],
    ];
    for (const [held, expected] of combos) {
      assert.deepEqual(
        r.enabledFor(held).map((p) => p.id).sort(),
        expected,
        `entitlements [${held.join(', ')}] should enable [${expected.join(', ')}]`,
      );
    }
  });

  test('a planned product is registered but still gated by its entitlement', () => {
    // Declaring a product before it is built must not expose it to anyone.
    const r = createProductRegistry([...builtInProducts, emailMarketing]);
    assert.equal(r.get('email-marketing')?.status, 'planned');
    assert.deepEqual(r.enabledFor(['product.erp']).map((p) => p.id), ['erp']);
  });

  test('permissions from every product are enumerable in one place', () => {
    const r = createProductRegistry([...builtInProducts, emailMarketing]);
    const all = r.allPermissions();
    assert.ok(all.includes('erp:orders:read'));
    assert.ok(all.includes('website-builder:pages:write'));
    assert.ok(all.includes('email:campaigns:send'));
    assert.equal(new Set(all).size, all.length, 'no duplicates');
  });

  test('a registry with a single product works', () => {
    const r = createProductRegistry([erp]);
    assert.equal(r.list().length, 1);
    assert.equal(r.resolveByPath('/erp')?.id, 'erp');
  });

  test('an empty registry works — a platform with no products yet', () => {
    const r = createProductRegistry([]);
    assert.deepEqual(r.list(), []);
    assert.deepEqual(r.enabledFor(['anything']), []);
    assert.equal(r.resolveByPath('/erp'), undefined);
    assert.deepEqual(r.allPermissions(), []);
  });
});
