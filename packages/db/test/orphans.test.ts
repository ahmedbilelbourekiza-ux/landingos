import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/* =============================================================================
 * A column nothing names — AUDIT.8, and the closure of the class that produced
 * most of this audit's findings.
 *
 * The fourth pass asked one question more productively than any other:
 *
 *   > Which columns does something write that nothing reads, and which does
 *   > something read that nothing writes?
 *
 * It is the shape of BUG-02 (`deliveryOutcome`: eight readers, no writer),
 * `IntegrationLog` (migrated with its indexes, no caller), `OrderCall.suspicious`
 * (computed, shown nowhere), `fakeReason` (written since Phase 5, read by
 * nothing), A5 (`CatalogProduct`'s lifetime counters maintained by NOTHING for
 * the platform's whole life), A7, A11 (`AiProvider.lastTestAt`) and A14 (the
 * channel parser dropping `externalProductId`, which left `resolveProduct`'s
 * exact-link branch dead since it was written).
 *
 * Eight serious defects, one question, asked by hand each time somebody thought
 * to. This asks it on every run.
 *
 * -----------------------------------------------------------------------------
 * WHAT IT CAN AND CANNOT SEE, STATED RATHER THAN IMPLIED
 *
 * It is a NAME check, not a dataflow analysis: it asserts that the application
 * source mentions each column somewhere. That catches the whole class above —
 * every one of those columns appeared in ZERO source files or in readers only —
 * and it does NOT catch a column that is read but never written, when both
 * words are the same identifier. A5 would have been caught (`confirmedOrders`
 * appeared nowhere before AUDIT.1 added the column); A11 would NOT have been,
 * because `lastTestAt` was named by the carrier routes.
 *
 * That is a real limit and the reason it is written here rather than claimed
 * away: this closes the cheap half of the question mechanically, and the
 * expensive half — "who WRITES it" — stays a thing a person asks. The two
 * exemptions below are the current answer, and each carries its reason.
 * ========================================================================== */

const SCHEMA_DIR = path.join(import.meta.dirname, '..', 'prisma', 'schema');
const APP_SRC = path.join(
  import.meta.dirname, '..', '..', '..', 'apps', 'website-builder', 'src',
);

/**
 * Columns that appear nowhere in the application source, each with the reason.
 *
 * A reason must say **what would make it referenced** — not merely that
 * somebody looked. There are exactly two acceptable answers and the entry has
 * to pick one:
 *
 *   DEAD BOTH SIDES — the legacy does not use it either (checked in `apps/erp`),
 *   so there is nothing to build. Nothing will ever reference it.
 *
 *   AHEAD OF A FEATURE — the column was declared for work that is named and
 *   scheduled. **This is a gap, recorded rather than hidden**, and it must name
 *   the work. An entry that cannot name it is a finding, not an exemption.
 */
const UNREFERENCED_BY_DESIGN = new Map<string, string>([
  // ---- dead both sides ------------------------------------------------------
  [
    'Carrier.customFields',
    'DEAD BOTH SIDES. The legacy declares it in the adapter config JSDoc and no '
    + 'adapter — zr, ecom or mock — ever reads it. A hook nobody used, carried '
    + 'across so a migrated row keeps whatever it holds.',
  ],
  [
    'SalesChannel.webhookConfig',
    "DEAD BOTH SIDES. The legacy's own schema says `(legacy, kept for "
    + 'back-compat)` and nothing reads its fields there either. The flat columns '
    + 'superseded it; the blob is kept so a row written before them is not '
    + 'silently emptied.',
  ],

  // ---- ahead of a feature, each naming the work -----------------------------
  [
    'TenantDomain.verificationToken',
    'AHEAD OF A FEATURE: custom-domain management. The READ path is complete and '
    + 'safe — `tenantByDomain` refuses a row with no `verifiedAt` — but no screen '
    + 'adds a domain, so nothing mints the token yet. Phase 8 (storefront), not '
    + 'ERP parity.',
  ],
  [
    'TenantDomain.isPrimary',
    'AHEAD OF A FEATURE: custom-domain management, as above. Which of several '
    + 'verified hostnames canonical links should use. Meaningless until a tenant '
    + 'can add a second one.',
  ],
  [
    'Session.lastSeenAt',
    'AHEAD OF A FEATURE: session management (Phase 8). Showing somebody their '
    + 'active sessions and letting them end one needs a last-seen; writing it on '
    + 'every request is a write per request, which is the design question that '
    + 'work has to answer first.',
  ],
  [
    'Subscription.seats',
    'AHEAD OF A FEATURE: seat billing. **No seat limit is enforced anywhere** — '
    + 'the invitation route admits as many people as a tenant invites. The legacy '
    + 'is single-tenant and has no seat concept, so this is not a parity gap; it '
    + 'is platform work, recorded in NEXT_STEPS.',
  ],
  [
    'Subscription.externalCustomerId',
    'AHEAD OF A FEATURE: the billing provider integration, which does not exist. '
    + 'Nullable precisely so a tenant can exist before it pays — every tenant '
    + 'today is in that state.',
  ],
  [
    'Subscription.externalSubscriptionId',
    'AHEAD OF A FEATURE: the billing provider integration, as above.',
  ],
  [
    'Subscription.trialEndsAt',
    'AHEAD OF A FEATURE: trial expiry. `SubscriptionStatus.TRIALING` is honoured '
    + 'by the entitlement checks; what is missing is the job that ends a trial on '
    + 'a date. Platform work, not ERP parity.',
  ],
  [
    'Subscription.currentPeriodEnd',
    'AHEAD OF A FEATURE: billing periods. The same shape as `trialEndsAt` — the '
    + 'STATUS is honoured everywhere and nothing moves a subscription to '
    + 'PAST_DUE when a period ends, so today a status only changes because '
    + 'somebody changes it. Platform work.',
  ],
  [
    'Subscription.cancelAtPeriodEnd',
    'AHEAD OF A FEATURE: billing periods, as above. A cancellation scheduled for '
    + 'a date nothing arrives at.',
  ],
]);

const SCALARS = new Set([
  'String', 'Int', 'BigInt', 'Boolean', 'DateTime', 'Decimal', 'Json', 'Float', 'Bytes',
]);

/** Columns every model has, which are named by the framework rather than by us. */
const UNIVERSAL = new Set(['id', 'tenantId', 'createdAt', 'updatedAt']);

function schemaText(): string {
  return fs.readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.prisma'))
    .map((f) => fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8'))
    .join('\n');
}

/** Every scalar column, as `Model.field`. Relations and enums are skipped. */
function scalarColumns(text: string): string[] {
  const out: string[] = [];
  let model: string | null = null;
  for (const line of text.split('\n')) {
    const start = /^model\s+(\w+)\s*\{/.exec(line);
    if (start) {
      model = start[1];
      continue;
    }
    if (line.trim() === '}') {
      model = null;
      continue;
    }
    if (!model) continue;
    const field = /^\s+(\w+)\s+(\w+)(\[\])?(\?)?/.exec(line);
    if (!field) continue;
    const [, name, type] = field;
    if (UNIVERSAL.has(name)) continue;
    // A capitalised type that is not a scalar is a relation or an enum; the
    // former is not a column and the latter is named through its own values.
    if (!SCALARS.has(type)) continue;
    out.push(`${model}.${name}`);
  }
  return out;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('every column the schema declares is named by the application', () => {
  const text = schemaText();
  const columns = scalarColumns(text);
  const files = sourceFiles(APP_SRC);
  const blob = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  test('the scan found a schema and a source tree', () => {
    // Either half silently matching nothing makes the assertion below vacuous,
    // which is the failure mode a derived test has instead of going stale.
    assert.ok(columns.length > 150, `only ${columns.length} columns were parsed`);
    assert.ok(files.length > 100, `only ${files.length} source files were read`);
  });

  test('no column is declared and then named nowhere', () => {
    const orphans: string[] = [];
    for (const column of columns) {
      const field = column.split('.')[1];
      if (new RegExp(`\\b${field}\\b`).test(blob)) continue;
      if (UNREFERENCED_BY_DESIGN.has(column)) continue;
      orphans.push(column);
    }

    assert.deepEqual(
      orphans,
      [],
      'columns declared in the schema and named nowhere in the application:\n'
      + orphans.map((o) => `  ${o}`).join('\n')
      + '\n\nEither something should be reading or writing it, or it belongs in '
      + 'UNREFERENCED_BY_DESIGN with a reason. See the header: this is the class '
      + 'that produced BUG-02, A5, A7, A11 and A14.',
    );
  });

  test('every exemption still describes a column that exists', () => {
    // An exemption for a removed column is a comment nobody will ever delete
    // and a reason nobody can check.
    const declared = new Set(columns);
    for (const [column, reason] of UNREFERENCED_BY_DESIGN) {
      assert.ok(declared.has(column), `${column} is exempted and no longer exists`);
      assert.ok(reason.length > 40, `${column}'s exemption gives no real reason`);
    }
  });

  test('an exemption stops applying once something names the column', () => {
    // The other direction, and the one that keeps the list honest: a column
    // that has since acquired a reader must come OFF the list, or the list
    // slowly becomes a place where real findings hide.
    const stale: string[] = [];
    for (const column of UNREFERENCED_BY_DESIGN.keys()) {
      const field = column.split('.')[1];
      if (new RegExp(`\\b${field}\\b`).test(blob)) stale.push(column);
    }
    assert.deepEqual(
      stale,
      [],
      `these are exempted as unreferenced and are now referenced: ${stale.join(', ')}`,
    );
  });
});
