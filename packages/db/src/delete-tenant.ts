import { Prisma } from '../prisma/client/index.js';
import { withTenant, asPlatform } from './tenant-client.ts';

/* =============================================================================
 * deleteTenant — the ONE way a tenant and everything it owns actually goes.
 *
 * THE DEFECT THIS CLOSES. `tenant.delete` cascades platform rows (memberships,
 * subscriptions, invitations) and nothing else: the product domains reference
 * the tenant by an RLS-scoped COLUMN, not a foreign key, so every landing
 * page, order, client and setting survives the Tenant row's deletion as an
 * unreachable orphan. Measured on 12 August 2026: `neondb` held **73,267
 * orphaned rows from 4,149 dead tenants** — years-worth of test fixtures the
 * harness believed it had deleted (its own comment said the tenant delete
 * "cascades ... all 46 scoped tables"), and the production cleanup that found
 * the defect had to sweep by hand.
 *
 * WHY A HELPER AND NOT FK CASCADES. Adding a Tenant relation to 49 tables is
 * a schema migration on a live shared database that only becomes coherent
 * once production migrates too — and it would change the MEANING of
 * `tenant.delete` everywhere: one accidental platform-row delete would
 * silently destroy every product row. The column-only design fails SAFE
 * (orphans are recoverable; a cascade is not), and this platform's stated
 * posture is that total destruction must be a deliberate, named act — so the
 * named act is this function.
 *
 * HOW IT SWEEPS. The scoped models are enumerated from the Prisma DMMF —
 * every model carrying a `tenantId` field — so a table added later is swept
 * without anyone remembering to list it (the same closing-of-the-class as
 * AUDIT.8's orphan scan). Each pass runs inside `withTenant(tenantId)` and
 * issues an UNFILTERED `deleteMany({})`: rule 2 of the method — never write
 * `where: { tenantId }` — means RLS itself decides what "everything" is, and
 * a bug in this function is INCAPABLE of touching another tenant's rows.
 * Passes repeat until one deletes nothing, so restrictive FKs between scoped
 * tables resolve themselves without a hand-maintained ordering. The Tenant
 * row goes last, and its absence is tolerated — the caller may be cleaning
 * up after a delete that already happened.
 *
 * WHAT IT DOES NOT DELETE. Users. A user can belong to several tenants, so
 * removing one is a separate decision the caller makes with the facts.
 *
 * Bounded by `withTenant`'s 15s transaction budget PER PASS — fixture-sized
 * tenants clear in one. A future self-serve account deletion over a large
 * tenant should batch inside the same passes, not bypass this function.
 * ========================================================================== */

/** Model delegates that carry a tenantId column, from the schema itself. */
const SCOPED_DELEGATES: readonly string[] = Prisma.dmmf.datamodel.models
  .filter(
    (m) => m.name !== 'Tenant' && m.fields.some((f) => f.name === 'tenantId' && f.kind === 'scalar'),
  )
  .map((m) => m.name.charAt(0).toLowerCase() + m.name.slice(1));

const MAX_PASSES = 5;

export interface DeleteTenantResult {
  /** Scoped rows removed across every pass (platform cascades not counted). */
  rowsDeleted: number;
  /** Sweep passes it took to reach a clean one. */
  passes: number;
  /** Whether a Tenant row existed to delete (false when cleaning an orphan). */
  tenantRowDeleted: boolean;
}

export async function deleteTenant(tenantId: string): Promise<DeleteTenantResult> {
  let rowsDeleted = 0;
  let passes = 0;

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    passes = pass;
    const deletedThisPass = await withTenant(tenantId, async (db) => {
      let n = 0;
      for (const delegate of SCOPED_DELEGATES) {
        try {
          const res = await (db as any)[delegate].deleteMany({});
          n += res.count;
        } catch {
          // A restrictive FK from a table swept later in this pass; the next
          // pass gets it once the children are gone. A table that keeps
          // failing keeps its rows — which the caller's zero-rows check (and
          // the suite in test/delete-tenant.test.ts) makes loud, not silent.
        }
      }
      return n;
    });
    rowsDeleted += deletedThisPass;
    if (deletedThisPass === 0) break;
  }

  const tenantRowDeleted = await asPlatform()
    .tenant.delete({ where: { id: tenantId } })
    .then(() => true)
    .catch(() => false);

  return { rowsDeleted, passes, tenantRowDeleted };
}
