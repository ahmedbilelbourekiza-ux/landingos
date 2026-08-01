import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/* =============================================================================
 * Enforces M-03 (tenantId everywhere) and M-04 (unique constraints rescoped)
 * against the schema itself.
 *
 * The architecture calls a missed constraint the subtlest failure mode in the
 * programme, and commits to a mitigation that is "mechanical, not vigilant".
 * This is that mechanism. Every exemption below is an explicit, named entry
 * that has to be justified in CONSTRAINTS.md — so leaving tenantId off a model
 * fails the build rather than surviving review.
 *
 * Reads the .prisma files as text on purpose. Prisma exposes no stable
 * programmatic AST, and a regex over a file whose shape we control is more
 * honest than depending on an internal API that changes between minors.
 * ========================================================================== */

const SCHEMA_DIR = path.join(import.meta.dirname, '..', 'prisma', 'schema');

/**
 * Models that legitimately have no tenantId. Each is here for a stated reason
 * and nothing may be added without one.
 */
const NOT_TENANT_SCOPED = new Set([
  // Platform tenancy and identity. These OWN or SPAN tenants; they cannot be
  // scoped to one.
  'Tenant',
  'TenantDomain',
  'User',
  'Membership',   // carries tenantId, but as half of its own identity
  'Session',
  'Invitation',
  'Subscription',

  // Platform reference data — facts about Algeria, shared by every tenant.
  'Wilaya',
  'Baladia',
]);

/**
 * Unique constraints that stay global. Keyed "Model.field" — see the
 * "Deliberately global" section of CONSTRAINTS.md for the reasoning on each.
 */
const GLOBAL_UNIQUES = new Set([
  'Tenant.slug',              // public routing namespace (D2, R-08)
  'TenantDomain.domain',      // a hostname resolves to one tenant by definition
  'User.email',               // one person, one login, across every tenant
  'Invitation.token',         // followed from email before a session exists
  'Subscription.tenantId',    // one subscription per tenant — already scoped
  'Wilaya.code',              // platform reference data
  'DraftOrder.token',         // unauthenticated upsert key, resolved tenant-blind
  'LandingSetting.landingPageId', // 1:1; Prisma requires the FK itself unique
  'StoreSettings.tenantId',   // the primary key IS the tenant

  // Issued by the browser's push service and unique by construction. Scoping
  // it per-tenant would let one physical device register twice and receive
  // every notification in duplicate.
  'PushSubscription.endpoint',
]);

interface Model {
  name: string;
  body: string;
  file: string;
}

function loadModels(): Model[] {
  const models: Model[] = [];
  for (const file of fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.prisma'))) {
    const src = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8');
    for (const m of src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      models.push({ name: m[1], body: m[2], file });
    }
  }
  return models;
}

const models = loadModels();
const tenantScoped = models.filter((m) => !NOT_TENANT_SCOPED.has(m.name));

/** Field-level `@unique` declarations, as "Model.field". */
function fieldUniques(m: Model): string[] {
  const out: string[] = [];
  for (const line of m.body.split('\n')) {
    const stripped = line.replace(/\/\/.*/, '');
    if (!/@unique\b/.test(stripped)) continue;
    const field = stripped.trim().match(/^(\w+)/);
    if (field) out.push(`${m.name}.${field[1]}`);
  }
  return out;
}

/** Block-level `@@unique([...])` declarations, as arrays of field names. */
function blockUniques(m: Model): string[][] {
  return [...m.body.matchAll(/@@unique\(\[([^\]]+)\]/g)].map((x) =>
    x[1].split(',').map((s) => s.trim()),
  );
}

function blockIndexes(m: Model): string[][] {
  return [...m.body.matchAll(/@@index\(\[([^\]]+)\]/g)].map((x) =>
    x[1].split(',').map((s) => s.trim()),
  );
}

describe('the schema loaded at all', () => {
  test('models were found across every domain file', () => {
    assert.ok(models.length >= 25, `expected the full schema, found ${models.length} models`);
    const files = new Set(models.map((m) => m.file));
    assert.ok(files.has('platform.prisma'), 'platform domain present');
    assert.ok(files.has('builder.prisma'), 'builder domain present');
  });

  test('no two models share a name', () => {
    const seen = new Set<string>();
    for (const m of models) {
      assert.ok(!seen.has(m.name), `duplicate model ${m.name}`);
      seen.add(m.name);
    }
  });
});

describe('M-03 — every business model belongs to a tenant', () => {
  test('each carries a tenantId field', () => {
    const missing = tenantScoped
      .filter((m) => !/^\s*tenantId\s+/m.test(m.body))
      .map((m) => `${m.file}:${m.name}`);
    assert.deepEqual(
      missing,
      [],
      'these models have no tenantId — add one, or add the model to NOT_TENANT_SCOPED with a reason in CONSTRAINTS.md',
    );
  });

  test('the exemption list is honest — every name on it exists', () => {
    const names = new Set(models.map((m) => m.name));
    for (const exempt of NOT_TENANT_SCOPED) {
      assert.ok(names.has(exempt), `NOT_TENANT_SCOPED names "${exempt}", which is not a model`);
    }
  });
});

describe('M-04 — unique constraints are scoped to a tenant', () => {
  test('every field-level @unique is either tenant-scoped or explicitly global', () => {
    const offenders: string[] = [];
    for (const m of models) {
      for (const u of fieldUniques(m)) {
        if (!GLOBAL_UNIQUES.has(u)) offenders.push(`${m.file}:${u}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'a bare @unique is global across every tenant — move it into an @@unique([tenantId, ...]) or add it to GLOBAL_UNIQUES with a reason in CONSTRAINTS.md',
    );
  });

  test('every @@unique on a tenant-scoped model leads with tenantId', () => {
    const offenders: string[] = [];
    for (const m of tenantScoped) {
      for (const u of blockUniques(m)) {
        if (u[0] !== 'tenantId') offenders.push(`${m.file}:${m.name} @@unique([${u.join(', ')}])`);
      }
    }
    assert.deepEqual(offenders, [], 'these would collide or leak across tenants');
  });

  test('the two constraints most likely to leak customer data are scoped', () => {
    // Called out by name because CONSTRAINTS.md names them as the dangerous
    // ones: a slug left global blocks every later tenant, and a customer phone
    // left global merges two companies' customer registries.
    const page = models.find((m) => m.name === 'LandingPage');
    assert.ok(page, 'LandingPage exists');
    assert.ok(
      blockUniques(page!).some((u) => u.includes('tenantId') && u.includes('slug')),
      'LandingPage.slug must be unique per tenant, not globally',
    );

    const category = models.find((m) => m.name === 'Category');
    assert.ok(
      blockUniques(category!).some((u) => u.includes('tenantId') && u.includes('slug')),
      'Category.slug must be unique per tenant',
    );
  });
});

describe('indexes lead with the column every query filters on', () => {
  test('every @@index on a tenant-scoped model starts with tenantId', () => {
    const offenders: string[] = [];
    for (const m of tenantScoped) {
      for (const idx of blockIndexes(m)) {
        if (idx[0] !== 'tenantId') offenders.push(`${m.file}:${m.name} @@index([${idx.join(', ')}])`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'an index that does not lead with tenantId cannot serve a tenant-filtered query',
    );
  });

  test('every tenant-scoped model is indexed on tenantId somehow', () => {
    const unindexed = tenantScoped
      .filter((m) => !blockIndexes(m).some((i) => i[0] === 'tenantId'))
      .filter((m) => !blockUniques(m).some((u) => u[0] === 'tenantId'))
      // A model whose primary key IS the tenant needs no separate index.
      .filter((m) => !/^\s*tenantId\s+String\s+@id/m.test(m.body))
      .map((m) => `${m.file}:${m.name}`);
    assert.deepEqual(unindexed, [], 'every tenant-scoped table needs a tenantId index');
  });
});

describe('M-06 — SQLite types did not survive the port', () => {
  test('no Float anywhere: money is Decimal', () => {
    const offenders: string[] = [];
    for (const m of models) {
      for (const line of m.body.split('\n')) {
        const stripped = line.replace(/\/\/.*/, '');
        if (/^\s*\w+\s+Float\b/.test(stripped)) {
          offenders.push(`${m.file}:${m.name} — ${stripped.trim()}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'the ERP stored money as SQLite REAL; float money drifts and compounds through FIFO lots and margins',
    );
  });

  test('timestamps are DateTime, not epoch-millisecond integers', () => {
    const offenders: string[] = [];
    for (const m of models) {
      for (const line of m.body.split('\n')) {
        const stripped = line.replace(/\/\/.*/, '');
        const match = stripped.match(/^\s*(\w*(?:At|Time))\s+Int\b/);
        if (match) offenders.push(`${m.file}:${m.name}.${match[1]}`);
      }
    }
    assert.deepEqual(offenders, [], 'these look like epoch-ms integers that should be DateTime');
  });
});
